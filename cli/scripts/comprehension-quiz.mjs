#!/usr/bin/env node
// Regression (Comprehension Quiz gate): claim-safety of a task with acceptance.comprehensionQuiz requires an
// independently-generated, runner-executed set of behavioral PROBES to PASS. A failing probe rejects; an EMPTY
// quiz is INCONCLUSIVE (needs_verification), never a free pass; a passing quiz stamps comprehensionVerified.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile } from '../lib-taskops.js';
import { reviewTarget, runComprehensionQuizProbes, runTaskOps } from '../lib-runner.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-quiz-'));
const now = '2026-06-24T00:00:00.000Z';
const md = (p, fm) => writeFileSync(p, `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');

function review(name, { acceptance, result }) {
  const w = join(tempRoot, name);
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, `${tv}/eow`, 'snapshots', 'runs/run-main/nodes', 'runs/run-main/edges']) mkdirSync(join(w, d), { recursive: true });
  md(join(w, 'index.md'), { taskOpsVersion: 'v1', entityType: 'work', id: name, title: name, objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md(join(w, 'task-groups/tg-root/index.md'), { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(join(w, `${tv}/index.md`), { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md(join(w, 'snapshots/snapshot-root-v1.md'), { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(join(w, `${tv}/tasks/task-review.md`), { taskOpsVersion: 'v1', entityType: 'task', id: 'task-review', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'T', objective: 'x', responsibility: 'own', completionCriteria: 'done', acceptance, order: 1, createdAt: now, status: 'done', runReadiness: 'runnable', understandingLevel: 'known', runRefs: [{ runId: 'run-main', runNodeId: 'run-node-review', role: 'primary_execution' }] });
  md(join(w, `${tv}/eow/eow-task-review.md`), { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-task-review', graphType: 'task', attachedToType: 'task', attachedToId: 'task-review', taskGroupVersionId: 'tgv-root-v1', reason: 'manual_close', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'done' });
  md(join(w, 'runs/run-main/index.md'), { taskOpsVersion: 'v1', entityType: 'run', id: 'run-main', workId: name, createdAt: now, status: 'active' });
  md(join(w, 'runs/run-main/nodes/run-node-review.md'), { taskOpsVersion: 'v1', entityType: 'runNode', id: 'run-node-review', runId: 'run-main', type: 'implementation', title: 'T', sourceTaskId: 'task-review', sourceTaskGroupVersionId: 'tgv-root-v1', status: 'done', createdAt: now, result });
  md(join(w, 'runs/run-main/nodes/eow-run-node-review.md'), { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-run-node-review', runId: 'run-main', graphType: 'run', attachedToType: 'runNode', attachedToId: 'run-node-review', reason: 'manual_close', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'done' });
  md(join(w, 'runs/run-main/edges/edge-review.md'), { taskOpsVersion: 'v1', entityType: 'runEdge', id: 'edge-review', runId: 'run-main', fromRunNodeId: 'run-node-review', toRunNodeId: 'eow-run-node-review', edgeType: 'closes_with', createdAt: now });
  return reviewTarget(w, 'task-review').reviewReport;
}

const acc = { mode: 'guarded', expectedOutcome: 'ok', requiredChecks: [{ command: 'c' }], comprehensionQuiz: true };
const passingCheck = [{ command: 'c', status: 'passed' }];

// 1) quiz probes PASS -> approved + comprehensionVerified.
const ok = review('quiz-pass', { acceptance: acc, result: { observed: { outcomeSummary: 'done', artifactRefs: [], evidenceRefs: [], checkResults: passingCheck, quizResults: [{ command: 'probe: existing callers unaffected', status: 'passed', verifiedBy: 'runner' }] } } });
assert.equal(ok.decision, 'approved', 'a passing comprehension quiz (with passing checks) approves');
assert.equal(ok.comprehensionVerified, true, 'approval under a passing quiz is stamped comprehensionVerified');

// 2) a quiz probe FAILS -> NOT approved (understanding gap caught) even though the requiredCheck passed.
const failed = review('quiz-fail', { acceptance: acc, result: { observed: { outcomeSummary: 'done', artifactRefs: [], evidenceRefs: [], checkResults: passingCheck, quizResults: [{ command: 'probe: edge case n=0', status: 'failed', verifiedBy: 'runner' }] } } });
assert.notEqual(failed.decision, 'approved', 'a failing comprehension quiz probe must block certification');

// 3) EMPTY quiz -> inconclusive (needs_verification), NOT a free pass.
const empty = review('quiz-empty', { acceptance: acc, result: { observed: { outcomeSummary: 'done', artifactRefs: [], evidenceRefs: [], checkResults: passingCheck, quizResults: [] } } });
assert.notEqual(empty.decision, 'approved', 'an empty comprehension quiz must not certify (inconclusive)');
assert.ok(empty.missingExpected.some((m) => m.includes('comprehension quiz produced no probes')), 'empty quiz is flagged inconclusive');

// 4) runComprehensionQuizProbes: reads the independent quiz's json + RUNNER-executes each probe.
{
  const dir = mkdtempSync(join(tmpdir(), 'taskops-quizprobe-'));
  writeFileSync(join(dir, 'comprehension-quiz.json'), JSON.stringify({ probes: [{ command: 'exit 0', rationale: 'ok' }, { command: 'exit 1', rationale: 'edge' }, { command: '', rationale: 'empty' }] }), 'utf8');
  const q = runComprehensionQuizProbes({ quizJsonPath: join(dir, 'comprehension-quiz.json'), cwd: dir, timeoutMs: 30_000 });
  assert.equal(q.length, 2, 'empty-command probes are dropped');
  assert.equal(q[0].status, 'passed'); assert.equal(q[0].verifiedBy, 'runner'); assert.equal(q[0].quizGeneratedBy, 'independent-reviewer');
  assert.equal(q[1].status, 'failed');
  // no json / no probes -> [] (inconclusive)
  assert.equal(runComprehensionQuizProbes({ quizJsonPath: join(dir, 'missing.json'), cwd: dir }).length, 0, 'no quiz json -> [] (inconclusive)');
  rmSync(dir, { recursive: true, force: true });
}

// 5) integration: a comprehensionQuiz task under dry-run (which cannot generate a quiz) must NOT be approved —
// the quiz is empty (inconclusive), even though the requiredCheck passes. No free pass without a real quiz.
{
  const root = mkdtempSync(join(tmpdir(), 'taskops-quiz-int-'));
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const m = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  m('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'qi', title: 'Q', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  m('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  m(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  m('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  m(`${tv}/tasks/t.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 't', objective: 'x', responsibility: 'own', completionCriteria: 'c', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', acceptance: { mode: 'guarded', expectedOutcome: 'c', requiredChecks: [{ command: 'exit 0' }], comprehensionQuiz: true } });
  runTaskOps(w, { executor: 'dry-run', maxSteps: 3, verifyChecks: true, continueOnFailure: true });
  assert.notEqual(parseMarkdownFile(join(w, `${tv}/tasks/t.md`)).status, 'done', 'comprehensionQuiz task must not be done without a real (non-empty) quiz');
  rmSync(root, { recursive: true, force: true });
}

rmSync(tempRoot, { recursive: true, force: true });
console.log('OK comprehension-quiz (gate + probes + integration)');
