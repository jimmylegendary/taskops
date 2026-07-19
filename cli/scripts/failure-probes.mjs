#!/usr/bin/env node
// F-2 (verifier self-check: flaky probe) + F-3 (minimal repro) — verified_failure issuance (spec
// docs/specs/failure-certificate.md §3): the TOP failure tier is EARNED from measurement, never asserted. At
// the SATURATED verify-rejected close the runner re-executes the failing checks (K=2, same cwd/env/timeout as
// the verify exec): any passing rerun means the VERIFIER is unstable — tier DEMOTED to undetermined and the
// check quarantined (a check that cannot reproduce its own rejection must never certify content failure); all
// reruns failing means the rejection is stable and a deterministic repro capture (command + exitCode + output
// sha256) PROMOTES to verified_failure. Probes fire only at the saturated final close (cost bound) and only
// ever demote/promote a runner-rejection — they never invent one from a self-reported close.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { runTaskOps, buildFailureCertificate } from '../lib-runner.js';
import { auditParsedWork, renderAuditText } from '../lib-audit.js';

const now = '2026-07-19T00:00:00.000Z';
function build(root, checks, acceptanceExtra = {}) {
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'fp', title: 'P', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/t.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 't', objective: 'x', responsibility: 'own', completionCriteria: 'check', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'check', requiredChecks: checks.map((command) => ({ command })), ...acceptanceExtra } });
  return w;
}
const taskPath = (w) => join(w, 'task-groups/tg-root/versions/tgv-root-v1/tasks/t.md');
const readTask = (w) => parseMarkdownFile(taskPath(w));
const audit = (w) => auditParsedWork(parseProject(w));
// sha256('') — 'exit 1' emits no output on any POSIX sh, so the repro sha over the normalized (\r-stripped,
// 4096-sliced) EMPTY capture is a constant: locks the whole normalization pipeline, not just "some hex".
const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// P1 — stable failing check mints verified_failure with a minimal repro; P1b — audit ledger + render surface.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-fp-p1-'));
  const w = build(root, ['exit 1']);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true, verifyRetries: 1, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'blocked');
  const c = t.failureCertificate;
  assert.ok(c, 'the saturated rejected close carries a failure certificate');
  assert.equal(c.kind, 'content');
  assert.equal(c.failureTier, 'verified_failure', 'stable K=2 rerun + captured repro promotes to the top tier');
  assert.equal(c.saturated, true);
  assert.equal(c.scope, 'resource_relative', 'even the top tier never claims intrinsic impossibility');
  assert.equal(c.probes.flaky.verdict, 'stable');
  assert.equal(c.probes.flaky.runsPerCommand, 2);
  assert.deepEqual(c.probes.flaky.commandsProbed, ['exit 1']);
  assert.equal(c.probes.baseline.skipped, 'no_baseline_machinery', 'the skipped baseline is recorded, never silently absent');
  assert.equal(c.minimalRepro.command, 'exit 1');
  assert.equal(c.minimalRepro.exitCode, 1);
  assert.ok(/^[0-9a-f]{64}$/.test(c.minimalRepro.outputSha256), 'repro carries a full sha256 of the normalized output');
  assert.equal(c.minimalRepro.outputSha256, SHA256_EMPTY, 'normalization pipeline (\\r-strip + 4096-slice) is deterministic');
  assert.ok(c.minimalRepro.capturedAt, 'repro capture is timestamped');
  assert.equal(t.quarantinedChecks, undefined, 'a stable check is never quarantined');
  // P1b — the audit consumes the tier through the ledger and the render surface (same workspace, pre-rmSync).
  const a = audit(w);
  assert.equal(a.assurance.failureLedger.verifiedFailure, 1);
  assert.equal(a.assurance.failureLedger.content, 1, 'a verified failure is still a content failure');
  assert.equal(a.assurance.failureLedger.undetermined, 0);
  assert.equal(a.claimSafe, false);
  assert.ok(renderAuditText(a).includes('verifiedFailure=1'), 'the render surface exposes the count');
  assert.ok(a.issues.every((i) => i.code !== 'blocked_without_failure_certificate'), 'a certified close does not warn as uncertified');
  rmSync(root, { recursive: true, force: true });
}

// P2 — a flaky check (fails exactly twice, then passes: the verify exec consumes both failures, so the probe
// rerun passes) DEMOTES to undetermined + quarantines the command; the ledger must NOT count it as a true
// content failure (a verifier-flake close is F1's third class, not evidence against the work).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-fp-p2-'));
  const A = join(root, 'A');
  const B = join(root, 'B');
  const cmd = `test -f ${A} || { touch ${A}; exit 1; }; test -f ${B} || { touch ${B}; exit 1; }`;
  const w = build(root, [cmd]);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true, verifyRetries: 1, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'blocked');
  const c = t.failureCertificate;
  assert.equal(c.kind, 'content', 'the demotion changes the TIER, never falsifies the close kind');
  assert.equal(c.failureTier, 'undetermined', 'an unstable verifier cannot certify content failure');
  assert.equal(c.probes.flaky.verdict, 'flaky');
  assert.equal(c.minimalRepro, undefined, 'no repro is minted from an unstable check');
  assert.ok(Array.isArray(t.quarantinedChecks) && t.quarantinedChecks.includes(cmd), 'the flaky command is quarantined on the task');
  const a = audit(w);
  assert.equal(a.assurance.failureLedger.undetermined, 1);
  assert.equal(a.assurance.failureLedger.content, 0, 'a quarantined-verifier close is NOT a true content failure');
  assert.equal(a.assurance.failureLedger.verifiedFailure, 0);
  assert.ok(a.issues.some((i) => i.code === 'undetermined_failures_present' && i.severity === 'info'));
  rmSync(root, { recursive: true, force: true });
}

// P3 — verifyMode OFF: a content close runs NO probes and keeps the self-report tier (probes require runner
// evidence to act on; a self-reported close has none, and the probe machinery must not fabricate it).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-fp-p3-'));
  const w = build(root, ['exit 1']);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: false, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'blocked');
  const c = t.failureCertificate;
  assert.equal(c.kind, 'content');
  assert.equal(c.failureTier, 'self_reported_failure');
  assert.equal(c.probes, undefined, 'no probes outside verify mode');
  assert.equal(c.minimalRepro, undefined);
  assert.equal(t.quarantinedChecks, undefined);
  rmSync(root, { recursive: true, force: true });
}

// P4 — cost-bound gate: rejected-but-NOT-saturated (verifyRetries:0) keeps the runner_rejected ceiling with
// no probes. This boundary is intentional (probes fire ONLY at the saturated final close), locked here so a
// later edit cannot silently widen the probe surface.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-fp-p4-'));
  const w = build(root, ['exit 1']);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'blocked');
  const c = t.failureCertificate;
  assert.equal(c.failureTier, 'runner_rejected');
  assert.equal(c.saturated, false);
  assert.equal(c.probes, undefined, 'probes fire only at the saturated final close');
  rmSync(root, { recursive: true, force: true });
}

// P5 — helper contract: the centralized tier ladder with and without probe evidence. Kind dominates; probes
// never promote a self-reported close; stable evidence WITHOUT a captured repro does not promote.
{
  const repro = { command: 'exit 1', exitCode: 1, outputSha256: SHA256_EMPTY, capturedAt: now };
  assert.equal(buildFailureCertificate({ kind: 'content', verifyMode: true, runnerRejected: true }).failureTier, 'runner_rejected', 'back-compat: no probe evidence keeps the v0 ceiling');
  assert.equal(buildFailureCertificate({ kind: 'content', verifyMode: true, runnerRejected: true, probes: { flaky: { verdict: 'stable' } }, minimalRepro: repro }).failureTier, 'verified_failure');
  assert.equal(buildFailureCertificate({ kind: 'content', verifyMode: true, runnerRejected: true, probes: { flaky: { verdict: 'flaky' } } }).failureTier, 'undetermined', 'a flaky verdict demotes the rejection');
  assert.equal(buildFailureCertificate({ kind: 'content', verifyMode: true, runnerRejected: true, probes: { flaky: { verdict: 'stable' } } }).failureTier, 'runner_rejected', 'no promotion without a captured repro');
  assert.equal(buildFailureCertificate({ kind: 'infra', probes: { flaky: { verdict: 'stable' } }, minimalRepro: repro }).failureTier, 'undetermined', 'kind dominates: probe evidence never converts infra');
  assert.equal(buildFailureCertificate({ kind: 'content', verifyMode: true, runnerRejected: false, probes: { flaky: { verdict: 'stable' } }, minimalRepro: repro }).failureTier, 'self_reported_failure', 'probes never promote a self-reported close');
  for (const args of [
    { kind: 'content', verifyMode: true, runnerRejected: true, probes: { flaky: { verdict: 'stable' } }, minimalRepro: repro },
    { kind: 'content', verifyMode: true, runnerRejected: true, probes: { flaky: { verdict: 'flaky' } } },
    { kind: 'infra', probes: { flaky: { verdict: 'stable' } }, minimalRepro: repro },
  ]) assert.equal(buildFailureCertificate(args).scope, 'resource_relative', 'every variant stays resource-relative');
}

console.log('failure-probes: OK (P1-P5; P6 = strengthened T3 lives in failure-certificate.mjs)');
