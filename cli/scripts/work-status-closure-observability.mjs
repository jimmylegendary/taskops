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

// P0#6: 이 fixture는 dry-run 실행 EoW로 structurally_complete_unapproved(policy 미승인)에 도달한다. navigation은
// 미승인 종결을 done/all_closed가 아니라 graph_closed_unapproved로, project status는 done이 아니라 active로 유지한다
// (finalize는 policy-approved일 때만 done flip). 단 closureState/structuralClosureComplete/closedBy/closedByRunId/
// closedAt stamp는 그대로 남겨 관찰가능성과 runner-ACK 경고 억제를 보존한다.
const result = runTaskOps(workDir, { executor: 'dry-run', maxSteps: 5 });
assert.equal(result.stopReason, 'graph_closed_unapproved', 'runner surfaces graph_closed_unapproved for an unapproved structural closure (NOT all_closed)');
assert.equal(result.workStatusClosure?.complete, true, 'runner should observe complete structural closure for work status finalization');
assert.equal(result.workStatusClosure?.updated, true, 'runner should stamp closure observability even when status stays active');
assert.equal(result.workStatusClosure?.previousStatus, 'active', 'fixture should exercise the active-work mismatch path');
assert.equal(result.workStatusClosure?.status, 'active', 'runner keeps status active for an unapproved structural closure (done only on policy approval)');

const workIndex = parseMarkdownFile(join(workDir, 'index.md'));
assert.equal(workIndex.status, 'active', 'work index status stays active for an unapproved structural closure (P0#6)');
assert.equal(workIndex.closedBy, 'taskops-runner');
assert.equal(workIndex.closedByRunId, 'run-main');
assert.equal(workIndex.structuralClosureComplete, true);
assert.equal(workIndex.closureState, 'structurally_complete_unapproved');
assert.match(workIndex.closedAt, /^\d{4}-\d{2}-\d{2}T/);

const parsedAfter = parseProject(workDir);
assert.equal(parsedAfter.project.status, 'active', 'reparsed project status stays active for an unapproved structural closure');
assert.equal(parsedAfter.closure.structuralComplete, true);
assert.ok(!parsedAfter.warnings.some(activeStructuralWarning), 'runner-ACKed unapproved stop must not raise the active-vs-structurally-complete warning (1179 narrowed to forgot-to-finalize / approved-but-not-flipped)');

const explainAfter = explainWork(workDir);
assert.equal(explainAfter.complete, false, 'explain.complete is false for an unapproved structural closure (P0#6 parity with audit claimSafe)');
assert.equal(explainAfter.status, 'active', 'explain status reflects the active project status (not a false complete)');
assert.ok(!explainAfter.warnings.some(activeStructuralWarning), 'explain output must not surface the active-vs-structurally-complete warning for a runner-ACKed stop');

rmSync(root, { recursive: true, force: true });
console.log('OK work status closure observability');
