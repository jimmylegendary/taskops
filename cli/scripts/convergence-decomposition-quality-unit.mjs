#!/usr/bin/env node
// T10 — 분해 결과가 실제 실행·검증 가능한 자식을 만들었는지 판정하는 순수 정책 계약.
import assert from 'node:assert/strict';
import {
  CONVERGENCE_DEFAULTS,
  classifyChildExecutability,
  decompositionQualityVerdict,
  isExecutableTask,
  normalizeConvergenceConfig,
  openPlanDebtPressure,
} from '../lib-convergence.js';

function acceptanceSignalText(value, keys) {
  if (value && typeof value === 'object') {
    for (const key of keys) {
      const text = String(value[key] || '').trim();
      if (text) return text;
    }
  }
  return String(value || '').trim();
}

function hasVerifiableAcceptance(task) {
  const acceptance = task?.acceptance || {};
  return (acceptance.requiredChecks || [])
    .some((check) => acceptanceSignalText(check, ['command', 'cmd']))
    || (acceptance.requiredArtifacts || [])
      .some((artifact) => acceptanceSignalText(artifact, ['ref', 'path', 'name']));
}

function policyTask(id, runReadiness, acceptance = {}) {
  const task = {
    id,
    title: id,
    objective: id + ' objective',
    responsibility: id + ' responsibility',
    completionCriteria: id + ' completion criteria',
    status: runReadiness === 'blocked' ? 'blocked' : 'pending',
    runReadiness,
    acceptance: {
      mode: 'manual',
      expectedOutcome: id + ' expected outcome',
      requiredChecks: [],
      requiredArtifacts: [],
      ...acceptance,
    },
  };
  if (runReadiness === 'needs_decomposition') {
    task.expectedPlan = { expectedDepth: 1, expectedBreadth: 1, rationale: '분해가 더 필요하다.' };
  }
  return task;
}

// T10-a — blocked 자식 양산은 planning 자식과 마찬가지로 debt를 올려야 한다.
{
  const thresholds = { count: 5, ratio: 0.8 };
  const blocked = openPlanDebtPressure(
    Array.from({ length: 6 }, (_, index) => policyTask('blocked-' + (index + 1), 'blocked')),
    thresholds,
    { hasVerifiableAcceptance },
  );
  const planning = openPlanDebtPressure(
    Array.from({ length: 6 }, (_, index) => policyTask('planning-' + (index + 1), 'needs_decomposition')),
    thresholds,
    { hasVerifiableAcceptance },
  );

  assert.equal(blocked.planDebt, 6);
  assert.equal(blocked.blockedDebt, 6);
  assert.ok(blocked.debtRatio >= planning.debtRatio, 'blocked 양산이 planning 양산보다 debtRatio를 낮추면 안 된다.');
}

// T10-b — runnable만으로는 부족하며 실행 가능한 check/artifact가 있어야 executable이다.
{
  const pressure = openPlanDebtPressure([
    policyTask('runnable-empty-acceptance', 'runnable'),
    policyTask('runnable-with-check', 'runnable', { requiredChecks: ['node -e "process.exit(0)"'] }),
  ], { count: 5, ratio: 0.8 }, { hasVerifiableAcceptance });

  assert.equal(pressure.executable, 1);
  assert.equal(pressure.planDebt, 0);
}

// T10-c — 검증 가능성 술어 누락은 조용한 오판 대신 fail-loud여야 한다.
assert.throws(
  () => openPlanDebtPressure([], { count: 5, ratio: 0.8 }),
  /hasVerifiableAcceptance/,
);

// T10-d — 자식 분류기의 두 정책 의존성은 모두 필수다.
assert.throws(() => classifyChildExecutability({ tasks: [] }), /readinessOf/);
assert.throws(
  () => classifyChildExecutability({ tasks: [], readinessOf: () => 'runnable' }),
  /hasVerifiableAcceptance/,
);

// T10-e — 입력 순서와 모든 카운트, readiness 예외의 보수적 blocked 처리, unresolved 탐지를 검증한다.
{
  const tasks = [
    { id: 'exec' },
    { id: 'runnable-unverified' },
    { id: 'plan' },
    { id: 'blocked-conservative', blockedBy: 'plain-text-blocker' },
    { id: 'unresolved-plan', blockedBy: [{ type: 'resolved' }, { type: 'unresolved' }] },
  ];
  const readinessById = new Map([
    ['exec', 'runnable'],
    ['runnable-unverified', 'runnable'],
    ['plan', 'needs_decomposition'],
    ['unresolved-plan', 'needs_exploration'],
  ]);
  const verifiableIds = new Set(['exec', 'blocked-conservative']);
  const quality = classifyChildExecutability({
    tasks,
    readinessOf(task) {
      if (task.id === 'blocked-conservative') throw new Error('readiness unavailable');
      return readinessById.get(task.id);
    },
    hasVerifiableAcceptance: (task) => verifiableIds.has(task.id),
  });

  assert.equal(quality.childCount, 5);
  assert.equal(quality.executable, 1);
  assert.deepEqual(quality.executableIds, ['exec']);
  assert.equal(quality.runnableCount, 2);
  assert.equal(quality.verifiableCount, 2);
  assert.equal(quality.planningCount, 2);
  assert.equal(quality.blockedCount, 1);
  assert.equal(quality.unresolvedBlockerCount, 1);
  assert.deepEqual(quality.byTask, [
    { id: 'exec', readiness: 'runnable', verifiable: true, executable: true, unresolvedBlocker: false },
    { id: 'runnable-unverified', readiness: 'runnable', verifiable: false, executable: false, unresolvedBlocker: false },
    { id: 'plan', readiness: 'needs_decomposition', verifiable: false, executable: false, unresolvedBlocker: false },
    { id: 'blocked-conservative', readiness: 'blocked', verifiable: true, executable: false, unresolvedBlocker: false },
    { id: 'unresolved-plan', readiness: 'needs_exploration', verifiable: false, executable: false, unresolvedBlocker: true },
  ]);
}

// T10-f — 두 조건의 AND 진리표. readiness-only mutation은 이 표와 T10-b가 함께 잡는다.
assert.equal(isExecutableTask({ readiness: 'runnable', verifiable: true }), true);
assert.equal(isExecutableTask({ readiness: 'runnable', verifiable: false }), false);
assert.equal(isExecutableTask({ readiness: 'blocked', verifiable: true }), false);
assert.equal(isExecutableTask({ readiness: 'blocked', verifiable: false }), false);

// T10-g — 판정 규칙의 우선순위와 모든 출구를 고정한다.
{
  const below = { executable: 0, unresolvedBlockerCount: 0 };
  assert.deepEqual(
    decompositionQualityVerdict({ quality: below, level: 'hard', mode: 'observe', attempt: 1, maxRetries: 1, parentVerifiable: false }),
    { verdict: 'accept', reason: 'not_enforcing' },
  );
  assert.deepEqual(
    decompositionQualityVerdict({ quality: below, level: 'soft', mode: 'enforce', attempt: 1, maxRetries: 1, parentVerifiable: false }),
    { verdict: 'accept', reason: 'below_hard' },
  );
  assert.deepEqual(
    decompositionQualityVerdict({ quality: { executable: 1, unresolvedBlockerCount: 0 }, level: 'hard', mode: 'enforce', attempt: 1, maxRetries: 1, parentVerifiable: false }),
    { verdict: 'accept', reason: 'meets_hard_requirement' },
  );
  assert.deepEqual(
    decompositionQualityVerdict({ quality: below, level: 'hard', mode: 'enforce', attempt: 1, maxRetries: 1, parentVerifiable: false }),
    { verdict: 'redecompose', reason: 'below_hard_requirement_retry' },
  );
  assert.deepEqual(
    decompositionQualityVerdict({ quality: below, level: 'hard', mode: 'enforce', attempt: 2, maxRetries: 1, parentVerifiable: true }),
    { verdict: 'parent_fallback', reason: 'retry_exhausted_parent_verifiable' },
  );
  assert.deepEqual(
    decompositionQualityVerdict({ quality: below, level: 'hard', mode: 'enforce', attempt: 2, maxRetries: 1, parentVerifiable: false }),
    { verdict: 'honest_block', reason: 'retry_exhausted_parent_unverifiable' },
  );
  assert.deepEqual(
    decompositionQualityVerdict({ quality: { executable: 1, unresolvedBlockerCount: 2 }, level: 'hard', mode: 'enforce', attempt: 1, maxRetries: 1, parentVerifiable: true }),
    { verdict: 'redecompose', reason: 'below_hard_requirement_retry' },
  );
  assert.deepEqual(
    decompositionQualityVerdict({ quality: null, level: 'hard', mode: 'enforce', attempt: 1, maxRetries: 1, parentVerifiable: false }),
    { verdict: 'accept', reason: 'no_quality_signal' },
  );
}

// T10-h — decomposition.maxRetries는 옵션 > env > 기본값이며 비음수 정수만 허용한다.
{
  assert.equal(CONVERGENCE_DEFAULTS.decomposition.maxRetries, 1);
  assert.equal(normalizeConvergenceConfig({}, {}).decomposition.maxRetries, 1);
  assert.equal(normalizeConvergenceConfig({}, {
    TASKOPS_CONVERGENCE_DECOMPOSITION_MAX_RETRIES: '2',
  }).decomposition.maxRetries, 2);
  assert.equal(normalizeConvergenceConfig({
    convergence: { decomposition: { maxRetries: 3 } },
  }, {
    TASKOPS_CONVERGENCE_DECOMPOSITION_MAX_RETRIES: '2',
  }).decomposition.maxRetries, 3);
  assert.throws(
    () => normalizeConvergenceConfig({ convergence: { decomposition: { maxRetries: -1 } } }, {}),
    /convergence\.decomposition\.maxRetries/,
  );
  assert.throws(
    () => normalizeConvergenceConfig({ convergence: { decomposition: { maxRetries: 1.5 } } }, {}),
    /convergence\.decomposition\.maxRetries/,
  );
}

console.log('convergence decomposition quality unit passed');
