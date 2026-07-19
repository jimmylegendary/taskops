#!/usr/bin/env node
// Oracle access 3-tier (P0-3; spec docs/specs/oracle-access.md): every terminal close carries a TYPE of
// external-oracle (official judge) consumption so bench results can be stratified by oracle-access level —
// 'none' (no oracle-flagged acceptance check), 'judge_once' (oracle verdict consumed, zero verify-retries),
// 'interactive' (the verdict was fed back at least once). MEASUREMENT ONLY: no gate, no issue, claimSafe math
// untouched. The stamp must land on BOTH stamp sites (fresh-EoW via applyApprovedReviewToEow AND reviewTarget
// via attachApprovedReviewToExistingEows) and symmetrically on the FAIL side (failureCertificate.oracleAccess);
// a close that never reached the judge verdict (infra/protocol, legacy) tallies as 'unknown', never fabricated.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { runTaskOps, reviewTarget, buildFailureCertificate } from '../lib-runner.js';
import { auditParsedWork, renderAuditText } from '../lib-audit.js';

const now = '2026-07-19T00:00:00.000Z';
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
// build() adapted from failure-certificate.mjs with ONE change: checks are RAW objects (not command strings),
// so a check can carry the acceptance-level `oracle: true` flag the pipeline must preserve end-to-end.
function build(root, checks, acceptanceExtra = {}) {
  const w = join(root, 'work');
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'oa', title: 'O', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/t.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 't', objective: 'x', responsibility: 'own', completionCriteria: 'check', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'check', requiredChecks: checks, ...acceptanceExtra } });
  return w;
}
const taskPath = (w) => join(w, `${tv}/tasks/t.md`);
const readTask = (w) => parseMarkdownFile(taskPath(w));
const rewriteTask = (w, mutate) => {
  const fm = parseMarkdownFile(taskPath(w));
  delete fm.path; delete fm.body;
  mutate(fm);
  writeFileSync(taskPath(w), `${fmBlock(fm)}# t\n`, 'utf8');
};
const eowPath = (w) => join(w, `${tv}/eow/eow-t.md`);
const readEow = (w) => parseMarkdownFile(eowPath(w));
const rewriteEow = (w, mutate) => {
  const fm = parseMarkdownFile(eowPath(w));
  delete fm.path; delete fm.body;
  mutate(fm);
  writeFileSync(eowPath(w), `${fmBlock(fm)}# EoW: t\n`, 'utf8');
};
const audit = (w) => auditParsedWork(parseProject(w));
const once = (m) => `test -f ${m} || { touch ${m}; exit 1; }`; // fails once, passes thereafter
const readReviewNode = (w) => {
  for (const runId of readdirSync(join(w, 'runs'))) {
    for (const f of readdirSync(join(w, 'runs', runId, 'nodes'))) {
      if (f.startsWith('review-') && f.endsWith('.md')) return parseMarkdownFile(join(w, 'runs', runId, 'nodes', f));
    }
  }
  throw new Error('no review node found');
};

// TC1 — judge_once: an oracle-flagged check passing on the first try (verifyRetries:0) consumed the oracle
// verdict exactly once; the derivation lands on the reviewReport, the fresh task EoW, and the audit tally.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-oa-tc1-'));
  const w = build(root, [{ command: 'true', oracle: true }]);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  assert.equal(readTask(w).status, 'done');
  assert.equal(readReviewNode(w).reviewReport.oracleAccess, 'judge_once', 'review derives judge_once with zero verify attempts');
  assert.equal(readEow(w).oracleAccess, 'judge_once', 'fresh task-EoW path stamps the value');
  const a = audit(w);
  assert.deepEqual(a.assurance.oracleAccess, { none: 0, judge_once: 1, interactive: 0, unknown: 0 });
  assert.equal(a.assurance.floor, 'verified', 'regression: assurance tier unaffected by the measurement');
  rmSync(root, { recursive: true, force: true });
}

// TC2 — interactive: an oracle check that fails once then passes means the judge's verdict was fed back
// (attempts>=1 at approval time) — the close is oracle-INTERACTIVE, not a single-shot judged one.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-oa-tc2-'));
  const w = build(root, [{ command: once(join(root, 'm')), oracle: true }]);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true, verifyRetries: 2, continueOnFailure: true });
  assert.equal(readTask(w).status, 'done');
  assert.equal(readEow(w).oracleAccess, 'interactive', 'attempts>=1 at approval time derives interactive');
  assert.equal(audit(w).assurance.oracleAccess.interactive, 1);
  rmSync(root, { recursive: true, force: true });
}

// TC3 — none: no oracle flag anywhere; the close is measured as oracle-free and adds NO gate (claimSafe intact).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-oa-tc3-'));
  const w = build(root, [{ command: 'true' }]);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  assert.equal(readTask(w).status, 'done');
  assert.equal(readEow(w).oracleAccess, 'none');
  const a = audit(w);
  assert.deepEqual(a.assurance.oracleAccess, { none: 1, judge_once: 0, interactive: 0, unknown: 0 });
  assert.equal(a.claimSafe, true, 'regression: measurement adds no gate');
  rmSync(root, { recursive: true, force: true });
}

// TC4 — FAIL-side symmetry: an always-failing oracle check saturates (verifyRetries:1) into a blocked content
// close whose certificate carries the same review-derived oracleAccess ('interactive': the verdict fed back once).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-oa-tc4-'));
  const w = build(root, [{ command: 'exit 1', oracle: true }]);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 8, verifyChecks: true, verifyRetries: 1, continueOnFailure: true });
  const t = readTask(w);
  assert.equal(t.status, 'blocked');
  assert.equal(t.failureCertificate.kind, 'content');
  assert.equal(t.failureCertificate.oracleAccess, 'interactive', 'the terminal review saw attempts=1');
  const a = audit(w);
  assert.equal(a.assurance.oracleAccess.interactive, 1);
  assert.equal(a.assurance.failureLedger.content, 1, 'regression: existing failure ledger unchanged');
  rmSync(root, { recursive: true, force: true });
}

// TC5 — unknown, never fabricated: (i) an infra close never reached the judge verdict, so its certificate OMITS
// the field; (ii) a legacy done close whose EoW carries no stamp. Both tally 'unknown' (honest-close ethos).
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-oa-tc5-'));
  const w = build(root, [{ command: 'true', oracle: true }]);
  rewriteTask(w, (fm) => { fm.status = 'blocked'; fm.failureCertificate = buildFailureCertificate({ kind: 'infra', reasons: ['spawn failed'] }); });
  assert.ok(!('oracleAccess' in readTask(w).failureCertificate), 'an infra certificate never carries a judge-verdict claim');
  assert.deepEqual(audit(w).assurance.oracleAccess, { none: 0, judge_once: 0, interactive: 0, unknown: 1 });
  rmSync(root, { recursive: true, force: true });
}
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-oa-tc5b-'));
  const w = build(root, [{ command: 'true' }]);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  assert.equal(readTask(w).status, 'done');
  rewriteEow(w, (fm) => { delete fm.oracleAccess; }); // simulate a legacy (pre-P0-3) close
  assert.deepEqual(audit(w).assurance.oracleAccess, { none: 0, judge_once: 0, interactive: 0, unknown: 1 });
  rmSync(root, { recursive: true, force: true });
}

// TC6 — render surface: the human-readable audit line exposes the tally without disturbing the existing shape.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-oa-tc6-'));
  const w = build(root, [{ command: 'true', oracle: true }]);
  runTaskOps(w, { executor: 'dry-run', maxSteps: 4, verifyChecks: true, verifyRetries: 0, continueOnFailure: true });
  const text = renderAuditText(audit(w));
  assert.ok(text.includes('oracleAccess'));
  assert.ok(text.includes('judge_once=1'));
  assert.ok(text.includes('assurance floor='), 'line-shape regression guard: the pre-existing segment survives');
  rmSync(root, { recursive: true, force: true });
}

// TC7 — the SECOND stamp site (T1 both-sites lesson): reviewTarget on an already-closed task must stamp the
// PRE-EXISTING task EoW via attachApprovedReviewToExistingEows, not only the fresh-EoW path.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-oa-tc7-'));
  const w = join(root, 'work');
  for (const d of [`${tv}/tasks`, `${tv}/eow`, 'snapshots', 'runs/run-main/nodes', 'runs/run-main/edges']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'oa7', title: 'O', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/task-review.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'task-review', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'Review target', objective: 'x', responsibility: 'own', completionCriteria: 'check', order: 1, createdAt: now, status: 'done', runReadiness: 'runnable', understandingLevel: 'known', runRefs: [{ runId: 'run-main', runNodeId: 'run-node-review', role: 'primary_execution' }], acceptance: { mode: 'guarded', expectedOutcome: 'check', requiredChecks: [{ command: 'node -e 0', oracle: true }] } });
  md(`${tv}/eow/eow-task-review.md`, { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-task-review', graphType: 'task', attachedToType: 'task', attachedToId: 'task-review', taskGroupVersionId: 'tgv-root-v1', reason: 'manual_close', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'done' });
  md('runs/run-main/index.md', { taskOpsVersion: 'v1', entityType: 'run', id: 'run-main', workId: 'oa7', createdAt: now, status: 'active' });
  md('runs/run-main/nodes/run-node-review.md', { taskOpsVersion: 'v1', entityType: 'runNode', id: 'run-node-review', runId: 'run-main', type: 'implementation', title: 'Review target', sourceTaskId: 'task-review', sourceTaskGroupVersionId: 'tgv-root-v1', status: 'done', createdAt: now, result: { executorSummary: 'ran check', observed: { outcomeSummary: 'check passed', checkResults: [{ command: 'node -e 0', status: 'passed' }], evidenceRefs: ['run:run-main/node:run-node-review'] } } });
  md('runs/run-main/nodes/eow-run-node-review.md', { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-run-node-review', runId: 'run-main', graphType: 'run', attachedToType: 'runNode', attachedToId: 'run-node-review', reason: 'manual_close', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'done' });
  md('runs/run-main/edges/edge-run-node-review-to-eow.md', { taskOpsVersion: 'v1', entityType: 'runEdge', id: 'edge-run-node-review-to-eow', runId: 'run-main', fromRunNodeId: 'run-node-review', toRunNodeId: 'eow-run-node-review', edgeType: 'closes_with', createdAt: now, status: 'done' });
  const r = reviewTarget(w, 'task-review');
  assert.equal(r.reviewReport.decision, 'approved');
  assert.equal(r.reviewReport.oracleAccess, 'judge_once', 'no verifyAttempts on the task derives judge_once');
  const eow = parseMarkdownFile(join(w, `${tv}/eow/eow-task-review.md`));
  assert.equal(eow.oracleAccess, 'judge_once', 'attachApprovedReviewToExistingEows stamps the pre-existing EoW');
  rmSync(root, { recursive: true, force: true });
}

// TC8 — helper contract: the certificate emits oracleAccess only when GIVEN one; absent input never fabricates
// a value at infra/protocol close sites (they never reached the judge verdict — honest-close ethos).
{
  assert.equal(buildFailureCertificate({ kind: 'content', oracleAccess: 'interactive' }).oracleAccess, 'interactive');
  assert.ok(!('oracleAccess' in buildFailureCertificate({ kind: 'infra' })));
  assert.ok(!('oracleAccess' in buildFailureCertificate({ kind: 'content' })), 'absent input never fabricates a value');
}

console.log('oracle-access: OK (TC1-TC8)');
