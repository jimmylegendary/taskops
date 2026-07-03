#!/usr/bin/env node
// Regression (ultrareview C1): a runnable task whose resolverKind is human/ai must NOT be selected for
// EXECUTION until its external DECISION/BASIS is resolved. Before the fix, deriveExternalResolutionStatus
// was dead and pickNextAction never read resolverKind, so the human decision was never actually waited on.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseProject } from '../lib-taskops.js';
import { pickNextAction, EXTERNAL_RESOLUTION_TEMPLATE } from '../lib-runner.js';

const now = '2026-06-26T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-extgate-'));
const workDir = join(root, 'work');
const taskDir = 'task-groups/tg-root/versions/tgv-root-v1/tasks';
for (const d of [taskDir, 'snapshots']) mkdirSync(join(workDir, d), { recursive: true });
const md = (p, fm, body) => writeFileSync(join(workDir, p), `${fmBlock(fm)}${body}`, 'utf8');

md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'ext-work', title: 'X', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' }, '# ext-work\n');
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' }, '# tg\n');
md('task-groups/tg-root/versions/tgv-root-v1/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' }, '# tgv\n');
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] }, '# snap\n');

const taskFm = {
  taskOpsVersion: 'v1', entityType: 'task', id: 'task-ext', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: 'External decision', objective: 'Pick the auth strategy.', responsibility: 'Own the choice.',
  completionCriteria: 'A decision is recorded.', order: 1, createdAt: now, status: 'pending',
  runReadiness: 'runnable', understandingLevel: 'known', resolverKind: 'human',
};
const taskPath = 'task-groups/tg-root/versions/tgv-root-v1/tasks/task-ext.md';

// 1) WAITING external resolution → runnable human task must NOT execute; runner stops delegation_pending.
md(taskPath, taskFm, EXTERNAL_RESOLUTION_TEMPLATE);
const waiting = pickNextAction(parseProject(workDir));
assert.equal(waiting.kind, 'stop', 'C1: an unresolved external task must not be handed to execute');
assert.equal(waiting.reason, 'delegation_pending', 'C1: waiting external resolution surfaces delegation_pending');

// 2) RESOLVED external resolution (DECISION + BASIS filled) → task may now execute.
const resolvedBody = EXTERNAL_RESOLUTION_TEMPLATE
  .replace('<resolver: the concrete, downstream-consumable choice — a value, not prose>', 'OAuth 2.0 with PKCE')
  .replace('<resolver: the grounds for this decision>', 'Partner delegation is on the roadmap.');
assert.equal(resolvedBody.includes('<resolver:'), false, 'test fixture should fully resolve the body');
md(taskPath, taskFm, resolvedBody);
const resolved = pickNextAction(parseProject(workDir));
assert.equal(resolved.kind, 'execute', 'C1: a RESOLVED external task may proceed to execution');
assert.equal(resolved.task.id, 'task-ext');

rmSync(root, { recursive: true, force: true });
console.log('OK external resolution gate (C1)');
