#!/usr/bin/env node
// P0#6: next/explain(navigation)의 완료 의미가 audit(claimSafe)와 정렬되어야 한다. 이전엔 closure.complete
// (=structuralComplete)만으로 next=done/all_closed, explain.complete=true를 보고했는데, audit claimSafe는
// policyApprovedComplete===true를 요구한다 → structurally_complete_unapproved / manual_attested_complete work를
// audit은 claimSafe=false로 거부하는데 navigation은 done으로 보고하는 정면 불일치.
//
// navigation ↔ audit은 'policy-approval axis'(closure.policyApprovedComplete)에서 수렴한다(완전 claimSafe 등가가 아님):
//   (1) execution_path_closed(비-policy-approved) → structurally_complete_unapproved → next=graph_closed_unapproved,
//        explain.complete=false, claimSafe=false.
//   (2) manual_verified only → manual_attested_complete → next=graph_closed_unapproved, claimSafe=false (R2B2: manual
//        attestation도 done 아님 — isApprovedComplete는 policyApprovedComplete만 인정).
//   (3) policy-approved review EoW(approved_result + 해시들 + mode) → policy_approved_complete → next=done/all_closed,
//        explain.complete=true, claimSafe=true.
//   (4) RESIDUAL(문서화): (3) + 미해결 partial → nav=done인데 audit=claimSafe:false. claimSafe는 policy-approval axis에
//        더해 unresolvedPartialCount/repeatedReviewTaskCount/counts.error(audit 엔진 내부 신호)를 '추가로' 게이트하므로,
//        parity는 axis-scoped다. 이 case는 그 residual을 REGRESSION GUARD로 고정한다(lib-runner.js:67 주석 참조).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseProject } from '../lib-taskops.js';
import { computeNextAction, explainWork } from '../lib-runner.js';
import { auditParsedWork } from '../lib-audit.js';

const now = '2026-07-06T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-nav-parity-'));

function buildWork(id, eowExtra) {
  const w = join(root, id);
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  const md = (p, fm) => { mkdirSync(join(w, p, '..'), { recursive: true }); writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8'); };
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id, title: 'A', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/task-01.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'task-01', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'T', objective: 'x', responsibility: 'own', completionCriteria: 'done', order: 1, createdAt: now, status: 'done', runReadiness: 'runnable', understandingLevel: 'known' });
  md(`${tv}/eow/eow-task-01.md`, { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-task-01', graphType: 'task', attachedToType: 'task', attachedToId: 'task-01', taskGroupVersionId: 'tgv-root-v1', declaredBy: 'system', declaredAt: now, createdAt: now, status: 'done', ...eowExtra });
  return w;
}

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  OK ${label}`); } catch (e) { failures += 1; console.error(`  FAIL ${label}: ${e.message}`); }
}

// (1) execution_path_closed → structurally_complete_unapproved
check('(1) execution_path_closed → graph_closed_unapproved, claimSafe=false', () => {
  const w = buildWork('case-exec-closed', { reason: 'execution_path_closed' });
  const parsed = parseProject(w);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.closure.closureState, 'structurally_complete_unapproved');
  const next = computeNextAction(w);
  assert.equal(next.action, 'graph_closed_unapproved', 'next.action must be graph_closed_unapproved (NOT done)');
  assert.equal(next.stopReason, 'graph_closed_unapproved', 'next.stopReason must be graph_closed_unapproved (NOT all_closed)');
  assert.equal(explainWork(w).complete, false, 'explain.complete must be false for an unapproved structural closure');
  assert.equal(auditParsedWork(parsed).claimSafe, false, 'audit claimSafe must be false — navigation and audit converge');
});

// (2) manual_verified only → manual_attested_complete (R2B2)
check('(2) manual_verified → graph_closed_unapproved, claimSafe=false (manual attestation is not done)', () => {
  const w = buildWork('case-manual', { reason: 'manual_verified' });
  const parsed = parseProject(w);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.closure.closureState, 'manual_attested_complete');
  const next = computeNextAction(w);
  assert.equal(next.action, 'graph_closed_unapproved', 'manual attestation must route to graph_closed_unapproved, NOT done');
  assert.equal(explainWork(w).complete, false);
  assert.equal(auditParsedWork(parsed).claimSafe, false, 'manual_attested_complete must not be claimSafe (parity with audit)');
});

// (3) policy-approved review EoW → policy_approved_complete
check('(3) approved_result → done/all_closed, claimSafe=true', () => {
  const w = buildWork('case-approved', {
    reason: 'approved_result',
    approvedByReviewNodeId: 'run-node-review-01',
    approvedReviewMode: 'runner-managed',
    approvedReviewReportHash: 'h-report',
    reviewedAcceptanceHash: 'h-acc',
    reviewedResultHash: 'h-res',
  });
  const parsed = parseProject(w);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.closure.closureState, 'policy_approved_complete');
  const next = computeNextAction(w);
  assert.equal(next.action, 'done', 'policy-approved closure surfaces done');
  assert.equal(next.stopReason, 'all_closed', 'policy-approved closure stops all_closed');
  assert.equal(explainWork(w).complete, true, 'explain.complete is true only for policy-approved completion');
  assert.equal(auditParsedWork(parsed).claimSafe, true, 'policy-approved closure is claimSafe (navigation and audit converge on done)');
});

// (4) RESIDUAL(문서화): policy-approved인데 '미해결 partial'을 든 그래프 → nav done-surface와 audit claimSafe가 갈린다.
// P0#6가 좁힌 gap은 structuralComplete→done(넓은 과다주장)에서 policyApprovedComplete→done(policy-approval axis)로다.
// 그 axis에서 nav과 audit은 수렴하지만(케이스 1-3), audit claimSafe는 unresolvedPartialCount===0을 '추가로' 요구한다
// (lib-audit.js:429-433) — 이 partial axis는 audit 엔진 내부 신호라 navigation이 의존하지 않는다(closure엔 없다).
// 따라서 아래는 nav=done인데 audit=claimSafe:false. 이 케이스는 그 residual을 '보이게' 고정해, (1)-(3) parity가
// 'claimSafe 완전 등가'로 오독되지 않게 하는 REGRESSION GUARD다. residual을 닫는 것(=nav도 graph_closed_unapproved로
// 라우팅)은 7개 P0 밖의 의도적 후속 선택 — 그 선택을 하면 아래 nav/explain 단언을 뒤집어야 한다(lib-runner.js:67 주석).
check('(4) RESIDUAL: policy-approved + unresolved partial → nav=done diverges from audit claimSafe=false (parity is axis-scoped, not full claimSafe equality)', () => {
  const w = buildWork('case-approved-partial', {
    reason: 'approved_result',
    approvedByReviewNodeId: 'run-node-review-01',
    approvedReviewMode: 'runner-managed',
    approvedReviewReportHash: 'h-report',
    reviewedAcceptanceHash: 'h-acc',
    reviewedResultHash: 'h-res',
  });
  // 미해결 partial(supersededBy: null) — isPartialUnresolved가 'null'/빈값/null을 미해결로 본다(lib-taskops.js:259).
  const pdir = join(w, 'task-groups/tg-root/versions/tgv-root-v1/partials');
  mkdirSync(pdir, { recursive: true });
  writeFileSync(join(pdir, 'partial-01.md'), `---
taskOpsVersion: v1
entityType: partial
id: partial-01
graphType: task
attachedToType: task
attachedToId: task-01
taskGroupVersionId: tgv-root-v1
reason: partial_complete
declaredBy: system
declaredAt: ${now}
createdAt: ${now}
status: active
completedSummary: Did part.
incompleteSummary: The rest remains unfinished.
followUpNeeded: true
supersededBy: null
budget:
  enabled: false
---
# Partial partial-01
`, 'utf8');
  const parsed = parseProject(w);
  assert.deepEqual(parsed.errors, [], 'fixture must parse cleanly — the divergence is about claimSafe, NOT a parse error');
  assert.equal(parsed.closure.closureState, 'policy_approved_complete', 'policy-approval axis stays satisfied with an unresolved partial present (partial does not touch structural/policy closure)');
  const audit = auditParsedWork(parsed);
  assert.equal(audit.claimSafe, false, 'audit refuses: claimSafe additionally gates on unresolvedPartialCount===0 — the residual axis navigation does not read');
  assert.ok(audit.metrics.unresolvedPartialCount >= 1, 'the divergence is driven by the unresolved partial, not a parse/policy error');
  const next = computeNextAction(w);
  assert.equal(next.action, 'done', 'DOCUMENTED RESIDUAL: navigation converges ONLY on the policy-approval axis, so it still surfaces done');
  assert.equal(next.stopReason, 'all_closed', 'navigation stops all_closed on the policy-approval axis (residual: audit would refuse)');
  assert.equal(explainWork(w).complete, true, 'explain.complete mirrors the policy-approval axis (done), NOT audit claimSafe');
});

rmSync(root, { recursive: true, force: true });
if (failures > 0) process.exit(1);
console.log('navigation-approval-parity: OK (P0#6 — next/explain done-surface converges with audit on the policy-approval axis; cases 1-3 = converge, case 4 = documented axis-scoped residual, NOT full claimSafe equality)');
