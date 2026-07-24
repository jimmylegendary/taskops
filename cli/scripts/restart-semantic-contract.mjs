#!/usr/bin/env node
// P0#5: restart clone은 semantic contract를 전부 보존해야 한다. 이전엔 restart preserveKeys에 acceptance/
// followUpBudget/expectedResult가 없어(promotion clone은 acceptance/followUpBudget 보존 — 비대칭) restart된 accepted
// task가 무제약 task로 강등되어 acceptance를 우회했다. 게다가 expectedResult는 writeVersionFromSpec 영속 목록에도
// 없어 아예 round-trip이 안 됐다.
//
// Part 1 (핵심): init → decompose v2 → restart v3 후 v3 task frontmatter가 acceptance/followUpBudget/expectedResult를
//   전부 보존하는지(write→restart round-trip).
// Part 2 (R3B3 — 기계적 보존이 아니라 계약 enforcement 회복): 복원된 acceptance를 review 엔진에 태워, 만족하는 result에
//   대해 review decision==='approved' + mode==='runner-managed'(informational fallback 아님)임을 확인 — 즉 보존된 계약이
//   downstream에서 실제 policy 계약으로 존중됨.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { reviewTarget } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-restart-semantic-'));
const now = '2026-06-30T00:00:00.000Z';

function run(args) {
  const r = spawnSync('node', [cli, ...args], { encoding: 'utf8', env: process.env });
  if (r.status !== 0) throw new Error(`taskops ${args.join(' ')} failed\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
function taskPath(workDir, versionId, taskId) {
  return join(workDir, 'task-groups', 'tg-root', 'versions', versionId, 'tasks', `${taskId}.md`);
}

// 보존 대상 semantic contract.
const acceptance = {
  mode: 'runner-managed',
  expectedOutcome: 'A bounded pilot scope document that passes the required check.',
  requiredArtifacts: [{ path: 'pilot-scope.md' }],
  requiredChecks: [{ id: 'chk-ok', command: 'echo ok' }],
};
const followUpBudget = { enabled: true, maxFollowUps: 2 };
const expectedResult = 'A bounded pilot scope document with provenance and an evaluation rule.';

// ===== Part 1: write → restart round-trip =====
const workDir = join(tempRoot, 'work');
run(['init', workDir, '--id', 'restart-semantic', '--title', 'Restart semantic contract', '--objective', 'Preserve acceptance/expectedResult across restart.', '--language', 'en']);
const specPath = join(tempRoot, 'spec.json');
writeFileSync(specPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Accepted task root',
  selected: true,
  tasks: [{
    id: 'task-accepted',
    title: 'Accepted deliverable task',
    objective: 'Deliver an accepted, verified deliverable.',
    responsibility: 'Own the accepted deliverable end-to-end.',
    completionCriteria: 'Required check passes and required artifact exists.',
    order: 1,
    status: 'pending',
    runReadiness: 'runnable',
    uncertaintyState: 'known',
    understandingLevel: 'known',
    acceptance,
    followUpBudget,
    expectedResult,
  }],
}), 'utf8');
run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');

// sanity: writer가 v2에 계약을 persist했는지.
const v2 = parseMarkdownFile(taskPath(workDir, 'tgv-root-v2', 'task-accepted'));
assert.deepEqual(v2.acceptance, acceptance, 'writer persists acceptance to v2');
assert.equal(v2.expectedResult, expectedResult, 'writer persists expectedResult to v2 (P0#5 R2B3)');

run(['restart', workDir, '--from', 'task-accepted', '--instruction', 'Restart while preserving the acceptance contract.', '--reason', 'restart_semantic_contract']);
const v3 = parseMarkdownFile(taskPath(workDir, 'tgv-root-v3', 'task-accepted'));
assert.deepEqual(v3.acceptance, acceptance, 'P0#5: restart preserves the full acceptance contract (mode/requiredArtifacts/requiredChecks)');
assert.deepEqual(v3.followUpBudget, followUpBudget, 'P0#5: restart preserves followUpBudget');
assert.equal(v3.expectedResult, expectedResult, 'P0#5: restart preserves expectedResult (write→restart round-trip)');
assert.deepEqual(parseProject(workDir).errors, [], 'restarted graph is canonically valid');

// ===== Part 2 (R3B3): 복원된 acceptance가 review 엔진에서 runner-managed 계약으로 approved됨 =====
// restart로 복원된 acceptance 객체를 그대로 review 엔진에 태운다 — 만족하는 result면 approved + mode runner-managed
// (계약이 dropped되었다면 mode는 'informational'로 떨어졌을 것 = enforcement 회복의 판별자).
const restoredAcceptance = v3.acceptance;
const reviewWork = join(tempRoot, 'review-work');
function md(p, fm) { mkdirSync(join(reviewWork, p, '..'), { recursive: true }); writeFileSync(join(reviewWork, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8'); }
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'review-work', title: 'R', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/versions/tgv-root-v1/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
md('task-groups/tg-root/versions/tgv-root-v1/tasks/task-accepted.md', {
  taskOpsVersion: 'v1', entityType: 'task', id: 'task-accepted', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: 'Accepted', objective: 'x', responsibility: 'own', completionCriteria: 'c', acceptance: restoredAcceptance,
  order: 1, createdAt: now, status: 'done', runReadiness: 'runnable', understandingLevel: 'known',
  runRefs: [{ runId: 'run-main', runNodeId: 'run-node-accepted', role: 'primary_execution' }],
});
md('task-groups/tg-root/versions/tgv-root-v1/eow/eow-task-accepted.md', { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-task-accepted', graphType: 'task', attachedToType: 'task', attachedToId: 'task-accepted', taskGroupVersionId: 'tgv-root-v1', reason: 'execution_path_closed', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'done' });
md('runs/run-main/index.md', { taskOpsVersion: 'v1', entityType: 'run', id: 'run-main', workId: 'review-work', createdAt: now, status: 'active' });
md('runs/run-main/nodes/run-node-accepted.md', {
  taskOpsVersion: 'v1', entityType: 'runNode', id: 'run-node-accepted', runId: 'run-main', type: 'implementation',
  title: 'Accepted', sourceTaskId: 'task-accepted', sourceTaskGroupVersionId: 'tgv-root-v1', status: 'done', createdAt: now,
  result: {
    executorSummary: 'Produced pilot-scope.md and passed the required check.',
    observed: {
      outcomeSummary: 'Produced pilot-scope.md and passed the required check.',
      artifactRefs: ['pilot-scope.md'],
      checkResults: [{ command: 'echo ok', status: 'passed' }],
      evidenceRefs: ['run:run-main/node:run-node-accepted'],
    },
  },
});
md('runs/run-main/nodes/eow-run-node-accepted.md', { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-run-node-accepted', runId: 'run-main', graphType: 'run', attachedToType: 'runNode', attachedToId: 'run-node-accepted', reason: 'execution_path_closed', closureRole: 'claim-bearing', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'done' });
md('runs/run-main/edges/edge-accepted-to-eow.md', { taskOpsVersion: 'v1', entityType: 'runEdge', id: 'edge-accepted-to-eow', runId: 'run-main', fromRunNodeId: 'run-node-accepted', toRunNodeId: 'eow-run-node-accepted', edgeType: 'closes_with', createdAt: now, status: 'done' });

assert.deepEqual(parseProject(reviewWork).errors, [], 'review fixture is canonically valid');
const review = reviewTarget(reviewWork, 'task-accepted');
assert.equal(review.reviewReport.mode, 'runner-managed', 'R3B3: the RESTORED acceptance drives a runner-managed policy review (NOT an informational fallback)');
assert.equal(review.reviewReport.decision, 'approved', 'R3B3: a result satisfying the restored contract is APPROVED (contract is enforceable, not dropped)');

rmSync(tempRoot, { recursive: true, force: true });
console.log('restart-semantic-contract: OK (P0#5 — restart preserves + downstream enforces the semantic contract)');
