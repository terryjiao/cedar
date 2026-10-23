import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Resolve existing ancestors so a not-yet-created output cannot hide behind a junction. */
export async function canonicalFuturePath(input: string): Promise<string> {
  let current = resolve(input);
  const missing: string[] = [];
  for (;;) {
    try { return join(await realpath(current), ...missing.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(current) === current) throw error;
      missing.push(basename(current));
      current = dirname(current);
    }
  }
}
