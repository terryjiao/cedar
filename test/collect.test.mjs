import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectProject } from '../dist/src/collect.js';

async function project(t) {
  const root = await mkdtemp(join(tmpdir(), 'cedar-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function file(root, path, content) {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content);
}

test('collects source evidence while excluding credentials, dependencies and binary content', async t => {
  const root = await project(t);
  await file(root, 'README.md', 'An agent for documents.\n');
  await file(root, 'src/tool.ts', 'export const read = () => "ok";\n');
  await file(root, '.env.local', 'API_KEY=secret');
  await file(root, 'credentials.json', '{"key":"secret"}');
  await file(root, '.npmrc', '//registry/:_authToken=secret');
  await file(root, 'node_modules/dep/README.md', 'dependency');
  await file(root, 'binary.ts', Buffer.from([0, 1, 2]));
  const result = await collectProject(root);
  assert.deepEqual(result.sources.map(s => s.path).sort(), ['README.md', 'src/tool.ts']);
  assert.equal(result.sources.find(s => s.path === 'README.md').lineCount, 2);
  assert.equal(result.sources.find(s => s.path === 'README.md').content, 'An agent for documents.\n');
  assert.equal(result.scope.selection, 'automatic');
  assert.ok(result.omitted.some(f => f.path === 'binary.ts' && f.reason === 'binary'));
});

test('explicit selection is exact and bundle identity changes with content', async t => {
  const root = await project(t);
  await file(root, 'README.md', 'First version');
  await file(root, 'notes.md', 'Not selected');
  const a = await collectProject(root, { include: ['README.md'] });
  const b = await collectProject(root, { include: ['README.md'] });
  assert.equal(a.bundleId, b.bundleId);
  assert.deepEqual(a.sources.map(s => s.path), ['README.md']);
  await file(root, 'README.md', 'Second version');
  const c = await collectProject(root, { include: ['README.md'] });
  assert.notEqual(c.bundleId, a.bundleId);
});

test('rejects traversal, sensitive explicit files, missing files, and excessive explicit selection', async t => {
  const root = await project(t);
  await file(root, 'README.md', '123456789');
  await file(root, '.env', 'secret');
  for (const path of ['../outside.md', '/absolute.md', '.env', 'missing.md']) {
    await assert.rejects(collectProject(root, { include: [path] }));
  }
  await assert.rejects(collectProject(root, { include: ['README.md'], maxFileBytes: 5 }), /limit|large/i);
  await assert.rejects(collectProject(root, { maxFiles: 0 }), /positive|limit/i);
});

test('default limits report omissions without silently truncating source text', async t => {
  const root = await project(t);
  await file(root, 'README.md', 'Short');
  await file(root, 'extra.md', 'Another');
  const result = await collectProject(root, { maxFiles: 1 });
  assert.equal(result.sources.length, 1);
  assert.ok(result.omitted.some(f => f.reason === 'file-limit'));
  assert.equal(result.sources[0].content, 'Short');
});

test('Git ignored files are excluded from automatic discovery', async t => {
  const root = await project(t);
  execFileSync('git', ['init', '-q'], { cwd: root });
  await file(root, '.gitignore', 'private/\n');
  await file(root, 'README.md', 'Public project description');
  await file(root, 'private/notes.md', 'Not collected');
  const result = await collectProject(root);
  assert.equal(result.scope.discovery, 'git');
  assert.ok(!result.sources.some(s => s.path.startsWith('private/')));
});

test('collection disables repository fsmonitor hooks instead of executing target configuration', async t => {
  const root = await project(t);
  execFileSync('git', ['init', '-q'], { cwd: root });
  await file(root, 'README.md', 'Description');
  await file(root, 'hook.sh', '#!/bin/sh\nprintf executed > hook-ran.txt\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['config', 'core.fsmonitor', './hook.sh'], { cwd: root });
  await collectProject(root);
  const { access } = await import('node:fs/promises');
  await assert.rejects(access(join(root, 'hook-ran.txt')));
});

test('collection never runs Git clean filters on modified tracked source files', async t => {
  const root = await project(t);
  const git = (...args) => execFileSync('git', args, { cwd: root });
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  await file(root, 'README.md', 'Original.\n');
  await file(root, '.gitattributes', 'README.md filter=probe\n');
  git('add', 'README.md', '.gitattributes');
  await file(root, 'probe.cjs', "require('node:fs').writeFileSync('filter-ran.txt','executed');process.stdin.pipe(process.stdout);");
  git('config', 'filter.probe.clean', 'node probe.cjs');
  await file(root, 'README.md', 'Changed!.\n');
  const result = await collectProject(root);
  const { access } = await import('node:fs/promises');
  await assert.rejects(access(join(root, 'filter-ran.txt')));
  assert.equal(result.sources.find(s => s.path === 'README.md').content, 'Changed!.\n');
  assert.equal(result.git.dirty, null);
});

test('explicit source selection does not bypass Git ignore', async t => {
  const root = await project(t);
  execFileSync('git', ['init', '-q'], { cwd: root });
  await file(root, '.gitignore', 'private/\n');
  await file(root, 'private/notes.md', 'Ignored content');
  await assert.rejects(collectProject(root, { include: ['private/notes.md'] }), /ignored|inventory/i);
});

test('does not follow a directory symlink when explicitly selecting a descendant', async t => {
  const root = await project(t);
  const outside = await project(t);
  await file(outside, 'README.md', 'Outside');
  try { await symlink(outside, join(root, 'linked'), 'junction'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Junction unavailable'); return; } throw error; }
  await assert.rejects(collectProject(root, { include: ['linked/README.md'] }), /symlink|symbolic/i);
  const result = await collectProject(root);
  assert.equal(result.sources.length, 0);
});
