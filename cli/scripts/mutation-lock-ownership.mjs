#!/usr/bin/env node
// Regression: the mutation-lock release closure must be OWNERSHIP-checked.
// Before the fix, release() deleted the lock dir unconditionally, so a release that
// ran after a TTL overrun (once another owner had reaped + re-acquired the lock)
// would wipe the NEW owner's lock and let two decomposes mutate canonical state.
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireMutationLock, MUTATION_LOCK_DIR } from '../lib-runner.js';

const dir = mkdtempSync(join(tmpdir(), 'taskops-mutlock-'));
const lockDir = join(dir, MUTATION_LOCK_DIR);
const metaPath = join(lockDir, 'meta.json');

// 1) acquire → lock exists and carries a nonce + our pid
const release = acquireMutationLock({ projectDir: dir, action: 'test', stepTimeoutMs: 60_000 });
assert.equal(existsSync(lockDir), true, 'lock dir should exist after acquire');
const mine = JSON.parse(readFileSync(metaPath, 'utf8'));
assert.equal(typeof mine.nonce, 'string', 'lock meta must carry a nonce');
assert.equal(mine.pid, process.pid, 'lock meta must record our pid');

// 2) simulate another owner having reaped + re-acquired: meta now has a DIFFERENT nonce.
//    Our stale release() must NOT delete that lock.
writeFileSync(metaPath, `${JSON.stringify({ ...mine, nonce: 'someone-elses-nonce' }, null, 2)}\n`, 'utf8');
release();
assert.equal(existsSync(lockDir), true, 'ownership-checked release must NOT delete a re-acquired lock');

// 3) positive control: a normal acquire → release deletes only its own lock
rmSync(lockDir, { recursive: true, force: true });
const release2 = acquireMutationLock({ projectDir: dir, action: 'test', stepTimeoutMs: 60_000 });
assert.equal(existsSync(lockDir), true, 'lock re-acquired');
release2();
assert.equal(existsSync(lockDir), false, 'normal release deletes its own lock');

rmSync(dir, { recursive: true, force: true });
console.log('OK mutation-lock ownership release');
