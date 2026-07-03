#!/usr/bin/env node
// Regression (ultrareview A5): `taskops close --reason manual_verified` must NOT force-close a task that
// still carries an UNRESOLVED partial marker — that would orphan honest-unfinished work. It must refuse
// until the partial is promoted/superseded. A task with no unresolved partial still closes.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile } from '../lib-taskops.js';
import { closeTarget } from '../lib-runner.js';

const now = '2026-06-26T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-a5-'));
const w = join(root, 'work');
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
for (const d of [`${tv}/tasks`, `${tv}/eow`, `${tv}/partials`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm, body = `# ${fm.id}\n`) => writeFileSync(join(w, p), `${fmBlock(fm)}${body}`, 'utf8');

md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'a5-work', title: 'A', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });

const task = (id, extra = {}) => md(`${tv}/tasks/${id}.md`, { taskOpsVersion: 'v1', entityType: 'task', id, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: id, objective: 'x', responsibility: 'own', completionCriteria: 'done', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', ...extra });
// closeExecutePartial marks the source task awaitingPromotion + records the partial id (production signal)
task('task-partial', { awaitingPromotion: true, awaitingPromotionPartialId: 'partial-task-partial' });
task('task-clean', { order: 2 });

// unresolved partial attached to task-partial
md(`${tv}/partials/partial-task-partial.md`, { taskOpsVersion: 'v1', entityType: 'partial', id: 'partial-task-partial', graphType: 'task', attachedToType: 'task', attachedToId: 'task-partial', taskGroupVersionId: 'tgv-root-v1', reason: 'partial_complete', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'active', completedSummary: 'Did half.', incompleteSummary: 'The rest remains.', followUpNeeded: true, supersededBy: null, budget: { enabled: false } });

// 1) manual_verified must REFUSE to close a task with an unresolved partial marker.
assert.throws(
  () => closeTarget(w, 'task-partial', { reason: 'manual_verified' }),
  /unresolved partial/i,
  'A5: manual_verified must refuse to orphan an unresolved partial',
);
assert.equal(parseMarkdownFile(join(w, `${tv}/tasks/task-partial.md`)).status, 'pending', 'A5: the task must not be flipped to done');

// 2) a task with no unresolved partial still closes via manual_verified.
closeTarget(w, 'task-clean', { reason: 'manual_verified' });
assert.equal(parseMarkdownFile(join(w, `${tv}/tasks/task-clean.md`)).status, 'done', 'a clean task still force-closes');

rmSync(root, { recursive: true, force: true });
console.log('OK manual-close partial guard (A5)');
