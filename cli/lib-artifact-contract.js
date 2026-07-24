import { readFileSync, statSync } from 'node:fs';

export function inspectNonEmptyUtf8File(filePath, { label = 'artifact' } = {}) {
  const artifactPath = filePath == null ? null : String(filePath);
  if (!artifactPath) {
    return { ok: false, artifactPath, message: `Missing ${label} path.` };
  }
  let stat;
  try {
    stat = statSync(artifactPath);
  } catch {
    return { ok: false, artifactPath, message: `Missing ${label} at ${artifactPath}.` };
  }
  if (!stat.isFile()) {
    return { ok: false, artifactPath, message: `${label} must be a regular file: ${artifactPath}.` };
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(artifactPath));
  } catch {
    return { ok: false, artifactPath, message: `${label} is not valid UTF-8: ${artifactPath}.` };
  }
  if (text.trim().length === 0) {
    return { ok: false, artifactPath, message: `${label} is empty: ${artifactPath}.` };
  }
  return { ok: true, artifactPath, text };
}
