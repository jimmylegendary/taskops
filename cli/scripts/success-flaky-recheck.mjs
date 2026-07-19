#!/usr/bin/env node
// Success-side flaky re-check (F-2's dual; spec docs/specs/failure-certificate.md §F-2 symmetric): stage-3smoke
// measured a C-arm false_completion where a flaky oracle (requests' network test) PASSED at verify and FAILED at
// the final grade — verify-grounding certified verified_done on an unstable pass. This locks the fix: at an
// approved verify close, the runner re-executes the PASSING requiredChecks; any rerun that fails means the pass
// did not reproduce, so verified_done is REFUSED and the close is UNDETERMINED (kind:'oracle_flaky'), never a
// completion. A stable pass is unaffected.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps, probePassedChecks } from '../lib-runner.js';

const now = '2026-07-20T00:00:00.000Z';
function build(root, checks, acceptanceExtra = {}) {
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'sf', title: 'S', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/t.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 't', objective: 'x', responsibility: 'own', completionCriteria: 'check', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'check', requiredChecks: checks.map((command) => ({ command })), ...acceptanceExtra } });
  return w;
}
const readTask = (w) => parseMarkdownFile(join(w, 'task-groups/tg-root/versions/tgv-root-v1/tasks/t.md'));
// A flaky PASS: passes the FIRST time (file absent → create it, exit 0), fails every rerun (file present → exit 1).
// The verify exec sees the pass and approves; the success-side re-check sees the failing reruns → flaky.
const flakyPass = 'test -f M && exit 1 || { touch M; exit 0; }';

// T1 — a flaky verify-pass is REFUSED verified_done and closes UNDETERMINED, not a completion.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-sf-t1-'));
  const w = build(root, [flakyPass]);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'blocked', 'a flaky verify-pass is refused verified_done (blocked, never done)');
  assert.ok(t.failureCertificate, 'a failure certificate is stamped on the flaky-pass close');
  assert.equal(t.failureCertificate.kind, 'oracle_flaky');
  assert.equal(t.failureCertificate.failureTier, 'undetermined', 'a flaky pass is undetermined (out of the F1 denominator), never a completion');
  assert.equal(t.failureCertificate.probes.passFlaky.verdict, 'flaky', 'the re-check verdict is recorded');
  assert.ok(Array.isArray(t.quarantinedChecks) && t.quarantinedChecks.includes(flakyPass), 'the unstable command is quarantined on the task');
  rmSync(root, { recursive: true, force: true });
}

// T2 — control: a STABLE verify-pass still closes verified-done, certificate-free (no false demotion, no cost leak).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-sf-t2-'));
  const w = build(root, ['true']);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'done', 'a stable verify-pass still closes verified-done');
  assert.equal(t.failureCertificate, undefined, 'no failure certificate on a stable pass');
  assert.equal(t.quarantinedChecks, undefined, 'nothing quarantined on a stable pass');
  rmSync(root, { recursive: true, force: true });
}

// T3 — the re-check does NOT run without verify mode: a self-reported pass was never runner-executed, so there is
// no runner-passing command to re-check. (A no-verify close may still block on the unobserved required check — that
// is the pre-existing needs_verification path — but it must never mint an oracle_flaky certificate from a probe
// that did not run.)
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-sf-t3-'));
  const w = build(root, ['true']);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: false, continueOnFailure: true });
  const t = readTask(w);
  assert.notEqual(t.failureCertificate?.kind, 'oracle_flaky', 'without verify mode the success-side re-check never runs (no oracle_flaky demotion)');
  rmSync(root, { recursive: true, force: true });
}

// T4 — helper contract: probePassedChecks flags flaky when a rerun fails, stable when all pass.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-sf-t4-'));
  mkdirSync(root, { recursive: true });
  const flaky = probePassedChecks({ cwd: root, commands: ['test -f Q && exit 1 || { touch Q; exit 0; }'], timeoutMs: 30000 });
  assert.equal(flaky.verdict, 'flaky', 'a command that fails on rerun is flaky');
  assert.equal(flaky.quarantinedChecks.length, 1);
  const stable = probePassedChecks({ cwd: root, commands: ['true'], timeoutMs: 30000 });
  assert.equal(stable.verdict, 'stable', 'a command that always passes is stable');
  assert.equal(stable.quarantinedChecks.length, 0);
  rmSync(root, { recursive: true, force: true });
}

console.log('success-flaky-recheck: OK (T1-T4)');
