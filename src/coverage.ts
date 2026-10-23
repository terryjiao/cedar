import { z } from 'zod';
import { bundleIdentity, sha256, sourceId } from './integrity.js';
import type { SourceBundle } from './types.js';

const text = z.string().trim().min(1);
export const evidenceSchema = z.object({
  sourceId: text, startLine: z.number().int().positive(), endLine: z.number().int().positive(), quote: text
}).strict();

export const coverageSchema = z.object({
  schemaVersion: z.literal(1), bundleId: text, projectName: text, summary: text,
  tasks: z.array(z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), title: text, userGoal: text,
    basis: z.enum(['documented', 'inferred']), evidence: z.array(evidenceSchema).min(1),
    conditions: z.array(text).min(1), deliverables: z.array(text).min(1),
    checks: z.array(z.object({
      description: text, method: z.enum(['deterministic', 'semantic', 'human']),
      basis: z.enum(['existing', 'proposed']), evidence: z.array(evidenceSchema)
    }).strict()).min(1),
    execution: z.object({
      status: z.enum(['candidate', 'needs-inputs', 'needs-oracle', 'needs-adapter']), blockers: z.array(text)
    }).strict(), questions: z.array(text)
  }).strict()),
  exclusions: z.array(text), questions: z.array(text)
}).strict();
export type CoverageMap = z.infer<typeof coverageSchema>;

const sourceSchema = z.object({
  id: text, path: z.string().min(1), kind: z.enum(['documentation', 'configuration', 'test', 'implementation']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative(), lineCount: z.number().int().positive(), content: z.string()
}).strict();
const bundleSchema = z.object({
  schemaVersion: z.literal(1), bundleId: text, projectName: text, root: z.string().min(1), createdAt: text,
  git: z.object({ commit: z.string().nullable(), dirty: z.boolean().nullable() }).nullable(),
  scope: z.object({
    discovery: z.enum(['git', 'directory']), selection: z.enum(['automatic', 'explicit']),
    inventoryCount: z.number().int().nonnegative(), maxFiles: z.number().int().positive(),
    maxTotalBytes: z.number().int().positive(), maxFileBytes: z.number().int().positive()
  }).strict(), sources: z.array(sourceSchema), omitted: z.array(z.object({ path: text, reason: text }).strict())
}).strict();

/** Verify capture integrity before using a bundle as evidence. This is not an authenticity signature. */
export function validateBundle(input: unknown): SourceBundle {
  const bundle = bundleSchema.parse(input);
  const paths = new Set<string>();
  for (const source of bundle.sources) {
    if (paths.has(source.path)) throw new Error(`Duplicate source path: ${source.path}`);
    paths.add(source.path);
    if (source.id !== sourceId(source.path) || sha256(source.content) !== source.sha256
      || Buffer.byteLength(source.content) !== source.bytes || source.content.split('\n').length !== source.lineCount) {
      throw new Error(`Source integrity/hash mismatch: ${source.path}`);
    }
  }
  if (bundle.bundleId !== bundleIdentity(bundle.sources)) throw new Error('Source bundle integrity mismatch.');
  return bundle;
}

/** Check references mechanically; whether the quotation supports an inference still needs review. */
export function validateCoverage(input: unknown, sourceBundle: SourceBundle): CoverageMap {
  const bundle = validateBundle(sourceBundle);
  const map = coverageSchema.parse(input);
  if (map.bundleId !== bundle.bundleId) throw new Error('Coverage map belongs to a different source bundle.');
  const sources = new Map(bundle.sources.map(s => [s.id, s]));
  const ids = new Set<string>();
  function checkEvidence(evidence: z.infer<typeof evidenceSchema>, taskId: string): void {
    const source = sources.get(evidence.sourceId);
    if (!source) throw new Error(`${taskId}: unknown evidence source ${evidence.sourceId}`);
    if (evidence.startLine > evidence.endLine || evidence.endLine > source.lineCount) throw new Error(`${taskId}: evidence line range is outside ${source.path}`);
    const excerpt = source.content.split('\n').slice(evidence.startLine - 1, evidence.endLine).join('\n').replaceAll('\r\n', '\n');
    if (!excerpt.includes(evidence.quote.replaceAll('\r\n', '\n'))) throw new Error(`${taskId}: evidence quote does not match ${source.path}:${evidence.startLine}`);
  }
  for (const task of map.tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
    task.evidence.forEach(e => checkEvidence(e, task.id));
    for (const check of task.checks) {
      if (check.basis === 'existing' && check.evidence.length === 0) throw new Error(`${task.id}: existing checks require evidence.`);
      check.evidence.forEach(e => checkEvidence(e, task.id));
    }
    if (task.execution.status === 'candidate' && task.execution.blockers.length > 0) throw new Error(`${task.id}: candidate task still has execution blockers.`);
    if (task.execution.status !== 'candidate' && task.execution.blockers.length === 0) throw new Error(`${task.id}: describe at least one execution blocker.`);
  }
  return map;
}
