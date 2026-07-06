#!/usr/bin/env node
// A multi-step TaskOps work for the openclaw executor with a genuine HUMAN delegation. openclaw (executor=
// openclaw-agent) does the analysis/drafting turns; a human decision (pick-approach) gates the final two tasks —
// it surfaces in the UI queue for the owner to answer, then openclaw resumes. Informational acceptance (openclaw's
// text is the deliverable; openclaw's Gateway agent has a fixed workspace, so no file checks). Prints the work dir.
//   usage: node ui/openclaw-demo.mjs [work-dir]
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fmBlock } from '../cli/lib-taskops.js';
import { EXTERNAL_RESOLUTION_TEMPLATE } from '../cli/lib-runner.js';

const now = '2026-07-07T00:00:00.000Z';
const w = process.argv[2] || '/home/jimmy/taskops-runs/openclaw-rollout';
if (existsSync(w)) rmSync(w, { recursive: true, force: true });
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
const md = (p, fm, b) => { mkdirSync(join(w, p, '..'), { recursive: true }); writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8'); };
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'ocrollout', title: 'Checkout rollout plan (openclaw)', objective: 'Plan the rollout of a new checkout flow; a human picks the approach.', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });

const task = (id, order, objective, extra = {}, body) => md(`${tv}/tasks/${id}.md`, {
  taskOpsVersion: 'v1', entityType: 'task', id, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: extra.title || id, objective, responsibility: extra.responsibility || 'produce the deliverable', completionCriteria: extra.completionCriteria || 'deliverable produced',
  order, createdAt: now, status: extra.status || 'pending', runReadiness: extra.runReadiness || 'runnable', understandingLevel: 'known',
  acceptance: { mode: 'informational', expectedOutcome: extra.expectedOutcome || 'a written deliverable' },
  ...(extra.resolverKind ? { resolverKind: extra.resolverKind } : {}),
  ...(extra.blockedBy ? { blockedBy: extra.blockedBy } : {}),
}, body);

task('research', 1, 'Analyze the main risks of shipping a new checkout flow to production (payment failures, cart loss, conversion drop). List the top 4 risks, each in one line.', { title: 'Research rollout risks', expectedOutcome: 'top-4 risk list' });
task('approach-a', 2, 'Draft Approach A = a big-bang cutover (switch all traffic at once). Give 2 pros and 2 cons in <=5 lines.', { title: 'Draft Approach A (big-bang)', expectedOutcome: 'A pros/cons' });
task('approach-b', 3, 'Draft Approach B = a staged canary (1% -> 10% -> 100% over days). Give 2 pros and 2 cons in <=5 lines.', { title: 'Draft Approach B (staged canary)', expectedOutcome: 'B pros/cons' });

// the HUMAN delegation — gates the final two tasks
const decisionBody = EXTERNAL_RESOLUTION_TEMPLATE
  .replace('<agent: the single decision that could not be settled — one decision unit, crisp>', 'Which rollout approach should we commit to for the new checkout flow — A (big-bang cutover) or B (staged canary)?')
  .replace('<agent: candidate answers with trade-offs; if you cannot enumerate them, add an\nexplicit "open:" line naming what is unknown — do not leave this empty>', 'A) big-bang — fastest, but a bad bug hits 100% of buyers at once.\nB) staged canary — slower, but limits blast radius and is reversible. (Recommended unless launch timing forces A.)');
task('pick-approach', 4, 'Await the human decision on the rollout approach (A or B), then record it.', { title: 'HUMAN: pick the rollout approach', responsibility: 'own the go/no-go approach choice', completionCriteria: 'an approach is chosen by a human', resolverKind: 'human' }, decisionBody);

task('rollout-plan', 5, 'Write the concrete rollout steps for the approach chosen in pick-approach (honor the recorded human decision): the sequence, the gates/metrics to watch at each stage, and who signs off. <=8 lines.', { title: 'Write the rollout plan', expectedOutcome: 'staged rollout steps', status: 'blocked', runReadiness: 'blocked', blockedBy: [{ type: 'task', taskId: 'pick-approach' }] });
task('rollback-plan', 6, 'Write the rollback / abort plan for the chosen approach: the trigger conditions, the exact rollback steps, and the max acceptable blast radius. <=6 lines.', { title: 'Write the rollback plan', expectedOutcome: 'rollback plan', status: 'blocked', runReadiness: 'blocked', blockedBy: [{ type: 'task', taskId: 'pick-approach' }] });

console.log(w);
