#!/usr/bin/env node
// Regression: `run --verify-retries N` (test-time-scaling) gives a task another attempt with the check
// failure fed back, instead of a permanent block on the first verify failure — but ONLY under --verify-checks
// (a passing retry must be runner-verified, never self-report), bounded by the budget, and the retry state is
// cleared on success. A deterministic marker check (fails once, then passes) stands in for a model that fixes
// its work on the retry.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile, classifyTaskReadiness } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';

const now = '2026-06-26T00:00:00.000Z';
function build(root, cmd) {
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'vr', title: 'V', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/t.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 't', objective: 'x', responsibility: 'own', completionCriteria: 'check', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'check', requiredChecks: [{ command: cmd }] } });
  return w;
}
const readTask = (w) => parseMarkdownFile(join(w, 'task-groups/tg-root/versions/tgv-root-v1/tasks/t.md'));
const markerCmd = (m) => `test -f ${m} || { touch ${m}; exit 1; }`; // fails once, passes thereafter

// 1) with retries + verify-checks: first verify fails, the retry passes → verified-done, and retry state is CLEARED.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-vr-on-'));
  const workspaceStateFile = '.taskops-retry-workspace-state';
  const w = build(root, markerCmd(workspaceStateFile));
  const res = runTaskOps(w, { executor: 'dry-run', maxSteps: 6, verifyChecks: true, verifyRetries: 2, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'done', 'a retry converts the first-attempt stall into a verified completion');
  assert.ok(res.stepsRun >= 2, 'the task was executed more than once (retry consumed test-time)');
  const executeActions = res.actions.filter((action) => action.kind === 'execute');
  assert.ok(executeActions.length >= 2);
  assert.equal(new Set(executeActions.map((action) => action.runNodeId)).size, executeActions.length);
  const nodesDir = join(w, 'runs', res.runId, 'nodes');
  const executeNodes = executeActions.map((action) => parseMarkdownFile(join(nodesDir, `${action.runNodeId}.md`)));
  assert.deepEqual(executeNodes.map((node) => node.attempt), [1, 2]);
  assert.equal(executeNodes[1].predecessorRunNodeId, executeActions[0].runNodeId);
  const attemptWorkspaces = executeActions.map((action) => (
    join(w, 'runs', res.runId, 'artifacts', action.runNodeId, 'workspace')
  ));
  assert.notEqual(attemptWorkspaces[0], attemptWorkspaces[1]);
  assert.ok(existsSync(join(attemptWorkspaces[0], workspaceStateFile)), 'attempt 1 creates workspace-local repair state');
  assert.ok(existsSync(join(attemptWorkspaces[1], workspaceStateFile)), 'attempt 2 receives the predecessor workspace state');
  assert.deepEqual(
    executeNodes.map((node) => node.result.executionWorkspacePath),
    attemptWorkspaces,
    'each attempt records its own artifact workspace',
  );
  assert.deepEqual(
    executeNodes.map((node) => node.result.observed.evidenceRefs.includes(node.result.executionWorkspacePath)),
    [true, true],
    'each attempt records evidence against its independent workspace',
  );
  const reviewNodes = executeActions.map((action) => parseMarkdownFile(join(nodesDir, `review-${action.runNodeId}.md`)));
  assert.notEqual(reviewNodes[0].id, reviewNodes[1].id);
  assert.equal(reviewNodes[0].reviewReport.decision, 'rejected');
  assert.equal(reviewNodes[1].reviewReport.decision, 'approved');
  assert.equal(t.verifyAttempts, undefined, 'retry state is cleared once the task is honestly closed');
  assert.equal(t.lastCheckFailure, undefined, 'retry feedback is cleared on success');
  rmSync(root, { recursive: true, force: true });
}
// 2) without retries: the same first-attempt failure blocks permanently (default preserved).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-vr-off-'));
  const w = build(root, markerCmd(join(root, 'marker')));
  runTaskOps(w, { executor: 'dry-run', maxSteps: 6, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  assert.equal(readTask(w).status, 'blocked', 'without --verify-retries, a failed verify blocks on the first attempt');
  rmSync(root, { recursive: true, force: true });
}
// 3) HONESTY: retries are gated on --verify-checks. Without verify-checks a self-reported review must NOT be
// retried (that would just give the agent more attempts to self-report a pass). The task blocks, no retry.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-vr-noverify-'));
  const w = build(root, markerCmd(join(root, 'marker')));
  runTaskOps(w, { executor: 'dry-run', maxSteps: 6, verifyChecks: false, verifyRetries: 3, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'blocked', 'verify-retries without --verify-checks must not retry a self-reported review');
  assert.equal(t.verifyAttempts, undefined, 'no retry fired when verify-checks is off');
  rmSync(root, { recursive: true, force: true });
}
// 4) BUDGET: an always-failing check retries EXACTLY N times then blocks (bounded, no infinite loop).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-vr-budget-'));
  const w = build(root, 'exit 1');
  runTaskOps(w, { executor: 'dry-run', maxSteps: 20, verifyChecks: true, verifyRetries: 2, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'blocked', 'an always-failing check ends honestly blocked after the retry budget');
  assert.equal(Number(t.verifyAttempts), 2, 'retries are bounded by the budget (exactly N), no infinite loop');
  rmSync(root, { recursive: true, force: true });
}
// 5) RETRY STAYS ON THE EXECUTE PATH: a real executor often records a surpriseHistory entry, which flips
// classifyTaskReadiness onto the uncertainty path and (without an uncertaintyState) defaults to needs_exploration
// — so the retry would EXPLORE instead of re-execute. The retry reset stamps uncertaintyState='known' to prevent it.
{
  const post = { id: 't', objective: 'x', responsibility: 'own', completionCriteria: 'c', status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', surpriseHistory: [{ id: 's1', surpriseScore: 0.1, surpriseLevel: 'low' }] };
  assert.equal(classifyTaskReadiness(post).runReadiness, 'needs_exploration', 'baseline: a surpriseHistory entry alone flips a runnable task to exploration');
  assert.equal(classifyTaskReadiness({ ...post, uncertaintyState: 'known' }).runReadiness, 'runnable', 'the retry reset stamps uncertaintyState=known so a retried task RE-EXECUTES, not explores');
}

console.log('OK verify-retries (gated on verify-checks, bounded, state cleared, retry stays on execute path)');
