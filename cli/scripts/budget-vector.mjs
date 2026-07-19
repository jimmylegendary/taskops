#!/usr/bin/env node
// Budget vector v1 — wall-clock dimension (P0-2; spec docs/specs/budget-vector.md): runTaskOps gains a global
// wall-clock cap (option maxWallClockMs, env TASKOPS_MAX_WALL_MS fallback, option wins). Exhaustion is a
// SCHEDULING STOP checked between step dispatches — the ethos invariant under test is that it never fabricates
// a claim about any task: remaining runnable tasks stay pending (no blocked, no failureCertificate), every
// dispatched step finishes and closes honestly, and exhaustion surfaces only via stopReason/event/return value.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';
import { auditParsedWork } from '../lib-audit.js';

const now = '2026-07-19T00:00:00.000Z';
// Two runnable tasks; each guarded check sleeps >=10ms so any dispatched step provably outlasts a 1ms cap
// (neutralizes the only timing-flake vector: a sub-cap step completing before the between-dispatch check).
function build(root) {
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'bv', title: 'B', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  for (const [id, order] of [['t1', 1], ['t2', 2]]) {
    md(`${tv}/tasks/${id}.md`, { taskOpsVersion: 'v1', entityType: 'task', id, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: id, objective: 'x', responsibility: 'own', completionCriteria: 'check', order, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'check', requiredChecks: [{ command: 'sleep 0.01' }] } });
  }
  return w;
}
const readTask = (w, id) => parseMarkdownFile(join(w, `task-groups/tg-root/versions/tgv-root-v1/tasks/${id}.md`));
const audit = (w) => auditParsedWork(parseProject(w));
const events = (r) => readFileSync(r.eventsPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const exhaustedEvents = (r) => events(r).filter((e) => e.type === 'budget_exhausted');

// Shared exhaustion contract for T1/T3: scheduling stopped, honesty invariant intact.
function assertExhausted(w, r, cap) {
  assert.equal(r.stopReason, 'budget_exhausted');
  assert.equal(r.budgetExhausted, true, 'return value surfaces budgetExhausted:true');
  assert.equal(r.maxWallClockMs, cap);
  assert.ok(r.stepsRun <= 1, `at most one dispatch under a ${cap}ms cap (the check may fire before the first); got ${r.stepsRun}`);
  const ex = exhaustedEvents(r);
  assert.equal(ex.length, 1, 'exactly one budget_exhausted event');
  assert.equal(ex[0].dimension, 'wall_clock');
  assert.equal(ex[0].maxWallClockMs, cap);
  assert.ok(Number.isFinite(ex[0].elapsedMs) && ex[0].elapsedMs >= cap, 'event carries a real elapsedMs at or past the cap');
  // Honesty invariant: exhaustion is a claim about the RUN's resources, never about any task.
  const statuses = ['t1', 't2'].map((id) => {
    const t = readTask(w, id);
    assert.equal(t.failureCertificate, undefined, `${id} never gains a failureCertificate from budget exhaustion`);
    return t.status;
  });
  for (const s of statuses) assert.ok(s === 'pending' || s === 'done', `tasks stay pending or honestly done, never blocked/failed (got ${s})`);
  assert.equal(statuses.filter((s) => s === 'done').length, r.stepsRun, 'every dispatched step closed honestly; nothing else moved');
  assert.ok(statuses.includes('pending'), 'at least one task remains pending (scheduling stop, not completion)');
  const a = audit(w);
  assert.equal(a.assurance.failureLedger.content, 0);
  assert.equal(a.assurance.failureLedger.uncertified, 0);
  assert.ok(a.issues.every((i) => i.code !== 'blocked_without_failure_certificate'), 'budget exhaustion never fabricates a blocked close');
}

// T1 — exhaustion is a scheduling stop (option path): 1ms cap over two runnable tasks.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-bv-t1-'));
  const w = build(root);
  const r = runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true, maxWallClockMs: 1 });
  assertExhausted(w, r, 1);
  rmSync(root, { recursive: true, force: true });
}

// T2 — ample budget is a no-op: both tasks close done, zero budget_exhausted events.
// (stopReason all_closed vs no_runnable is NOT this test's contract — only "not budget_exhausted" is.)
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-bv-t2-'));
  const w = build(root);
  const r = runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true, maxWallClockMs: 60000 });
  assert.equal(readTask(w, 't1').status, 'done');
  assert.equal(readTask(w, 't2').status, 'done');
  assert.equal(r.stepsRun, 2);
  assert.equal(r.budgetExhausted, false, 'budgetExhausted is an always-present boolean, false on a no-op cap');
  assert.notEqual(r.stopReason, 'budget_exhausted');
  assert.equal(exhaustedEvents(r).length, 0);
  rmSync(root, { recursive: true, force: true });
}

// T3 — env fallback: TASKOPS_MAX_WALL_MS reaches the runner when the option is absent.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-bv-t3-'));
  const w = build(root);
  process.env.TASKOPS_MAX_WALL_MS = '1';
  try {
    const r = runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true });
    assertExhausted(w, r, 1);
  } finally {
    delete process.env.TASKOPS_MAX_WALL_MS;
  }
  rmSync(root, { recursive: true, force: true });
}

// T4 — precedence lock: the explicit option beats the ambient env (the option-wins rule would otherwise be untested).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-bv-t4-'));
  const w = build(root);
  process.env.TASKOPS_MAX_WALL_MS = '1';
  try {
    const r = runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true, maxWallClockMs: 60000 });
    assert.equal(readTask(w, 't1').status, 'done');
    assert.equal(readTask(w, 't2').status, 'done');
    assert.equal(r.budgetExhausted, false);
    assert.equal(exhaustedEvents(r).length, 0);
  } finally {
    delete process.env.TASKOPS_MAX_WALL_MS;
  }
  rmSync(root, { recursive: true, force: true });
}

// T5 — invalid cap rejected loudly BEFORE lock acquisition: the immediate follow-up run must not hit a stale
// runner lock, proving the validator sits pre-lock like the --max-steps/--until validators.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-bv-t5-'));
  const w = build(root);
  assert.throws(() => runTaskOps(w, { executor: 'dry-run', maxWallClockMs: 'nope' }), /Invalid.*maxWallClockMs|max-wall/);
  const r = runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true, maxWallClockMs: 60000 });
  assert.equal(r.budgetExhausted, false);
  assert.equal(readTask(w, 't1').status, 'done');
  assert.equal(readTask(w, 't2').status, 'done');
  rmSync(root, { recursive: true, force: true });
}

console.log('budget-vector: OK (T1-T5)');
