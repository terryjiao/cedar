import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { bundleIdentity, sha256, sourceId } from './integrity.js';
import { isWithin } from './paths.js';
import type { CollectOptions, SourceBundle, SourceSnapshot } from './types.js';

const exec = promisify(execFile);
const excludedDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cedar', '.superpowers', '.venv', 'venv', '__pycache__', '.next']);
const textExtensions = new Set(['.md', '.txt', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.py', '.toml']);

function exclusion(path: string): string | undefined {
  const parts = path.split('/');
  if (parts.slice(0, -1).some(part => excludedDirectories.has(part.toLowerCase()))) return 'excluded-directory';
  const name = parts.at(-1)!.toLowerCase();
  if (/^(\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|auth(?:\..*)?|id_rsa|id_ed25519)$/.test(name)
    || /\.(pem|key|p12|pfx)$/.test(name)) return 'sensitive-filename';
  if (/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|uv\.lock)$/.test(name)) return 'dependency-lock';
  if (!textExtensions.has(extname(name))) return 'unsupported-file';
  return undefined;
}

function normalPath(input: string): string {
  const path = input.replaceAll('\\', '/');
  if (isAbsolute(input) || /^[a-z]:/i.test(path) || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '' || p === '.')) {
    throw new Error(`Use a project-relative file path without traversal: ${input}`);
  }
  return path;
}

async function checkPath(root: string, path: string): Promise<void> {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symbolic link is not a source file: ${path}`);
  }
  const actual = await realpath(current);
  if (!isWithin(root, actual)) throw new Error(`Source escapes project: ${path}`);
}

async function walk(root: string, at = ''): Promise<string[]> {
  const paths: string[] = [];
  for (const item of await readdir(join(root, at), { withFileTypes: true })) {
    const path = at ? `${at}/${item.name}` : item.name;
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) {
      if (!excludedDirectories.has(item.name.toLowerCase())) paths.push(...await walk(root, path));
    } else if (item.isFile()) paths.push(path);
  }
  return paths;
}

function kind(path: string): SourceSnapshot['kind'] {
  if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\./i.test(path)) return 'test';
  if (/\.(?:md|txt)$/i.test(path)) return 'documentation';
  if (/\.(?:json|yaml|yml|toml)$/i.test(path)) return 'configuration';
  return 'implementation';
}

function priority(path: string): number {
  if (/^README(?:\.[a-z-]+)?\.md$/i.test(path)) return 100;
  if (path === 'package.json') return 95;
  if (/cordis.*\.ya?ml$/.test(path)) return 85;
  const score = { documentation: 75, configuration: 65, test: 60, implementation: 50 }[kind(path)];
  return score - path.split('/').length;
}

/** Collect text evidence without importing or executing target project code. */
export async function collectProject(input: string, options: CollectOptions = {}): Promise<SourceBundle> {
  const root = await realpath(resolve(input));
  if (!(await stat(root)).isDirectory()) throw new Error('Project must be a directory.');
  const limits = { maxFiles: options.maxFiles ?? 24, maxTotalBytes: options.maxTotalBytes ?? 262144, maxFileBytes: options.maxFileBytes ?? 65536 };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer limit.`);
  }
  let inventory: string[];
  let discovery: 'git' | 'directory' = 'directory';
  let git: SourceBundle['git'] = null;
  const gitArgs = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'];
  let insideGit = false;
  try {
    insideGit = (await exec('git', [...gitArgs, 'rev-parse', '--is-inside-work-tree'], { cwd: root, timeout: 10000 })).stdout.trim() === 'true';
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code !== 'ENOENT' && !/not a git repository/i.test(failure.stderr ?? '')) throw error;
  }
  if (insideGit) {
    const { stdout } = await exec('git', [...gitArgs, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 16 * 1024 * 1024, timeout: 10000 });
    inventory = [...new Set(stdout.split('\0').filter(Boolean))];
    discovery = 'git';
    let commit: string | null = null;
    try { commit = (await exec('git', [...gitArgs, 'rev-parse', 'HEAD'], { cwd: root, timeout: 10000 })).stdout.trim(); }
    catch { /* An initialized repository can have no commits. */ }
    // Worktree status can invoke configured clean/process filters. Capture file hashes instead.
    git = { commit, dirty: null };
  } else {
    inventory = await walk(root);
  }
  const explicit = options.include !== undefined;
  if (explicit && options.include!.length === 0) throw new Error('Explicit selection requires at least one file.');
  const paths = [...new Set((options.include ?? inventory).map(normalPath))]
    .sort((a, b) => priority(b) - priority(a) || a.localeCompare(b, 'en'));
  if (explicit && insideGit) {
    const allowed = new Set(inventory);
    for (const path of paths) if (!allowed.has(path)) throw new Error(`File is ignored or absent from the Git inventory: ${path}`);
  }
  const sources: SourceSnapshot[] = [];
  const omitted: SourceBundle['omitted'] = [];
  let total = 0;
  function omit(path: string, reason: string): void {
    if (explicit) throw new Error(`Cannot include ${path}: ${reason}. Adjust selection or limits.`);
    omitted.push({ path, reason });
  }
  for (const path of paths) {
    const excluded = exclusion(path);
    if (excluded) { omit(path, excluded); continue; }
    if (sources.length >= limits.maxFiles) { omit(path, 'file-limit'); continue; }
    try { await checkPath(root, path); }
    catch (error) {
      if (explicit) throw error;
      omitted.push({ path, reason: error instanceof Error && /link/i.test(error.message) ? 'symlink' : 'unreadable' });
      continue;
    }
    const info = await stat(join(root, path));
    if (!info.isFile()) { omit(path, 'not-a-file'); continue; }
    if (info.size > limits.maxFileBytes) { omit(path, 'file-byte-limit'); continue; }
    if (total + info.size > limits.maxTotalBytes) { omit(path, 'total-byte-limit'); continue; }
    const data = await readFile(join(root, path));
    if (data.byteLength > limits.maxFileBytes || total + data.byteLength > limits.maxTotalBytes) { omit(path, 'byte-limit-after-read'); continue; }
    if (data.includes(0)) { omit(path, 'binary'); continue; }
    try { new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { omit(path, 'non-utf8'); continue; }
    const content = data.toString('utf8');
    sources.push({ id: sourceId(path), path, kind: kind(path), sha256: sha256(data), bytes: data.byteLength, lineCount: content.split('\n').length, content });
    total += data.byteLength;
  }
  return {
    schemaVersion: 1, bundleId: bundleIdentity(sources), projectName: basename(root), root,
    createdAt: new Date().toISOString(), git,
    scope: { discovery, selection: explicit ? 'explicit' : 'automatic', inventoryCount: inventory.length, ...limits }, sources, omitted
  };
}
