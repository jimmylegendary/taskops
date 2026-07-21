#!/usr/bin/env node
// 불변식: 경로-작용 증분 합산(∫ rate dt = Σ 궤적상 event 증분) ⟂ claimSafe(정직성 축).
// progress 축(발산 A_div / 수렴-transport / 수렴-elim, κ_reabsorb)은 "현재 열린 unknown 개수" 같은
// 종단 상태를 읽지 않고, append-only 발생(surpriseHistory 항목·분해·EoW 닫힘·종단 실패)의 증분을 시간순
// 궤적 위에서 더한다. 정보량은 subadditive(K(x,y) ≤ K(x)+K(y))이므로 상태합산은 공유정보를 이중계상한다 —
// TC4가 "같은 종단상태·다른 궤적 → 다른 A_div"로 그 판별을 강제한다. progress는 claimSafe와 절대 합쳐지지
// 않는다(TC6 회귀 가드). 모든 수치는 Tier-1 rate proxy: 자유상수(T, κ scale, ground metric) 미고정 → 서수적/상대적.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseProject } from '../lib-taskops.js';
import { auditParsedWork, renderAuditText } from '../lib-audit.js';
import { progressLedger, renderProgressLedgerText } from '../lib-progress-ledger.js';

const now = '2026-07-21T00:00:00.000Z';
const ledger = (w) => progressLedger(parseProject(w));

// ---- fixture primitives (audit-gates.mjs / oracle-access.mjs skeleton) --------------------------------------
function md(w, rel, fm) {
  mkdirSync(join(w, rel, '..'), { recursive: true });
  writeFileSync(join(w, rel), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
}
function writeWork(w, selectedVersions) {
  md(w, 'index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'pw', title: 'Progress work', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md(w, 'snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions });
}
function group(w, tgId, activeVersionId) {
  md(w, `task-groups/${tgId}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroup', id: tgId, objective: 'x', activeVersionId, createdAt: now, status: 'active' });
}
function version(w, tgId, tgvId, extra = {}) {
  md(w, `task-groups/${tgId}/versions/${tgvId}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: tgvId, taskGroupId: tgId, version: 'v1', summary: 's', createdAt: now, status: 'active', ...extra });
}
function task(w, tgId, tgvId, id, extra = {}) {
  md(w, `task-groups/${tgId}/versions/${tgvId}/tasks/${id}.md`, { taskOpsVersion: 'v1', entityType: 'task', id, taskGroupId: tgId, taskGroupVersionId: tgvId, title: id, objective: 'x', responsibility: 'own', completionCriteria: 'check', order: 1, createdAt: now, status: 'active', understandingLevel: 'known', ...extra });
}
function eow(w, tgId, tgvId, taskId, extra = {}) {
  md(w, `task-groups/${tgId}/versions/${tgvId}/eow/eow-${taskId}.md`, { taskOpsVersion: 'v1', entityType: 'eow', id: `eow-${taskId}`, graphType: 'task', attachedToType: 'task', attachedToId: taskId, taskGroupVersionId: tgvId, reason: 'execution_path_closed', declaredBy: 'test', declaredAt: now, createdAt: now, status: 'done', ...extra });
}
function runNode(w, id, extra = {}) {
  md(w, 'runs/run-main/index.md', { taskOpsVersion: 'v1', entityType: 'run', id: 'run-main', workId: 'pw', createdAt: now, status: 'active' });
  md(w, `runs/run-main/nodes/${id}.md`, { taskOpsVersion: 'v1', entityType: 'runNode', id, runId: 'run-main', type: 'implementation', title: id, status: 'done', createdAt: now, ...extra });
}
const ROOT_SEL = [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }];
// A minimal single-version root work: caller supplies tasks/eows/runNodes after.
function baseRoot(w, selectedVersions = ROOT_SEL) {
  writeWork(w, selectedVersions);
  group(w, 'tg-root', 'tgv-root-v1');
  version(w, 'tg-root', 'tgv-root-v1', { selected: true });
}
const cert = (failureTier) => ({ schemaVersion: 'failure-certificate-v0', kind: 'content', failureTier, scope: 'resource_relative' });
const tmp = (tag) => mkdtempSync(join(tmpdir(), `taskops-progress-${tag}-`));

const cleanups = [];
try {
  // ── T1: A_div uses penalty-weighted id-array INCREMENT counts (reconstruction), not saturating surpriseScore.
  // 이론(§5.1) 독립 산출: penalty = 3·|contradictedKnownIds| + 1·|blockingNewUnknownIds| + 0.5·|nonBlockingNewUnknownIds|
  // = 3·1 + 1·2 + 0.5·1 = 5.5. surpriseScore를 primary로 쓰면 min(1, 5.5/3)=1 로 포화 → aDiv≈1 (판별용 오답).
  {
    const root = tmp('t1'); cleanups.push(root); const w = join(root, 'work');
    baseRoot(w);
    task(w, 'tg-root', 'tgv-root-v1', 't', {
      surpriseHistory: [{ id: 's1', actionKind: 'execute', observedAt: now, contradictedKnownIds: ['k1'], blockingNewUnknownIds: ['u1', 'u2'], nonBlockingNewUnknownIds: ['u3'] }],
    });
    const l = ledger(w);
    assert.equal(l.aDiv, 5.5, 'T1: penalty 3·1+1·2+0.5·1 = 5.5 (NOT surpriseScore-saturated ≈1)');
    assert.equal(l.aConvTransport, 0);
    assert.equal(l.aConvElim, 0);
    assert.equal(l.aConv, 0);
    assert.equal(l.kappaReabsorb, 0);
    assert.equal(l.transportReabsorb, 0);
    assert.equal(l.residual, 5.5);
    assert.equal(l.tier, 'tier-1-rate-proxy');
    assert.equal(l.channels.div.surprise, 5.5);
    assert.equal(l.channels.div.decomposition, 0);
    // 렌더 라인이 audit에 직교 sibling으로 실려 나온다 + 기존 assurance 라인 shape 생존(회귀 가드).
    const text = renderAuditText(auditParsedWork(parseProject(w)));
    assert.ok(text.includes('progress tier=tier-1-rate-proxy'), 'T1: progress line appended to audit render');
    assert.ok(text.includes('A_div=5.5'));
    assert.ok(text.includes('(ordinal rate proxy; not a reward)'));
    assert.ok(text.includes('assurance floor='), 'T1: pre-existing assurance line survives');
  }

  // ── T2: verified(3) > self_verified(2) transport weighting (honesty-axis link); κ AND transportReabsorb unbounded.
  // 독립 산출: aDiv = penalty({blockingNewUnknownIds:['u1']}) = 1. transport = DONE_TIER_RANK.verified(3)+self_verified(2) = 5.
  // κ = (5+0)/1 = 5.0 (>1, 클램프 없음). residual = 1-5 = -4 (음수 허용).
  {
    const root = tmp('t2'); cleanups.push(root); const w = join(root, 'work');
    baseRoot(w);
    task(w, 'tg-root', 'tgv-root-v1', 'A', { status: 'done', order: 1, surpriseHistory: [{ id: 'sa', observedAt: now, blockingNewUnknownIds: ['u1'] }] });
    eow(w, 'tg-root', 'tgv-root-v1', 'A', { assuranceTier: 'verified' });
    task(w, 'tg-root', 'tgv-root-v1', 'B', { status: 'done', order: 2 });
    eow(w, 'tg-root', 'tgv-root-v1', 'B', { assuranceTier: 'self_verified' });
    const l = ledger(w);
    assert.equal(l.aDiv, 1);
    assert.equal(l.aConvTransport, 5, 'T2: verified 3 + self_verified 2 = 5');
    assert.equal(l.aConvElim, 0);
    assert.equal(l.kappaReabsorb, 5, 'T2: κ=5.0 proves NO [0,1] clamp');
    assert.equal(l.transportReabsorb, 5, 'T2: transportReabsorb=5.0 explicitly unbounded');
    assert.equal(l.residual, -4, 'T2: residual may be negative');
    assert.equal(l.channels.transport.count, 2);
  }

  // ── T3: blocked mass → A_conv_elim, never transport (§4.1 solved-vs-abandoned); scope-deferral NOT counted (dead path removed).
  // 독립 산출: 분해 parent(live 선택 child 3개) → aDiv = log2(1+3) = 2. blocked+verified_failure → elim 3. transport 0.
  // κ = (0+3)/2 = 1.5. transportReabsorb = 0/2 = 0 (순수 prune 궤적은 solve 궤적과 구별됨). residual = 2-3 = -1.
  {
    const root = tmp('t3'); cleanups.push(root); const w = join(root, 'work');
    baseRoot(w, [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }, { taskGroupId: 'tg-child', versionId: 'tgv-child-v1' }]);
    task(w, 'tg-root', 'tgv-root-v1', 'p', { status: 'done', order: 1, childTaskGroupId: 'tg-child', childTaskGroupVersionId: 'tgv-child-v1' });
    task(w, 'tg-root', 'tgv-root-v1', 'f', { status: 'blocked', order: 2, failureCertificate: cert('verified_failure') });
    group(w, 'tg-child', 'tgv-child-v1');
    version(w, 'tg-child', 'tgv-child-v1');
    task(w, 'tg-child', 'tgv-child-v1', 'c1', { order: 1 });
    task(w, 'tg-child', 'tgv-child-v1', 'c2', { order: 2 });
    task(w, 'tg-child', 'tgv-child-v1', 'c3', { order: 3 });
    const l = ledger(w);
    assert.equal(l.aDiv, 2, 'T3: log2(1+3)=2');
    assert.equal(l.aConvTransport, 0);
    assert.equal(l.aConvElim, 3, 'T3: verified_failure only = 3 (NO synthetic +1 scope-deferred)');
    assert.equal(l.kappaReabsorb, 1.5);
    assert.equal(l.transportReabsorb, 0, 'T3: prune-only run distinguishable from a solving run');
    assert.equal(l.residual, -1);
    assert.equal(l.channels.elim.taskFailure, 3);
  }

  // ── T4: MANDATED discriminator — identical FINAL STATE, different TRAJECTORY → different A_div. path-action, not state-read.
  // Work A: 두 surprise step(각 blocking 3개) → aDiv = 3+3 = 6. Work B: 한 step(1개) → aDiv = 1. 두 work 다 done+verified,
  // 동일 최종 task.unknowns=['ur'] (읽히지 않는다). 상태합산(|unknowns|=1)이면 두 aDiv가 같아져 FAIL. 이론 penalty로 6 vs 1.
  {
    const rootA = tmp('t4a'); cleanups.push(rootA); const wA = join(rootA, 'work');
    baseRoot(wA);
    task(wA, 'tg-root', 'tgv-root-v1', 't', { status: 'done', unknowns: ['ur'], surpriseHistory: [
      { id: 's1', observedAt: '2026-07-21T00:00:00.000Z', blockingNewUnknownIds: ['a', 'b', 'c'] },
      { id: 's2', observedAt: '2026-07-21T01:00:00.000Z', blockingNewUnknownIds: ['d', 'e', 'f'] },
    ] });
    eow(wA, 'tg-root', 'tgv-root-v1', 't', { assuranceTier: 'verified' });
    const rootB = tmp('t4b'); cleanups.push(rootB); const wB = join(rootB, 'work');
    baseRoot(wB);
    task(wB, 'tg-root', 'tgv-root-v1', 't', { status: 'done', unknowns: ['ur'], surpriseHistory: [
      { id: 's1', observedAt: now, blockingNewUnknownIds: ['x'] },
    ] });
    eow(wB, 'tg-root', 'tgv-root-v1', 't', { assuranceTier: 'verified' });
    const a = ledger(wA); const b = ledger(wB);
    assert.equal(a.aDiv, 6, 'T4: A opened 3+3 along trajectory');
    assert.equal(b.aDiv, 1, 'T4: B opened 1');
    assert.notEqual(a.aDiv, b.aDiv, 'T4: identical final state, different trajectory → different A_div (path-action, not state-sum)');
    assert.equal(a.aConvTransport, 3);
    assert.equal(b.aConvTransport, 3);
    assert.equal(a.kappaReabsorb, 0.5, 'T4: A κ = 3/6');
    assert.equal(b.kappaReabsorb, 3, 'T4: B κ = 3/1');
    assert.equal(a.residual, 3);
    assert.equal(b.residual, -2);
  }

  // ── T5: A_div===0 → κ null (no Infinity/NaN/crash); an unrecognized runNode type is neutral and never throws.
  // 독립 산출: done+verified → transport 3, surprise/분해 없음 → aDiv 0. κ = null. residual = 0-3 = -3. 렌더 'kappa=na'.
  {
    const root = tmp('t5'); cleanups.push(root); const w = join(root, 'work');
    baseRoot(w);
    task(w, 'tg-root', 'tgv-root-v1', 't', { status: 'done' });
    eow(w, 'tg-root', 'tgv-root-v1', 't', { assuranceTier: 'verified' });
    runNode(w, 'rn-exp', { type: 'experiment', title: 'open taxonomy node' }); // no enum on runNode.type
    let l;
    assert.doesNotThrow(() => { l = ledger(w); }, 'T5: unknown runNode type must not throw (open taxonomy)');
    assert.equal(l.aDiv, 0);
    assert.equal(l.aConvTransport, 3);
    assert.equal(l.aConvElim, 0);
    assert.equal(l.kappaReabsorb, null, 'T5: aDiv===0 → null, not Infinity/NaN');
    assert.equal(l.transportReabsorb, null);
    assert.equal(l.residual, -3);
    assert.ok(renderProgressLedgerText(l).includes('kappa=na'), 'T5: render shows kappa=na');
    assert.ok(renderAuditText(auditParsedWork(parseProject(w))).includes('kappa=na'));
  }

  // ── T6: orthogonality — adding divergence moves progress.residual but leaves claimSafe / issues byte-identical.
  // 독립 산출: base(surprise 없음) → aDiv 0. +{blockingNewUnknownIds:4개} → penalty 4 → aDiv 4, residual 4.
  {
    const root0 = tmp('t6a'); cleanups.push(root0); const w0 = join(root0, 'work');
    baseRoot(w0);
    task(w0, 'tg-root', 'tgv-root-v1', 't1', { order: 1 });
    task(w0, 'tg-root', 'tgv-root-v1', 't2', { order: 2 });
    const root1 = tmp('t6b'); cleanups.push(root1); const w1 = join(root1, 'work');
    baseRoot(w1);
    task(w1, 'tg-root', 'tgv-root-v1', 't1', { order: 1, surpriseHistory: [{ id: 's1', observedAt: now, blockingNewUnknownIds: ['u1', 'u2', 'u3', 'u4'] }] });
    task(w1, 'tg-root', 'tgv-root-v1', 't2', { order: 2 });
    const audit0 = auditParsedWork(parseProject(w0));
    const audit1 = auditParsedWork(parseProject(w1));
    assert.equal(audit1.claimSafe, audit0.claimSafe, 'T6: claimSafe unchanged by added divergence');
    assert.equal(audit1.issues.length, audit0.issues.length, 'T6: issue count unchanged');
    assert.ok(!audit1.issues.some((i) => String(i.code).startsWith('progress')), 'T6: progress emits no issue');
    assert.equal(audit0.progress.aDiv, 0);
    assert.equal(audit1.progress.aDiv, 4);
    assert.equal(audit1.progress.residual, 4);
    assert.ok('progress' in audit0 && 'progress' in audit1, 'T6: progress present as sibling key on both');
  }

  // ── T7: uncertified & undetermined failures contribute 0 to A_conv_elim / κ numerator (no infra-flake credit); diagnostics only.
  // 독립 산출: active+surprise(blocking 1) → aDiv 1. verified_failure → elim 3. uncertified → 0. undetermined → 0.
  // κ = (0+3)/1 = 3.0. channels.elim = {count:1, magnitude:3, taskFailure:3, uncertifiedCount:1, undeterminedCount:1}.
  {
    const root = tmp('t7'); cleanups.push(root); const w = join(root, 'work');
    baseRoot(w);
    task(w, 'tg-root', 'tgv-root-v1', 'S', { status: 'active', order: 1, surpriseHistory: [{ id: 's1', observedAt: now, blockingNewUnknownIds: ['u1'] }] });
    task(w, 'tg-root', 'tgv-root-v1', 'F1', { status: 'blocked', order: 2, failureCertificate: cert('verified_failure') });
    task(w, 'tg-root', 'tgv-root-v1', 'F2', { status: 'blocked', order: 3 }); // uncertified — NO failureCertificate
    task(w, 'tg-root', 'tgv-root-v1', 'F3', { status: 'blocked', order: 4, failureCertificate: cert('undetermined') });
    const l = ledger(w);
    assert.equal(l.aDiv, 1);
    assert.equal(l.aConvTransport, 0);
    assert.equal(l.aConvElim, 3, 'T7: verified_failure ONLY; uncertified+undetermined add 0');
    assert.equal(l.kappaReabsorb, 3);
    assert.equal(l.transportReabsorb, 0);
    assert.equal(l.residual, -2);
    assert.deepEqual(l.channels.elim, { count: 1, magnitude: 3, taskFailure: 3, uncertifiedCount: 1, undeterminedCount: 1 });
  }

  // ── T8: childCount is VERSION-SCOPED — counts only the parent's live/selected child version, not superseded versions.
  // 독립 산출: live child 2개만 선택됨 → childCount 2 → aDiv = log2(1+2) = log2(3) = 1.585. version-blind(2+5=7)이면 log2(8)=3.0 → FAIL.
  {
    const root = tmp('t8'); cleanups.push(root); const w = join(root, 'work');
    baseRoot(w, [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }, { taskGroupId: 'tg-child', versionId: 'tgv-child-live' }]);
    task(w, 'tg-root', 'tgv-root-v1', 'p', { status: 'done', order: 1, childTaskGroupId: 'tg-child', childTaskGroupVersionId: 'tgv-child-live' });
    group(w, 'tg-child', 'tgv-child-live');
    version(w, 'tg-child', 'tgv-child-live');
    version(w, 'tg-child', 'tgv-child-super'); // superseded, NOT selected
    task(w, 'tg-child', 'tgv-child-live', 'live1', { order: 1 });
    task(w, 'tg-child', 'tgv-child-live', 'live2', { order: 2 });
    for (let i = 1; i <= 5; i += 1) task(w, 'tg-child', 'tgv-child-super', `sup${i}`, { order: i });
    const l = ledger(w);
    assert.equal(l.aDiv, 1.585, 'T8: log2(1+2)=1.585 (version-scoped; NOT log2(1+7)=3.0)');
    assert.equal(l.aConvTransport, 0);
    assert.equal(l.aConvElim, 0);
    assert.equal(l.channels.div.decomposition, 1.585);
  }

  console.log('progress-ledger: OK (T1-T8)');
} finally {
  for (const root of cleanups) rmSync(root, { recursive: true, force: true });
}
