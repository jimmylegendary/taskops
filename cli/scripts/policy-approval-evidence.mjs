#!/usr/bin/env node
// Regression: policy-approval (which mints claimSafe=true) must require independently-checkable
// evidence, not the runner's own self-narration.
//  A2 — a policy-approving mode with only a prose expectedOutcome (no requiredChecks/artifacts/
//       semanticAssertions) must NOT be 'approved' (nothing to verify against a self-generated summary).
//  A4 — a requiredCheck whose self-reported checkResult has NO explicit pass status must NOT count as passed.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseProject } from '../lib-taskops.js';
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
  md(join(w, 'task-groups/tg-root/versions/tgv-root-v1/eow/eow-task-review.md'), { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-task-review', graphType: 'task', attachedToType: 'task', attachedToId: 'task-review', taskGroupVersionId: 'tgv-root-v1', reason: 'execution_path_closed', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'done' });
  md(join(w, 'runs/run-main/index.md'), { taskOpsVersion: 'v1', entityType: 'run', id: 'run-main', workId: name, createdAt: now, status: 'active' });
  md(join(w, 'runs/run-main/nodes/run-node-review.md'), { taskOpsVersion: 'v1', entityType: 'runNode', id: 'run-node-review', runId: 'run-main', type: 'implementation', title: 'T', sourceTaskId: 'task-review', sourceTaskGroupVersionId: 'tgv-root-v1', status: 'done', createdAt: now, result });
  md(join(w, 'runs/run-main/nodes/eow-run-node-review.md'), { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-run-node-review', runId: 'run-main', graphType: 'run', attachedToType: 'runNode', attachedToId: 'run-node-review', reason: 'execution_path_closed', closureRole: 'claim-bearing', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'done' });
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

const tamperSource = makeWork('tamper-source', {
  acceptance: { mode: 'runner-managed', expectedOutcome: 'tests pass', requiredChecks: ['npm test'] },
  result: { observed: { outcomeSummary: 'done', artifactRefs: [], evidenceRefs: [], checkResults: [{ command: 'npm test', status: 'passed' }] } },
});
const tamperReview = reviewTarget(tamperSource, 'task-review');
assert.equal(parseProject(tamperSource).closure.policyApprovedComplete, true);

const missingReviewDir = join(tempRoot, 'missing-review');
cpSync(tamperSource, missingReviewDir, { recursive: true });
rmSync(join(missingReviewDir, 'runs/run-main/nodes', `${tamperReview.reviewNodeId}.md`));

const wrongTargetDir = join(tempRoot, 'wrong-target');
cpSync(tamperSource, wrongTargetDir, { recursive: true });
const wrongTargetReviewPath = join(wrongTargetDir, 'runs/run-main/nodes', `${tamperReview.reviewNodeId}.md`);
writeFileSync(
  wrongTargetReviewPath,
  readFileSync(wrongTargetReviewPath, 'utf8').replace(
    'reviewsRunNodeId: run-node-review',
    'reviewsRunNodeId: run-node-other',
  ),
  'utf8',
);

const reportHashMismatchDir = join(tempRoot, 'report-hash-mismatch');
cpSync(tamperSource, reportHashMismatchDir, { recursive: true });
const reportHashReviewPath = join(reportHashMismatchDir, 'runs/run-main/nodes', `${tamperReview.reviewNodeId}.md`);
writeFileSync(
  reportHashReviewPath,
  readFileSync(reportHashReviewPath, 'utf8').replace(
    tamperReview.reviewReportHash,
    'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  ),
  'utf8',
);

const resultHashMismatchDir = join(tempRoot, 'result-hash-mismatch');
cpSync(tamperSource, resultHashMismatchDir, { recursive: true });
const resultHashRunEowPath = join(resultHashMismatchDir, 'runs/run-main/nodes/eow-run-node-review.md');
writeFileSync(
  resultHashRunEowPath,
  readFileSync(resultHashRunEowPath, 'utf8').replace(
    /^reviewedResultHash: .*$/m,
    'reviewedResultHash: sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  ),
  'utf8',
);

const liveResultTamperDir = join(tempRoot, 'live-result-tamper');
cpSync(tamperSource, liveResultTamperDir, { recursive: true });
const liveResultNodePath = join(liveResultTamperDir, 'runs/run-main/nodes/run-node-review.md');
const liveResultBefore = readFileSync(liveResultNodePath, 'utf8');
const liveResultAfter = liveResultBefore.replace(
  '        status: passed',
  '        status: failed',
);
assert.notEqual(liveResultAfter, liveResultBefore, 'live result tamper fixture must change node.result');
writeFileSync(liveResultNodePath, liveResultAfter, 'utf8');

const liveAcceptanceTamperDir = join(tempRoot, 'live-acceptance-tamper');
cpSync(tamperSource, liveAcceptanceTamperDir, { recursive: true });
const liveAcceptanceTaskPath = join(
  liveAcceptanceTamperDir,
  'task-groups/tg-root/versions/tgv-root-v1/tasks/task-review.md',
);
const liveAcceptanceBefore = readFileSync(liveAcceptanceTaskPath, 'utf8');
const liveAcceptanceAfter = liveAcceptanceBefore.replace(
  '    - npm test',
  '    - npm test --tampered',
);
assert.notEqual(liveAcceptanceAfter, liveAcceptanceBefore, 'live acceptance tamper fixture must change task.acceptance');
writeFileSync(liveAcceptanceTaskPath, liveAcceptanceAfter, 'utf8');

assert.equal(parseProject(missingReviewDir).closure.policyApprovedComplete, false);
assert.equal(parseProject(wrongTargetDir).closure.policyApprovedComplete, false);
assert.equal(parseProject(reportHashMismatchDir).closure.policyApprovedComplete, false);
assert.equal(parseProject(resultHashMismatchDir).closure.policyApprovedComplete, false);
assert.equal(
  parseProject(liveAcceptanceTamperDir).closure.policyApprovedComplete,
  false,
  'mutating the current task acceptance must invalidate prior approval',
);
assert.equal(
  parseProject(liveResultTamperDir).closure.policyApprovedComplete,
  false,
  'mutating the current implementation result must invalidate prior approval',
);

rmSync(tempRoot, { recursive: true, force: true });
console.log('OK policy-approval evidence');
