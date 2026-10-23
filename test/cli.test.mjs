import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('dist/src/cli.js');
function run(...args) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 }); }
async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'cedar-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'target');
  await mkdir(project);
  await writeFile(join(project, 'README.md'), 'Read documents with DSH.\n');
  await writeFile(join(project, 'package.json'), '{"name":"sample","scripts":{"test":"node --test"}}');
  return { root, project, bundle: join(root, 'bundle') };
}
function mapFor(bundle) {
  const source = bundle.sources.find(s => s.path === 'README.md');
  return {
    schemaVersion: 1, bundleId: bundle.bundleId, projectName: 'Sample', summary: 'Static plan only.',
    tasks: [{ id: 'documents', title: '<img src=x onerror=alert(1)>', userGoal: 'Read a document', basis: 'documented',
      evidence: [{ sourceId: source.id, startLine: 1, endLine: 1, quote: 'Read documents with DSH.' }],
      conditions: ['Missing file'], deliverables: ['Answer'],
      checks: [{ description: 'Report missing input', method: 'deterministic', basis: 'proposed', evidence: [] }],
      execution: { status: 'needs-adapter', blockers: ['Runtime unverified'] }, questions: [] }],
    exclusions: ['No browser tasks assessed'], questions: []
  };
}

test('CLI produces a source bundle then validates and renders a host-agent map', async t => {
  const paths = await workspace(t);
  const prepare = run('onboard', paths.project, '--out', paths.bundle);
  assert.equal(prepare.status, 0, prepare.stderr);
  const bundle = JSON.parse(await readFile(join(paths.bundle, 'sources.json'), 'utf8'));
  const readiness = JSON.parse(await readFile(join(paths.bundle, 'dsh-readiness.json'), 'utf8'));
  assert.equal(readiness.status, 'not-executed');
  assert.equal(await readFile(join(paths.bundle, 'cedar-onboard.md'), 'utf8'), await readFile('skills/cedar-onboard/SKILL.md', 'utf8'));
  assert.match(await readFile(join(paths.bundle, 'request.md'), 'utf8'), /cedar-onboard\.md/);
  assert.equal(JSON.parse(await readFile(join(paths.bundle, 'coverage.schema.json'), 'utf8')).type, 'object');
  const mapPath = join(paths.root, 'coverage.json');
  await writeFile(mapPath, JSON.stringify(mapFor(bundle)));
  const checked = run('validate', mapPath, '--bundle', paths.bundle);
  assert.equal(checked.status, 0, checked.stderr);
  const reportDir = join(paths.root, 'report');
  const report = run('report', mapPath, '--bundle', paths.bundle, '--out', reportDir);
  assert.equal(report.status, 0, report.stderr);
  const html = await readFile(join(reportDir, 'report.html'), 'utf8');
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('Read documents with DSH.'));
  assert.ok(html.includes('not-executed'));
  assert.ok((await readFile(join(reportDir, 'report.md'), 'utf8')).includes('Runtime unverified'));
});

test('version and Skill are available from an unrelated working directory', async t => {
  const paths = await workspace(t);
  const version = spawnSync(process.execPath, [cli, '--version'], { cwd: paths.root, encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(version.stdout.trim(), metadata.version);
  const skill = spawnSync(process.execPath, [cli, 'skill'], { cwd: paths.root, encoding: 'utf8' });
  assert.equal(skill.status, 0, skill.stderr);
  assert.equal(skill.stdout, await readFile('skills/cedar-onboard/SKILL.md', 'utf8'));
  assert.match(skill.stdout, /releases\/download\/v0\.1\.0\/terryjiao-cedar-0\.1\.0\.tgz/);
  assert.notEqual(run('skill', 'unexpected').status, 0);
  assert.notEqual(run('--version', 'unexpected').status, 0);
});

test('CLI refuses to overwrite an existing output and leaves existing files intact', async t => {
  const paths = await workspace(t);
  await mkdir(paths.bundle);
  await writeFile(join(paths.bundle, 'keep.txt'), 'Keep me');
  const result = run('onboard', paths.project, '--out', paths.bundle);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Output already exists/);
  assert.equal(await readFile(join(paths.bundle, 'keep.txt'), 'utf8'), 'Keep me');
});

test('invalid maps fail without producing a report directory', async t => {
  const paths = await workspace(t);
  assert.equal(run('onboard', paths.project, '--out', paths.bundle).status, 0);
  const bundle = JSON.parse(await readFile(join(paths.bundle, 'sources.json'), 'utf8'));
  const invalid = mapFor(bundle);
  invalid.tasks[0].evidence[0].quote = 'Invented promise';
  const path = join(paths.root, 'invalid.json');
  await writeFile(path, JSON.stringify(invalid));
  const out = join(paths.root, 'invalid-report');
  const result = run('report', path, '--bundle', paths.bundle, '--out', out);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /quote/i);
  await assert.rejects(access(out));
});

test('CLI rejects unknown arguments and output inside the target', async t => {
  const paths = await workspace(t);
  assert.notEqual(run('onboard', paths.project, '--surprise').status, 0);
  assert.notEqual(run('onboard', paths.project, '--out', join(paths.project, 'generated')).status, 0);
  assert.equal(run('--help').status, 0);
});

test('onboarding refuses output within the target through a junction or dot-prefixed name', async t => {
  const paths = await workspace(t);
  const dotted = run('onboard', paths.project, '--out', join(paths.project, '..generated'));
  assert.notEqual(dotted.status, 0);
  await assert.rejects(access(join(paths.project, '..generated')));
  const alias = join(paths.root, 'target-alias');
  try { await symlink(paths.project, alias, 'junction'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Junction unavailable'); return; } throw error; }
  const linked = run('onboard', paths.project, '--out', join(alias, 'generated'));
  assert.notEqual(linked.status, 0);
  await assert.rejects(access(join(paths.project, 'generated')));
});

test('report keeps the target read-only, including junctions, but supports portable snapshots', async t => {
  const paths = await workspace(t);
  assert.equal(run('onboard', paths.project, '--out', paths.bundle).status, 0);
  const bundle = JSON.parse(await readFile(join(paths.bundle, 'sources.json'), 'utf8'));
  const mapPath = join(paths.root, 'coverage.json');
  await writeFile(mapPath, JSON.stringify(mapFor(bundle)));
  const direct = run('report', mapPath, '--bundle', paths.bundle, '--out', join(paths.project, 'report'));
  assert.notEqual(direct.status, 0);
  await assert.rejects(access(join(paths.project, 'report')));
  const alias = join(paths.root, 'alias');
  try {
    await symlink(paths.project, alias, 'junction');
    assert.notEqual(run('report', mapPath, '--bundle', paths.bundle, '--out', join(alias, 'report')).status, 0);
  } catch (error) { if (error.code !== 'EPERM') throw error; }
  await rm(paths.project, { recursive: true });
  assert.equal(run('report', mapPath, '--bundle', paths.bundle, '--out', join(paths.root, 'portable-report')).status, 0);
});
