import { createHash } from 'node:crypto';
import type { SourceSnapshot } from './types.js';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sourceId(path: string): string {
  return `source-${sha256(path).slice(0, 16)}`;
}

export function bundleIdentity(sources: Pick<SourceSnapshot, 'path' | 'sha256'>[]): string {
  const entries = sources.map(s => [s.path, s.sha256]).sort((a, b) => a[0]!.localeCompare(b[0]!, 'en'));
  return sha256(JSON.stringify(entries));
}
