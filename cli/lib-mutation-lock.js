import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MUTATION_LOCK_DIR = '.taskops-canonical-mutation.lock';
export const DEFAULT_MUTATION_LOCK_READER_WAIT_MS = 10 * 60_000;
export const MUTATION_LOCK_READER_POLL_MS = 25;

function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, Math.floor(ms));
}

export function mutationLockDir(projectDir) {
  return join(projectDir, MUTATION_LOCK_DIR);
}

export function isProcessAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'EPERM') return true;
    return false;
  }
}

export function readMutationLockMeta(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function isMutationLockActive(projectDir, { nowMs = Date.now(), ignorePid = null } = {}) {
  const lockDir = mutationLockDir(projectDir);
  if (!existsSync(lockDir)) return false;
  const meta = readMutationLockMeta(lockDir);
  if (!meta) return false;
  const pid = Number(meta.pid);
  if (ignorePid != null && Number(ignorePid) === pid) return false;
  const expiresAtMs = Date.parse(String(meta.expiresAt || ''));
  const hasLiveExpiry = Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
  const ownerAlive = Number.isInteger(pid) && pid > 0 && isProcessAlive(pid);
  return hasLiveExpiry && ownerAlive;
}

export function waitForMutationLockClear(projectDir, {
  ignorePid = null,
  deadlineMs = Date.now() + DEFAULT_MUTATION_LOCK_READER_WAIT_MS,
} = {}) {
  let waited = false;
  while (isMutationLockActive(projectDir, { ignorePid })) {
    const nowMs = Date.now();
    if (nowMs >= deadlineMs) {
      return { cleared: false, waited };
    }
    waited = true;
    sleepMs(Math.min(MUTATION_LOCK_READER_POLL_MS, Math.max(1, deadlineMs - nowMs)));
  }
  return { cleared: true, waited };
}
