import { dirname, join } from 'node:path';

function requireFn(io, name) {
  const fn = io?.[name];
  if (typeof fn !== 'function') throw new Error(`Missing ${name} adapter`);
  return fn;
}

export function updateMarkdownFrontmatter(filePath, updater, io) {
  if (!io || typeof io !== 'object') throw new Error('Missing state writer I/O adapter');
  const parseMarkdownFile = requireFn(io, 'parseMarkdownFile');
  const readBody = requireFn(io, 'readBody');
  const fmBlock = requireFn(io, 'fmBlock');
  const writeTextFile = requireFn(io, 'writeTextFile');

  const fm = parseMarkdownFile(filePath);
  const body = readBody(filePath);
  const next = updater({ ...fm }) ?? fm;
  const text = fmBlock(next) + (body ? body + '\n' : '');
  writeTextFile(filePath, text);
  return next;
}

export function appendRunEvent(eventsPath, event, io) {
  const appendTextFile = requireFn(io, 'appendTextFile');
  appendTextFile(eventsPath, JSON.stringify(event) + '\n');
}

export function appendRunLogEntry(runDir, line, io) {
  const exists = requireFn(io, 'exists');
  const writeTextFile = requireFn(io, 'writeTextFile');
  const appendTextFile = requireFn(io, 'appendTextFile');
  const logPath = join(runDir, 'run-log.md');
  if (!exists(logPath)) writeTextFile(logPath, '# Run log\n\n');
  appendTextFile(logPath, `- ${line}\n`);
}

export function writeRunEdgeFile({ runDir, runId, edgeId, fromRunNodeId, toRunNodeId, edgeType, createdAt, note }, io) {
  const exists = requireFn(io, 'exists');
  const writeTextFile = requireFn(io, 'writeTextFile');
  const fmBlock = requireFn(io, 'fmBlock');
  const sanitize = typeof io?.sanitizeFmScalar === 'function' ? io.sanitizeFmScalar : (value) => value;
  const edgePath = join(runDir, 'edges', `${edgeId}.md`);
  if (exists(edgePath)) return edgePath;
  const fm = {
    taskOpsVersion: 'v1',
    entityType: 'runEdge',
    id: edgeId,
    runId,
    fromRunNodeId,
    toRunNodeId,
    edgeType,
    createdAt,
    status: 'done',
  };
  if (note) fm.note = sanitize(note);
  writeTextFile(edgePath, fmBlock(fm) + `# Run edge: ${fromRunNodeId} -${edgeType}-> ${toRunNodeId}\n`);
  return edgePath;
}

export function ensureRunNodeFile({ runDir, runId, runNodeId, type, title, sourceTaskId, sourceTaskGroupVersionId, status = 'active', kindLabel }, io) {
  const exists = requireFn(io, 'exists');
  const writeTextFile = requireFn(io, 'writeTextFile');
  const fmBlock = requireFn(io, 'fmBlock');
  const updateFrontmatter = requireFn(io, 'updateMarkdownFrontmatter');
  const now = requireFn(io, 'now');
  const runNodePath = join(runDir, 'nodes', `${runNodeId}.md`);
  if (!exists(runNodePath)) {
    const nodeFm = {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id: runNodeId,
      runId,
      type,
      title,
      status,
      createdAt: now(),
    };
    if (sourceTaskId != null && sourceTaskId !== '') nodeFm.sourceTaskId = sourceTaskId;
    if (sourceTaskGroupVersionId != null && sourceTaskGroupVersionId !== '') nodeFm.sourceTaskGroupVersionId = sourceTaskGroupVersionId;
    const heading = sourceTaskId ? `Run node: ${sourceTaskId} (${kindLabel || type})` : `Run node: ${runNodeId} (${kindLabel || type})`;
    writeTextFile(runNodePath, fmBlock(nodeFm) + `# ${heading}\n`);
  } else {
    updateFrontmatter(runNodePath, (fm) => {
      fm.status = status;
      return fm;
    });
  }
  return runNodePath;
}

export function attachTaskRunRef(taskPath, runId, runNodeId, role, io) {
  const updateFrontmatter = requireFn(io, 'updateMarkdownFrontmatter');
  updateFrontmatter(taskPath, (fm) => {
    if (fm.status === 'pending') fm.status = 'active';
    const refs = Array.isArray(fm.runRefs) ? [...fm.runRefs] : [];
    if (!refs.some((r) => r && r.runId === runId && r.runNodeId === runNodeId)) {
      refs.push({ runId, runNodeId, role });
    }
    fm.runRefs = refs;
    return fm;
  });
}

function applyApprovedReviewToEow(fm, approvedReview) {
  if (!approvedReview) return;
  fm.approvedByReviewNodeId = approvedReview.reviewNodeId;
  fm.approvedReviewMode = approvedReview.reviewMode;
  fm.approvedReviewReportHash = approvedReview.reviewReportHash;
  fm.reviewedAcceptanceHash = approvedReview.reviewedAcceptanceHash;
  fm.reviewedResultHash = approvedReview.reviewedResultHash;
}

export function closeRunNodeWithEowFiles({ runDir, runId, runNodeId, reason, finishedAt, approvedReview = null, resolvedByTaskGroupId = null }, io) {
  const exists = requireFn(io, 'exists');
  const writeTextFile = requireFn(io, 'writeTextFile');
  const fmBlock = requireFn(io, 'fmBlock');
  const eowRunNodeId = `eow-${runNodeId}`;
  const eowRunPath = join(runDir, 'nodes', `${eowRunNodeId}.md`);
  if (!exists(eowRunPath)) {
    const eowFm = {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: eowRunNodeId,
      runId,
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: runNodeId,
      reason,
      declaredBy: 'taskops-runner',
      declaredAt: finishedAt,
      createdAt: finishedAt,
      status: 'done',
    };
    if (resolvedByTaskGroupId != null && resolvedByTaskGroupId !== '') eowFm.resolvedByTaskGroupId = resolvedByTaskGroupId;
    applyApprovedReviewToEow(eowFm, approvedReview);
    writeTextFile(eowRunPath, fmBlock(eowFm) + `# EoW: ${runNodeId}\n`);
  }
  const edgeId = `edge-${runNodeId}-to-eow`;
  const edgePath = join(runDir, 'edges', `${edgeId}.md`);
  if (!exists(edgePath)) {
    const edgeFm = {
      taskOpsVersion: 'v1',
      entityType: 'runEdge',
      id: edgeId,
      runId,
      fromRunNodeId: runNodeId,
      toRunNodeId: eowRunNodeId,
      edgeType: 'closes_with',
      createdAt: finishedAt,
      status: 'done',
    };
    writeTextFile(edgePath, fmBlock(edgeFm) + `# Run edge: ${runNodeId} closes with EoW\n`);
  }
}

export function closeTaskWithEowFile({ task, reason, finishedAt, approvedReview = null, resolvedByTaskGroupId = null }, io) {
  const exists = requireFn(io, 'exists');
  const writeTextFile = requireFn(io, 'writeTextFile');
  const fmBlock = requireFn(io, 'fmBlock');
  const ensureDir = requireFn(io, 'ensureDir');
  const versionDir = dirname(dirname(task.path));
  const eowTaskId = `eow-${task.id}`;
  const eowTaskDir = join(versionDir, 'eow');
  ensureDir(eowTaskDir);
  const eowTaskPath = join(eowTaskDir, `${eowTaskId}.md`);
  if (!exists(eowTaskPath)) {
    const eowFm = {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: eowTaskId,
      graphType: 'task',
      attachedToType: 'task',
      attachedToId: task.id,
      reason,
      declaredBy: 'taskops-runner',
      declaredAt: finishedAt,
      createdAt: finishedAt,
      status: 'done',
    };
    if (resolvedByTaskGroupId != null && resolvedByTaskGroupId !== '') eowFm.resolvedByTaskGroupId = resolvedByTaskGroupId;
    applyApprovedReviewToEow(eowFm, approvedReview);
    writeTextFile(eowTaskPath, fmBlock(eowFm) + `# EoW: ${task.id}\n`);
  }
}
