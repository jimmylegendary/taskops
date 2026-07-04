#!/usr/bin/env node
// Regression: --verify-checks must compose with the PARALLEL orchestrator (runQueueWatch), not only the
// serial `run` loop. Each spawned worker runs `taskops run --target-task-id ... --verify-checks`, so a
// parallel sweep is verify-grounded and honest-monotone: a task whose real check passes is verified-done, a
// task whose real check fails is rejected+blocked — even through the worker-pool path.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmBlock, parseMarkdownFile } from '../lib-taskops.js';
import { syncQueueProjection } from '../lib-queue.js';
import { runQueueWatch } from '../lib-orchestrator.js';

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, '..', 'bin', 'taskops.js');
const now = '2026-06-26T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-orchverify-'));
const w = join(root, 'work');
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'ov', title: 'O', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
const task = (id, cmd, order) => md(`${tv}/tasks/${id}.md`, { taskOpsVersion: 'v1', entityType: 'task', id, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: id, objective: 'x', responsibility: 'own', completionCriteria: 'check', order, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'check', requiredChecks: [{ command: cmd }] } });
task('t-pass', 'exit 0', 1);
task('t-fail', 'exit 1', 2);
// t-retry: a check that fails once then passes — exercises --verify-retries THROUGH the parallel worker
// (the worker subprocess must receive --verify-retries and retry the task).
const marker = join(root, 'retry-marker');
task('t-retry', `test -f ${marker} || { touch ${marker}; exit 1; }`, 3);

syncQueueProjection(w);
const res = await runQueueWatch(w, {
  runtimeAdapter: 'dry-run', verifyChecks: true, continueOnFailure: true, verifyRetries: 2,
  maxParallel: 3, stopOnFailure: false,
  maxIdleCycles: 3, pollIntervalMs: 1, idleExitAfterSeconds: 0,
  cliPath, nodePath: process.execPath,
});

// The t-pass gate is DISCRIMINATING: without --verify-checks reaching the worker, a guarded requiredCheck
// task self-reports nothing and blocks; only a runner-executed passing check flips it to done.
const st = (id) => parseMarkdownFile(join(w, `${tv}/tasks/${id}.md`)).status;
assert.equal(st('t-pass'), 'done', 'parallel worker: a task whose real check PASSES under --verify-checks is verified-done');
assert.equal(st('t-fail'), 'blocked', 'parallel worker: a task whose real check FAILS is rejected+blocked (verify-grounded, not self-reported)');
assert.equal(st('t-retry'), 'done', 'parallel worker: --verify-retries composes with the parallel path (fail-then-pass retried to verified-done)');
assert.notEqual(res.stopReason, 'all_closed', 'the watch must not report all_closed while the failed task is blocked');

rmSync(root, { recursive: true, force: true });
console.log('OK orchestrator verify-checks (parallel path)');
