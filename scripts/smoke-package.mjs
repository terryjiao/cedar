import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check through npm run test:package so npm_execpath is available.');
assert.ok(process.argv.length <= 3, 'Usage: npm run test:package -- [local-package.tgz]');
const existingTarball = process.argv[2] ? await realpath(resolve(process.argv[2])) : undefined;
const expectedPackage = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
const expectedSkill = await readFile(join(repository, 'skills', 'cedar-onboard', 'SKILL.md'), 'utf8');
const temporaryParent = await realpath(tmpdir());
const temporary = await mkdtemp(join(temporaryParent, 'cedar-package-smoke-'));

function inside(parent, child) {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function npm(args, cwd) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0,
    `npm ${args[0]} failed (${result.signal ?? result.status}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function inspectManifest(output) {
  const manifests = JSON.parse(output);
  assert.equal(manifests.length, 1, 'Expected exactly one packed package.');
  const manifest = manifests[0];
  assert.equal(manifest.name, expectedPackage.name);
  assert.equal(manifest.version, expectedPackage.version);
  assert.ok(Array.isArray(manifest.files), 'npm pack must provide the package file manifest.');
  const files = manifest.files.map(file => file.path);
  assert.equal(new Set(files).size, files.length, 'Package contains duplicate file paths.');
  const allowed = /^(?:package\.json|README\.md|LICENSE|dist\/src\/[^/]+\.js|skills\/cedar-onboard\/SKILL\.md)$/;
  assert.deepEqual(files.filter(path => !allowed.test(path)), [], 'Package contains unexpected or private files.');
  for (const required of ['package.json', 'README.md', 'dist/src/cli.js', 'skills/cedar-onboard/SKILL.md']) {
    assert.ok(files.includes(required), `Package is missing ${required}.`);
  }
  return manifest;
}

async function snapshot(directory) {
  const files = [];
  async function visit(current, prefix = '') {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push([path, 'directory']);
        await visit(join(current, entry.name), path);
      } else {
        assert.ok(entry.isFile(), `Unexpected non-file in synthetic target: ${path}`);
        files.push([path, createHash('sha256').update(await readFile(join(current, entry.name))).digest('hex')]);
      }
    }
  }
  await visit(directory);
  return files;
}

try {
  const consumer = join(temporary, 'consumer');
  const cache = join(temporary, 'npm-cache');
  const packed = join(temporary, 'packed');
  await mkdir(consumer);
  await mkdir(packed);
  assert.deepEqual(await readdir(consumer), [], 'Consumer must start empty.');

  console.log(existingTarball ? 'Inspecting the supplied package tarball.' : 'Packing the built package.');
  const manifest = inspectManifest(existingTarball
    ? npm(['pack', '--dry-run', '--ignore-scripts', '--json', existingTarball], consumer)
    : npm(['pack', '--ignore-scripts', '--json', '--pack-destination', packed], repository));
  assert.equal(basename(manifest.filename), manifest.filename, 'Unexpected package filename.');
  const tarball = existingTarball ?? await realpath(join(packed, manifest.filename));
  if (!existingTarball) assert.ok(inside(packed, tarball), 'Packed archive escaped its output directory.');
  const cedar = (...args) => npm([
    'exec', '--yes', '--ignore-scripts', '--cache', cache, `--package=${tarball}`, '--', 'cedar', ...args,
  ], consumer);

  console.log('Running the exact tarball from an empty consumer directory with an isolated npm cache.');
  assert.match(cedar('--help'), /cedar onboard/);
  assert.equal(cedar('--version').trim(), expectedPackage.version);
  const skill = cedar('skill');
  assert.equal(skill, expectedSkill, 'Packaged Skill differs from the release source.');
  const assetName = `${expectedPackage.name.replace(/^@/, '').replace('/', '-')}-${expectedPackage.version}.tgz`;
  assert.ok(skill.includes(`https://github.com/terryjiao/cedar/releases/download/v${expectedPackage.version}/${assetName}`),
    'Skill must identify the matching versioned release asset.');

  const target = join(temporary, 'synthetic-target');
  const bundleDirectory = join(temporary, 'bundle');
  const reportDirectory = join(temporary, 'report');
  await mkdir(target);
  const documentedGoal = 'Read documents with DSH.';
  await writeFile(join(target, 'README.md'), `${documentedGoal}\n`);
  await writeFile(join(target, 'package.json'), JSON.stringify({ name: 'cedar-synthetic-package-smoke', private: true }));
  const originalTarget = await snapshot(target);
  assert.match(cedar('onboard', target, '--out', bundleDirectory), /not-executed/);
  const bundle = JSON.parse(await readFile(join(bundleDirectory, 'sources.json'), 'utf8'));
  const readiness = JSON.parse(await readFile(join(bundleDirectory, 'dsh-readiness.json'), 'utf8'));
  assert.equal(readiness.status, 'not-executed');
  assert.equal(JSON.parse(await readFile(join(bundleDirectory, 'coverage.schema.json'), 'utf8')).type, 'object');
  assert.equal(await readFile(join(bundleDirectory, 'cedar-onboard.md'), 'utf8'), skill);
  assert.match(await readFile(join(bundleDirectory, 'request.md'), 'utf8'), /cedar-onboard\.md/);
  const source = bundle.sources.find(item => item.path === 'README.md');
  assert.ok(source, 'Synthetic README was not captured.');
  assert.equal(source.content, `${documentedGoal}\n`);
  const map = {
    schemaVersion: 1,
    bundleId: bundle.bundleId,
    projectName: 'Synthetic package smoke fixture',
    summary: 'A synthetic static plan used to verify the distributed CLI.',
    tasks: [{
      id: 'read-documents', title: 'Read a document', userGoal: 'Read a document with DSH.', basis: 'documented',
      evidence: [{ sourceId: source.id, startLine: 1, endLine: 1, quote: documentedGoal }],
      conditions: ['A document is supplied'], deliverables: ['An answer grounded in the document'],
      checks: [{ description: 'Check the answer against the document', method: 'human', basis: 'proposed', evidence: [] }],
      execution: { status: 'needs-adapter', blockers: ['The synthetic fixture has no execution adapter.'] },
      questions: [],
    }],
    exclusions: ['Runtime execution is outside this smoke check.'],
    questions: [],
  };
  const mapPath = join(bundleDirectory, 'coverage.json');
  await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`);
  assert.match(cedar('validate', mapPath, '--bundle', bundleDirectory), /Validated 1 task/);
  cedar('report', mapPath, '--bundle', bundleDirectory, '--out', reportDirectory);
  for (const filename of ['report.md', 'report.html']) {
    const report = await readFile(join(reportDirectory, filename), 'utf8');
    assert.ok(report.includes('not-executed'), `${filename} must preserve unexecuted runtime status.`);
    assert.ok(report.includes(documentedGoal), `${filename} must retain the captured evidence.`);
  }
  assert.deepEqual(await snapshot(target), originalTarget, 'The synthetic target changed during onboarding.');
  assert.deepEqual(await readdir(consumer), [], 'npm exec unexpectedly wrote project files in the consumer directory.');
  console.log(`Package smoke passed: ${manifest.name}@${manifest.version}; ${manifest.files.length} allowed files; onboard, validate and report completed.`);
} finally {
  const cleanupTarget = await realpath(temporary);
  assert.ok(inside(temporaryParent, cleanupTarget)
    && basename(cleanupTarget).startsWith('cedar-package-smoke-'), 'Refusing cleanup outside the owned temporary directory.');
  await rm(cleanupTarget, { recursive: true, force: true });
}
