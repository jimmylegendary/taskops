#!/usr/bin/env node
// verify-resolver (the deep item): claimSafe must be groundable in evidence the RUNNER produced, not
// the agent's self-report. `taskops run --verify-checks` executes each requiredCheck itself and records
// the real result. This converts A2/A4's "honest floor" into actual independent verification.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile } from '../lib-taskops.js';
import { executeRequiredChecks, runTaskOps } from '../lib-runner.js';

const now = '2026-06-26T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-verify-'));

// ---- 1) primitive: real exit codes drive status, runner-authored ----
const prim = executeRequiredChecks({ cwd: root, requiredChecks: [{ command: 'true' }, { command: 'false' }, { command: '' }], timeoutMs: 30_000 });
assert.equal(prim.length, 2, 'empty command is skipped');
assert.equal(prim[0].status, 'passed'); assert.equal(prim[0].exitCode, 0); assert.equal(prim[0].verifiedBy, 'runner');
assert.equal(prim[1].status, 'failed'); assert.equal(prim[1].exitCode, 1); assert.equal(prim[1].verifiedBy, 'runner');

// ---- 2) integration via runTaskOps --verify-checks ----
function makeRunnableWork(name, acceptance) {
  const w = join(root, name);
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, `${tv}/eow`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: name, title: name, objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/task-01.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'task-01', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'T', objective: 'x', responsibility: 'own', completionCriteria: 'checks pass', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance });
  return w;
}
function runNodeCheckResults(w, res) {
  const node = parseMarkdownFile(join(w, 'runs', res.runId, 'nodes', `${res.tasks[0].runNodeId}.md`));
  return node.result?.observed?.checkResults || [];
}

// a check that REALLY passes → runner records passed → review approves.
// (use `exit 0`/`exit 1` rather than `true`/`false`, which YAML re-parses as booleans.)
const passWork = makeRunnableWork('verify-pass', { mode: 'guarded', expectedOutcome: 'the required checks pass', requiredChecks: [{ command: 'exit 0' }] });
const passRes = runTaskOps(passWork, { executor: 'dry-run', maxSteps: 1, verifyChecks: true });
assert.equal(passRes.tasks[0].reviewDecision, 'approved', 'a runner-verified passing check approves');
const passChecks = runNodeCheckResults(passWork, passRes);
assert.equal(passChecks[0]?.verifiedBy, 'runner', 'checkResults are runner-authored, not self-reported');
assert.equal(passChecks[0]?.status, 'passed');

// a check that REALLY fails → runner records failed → review is NOT approved, even though the dry-run
// executor "completed" the task. Self-narration cannot manufacture claimSafe.
const failWork = makeRunnableWork('verify-fail', { mode: 'guarded', expectedOutcome: 'the required checks pass', requiredChecks: [{ command: 'exit 1' }] });
const failRes = runTaskOps(failWork, { executor: 'dry-run', maxSteps: 1, verifyChecks: true });
assert.notEqual(failRes.tasks[0].reviewDecision, 'approved', 'a runner-verified FAILING check must not approve');
const failChecks = runNodeCheckResults(failWork, failRes);
assert.equal(failChecks[0]?.status, 'failed', 'runner records the real failing result');
assert.equal(failChecks[0]?.verifiedBy, 'runner');

// verify-resolver strengthening (artifact provenance): a requiredArtifact that is a PRE-EXISTING file this
// run did not produce must NOT certify under verify mode (index.md exists before the task runs). Closes the
// self-review "existsSync of a stale file" leak.
const stale = runTaskOps(makeRunnableWork('verify-artifact-stale', { mode: 'guarded', expectedOutcome: 'index exists', requiredArtifacts: [{ path: 'index.md' }] }), { executor: 'dry-run', maxSteps: 1, verifyChecks: true });
assert.notEqual(stale.tasks[0].reviewDecision, 'approved', 'verify-checks: a stale pre-existing artifact must not certify (provenance)');

// a requiredArtifact PRODUCED during this run (a runner-executed check creates it) IS provenance-verified → approves.
const produced = makeRunnableWork('verify-artifact-produced', { mode: 'guarded', expectedOutcome: 'produce out.txt', requiredChecks: [{ command: 'echo hi > out.txt' }], requiredArtifacts: [{ path: 'out.txt' }] });
const prodRes = runTaskOps(produced, { executor: 'dry-run', maxSteps: 1, verifyChecks: true });
assert.equal(prodRes.tasks[0].reviewDecision, 'approved', 'verify-checks: an artifact produced by this run (runner-verified provenance) certifies');
const prodChecks = runNodeCheckResults(produced, prodRes);
assert.ok(prodChecks[0]?.outputHash, 'check result carries a tamper-evident outputHash');
const prodReview = parseMarkdownFile(join(produced, 'runs', prodRes.runId, 'nodes', `review-${prodRes.tasks[0].runNodeId}.md`));
assert.equal(prodReview.reviewReport?.verified, true, 'a --verify-checks review is stamped verified:true so claimSafe provenance is auditable');

// self-review NEW_ISSUE: a vacuous requiredChecks:[{command:''}] must not certify. The empty-command check
// is skipped by both the runner and the review loop, so it counts as NO machine-checkable signal — under
// verify mode AND the plain A2/A4 floor. Otherwise claimSafe is minted with zero evidence.
const vacV = runTaskOps(makeRunnableWork('verify-vacuous', { mode: 'guarded', expectedOutcome: 'x', requiredChecks: [{ command: '' }] }), { executor: 'dry-run', maxSteps: 1, verifyChecks: true });
assert.notEqual(vacV.tasks[0].reviewDecision, 'approved', 'verify-checks: an empty-command requiredCheck must not certify');
const vacP = runTaskOps(makeRunnableWork('plain-vacuous', { mode: 'guarded', expectedOutcome: 'x', requiredChecks: [{ command: '' }] }), { executor: 'dry-run', maxSteps: 1 });
assert.notEqual(vacP.tasks[0].reviewDecision, 'approved', 'plain floor: an empty-command requiredCheck must not certify either');

rmSync(root, { recursive: true, force: true });
console.log('OK verify-resolver');
