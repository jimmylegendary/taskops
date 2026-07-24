#!/usr/bin/env node
import assert from 'node:assert/strict';
import { allocateRunNodeIdentity } from '../lib-run-identity.js';

const first = allocateRunNodeIdentity({
  taskId: 'task-a',
  taskGroupVersionId: 'tgv-a-v1',
  actionKind: 'explore',
  existingNodes: [],
});
assert.deepEqual(first, {
  runNodeId: 'run-node-task-a',
  actionKind: 'explore',
  attempt: 1,
  predecessorRunNodeId: null,
});

const decompose = allocateRunNodeIdentity({
  taskId: 'task-a',
  taskGroupVersionId: 'tgv-a-v1',
  actionKind: 'decompose',
  existingNodes: [{
    id: first.runNodeId,
    sourceTaskId: 'task-a',
    sourceTaskGroupVersionId: 'tgv-a-v1',
    actionKind: 'explore',
    attempt: 1,
  }],
});
assert.equal(decompose.runNodeId, 'run-node-tgv-a-v1-task-a-decompose-a1');
assert.equal(decompose.attempt, 1);
assert.equal(decompose.predecessorRunNodeId, null);

const retry = allocateRunNodeIdentity({
  taskId: 'task-a',
  taskGroupVersionId: 'tgv-a-v1',
  actionKind: 'execute',
  existingNodes: [
    {
      id: 'run-node-task-a',
      sourceTaskId: 'task-a',
      sourceTaskGroupVersionId: 'tgv-a-v1',
      actionKind: 'execute',
      attempt: 1,
    },
  ],
});
assert.equal(retry.runNodeId, 'run-node-tgv-a-v1-task-a-execute-a2');
assert.equal(retry.attempt, 2);
assert.equal(retry.predecessorRunNodeId, 'run-node-task-a');

const sameIdNewVersion = allocateRunNodeIdentity({
  taskId: 'task-a',
  taskGroupVersionId: 'tgv-a-v2',
  actionKind: 'execute',
  existingNodes: [{
    id: 'run-node-task-a',
    sourceTaskId: 'task-a',
    sourceTaskGroupVersionId: 'tgv-a-v1',
    actionKind: 'execute',
    attempt: 1,
  }],
});
assert.equal(
  sameIdNewVersion.runNodeId,
  'run-node-tgv-a-v2-task-a-execute-a1',
);
console.log('OK run node action/attempt identity');
