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
import { runTaskOps, uuPrior, buildAgentExecutionPrompt, buildAgentDecompositionPrompt, buildComprehensionQuizPrompt } from '../lib-runner.js';

const now = '2026-07-09T00:00:00.000Z';
function build(root, checks, acceptanceExtra = {}) {
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'ep', title: 'E', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/t.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 't', objective: 'x', responsibility: 'own', completionCriteria: 'check', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'check', requiredChecks: checks.map((command) => ({ command })), ...acceptanceExtra } });
  return w;
}
const readReview = (w) => {
  const t = readTask(w);
  const rr = (t.runRefs || [])[0] || {};
  return parseMarkdownFile(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)).reviewReport;
};
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

// E) U7 uu-prior + U6 proactive elicitation: a simple task has a LOW prior (map ~complete) and its execution prompt
// carries NO precondition-elicitation; a task flagged unknown-unknown / already frictioned has a HIGH prior and its
// prompt DOES instruct it to surface + flag unverifiable preconditions (catch silent-wrong-assumptions).
{
  const simple = { id: 't', title: 't', objective: 'print hello', understandingLevel: 'known' };
  const murky = { id: 't', title: 't', objective: 'print hello', uncertaintyState: 'unknown_unknown', surpriseHistory: [{ id: 's1' }] };
  assert.ok(uuPrior(simple) < 0.5, `a simple known task has a low uu-prior (got ${uuPrior(simple)})`);
  assert.ok(uuPrior(murky) >= 0.5, `an unknown-unknown + frictioned task has a high uu-prior (got ${uuPrior(murky)})`);
  const project = { id: 'p', title: 'P', objective: 'o' };
  const pSimple = buildAgentExecutionPrompt({ project, task: simple });
  const pMurky = buildAgentExecutionPrompt({ project, task: murky });
  assert.ok(!pSimple.includes('PRECONDITIONS (U6'), 'low uu-prior => no elicitation injected (existing prompts unchanged)');
  assert.ok(pMurky.includes('PRECONDITIONS (U6') && pMurky.includes('FLAG any you cannot verify'), 'high uu-prior => proactive precondition elicitation is injected');
}

// F) U4 CAPABILITY-DELEGATE rung: with an escalationResolvers pool, a fixpoint re-attempts the task with a
// different/stronger resolver (executorOverride + escalatedResolvers) before any gg — saturation is resource-relative.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-ep-deleg-'));
  const w = build(root, ['exit 1']);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 2, verifyChecks: true, verifyRetries: 1, escalationResolvers: ['codex-cli'], continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.executorOverride, 'codex-cli', 'a fixpoint re-attempts with the next resolver in the escalation pool (capability-delegate rung)');
  assert.ok(Array.isArray(t.escalatedResolvers) && t.escalatedResolvers.includes('codex-cli'), 'the tried resolver is recorded so gg only follows a full-pool fixpoint');
  assert.notEqual(t.status, 'done', 'capability-delegation never fabricates a completion');
  rmSync(root, { recursive: true, force: true });
}

// G) U7 ADAPTIVE DEPTH: a high uu-prior biases the DECOMPOSE prompt toward coarser/deeper decomposition (assume more
// hidden unknowns); a low-prior task's decompose prompt is unchanged.
{
  const root = mkdtempSync(join(tmpdir(), "taskops-ep-g-"));
  const project = { id: 'p', title: 'P', objective: 'o' };
  const simple = { id: 't', title: 't', objective: 'print hello', understandingLevel: 'known', taskGroupVersionId: 'tgv' };
  const murky = { id: 't', title: 't', objective: 'print hello', uncertaintyState: 'unknown_unknown', surpriseHistory: [{ id: 's1' }], taskGroupVersionId: 'tgv' };
  const dSimple = buildAgentDecompositionPrompt({ project, projectDir: root, task: simple });
  const dMurky = buildAgentDecompositionPrompt({ project, projectDir: root, task: murky });
  assert.ok(!dSimple.includes('HIGH uncertainty prior'), 'low uu-prior => decompose prompt unchanged');
  assert.ok(dMurky.includes('HIGH uncertainty prior'), 'high uu-prior => decompose prompt biases toward coarser/deeper decomposition');
}

// H) P1 ASSURANCE TIER: a passing SELF-AUTHORED check closes done but only at the `self_verified` tier (provisional,
// externallyVerified=false, caveat surfaced) — never the full `verified` tier an INDEPENDENT/external check earns.
// This is the honest floor under oracle-free self-grounding: a check the executor authored can confirm "my code does
// what I think" but not "my scope is even right" (the acceptance and the implementation share one mind).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-ep-p1self-'));
  const w = build(root, ['true'], { selfAuthoredCheck: true });
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  const t = readTask(w); const r = readReview(w);
  assert.equal(t.status, 'done', 'a passing self-authored check still closes the task');
  assert.equal(r.decision, 'approved');
  assert.equal(r.assuranceTier, 'self_verified', 'a self-authored check earns only the self_verified tier');
  assert.equal(r.externallyVerified, false, 'self-authored is NOT externally verified');
  assert.ok((r.followUpNeeded || []).some((f) => /self_verified/.test(f)), 'the provisional caveat is surfaced');
  rmSync(root, { recursive: true, force: true });
}
// control) an EXTERNAL (default) passing check earns the full `verified` tier + externallyVerified=true.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-ep-p1ext-'));
  const w = build(root, ['true']);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  const r = readReview(w);
  assert.equal(r.decision, 'approved');
  assert.equal(r.assuranceTier, 'verified', 'an external runner-executed check earns the full verified tier');
  assert.equal(r.externallyVerified, true, 'external check => externallyVerified');
  rmSync(root, { recursive: true, force: true });
}

// I) P2/P3 QUIZ PROMPT: seeded from the DIFF surface (P2) + prioritises the INVERSE/round-trip (P3 — the write-only-
// scope gap class that produced the astropy-14182 self_ground_gap); falls back cleanly when there is no diff.
{
  const task = { id: 't', title: 'T', objective: 'add a writer' };
  const acceptance = { requiredChecks: [{ command: 'pytest' }] };
  const withDiff = buildComprehensionQuizPrompt({ task, acceptance, cwd: '/x', diffText: '--- a/rst.py\n+++ b/rst.py\n+    def write(self, lines):', touchedFiles: 'io/ascii/rst.py' });
  assert.ok(withDiff.includes('TOUCHED these files: io/ascii/rst.py'), 'quiz is seeded from the diff surface (P2)');
  assert.ok(withDiff.includes('git diff HEAD'), 'the diff is shown to the reviewer (P2)');
  assert.ok(/INVERSE \/ ROUND-TRIP/i.test(withDiff) && /reader\/decoder\/parser\/getter/.test(withDiff), 'prioritises the inverse/round-trip (P3)');
  const noDiff = buildComprehensionQuizPrompt({ task, acceptance, cwd: '/x' });
  assert.ok(!noDiff.includes('TOUCHED these files'), 'falls back cleanly when there is no diff');
  assert.ok(/INVERSE \/ ROUND-TRIP/i.test(noDiff), 'the inverse/round-trip instruction is present even without a diff');
}

console.log('OK epistemic-loop (U1-U7 + P1 self_verified tier + P2/P3 diff-seeded inverse-aware quiz: novelty-bounded retry, saturation + resource-relative escalation ladder [delegate+decompose], ledger cleared, uu-prior gates proactive elicitation + adaptive depth)');
