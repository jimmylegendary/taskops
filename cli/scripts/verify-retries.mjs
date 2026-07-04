#!/usr/bin/env node
// Regression: `run --verify-retries N` (test-time-scaling) gives a task another attempt with the check
// failure fed back, instead of a permanent block on the first verify failure. More test-time can convert a
// stall into an honest verified completion; the retry budget is bounded. A deterministic marker check
// (fails once, then passes) stands in for a model that fixes its work on the retry.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';

const now = '2026-06-26T00:00:00.000Z';

function build(root, marker) {
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'vr', title: 'V', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  // check FAILS the first time (creates the marker + exit 1), PASSES thereafter (marker exists + exit 0).
  const cmd = `test -f ${marker} || { touch ${marker}; exit 1; }`;
  md(`${tv}/tasks/t.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 't', objective: 'x', responsibility: 'own', completionCriteria: 'check', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'check', requiredChecks: [{ command: cmd }] } });
  return w;
}
const readTask = (w) => parseMarkdownFile(join(w, 'task-groups/tg-root/versions/tgv-root-v1/tasks/t.md'));

// with retries: the first verify fails, the retry passes → the task is honestly verified-done.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-vr-on-'));
  const w = build(root, join(root, 'marker'));
  const res = runTaskOps(w, { executor: 'dry-run', maxSteps: 6, verifyChecks: true, verifyRetries: 2, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'done', 'test-time-scaling: a retry converts the first-attempt stall into a verified completion');
  assert.ok(Number(t.verifyAttempts) >= 1, 'the retry attempt is recorded on the task');
  assert.ok(res.stepsRun >= 2, 'the task was executed more than once (retry consumed test-time)');
  rmSync(root, { recursive: true, force: true });
}

// without retries: the same first-attempt failure blocks permanently (default, preserved).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-vr-off-'));
  const w = build(root, join(root, 'marker'));
  runTaskOps(w, { executor: 'dry-run', maxSteps: 6, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  assert.equal(readTask(w).status, 'blocked', 'without --verify-retries, a failed verify blocks on the first attempt');
  rmSync(root, { recursive: true, force: true });
}

console.log('OK verify-retries (test-time-scaling)');
