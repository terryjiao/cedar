import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectProject } from '../dist/src/collect.js';
import { validateCoverage, validateBundle } from '../dist/src/coverage.js';

export async function sample(t) {
  const root = await mkdtemp(join(tmpdir(), 'cedar-map-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'README.md'), 'Read documents.\nKeep conflicting facts explicit.\n');
  const bundle = await collectProject(root);
  const source = bundle.sources[0];
  const evidence = { sourceId: source.id, startLine: 1, endLine: 1, quote: 'Read documents.' };
  const map = {
    schemaVersion: 1, bundleId: bundle.bundleId, projectName: 'Document Agent',
    summary: 'Proposed behavior experiments, not measured coverage.',
    tasks: [{
      id: 'read-documents', title: 'Review documents', userGoal: 'Produce an evidence-backed summary.',
      basis: 'documented', evidence: [evidence], conditions: ['Complete inputs', 'Conflicting facts'],
      deliverables: ['Summary'],
      checks: [{ description: 'Keep conflicting facts explicit.', method: 'semantic', basis: 'proposed', evidence: [] }],
      execution: { status: 'needs-adapter', blockers: ['Runtime fidelity has not been verified.'] },
      questions: ['Who confirms the summary quality?']
    }],
    exclusions: ['Desktop interaction has not been assessed.'], questions: []
  };
  return { root, bundle, map };
}

test('accepts a map linked to actual source evidence', async t => {
  const { bundle, map } = await sample(t);
  assert.equal(validateCoverage(map, bundle).tasks[0].id, 'read-documents');
});

test('rejects unsupported source claims and invalid line ranges', async t => {
  const { bundle, map } = await sample(t);
  for (const change of [{ sourceId: 'unknown' }, { quote: 'A promise never made' }, { endLine: 999 }, { startLine: 2, endLine: 1 }]) {
    const invalid = structuredClone(map);
    Object.assign(invalid.tasks[0].evidence[0], change);
    assert.throws(() => validateCoverage(invalid, bundle));
  }
});

test('rejects another source bundle and duplicate task ids', async t => {
  const { bundle, map } = await sample(t);
  assert.throws(() => validateCoverage({ ...map, bundleId: 'different' }, bundle), /bundle/i);
  assert.throws(() => validateCoverage({ ...map, tasks: [...map.tasks, map.tasks[0]] }, bundle), /duplicate/i);
});

test('existing checks require evidence, and candidate tasks cannot hide blockers', async t => {
  const { bundle, map } = await sample(t);
  const invalid = structuredClone(map);
  invalid.tasks[0].checks[0].basis = 'existing';
  assert.throws(() => validateCoverage(invalid, bundle), /evidence/i);
  const contradictory = structuredClone(map);
  contradictory.tasks[0].execution.status = 'candidate';
  assert.throws(() => validateCoverage(contradictory, bundle), /blocker/i);
});

test('rejects corrupted source snapshots rather than validating invented quotes', async t => {
  const { bundle, map } = await sample(t);
  bundle.sources[0].content = 'Read documents.\nAltered source.';
  assert.throws(() => validateCoverage(map, bundle), /hash|integrity/i);
});

test('source paths preserve legal leading spaces through capture and validation', async t => {
  const { root } = await sample(t);
  await writeFile(join(root, ' README.md'), 'A separate file.');
  const bundle = await collectProject(root, { include: [' README.md'] });
  assert.equal(validateBundle(bundle).sources[0].path, ' README.md');
});
