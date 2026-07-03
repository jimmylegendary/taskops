#!/usr/bin/env node
// Regression (ultrareview D3): mutation-lock liveness must not be fooled by PID reuse. After an owner
// crashes and the OS reuses its pid for an unrelated process, the stale lock must NOT look live (which
// previously blocked readers ~10 min then threw, turning a completed task's sync into a false failure).
// A recorded process start-time disambiguates the reused pid.
import assert from 'node:assert/strict';
import { processStartTime, isMutationLockOwnerAlive } from '../lib-mutation-lock.js';

const st = processStartTime(process.pid);

// same pid + matching start-time => the real owner is alive.
assert.equal(isMutationLockOwnerAlive({ pid: process.pid, pidStartTime: st }), true, 'the original owner (matching start-time) is alive');

// no recorded start-time => degrade to pid-only liveness (backward compatible).
assert.equal(isMutationLockOwnerAlive({ pid: process.pid }), true, 'without start-time, falls back to pid liveness');

// a dead pid => not alive regardless.
assert.equal(isMutationLockOwnerAlive({ pid: 2147480000, pidStartTime: '123' }), false, 'a dead pid is not a live owner');

if (st != null) {
  // same pid + MISMATCHED start-time (== pid reuse after a crash) => NOT the original owner => reapable.
  assert.equal(
    isMutationLockOwnerAlive({ pid: process.pid, pidStartTime: `${st}000000` }),
    false,
    'D3: a reused pid (different start-time) is not the original lock owner',
  );
} else {
  console.log('(process start-time unavailable on this platform; pid-reuse guard degrades to pid-only)');
}

console.log('OK mutation-lock pid-reuse liveness (D3)');
