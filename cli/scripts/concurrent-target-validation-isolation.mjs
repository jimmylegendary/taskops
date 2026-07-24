#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-concurrent-target-validation-'));
const now = '2026-07-25T00:00:00.000Z';

function writeMd(path, fm) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
}

function seedWork(name) {
  const workDir = join(tempRoot, name);
  const versionDir = join(
    workDir,
    'task-groups',
    'tg-root',
    'versions',
    'tgv-root-v1',
  );
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id: name,
    title: name,
    objective: 'Run one target while another worker is creating its run.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'task-groups', 'tg-root', 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Complete the target.',
    activeVersionId: 'tgv-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(versionDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    version: 'v1',
    summary: 'Concurrent target validation fixture.',
    selected: true,
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'snapshots', 'snapshot-root-v1.md'), {
    taskOpsVersion: 'v1',
    entityType: 'versionSnapshot',
    id: 'snapshot-root-v1',
    rootTaskGroupId: 'tg-root',
    createdAt: now,
    label: 'Root',
    status: 'active',
    selectedVersions: [{
      taskGroupId: 'tg-root',
      versionId: 'tgv-root-v1',
    }],
  });
  const taskPath = join(versionDir, 'tasks', 'target.md');
  writeMd(taskPath, {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'target',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Complete the target',
    objective: 'Complete the target.',
    responsibility: 'Own the target result.',
    completionCriteria: 'The dry-run worker records the result.',
    order: 1,
    createdAt: now,
    status: 'pending',
    runReadiness: 'runnable',
    understandingLevel: 'known',
  });
  writeMd(join(workDir, 'runs', 'run-main', 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'run',
    id: 'run-main',
    workId: name,
    createdAt: now,
    status: 'active',
  });
  return { workDir, taskPath };
}

function runTargetWorker(workDir, runId = 'run-target') {
  return spawnSync(process.execPath, [
    cliPath,
    'run',
    workDir,
    '--executor',
    'dry-run',
    '--max-steps',
    '1',
    '--max-steps-explicit',
    '--target-task-id',
    'target',
    '--target-task-group-version-id',
    'tgv-root-v1',
    '--allow-concurrent-target',
    '--run-id',
    runId,
    '--json',
  ], {
    encoding: 'utf8',
  });
}

try {
  const offTarget = seedWork('off-target-transient');
  const offTargetRunDir = join(offTarget.workDir, 'runs', 'run-other-worker');
  mkdirSync(offTargetRunDir, { recursive: true });
  const offTargetErrors = parseProject(offTarget.workDir).errors;
  assert.ok(
    offTargetErrors.some((error) => (
      error.includes('/runs/run-other-worker:')
      && error.includes('missing index.md')
    )),
    'fixture must contain a real off-worker missing-index validation error',
  );

  const offTargetWorker = runTargetWorker(offTarget.workDir);
  assert.equal(
    offTargetWorker.status,
    0,
    `off-target worker must produce JSON\n${offTargetWorker.stderr}`,
  );
  const offTargetResult = JSON.parse(offTargetWorker.stdout);
  assert.equal(offTargetResult.actions.length, 1);
  assert.equal(offTargetResult.actions[0].taskId, 'target');
  assert.equal(offTargetResult.actions[0].status, 'completed');
  assert.equal(parseMarkdownFile(offTarget.taskPath).status, 'done');
  assert.ok(
    parseProject(offTarget.workDir).errors.some((error) => (
      error.includes('/runs/run-other-worker:')
      && error.includes('missing index.md')
    )),
    'the target must run while the filtered off-worker error remains present',
  );

  const targetLocal = seedWork('target-local-error');
  mkdirSync(join(targetLocal.workDir, 'runs', 'run-target'), { recursive: true });
  const targetLocalWorker = runTargetWorker(targetLocal.workDir);
  assert.notEqual(targetLocalWorker.status, 0);
  assert.match(targetLocalWorker.stderr, /validation errors; cannot start runner/i);
  assert.equal(parseMarkdownFile(targetLocal.taskPath).status, 'pending');

  const global = seedWork('global-error');
  const projectPath = join(global.workDir, 'index.md');
  const projectBefore = readFileSync(projectPath, 'utf8');
  const projectAfter = projectBefore.replace('status: active', 'status: invalid');
  assert.notEqual(projectAfter, projectBefore, 'global-error fixture must mutate work status');
  writeFileSync(projectPath, projectAfter, 'utf8');
  const globalWorker = runTargetWorker(global.workDir);
  assert.notEqual(globalWorker.status, 0);
  assert.match(globalWorker.stderr, /validation errors; cannot start runner/i);
  assert.equal(parseMarkdownFile(global.taskPath).status, 'pending');

  console.log('OK concurrent target validation isolation');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
