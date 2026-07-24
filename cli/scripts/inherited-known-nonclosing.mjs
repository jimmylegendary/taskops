#!/usr/bin/env node
// P0#7: inherited-known 재검증(uncertaintyReadinessConsistencyIssues의 inherited_only_known_not_runnable)이 source
// task를 닫으며 acceptance를 우회하던 문제. P0#1이 exploration의 closing을 제거해 non-closing은 확보됐지만, ATOMIC
// ACCEPTED task(expectedPlan.expectedDepth===0 + policy-approving acceptance)를 blanket needs_exploration으로 강등해
// acceptance-verified execute 대신 exploration/decomposition으로 라우팅하는 건 여전히 부적절(RESIDUAL).
//
// 수정: atomic accepted task는 inherited-known 재검증을 acceptance-verified execute로 라우팅한다(acceptance review가
// 결과를 검증 = local validation). non-atomic(depth>=1)이거나 policy-approving acceptance가 없으면 기존대로
// needs_exploration으로 강등해 inherited-known을 먼저 재검증한다.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseProject, classifyTaskReadiness } from '../lib-taskops.js';
import { computeNextAction } from '../lib-runner.js';
import { auditParsedWork } from '../lib-audit.js';

const now = '2026-07-07T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-inherited-known-'));

// inherited-known-only + otherwise-runnable task frontmatter. depth/acceptance만 바꿔 atomic vs non-atomic을 만든다.
function taskFm({ id, expectedDepth, withAcceptance }) {
  const fm = {
    taskOpsVersion: 'v1', entityType: 'task', id, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
    title: 'Inherited-known task', objective: 'Deliver the pilot scope document.',
    responsibility: 'Own the atomic deliverable end-to-end.',
    completionCriteria: 'pilot-scope.md exists and passes the required check.',
    order: 1, createdAt: now, status: 'pending',
    runReadiness: 'runnable', understandingLevel: 'known', uncertaintyState: 'known', confidenceScore: 0.9,
    // local known은 UNVERIFIED이고 surpriseHistory도 없음 → !hasLocalKnownEvidence (inherited-known은 재검증 대상).
    knownList: [{ id: 'k-local', claim: 'A local unverified assumption.', verificationStatus: 'unverified' }],
    inheritedFrom: { schemaVersion: 'v1', inheritedKnownRefs: [{ id: 'ik-1', sourceTaskId: 'task-parent', sourceTaskGroupVersionId: 'tgv-parent-v1', sourceKnownId: 'k-parent', trust: 'inherited_unverified' }] },
    expectedPlan: { expectedDepth, expectedBreadth: 1, rationale: 'fixture' },
  };
  if (withAcceptance) {
    fm.acceptance = { mode: 'runner-managed', expectedOutcome: 'pilot-scope.md produced and verified', requiredArtifacts: [{ path: 'pilot-scope.md' }], requiredChecks: [{ id: 'chk', command: 'test -f pilot-scope.md' }] };
  }
  return fm;
}

// ---- 단위: classifyTaskReadiness 라우팅 ----
// atomic accepted (depth 0 + acceptance): inherited-known만으로 exploration 강등하지 않고 runnable(→acceptance execute).
assert.equal(
  classifyTaskReadiness(taskFm({ id: 'task-atomic', expectedDepth: 0, withAcceptance: true })).runReadiness,
  'runnable',
  'P0#7: atomic accepted task (depth 0 + policy-approving acceptance) routes inherited-known revalidation to acceptance-verified execute, NOT exploration',
);
// non-atomic (depth 2 + acceptance): inherited-known 재검증을 먼저 → needs_exploration 유지(대조).
assert.equal(
  classifyTaskReadiness(taskFm({ id: 'task-nonatomic', expectedDepth: 2, withAcceptance: true })).runReadiness,
  'needs_exploration',
  'P0#7 contrast: a non-atomic (depth>=1) inherited-known task still downgrades to needs_exploration (revalidate inherited known first)',
);
// atomic WITHOUT acceptance: acceptance gate가 없으므로 여전히 needs_exploration(inherited-known 먼저 재검증).
assert.equal(
  classifyTaskReadiness(taskFm({ id: 'task-atomic-noacc', expectedDepth: 0, withAcceptance: false })).runReadiness,
  'needs_exploration',
  'P0#7 contrast: an atomic task WITHOUT a policy-approving acceptance still downgrades to needs_exploration (no acceptance gate to serve as local validation)',
);

// ---- 통합: navigation + non-closing ----
function buildWork(id, fm) {
  const w = join(root, id);
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  const md = (p, o) => { mkdirSync(join(w, p, '..'), { recursive: true }); writeFileSync(join(w, p), `${fmBlock(o)}# ${o.id}\n`, 'utf8'); };
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id, title: 'A', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/${fm.id}.md`, fm);
  return w;
}

// atomic accepted: next=execute (NOT explore), 그리고 pilot-scope.md 부재 시 claimSafe=false(=아직 done 아님).
const atomicWork = buildWork('atomic-work', taskFm({ id: 'task-atomic', expectedDepth: 0, withAcceptance: true }));
const atomicParsed = parseProject(atomicWork);
assert.deepEqual(atomicParsed.errors, [], 'atomic work is canonically valid');
const atomicNext = computeNextAction(atomicWork);
assert.equal(atomicNext.action, 'execute', 'P0#7: atomic accepted inherited-known task routes to execute (acceptance-verified), NOT explore');
// non-closing: 아직 실행 안 했으므로 source task는 pending, task-EoW 없음.
const atomicTask = [...atomicParsed.tasks.values()].find((t) => t.id === 'task-atomic');
assert.notEqual(atomicTask.status, 'done', 'inherited-known revalidation is a non-closing routing decision (task stays open)');
assert.equal(existsSync(join(atomicWork, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'eow', 'eow-task-atomic-tgv-root-v1.md')), false, 'no task-EoW is written by a routing decision');
assert.equal(auditParsedWork(atomicParsed).claimSafe, false, 'with pilot-scope.md absent the acceptance is unmet → claimSafe=false (not falsely done)');

// non-atomic contrast: next=explore (inherited-known을 먼저 재검증).
const nonAtomicWork = buildWork('nonatomic-work', taskFm({ id: 'task-nonatomic', expectedDepth: 2, withAcceptance: true }));
assert.deepEqual(parseProject(nonAtomicWork).errors, []);
assert.equal(computeNextAction(nonAtomicWork).action, 'explore', 'P0#7 contrast: a non-atomic inherited-known task still routes to explore');

rmSync(root, { recursive: true, force: true });
console.log('inherited-known-nonclosing: OK (P0#7 — atomic accepted inherited-known routes to acceptance-verified execute, not exploration)');
