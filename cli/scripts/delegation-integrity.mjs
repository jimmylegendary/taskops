#!/usr/bin/env node
// Regression (Track B / D0 — delegation integrity): the honesty×delegation core. A task delegated to a human/ai
// (resolverKind + an external-resolution block) must (1) NEVER become verified_done while unresolved — a pending
// delegation is never a false completion; (2) an ORPHANED / INVALID (partially-filled) delegation stays HELD
// (delegation_pending), never silently completed or dropped; (3) once RESOLVED it proceeds. This is what makes an
// honest stall a *continuable handoff* rather than a dead end.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { runTaskOps, pickNextAction, EXTERNAL_RESOLUTION_TEMPLATE } from '../lib-runner.js';

const now = '2026-07-05T00:00:00.000Z';
function build(body) {
  const root = mkdtempSync(join(tmpdir(), 'taskops-deleg-'));
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm, b) => writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'dg', title: 'D', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/t.md`, {
    taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
    title: 'Decide', objective: 'Pick the strategy.', responsibility: 'Own the choice.', completionCriteria: 'A decision is recorded.',
    order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', resolverKind: 'human',
    acceptance: { mode: 'guarded', expectedOutcome: 'decision recorded', requiredChecks: [{ command: 'exit 0' }] },
  }, body);
  return w;
}
const task = (w) => parseMarkdownFile(join(w, 'task-groups/tg-root/versions/tgv-root-v1/tasks/t.md'));

// 1) UNRESOLVED delegation: run to exhaustion — the task must NOT be done/verified; the runner stops
// delegation_pending (an honest, resolvable handoff), and the delegation is not silently dropped.
{
  const w = build(EXTERNAL_RESOLUTION_TEMPLATE);
  const res = runTaskOps(w, { executor: 'dry-run', maxSteps: 5, verifyChecks: true, continueOnFailure: true });
  assert.notEqual(task(w).status, 'done', 'an unresolved delegation is NEVER completed');
  assert.equal(res.stopReason, 'delegation_pending', 'the runner surfaces the pending handoff, not all_closed');
  rmSync(join(w, '..'), { recursive: true, force: true });
}

// 2) ORPHANED / INVALID delegation (DECISION filled, BASIS left as the placeholder) must stay HELD, never
// completed or dropped — a half-answered handoff is not a resolution.
{
  const invalid = EXTERNAL_RESOLUTION_TEMPLATE.replace('<resolver: the concrete, downstream-consumable choice — a value, not prose>', 'Strategy A');
  const w = build(invalid);
  const pick = pickNextAction(parseProject(w));
  assert.equal(pick.kind, 'stop', 'a partially-filled (invalid) delegation must not be handed to execute');
  assert.equal(pick.reason, 'delegation_pending', 'an invalid resolution is held, not treated as resolved');
  const res = runTaskOps(w, { executor: 'dry-run', maxSteps: 5, verifyChecks: true, continueOnFailure: true });
  assert.notEqual(task(w).status, 'done', 'an invalid/orphaned delegation is never completed');
  rmSync(join(w, '..'), { recursive: true, force: true });
}

// 3) RESOLVED delegation proceeds (the handoff is continuable): once DECISION+BASIS are filled the task is handed
// to execution and completes (guarded check passes under verify).
{
  const resolved = EXTERNAL_RESOLUTION_TEMPLATE
    .replace('<resolver: the concrete, downstream-consumable choice — a value, not prose>', 'Strategy A')
    .replace('<resolver: the grounds for this decision>', 'A fits the roadmap.');
  assert.equal(resolved.includes('<resolver:'), false, 'fixture fully resolves');
  const w = build(resolved);
  assert.equal(pickNextAction(parseProject(w)).kind, 'execute', 'a resolved delegation is handed to execution (resume)');
  const res = runTaskOps(w, { executor: 'dry-run', maxSteps: 3, verifyChecks: true, continueOnFailure: true });
  assert.equal(task(w).status, 'done', 'a resolved delegation resumes and completes');
  rmSync(join(w, '..'), { recursive: true, force: true });
}

console.log('OK delegation-integrity (pending never completed / invalid held / resolved resumes)');
