#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { explainWork, runTaskOps } from '../lib-runner.js';

const now = '2026-07-05T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-work-status-closure-'));
const workDir = join(root, 'work');
const versionDir = 'task-groups/tg-root/versions/tgv-root-v1';
const activeStructuralWarning = (warning) => warning.includes('work status is active while graph is structurally complete');

const md = (relativePath, fm, body = `# ${fm.id}\n`) => {
  writeFileSync(join(workDir, relativePath), fmBlock(fm) + body, 'utf8');
};

for (const dir of [`${versionDir}/tasks`, 'snapshots']) {
  mkdirSync(join(workDir, dir), { recursive: true });
}

md('index.md', {
  taskOpsVersion: 'v1',
  entityType: 'work',
  id: 'work-status-closure',
  title: 'Work status closure',
  objective: 'Verify runner closure updates work status observability.',
  activeRootTaskGroupId: 'tg-root',
  activeSnapshotId: 'snapshot-root-v1',
  createdAt: now,
  status: 'active',
});
md('task-groups/tg-root/index.md', {
  taskOpsVersion: 'v1',
  entityType: 'taskGroup',
  id: 'tg-root',
  objective: 'Root task group.',
  activeVersionId: 'tgv-root-v1',
  createdAt: now,
  status: 'active',
});
md(`${versionDir}/index.md`, {
  taskOpsVersion: 'v1',
  entityType: 'taskGroupVersion',
  id: 'tgv-root-v1',
  taskGroupId: 'tg-root',
  version: 'v1',
  summary: 'Single runnable task.',
  selected: true,
  createdAt: now,
  status: 'active',
});
md('snapshots/snapshot-root-v1.md', {
  taskOpsVersion: 'v1',
  entityType: 'versionSnapshot',
  id: 'snapshot-root-v1',
  rootTaskGroupId: 'tg-root',
  createdAt: now,
  label: 'root',
  status: 'active',
  selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }],
});
md(`${versionDir}/tasks/task-only.md`, {
  taskOpsVersion: 'v1',
  entityType: 'task',
  id: 'task-only',
  taskGroupId: 'tg-root',
  taskGroupVersionId: 'tgv-root-v1',
  title: 'Only task',
  objective: 'Run once and close the work.',
  responsibility: 'Own the terminal task.',
  completionCriteria: 'Runner marks the task done and writes EoW closure.',
  order: 1,
  createdAt: now,
  status: 'pending',
  runReadiness: 'runnable',
  runReadinessReason: 'Synthetic regression task.',
  understandingLevel: 'known',
});

const result = runTaskOps(workDir, { executor: 'dry-run', maxSteps: 5 });
assert.equal(result.stopReason, 'all_closed', 'runner should observe all_closed after closing the task');
assert.equal(result.workStatusClosure?.complete, true, 'runner should observe complete closure for work status finalization');
assert.equal(result.workStatusClosure?.updated, true, 'runner should update active work status on structural closure');
assert.equal(result.workStatusClosure?.previousStatus, 'active', 'fixture should exercise the active-work mismatch path');
assert.equal(result.workStatusClosure?.status, 'done', 'runner should report the finalized work status');

const workIndex = parseMarkdownFile(join(workDir, 'index.md'));
assert.equal(workIndex.status, 'done', 'work index status should be done after runner-owned all_closed');
assert.equal(workIndex.closedBy, 'taskops-runner');
assert.equal(workIndex.closedByRunId, 'run-main');
assert.equal(workIndex.structuralClosureComplete, true);
assert.equal(workIndex.closureState, 'structurally_complete_unapproved');
assert.match(workIndex.closedAt, /^\d{4}-\d{2}-\d{2}T/);

const parsedAfter = parseProject(workDir);
assert.equal(parsedAfter.project.status, 'done', 'reparsed project status should reflect runner-owned closure');
assert.equal(parsedAfter.closure.structuralComplete, true);
assert.ok(!parsedAfter.warnings.some(activeStructuralWarning), 'runner closure must not leave the old active-vs-structurally-complete warning');

const explainAfter = explainWork(workDir);
assert.equal(explainAfter.complete, true);
assert.equal(explainAfter.status, 'complete');
assert.ok(!explainAfter.warnings.some(activeStructuralWarning), 'explain output must not surface the old active-vs-structurally-complete warning');

rmSync(root, { recursive: true, force: true });
console.log('OK work status closure observability');
