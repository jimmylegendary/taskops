#!/usr/bin/env node
// Regression: `run --continue-on-failure` (composed with --verify-checks) must ISOLATE a failed/rejected
// task as a surfaced blocked stall and KEEP making honest progress on independent runnable work, ending
// honestly (blocked_only surfaces the stall; never all_closed while a blocker remains). Without the flag the
// run halts on the first failure (default, preserved). This is the run-level honest-monotone property.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';

const now = '2026-06-26T00:00:00.000Z';

function buildWork(root, plan) {
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'cof', title: 'C', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  plan.forEach(([id, cmd], i) => md(`${tv}/tasks/${id}.md`, { taskOpsVersion: 'v1', entityType: 'task', id, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: id, objective: 'x', responsibility: 'own', completionCriteria: 'check passes', order: i + 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'check passes', requiredChecks: [{ command: cmd }] } }));
  return w;
}
const status = (w, id) => parseMarkdownFile(join(w, `task-groups/tg-root/versions/tgv-root-v1/tasks/${id}.md`)).status;

// p1 (check passes) -> FAIL (check fails) -> p2 (check passes). exit 0/1 avoid YAML boolean coercion.
const plan = [['p1', 'exit 0'], ['fail', 'exit 1'], ['p2', 'exit 0']];

// WITHOUT the flag: the run halts on the failure; p2 never runs (default behavior preserved).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-cof-off-'));
  const w = buildWork(root, plan);
  const res = runTaskOps(w, { executor: 'dry-run', maxSteps: 9, verifyChecks: true });
  assert.equal(res.stopReason, 'task_failed', 'default: run halts on the failed task');
  assert.equal(status(w, 'p2'), 'pending', 'default: independent work after the failure does not run');
  rmSync(root, { recursive: true, force: true });
}

// WITH --continue-on-failure: the failure is isolated (blocked), independent honest work completes, and the
// run ends honestly with blocked_only (NOT all_closed).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-cof-on-'));
  const w = buildWork(root, plan);
  const res = runTaskOps(w, { executor: 'dry-run', maxSteps: 9, verifyChecks: true, continueOnFailure: true });
  assert.equal(status(w, 'p1'), 'done', 'p1 (passing check) completes');
  assert.equal(status(w, 'p2'), 'done', 'p2 completes AFTER the failure (isolate-and-continue)');
  assert.equal(status(w, 'fail'), 'blocked', 'the failed task is surfaced as a blocked stall, not done');
  assert.equal(res.stopReason, 'blocked_only', 'the run ends honestly: blocked_only surfaces the stall');
  assert.notEqual(res.stopReason, 'all_closed', 'must NOT falsely report all_closed while a blocker remains');
  rmSync(root, { recursive: true, force: true });
}

console.log('OK continue-on-failure (honest-monotone run)');
