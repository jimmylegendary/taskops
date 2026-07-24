#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  fmBlock,
  initProject,
  parseMarkdownFile,
  parseProject,
  readBody,
} from '../lib-taskops.js';
import {
  closeRunNodeWithEowFiles,
  closeTaskWithEowFile,
} from '../lib-state-writer.js';

const fixedNow = '2026-07-02T00:00:00.000Z';

function writeFm(filePath, frontmatter, body) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, fmBlock(frontmatter) + body, 'utf8');
}

function createBaseWork({ childTaskGroupId = null, runRefs = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'taskops-eow-resolver-'));
  initProject(root, {
    id: 'work-eow-resolver',
    title: 'EoW resolver backlink fixture',
    objective: 'Validate optional EoW resolver backlinks.',
  });

  const taskFm = {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task-root',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Root task',
    objective: 'Close root task',
    responsibility: 'Produce a closed task',
    completionCriteria: 'Task and run node have EoWs',
    order: 1,
    createdAt: fixedNow,
    status: 'done',
    runReadiness: 'runnable',
  };
  if (childTaskGroupId) taskFm.childTaskGroupId = childTaskGroupId;
  if (runRefs) taskFm.runRefs = [{ runId: 'run-main', runNodeId: 'run-node-task-root', role: 'primary_execution' }];
  writeFm(
    join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'tasks', 'task-root.md'),
    taskFm,
    '# Root task\n',
  );

  writeFm(
    join(root, 'runs', 'run-main', 'nodes', 'run-node-task-root.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id: 'run-node-task-root',
      runId: 'run-main',
      type: 'execute',
      title: 'Execute root task',
      sourceTaskId: 'task-root',
      sourceTaskGroupVersionId: 'tgv-root-v1',
      status: 'done',
      createdAt: fixedNow,
    },
    '# Run node: task-root\n',
  );

  return root;
}

function writeTaskEow(root, extra = {}) {
  writeFm(
    join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'eow', 'eow-task-root.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: 'eow-task-root',
      graphType: 'task',
      attachedToType: 'task',
      attachedToId: 'task-root',
      reason: 'completed',
      declaredBy: 'test',
      declaredAt: fixedNow,
      createdAt: fixedNow,
      status: 'done',
      ...extra,
    },
    '# EoW: task-root\n',
  );
}

function writeRunEow(root, extra = {}) {
  writeFm(
    join(root, 'runs', 'run-main', 'nodes', 'eow-run-node-task-root.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: 'eow-run-node-task-root',
      runId: 'run-main',
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'run-node-task-root',
      reason: 'completed',
      declaredBy: 'test',
      declaredAt: fixedNow,
      createdAt: fixedNow,
      status: 'done',
      ...extra,
    },
    '# EoW: run-node-task-root\n',
  );
}

function writeChildTaskGroup(root, { runNodeId = 'run-node-task-root' } = {}) {
  writeFm(
    join(root, 'task-groups', 'tg-child', 'index.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'taskGroup',
      id: 'tg-child',
      objective: 'Resolve root EoW',
      activeVersionId: 'tgv-child-v1',
      createdAt: fixedNow,
      status: 'active',
    },
    '# Child task group\n',
  );
  writeFm(
    join(root, 'task-groups', 'tg-child', 'versions', 'tgv-child-v1', 'index.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'taskGroupVersion',
      id: 'tgv-child-v1',
      taskGroupId: 'tg-child',
      version: 'v1',
      summary: 'Child version',
      createdAt: fixedNow,
      status: 'active',
      decomposedFromTaskId: 'task-root',
      decomposedFromTaskGroupId: 'tg-root',
      decomposedFromTaskGroupVersionId: 'tgv-root-v1',
      decomposedByRunId: 'run-main',
      decomposedByRunNodeId: runNodeId,
    },
    '# Child version\n',
  );
  writeFileSync(
    join(root, 'task-groups', 'tg-child', 'versions', 'tgv-child-v1', 'decomposition-log.md'),
    '# Decomposition log\n',
    'utf8',
  );
  writeFm(
    join(root, 'task-groups', 'tg-child', 'versions', 'tgv-child-v1', 'tasks', 'task-child.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'task',
      id: 'task-child',
      taskGroupId: 'tg-child',
      taskGroupVersionId: 'tgv-child-v1',
      title: 'Child task',
      objective: 'Resolve the parent closure',
      responsibility: 'Continue the work',
      completionCriteria: 'A follow-up is identified',
      order: 1,
      createdAt: fixedNow,
      status: 'pending',
      runReadiness: 'runnable',
    },
    '# Child task\n',
  );
  mkdirSync(join(root, 'task-groups', 'tg-child', 'versions', 'tgv-child-v1', 'eow'), { recursive: true });
}

function parsedWithoutResolverWarnings(root) {
  const parsed = parseProject(root);
  assert.deepEqual(parsed.errors, [], 'fixture should validate without errors');
  assert.equal(
    parsed.warnings.some((warning) => warning.includes('resolvedByTaskGroupId')),
    false,
    'fixture should not emit resolver backlink warnings',
  );
  return parsed;
}

function stateWriterIo() {
  return {
    ensureDir: (dir) => mkdirSync(dir, { recursive: true }),
    exists: existsSync,
    fmBlock,
    parseMarkdownFile,
    readBody,
    writeTextFile: (filePath, text) => writeFileSync(filePath, text, 'utf8'),
  };
}

{
  const root = createBaseWork();
  writeTaskEow(root);
  writeRunEow(root);
  parsedWithoutResolverWarnings(root);
}

{
  const root = createBaseWork({ childTaskGroupId: 'tg-child' });
  writeChildTaskGroup(root);
  writeTaskEow(root, { resolvedByTaskGroupId: 'tg-child' });
  writeRunEow(root, { resolvedByTaskGroupId: 'tg-child' });
  parsedWithoutResolverWarnings(root);
}

{
  const root = createBaseWork();
  writeTaskEow(root, { resolvedByTaskGroupId: 'tg-missing' });
  writeRunEow(root);
  const parsed = parseProject(root);
  assert.ok(
    parsed.errors.some((error) => error.includes("resolvedByTaskGroupId 'tg-missing' not found")),
    'dangling resolvedByTaskGroupId should be a validation error',
  );
}

{
  const root = createBaseWork({ childTaskGroupId: 'tg-child' });
  writeFm(
    join(root, 'runs', 'run-main', 'nodes', 'run-node-other.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id: 'run-node-other',
      runId: 'run-main',
      type: 'decomposition',
      title: 'Other decomposition node',
      sourceTaskId: 'task-root',
      sourceTaskGroupVersionId: 'tgv-root-v1',
      status: 'active',
      createdAt: fixedNow,
    },
    '# Other run node\n',
  );
  writeChildTaskGroup(root, { runNodeId: 'run-node-other' });
  writeTaskEow(root, { resolvedByTaskGroupId: 'tg-child' });
  writeRunEow(root);
  const parsed = parseProject(root);
  assert.deepEqual(parsed.errors, [], 'resolver mismatch should be a warning, not an error');
  assert.ok(
    parsed.warnings.some((warning) => warning.includes("resolvedByTaskGroupId 'tg-child' should trace to run node 'run-main/run-node-task-root'")),
    'decomposed child that traces to a different run node should warn',
  );
}

{
  const root = mkdtempSync(join(tmpdir(), 'taskops-eow-writer-'));
  const io = stateWriterIo();
  const taskPath = join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'tasks', 'task-a.md');
  writeFm(taskPath, { taskOpsVersion: 'v1', entityType: 'task', id: 'task-a' }, '# Task A\n');
  closeTaskWithEowFile({ task: { id: 'task-a', path: taskPath }, reason: 'completed', finishedAt: fixedNow }, io);
  const taskEowPath = join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'eow', 'eow-task-a-tgv-root-v1.md');
  assert.equal(
    readFileSync(taskEowPath, 'utf8'),
    fmBlock({
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: 'eow-task-a-tgv-root-v1',
      graphType: 'task',
      attachedToType: 'task',
      attachedToId: 'task-a',
      taskGroupVersionId: 'tgv-root-v1',
      reason: 'completed',
      declaredBy: 'taskops-runner',
      declaredAt: fixedNow,
      createdAt: fixedNow,
      status: 'done',
    }) + '# EoW: task-a\n',
    'task EoW output should include its version-qualified identity when resolvedByTaskGroupId is omitted',
  );

  const runDir = join(root, 'runs', 'run-main');
  mkdirSync(join(runDir, 'nodes'), { recursive: true });
  mkdirSync(join(runDir, 'edges'), { recursive: true });
  closeRunNodeWithEowFiles({ runDir, runId: 'run-main', runNodeId: 'run-node-task-a', reason: 'completed', closureRole: 'supporting', finishedAt: fixedNow }, io);
  const runEowPath = join(runDir, 'nodes', 'eow-run-node-task-a-run-main.md');
  assert.equal(
    readFileSync(runEowPath, 'utf8'),
    fmBlock({
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: 'eow-run-node-task-a-run-main',
      runId: 'run-main',
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'run-node-task-a',
      reason: 'completed',
      closureRole: 'supporting',
      declaredBy: 'taskops-runner',
      declaredAt: fixedNow,
      createdAt: fixedNow,
      status: 'done',
    }) + '# EoW: run-node-task-a\n',
    'run EoW output should include its run-qualified identity when resolvedByTaskGroupId is omitted',
  );

  const withResolverRoot = mkdtempSync(join(tmpdir(), 'taskops-eow-writer-resolver-'));
  const withResolverTaskPath = join(withResolverRoot, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'tasks', 'task-b.md');
  writeFm(withResolverTaskPath, { taskOpsVersion: 'v1', entityType: 'task', id: 'task-b' }, '# Task B\n');
  closeTaskWithEowFile({
    task: { id: 'task-b', path: withResolverTaskPath },
    reason: 'completed',
    finishedAt: fixedNow,
    resolvedByTaskGroupId: 'tg-child',
  }, io);
  assert.match(
    readFileSync(join(withResolverRoot, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'eow', 'eow-task-b-tgv-root-v1.md'), 'utf8'),
    /^resolvedByTaskGroupId: tg-child$/m,
    'state writer should include resolvedByTaskGroupId when provided',
  );
}

console.log('OK EoW resolver backlink');
