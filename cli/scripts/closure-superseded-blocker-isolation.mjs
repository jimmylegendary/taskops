#!/usr/bin/env node
// P0#4: closure의 active completion predicate(openBlockerCount)는 selected/active version의 task만 세야 한다.
// superseded(non-selected) version에 남은 blocked task 하나가 openBlockerCount>0을 영구 유지시켜 structuralComplete를
// 영원히 false로 오염시키던 버그를 제거한다. history/superseded task는 parse에 남아 audit trail을 유지하되 active
// completion 계산에서만 제외된다.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmBlock, parseProject } from '../lib-taskops.js';

void fileURLToPath;
const now = '2026-06-26T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-superseded-blocker-'));
const w = join(root, 'work');
const md = (p, fm) => { mkdirSync(join(w, p, '..'), { recursive: true }); writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8'); };

// work / tg-root / snapshot (selected = tgv-root-v2 만).
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'superseded-blocker', title: 'A', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v2', createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v2' }] });

// superseded v1 (selected:false) — 여기에 blocked task 하나가 남아있다(오염원).
const v1 = 'task-groups/tg-root/versions/tgv-root-v1';
md(`${v1}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: false, supersededByVersionId: 'tgv-root-v2', createdAt: now, status: 'active' });
md(`${v1}/tasks/task-old-blocked.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'task-old-blocked', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'Old blocked', objective: 'x', responsibility: 'own', completionCriteria: 'c', order: 1, createdAt: now, status: 'blocked', runReadiness: 'blocked', lastRunFailureReason: 'superseded branch left a stale blocker' });

// selected v2 — policy-approved review EoW로 완전 종결된 terminal task 하나.
const v2 = 'task-groups/tg-root/versions/tgv-root-v2';
md(`${v2}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v2', taskGroupId: 'tg-root', version: 'v2', summary: 's', selected: true, supersedesVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${v2}/tasks/task-main.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'task-main', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v2', title: 'Main', objective: 'x', responsibility: 'own', completionCriteria: 'c', order: 1, createdAt: now, status: 'done', runReadiness: 'runnable', understandingLevel: 'known' });
md(`${v2}/eow/eow-task-main.md`, { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-task-main', graphType: 'task', attachedToType: 'task', attachedToId: 'task-main', taskGroupVersionId: 'tgv-root-v2', reason: 'approved_result', declaredBy: 'reviewer', declaredAt: now, createdAt: now, status: 'done', approvedByReviewNodeId: 'run-node-review-main', approvedReviewMode: 'runner-managed', approvedReviewReportHash: 'h-report', reviewedAcceptanceHash: 'h-acc', reviewedResultHash: 'h-res' });

const parsed = parseProject(w);
assert.deepEqual(parsed.errors, [], 'the seeded graph is canonically valid');
// superseded task는 여전히 parse에 존재한다(audit trail 유지).
assert.equal([...parsed.tasks.values()].some((t) => t.id === 'task-old-blocked'), true, 'superseded blocked task remains parsed as history/audit trail');
// active completion은 selected graph에서만: 오염 제거.
assert.equal(parsed.closure.openBlockerCount, 0, 'P0#4: a superseded (non-selected) blocked task must NOT count toward active openBlockerCount');
assert.equal(parsed.closure.structuralComplete, true, 'P0#4: selected graph is structurally complete once the superseded blocker no longer pollutes closure');

rmSync(root, { recursive: true, force: true });
console.log('closure-superseded-blocker-isolation: OK (P0#4 — active completion counts only the selected graph)');
