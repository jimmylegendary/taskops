import { lstatSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';

export function assertPortablePathComponent(value, label = 'path') {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || value === '.'
    || value === '..'
    || basename(value) !== value
    || win32.basename(value) !== value
  ) {
    throw new Error(`Unsafe ${label} path component`);
  }
  return value;
}

function lstatIfAddressable(path) {
  try {
    return lstatSync(path, { throwIfNoEntry: false });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENAMETOOLONG') {
      return null;
    }
    throw error;
  }
}

export function resolveContainedPath(root, ...parts) {
  const containedRoot = resolve(root);
  const candidate = resolve(containedRoot, ...parts);
  const rel = relative(containedRoot, candidate);
  if (
    isAbsolute(rel)
    || rel === '..'
    || rel.startsWith(`..${sep}`)
  ) {
    throw new Error(`Unsafe derived path escapes '${containedRoot}'`);
  }
  const parent = candidate === containedRoot
    ? containedRoot
    : dirname(candidate);
  const parentRel = relative(containedRoot, parent);
  const segments = parentRel === ''
    ? []
    : parentRel.split(sep);
  let current = containedRoot;
  for (const segment of ['', ...segments]) {
    if (segment) current = join(current, segment);
    const stat = lstatIfAddressable(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Unsafe derived path traverses symbolic link '${current}'`,
      );
    }
  }
  const targetStat = lstatIfAddressable(candidate);
  if (targetStat?.isSymbolicLink()) {
    throw new Error(
      `Unsafe derived path targets symbolic link '${candidate}'`,
    );
  }
  return candidate;
}
