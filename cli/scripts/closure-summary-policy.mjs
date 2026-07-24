#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalSha256 } from '../lib-run-closure.js';
import { fmBlock, parseProject, summarizeProject } from '../lib-taskops.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-closure-policy-'));
const now = '2026-06-24T00:00:00.000Z';

function writeMd(path, fm, body = '') {
  writeFileSync(path, fmBlock(fm) + (body || `# ${fm.id}\n`), 'utf8');
}

function ensureDirs(workDir) {
  for (const dir of [
    'task-groups/tg-root/versions/tgv-root-v1/tasks',
    'task-groups/tg-root/versions/tgv-root-v1/eow',
    'snapshots',
    'runs/run-main/nodes',
    'runs/run-main/edges',
  ]) {
    mkdirSync(join(workDir, dir), { recursive: true });
  }
}

function makeClosedWork(name, { workStatus = 'done', taskEow = {}, runEow = {}, reviewReport = null } = {}) {
  const workDir = join(tempRoot, name);
  ensureDirs(workDir);
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id: name,
    title: name,
    objective: 'Exercise closure summary policy state.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v1',
    createdAt: now,
    status: workStatus,
  });
  writeMd(join(workDir, 'task-groups/tg-root/index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Root task group.',
    activeVersionId: 'tgv-root-v1',
    createdAt: now,
    status: 'done',
  });
  writeMd(join(workDir, 'task-groups/tg-root/versions/tgv-root-v1/index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    version: 'v1',
    summary: 'Closure policy fixture.',
    selected: true,
    createdAt: now,
    status: 'done',
  });
  writeMd(join(workDir, 'snapshots/snapshot-root-v1.md'), {
    taskOpsVersion: 'v1',
    entityType: 'versionSnapshot',
    id: 'snapshot-root-v1',
    rootTaskGroupId: 'tg-root',
    createdAt: now,
    label: 'Root',
    status: 'active',
    selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }],
  });
  writeMd(join(workDir, 'task-groups/tg-root/versions/tgv-root-v1/tasks/task-one.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task-one',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'One closed task',
    objective: 'Finish one task.',
    responsibility: 'Own the fixture task.',
    completionCriteria: 'The task has an EoW node.',
    order: 1,
    createdAt: now,
    status: 'done',
    runReadiness: 'runnable',
    understandingLevel: 'known',
    runRefs: [{ runId: 'run-main', runNodeId: 'run-node-one', role: 'primary_execution' }],
  });
  writeMd(join(workDir, 'task-groups/tg-root/versions/tgv-root-v1/eow/eow-task-one.md'), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: 'eow-task-one',
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: 'task-one',
    taskGroupVersionId: 'tgv-root-v1',
    reason: 'execution_path_closed',
    declaredBy: 'test',
    declaredAt: now,
    createdAt: now,
    status: 'done',
    ...taskEow,
  });
  writeMd(join(workDir, 'runs/run-main/index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'run',
    id: 'run-main',
    workId: name,
    createdAt: now,
    status: 'done',
  });
  writeMd(join(workDir, 'runs/run-main/nodes/run-node-one.md'), {
    taskOpsVersion: 'v1',
    entityType: 'runNode',
    id: 'run-node-one',
    runId: 'run-main',
    type: 'implementation',
    title: 'Run node one',
    sourceTaskId: 'task-one',
    sourceTaskGroupVersionId: 'tgv-root-v1',
    status: 'done',
    createdAt: now,
    actionKind: 'execute',
  });
  writeMd(join(workDir, 'runs/run-main/nodes/eow-run-node-one.md'), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: 'eow-run-node-one',
    runId: 'run-main',
    graphType: 'run',
    attachedToType: 'runNode',
    attachedToId: 'run-node-one',
    reason: 'execution_path_closed',
    declaredBy: 'test',
    declaredAt: now,
    createdAt: now,
    status: 'done',
    ...runEow,
  });
  writeMd(join(workDir, 'runs/run-main/edges/edge-run-node-one-to-eow.md'), {
    taskOpsVersion: 'v1',
    entityType: 'runEdge',
    id: 'edge-run-node-one-to-eow',
    runId: 'run-main',
    fromRunNodeId: 'run-node-one',
    toRunNodeId: 'eow-run-node-one',
    edgeType: 'closes_with',
    createdAt: now,
    status: 'done',
  });
  if (reviewReport) {
    writeMd(join(workDir, 'runs/run-main/nodes/review-run-node-one.md'), {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id: 'review-run-node-one',
      runId: 'run-main',
      type: 'review',
      title: 'Review run node one',
      sourceTaskId: 'task-one',
      sourceTaskGroupVersionId: 'tgv-root-v1',
      status: 'done',
      createdAt: now,
      reviewsRunNodeId: 'run-node-one',
      reviewedRunId: 'run-main',
      actionKind: 'review',
      reviewReport,
      reviewReportHash: canonicalSha256(reviewReport),
    });
    writeMd(join(workDir, 'runs/run-main/nodes/eow-review-run-node-one.md'), {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: 'eow-review-run-node-one',
      runId: 'run-main',
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'review-run-node-one',
      reason: 'review_recorded',
      closureRole: 'supporting',
      declaredBy: 'test',
      declaredAt: now,
      createdAt: now,
      status: 'done',
    });
    writeMd(join(workDir, 'runs/run-main/edges/edge-run-node-one-to-review.md'), {
      taskOpsVersion: 'v1',
      entityType: 'runEdge',
      id: 'edge-run-node-one-to-review',
      runId: 'run-main',
      fromRunNodeId: 'run-node-one',
      toRunNodeId: 'review-run-node-one',
      edgeType: 'reviews',
      createdAt: now,
      status: 'done',
    });
    writeMd(join(workDir, 'runs/run-main/edges/edge-review-run-node-one-to-eow.md'), {
      taskOpsVersion: 'v1',
      entityType: 'runEdge',
      id: 'edge-review-run-node-one-to-eow',
      runId: 'run-main',
      fromRunNodeId: 'review-run-node-one',
      toRunNodeId: 'eow-review-run-node-one',
      edgeType: 'closes_with',
      createdAt: now,
      status: 'done',
    });
  }
  return workDir;
}

try {
  const reviewedAcceptanceHash = canonicalSha256(undefined);
  const reviewedResultHash = canonicalSha256(undefined);
  const reviewReport = {
    decision: 'approved',
    mode: 'runner-managed',
    reviewedAcceptanceHash,
    reviewedResultHash,
  };
  const approvedFields = {
    reason: 'approved_result',
    approvedByReviewNodeId: 'review-run-node-one',
    approvedReviewMode: 'runner-managed',
    approvedReviewReportHash: canonicalSha256(reviewReport),
    reviewedAcceptanceHash,
    reviewedResultHash,
  };
  const approved = parseProject(makeClosedWork('policy-approved-work', {
    taskEow: approvedFields,
    runEow: approvedFields,
    reviewReport,
  }));
  assert.equal(approved.errors.length, 0);
  assert.equal(approved.closure.complete, true);
  assert.equal(approved.closure.structuralComplete, true);
  assert.equal(approved.closure.policyApprovedComplete, true);
  assert.equal(approved.closure.manualAttestedComplete, false);
  assert.equal(approved.closure.closureState, 'policy_approved_complete');

  const manual = parseProject(makeClosedWork('manual-attested-work', {
    taskEow: { reason: 'manual_verified' },
    runEow: { reason: 'manual_verified' },
  }));
  assert.equal(manual.errors.length, 0);
  assert.equal(manual.closure.complete, true);
  assert.equal(manual.closure.structuralComplete, true);
  assert.equal(manual.closure.policyApprovedComplete, false);
  assert.equal(manual.closure.manualAttestedComplete, true);
  assert.equal(manual.closure.closureState, 'manual_attested_complete');
  assert.ok(manual.warnings.some((warning) => warning.includes('manual_verified/manual_close EoW attests structural closure but is not policy-approved review closure')));
  const manualSummary = summarizeProject(manual);
  assert.ok(manualSummary.includes('- Policy-approved closure: incomplete (tasks 0/1, claim closures 0/0, supporting closures 1/1)'));
  assert.ok(manualSummary.includes('- Manual-attested closure: complete (tasks 1/1, run closures 1/1)'));
  assert.ok(manualSummary.includes('- Closure state: manual_attested_complete'));

  const informationalApproved = parseProject(makeClosedWork('informational-approved-work', {
    taskEow: { reason: 'execution_path_closed' },
    runEow: { reason: 'execution_path_closed' },
  }));
  assert.equal(informationalApproved.errors.length, 0);
  assert.equal(informationalApproved.closure.complete, true);
  assert.equal(informationalApproved.closure.policyApprovedComplete, false);
  assert.equal(informationalApproved.closure.closureState, 'structurally_complete_unapproved');

  const activeStructural = parseProject(makeClosedWork('active-structural-work', {
    workStatus: 'active',
  }));
  assert.equal(activeStructural.errors.length, 0);
  assert.equal(activeStructural.closure.complete, true);
  assert.equal(activeStructural.closure.policyApprovedComplete, false);
  assert.equal(activeStructural.closure.manualAttestedComplete, false);
  assert.equal(activeStructural.closure.closureState, 'structurally_complete_unapproved');
  assert.ok(activeStructural.warnings.some((warning) => warning.includes('work status is active while graph is structurally complete')));
  const activeSummary = summarizeProject(activeStructural);
  assert.ok(activeSummary.includes('- Structural closure: complete'));
  assert.ok(activeSummary.includes('- Closure state: structurally_complete_unapproved'));
  assert.ok(activeSummary.includes('WARN:'));

  console.log('closure summary policy smoke passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
