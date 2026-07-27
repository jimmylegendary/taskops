function safePart(value) {
  return String(value || 'unknown')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

const EOW_FILENAME_LIMIT_BYTES = 255;

function requireEowComponent(value, name) {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a primitive string`);
  }
  if (value.length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
  if (!value.isWellFormed()) {
    throw new Error(`${name} must be well-formed Unicode`);
  }
  return value;
}

function encodeEowComponent(value, name) {
  return Buffer
    .from(requireEowComponent(value, name), 'utf8')
    .toString('base64url');
}

function decodeEowComponent(token, name) {
  if (!token) throw new Error(`malformed canonical EoW id: empty ${name}`);
  const bytes = Buffer.from(token, 'base64url');
  let value;
  try {
    value = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    throw new Error(`malformed canonical EoW id: invalid UTF-8 ${name}`);
  }
  if (
    value.length === 0
    || !value.isWellFormed()
    || Buffer.from(value, 'utf8').toString('base64url') !== token
  ) {
    throw new Error(`malformed canonical EoW id: non-canonical ${name}`);
  }
  return value;
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

export function runEowId({ runId, runNodeId } = {}) {
  const node = encodeEowComponent(runNodeId, 'runNodeId');
  const run = encodeEowComponent(runId, 'runId');
  return `eow-v2-r.${node}.${run}`;
}

export function taskEowId({ taskGroupVersionId, taskId } = {}) {
  const task = encodeEowComponent(taskId, 'taskId');
  const version = encodeEowComponent(
    taskGroupVersionId,
    'taskGroupVersionId',
  );
  return `eow-v2-t.${task}.${version}`;
}

export function decodeCanonicalEowId(id) {
  if (typeof id !== 'string') {
    throw new TypeError('EoW id must be a primitive string');
  }
  if (!id.startsWith('eow-v2-')) return null;
  const match = /^eow-v2-([rt])\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(id);
  if (!match) throw new Error(`malformed canonical EoW id '${id}'`);
  if (match[1] === 'r') {
    return {
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: decodeEowComponent(match[2], 'runNodeId'),
      runId: decodeEowComponent(match[3], 'runId'),
    };
  }
  return {
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: decodeEowComponent(match[2], 'taskId'),
    taskGroupVersionId: decodeEowComponent(
      match[3],
      'taskGroupVersionId',
    ),
  };
}

export function legacyQualifiedRunEowId({ runId, runNodeId } = {}) {
  const node = requireEowComponent(runNodeId, 'runNodeId');
  const run = requireEowComponent(runId, 'runId');
  return `eow-${safePart(node)}-${safePart(run)}`;
}

export function legacyQualifiedTaskEowId({
  taskGroupVersionId,
  taskId,
} = {}) {
  const task = requireEowComponent(taskId, 'taskId');
  const version = requireEowComponent(
    taskGroupVersionId,
    'taskGroupVersionId',
  );
  return `eow-${safePart(task)}-${safePart(version)}`;
}

const unique = (values) => [...new Set(values)];

export function runEowIdCandidates({ runId, runNodeId } = {}) {
  const node = requireEowComponent(runNodeId, 'runNodeId');
  const run = requireEowComponent(runId, 'runId');
  return unique([
    runEowId({ runId: run, runNodeId: node }),
    legacyQualifiedRunEowId({ runId: run, runNodeId: node }),
    `eow-${node}`,
  ]);
}

export function taskEowIdCandidates({
  taskGroupVersionId,
  taskId,
} = {}) {
  const task = requireEowComponent(taskId, 'taskId');
  const version = requireEowComponent(
    taskGroupVersionId,
    'taskGroupVersionId',
  );
  return unique([
    taskEowId({ taskGroupVersionId: version, taskId: task }),
    legacyQualifiedTaskEowId({
      taskGroupVersionId: version,
      taskId: task,
    }),
    `eow-${task}`,
  ]);
}

export function assertEowFilenameBudget(id) {
  requireEowComponent(id, 'EoW id');
  const bytes = Buffer.byteLength(`${id}.md`, 'utf8');
  if (bytes > EOW_FILENAME_LIMIT_BYTES) {
    throw new Error(
      `EoW filename exceeds 255 UTF-8 bytes (${bytes}): ${id}`,
    );
  }
  return id;
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
