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
const canonicalRunId = 'eow-v2-r.cnVuLW5vZGUrYQ.cnVuLW1haW4';
assert.equal(runNormalizationA, canonicalRunId);
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
const canonicalTaskId = 'eow-v2-t.dGFzayth.dGd2LXJvb3QtdjE';
assert.equal(taskNormalizationA, canonicalTaskId);
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

assert.deepEqual(decodeCanonicalEowId(canonicalRunId), {
  graphType: 'run',
  attachedToType: 'runNode',
  attachedToId: 'run-node+a',
  runId: 'run-main',
});
assert.deepEqual(decodeCanonicalEowId(canonicalTaskId), {
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
    canonicalRunId,
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
    canonicalTaskId,
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
  () => decodeCanonicalEowId('eow-v2-r._w.cnVu'),
  /invalid UTF-8 runNodeId/i,
);
assert.throws(
  () => decodeCanonicalEowId('eow-v2-r.YR.cnVu'),
  /non-canonical runNodeId/i,
);
assert.throws(
  () => runEowId({ runId: 1, runNodeId: 'node' }),
  /runId must be a primitive string/i,
);
assert.throws(
  () => runEowId({ runId: '', runNodeId: 'node' }),
  /runId must be non-empty/i,
);
assert.throws(
  () => runEowId({
    runId: new String('run-main'),
    runNodeId: 'node',
  }),
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

const exactlyAtBudget = 'é'.repeat(126);
assert.equal(
  Buffer.byteLength(`${exactlyAtBudget}.md`, 'utf8'),
  255,
);
assert.equal(
  assertEowFilenameBudget(exactlyAtBudget),
  exactlyAtBudget,
);

const oneByteOverBudget = `${exactlyAtBudget}a`;
assert.equal(
  Buffer.byteLength(`${oneByteOverBudget}.md`, 'utf8'),
  256,
);
assert.throws(
  () => assertEowFilenameBudget(oneByteOverBudget),
  /255 UTF-8 bytes \(256\)/i,
);

console.log('eow identity codec checks passed');
