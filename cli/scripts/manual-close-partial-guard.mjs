#!/usr/bin/env node
// Regression (ultrareview A5, hardened after self-review): `taskops close --reason manual_verified` must
// refuse to force-close a task that still has an UNRESOLVED partial marker (orphaning honest-unfinished
// work), keyed on the LIVE partial-node state so it (a) catches an unresolved partial even with
// followUpNeeded:false and no awaitingPromotion flag [the self-review bypass], and (b) does NOT over-block
// a task whose partial has been promoted/superseded [the self-review over-block].
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

const task = (id, order) => md(`${tv}/tasks/${id}.md`, { taskOpsVersion: 'v1', entityType: 'task', id, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: id, objective: 'x', responsibility: 'own', completionCriteria: 'done', order, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known' });
task('task-bypass', 1);   // has an UNRESOLVED partial, followUpNeeded:false, NO awaitingPromotion flag
task('task-resolved', 2); // has a partial that was SUPERSEDED (resolved)
task('task-clean', 3);    // no partial

// Partials written as raw strings so supersededBy is exactly null (unresolved) or a node id (resolved) —
// fmBlock would round-trip a JS null oddly. followUpNeeded:false on the bypass case is the whole point.
const partial = (id, attachedToId, { supersededBy, followUpNeeded }) => writeFileSync(
  join(w, `${tv}/partials/${id}.md`),
  `---\ntaskOpsVersion: v1\nentityType: partial\nid: ${id}\ngraphType: task\nattachedToType: task\nattachedToId: ${attachedToId}\ntaskGroupVersionId: tgv-root-v1\nreason: partial_complete\ndeclaredBy: test\ndeclaredAt: ${now}\ncreatedAt: ${now}\nstatus: active\ncompletedSummary: Did half.\nincompleteSummary: The rest remains.\nfollowUpNeeded: ${followUpNeeded}\nsupersededBy: ${supersededBy}\nbudget:\n  enabled: false\n---\n# Partial ${id}\n`,
  'utf8',
);
partial('partial-bypass', 'task-bypass', { supersededBy: 'null', followUpNeeded: false });
partial('partial-resolved', 'task-resolved', { supersededBy: 'task-resolved-followup', followUpNeeded: true });

// 1) BYPASS case: unresolved partial with followUpNeeded:false + no awaitingPromotion must STILL be refused.
assert.throws(
  () => closeTarget(w, 'task-bypass', { reason: 'manual_verified' }),
  /unresolved partial/i,
  'A5: an unresolved partial (followUpNeeded:false, no awaitingPromotion) must still refuse manual_verified',
);
assert.equal(parseMarkdownFile(join(w, `${tv}/tasks/task-bypass.md`)).status, 'pending', 'A5: bypass task must not flip to done');

// 2) OVER-BLOCK case: a RESOLVED (superseded) partial must NOT block manual_verified close.
closeTarget(w, 'task-resolved', { reason: 'manual_verified' });
assert.equal(parseMarkdownFile(join(w, `${tv}/tasks/task-resolved.md`)).status, 'done', 'A5: a superseded partial must not over-block closure');

// 3) a task with no partial still closes.
closeTarget(w, 'task-clean', { reason: 'manual_verified' });
assert.equal(parseMarkdownFile(join(w, `${tv}/tasks/task-clean.md`)).status, 'done', 'a clean task still force-closes');

rmSync(root, { recursive: true, force: true });
console.log('OK manual-close partial guard (A5, hardened)');
