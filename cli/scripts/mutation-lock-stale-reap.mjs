#!/usr/bin/env node
// Regression (ultrareview D3, end-to-end reap): a mutation lock whose OWNER is dead (or whose lease has expired)
// must be treated as INACTIVE so a fresh run is not blocked forever by a crashed worker's lock — while a lock held
// by a live owner with a live lease stays active. This exercises isMutationLockActive over real on-disk meta,
// closing the "unit-only" gap (the prior tests covered isMutationLockOwnerAlive in isolation).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mutationLockDir, isMutationLockActive, processStartTime } from '../lib-mutation-lock.js';

const projectDir = mkdtempSync(join(tmpdir(), 'taskops-lock-'));
const lockDir = mutationLockDir(projectDir);
const future = '2099-01-01T00:00:00.000Z';
const past = '2000-01-01T00:00:00.000Z';
const writeMeta = (meta) => { mkdirSync(lockDir, { recursive: true }); writeFileSync(join(lockDir, 'meta.json'), JSON.stringify(meta), 'utf8'); };

// 1) DEAD owner + live lease -> stale -> inactive (reapable): a crashed worker's lock does not block a new run.
writeMeta({ pid: 2147480000, pidStartTime: '123', expiresAt: future, nonce: 'x' });
assert.equal(isMutationLockActive(projectDir), false, 'a lock owned by a dead pid is stale (inactive) even with a live lease');

// 2) LIVE owner + live lease -> active: a genuinely-held lock is respected.
writeMeta({ pid: process.pid, pidStartTime: processStartTime(process.pid), expiresAt: future, nonce: 'y' });
assert.equal(isMutationLockActive(projectDir), true, 'a lock held by a live owner with a live lease is active');

// 3) LIVE owner + EXPIRED lease -> inactive: an abandoned lease is reaped even if the pid still happens to live.
writeMeta({ pid: process.pid, pidStartTime: processStartTime(process.pid), expiresAt: past, nonce: 'z' });
assert.equal(isMutationLockActive(projectDir), false, 'an expired lease is inactive (reapable) regardless of pid liveness');

// 4) ignorePid: our own lock never blocks us.
writeMeta({ pid: process.pid, pidStartTime: processStartTime(process.pid), expiresAt: future, nonce: 'w' });
assert.equal(isMutationLockActive(projectDir, { ignorePid: process.pid }), false, 'a lock is not active against its own owner (ignorePid)');

rmSync(projectDir, { recursive: true, force: true });
console.log('OK mutation-lock stale reap (dead owner / expired lease -> inactive; live -> active)');
