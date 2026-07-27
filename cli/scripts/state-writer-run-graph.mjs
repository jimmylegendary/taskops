#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fmBlock,
  parseMarkdownFile,
  readBody,
} from '../lib-taskops.js';
import {
  legacyQualifiedRunEowId,
  legacyQualifiedTaskEowId,
  runEowId,
  taskEowId,
} from '../lib-run-identity.js';
import {
  appendRunEvent,
  appendRunLogEntry,
  attachTaskRunRef,
  closeRunNodeWithEowFiles,
  closeTaskWithEowFile,
  ensureRunNodeFile,
  resolveExistingRunEowFile,
  resolveExistingTaskEowFile,
  updateMarkdownFrontmatter,
  writeRunEdgeFile,
} from '../lib-state-writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-state-writer-run-graph-'));
const fixedNow = '2026-06-30T00:00:00.000Z';
const approvedReview = {
  reviewNodeId: 'run-node-review-task-a',
  reviewMode: 'guarded',
  reviewReportHash: 'sha256:review',
  reviewedAcceptanceHash: 'sha256:acceptance',
  reviewedResultHash: 'sha256:result',
};

function sanitizeFmScalar(value) {
  return String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function writeTextFile(filePath, text) {
  writeFileSync(filePath, text, 'utf8');
}

function appendTextFile(filePath, text) {
  appendFileSync(filePath, text, 'utf8');
}

function updateFrontmatter(filePath, updater) {
  return updateMarkdownFrontmatter(filePath, updater, {
    parseMarkdownFile,
    readBody,
    fmBlock,
    writeTextFile,
  });
}

function stateWriterIo() {
  return {
    appendTextFile,
    ensureDir: (dir) => mkdirSync(dir, { recursive: true }),
    exists: existsSync,
    fmBlock,
    now: () => fixedNow,
    parseMarkdownFile,
    readBody,
    sanitizeFmScalar,
    updateMarkdownFrontmatter: updateFrontmatter,
    writeTextFile,
  };
}

function legacyUpdateFrontmatter(filePath, updater) {
  const fm = parseMarkdownFile(filePath);
  const body = readBody(filePath);
  const next = updater({ ...fm }) ?? fm;
  writeFileSync(filePath, fmBlock(next) + (body ? body + '\n' : ''), 'utf8');
}

function legacyAppendRunEvent(eventsPath, event) {
  appendFileSync(eventsPath, JSON.stringify(event) + '\n', 'utf8');
}

function legacyAppendRunLog(runDir, line) {
  const logPath = join(runDir, 'run-log.md');
  if (!existsSync(logPath)) writeFileSync(logPath, '# Run log\n\n', 'utf8');
  appendFileSync(logPath, `- ${line}\n`, 'utf8');
}

function legacyWriteRunEdge({ runDir, runId, edgeId, fromRunNodeId, toRunNodeId, edgeType, createdAt, note }) {
  const edgePath = join(runDir, 'edges', `${edgeId}.md`);
  if (existsSync(edgePath)) return edgePath;
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
  if (note) fm.note = sanitizeFmScalar(note);
  writeFileSync(edgePath, fmBlock(fm) + `# Run edge: ${fromRunNodeId} -${edgeType}-> ${toRunNodeId}\n`, 'utf8');
  return edgePath;
}

function legacyEnsureRunNode({
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
}) {
  const runNodePath = join(runDir, 'nodes', `${runNodeId}.md`);
  if (!existsSync(runNodePath)) {
    const nodeFm = {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id: runNodeId,
      runId,
      type,
      title,
      status,
      createdAt: fixedNow,
    };
    if (sourceTaskId != null && sourceTaskId !== '') nodeFm.sourceTaskId = sourceTaskId;
    if (sourceTaskGroupVersionId != null && sourceTaskGroupVersionId !== '') nodeFm.sourceTaskGroupVersionId = sourceTaskGroupVersionId;
    if (actionKind != null && actionKind !== '') nodeFm.actionKind = actionKind;
    if (attempt != null) nodeFm.attempt = attempt;
    if (predecessorRunNodeId) nodeFm.predecessorRunNodeId = predecessorRunNodeId;
    const heading = sourceTaskId ? `Run node: ${sourceTaskId} (${kindLabel || type})` : `Run node: ${runNodeId} (${kindLabel || type})`;
    writeFileSync(runNodePath, fmBlock(nodeFm) + `# ${heading}\n`, 'utf8');
  } else {
    legacyUpdateFrontmatter(runNodePath, (fm) => {
      fm.status = status;
      return fm;
    });
  }
  return runNodePath;
}

function legacyAttachRunRef(taskPath, runId, runNodeId, role) {
  legacyUpdateFrontmatter(taskPath, (fm) => {
    if (fm.status === 'pending') fm.status = 'active';
    const refs = Array.isArray(fm.runRefs) ? [...fm.runRefs] : [];
    if (!refs.some((r) => r && r.runId === runId && r.runNodeId === runNodeId)) {
      refs.push({ runId, runNodeId, role });
    }
    fm.runRefs = refs;
    return fm;
  });
}

function applyApprovedReviewToEow(fm) {
  fm.approvedByReviewNodeId = approvedReview.reviewNodeId;
  fm.approvedReviewMode = approvedReview.reviewMode;
  fm.approvedReviewReportHash = approvedReview.reviewReportHash;
  fm.reviewedAcceptanceHash = approvedReview.reviewedAcceptanceHash;
  fm.reviewedResultHash = approvedReview.reviewedResultHash;
}

function legacyCloseRunNodeWithEow({ runDir, runId, runNodeId, reason, finishedAt, closureRole, approvedReview: review = null }) {
  const eowRunNodeId = runEowId({ runId, runNodeId });
  const eowRunPath = join(runDir, 'nodes', `${eowRunNodeId}.md`);
  if (!existsSync(eowRunPath)) {
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
    if (review) applyApprovedReviewToEow(eowFm);
    writeFileSync(eowRunPath, fmBlock(eowFm) + `# EoW: ${runNodeId}\n`, 'utf8');
  }
  const edgeId = `edge-${runNodeId}-to-eow`;
  const edgePath = join(runDir, 'edges', `${edgeId}.md`);
  if (!existsSync(edgePath)) {
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
    writeFileSync(edgePath, fmBlock(edgeFm) + `# Run edge: ${runNodeId} closes with EoW\n`, 'utf8');
  }
}

function legacyCloseTaskWithEow({ task, reason, finishedAt, approvedReview: review = null }) {
  const versionDir = dirname(dirname(task.path));
  const taskGroupVersionId = basename(versionDir);
  const eowTaskId = taskEowId({
    taskGroupVersionId,
    taskId: task.id,
  });
  const eowTaskDir = join(versionDir, 'eow');
  mkdirSync(eowTaskDir, { recursive: true });
  const eowTaskPath = join(eowTaskDir, `${eowTaskId}.md`);
  if (!existsSync(eowTaskPath)) {
    const eowFm = {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: eowTaskId,
      graphType: 'task',
      attachedToType: 'task',
      attachedToId: task.id,
      taskGroupVersionId,
      reason,
      declaredBy: 'taskops-runner',
      declaredAt: finishedAt,
      createdAt: finishedAt,
      status: 'done',
    };
    if (review) applyApprovedReviewToEow(eowFm);
    writeFileSync(eowTaskPath, fmBlock(eowFm) + `# EoW: ${task.id}\n`, 'utf8');
  }
}

function seedTree(root) {
  const runDir = join(root, 'runs', 'run-main');
  const taskDir = join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'tasks');
  mkdirSync(join(runDir, 'nodes'), { recursive: true });
  mkdirSync(join(runDir, 'edges'), { recursive: true });
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(runDir, 'events.jsonl'), '', 'utf8');
  writeFileSync(join(taskDir, 'task-a.md'), [
    '---',
    'taskOpsVersion: v1',
    'entityType: task',
    'id: task-a',
    'status: pending',
    'runReadiness: runnable',
    '---',
    '# Task A',
    '',
  ].join('\n'), 'utf8');
  return { runDir, taskPath: join(taskDir, 'task-a.md') };
}

function seedRunEow(path, {
  id,
  runId,
  runNodeId,
  reason = 'manual_close',
  closureRole = 'supporting',
  resolvedByTaskGroupId = null,
}) {
  const fm = {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id,
    runId,
    graphType: 'run',
    attachedToType: 'runNode',
    attachedToId: runNodeId,
    reason,
    closureRole,
    declaredBy: 'fixture',
    declaredAt: fixedNow,
    createdAt: fixedNow,
    status: 'done',
  };
  if (resolvedByTaskGroupId) {
    fm.resolvedByTaskGroupId = resolvedByTaskGroupId;
  }
  writeFileSync(path, fmBlock(fm) + `# EoW: ${runNodeId}\n`, 'utf8');
}

function seedTaskEow(path, {
  id,
  taskGroupVersionId,
  taskId,
  reason = 'completed',
  resolvedByTaskGroupId = null,
}) {
  mkdirSync(dirname(path), { recursive: true });
  const fm = {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id,
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: taskId,
    taskGroupVersionId,
    reason,
    declaredBy: 'fixture',
    declaredAt: fixedNow,
    createdAt: fixedNow,
    status: 'done',
  };
  if (resolvedByTaskGroupId) {
    fm.resolvedByTaskGroupId = resolvedByTaskGroupId;
  }
  writeFileSync(path, fmBlock(fm) + `# EoW: ${taskId}\n`, 'utf8');
}

function runLegacy(root) {
  const { runDir, taskPath } = seedTree(root);
  legacyAppendRunEvent(join(runDir, 'events.jsonl'), { timestamp: fixedNow, type: 'started', runId: 'run-main' });
  legacyAppendRunLog(runDir, `${fixedNow} started`);
  legacyEnsureRunNode({
    runDir, runId: 'run-main', runNodeId: 'run-node-task-a', type: 'execute',
    title: 'Execute task A', sourceTaskId: 'task-a', sourceTaskGroupVersionId: 'tgv-root-v1',
    status: 'active', kindLabel: 'execute', actionKind: 'execute', attempt: 1,
  });
  legacyEnsureRunNode({
    runDir, runId: 'run-main', runNodeId: 'run-node-task-a', type: 'execute',
    title: 'Execute task A', sourceTaskId: 'task-a', sourceTaskGroupVersionId: 'tgv-root-v1',
    status: 'done', kindLabel: 'execute', actionKind: 'execute', attempt: 1,
  });
  legacyAttachRunRef(taskPath, 'run-main', 'run-node-task-a', 'primary_execution');
  legacyWriteRunEdge({
    runDir, runId: 'run-main', edgeId: 'edge-custom', fromRunNodeId: 'run-node-task-a',
    toRunNodeId: 'run-node-review-task-a', edgeType: 'reviewed_by', createdAt: fixedNow,
    note: 'custom note',
  });
  legacyCloseRunNodeWithEow({ runDir, runId: 'run-main', runNodeId: 'run-node-task-a', reason: 'completed', closureRole: 'supporting', finishedAt: fixedNow, approvedReview });
  legacyCloseTaskWithEow({ task: { id: 'task-a', path: taskPath }, reason: 'completed', finishedAt: fixedNow, approvedReview });
}

function runFacade(root) {
  const { runDir, taskPath } = seedTree(root);
  const io = stateWriterIo();
  appendRunEvent(join(runDir, 'events.jsonl'), { timestamp: fixedNow, type: 'started', runId: 'run-main' }, io);
  appendRunLogEntry(runDir, `${fixedNow} started`, io);
  ensureRunNodeFile({
    runDir, runId: 'run-main', runNodeId: 'run-node-task-a', type: 'execute',
    title: 'Execute task A', sourceTaskId: 'task-a', sourceTaskGroupVersionId: 'tgv-root-v1',
    status: 'active', kindLabel: 'execute', actionKind: 'execute', attempt: 1,
  }, io);
  ensureRunNodeFile({
    runDir, runId: 'run-main', runNodeId: 'run-node-task-a', type: 'execute',
    title: 'Execute task A', sourceTaskId: 'task-a', sourceTaskGroupVersionId: 'tgv-root-v1',
    status: 'done', kindLabel: 'execute', actionKind: 'execute', attempt: 1,
  }, io);
  attachTaskRunRef(taskPath, 'run-main', 'run-node-task-a', 'primary_execution', io);
  writeRunEdgeFile({
    runDir, runId: 'run-main', edgeId: 'edge-custom', fromRunNodeId: 'run-node-task-a',
    toRunNodeId: 'run-node-review-task-a', edgeType: 'reviewed_by', createdAt: fixedNow,
    note: 'custom note',
  }, io);
  closeRunNodeWithEowFiles({ runDir, runId: 'run-main', runNodeId: 'run-node-task-a', reason: 'completed', closureRole: 'supporting', finishedAt: fixedNow, approvedReview }, io);
  closeTaskWithEowFile({ task: { id: 'task-a', path: taskPath }, reason: 'completed', finishedAt: fixedNow, approvedReview }, io);
}

function treeSnapshot(root) {
  const entries = {};
  function walk(dir) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) {
        walk(path);
      } else {
        entries[relative(root, path)] = readFileSync(path, 'utf8');
      }
    }
  }
  walk(root);
  return entries;
}

const legacyRoot = join(tempRoot, 'legacy');
const facadeRoot = join(tempRoot, 'facade');
runLegacy(legacyRoot);
runFacade(facadeRoot);
assert.deepEqual(treeSnapshot(facadeRoot), treeSnapshot(legacyRoot), 'run graph/EoW facade output should match legacy output byte-for-byte');
assert.equal(
  resolveExistingRunEowFile({
    runDir: join(facadeRoot, 'runs', 'run-main'),
    runId: 'run-main',
    runNodeId: 'run-node-task-a',
  }, stateWriterIo()).format,
  'canonical-v2',
);
assert.equal(
  resolveExistingTaskEowFile({
    versionDir: join(
      facadeRoot,
      'task-groups',
      'tg-root',
      'versions',
      'tgv-root-v1',
    ),
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
  }, stateWriterIo()).format,
  'canonical-v2',
);
assert.throws(
  () => closeRunNodeWithEowFiles({
    runDir: join(facadeRoot, 'runs', 'run-main'),
    runId: 'run-main',
    runNodeId: 'run-node-task-a',
    reason: 'different-reason',
    closureRole: 'supporting',
    finishedAt: fixedNow,
  }, stateWriterIo()),
  /Immutable run EoW mismatch for run-node-task-a: reason/,
);
assert.throws(
  () => closeRunNodeWithEowFiles({
    runDir: join(facadeRoot, 'runs', 'run-main'),
    runId: 'run-main',
    runNodeId: 'run-node-task-a',
    reason: 'completed',
    closureRole: 'claim-bearing',
    finishedAt: fixedNow,
  }, stateWriterIo()),
  /Immutable run EoW mismatch for run-node-task-a: closureRole/,
);

const qualifiedRunDir = seedTree(
  join(tempRoot, 'qualified-run-reuse'),
).runDir;
const qualifiedId = legacyQualifiedRunEowId({
  runId: 'run-qualified',
  runNodeId: 'run-node-qualified',
});
seedRunEow(join(qualifiedRunDir, 'nodes', `${qualifiedId}.md`), {
  id: qualifiedId,
  runId: 'run-qualified',
  runNodeId: 'run-node-qualified',
});
const qualifiedRunPath = join(
  qualifiedRunDir,
  'nodes',
  `${qualifiedId}.md`,
);
const qualifiedRunBefore = readFileSync(qualifiedRunPath, 'utf8');
const resolvedQualifiedRun = resolveExistingRunEowFile({
  runDir: qualifiedRunDir,
  runId: 'run-qualified',
  runNodeId: 'run-node-qualified',
}, stateWriterIo());
assert.equal(resolvedQualifiedRun.id, qualifiedId);
assert.equal(resolvedQualifiedRun.path, qualifiedRunPath);
assert.equal(resolvedQualifiedRun.frontmatter.attachedToId, 'run-node-qualified');
assert.equal(resolvedQualifiedRun.format, 'qualified-v1');
closeRunNodeWithEowFiles({
  runDir: qualifiedRunDir,
  runId: 'run-qualified',
  runNodeId: 'run-node-qualified',
  reason: 'manual_close',
  closureRole: 'supporting',
  finishedAt: fixedNow,
}, stateWriterIo());
assert.equal(
  parseMarkdownFile(
    join(
      qualifiedRunDir,
      'edges',
      'edge-run-node-qualified-to-eow.md',
    ),
  ).toRunNodeId,
  qualifiedId,
);
assert.equal(
  existsSync(join(
    qualifiedRunDir,
    'nodes',
    `${runEowId({
      runId: 'run-qualified',
      runNodeId: 'run-node-qualified',
    })}.md`,
  )),
  false,
);
assert.equal(readFileSync(qualifiedRunPath, 'utf8'), qualifiedRunBefore);

const unqualifiedRunDir = seedTree(
  join(tempRoot, 'unqualified-run-reuse'),
).runDir;
const unqualifiedId = 'eow-run-node-unqualified';
seedRunEow(
  join(unqualifiedRunDir, 'nodes', `${unqualifiedId}.md`),
  {
    id: unqualifiedId,
    runId: 'run-unqualified',
    runNodeId: 'run-node-unqualified',
  },
);
assert.equal(
  resolveExistingRunEowFile({
    runDir: unqualifiedRunDir,
    runId: 'run-unqualified',
    runNodeId: 'run-node-unqualified',
  }, stateWriterIo()).format,
  'unqualified-v0',
);
closeRunNodeWithEowFiles({
  runDir: unqualifiedRunDir,
  runId: 'run-unqualified',
  runNodeId: 'run-node-unqualified',
  reason: 'manual_close',
  closureRole: 'supporting',
  finishedAt: fixedNow,
}, stateWriterIo());
assert.equal(
  parseMarkdownFile(join(
    unqualifiedRunDir,
    'edges',
    'edge-run-node-unqualified-to-eow.md',
  )).toRunNodeId,
  unqualifiedId,
);

const collisionRunDir = seedTree(
  join(tempRoot, 'run-collision-owner'),
).runDir;
const collisionRunId = 'run-collision';
const collisionLegacyId = legacyQualifiedRunEowId({
  runId: collisionRunId,
  runNodeId: 'run-node-a',
});
const legacyCollisionPath = join(
  collisionRunDir,
  'nodes',
  `${collisionLegacyId}.md`,
);
seedRunEow(legacyCollisionPath, {
  id: collisionLegacyId,
  runId: collisionRunId,
  runNodeId: 'run-node+a',
});
assert.equal(
  resolveExistingRunEowFile({
    runDir: collisionRunDir,
    runId: collisionRunId,
    runNodeId: 'run-node-a',
  }, stateWriterIo()),
  null,
);
const io = stateWriterIo();
const canonicalCollisionId = runEowId({
  runId: collisionRunId,
  runNodeId: 'run-node-a',
});
closeRunNodeWithEowFiles({
  runDir: collisionRunDir,
  runId: collisionRunId,
  runNodeId: 'run-node-a',
  reason: 'manual_close',
  closureRole: 'supporting',
  finishedAt: fixedNow,
}, io);
assert.equal(
  existsSync(join(collisionRunDir, 'nodes', `${canonicalCollisionId}.md`)),
  true,
);
assert.equal(
  parseMarkdownFile(
    join(collisionRunDir, 'edges', 'edge-run-node-a-to-eow.md'),
  ).toRunNodeId,
  canonicalCollisionId,
);
assert.equal(
  parseMarkdownFile(legacyCollisionPath).attachedToId,
  'run-node+a',
);

const corruptRunDir = seedTree(
  join(tempRoot, 'corrupt-canonical-run'),
).runDir;
const corruptCanonicalId = runEowId({
  runId: 'run-corrupt',
  runNodeId: 'run-node-corrupt',
});
seedRunEow(
  join(corruptRunDir, 'nodes', `${corruptCanonicalId}.md`),
  {
    id: corruptCanonicalId,
    runId: 'run-corrupt',
    runNodeId: 'run-node-other',
  },
);
assert.throws(
  () => closeRunNodeWithEowFiles({
    runDir: corruptRunDir,
    runId: 'run-corrupt',
    runNodeId: 'run-node-corrupt',
    reason: 'manual_close',
    closureRole: 'supporting',
    finishedAt: fixedNow,
  }, stateWriterIo()),
  /canonical EoW candidate.*owned by another tuple/i,
);

const idMismatchRunDir = seedTree(
  join(tempRoot, 'run-frontmatter-id-mismatch'),
).runDir;
const idMismatchRunCandidate = legacyQualifiedRunEowId({
  runId: 'run-id-mismatch',
  runNodeId: 'run-node-id-mismatch',
});
seedRunEow(
  join(idMismatchRunDir, 'nodes', `${idMismatchRunCandidate}.md`),
  {
    id: 'eow-wrong-frontmatter-id',
    runId: 'run-id-mismatch',
    runNodeId: 'run-node-id-mismatch',
  },
);
assert.throws(
  () => resolveExistingRunEowFile({
    runDir: idMismatchRunDir,
    runId: 'run-id-mismatch',
    runNodeId: 'run-node-id-mismatch',
  }, stateWriterIo()),
  /frontmatter id mismatch/i,
);

const invalidQualifiedRunDir = seedTree(
  join(tempRoot, 'invalid-qualified-run-owner'),
).runDir;
const invalidQualifiedRunCandidate = legacyQualifiedRunEowId({
  runId: 'run-invalid-qualified',
  runNodeId: 'run-node-requested',
});
seedRunEow(
  join(
    invalidQualifiedRunDir,
    'nodes',
    `${invalidQualifiedRunCandidate}.md`,
  ),
  {
    id: invalidQualifiedRunCandidate,
    runId: 'run-invalid-qualified',
    runNodeId: 'run-node-unrelated',
  },
);
assert.throws(
  () => resolveExistingRunEowFile({
    runDir: invalidQualifiedRunDir,
    runId: 'run-invalid-qualified',
    runNodeId: 'run-node-requested',
  }, stateWriterIo()),
  /Qualified EoW candidate.*owned by another tuple/,
);

const unqualifiedMismatchRunDir = seedTree(
  join(tempRoot, 'unqualified-run-owner-mismatch'),
).runDir;
const unqualifiedMismatchRunId = 'eow-run-node-unqualified-mismatch';
seedRunEow(
  join(
    unqualifiedMismatchRunDir,
    'nodes',
    `${unqualifiedMismatchRunId}.md`,
  ),
  {
    id: unqualifiedMismatchRunId,
    runId: 'run-unqualified-mismatch',
    runNodeId: 'run-node-other',
  },
);
assert.throws(
  () => resolveExistingRunEowFile({
    runDir: unqualifiedMismatchRunDir,
    runId: 'run-unqualified-mismatch',
    runNodeId: 'run-node-unqualified-mismatch',
  }, stateWriterIo()),
  /Unqualified EoW candidate.*owned by another tuple/,
);

const idMismatchTask = seedTree(
  join(tempRoot, 'task-frontmatter-id-mismatch'),
);
const idMismatchTaskVersionDir = dirname(dirname(idMismatchTask.taskPath));
const idMismatchTaskCandidate = legacyQualifiedTaskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task-a',
});
seedTaskEow(
  join(
    idMismatchTaskVersionDir,
    'eow',
    `${idMismatchTaskCandidate}.md`,
  ),
  {
    id: 'eow-wrong-task-frontmatter-id',
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
  },
);
assert.throws(
  () => resolveExistingTaskEowFile({
    versionDir: idMismatchTaskVersionDir,
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
  }, stateWriterIo()),
  /frontmatter id mismatch/i,
);

const invalidQualifiedTask = seedTree(
  join(tempRoot, 'invalid-qualified-task-owner'),
);
const invalidQualifiedTaskVersionDir = dirname(
  dirname(invalidQualifiedTask.taskPath),
);
const invalidQualifiedTaskCandidate = legacyQualifiedTaskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task-a',
});
seedTaskEow(
  join(
    invalidQualifiedTaskVersionDir,
    'eow',
    `${invalidQualifiedTaskCandidate}.md`,
  ),
  {
    id: invalidQualifiedTaskCandidate,
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-unrelated',
  },
);
assert.throws(
  () => resolveExistingTaskEowFile({
    versionDir: invalidQualifiedTaskVersionDir,
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
  }, stateWriterIo()),
  /Qualified EoW candidate.*owned by another tuple/,
);

const unqualifiedMismatchTask = seedTree(
  join(tempRoot, 'unqualified-task-owner-mismatch'),
);
const unqualifiedMismatchTaskVersionDir = dirname(
  dirname(unqualifiedMismatchTask.taskPath),
);
seedTaskEow(
  join(unqualifiedMismatchTaskVersionDir, 'eow', 'eow-task-a.md'),
  {
    id: 'eow-task-a',
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-other',
  },
);
assert.throws(
  () => resolveExistingTaskEowFile({
    versionDir: unqualifiedMismatchTaskVersionDir,
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
  }, stateWriterIo()),
  /Unqualified EoW candidate.*owned by another tuple/,
);

const qualifiedTask = seedTree(join(tempRoot, 'qualified-task-reuse'));
const qualifiedVersionDir = dirname(dirname(qualifiedTask.taskPath));
const qualifiedTaskId = legacyQualifiedTaskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task-a',
});
seedTaskEow(
  join(qualifiedVersionDir, 'eow', `${qualifiedTaskId}.md`),
  {
    id: qualifiedTaskId,
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
  },
);
const qualifiedTaskPath = join(
  qualifiedVersionDir,
  'eow',
  `${qualifiedTaskId}.md`,
);
const qualifiedTaskBefore = readFileSync(qualifiedTaskPath, 'utf8');
assert.equal(
  resolveExistingTaskEowFile({
    versionDir: qualifiedVersionDir,
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
  }, stateWriterIo()).format,
  'qualified-v1',
);
closeTaskWithEowFile({
  task: { id: 'task-a', path: qualifiedTask.taskPath },
  reason: 'completed',
  finishedAt: fixedNow,
}, stateWriterIo());
assert.equal(
  existsSync(join(
    qualifiedVersionDir,
    'eow',
    `${taskEowId({
      taskGroupVersionId: 'tgv-root-v1',
      taskId: 'task-a',
    })}.md`,
  )),
  false,
);
assert.equal(readFileSync(qualifiedTaskPath, 'utf8'), qualifiedTaskBefore);

const unqualifiedTask = seedTree(join(tempRoot, 'unqualified-task-reuse'));
const unqualifiedVersionDir = dirname(dirname(unqualifiedTask.taskPath));
seedTaskEow(
  join(unqualifiedVersionDir, 'eow', 'eow-task-a.md'),
  {
    id: 'eow-task-a',
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
  },
);
assert.equal(
  resolveExistingTaskEowFile({
    versionDir: unqualifiedVersionDir,
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
  }, stateWriterIo()).format,
  'unqualified-v0',
);
closeTaskWithEowFile({
  task: { id: 'task-a', path: unqualifiedTask.taskPath },
  reason: 'completed',
  finishedAt: fixedNow,
}, stateWriterIo());
assert.equal(
  existsSync(join(
    unqualifiedVersionDir,
    'eow',
    `${taskEowId({
      taskGroupVersionId: 'tgv-root-v1',
      taskId: 'task-a',
    })}.md`,
  )),
  false,
);

const collisionTask = seedTree(join(tempRoot, 'task-collision-owner'));
const collisionVersionDir = dirname(dirname(collisionTask.taskPath));
const collisionLegacyTaskId = 'eow-task-a-tgv-root-v1';
const collisionLegacyTaskPath = join(
  collisionVersionDir,
  'eow',
  `${collisionLegacyTaskId}.md`,
);
seedTaskEow(collisionLegacyTaskPath, {
  id: collisionLegacyTaskId,
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task+a',
});
closeTaskWithEowFile({
  task: { id: 'task-a', path: collisionTask.taskPath },
  reason: 'completed',
  finishedAt: fixedNow,
}, stateWriterIo());
const collisionCanonicalTaskId = taskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task-a',
});
assert.equal(
  parseMarkdownFile(collisionLegacyTaskPath).attachedToId,
  'task+a',
);
assert.equal(
  parseMarkdownFile(join(
    collisionVersionDir,
    'eow',
    `${collisionCanonicalTaskId}.md`,
  )).attachedToId,
  'task-a',
);

const mismatchTask = seedTree(join(tempRoot, 'task-immutable-mismatch'));
const mismatchVersionDir = dirname(dirname(mismatchTask.taskPath));
const mismatchTaskId = legacyQualifiedTaskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task-a',
});
seedTaskEow(
  join(mismatchVersionDir, 'eow', `${mismatchTaskId}.md`),
  {
    id: mismatchTaskId,
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
    reason: 'other',
  },
);
const mismatchTaskPath = mismatchTask.taskPath;

assert.throws(
  () => closeTaskWithEowFile({
    task: { id: 'task-a', path: mismatchTaskPath },
    reason: 'completed',
    finishedAt: fixedNow,
  }, stateWriterIo()),
  /Immutable task EoW mismatch.*reason/,
);

const resolvedByRunDir = seedTree(
  join(tempRoot, 'run-resolved-by-mismatch'),
).runDir;
const resolvedByRunId = legacyQualifiedRunEowId({
  runId: 'run-resolved-by',
  runNodeId: 'run-node-resolved-by',
});
seedRunEow(join(resolvedByRunDir, 'nodes', `${resolvedByRunId}.md`), {
  id: resolvedByRunId,
  runId: 'run-resolved-by',
  runNodeId: 'run-node-resolved-by',
  resolvedByTaskGroupId: 'tg-existing',
});
assert.throws(
  () => closeRunNodeWithEowFiles({
    runDir: resolvedByRunDir,
    runId: 'run-resolved-by',
    runNodeId: 'run-node-resolved-by',
    reason: 'manual_close',
    closureRole: 'supporting',
    finishedAt: fixedNow,
    resolvedByTaskGroupId: 'tg-requested',
  }, stateWriterIo()),
  /Immutable run EoW mismatch.*resolvedByTaskGroupId/,
);

const resolvedByTask = seedTree(
  join(tempRoot, 'task-resolved-by-mismatch'),
);
const resolvedByTaskVersionDir = dirname(dirname(resolvedByTask.taskPath));
const resolvedByTaskId = legacyQualifiedTaskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task-a',
});
seedTaskEow(
  join(resolvedByTaskVersionDir, 'eow', `${resolvedByTaskId}.md`),
  {
    id: resolvedByTaskId,
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
    resolvedByTaskGroupId: 'tg-existing',
  },
);
assert.throws(
  () => closeTaskWithEowFile({
    task: { id: 'task-a', path: resolvedByTask.taskPath },
    reason: 'completed',
    finishedAt: fixedNow,
    resolvedByTaskGroupId: 'tg-requested',
  }, stateWriterIo()),
  /Immutable task EoW mismatch.*resolvedByTaskGroupId/,
);

const overBudgetTaskId = 'é'.repeat(100);
const overBudgetCanonicalTaskId = taskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: overBudgetTaskId,
});
assert.ok(
  Buffer.byteLength(`${overBudgetCanonicalTaskId}.md`, 'utf8') > 255,
  'over-budget fixture must exceed the filesystem filename limit',
);
const overBudgetReuseTask = seedTree(
  join(tempRoot, 'task-over-budget-legacy-reuse'),
);
const overBudgetReuseVersionDir = dirname(
  dirname(overBudgetReuseTask.taskPath),
);
const overBudgetLegacyTaskId = legacyQualifiedTaskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: overBudgetTaskId,
});
const overBudgetLegacyTaskPath = join(
  overBudgetReuseVersionDir,
  'eow',
  `${overBudgetLegacyTaskId}.md`,
);
seedTaskEow(overBudgetLegacyTaskPath, {
  id: overBudgetLegacyTaskId,
  taskGroupVersionId: 'tgv-root-v1',
  taskId: overBudgetTaskId,
});
const overBudgetLegacyTaskBefore = readFileSync(
  overBudgetLegacyTaskPath,
  'utf8',
);
closeTaskWithEowFile({
  task: {
    id: overBudgetTaskId,
    path: overBudgetReuseTask.taskPath,
  },
  reason: 'completed',
  finishedAt: fixedNow,
}, stateWriterIo());
assert.equal(
  readFileSync(overBudgetLegacyTaskPath, 'utf8'),
  overBudgetLegacyTaskBefore,
);

const overBudgetFreshTask = seedTree(
  join(tempRoot, 'task-over-budget-fresh-write'),
);
const overBudgetFreshVersionDir = dirname(
  dirname(overBudgetFreshTask.taskPath),
);
assert.throws(
  () => closeTaskWithEowFile({
    task: {
      id: overBudgetTaskId,
      path: overBudgetFreshTask.taskPath,
    },
    reason: 'completed',
    finishedAt: fixedNow,
  }, stateWriterIo()),
  /EoW filename exceeds 255 UTF-8 bytes/,
);
assert.deepEqual(
  readdirSync(join(overBudgetFreshVersionDir, 'eow')),
  [],
  'filename budget failure must happen before a fresh EoW write',
);

const persistedRunNode = parseMarkdownFile(join(facadeRoot, 'runs', 'run-main', 'nodes', 'run-node-task-a.md'));
assert.equal(persistedRunNode.actionKind, 'execute');
assert.equal(persistedRunNode.attempt, 1);
const missingActionRunDir = seedTree(join(tempRoot, 'missing-action-kind')).runDir;
assert.throws(
  () => ensureRunNodeFile({
    runDir: missingActionRunDir,
    runId: 'run-main',
    runNodeId: 'run-node-missing-action',
    type: 'implementation',
    title: 'Missing action kind',
    status: 'active',
  }, stateWriterIo()),
  /actionKind is required/,
);
const unknownActionRunDir = seedTree(join(tempRoot, 'unknown-action-kind')).runDir;
assert.throws(
  () => ensureRunNodeFile({
    runDir: unknownActionRunDir,
    runId: 'run-main',
    runNodeId: 'run-node-unknown-action',
    type: 'implementation',
    title: 'Unknown action kind',
    status: 'active',
    actionKind: 'unknown',
  }, stateWriterIo()),
  /Unknown run-node actionKind 'unknown'/,
);
const mismatchedActionRunDir = seedTree(join(tempRoot, 'mismatched-action-kind')).runDir;
assert.throws(
  () => ensureRunNodeFile({
    runDir: mismatchedActionRunDir,
    runId: 'run-main',
    runNodeId: 'run-node-mismatched-action',
    type: 'exploration',
    title: 'Mismatched action kind',
    status: 'active',
    actionKind: 'prototype',
  }, stateWriterIo()),
  /run-node type 'exploration' does not match actionKind 'prototype'/,
);
assert.throws(
  () => ensureRunNodeFile({
    runDir: join(facadeRoot, 'runs', 'run-main'),
    runId: 'run-main',
    runNodeId: 'run-node-task-a',
    type: 'execute',
    title: 'Execute task A',
    sourceTaskId: 'task-a',
    sourceTaskGroupVersionId: 'tgv-root-v1',
    status: 'done',
    kindLabel: 'execute',
    actionKind: 'execute',
    attempt: 2,
  }, stateWriterIo()),
  /Immutable run-node identity mismatch for run-node-task-a: attempt/,
);

const runnerText = readFileSync(join(repoRoot, 'cli/lib-runner.js'), 'utf8');
function functionBody(name) {
  const index = runnerText.indexOf(`function ${name}`);
  assert.notEqual(index, -1, `missing ${name}`);
  const nextIndex = runnerText.indexOf('\nfunction ', index + 1);
  return runnerText.slice(index, nextIndex === -1 ? runnerText.length : nextIndex);
}

const wrappers = [
  ['logEvent', 'appendRunEventViaStateWriter'],
  ['appendRunLog', 'appendRunLogViaStateWriter'],
  ['writeRunEdge', 'writeRunEdgeViaStateWriter'],
  ['ensureRunNode', 'ensureRunNodeViaStateWriter'],
  ['attachRunRef', 'attachTaskRunRefViaStateWriter'],
  ['closeRunNodeWithEow', 'closeRunNodeWithEowViaStateWriter'],
  ['closeTaskWithEow', 'closeTaskWithEowViaStateWriter'],
];
for (const [name, delegate] of wrappers) {
  const body = functionBody(name);
  assert.match(body, new RegExp(delegate), `${name} should delegate through state writer`);
}

console.log('OK state writer run graph facade');
