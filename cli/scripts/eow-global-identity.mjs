#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { runEowId, taskEowId } from '../lib-run-identity.js';
import { closeTarget, reviewTarget, runTaskOps } from '../lib-runner.js';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-eow-global-identity-'));
const now = '2026-07-25T00:00:00.000Z';

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function writeMd(path, fm) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
}

function writeRunIndex(workDir, runId, workId) {
  writeMd(join(workDir, 'runs', runId, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'run',
    id: runId,
    workId,
    createdAt: now,
    status: 'active',
  });
}

function seedSingleTaskWork(name, taskOverrides = {}) {
  const workDir = join(tempRoot, name);
  const versionDir = join(
    workDir,
    'task-groups',
    'tg-root',
    'versions',
    'tgv-root-v1',
  );
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id: name,
    title: name,
    objective: 'Exercise globally unique EoW identity.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'task-groups', 'tg-root', 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Complete one task.',
    activeVersionId: 'tgv-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(versionDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    version: 'v1',
    summary: 'EoW identity fixture.',
    selected: true,
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'snapshots', 'snapshot-root-v1.md'), {
    taskOpsVersion: 'v1',
    entityType: 'versionSnapshot',
    id: 'snapshot-root-v1',
    rootTaskGroupId: 'tg-root',
    createdAt: now,
    label: 'Root',
    status: 'active',
    selectedVersions: [{
      taskGroupId: 'tg-root',
      versionId: 'tgv-root-v1',
    }],
  });
  const taskPath = join(versionDir, 'tasks', 'task.md');
  writeMd(taskPath, {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Complete the task',
    objective: 'Complete the task.',
    responsibility: 'Own the result.',
    completionCriteria: 'The result is recorded.',
    order: 1,
    createdAt: now,
    status: 'pending',
    runReadiness: 'runnable',
    understandingLevel: 'known',
    ...taskOverrides,
  });
  writeRunIndex(workDir, 'run-main', name);
  return { workDir, versionDir, taskPath };
}

function fillDecision(path) {
  const before = readFileSync(path, 'utf8');
  const after = before
    .replace(
      '<resolver: the concrete, downstream-consumable choice — a value, not prose>',
      'Option B',
    )
    .replace(
      '<resolver: the grounds for this decision>',
      'The owner selected the bounded alternate.',
    );
  assert.notEqual(after, before, 'prototype decision fixture must fill the template');
  writeFileSync(path, after, 'utf8');
}

function duplicateEowErrors(parsed) {
  return parsed.errors.filter((error) => /duplicate EoW id/i.test(error));
}

test('parser rejects malformed and tuple-inconsistent canonical EoWs', () => {
  const fixture = seedSingleTaskWork('canonical-parser-errors');

  const malformedId = 'eow-v2-r.A.A';
  writeMd(
    join(
      fixture.workDir,
      'runs/run-main/nodes',
      `${malformedId}.md`,
    ),
    {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: malformedId,
      runId: 'run-main',
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'run-node-missing',
      reason: 'manual_close',
      closureRole: 'supporting',
      declaredBy: 'fixture',
      declaredAt: now,
      createdAt: now,
      status: 'done',
    },
  );

  const wrongTupleId = runEowId({
    runId: 'run-other',
    runNodeId: 'run-node-missing',
  });
  writeMd(
    join(
      fixture.workDir,
      'runs/run-main/nodes',
      `${wrongTupleId}.md`,
    ),
    {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: wrongTupleId,
      runId: 'run-main',
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'run-node-missing',
      reason: 'manual_close',
      closureRole: 'supporting',
      declaredBy: 'fixture',
      declaredAt: now,
      createdAt: now,
      status: 'done',
    },
  );

  const wrongKindId = runEowId({
    runId: 'tgv-root-v1',
    runNodeId: 'task',
  });
  writeMd(
    join(fixture.versionDir, 'eow', `${wrongKindId}.md`),
    {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: wrongKindId,
      graphType: 'task',
      attachedToType: 'task',
      attachedToId: 'task',
      taskGroupVersionId: 'tgv-root-v1',
      reason: 'manual_close',
      declaredBy: 'fixture',
      declaredAt: now,
      createdAt: now,
      status: 'done',
    },
  );

  const parsed = parseProject(fixture.workDir);
  assert.ok(parsed.errors.some((error) => (
    /malformed canonical EoW id/i.test(error)
  )));
  assert.ok(parsed.errors.some((error) => (
    /canonical run EoW tuple does not match frontmatter/i.test(error)
  )));
  assert.ok(parsed.errors.some((error) => (
    /canonical EoW graph kind does not match frontmatter/i.test(error)
  )));
});

test('separate runs of one task write run-qualified EoWs', () => {
  const fixture = seedSingleTaskWork('separate-runs', {
    uncertaintyState: 'unknown_known',
    confidenceScore: 0.5,
    knownList: [{
      id: 'k-local',
      claim: 'The intended option requires a human reaction.',
      verificationStatus: 'unverified',
    }],
    unknownKnowns: ['visual form'],
    expectedPlan: {
      expectedDepth: 0,
      expectedBreadth: 1,
      rationale: 'The post-selection result is atomic.',
    },
  });

  const first = runTaskOps(fixture.workDir, {
    executor: 'dry-run',
    runId: 'run-one',
    maxSteps: 1,
    maxStepsExplicit: true,
  });
  assert.equal(first.actions[0].kind, 'prototype');
  assert.equal(first.actions[0].status, 'completed');
  fillDecision(fixture.taskPath);

  const second = runTaskOps(fixture.workDir, {
    executor: 'dry-run',
    runId: 'run-two',
    maxSteps: 1,
    maxStepsExplicit: true,
  });
  assert.equal(second.actions[0].kind, 'execute');
  assert.equal(second.actions[0].status, 'completed');

  const parsed = parseProject(fixture.workDir);
  assert.deepEqual(
    duplicateEowErrors(parsed),
    [],
    'separate run graphs must not collide in the parser global EoW namespace',
  );
  const actionEows = [...parsed.eowNodes.values()]
    .filter((eow) => (
      eow.graphType === 'run'
      && eow.attachedToId === 'run-node-task'
    ))
    .map((eow) => eow.id)
    .sort();
  assert.deepEqual(
    actionEows,
    [
      runEowId({ runId: 'run-one', runNodeId: 'run-node-task' }),
      runEowId({ runId: 'run-two', runNodeId: 'run-node-task' }),
    ].sort(),
  );
});

test('a restarted verification worker keeps its prior run EoWs distinct', () => {
  const fixture = seedSingleTaskWork('restarted-worker', {
    acceptance: {
      mode: 'runner-managed',
      expectedOutcome: 'The deterministic check passes.',
      requiredChecks: [{ id: 'check-fail', command: 'exit 1' }],
    },
  });

  const first = runTaskOps(fixture.workDir, {
    executor: 'dry-run',
    runId: 'run-worker-one',
    maxSteps: 1,
    maxStepsExplicit: true,
    verifyChecks: true,
    verifyRetries: 1,
  });
  assert.equal(first.actions[0].status, 'retry');

  const restarted = runTaskOps(fixture.workDir, {
    executor: 'dry-run',
    runId: 'run-worker-restarted',
    maxSteps: 1,
    maxStepsExplicit: true,
    verifyChecks: true,
    verifyRetries: 1,
  });
  assert.equal(restarted.actions[0].kind, 'execute');

  const parsed = parseProject(fixture.workDir);
  assert.deepEqual(
    duplicateEowErrors(parsed),
    [],
    'a restarted worker must not collide with the prior worker run',
  );
  const reviewEows = [...parsed.eowNodes.values()]
    .filter((eow) => (
      eow.graphType === 'run'
      && eow.attachedToId === 'review-run-node-task'
    ))
    .map((eow) => eow.id)
    .sort();
  assert.deepEqual(
    reviewEows,
    [
      runEowId({
        runId: 'run-worker-one',
        runNodeId: 'review-run-node-task',
      }),
      runEowId({
        runId: 'run-worker-restarted',
        runNodeId: 'review-run-node-task',
      }),
    ].sort(),
  );
});

function seedTwoReviewRuns() {
  const fixture = seedSingleTaskWork('review-runs', {
    status: 'done',
    acceptance: {
      mode: 'runner-managed',
      expectedOutcome: 'The deterministic check passes.',
      requiredChecks: [{ id: 'check-pass', command: 'npm test' }],
    },
    runRefs: [
      {
        runId: 'run-review-one',
        runNodeId: 'run-node-task',
        role: 'primary_execution',
      },
      {
        runId: 'run-review-two',
        runNodeId: 'run-node-task',
        role: 'primary_execution',
      },
    ],
  });
  writeMd(join(fixture.versionDir, 'eow', 'eow-task-tgv-root-v1.md'), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: 'eow-task-tgv-root-v1',
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: 'task',
    taskGroupVersionId: 'tgv-root-v1',
    reason: 'execution_path_closed',
    declaredBy: 'fixture',
    declaredAt: now,
    createdAt: now,
    status: 'done',
  });
  for (const runId of ['run-review-one', 'run-review-two']) {
    writeRunIndex(fixture.workDir, runId, 'review-runs');
    writeMd(join(fixture.workDir, 'runs', runId, 'nodes', 'run-node-task.md'), {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id: 'run-node-task',
      runId,
      type: 'implementation',
      actionKind: 'execute',
      attempt: 1,
      title: 'Implementation',
      sourceTaskId: 'task',
      sourceTaskGroupVersionId: 'tgv-root-v1',
      status: 'done',
      createdAt: now,
      result: {
        observed: {
          outcomeSummary: 'The result is complete.',
          artifactRefs: [],
          evidenceRefs: [],
          checkResults: [{
            command: 'npm test',
            status: 'passed',
          }],
        },
      },
    });
    const claimEowId = `eow-run-node-task-${runId}`;
    writeMd(join(fixture.workDir, 'runs', runId, 'nodes', `${claimEowId}.md`), {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: claimEowId,
      runId,
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'run-node-task',
      reason: 'execution_path_closed',
      closureRole: 'claim-bearing',
      declaredBy: 'fixture',
      declaredAt: now,
      createdAt: now,
      status: 'done',
    });
    writeMd(
      join(fixture.workDir, 'runs', runId, 'edges', 'edge-implementation-to-eow.md'),
      {
        taskOpsVersion: 'v1',
        entityType: 'runEdge',
        id: 'edge-implementation-to-eow',
        runId,
        fromRunNodeId: 'run-node-task',
        toRunNodeId: claimEowId,
        edgeType: 'closes_with',
        createdAt: now,
        status: 'done',
      },
    );
  }
  return fixture;
}

test('independent reviews in separate runs write run-qualified review EoWs', () => {
  const fixture = seedTwoReviewRuns();
  assert.deepEqual(parseProject(fixture.workDir).errors, []);

  const secondReview = reviewTarget(fixture.workDir, 'task');
  assert.equal(secondReview.target.runId, 'run-review-two');

  const taskFm = parseMarkdownFile(fixture.taskPath);
  writeMd(fixture.taskPath, {
    ...taskFm,
    runRefs: [...taskFm.runRefs].reverse(),
  });
  const firstReview = reviewTarget(fixture.workDir, 'task');
  assert.equal(firstReview.target.runId, 'run-review-one');

  const parsed = parseProject(fixture.workDir);
  assert.deepEqual(
    duplicateEowErrors(parsed),
    [],
    'review closure EoWs must not collide across run graphs',
  );
  const reviewEows = [...parsed.eowNodes.values()]
    .filter((eow) => (
      eow.graphType === 'run'
      && eow.attachedToId === 'review-run-node-task'
    ))
    .map((eow) => eow.id)
    .sort();
  assert.deepEqual(
    reviewEows,
    [
      runEowId({
        runId: 'run-review-one',
        runNodeId: 'review-run-node-task',
      }),
      runEowId({
        runId: 'run-review-two',
        runNodeId: 'review-run-node-task',
      }),
    ].sort(),
  );
});

function seedManualTaskClose() {
  const workDir = join(tempRoot, 'manual-task-close');
  const groupDir = join(workDir, 'task-groups', 'tg-root');
  const v1 = join(groupDir, 'versions', 'tgv-root-v1');
  const v2 = join(groupDir, 'versions', 'tgv-root-v2');
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id: 'manual-task-close',
    title: 'Manual task close',
    objective: 'Close the selected restarted task.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v2',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(groupDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Close one task.',
    activeVersionId: 'tgv-root-v2',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(v1, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    version: 'v1',
    summary: 'Historical version.',
    selected: false,
    createdAt: now,
    status: 'done',
  });
  writeMd(join(v2, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v2',
    taskGroupId: 'tg-root',
    version: 'v2',
    summary: 'Restarted version.',
    selected: true,
    supersedesVersionId: 'tgv-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'snapshots', 'snapshot-root-v2.md'), {
    taskOpsVersion: 'v1',
    entityType: 'versionSnapshot',
    id: 'snapshot-root-v2',
    rootTaskGroupId: 'tg-root',
    createdAt: now,
    label: 'Root v2',
    status: 'active',
    selectedVersions: [{
      taskGroupId: 'tg-root',
      versionId: 'tgv-root-v2',
    }],
  });
  writeMd(join(v1, 'tasks', 'historical.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'historical',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Historical task',
    objective: 'Remain historical.',
    responsibility: 'Record history.',
    completionCriteria: 'History exists.',
    order: 1,
    createdAt: now,
    status: 'done',
    runReadiness: 'runnable',
    understandingLevel: 'known',
  });
  writeMd(join(v1, 'eow', 'eow-task.md'), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: 'eow-task',
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: 'historical',
    taskGroupVersionId: 'tgv-root-v1',
    reason: 'manual_close',
    declaredBy: 'fixture',
    declaredAt: now,
    createdAt: now,
    status: 'done',
  });
  writeMd(join(v2, 'tasks', 'task.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v2',
    title: 'Selected task',
    objective: 'Close manually.',
    responsibility: 'Own the manual result.',
    completionCriteria: 'Manual attestation exists.',
    order: 1,
    createdAt: now,
    status: 'pending',
    runReadiness: 'runnable',
    understandingLevel: 'known',
  });
  writeRunIndex(workDir, 'run-main', 'manual-task-close');
  return workDir;
}

test('manual task close writes a version-qualified EoW', () => {
  const workDir = seedManualTaskClose();
  assert.deepEqual(parseProject(workDir).errors, []);
  const closed = closeTarget(workDir, 'task', {
    reason: 'manual_verified',
  });
  assert.equal(
    closed.eowId,
    taskEowId({ taskGroupVersionId: 'tgv-root-v2', taskId: 'task' }),
  );
  assert.deepEqual(
    duplicateEowErrors(parseProject(workDir)),
    [],
    'manual task close must not reuse a legacy global EoW ID',
  );
});

function seedManualRunClose() {
  const fixture = seedSingleTaskWork('manual-run-close');
  writeRunIndex(fixture.workDir, 'run-history', 'manual-run-close');
  writeRunIndex(fixture.workDir, 'run-manual', 'manual-run-close');
  writeMd(
    join(fixture.workDir, 'runs', 'run-history', 'nodes', 'historical-node.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id: 'historical-node',
      runId: 'run-history',
      type: 'loopback',
      actionKind: 'loopback',
      attempt: 1,
      title: 'Historical node',
      status: 'done',
      createdAt: now,
    },
  );
  writeMd(
    join(
      fixture.workDir,
      'runs',
      'run-history',
      'nodes',
      'eow-run-node-manual.md',
    ),
    {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: 'eow-run-node-manual',
      runId: 'run-history',
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'historical-node',
      reason: 'manual_close',
      closureRole: 'supporting',
      declaredBy: 'fixture',
      declaredAt: now,
      createdAt: now,
      status: 'done',
    },
  );
  writeMd(
    join(fixture.workDir, 'runs', 'run-history', 'edges', 'edge-history-to-eow.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'runEdge',
      id: 'edge-history-to-eow',
      runId: 'run-history',
      fromRunNodeId: 'historical-node',
      toRunNodeId: 'eow-run-node-manual',
      edgeType: 'closes_with',
      createdAt: now,
      status: 'done',
    },
  );
  writeMd(
    join(fixture.workDir, 'runs', 'run-manual', 'nodes', 'run-node-manual.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id: 'run-node-manual',
      runId: 'run-manual',
      type: 'loopback',
      actionKind: 'loopback',
      attempt: 1,
      title: 'Manual close node',
      status: 'done',
      createdAt: now,
    },
  );
  mkdirSync(join(fixture.workDir, 'runs', 'run-manual', 'edges'), {
    recursive: true,
  });
  return fixture.workDir;
}

test('manual run-node close writes a run-qualified EoW and edge target', () => {
  const workDir = seedManualRunClose();
  assert.deepEqual(parseProject(workDir).errors, []);
  const closed = closeTarget(workDir, 'run-node-manual', {
    reason: 'manual_close',
  });
  const expectedEowId = runEowId({
    runId: 'run-manual',
    runNodeId: 'run-node-manual',
  });
  assert.equal(closed.eowId, expectedEowId);
  const edge = parseMarkdownFile(closed.edgePath);
  assert.equal(edge.toRunNodeId, expectedEowId);
  assert.deepEqual(
    duplicateEowErrors(parseProject(workDir)),
    [],
    'manual run-node close must not reuse a legacy global EoW ID',
  );
});
