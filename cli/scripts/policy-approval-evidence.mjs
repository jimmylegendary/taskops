#!/usr/bin/env node
// Regression: policy-approval (which mints claimSafe=true) must require independently-checkable
// evidence, not the runner's own self-narration.
//  A2 — a policy-approving mode with only a prose expectedOutcome (no requiredChecks/artifacts/
//       semanticAssertions) must NOT be 'approved' (nothing to verify against a self-generated summary).
//  A4 — a requiredCheck whose self-reported checkResult has NO explicit pass status must NOT count as passed.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock } from '../lib-taskops.js';
import { reviewTarget } from '../lib-runner.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-policy-approval-'));
const now = '2026-06-24T00:00:00.000Z';
const md = (p, fm) => writeFileSync(p, `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');

function makeWork(name, { acceptance, result }) {
  const w = join(tempRoot, name);
  for (const d of ['task-groups/tg-root/versions/tgv-root-v1/tasks', 'task-groups/tg-root/versions/tgv-root-v1/eow', 'snapshots', 'runs/run-main/nodes', 'runs/run-main/edges']) mkdirSync(join(w, d), { recursive: true });
  md(join(w, 'index.md'), { taskOpsVersion: 'v1', entityType: 'work', id: name, title: name, objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md(join(w, 'task-groups/tg-root/index.md'), { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(join(w, 'task-groups/tg-root/versions/tgv-root-v1/index.md'), { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md(join(w, 'snapshots/snapshot-root-v1.md'), { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(join(w, 'task-groups/tg-root/versions/tgv-root-v1/tasks/task-review.md'), { taskOpsVersion: 'v1', entityType: 'task', id: 'task-review', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'T', objective: 'x', responsibility: 'own', completionCriteria: 'done', acceptance, order: 1, createdAt: now, status: 'done', runReadiness: 'runnable', understandingLevel: 'known', runRefs: [{ runId: 'run-main', runNodeId: 'run-node-review', role: 'primary_execution' }] });
  md(join(w, 'task-groups/tg-root/versions/tgv-root-v1/eow/eow-task-review.md'), { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-task-review', graphType: 'task', attachedToType: 'task', attachedToId: 'task-review', taskGroupVersionId: 'tgv-root-v1', reason: 'manual_close', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'done' });
  md(join(w, 'runs/run-main/index.md'), { taskOpsVersion: 'v1', entityType: 'run', id: 'run-main', workId: name, createdAt: now, status: 'active' });
  md(join(w, 'runs/run-main/nodes/run-node-review.md'), { taskOpsVersion: 'v1', entityType: 'runNode', id: 'run-node-review', runId: 'run-main', type: 'implementation', title: 'T', sourceTaskId: 'task-review', sourceTaskGroupVersionId: 'tgv-root-v1', status: 'done', createdAt: now, result });
  md(join(w, 'runs/run-main/nodes/eow-run-node-review.md'), { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-run-node-review', runId: 'run-main', graphType: 'run', attachedToType: 'runNode', attachedToId: 'run-node-review', reason: 'manual_close', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'done' });
  md(join(w, 'runs/run-main/edges/edge-review.md'), { taskOpsVersion: 'v1', entityType: 'runEdge', id: 'edge-review', runId: 'run-main', fromRunNodeId: 'run-node-review', toRunNodeId: 'eow-run-node-review', edgeType: 'closes_with', createdAt: now });
  return w;
}

// A2: policy-approving mode, prose expectedOutcome only, runner-generated summary → must NOT approve.
const a2 = reviewTarget(makeWork('a2-empty-rubric', {
  acceptance: { mode: 'enforced', expectedOutcome: 'The feature is complete.' },
  result: { executorSummary: 'Executor completed task.', observed: { outcomeSummary: 'Executor completed task.', artifactRefs: [], evidenceRefs: ['run:run-main/node:run-node-review'], checkResults: [] } },
}), 'task-review').reviewReport;
assert.notEqual(a2.decision, 'approved', 'A2: policy-approving mode with no checkable acceptance must not be approved');
assert.ok(a2.missingExpected.some((m) => m.includes('no machine-checkable signal')), 'A2: must flag the missing checkable signal');

// A4: requiredCheck matched but self-reported with NO status → must NOT count as passed.
const a4 = reviewTarget(makeWork('a4-no-status', {
  acceptance: { mode: 'runner-managed', expectedOutcome: 'tests pass', requiredChecks: ['npm test'] },
  result: { observed: { outcomeSummary: 'done', artifactRefs: [], evidenceRefs: [], checkResults: [{ command: 'npm test' }] } },
}), 'task-review').reviewReport;
assert.notEqual(a4.decision, 'approved', 'A4: a requiredCheck with no pass status must not be approved');
assert.ok(a4.failedChecks.some((f) => f.includes('npm test')), 'A4: must flag the unverified check');

// Positive control: a genuinely-passed requiredCheck still approves.
const ok = reviewTarget(makeWork('ok-passed', {
  acceptance: { mode: 'runner-managed', expectedOutcome: 'tests pass', requiredChecks: ['npm test'] },
  result: { observed: { outcomeSummary: 'done', artifactRefs: [], evidenceRefs: [], checkResults: [{ command: 'npm test', status: 'passed' }] } },
}), 'task-review').reviewReport;
assert.equal(ok.decision, 'approved', 'a satisfied requiredCheck must still approve');

rmSync(tempRoot, { recursive: true, force: true });
console.log('OK policy-approval evidence');
