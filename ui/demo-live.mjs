#!/usr/bin/env node
// A LIVE human-handoff demo work: a human decision (A) blocks a dependent task (B). A watcher daemon runs, pauses
// at A (delegation_pending -> shows in the UI queue), and once the owner answers A in the browser it RESUMES and
// completes A then B. Prints the work path.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock } from '../cli/lib-taskops.js';
import { EXTERNAL_RESOLUTION_TEMPLATE } from '../cli/lib-runner.js';

const now = '2026-07-06T00:00:00.000Z';
const w = process.argv[2] || mkdtempSync(join(tmpdir(), 'taskops-live-'));
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
const md = (p, fm, b) => { mkdirSync(join(w, p, '..'), { recursive: true }); writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8'); };
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'live', title: 'Live handoff demo', objective: 'approve a deploy target, then deploy', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });

// A: human decision (blocks B). guarded exit-0 so once resolved it executes + verifies -> done.
const body = EXTERNAL_RESOLUTION_TEMPLATE
  .replace('<agent: the single decision that could not be settled — one decision unit, crisp>', 'Which environment should we deploy to — STAGING or PRODUCTION?')
  .replace('<agent: candidate answers with trade-offs; if you cannot enumerate them, add an\nexplicit "open:" line naming what is unknown — do not leave this empty>', 'STAGING — safe, reversible, no user impact.\nPRODUCTION — live to users; only if the release is signed off.');
md(`${tv}/tasks/approve.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'approve', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'Approve deploy target', objective: 'Decide the deploy environment.', responsibility: 'own the deploy decision', completionCriteria: 'a target is chosen', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', resolverKind: 'human', acceptance: { mode: 'guarded', expectedOutcome: 'target chosen', requiredChecks: [{ command: 'exit 0' }] } }, body);
md(`${tv}/tasks/deploy.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'deploy', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'Run the deploy', objective: 'Deploy to the approved target (blocked until approved).', responsibility: 'own the deploy', completionCriteria: 'deployed', order: 2, createdAt: now, status: 'blocked', runReadiness: 'blocked', understandingLevel: 'known', blockedBy: [{ type: 'task', taskId: 'approve' }], acceptance: { mode: 'guarded', expectedOutcome: 'deployed', requiredChecks: [{ command: 'exit 0' }] } });

console.log(w);
