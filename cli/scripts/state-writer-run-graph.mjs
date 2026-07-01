#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fmBlock,
  parseMarkdownFile,
  readBody,
} from '../lib-taskops.js';
import {
  appendRunEvent,
  appendRunLogEntry,
  attachTaskRunRef,
  closeRunNodeWithEowFiles,
  closeTaskWithEowFile,
  ensureRunNodeFile,
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

function legacyEnsureRunNode({ runDir, runId, runNodeId, type, title, sourceTaskId, sourceTaskGroupVersionId, status = 'active', kindLabel }) {
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

function legacyCloseRunNodeWithEow({ runDir, runId, runNodeId, reason, finishedAt, approvedReview: review = null }) {
  const eowRunNodeId = `eow-${runNodeId}`;
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
  const eowTaskId = `eow-${task.id}`;
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

function runLegacy(root) {
  const { runDir, taskPath } = seedTree(root);
  legacyAppendRunEvent(join(runDir, 'events.jsonl'), { timestamp: fixedNow, type: 'started', runId: 'run-main' });
  legacyAppendRunLog(runDir, `${fixedNow} started`);
  legacyEnsureRunNode({
    runDir, runId: 'run-main', runNodeId: 'run-node-task-a', type: 'execute',
    title: 'Execute task A', sourceTaskId: 'task-a', sourceTaskGroupVersionId: 'tgv-root-v1',
    status: 'active', kindLabel: 'execute',
  });
  legacyEnsureRunNode({
    runDir, runId: 'run-main', runNodeId: 'run-node-task-a', type: 'execute',
    title: 'Execute task A', sourceTaskId: 'task-a', sourceTaskGroupVersionId: 'tgv-root-v1',
    status: 'done', kindLabel: 'execute',
  });
  legacyAttachRunRef(taskPath, 'run-main', 'run-node-task-a', 'primary_execution');
  legacyWriteRunEdge({
    runDir, runId: 'run-main', edgeId: 'edge-custom', fromRunNodeId: 'run-node-task-a',
    toRunNodeId: 'run-node-review-task-a', edgeType: 'reviewed_by', createdAt: fixedNow,
    note: 'custom note',
  });
  legacyCloseRunNodeWithEow({ runDir, runId: 'run-main', runNodeId: 'run-node-task-a', reason: 'completed', finishedAt: fixedNow, approvedReview });
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
    status: 'active', kindLabel: 'execute',
  }, io);
  ensureRunNodeFile({
    runDir, runId: 'run-main', runNodeId: 'run-node-task-a', type: 'execute',
    title: 'Execute task A', sourceTaskId: 'task-a', sourceTaskGroupVersionId: 'tgv-root-v1',
    status: 'done', kindLabel: 'execute',
  }, io);
  attachTaskRunRef(taskPath, 'run-main', 'run-node-task-a', 'primary_execution', io);
  writeRunEdgeFile({
    runDir, runId: 'run-main', edgeId: 'edge-custom', fromRunNodeId: 'run-node-task-a',
    toRunNodeId: 'run-node-review-task-a', edgeType: 'reviewed_by', createdAt: fixedNow,
    note: 'custom note',
  }, io);
  closeRunNodeWithEowFiles({ runDir, runId: 'run-main', runNodeId: 'run-node-task-a', reason: 'completed', finishedAt: fixedNow, approvedReview }, io);
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
