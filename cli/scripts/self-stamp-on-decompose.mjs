#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fmBlock,
  initProject,
  parseMarkdownFile,
  parseProject,
} from '../lib-taskops.js';
import {
  stampChildrenSelfResolver,
} from '../lib-runner.js';

const fixedNow = '2026-07-02T00:00:00.000Z';

function writeFm(filePath, frontmatter, body) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, fmBlock(frontmatter) + body, 'utf8');
}

function childTaskPath(root, taskId) {
  return join(root, 'task-groups', 'tg-child', 'versions', 'tgv-child-v1', 'tasks', `${taskId}.md`);
}

function childTaskBytes(root) {
  return Object.fromEntries(
    ['task-child-a', 'task-child-b', 'task-child-c']
      .map((taskId) => [taskId, readFileSync(childTaskPath(root, taskId), 'utf8')]),
  );
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'taskops-self-stamp-'));
  initProject(root, {
    id: 'work-self-stamp',
    title: 'Self stamp fixture',
    objective: 'Validate delegation-mode child resolver stamping.',
  });

  writeFm(
    join(root, 'task-groups', 'tg-child', 'index.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'taskGroup',
      id: 'tg-child',
      objective: 'Child work that may self-resolve under delegation.',
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
      summary: 'Child version for self stamp',
      createdAt: fixedNow,
      status: 'active',
    },
    '# Child version\n',
  );
  writeFileSync(
    join(root, 'task-groups', 'tg-child', 'versions', 'tgv-child-v1', 'decomposition-log.md'),
    '# Decomposition log\n',
    'utf8',
  );
  mkdirSync(join(root, 'task-groups', 'tg-child', 'versions', 'tgv-child-v1', 'eow'), { recursive: true });

  const tasks = [
    {
      id: 'task-child-a',
      title: 'Child A',
      objective: 'Validate unstamped child A.',
      responsibility: 'Own child A.',
      completionCriteria: 'Child A is inspectable.',
      order: 1,
    },
    {
      id: 'task-child-b',
      title: 'Child B',
      objective: 'Validate overwrite of external resolver.',
      responsibility: 'Own child B.',
      completionCriteria: 'Child B resolverKind is overwritten.',
      order: 2,
      resolverKind: 'human',
    },
    {
      id: 'task-child-c',
      title: 'Child C',
      objective: 'Validate another unstamped child.',
      responsibility: 'Own child C.',
      completionCriteria: 'Child C is inspectable.',
      order: 3,
    },
  ];

  for (const task of tasks) {
    writeFm(
      childTaskPath(root, task.id),
      {
        taskOpsVersion: 'v1',
        entityType: 'task',
        id: task.id,
        taskGroupId: 'tg-child',
        taskGroupVersionId: 'tgv-child-v1',
        title: task.title,
        objective: task.objective,
        responsibility: task.responsibility,
        completionCriteria: task.completionCriteria,
        order: task.order,
        createdAt: fixedNow,
        status: 'pending',
        runReadiness: 'runnable',
        ...(task.resolverKind ? { resolverKind: task.resolverKind } : {}),
      },
      `# ${task.title}\n`,
    );
  }

  return root;
}

{
  const root = createFixture();
  const before = childTaskBytes(root);
  const after = childTaskBytes(root);
  assert.deepEqual(after, before, 'delegationMode:false path does not touch children when stamp is not called');
  assert.equal(parseMarkdownFile(childTaskPath(root, 'task-child-a')).resolverKind, undefined, 'unstamped child should not gain resolverKind');
  assert.equal(parseMarkdownFile(childTaskPath(root, 'task-child-b')).resolverKind, 'human', 'explicit human resolverKind remains unchanged without stamping');
}

{
  const root = createFixture();
  const summary = stampChildrenSelfResolver({
    projectDir: root,
    childTaskGroupId: 'tg-child',
    versionId: 'tgv-child-v1',
  });

  assert.deepEqual(summary, { taskCount: 3, stampedCount: 3 }, 'stamp summary should count every child task');
  for (const taskId of ['task-child-a', 'task-child-b', 'task-child-c']) {
    assert.equal(parseMarkdownFile(childTaskPath(root, taskId)).resolverKind, 'self', `${taskId} should be stamped resolverKind:self`);
  }
  assert.equal(parseMarkdownFile(childTaskPath(root, 'task-child-b')).resolverKind, 'self', "delegation mode overwrites resolverKind:'human' to 'self'");
  assert.deepEqual(parseProject(root).errors, [], 'stamped child resolverKind:self values should validate');

  const firstStampBytes = childTaskBytes(root);
  const secondSummary = stampChildrenSelfResolver({
    projectDir: root,
    childTaskGroupId: 'tg-child',
    versionId: 'tgv-child-v1',
  });
  const secondStampBytes = childTaskBytes(root);
  assert.deepEqual(secondSummary, { taskCount: 3, stampedCount: 3 }, 'second stamp still processes every child task');
  assert.deepEqual(secondStampBytes, firstStampBytes, 'stamping twice should be byte-identical after the first stamp');
}

{
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const runnerSource = readFileSync(resolve(scriptDir, '..', 'lib-runner.js'), 'utf8');
  assert.match(
    runnerSource,
    /function executeDecompositionTask\(\{[^}]*budget = null, delegationMode = false[^}]*\}\)/,
    'executeDecompositionTask should accept delegationMode without touching execute signatures',
  );
  assert.match(
    runnerSource,
    /return closeDecomposeSuccess\(\{[\s\S]*delegationMode,\n\s+\}\);/,
    'executeDecompositionTask should pass delegationMode into closeDecomposeSuccess',
  );
  assert.match(
    runnerSource,
    /const selfResolverStamp = delegationMode === true[\s\S]*stampChildrenSelfResolver\(\{/,
    'closeDecomposeSuccess should call stampChildrenSelfResolver only behind delegationMode === true',
  );
  assert.match(
    runnerSource,
    /executeDecompositionTask\(\{[\s\S]*budget: stepBudget,\n\s+delegationMode,\n\s+\}\);/,
    'runTaskOps decompose branch should thread delegationMode into executeDecompositionTask',
  );
}

console.log('OK self stamp on decompose');
