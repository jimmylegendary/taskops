#!/usr/bin/env node
// Regression: the autonomous watch loop must not equate `all_closed` (STRUCTURAL closure)
// with an inductively-sound completion. Before the fix it reported all_closed from
// explainWork().complete (= structuralComplete) and never audited. Now the terminal result
// carries the claim-safety verdict, so a structurally-complete-but-unapproved graph is
// reported all_closed WITH claimSafe:false rather than as a false, trusted 'done'.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock } from '../lib-taskops.js';
import { runQueueWatch } from '../lib-orchestrator.js';

const now = '2026-06-26T00:00:00.000Z';
const dir = mkdtempSync(join(tmpdir(), 'taskops-orch-audit-'));
const workDir = join(dir, 'work');
const md = (p, fm) => writeFileSync(join(workDir, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
for (const d of [
  'task-groups/tg-root/versions/tgv-root-v1/tasks',
  'task-groups/tg-root/versions/tgv-root-v1/eow',
  'snapshots', '.taskops',
]) mkdirSync(join(workDir, d), { recursive: true });

md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'orch-work', title: 'O', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'done' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'done' });
md('task-groups/tg-root/versions/tgv-root-v1/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 'one done task', selected: true, createdAt: now, status: 'done' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'Root', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
// task closed structurally via the DEFAULT (informational) execution path -> NOT policy-approved
md('task-groups/tg-root/versions/tgv-root-v1/tasks/task-01.md', { taskOpsVersion: 'v1', entityType: 'task', id: 'task-01', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'T1', objective: 'x', responsibility: 'own it', completionCriteria: 'done', order: 1, createdAt: now, status: 'done', runReadiness: 'runnable', understandingLevel: 'known' });
md('task-groups/tg-root/versions/tgv-root-v1/eow/eow-task-01.md', { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-task-01', graphType: 'task', attachedToType: 'task', attachedToId: 'task-01', taskGroupVersionId: 'tgv-root-v1', reason: 'execution_path_closed', declaredBy: 'system', declaredAt: now, createdAt: now, status: 'done' });

const result = await runQueueWatch(workDir, { runtimeAdapter: 'dry-run', maxIdleCycles: 1, pollIntervalMs: 1, idleExitAfterSeconds: 0 });

assert.equal(result.stopReason, 'all_closed', 'a structurally-complete work should still terminate all_closed');
assert.equal(result.claimSafe, false, 'all_closed on an unapproved (informational) closure must report claimSafe:false');
assert.equal(typeof result.closureState, 'string', 'terminal result must carry the closureState verdict');
assert.notEqual(result.closureState, 'policy_approved_complete', 'unapproved closure must not read as policy-approved');

rmSync(dir, { recursive: true, force: true });
console.log('OK orchestrator terminal audit');
