#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  assertEowFilenameBudget,
  decodeCanonicalEowId,
  legacyQualifiedRunEowId,
  legacyQualifiedTaskEowId,
  runEowId,
  runEowIdCandidates,
  taskEowId,
  taskEowIdCandidates,
} from '../lib-run-identity.js';

const runNormalizationA = runEowId({
  runId: 'run-main',
  runNodeId: 'run-node+a',
});
const runNormalizationB = runEowId({
  runId: 'run-main',
  runNodeId: 'run-node-a',
});
assert.notEqual(runNormalizationA, runNormalizationB);

const runBoundaryA = runEowId({ runId: 'c', runNodeId: 'a-b' });
const runBoundaryB = runEowId({ runId: 'b-c', runNodeId: 'a' });
assert.notEqual(runBoundaryA, runBoundaryB);

const taskNormalizationA = taskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task+a',
});
const taskNormalizationB = taskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task-a',
});
assert.notEqual(taskNormalizationA, taskNormalizationB);

const taskBoundaryA = taskEowId({
  taskGroupVersionId: 'c',
  taskId: 'a-b',
});
const taskBoundaryB = taskEowId({
  taskGroupVersionId: 'b-c',
  taskId: 'a',
});
assert.notEqual(taskBoundaryA, taskBoundaryB);
assert.notEqual(
  runEowId({ runId: 'same', runNodeId: 'same' }),
  taskEowId({ taskGroupVersionId: 'same', taskId: 'same' }),
);

assert.deepEqual(decodeCanonicalEowId(runNormalizationA), {
  graphType: 'run',
  attachedToType: 'runNode',
  attachedToId: 'run-node+a',
  runId: 'run-main',
});
assert.deepEqual(decodeCanonicalEowId(taskNormalizationA), {
  graphType: 'task',
  attachedToType: 'task',
  attachedToId: 'task+a',
  taskGroupVersionId: 'tgv-root-v1',
});

const unicodeRunId = runEowId({
  runId: '실행-α',
  runNodeId: '노드-β',
});
assert.equal(decodeCanonicalEowId(unicodeRunId).runId, '실행-α');

const leadingBomRunId = runEowId({
  runId: '\uFEFFrun-main',
  runNodeId: 'run-node',
});
assert.equal(
  decodeCanonicalEowId(leadingBomRunId).runId,
  '\uFEFFrun-main',
);

assert.deepEqual(
  runEowIdCandidates({
    runId: 'run-main',
    runNodeId: 'run-node+a',
  }),
  [
    runNormalizationA,
    'eow-run-node-a-run-main',
    'eow-run-node+a',
  ],
);
assert.deepEqual(
  taskEowIdCandidates({
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task+a',
  }),
  [
    taskNormalizationA,
    'eow-task-a-tgv-root-v1',
    'eow-task+a',
  ],
);

assert.equal(
  legacyQualifiedRunEowId({
    runId: 'run-main',
    runNodeId: 'run-node+a',
  }),
  'eow-run-node-a-run-main',
);
assert.equal(
  legacyQualifiedTaskEowId({
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task+a',
  }),
  'eow-task-a-tgv-root-v1',
);

assert.equal(decodeCanonicalEowId('eow-run-node-a'), null);
assert.throws(
  () => decodeCanonicalEowId('eow-v2-r.A.A'),
  /malformed canonical EoW id/i,
);
assert.throws(
  () => runEowId({ runId: 1, runNodeId: 'node' }),
  /runId must be a primitive string/i,
);
assert.throws(
  () => taskEowId({
    taskGroupVersionId: 'version',
    taskId: '\uD800',
  }),
  /well-formed Unicode/i,
);

const overBudget = runEowId({
  runId: 'r'.repeat(120),
  runNodeId: 'n'.repeat(120),
});
assert.throws(
  () => assertEowFilenameBudget(overBudget),
  /255 UTF-8 bytes/i,
);

console.log('eow identity codec checks passed');
