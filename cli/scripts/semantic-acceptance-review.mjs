#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseProject } from '../lib-taskops.js';
import { reviewTarget } from '../lib-runner.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-semantic-review-'));
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

function makeWork(name, { acceptance, result }) {
  const workDir = join(tempRoot, name);
  ensureDirs(workDir);
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id: name,
    title: name,
    objective: 'Review semantic acceptance assertions.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'task-groups/tg-root/index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Root task group.',
    activeVersionId: 'tgv-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'task-groups/tg-root/versions/tgv-root-v1/index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    version: 'v1',
    summary: 'Semantic review fixture.',
    selected: true,
    createdAt: now,
    status: 'active',
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
  writeMd(join(workDir, 'task-groups/tg-root/versions/tgv-root-v1/tasks/task-review.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task-review',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Review target',
    objective: 'Produce the expected semantic artifact.',
    responsibility: 'Own deterministic semantic evidence.',
    completionCriteria: 'Observed evidence matches semantic assertions.',
    acceptance,
    order: 1,
    createdAt: now,
    status: 'done',
    runReadiness: 'runnable',
    understandingLevel: 'known',
    runRefs: [{ runId: 'run-main', runNodeId: 'run-node-review', role: 'primary_execution' }],
  });
  writeMd(join(workDir, 'task-groups/tg-root/versions/tgv-root-v1/eow/eow-task-review.md'), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: 'eow-task-review',
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: 'task-review',
    taskGroupVersionId: 'tgv-root-v1',
    reason: 'execution_path_closed',
    declaredBy: 'test',
    declaredAt: now,
    createdAt: now,
    status: 'done',
  });
  writeMd(join(workDir, 'runs/run-main/index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'run',
    id: 'run-main',
    workId: name,
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'runs/run-main/nodes/run-node-review.md'), {
    taskOpsVersion: 'v1',
    entityType: 'runNode',
    id: 'run-node-review',
    runId: 'run-main',
    type: 'implementation',
    actionKind: 'execute',
    attempt: 1,
    title: 'Review target',
    sourceTaskId: 'task-review',
    sourceTaskGroupVersionId: 'tgv-root-v1',
    status: 'done',
    createdAt: now,
    result,
  });
  writeMd(join(workDir, 'runs/run-main/nodes/eow-run-node-review.md'), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: 'eow-run-node-review',
    runId: 'run-main',
    graphType: 'run',
    attachedToType: 'runNode',
    attachedToId: 'run-node-review',
    reason: 'execution_path_closed',
    closureRole: 'claim-bearing',
    declaredBy: 'test',
    declaredAt: now,
    createdAt: now,
    status: 'done',
  });
  writeMd(join(workDir, 'runs/run-main/edges/edge-run-node-review-to-eow.md'), {
    taskOpsVersion: 'v1',
    entityType: 'runEdge',
    id: 'edge-run-node-review-to-eow',
    runId: 'run-main',
    fromRunNodeId: 'run-node-review',
    toRunNodeId: 'eow-run-node-review',
    edgeType: 'closes_with',
    createdAt: now,
    status: 'done',
  });
  return workDir;
}

try {
  const staleIdentityWork = makeWork('stale-identity-work', {
    acceptance: {
      mode: 'runner-managed',
      expectedOutcome: 'Publish the current artifact.',
      semanticAssertions: {
        requiredUrls: ['https://example.com/current-report'],
        requiredArtifactIdentities: ['reports/current/index.html'],
        forbiddenUrls: ['https://example.com/stale-report'],
        forbiddenArtifacts: ['reports/stale/index.html'],
      },
    },
    result: {
      executorSummary: 'Published stale report at https://example.com/stale-report.',
      observed: {
        outcomeSummary: 'Published stale report at https://example.com/stale-report.',
        artifactRefs: ['reports/stale/index.html'],
        evidenceRefs: ['run:run-main/node:run-node-review'],
      },
    },
  });
  const staleReview = reviewTarget(staleIdentityWork, 'task-review');
  assert.equal(staleReview.reviewReport.mode, 'runner-managed');
  assert.equal(staleReview.reviewReport.decision, 'rejected');
  assert.ok(staleReview.reviewReport.failedChecks.includes('required URL identity mismatch: expected https://example.com/current-report'));
  assert.ok(staleReview.reviewReport.failedChecks.includes('required artifact identity mismatch: expected reports/current/index.html'));
  assert.ok(staleReview.reviewReport.failedChecks.includes('forbidden URL observed: https://example.com/stale-report'));
  assert.ok(staleReview.reviewReport.failedChecks.includes('forbidden artifact observed: reports/stale/index.html'));

  const contentWork = makeWork('content-work', {
    acceptance: {
      mode: 'guarded',
      expectedOutcome: 'Report contains the required claim, source, and coverage.',
      assertions: {
        contentIncludes: ['semantic-controller'],
        requiredSources: ['docs/RUN_READINESS.md'],
        requiredCoverage: ['runner-managed-acceptance'],
      },
    },
    result: {
      executorSummary: 'Report discusses a generic controller.',
      observed: {
        outcomeSummary: 'Report discusses a generic controller.',
        content: 'generic controller without the expected phrase',
        sourceRefs: ['docs/CORE_MODEL.md'],
        coverage: ['manual-acceptance'],
        evidenceRefs: ['run:run-main/node:run-node-review'],
      },
    },
  });
  const contentReview = reviewTarget(contentWork, 'task-review');
  assert.equal(contentReview.reviewReport.decision, 'rejected');
  assert.ok(contentReview.reviewReport.failedChecks.includes('content assertion not satisfied: semantic-controller'));
  assert.ok(contentReview.reviewReport.failedChecks.includes('required source/citation not observed: docs/RUN_READINESS.md'));
  assert.ok(contentReview.reviewReport.missingExpected.includes('required coverage not observed: runner-managed-acceptance'));

  const informationalWork = makeWork('informational-work', {
    acceptance: {
      mode: 'informational',
      expectedOutcome: 'Advisory review only.',
      assertions: {
        contentIncludes: ['not present'],
      },
    },
    result: {
      executorSummary: 'Advisory result.',
      observed: {
        outcomeSummary: 'Advisory result.',
        evidenceRefs: ['run:run-main/node:run-node-review'],
      },
    },
  });
  const informationalReview = reviewTarget(informationalWork, 'task-review');
  assert.equal(informationalReview.reviewReport.mode, 'informational');
  assert.equal(informationalReview.reviewReport.decision, 'rejected');
  const informationalParsed = parseProject(informationalWork);
  assert.equal(informationalParsed.errors.length, 0);

  console.log('semantic acceptance review smoke passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
