function safePart(value) {
  return String(value || 'unknown')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function inferredActionKind(node) {
  if (node.actionKind) return node.actionKind;
  return {
    implementation: 'execute',
    decomposition: 'decompose',
    exploration: 'explore',
    prototype: 'prototype',
    loopback: 'loopback',
    review: 'review',
    delegate: 'delegate',
  }[node.type] || node.type || 'unknown';
}

export function allocateRunNodeIdentity({
  taskId,
  taskGroupVersionId,
  actionKind,
  existingNodes = [],
} = {}) {
  if (!taskId || !taskGroupVersionId || !actionKind) {
    throw new Error('taskId, taskGroupVersionId, and actionKind are required');
  }
  const sameTask = existingNodes.filter((node) => (
    node?.sourceTaskId === taskId
    && node?.sourceTaskGroupVersionId === taskGroupVersionId
  ));
  const sameAction = sameTask
    .filter((node) => inferredActionKind(node) === actionKind)
    .sort((a, b) => Number(a.attempt || 1) - Number(b.attempt || 1));
  const attempt = sameAction.length === 0
    ? 1
    : Math.max(...sameAction.map((node) => Number(node.attempt || 1))) + 1;
  const base = `run-node-${safePart(taskId)}`;
  const runNodeId = !existingNodes.some((node) => node?.id === base)
    ? base
    : `run-node-${safePart(taskGroupVersionId)}-${safePart(taskId)}-${safePart(actionKind)}-a${attempt}`;
  if (existingNodes.some((node) => node?.id === runNodeId)) {
    throw new Error(`Run node identity collision: ${runNodeId}`);
  }
  return {
    runNodeId,
    actionKind,
    attempt,
    predecessorRunNodeId: sameAction.at(-1)?.id || null,
  };
}
