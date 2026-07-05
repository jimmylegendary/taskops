#!/usr/bin/env node
// Build a demo TaskOps work dir that exercises every view: a decomposed parent, verify-grounded/running/blocked
// leaves, and a WAITING human delegation (for the queue). Prints the work path.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock } from '../cli/lib-taskops.js';
import { EXTERNAL_RESOLUTION_TEMPLATE } from '../cli/lib-runner.js';

const now = '2026-07-06T00:00:00.000Z';
const w = process.argv[2] || mkdtempSync(join(tmpdir(), 'taskops-demo-'));
const md = (p, fm, b) => { mkdirSync(join(w, p, '..'), { recursive: true }); writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8'); };
const rootTv = 'task-groups/tg-root/versions/tgv-root-v1';
const utilTv = 'task-groups/tg-utils/versions/tgv-utils-v1';

md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'demo', title: 'Demo', objective: 'build a small utils module + one human decision', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${rootTv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }, { taskGroupId: 'tg-utils', versionId: 'tgv-utils-v1' }] });

// root: a decomposed parent + a HUMAN delegation (waiting) -> shows in the queue
md(`${rootTv}/tasks/build.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'build', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'Build utils module', objective: 'Build the utils module (sub-functions decomposed).', responsibility: 'own', completionCriteria: 'all pass', order: 1, createdAt: now, status: 'pending', runReadiness: 'needs_decomposition', understandingLevel: 'known', childTaskGroupId: 'tg-utils' });
const humanBody = EXTERNAL_RESOLUTION_TEMPLATE
  .replace('<agent: the single decision that could not be settled — one decision unit, crisp>', 'Should the public API expose truncate(s, n) with an ellipsis, or a separate ellipsize()? This changes the module surface.')
  .replace('<agent: candidate answers with trade-offs; if you cannot enumerate them, add an\nexplicit "open:" line naming what is unknown — do not leave this empty>', 'A) one truncate(s,n) with a trailing ellipsis — simplest surface.\nB) truncate + a separate ellipsize(s,n) — more explicit, larger API.');
md(`${rootTv}/tasks/api-shape.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'api-shape', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'Decide public API shape', objective: 'Settle the truncate/ellipsize API surface.', responsibility: 'own the API decision', completionCriteria: 'a decision is recorded', order: 2, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', resolverKind: 'human' }, humanBody);

// utils children: done (verified) / running / blocked
md('task-groups/tg-utils/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-utils', objective: 'utils fns', parentTaskId: 'build', activeVersionId: 'tgv-utils-v1', createdAt: now, status: 'active' });
md(`${utilTv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-utils-v1', taskGroupId: 'tg-utils', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md(`${utilTv}/tasks/slugify.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'slugify', taskGroupId: 'tg-utils', taskGroupVersionId: 'tgv-utils-v1', title: 'slugify()', objective: 'slugify a string.', responsibility: 'own', completionCriteria: 'passes', order: 1, createdAt: now, status: 'done', runReadiness: 'runnable', understandingLevel: 'known', runRefs: [{ runId: 'r1', runNodeId: 'run-node-slugify', role: 'primary_execution' }], acceptance: { mode: 'guarded', requiredChecks: [{ command: 'exit 0' }] } });
md(`${utilTv}/tasks/titlecase.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'titlecase', taskGroupId: 'tg-utils', taskGroupVersionId: 'tgv-utils-v1', title: 'titleCase()', objective: 'title-case a string.', responsibility: 'own', completionCriteria: 'passes', order: 2, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', runRefs: [{ runId: 'r1', runNodeId: 'run-node-titlecase', role: 'primary_execution' }], acceptance: { mode: 'guarded', requiredChecks: [{ command: 'exit 0' }] } });
md(`${utilTv}/tasks/truncate.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'truncate', taskGroupId: 'tg-utils', taskGroupVersionId: 'tgv-utils-v1', title: 'truncate()', objective: 'truncate a string (blocked on the API decision).', responsibility: 'own', completionCriteria: 'passes', order: 3, createdAt: now, status: 'blocked', runReadiness: 'blocked', understandingLevel: 'known', blockedBy: [{ type: 'task', taskId: 'api-shape' }] });

// a run graph for slugify (done + a verified review) so the detail view shows a run graph
mkdirSync(join(w, 'runs/r1/nodes'), { recursive: true });
md('runs/r1/index.md', { taskOpsVersion: 'v1', entityType: 'run', id: 'r1', workId: 'demo', createdAt: now, status: 'active' });
writeFileSync(join(w, 'runs/r1/events.jsonl'), '', 'utf8');
md('runs/r1/nodes/run-node-slugify.md', { taskOpsVersion: 'v1', entityType: 'runNode', id: 'run-node-slugify', runId: 'r1', type: 'implementation', title: 'slugify', sourceTaskId: 'slugify', status: 'done', createdAt: now });
md('runs/r1/nodes/review-run-node-slugify.md', { taskOpsVersion: 'v1', entityType: 'runNode', id: 'review-run-node-slugify', runId: 'r1', type: 'review', title: 'review slugify', status: 'done', createdAt: now, reviewReport: { decision: 'approved', verified: true, mode: 'guarded' } });
md('runs/r1/nodes/run-node-titlecase.md', { taskOpsVersion: 'v1', entityType: 'runNode', id: 'run-node-titlecase', runId: 'r1', type: 'implementation', title: 'titlecase', sourceTaskId: 'titlecase', status: 'active', createdAt: now });

console.log(w);
