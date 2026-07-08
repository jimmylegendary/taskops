#!/usr/bin/env node
// Epistemic loop (U1 ledger + U3 novelty-bounded retry + U5 saturation close): a verify-fail is friction. While the
// failure keeps CHANGING (novel = the model surfaced a new unknown), retry BEYOND the verifyRetries floor; when the
// failure REPEATS (fixpoint = the model reproduced the same failed map), stop and close as SATURATION — an honest,
// trajectory-grounded stall distinct from a plain first-attempt block. Deterministic marker checks stand in for a
// model whose failures shift (novel) vs stay the same (stuck).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';

const now = '2026-07-09T00:00:00.000Z';
function build(root, checks) {
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'ep', title: 'E', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/t.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 't', objective: 'x', responsibility: 'own', completionCriteria: 'check', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'check', requiredChecks: checks.map((command) => ({ command })) } });
  return w;
}
const readTask = (w) => parseMarkdownFile(join(w, 'task-groups/tg-root/versions/tgv-root-v1/tasks/t.md'));
const once = (m) => `test -f ${m} || { touch ${m}; exit 1; }`;  // fails once (creates m), passes thereafter

// A) NOVELTY EXTENSION: with a floor of 1, a failure whose set CHANGES (c1 stops failing after round 0, so the
// failed-set shrinks {c1,c2}->{c2}) is NOVEL, so the loop retries BEYOND the floor. It only stops once the failure
// repeats ({c2}=={c2}). => verifyAttempts > verifyRetries, ends SATURATION.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-ep-novel-'));
  const w = build(root, [once(join(root, 'm1')), 'exit 1']);   // c1 fails once, c2 always fails
  runTaskOps(w, { executor: 'dry-run', maxSteps: 12, verifyChecks: true, verifyRetries: 1, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'blocked', 'a genuinely unsatisfiable check still ends honestly blocked (never falsely done)');
  assert.equal(t.saturation, true, 'the fixpoint close is labeled saturation, not a plain block');
  assert.ok(Number(t.verifyAttempts) > 1, `novel failures extended retries beyond the floor of 1 (got ${t.verifyAttempts})`);
  assert.ok(Array.isArray(t.attemptLedger) && t.attemptLedger.some((e) => e.novel === true), 'the attempt ledger recorded a novel round');
  rmSync(root, { recursive: true, force: true });
}

// B) NON-NOVEL BOUNDED + SATURATION LABEL: an always-identical failure never extends — bounded exactly at the floor
// (deterministic budget preserved) — and closes as saturation with the ledger.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-ep-stuck-'));
  const w = build(root, ['exit 1']);   // same failure every round
  runTaskOps(w, { executor: 'dry-run', maxSteps: 12, verifyChecks: true, verifyRetries: 2, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'blocked', 'a repeating failure ends honestly blocked');
  assert.equal(Number(t.verifyAttempts), 2, 'a non-novel (repeating) failure is bounded exactly at the floor — no extension');
  assert.equal(t.saturation, true, 'the bounded fixpoint is labeled saturation');
  rmSync(root, { recursive: true, force: true });
}

// C) SUCCESS CLEARS THE LEDGER: a check that fails once then passes closes verified-done and strips the loop state.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-ep-ok-'));
  const w = build(root, [once(join(root, 'ok'))]);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true, verifyRetries: 2, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'done', 'a converted stall closes verified-done');
  assert.equal(t.attemptLedger, undefined, 'the attempt ledger is cleared on honest success');
  assert.equal(t.saturation, undefined, 'no saturation flag on success');
  rmSync(root, { recursive: true, force: true });
}

// D) U4 RESOURCE-RELATIVE ESCALATION: with escalateOnSaturation, a single-resource fixpoint does NOT immediately gg
// — it escalates ONE rung, re-decomposing the saturated "atomic" leaf into finer sub-goals (needs_decomposition +
// saturationEscalated), never falsely done. (Default off = plain saturation block, covered by B.)
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-ep-esc-'));
  const w = build(root, ['exit 1']);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 2, verifyChecks: true, verifyRetries: 1, escalateOnSaturation: true, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.saturationEscalated, true, 'a saturated leaf escalated one rung instead of an immediate gg');
  assert.equal(t.runReadiness, 'needs_decomposition', 'the escalation re-routes the fixpointed leaf to decomposition (attack the unknown-unknown via smaller known-unknowns)');
  assert.notEqual(t.status, 'done', 'escalation never fabricates a completion (safety holds across the loop)');
  rmSync(root, { recursive: true, force: true });
}

console.log('OK epistemic-loop (novelty extends beyond floor, non-novel bounded, saturation labeled, ledger cleared on success, saturation escalates one rung)');
