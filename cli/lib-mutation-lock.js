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

// D3: process start-time disambiguates a reused PID. On Linux, field 22 of /proc/<pid>/stat is the
// process start-time (clock ticks since boot); two different processes that happen to share a pid will
// have different start-times. Returns null where unavailable (non-Linux) so callers degrade to pid-only.
export function processStartTime(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    const stat = readFileSync(`/proc/${n}/stat`, 'utf8');
    // The comm field (2nd) may contain spaces/parens, so parse after the last ')'.
    const rparen = stat.lastIndexOf(')');
    if (rparen === -1) return null;
    const fields = stat.slice(rparen + 2).trim().split(/\s+/);
    // fields[0] is state (stat field 3); starttime is stat field 22 => index 19 here.
    const starttime = fields[19];
    return starttime != null && /^\d+$/.test(starttime) ? starttime : null;
  } catch {
    return null;
  }
}

// D3: a lock owner is alive only if the pid is alive AND (when a start-time was recorded) the current
// process at that pid has the SAME start-time — otherwise the pid was reused after the owner crashed.
export function isMutationLockOwnerAlive(meta) {
  const pid = Number(meta?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (!isProcessAlive(pid)) return false;
  if (meta.pidStartTime != null) {
    const current = processStartTime(pid);
    if (current != null && String(current) !== String(meta.pidStartTime)) return false;
  }
  return true;
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
  return hasLiveExpiry && isMutationLockOwnerAlive(meta);
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
