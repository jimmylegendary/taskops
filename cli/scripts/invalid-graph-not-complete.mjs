#!/usr/bin/env node
// Regression (ultrareview A6): explainWork/shapeNextAction/pickNextAction must NOT report a
// canonically-invalid graph as complete/done. A structurally-complete graph that carries validation
// errors is not honestly finished — closure cannot be trusted until the errors are resolved.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { explainWork, pickNextAction } from '../lib-runner.js';

const now = '2026-06-26T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-a6-'));
const w = join(root, 'work');
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
for (const d of [`${tv}/tasks`, `${tv}/eow`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');

md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'a6-work', title: 'A', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
const taskFile = `${tv}/tasks/task-01.md`;
md(taskFile, { taskOpsVersion: 'v1', entityType: 'task', id: 'task-01', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'T', objective: 'x', responsibility: 'own', completionCriteria: 'done', order: 1, createdAt: now, status: 'done', runReadiness: 'runnable', understandingLevel: 'known' });
md(`${tv}/eow/eow-task-01.md`, { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-task-01', graphType: 'task', attachedToType: 'task', attachedToId: 'task-01', taskGroupVersionId: 'tgv-root-v1', reason: 'execution_path_closed', declaredBy: 'system', declaredAt: now, createdAt: now, status: 'done' });

// baseline: a clean structurally-complete graph reports complete/done.
const clean = explainWork(w);
assert.equal(clean.complete, true, 'baseline: a clean structurally-complete graph is complete');
assert.equal(clean.next.action, 'done', 'baseline: next action is done');
assert.deepEqual(clean.validationErrors, [], 'baseline: no validation errors');
// baseline at the pickNextAction layer: a clean closed graph stops ALL_CLOSED.
assert.equal(pickNextAction(parseProject(w)).reason, 'all_closed', 'baseline: pickNextAction stops all_closed on a clean closed graph');

// inject a validation error that does not lower the EoW counts (taskGroupId mismatch); still structurally
// complete, but canonically INVALID.
const fm = parseMarkdownFile(join(w, taskFile));
md(taskFile, { ...fm, taskGroupId: 'tg-WRONG' });
const invalid = explainWork(w);
assert.ok(invalid.validationErrors.length > 0, 'A6: the corrupted graph has validation errors');
assert.equal(invalid.complete, false, 'A6: a canonically-invalid graph must NOT be reported complete');
assert.notEqual(invalid.next.action, 'done', 'A6: next action must not be done for an invalid graph');
// A6 at the pickNextAction layer: the invalid-but-closed graph must stop NO_RUNNABLE, NEVER all_closed.
const invalidPick = pickNextAction(parseProject(w));
assert.equal(invalidPick.kind, 'stop', 'A6: pickNextAction stops on an invalid closed graph');
assert.equal(invalidPick.reason, 'no_runnable', 'A6: pickNextAction returns NO_RUNNABLE (not all_closed) for an invalid closed graph');

rmSync(root, { recursive: true, force: true });
console.log('OK invalid-graph not complete (A6)');
