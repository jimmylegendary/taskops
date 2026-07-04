#!/usr/bin/env node
// Regression (payoff #2 training-data engine): extractTrainingData turns a run's HONEST signals into labeled
// trajectories. The money label test_time_scaling_gain fires only when a task FAILED its runner-verified check at
// least once and a retry (with the failure fed back) turned it into a VERIFIED completion. honest_completion is
// stamped only for runner-verified (verified_done) closures, never self-reported ones; honest stalls are labeled.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fmBlock } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';
import { extractTrainingData, summarizeTrainingData } from '../lib-trainingdata.js';

const now = '2026-07-04T00:00:00.000Z';
function build(root, tasks) {
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'td', title: 'TD', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  tasks.forEach((t, i) => md(`${tv}/tasks/${t.id}.md`, {
    taskOpsVersion: 'v1', entityType: 'task', id: t.id, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
    title: t.id, objective: t.id, responsibility: 'own', completionCriteria: 'c', order: i + 1, createdAt: now,
    status: 'pending', runReadiness: 'runnable', understandingLevel: 'known',
    acceptance: { mode: t.mode || 'guarded', expectedOutcome: 'c', requiredChecks: [{ command: t.cmd }] },
  }));
  return w;
}
const traj = (trajs, id) => trajs.find((t) => t.taskId === id);

// t-retry: fails once then passes (test-time-scaling). t-fail: always fails (honest stall).
const root = mkdtempSync(join(tmpdir(), 'taskops-td-'));
const marker = join(root, 'm');
const w = build(root, [
  { id: 't-retry', cmd: `test -f ${marker} || { touch ${marker}; exit 1; }` },
  { id: 't-fail', cmd: 'exit 1' },
  { id: 't-info-fail', cmd: 'exit 1', mode: 'informational' },  // check FAILS but informational -> stays done
  { id: 't-info-pass', cmd: 'exit 0', mode: 'informational' },  // check passes but informational = no policy
]);
runTaskOps(w, { executor: 'dry-run', maxSteps: 20, verifyChecks: true, verifyRetries: 2, continueOnFailure: true });

const trajs = extractTrainingData(w);
const retry = traj(trajs, 't-retry');
const fail = traj(trajs, 't-fail');

// LABEL-TRUST (self-review CRITICAL): an informational task whose runner-verified check FAILED still reaches
// status 'done' (informational is not reverted) and its review carries verified:true (the mode flag). It must NOT
// be labeled an honest completion — verifyGrounded requires an APPROVED review with a runner PASS, not the flag.
const infoFail = traj(trajs, 't-info-fail');
assert.equal(infoFail.reviewDecision, 'rejected', 'the runner-verified check really failed (review rejected)');
assert.notEqual(infoFail.outcome, 'verified_done', 'a runner-verified FAILED check is not a verified completion');
assert.equal(infoFail.labels.honest_completion, false, 'honest_completion is NOT minted from a runner-verified failure');
// an informational done is self-declared (no policy), so even a passing check is reported_done, not verified_done.
const infoPass = traj(trajs, 't-info-pass');
assert.notEqual(infoPass.outcome, 'verified_done', 'an informational (no-policy) done is never a verified completion');
assert.equal(infoPass.labels.honest_completion, false, 'informational done is not an honest completion');

// t-retry: a stall the model fixed with more test-time -> verified_done + the money label.
assert.equal(retry.outcome, 'verified_done', 't-retry ends a runner-verified completion');
assert.equal(retry.labels.honest_completion, true, 'verified_done is labeled an honest completion');
assert.equal(retry.labels.test_time_scaling_gain, true, 'a retry that converted a stall into a verified completion is the money label');
assert.equal(retry.signals.retries, 1, 'exactly one retry was needed');
assert.equal(retry.attempts, 2, 'attempts = 1 + retries');
assert.equal(retry.signals.verifyGrounded, true, 'the completion is runner-verified');
assert.ok(retry.signals.checkResults.some((c) => c.verifiedBy === 'runner' && c.status === 'passed'), 'the passing runner-executed check is captured');

// t-fail: an HONEST stall — never labeled a completion.
assert.equal(fail.outcome, 'honest_stall', 't-fail ends an honest stall (blocked), not a completion');
assert.equal(fail.labels.honest_completion, false, 'a stall is never labeled an honest completion');
assert.equal(fail.labels.test_time_scaling_gain, false, 'no test-time-scaling gain when the task never verified');
assert.equal(fail.labels.honest_stall, true, 'the stall is labeled');

// summary aggregates the honest signal.
const s = summarizeTrainingData(trajs);
assert.equal(s.verified_done, 1);
assert.equal(s.honest_stall, 1);
assert.equal(s.test_time_scaling_gains, 1);

// CLI: `taskops trainingdata` emits JSONL (one trajectory/line) and `--summary` the aggregate.
const bin = new URL('../bin/taskops.js', import.meta.url).pathname;
const jsonl = spawnSync(process.execPath, [bin, 'trainingdata', w], { encoding: 'utf8' });
assert.equal(jsonl.status, 0, 'trainingdata CLI exits 0');
const lines = jsonl.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
assert.equal(lines.length, 4, 'one JSONL record per task');
assert.ok(lines.find((r) => r.taskId === 't-retry').labels.test_time_scaling_gain, 'CLI JSONL carries the labels');
const sumOut = spawnSync(process.execPath, [bin, 'trainingdata', w, '--summary'], { encoding: 'utf8' });
assert.equal(JSON.parse(sumOut.stdout).test_time_scaling_gains, 1, 'CLI --summary aggregates');

rmSync(root, { recursive: true, force: true });
console.log('OK training-data (verify-grounded labels + JSONL/summary CLI)');
