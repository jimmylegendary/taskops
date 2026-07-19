#!/usr/bin/env node
// Failure certificate + assurance ledger (F1-북극성 P0-1; spec docs/specs/failure-certificate.md): the DONE
// side already carries the P1 assuranceTier; this locks the FAIL side (typed failure certificates) and the
// audit propagation — a self_verified closure must flip claimSafe (the Arm-D self_ground_gap hole), an
// infra/protocol close must stay OUT of the failure ledger (undetermined = F1's third class), and a guarded
// verify-rejection must certify as content with the fixpoint trajectory attached (since s3-probes a SATURATED
// stable rejection carries F-2/F-3 probe evidence and mints verified_failure; see failure-probes.mjs).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { runTaskOps, buildFailureCertificate } from '../lib-runner.js';
import { auditParsedWork } from '../lib-audit.js';

const now = '2026-07-19T00:00:00.000Z';
function build(root, checks, acceptanceExtra = {}) {
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'fc', title: 'F', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/t.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 't', objective: 'x', responsibility: 'own', completionCriteria: 'check', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'check', requiredChecks: checks.map((command) => ({ command })), ...acceptanceExtra } });
  return w;
}
const taskPath = (w) => join(w, 'task-groups/tg-root/versions/tgv-root-v1/tasks/t.md');
const readTask = (w) => parseMarkdownFile(taskPath(w));
const rewriteTask = (w, mutate) => {
  const fm = parseMarkdownFile(taskPath(w));
  delete fm.path; delete fm.body;
  mutate(fm);
  writeFileSync(taskPath(w), `${fmBlock(fm)}# t\n`, 'utf8');
};
const audit = (w) => auditParsedWork(parseProject(w));
const once = (m) => `test -f ${m} || { touch ${m}; exit 1; }`; // fails once, passes thereafter

// T1 — P0-1: a self_verified closure must flip claimSafe (regression lock on the Arm-D hole where a
// self-authored check minted claimSafe=true).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-fc-t1-'));
  const w = build(root, ['true'], { selfAuthoredCheck: true });
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  assert.equal(readTask(w).status, 'done', 'the self-authored close itself still succeeds');
  const a = audit(w);
  assert.ok(a.issues.some((i) => i.code === 'self_verified_closure_present' && i.severity === 'error'), 'self_verified closure surfaces as an ERROR issue');
  assert.equal(a.claimSafe, false, 'self_verified closure must never mint claimSafe=true (P0-1)');
  assert.equal(a.assurance.floor, 'self_verified');
  assert.equal(a.assurance.externallySafe, false);
  rmSync(root, { recursive: true, force: true });
}

// T2 — control: an EXTERNAL verified close keeps claimSafe and earns the pure-assurance externallySafe.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-fc-t2-'));
  const w = build(root, ['true']);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  const a = audit(w);
  assert.equal(a.assurance.floor, 'verified');
  assert.equal(a.assurance.externallySafe, true);
  assert.ok(a.issues.every((i) => i.code !== 'self_verified_closure_present'));
  assert.equal(a.claimSafe, true, 'an externally verified close remains claim-safe');
  rmSync(root, { recursive: true, force: true });
}

// T3 — content certificate: a guarded verify-rejection closes certified with the fixpoint trajectory.
// SPEC-DRIVEN UPDATE (s3-probes): the v0 tier ceiling is lifted — a SATURATED runner-rejection now carries
// measured rerun-stability (F-2, K=2 in the same cwd) + a captured minimal repro (F-3), so this stable
// 'exit 1' close mints verified_failure instead of the old runner_rejected ceiling. Assertions strengthened
// (tier raised + probe/repro presence added), none deleted; the runner_rejected ceiling without probe
// evidence is still locked by T6 and by failure-probes.mjs P4/P5.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-fc-t3-'));
  const w = build(root, ['exit 1']);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true, verifyRetries: 1, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'blocked');
  const c = t.failureCertificate;
  assert.ok(c, 'a guarded review-fail close carries a failure certificate');
  assert.equal(c.kind, 'content');
  assert.equal(c.failureTier, 'verified_failure', 'a stable, reproduced runner-rejection certifies at the measured top tier (F-2/F-3)');
  assert.equal(c.probes.flaky.verdict, 'stable', 'the K-run rerun reproduced every rejection');
  assert.ok(c.minimalRepro, 'the promotion carries a captured minimal repro');
  assert.equal(c.saturated, true);
  assert.equal(c.scope, 'resource_relative', 'the certificate never claims intrinsic impossibility');
  assert.ok(c.failureSignature, 'the fixpoint signature is attached (F-4)');
  assert.ok(Number(c.attempts) >= 1);
  const a = audit(w);
  assert.equal(a.assurance.failureLedger.content, 1);
  assert.equal(a.assurance.failureLedger.undetermined, 0);
  assert.equal(a.claimSafe, false);
  assert.ok(a.issues.every((i) => i.code !== 'blocked_without_failure_certificate'), 'a certified close does not warn as uncertified');
  rmSync(root, { recursive: true, force: true });
}

// T4 — an infra close is UNDETERMINED: excluded from the failure ledger (F1's third class), surfaced as info.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-fc-t4-'));
  const w = build(root, ['true']);
  rewriteTask(w, (fm) => { fm.status = 'blocked'; fm.failureCertificate = buildFailureCertificate({ kind: 'infra', reasons: ['spawn failed'] }); });
  const a = audit(w);
  assert.equal(a.assurance.failureLedger.undetermined, 1);
  assert.equal(a.assurance.failureLedger.content, 0, 'an infra close is never counted as a content failure');
  assert.ok(a.issues.some((i) => i.code === 'undetermined_failures_present' && i.severity === 'info'));
  assert.ok(a.issues.every((i) => i.code !== 'blocked_without_failure_certificate'));
  rmSync(root, { recursive: true, force: true });
}

// T5 — a legacy blocked close WITHOUT a certificate is an untyped failure: warned, never counted as true failure.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-fc-t5-'));
  const w = build(root, ['true']);
  rewriteTask(w, (fm) => { fm.status = 'blocked'; });
  const a = audit(w);
  assert.equal(a.assurance.failureLedger.uncertified, 1);
  assert.ok(a.issues.some((i) => i.code === 'blocked_without_failure_certificate' && i.severity === 'warning'));
  rmSync(root, { recursive: true, force: true });
}

// T6 — helper contract: tier ladder + invariant scope (WITHOUT probe evidence the ceiling stays
// runner_rejected — verified_failure is mintable only from F-2 stable probes + an F-3 repro, see failure-probes.mjs).
{
  assert.equal(buildFailureCertificate({ kind: 'infra' }).failureTier, 'undetermined');
  assert.equal(buildFailureCertificate({ kind: 'protocol' }).failureTier, 'undetermined');
  assert.equal(buildFailureCertificate({ kind: 'content' }).failureTier, 'self_reported_failure');
  assert.equal(buildFailureCertificate({ kind: 'content', verifyMode: true, runnerRejected: true }).failureTier, 'runner_rejected');
  for (const kind of ['infra', 'protocol', 'content']) assert.equal(buildFailureCertificate({ kind }).scope, 'resource_relative');
}

// T7 — no certificate survives an honest success (a retried-then-passing check closes done, certificate-free).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-fc-t7-'));
  const w = build(root, [once(join(root, 'ok'))]);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true, verifyRetries: 2, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'done');
  assert.equal(t.failureCertificate, undefined, 'no failure certificate on a successful close');
  rmSync(root, { recursive: true, force: true });
}

console.log('failure-certificate: OK (T1-T7)');
