import { dirname, join } from 'node:path';
import { validateRunNodeActionIdentity } from './lib-run-closure.js';

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

export function ensureRunNodeFile({
  runDir,
  runId,
  runNodeId,
  type,
  title,
  sourceTaskId,
  sourceTaskGroupVersionId,
  status = 'active',
  kindLabel,
  actionKind,
  attempt,
  predecessorRunNodeId = null,
}, io) {
  const exists = requireFn(io, 'exists');
  const writeTextFile = requireFn(io, 'writeTextFile');
  const fmBlock = requireFn(io, 'fmBlock');
  const parseMarkdownFile = requireFn(io, 'parseMarkdownFile');
  const updateFrontmatter = requireFn(io, 'updateMarkdownFrontmatter');
  const now = requireFn(io, 'now');
  const runNodePath = join(runDir, 'nodes', `${runNodeId}.md`);
  if (!exists(runNodePath)) {
    const actionIdentity = validateRunNodeActionIdentity({
      type,
      actionKind,
      requireActionKind: true,
    });
    if (!actionIdentity.valid) throw new Error(actionIdentity.issues[0]);
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
    nodeFm.actionKind = actionIdentity.actionKind;
    if (attempt != null) nodeFm.attempt = attempt;
    if (predecessorRunNodeId) nodeFm.predecessorRunNodeId = predecessorRunNodeId;
    const heading = sourceTaskId ? `Run node: ${sourceTaskId} (${kindLabel || type})` : `Run node: ${runNodeId} (${kindLabel || type})`;
    writeTextFile(runNodePath, fmBlock(nodeFm) + `# ${heading}\n`);
  } else {
    const current = parseMarkdownFile(runNodePath);
    if (actionKind != null && actionKind !== '') {
      const actionIdentity = validateRunNodeActionIdentity({
        type,
        actionKind,
        requireActionKind: true,
      });
      if (!actionIdentity.valid) throw new Error(actionIdentity.issues[0]);
    }
    for (const [field, expected] of Object.entries({
      runId,
      type,
      sourceTaskId,
      sourceTaskGroupVersionId,
      actionKind,
      attempt,
    })) {
      if (expected != null && current[field] !== expected) {
        throw new Error(`Immutable run-node identity mismatch for ${runNodeId}: ${field}`);
      }
    }
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
  // P1: persist the assurance tier on the freshly-created EoW too — the reviewTarget path already stamps
  // existing EoWs (attachApprovedReviewToExistingEows); without this a runner close loses the tier and the
  // audit assurance ledger cannot tell a self_verified close from a verified one.
  if (approvedReview.assuranceTier) fm.assuranceTier = approvedReview.assuranceTier;
  if (approvedReview.externallyVerified != null) fm.externallyVerified = approvedReview.externallyVerified === true;
  // P0-3: persist the oracle-consumption type on the fresh EoW (the OTHER stamp site lives in
  // attachApprovedReviewToExistingEows — both must stay in lockstep). Guarded: an approvedReview minted
  // before P0-3 carries no oracleAccess and must not stamp one (audit reads absence as 'unknown').
  if (approvedReview.oracleAccess) fm.oracleAccess = approvedReview.oracleAccess;
}

export function closeRunNodeWithEowFiles({ runDir, runId, runNodeId, reason, finishedAt, closureRole, approvedReview = null, resolvedByTaskGroupId = null }, io) {
  const exists = requireFn(io, 'exists');
  const writeTextFile = requireFn(io, 'writeTextFile');
  const fmBlock = requireFn(io, 'fmBlock');
  const parseMarkdownFile = requireFn(io, 'parseMarkdownFile');
  if (!['supporting', 'claim-bearing'].includes(closureRole)) {
    throw new Error(`Invalid run EoW closureRole '${closureRole}' for ${runNodeId}`);
  }
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
      closureRole,
      declaredBy: 'taskops-runner',
      declaredAt: finishedAt,
      createdAt: finishedAt,
      status: 'done',
    };
    if (resolvedByTaskGroupId != null && resolvedByTaskGroupId !== '') eowFm.resolvedByTaskGroupId = resolvedByTaskGroupId;
    applyApprovedReviewToEow(eowFm, approvedReview);
    writeTextFile(eowRunPath, fmBlock(eowFm) + `# EoW: ${runNodeId}\n`);
  } else {
    const current = parseMarkdownFile(eowRunPath);
    for (const [field, expected] of Object.entries({
      runId,
      attachedToId: runNodeId,
      reason,
      closureRole,
    })) {
      if (current[field] !== expected) {
        throw new Error(`Immutable run EoW mismatch for ${runNodeId}: ${field}`);
      }
    }
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
  const parseMarkdownFile = requireFn(io, 'parseMarkdownFile');
  const versionDir = dirname(dirname(task.path));
  const versionIndexPath = join(versionDir, 'index.md');
  const version = exists(versionIndexPath) ? parseMarkdownFile(versionIndexPath) : null;
  const supersedesVersion = Boolean(
    version?.restartedFromVersionId || version?.supersedesVersionId,
  );
  const eowTaskId = supersedesVersion
    ? `eow-${task.id}-${version.id || task.taskGroupVersionId}`
    : `eow-${task.id}`;
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
