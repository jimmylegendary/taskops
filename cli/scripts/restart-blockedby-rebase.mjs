#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { rebaseBlockedByVersionRefs } from '../lib-restart.js';
import { fmBlock, parseProject, restartFromTask } from '../lib-taskops.js';
import { computeNextAction, runTaskOps } from '../lib-runner.js';

const original = [
  { type: 'task', id: 'foundation', taskGroupVersionId: 'tgv-root-v2' },
  { type: 'task', id: 'external', taskGroupVersionId: 'tgv-external-v1' },
  { type: 'runNode', runId: 'run-old', id: 'run-node-old' },
];
const rebased = rebaseBlockedByVersionRefs(original, {
  fromVersionId: 'tgv-root-v2',
  toVersionId: 'tgv-root-v3',
});
assert.deepEqual(rebased, [
  { type: 'task', id: 'foundation', taskGroupVersionId: 'tgv-root-v3' },
  { type: 'task', id: 'external', taskGroupVersionId: 'tgv-external-v1' },
  { type: 'runNode', runId: 'run-old', id: 'run-node-old' },
]);
assert.deepEqual(original[0], {
  type: 'task',
  id: 'foundation',
  taskGroupVersionId: 'tgv-root-v2',
});
assert.deepEqual(
  rebaseBlockedByVersionRefs(original[0], {
    fromVersionId: 'tgv-root-v2',
    toVersionId: 'tgv-root-v3',
  }),
  { type: 'task', id: 'foundation', taskGroupVersionId: 'tgv-root-v3' },
);

function writeMd(path, fm) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fmBlock(fm) + `# ${fm.id}\n`, 'utf8');
}

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-restart-rebase-'));
const workDir = join(tempRoot, 'work');
const now = '2026-07-25T00:00:00.000Z';
const rootV2 = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2');
const externalV1 = join(workDir, 'task-groups', 'tg-external', 'versions', 'tgv-external-v1');

writeMd(join(workDir, 'index.md'), {
  taskOpsVersion: 'v1',
  entityType: 'work',
  id: 'restart-rebase',
  title: 'Restart rebase',
  objective: 'Keep restarted dependencies in the selected version.',
  activeRootTaskGroupId: 'tg-root',
  activeSnapshotId: 'snapshot-root-v1',
  createdAt: now,
  status: 'active',
});
writeMd(join(workDir, 'task-groups', 'tg-root', 'index.md'), {
  taskOpsVersion: 'v1',
  entityType: 'taskGroup',
  id: 'tg-root',
  objective: 'Root work.',
  activeVersionId: 'tgv-root-v2',
  createdAt: now,
  status: 'active',
});
writeMd(join(rootV2, 'index.md'), {
  taskOpsVersion: 'v1',
  entityType: 'taskGroupVersion',
  id: 'tgv-root-v2',
  taskGroupId: 'tg-root',
  version: 'v2',
  summary: 'Completed source version.',
  selected: true,
  createdAt: now,
  status: 'active',
});
writeMd(join(workDir, 'task-groups', 'tg-external', 'index.md'), {
  taskOpsVersion: 'v1',
  entityType: 'taskGroup',
  id: 'tg-external',
  objective: 'External prerequisite.',
  activeVersionId: 'tgv-external-v1',
  createdAt: now,
  status: 'active',
});
writeMd(join(externalV1, 'index.md'), {
  taskOpsVersion: 'v1',
  entityType: 'taskGroupVersion',
  id: 'tgv-external-v1',
  taskGroupId: 'tg-external',
  version: 'v1',
  summary: 'External selected version.',
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
  label: 'Root plus external',
  status: 'active',
  selectedVersions: [
    { taskGroupId: 'tg-root', versionId: 'tgv-root-v2' },
    { taskGroupId: 'tg-external', versionId: 'tgv-external-v1' },
  ],
});
writeMd(join(rootV2, 'tasks', 'foundation.md'), {
  taskOpsVersion: 'v1',
  entityType: 'task',
  id: 'foundation',
  taskGroupId: 'tg-root',
  taskGroupVersionId: 'tgv-root-v2',
  title: 'Foundation',
  objective: 'Build the foundation.',
  responsibility: 'Own the foundation.',
  completionCriteria: 'Foundation result exists.',
  order: 1,
  createdAt: now,
  status: 'done',
  runReadiness: 'runnable',
  understandingLevel: 'known',
});
writeMd(join(rootV2, 'tasks', 'dependent.md'), {
  taskOpsVersion: 'v1',
  entityType: 'task',
  id: 'dependent',
  taskGroupId: 'tg-root',
  taskGroupVersionId: 'tgv-root-v2',
  title: 'Dependent',
  objective: 'Build on the foundation and external prerequisite.',
  responsibility: 'Own the dependent result.',
  completionCriteria: 'Dependent result exists.',
  order: 2,
  createdAt: now,
  status: 'done',
  runReadiness: 'runnable',
  understandingLevel: 'known',
  blockedBy: [
    { type: 'task', id: 'foundation', taskGroupVersionId: 'tgv-root-v2' },
    { type: 'task', id: 'external', taskGroupVersionId: 'tgv-external-v1' },
  ],
});
writeMd(join(externalV1, 'tasks', 'external.md'), {
  taskOpsVersion: 'v1',
  entityType: 'task',
  id: 'external',
  taskGroupId: 'tg-external',
  taskGroupVersionId: 'tgv-external-v1',
  title: 'External',
  objective: 'Provide the external prerequisite.',
  responsibility: 'Own the external prerequisite.',
  completionCriteria: 'External prerequisite exists.',
  order: 1,
  createdAt: now,
  status: 'done',
  runReadiness: 'runnable',
  understandingLevel: 'known',
});
for (const [dir, taskId, versionId] of [
  [rootV2, 'foundation', 'tgv-root-v2'],
  [rootV2, 'dependent', 'tgv-root-v2'],
  [externalV1, 'external', 'tgv-external-v1'],
]) {
  writeMd(join(dir, 'eow', `eow-${taskId}.md`), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: `eow-${taskId}`,
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: taskId,
    taskGroupVersionId: versionId,
    reason: 'manual_close',
    declaredBy: 'fixture',
    declaredAt: now,
    createdAt: now,
    status: 'done',
  });
}

restartFromTask(workDir, {
  fromTaskId: 'foundation',
  instruction: 'Rebuild the foundation before its dependent runs.',
  reason: 'dependency_rebase_regression',
});

const restarted = parseProject(workDir);
assert.deepEqual(restarted.errors, []);
const v3Dependent = restarted.tasks.get('tgv-root-v3:dependent');
assert.deepEqual(v3Dependent.blockedBy, [
  { type: 'task', id: 'foundation', taskGroupVersionId: 'tgv-root-v3' },
  { type: 'task', id: 'external', taskGroupVersionId: 'tgv-external-v1' },
]);

const held = runTaskOps(workDir, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
  targetTaskId: 'dependent',
  targetTaskGroupVersionId: 'tgv-root-v3',
  allowConcurrentTarget: true,
});
assert.equal(held.actions.length, 0);
assert.equal(held.stopReason, 'blocked_only');

runTaskOps(workDir, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
  targetTaskId: 'foundation',
  targetTaskGroupVersionId: 'tgv-root-v3',
  allowConcurrentTarget: true,
});
const resumed = runTaskOps(workDir, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
  targetTaskId: 'dependent',
  targetTaskGroupVersionId: 'tgv-root-v3',
  allowConcurrentTarget: true,
});
assert.equal(resumed.actions[0].status, 'completed');

const v3DependentPath = join(
  workDir,
  'task-groups',
  'tg-root',
  'versions',
  'tgv-root-v3',
  'tasks',
  'dependent.md',
);
const validDependentText = readFileSync(v3DependentPath, 'utf8');
const blockerNeedle = 'taskGroupVersionId: tgv-root-v3';
const blockerOffset = validDependentText.lastIndexOf(blockerNeedle);
assert.ok(blockerOffset > 0);
writeFileSync(
  v3DependentPath,
  validDependentText.slice(0, blockerOffset)
    + 'taskGroupVersionId: tgv-root-v2'
    + validDependentText.slice(blockerOffset + blockerNeedle.length),
  'utf8',
);
const invalid = parseProject(workDir);
assert.ok(invalid.errors.some((error) => error.includes('depends on superseded internal version')));
const next = computeNextAction(workDir);
assert.equal(next.action, 'no_runnable');
assert.equal(next.target, null);
assert.throws(
  () => runTaskOps(workDir, {
    executor: 'dry-run',
    maxSteps: 1,
    targetTaskId: 'dependent',
    targetTaskGroupVersionId: 'tgv-root-v3',
    allowConcurrentTarget: true,
  }),
  /Cannot start runner|validation error/i,
);
rmSync(tempRoot, { recursive: true, force: true });
console.log('OK restart blockedBy rebase');
