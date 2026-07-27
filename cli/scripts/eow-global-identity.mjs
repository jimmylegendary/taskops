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
import {
  decodeCanonicalEowId,
  runEowId,
  taskEowId,
} from '../lib-run-identity.js';
import { closeTarget, reviewTarget, runTaskOps } from '../lib-runner.js';
import {
  fmBlock,
  parseMarkdownFile,
  parseProject,
  restartFromTask,
} from '../lib-taskops.js';

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
  const taskPath = join(
    versionDir,
    'tasks',
    `${taskOverrides.id || 'task'}.md`,
  );
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

function writeRunEow(fixture, id, frontmatterOverrides = {}) {
  const path = join(
    fixture.workDir,
    'runs/run-main/nodes',
    `${id}.md`,
  );
  writeMd(path, {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id,
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
    ...frontmatterOverrides,
  });
  return path;
}

function writeTaskEow(
  fixture,
  id,
  {
    omitTaskGroupVersionId = false,
    ...frontmatterOverrides
  } = {},
) {
  const path = join(fixture.versionDir, 'eow', `${id}.md`);
  const frontmatter = {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id,
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: 'task',
    taskGroupVersionId: 'tgv-root-v1',
    reason: 'manual_close',
    declaredBy: 'fixture',
    declaredAt: now,
    createdAt: now,
    status: 'done',
    ...frontmatterOverrides,
  };
  if (omitTaskGroupVersionId) delete frontmatter.taskGroupVersionId;
  writeMd(path, frontmatter);
  return path;
}

function assertCanonicalErrorsAt(parsed, path, expectedMessages) {
  const prefix = `${path}: `;
  const actual = parsed.errors
    .filter((error) => (
      error.startsWith(prefix)
      && /(?:malformed )?canonical(?: run| task)? EoW/i.test(error)
    ));
  assert.deepEqual(
    actual,
    expectedMessages.map((message) => `${prefix}${message}`),
  );
}

test('parser rejects a malformed canonical EoW at its exact path', () => {
  const fixture = seedSingleTaskWork('canonical-malformed');
  const malformedId = 'eow-v2-r.A.A';
  const path = writeRunEow(fixture, malformedId);

  const parsed = parseProject(fixture.workDir);
  assertCanonicalErrorsAt(parsed, path, [
    'malformed canonical EoW id: non-canonical runNodeId',
  ]);
});

test('parser validates canonical graphType independently', () => {
  const fixture = seedSingleTaskWork('canonical-graph-type');
  const id = runEowId({
    runId: 'run-main',
    runNodeId: 'run-node-missing',
  });
  const path = writeRunEow(fixture, id, {
    graphType: 'task',
  });

  const parsed = parseProject(fixture.workDir);
  assertCanonicalErrorsAt(parsed, path, [
    'canonical EoW graph kind does not match frontmatter',
  ]);
});

test('parser validates canonical attachedToType independently', () => {
  const fixture = seedSingleTaskWork('canonical-attached-type');
  const id = runEowId({
    runId: 'run-main',
    runNodeId: 'run-node-missing',
  });
  const path = writeRunEow(fixture, id, {
    attachedToType: 'task',
  });

  const parsed = parseProject(fixture.workDir);
  assertCanonicalErrorsAt(parsed, path, [
    'canonical EoW graph kind does not match frontmatter',
  ]);
});

test('parser validates canonical attachedToId independently', () => {
  const fixture = seedSingleTaskWork('canonical-attached-id');
  const id = runEowId({
    runId: 'run-main',
    runNodeId: 'run-node-canonical',
  });
  const path = writeRunEow(fixture, id, {
    attachedToId: 'run-node-frontmatter',
  });

  const parsed = parseProject(fixture.workDir);
  assertCanonicalErrorsAt(parsed, path, [
    'canonical run EoW tuple does not match frontmatter',
  ]);
});

test('parser validates canonical runId independently', () => {
  const fixture = seedSingleTaskWork('canonical-run-id');
  const id = runEowId({
    runId: 'run-other',
    runNodeId: 'run-node-missing',
  });
  const path = writeRunEow(fixture, id);

  const parsed = parseProject(fixture.workDir);
  assertCanonicalErrorsAt(parsed, path, [
    'canonical run EoW tuple does not match frontmatter',
  ]);
});

test('parser validates canonical taskGroupVersionId independently', () => {
  const fixture = seedSingleTaskWork('canonical-task-version');
  const id = taskEowId({
    taskGroupVersionId: 'tgv-other',
    taskId: 'task',
  });
  const path = writeTaskEow(fixture, id);

  const parsed = parseProject(fixture.workDir);
  assertCanonicalErrorsAt(parsed, path, [
    'canonical task EoW tuple does not match frontmatter',
  ]);
});

test('parser rejects a canonical task EoW with missing version frontmatter', () => {
  const fixture = seedSingleTaskWork('canonical-task-version-missing');
  const id = taskEowId({
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task',
  });
  const path = writeTaskEow(fixture, id, {
    omitTaskGroupVersionId: true,
  });

  const parsed = parseProject(fixture.workDir);
  assertCanonicalErrorsAt(parsed, path, [
    'canonical task EoW tuple does not match frontmatter',
  ]);
});

test('parser rejects a canonical task EoW with empty version frontmatter', () => {
  const fixture = seedSingleTaskWork('canonical-task-version-empty');
  const id = taskEowId({
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task',
  });
  const path = writeTaskEow(fixture, id, {
    taskGroupVersionId: '',
  });

  const parsed = parseProject(fixture.workDir);
  assertCanonicalErrorsAt(parsed, path, [
    'canonical task EoW tuple does not match frontmatter',
  ]);
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
    runId: 'run+one',
    maxSteps: 1,
    maxStepsExplicit: true,
  });
  assert.equal(first.actions[0].kind, 'prototype');
  assert.equal(first.actions[0].status, 'completed');
  fillDecision(fixture.taskPath);

  const second = runTaskOps(fixture.workDir, {
    executor: 'dry-run',
    runId: 'run-one',
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
  assert.equal(new Set(actionEows).size, 2);
  assert.ok(actionEows.every((id) => id.startsWith('eow-v2-r.')));
  assert.deepEqual(
    actionEows,
    [
      runEowId({ runId: 'run+one', runNodeId: 'run-node-task' }),
      runEowId({ runId: 'run-one', runNodeId: 'run-node-task' }),
    ].sort(),
  );
  for (const runId of ['run+one', 'run-one']) {
    const actual = [...parsed.eowNodes.values()].find((eow) => (
      eow.graphType === 'run'
      && eow.runId === runId
      && eow.attachedToId === 'run-node-task'
    ));
    assert.ok(actual);
    assert.deepEqual(decodeCanonicalEowId(actual.id), {
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'run-node-task',
      runId,
    });
  }
});

test('tasks that collide under the legacy sanitizer write distinct canonical EoWs', () => {
  const fixture = seedSingleTaskWork('task-collision', {
    id: 'task+a',
    title: 'Complete the plus task',
    objective: 'Complete the plus task.',
    responsibility: 'Own the plus result.',
    completionCriteria: 'The plus result is recorded.',
    order: 1,
  });
  writeMd(join(fixture.versionDir, 'tasks', 'task-a.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task-a',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Complete the hyphen task',
    objective: 'Complete the hyphen task.',
    responsibility: 'Own the hyphen result.',
    completionCriteria: 'The hyphen result is recorded.',
    order: 2,
    createdAt: now,
    status: 'pending',
    runReadiness: 'runnable',
    understandingLevel: 'known',
  });

  const result = runTaskOps(fixture.workDir, {
    executor: 'dry-run',
    runId: 'run-task-collision',
    maxSteps: 2,
    maxStepsExplicit: true,
  });
  assert.deepEqual(
    result.actions.map((action) => action.status),
    ['completed', 'completed'],
  );

  const parsed = parseProject(fixture.workDir);
  const taskEows = [...parsed.eowNodes.values()].filter((eow) => (
    eow.graphType === 'task'
    && eow.taskGroupVersionId === 'tgv-root-v1'
  ));
  assert.equal(taskEows.length, 2);
  assert.deepEqual(
    new Set(taskEows.map((eow) => eow.attachedToId)),
    new Set(['task+a', 'task-a']),
  );
  assert.equal(new Set(taskEows.map((eow) => eow.id)).size, 2);
  assert.ok(taskEows.every((eow) => eow.id.startsWith('eow-v2-t.')));
  for (const taskId of ['task+a', 'task-a']) {
    const actual = taskEows.find((eow) => eow.attachedToId === taskId);
    assert.ok(actual);
    assert.deepEqual(decodeCanonicalEowId(actual.id), {
      graphType: 'task',
      attachedToType: 'task',
      attachedToId: taskId,
      taskGroupVersionId: 'tgv-root-v1',
    });
  }
  assert.equal(parsed.closure.terminalTaskEowCount, 2);
  assert.deepEqual(duplicateEowErrors(parsed), []);
});

function seedRestartCollision() {
  const workDir = join(tempRoot, 'restart-collision');
  const groupDir = join(workDir, 'task-groups', 'tg-root');
  const sourceVersionDir = join(groupDir, 'versions', 'tgv-root-v2');
  const historicalVersionDir = join(groupDir, 'versions', 'tgv-root+v3');
  const sourceEowId = 'eow-task+a';
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id: 'restart-collision',
    title: 'Restart collision',
    objective: 'Carry an exact upstream closure into a collision-safe version.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v2',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(groupDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Restart the downstream task.',
    activeVersionId: 'tgv-root-v2',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(sourceVersionDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v2',
    taskGroupId: 'tg-root',
    version: 'v2',
    summary: 'Selected restart source.',
    selected: true,
    createdAt: now,
    status: 'active',
  });
  writeMd(join(historicalVersionDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root+v3',
    taskGroupId: 'tg-root',
    version: 'v3-legacy-collision',
    summary: 'Unselected legacy collision fixture.',
    selected: false,
    createdAt: now,
    status: 'done',
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
  writeMd(join(historicalVersionDir, 'tasks', 'task-a.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task-a',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root+v3',
    title: 'Historical collision task',
    objective: 'Remain an unselected historical record.',
    responsibility: 'Preserve the old lossy identity.',
    completionCriteria: 'The historical closure remains readable.',
    order: 1,
    createdAt: now,
    status: 'done',
    runReadiness: 'runnable',
    understandingLevel: 'known',
  });
  writeMd(
    join(historicalVersionDir, 'eow', 'eow-task-a-tgv-root-v3.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: 'eow-task-a-tgv-root-v3',
      graphType: 'task',
      attachedToType: 'task',
      attachedToId: 'task-a',
      taskGroupVersionId: 'tgv-root+v3',
      reason: 'execution_path_closed',
      declaredBy: 'fixture',
      declaredAt: now,
      createdAt: now,
      status: 'done',
    },
  );
  writeMd(join(sourceVersionDir, 'tasks', 'task+a.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task+a',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v2',
    title: 'Completed upstream task',
    objective: 'Preserve the upstream result through restart.',
    responsibility: 'Own the preserved upstream proof.',
    completionCriteria: 'The upstream proof is carried forward exactly.',
    order: 1,
    createdAt: now,
    status: 'done',
    runReadiness: 'runnable',
    understandingLevel: 'known',
  });
  writeMd(join(sourceVersionDir, 'eow', `${sourceEowId}.md`), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: sourceEowId,
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: 'task+a',
    taskGroupVersionId: 'tgv-root-v2',
    reason: 'execution_path_closed',
    declaredBy: 'fixture',
    declaredAt: now,
    createdAt: now,
    status: 'done',
  });
  writeMd(join(sourceVersionDir, 'tasks', 'task-restart.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task-restart',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v2',
    title: 'Restart downstream task',
    objective: 'Retry downstream work.',
    responsibility: 'Own the downstream retry.',
    completionCriteria: 'The downstream work succeeds after restart.',
    order: 2,
    createdAt: now,
    status: 'pending',
    runReadiness: 'runnable',
    understandingLevel: 'known',
  });
  writeRunIndex(workDir, 'run-main', 'restart-collision');
  return { workDir, sourceEowId };
}

test('restart carry-forward survives a legacy destination collision', () => {
  const { workDir, sourceEowId } = seedRestartCollision();
  assert.deepEqual(parseProject(workDir).errors, []);
  const restarted = restartFromTask(workDir, {
    fromTaskId: 'task-restart',
    instruction: 'Retry the downstream task with preserved upstream proof.',
    reason: 'identity collision regression',
  });
  assert.equal(restarted.toVersionId, 'tgv-root-v3');

  const parsed = parseProject(workDir);
  const source = [...parsed.eowNodes.values()].find((eow) => (
    eow.graphType === 'task'
    && eow.taskGroupVersionId === restarted.fromVersionId
    && eow.attachedToId === 'task+a'
  ));
  assert.ok(source);
  assert.equal(source.id, sourceEowId);
  const carried = [...parsed.eowNodes.values()].find((eow) => (
    eow.graphType === 'task'
    && eow.taskGroupVersionId === restarted.toVersionId
    && eow.attachedToId === 'task+a'
  ));
  assert.ok(carried);
  assert.equal(
    carried.id,
    taskEowId({
      taskGroupVersionId: restarted.toVersionId,
      taskId: 'task+a',
    }),
  );
  assert.deepEqual(decodeCanonicalEowId(carried.id), {
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: 'task+a',
    taskGroupVersionId: restarted.toVersionId,
  });
  assert.equal(carried.taskGroupVersionId, restarted.toVersionId);
  assert.equal(carried.preservedFromVersionId, restarted.fromVersionId);
  assert.equal(carried.preservedFromEowId, source.id);
  assert.notEqual(carried.id, 'eow-task-a-tgv-root-v3');
  assert.deepEqual(duplicateEowErrors(parsed), []);
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
        runId: 'run-review+one',
        runNodeId: 'run-node-task',
        role: 'primary_execution',
      },
      {
        runId: 'run-review-one',
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
  for (const runId of ['run-review+one', 'run-review-one']) {
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

  const hyphenReview = reviewTarget(fixture.workDir, 'task');
  assert.equal(hyphenReview.target.runId, 'run-review-one');

  const taskFm = parseMarkdownFile(fixture.taskPath);
  writeMd(fixture.taskPath, {
    ...taskFm,
    runRefs: [...taskFm.runRefs].reverse(),
  });
  const plusReview = reviewTarget(fixture.workDir, 'task');
  assert.equal(plusReview.target.runId, 'run-review+one');

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
    ));
  const reviewEowIds = reviewEows.map((eow) => eow.id).sort();
  assert.equal(new Set(reviewEowIds).size, 2);
  assert.ok(reviewEowIds.every((id) => id.startsWith('eow-v2-r.')));
  assert.deepEqual(
    reviewEowIds,
    [
      runEowId({
        runId: 'run-review+one',
        runNodeId: 'review-run-node-task',
      }),
      runEowId({
        runId: 'run-review-one',
        runNodeId: 'review-run-node-task',
      }),
    ].sort(),
  );
  for (const runId of ['run-review+one', 'run-review-one']) {
    const reviewEow = reviewEows.find((eow) => eow.runId === runId);
    assert.ok(reviewEow);
    assert.equal(
      reviewEow.id,
      runEowId({ runId, runNodeId: 'review-run-node-task' }),
    );
    assert.deepEqual(decodeCanonicalEowId(reviewEow.id), {
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'review-run-node-task',
      runId,
    });
    const closesWithEdge = [...parsed.runEdges.values()].find((edge) => (
      edge.runId === runId
      && edge.fromRunNodeId === 'review-run-node-task'
      && edge.edgeType === 'closes_with'
    ));
    assert.ok(closesWithEdge);
    assert.equal(closesWithEdge.toRunNodeId, reviewEow.id);
  }
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
  mkdirSync(join(v1, 'tasks'), { recursive: true });
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
  writeMd(join(v2, 'tasks', 'task+manual.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task+manual',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v2',
    title: 'Historical plus task',
    objective: 'Remain closed as a historical compatibility record.',
    responsibility: 'Record the historical plus result.',
    completionCriteria: 'The historical plus closure exists.',
    order: 1,
    createdAt: now,
    status: 'done',
    runReadiness: 'runnable',
    understandingLevel: 'known',
  });
  writeMd(join(v2, 'eow', 'eow-task-manual-tgv-root-v2.md'), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: 'eow-task-manual-tgv-root-v2',
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: 'task+manual',
    taskGroupVersionId: 'tgv-root-v2',
    reason: 'manual_close',
    declaredBy: 'fixture',
    declaredAt: now,
    createdAt: now,
    status: 'done',
  });
  writeMd(join(v2, 'tasks', 'task-manual.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task-manual',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v2',
    title: 'Selected hyphen task',
    objective: 'Close manually.',
    responsibility: 'Own the manual result.',
    completionCriteria: 'Manual attestation exists.',
    order: 2,
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
  const closed = closeTarget(workDir, 'task-manual', {
    reason: 'manual_verified',
  });
  assert.equal(
    closed.eowId,
    taskEowId({
      taskGroupVersionId: 'tgv-root-v2',
      taskId: 'task-manual',
    }),
  );
  assert.deepEqual(decodeCanonicalEowId(closed.eowId), {
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: 'task-manual',
    taskGroupVersionId: 'tgv-root-v2',
  });
  assert.deepEqual(
    duplicateEowErrors(parseProject(workDir)),
    [],
    'manual task close must not reuse a legacy global EoW ID',
  );
});

function seedManualRunClose() {
  const fixture = seedSingleTaskWork('manual-run-close');
  writeRunIndex(fixture.workDir, 'run-manual', 'manual-run-close');
  writeMd(
    join(fixture.workDir, 'runs', 'run-manual', 'nodes', 'run-node+manual.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id: 'run-node+manual',
      runId: 'run-manual',
      type: 'loopback',
      actionKind: 'loopback',
      attempt: 1,
      title: 'Historical plus node',
      status: 'done',
      createdAt: now,
    },
  );
  writeMd(
    join(
      fixture.workDir,
      'runs',
      'run-manual',
      'nodes',
      'eow-run-node-manual-run-manual.md',
    ),
    {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: 'eow-run-node-manual-run-manual',
      runId: 'run-manual',
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'run-node+manual',
      reason: 'manual_close',
      closureRole: 'supporting',
      declaredBy: 'fixture',
      declaredAt: now,
      createdAt: now,
      status: 'done',
    },
  );
  writeMd(
    join(fixture.workDir, 'runs', 'run-manual', 'edges', 'edge-history-to-eow.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'runEdge',
      id: 'edge-history-to-eow',
      runId: 'run-manual',
      fromRunNodeId: 'run-node+manual',
      toRunNodeId: 'eow-run-node-manual-run-manual',
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
  const runClosed = closeTarget(workDir, 'run-node-manual', {
    reason: 'manual_close',
  });
  const expectedEowId = runEowId({
    runId: 'run-manual',
    runNodeId: 'run-node-manual',
  });
  assert.equal(runClosed.eowId, expectedEowId);
  assert.deepEqual(decodeCanonicalEowId(runClosed.eowId), {
    graphType: 'run',
    attachedToType: 'runNode',
    attachedToId: 'run-node-manual',
    runId: 'run-manual',
  });
  const runEdge = parseMarkdownFile(runClosed.edgePath);
  assert.equal(runEdge.toRunNodeId, runClosed.eowId);
  assert.deepEqual(
    duplicateEowErrors(parseProject(workDir)),
    [],
    'manual run-node close must not reuse a legacy global EoW ID',
  );
});
