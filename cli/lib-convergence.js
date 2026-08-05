// 수렴 압력(convergence pressure) — 순수 정책 모듈. I/O 없음, 파일 쓰기 없음.
//
// 배경: taskops 에는 발산 압력만 있고 수렴 압력이 없었다.
//   unknown_unknown → explore(발산) → known_unknown → decompose(발산) → 자식이 또 unknown → explore(발산) → 사이클
// execute 로 가는 유일한 문은 uncertaintyState:'known' + runnable contract 인데, 그 문으로 미는 힘이 없다.
// ALE 실측(ranking_node_feature_parity_recovery, 31분): decomposition 5 · exploration 5 · **execute 0**.
//
// 처방: 3축(예산/깊이/발산잔여) × 2단계(soft/hard) 를 OR 로 결합해, 예산이 줄수록 계획의 정당화 문턱을
// 점진적으로 올린다. 하드 컷오프만 쓰면 "탐색이 정말 필요한 순간"을 잘라버리므로 soft 단계를 둔다.
//   soft = 발산이 실제로 새 possibility mass 를 여는가(novelty 입증)를 요구
//   hard = 계획 차단, 실행만 (그래도 acceptance 는 그대로 강제 — 억지 done 금지)
//
// 순환 import 방지: 이 모듈은 lib-runner.js 를 import 하지 않는다.
import { classifyTaskReadiness } from './lib-taskops.js';

export const CONVERGENCE_MODES = Object.freeze(['off', 'observe', 'enforce']);

// 임계 기본값의 근거:
//  budget.soft 0.50 — 기존 EXPECTED_PLAN_PHASE_THRESHOLDS.soft(lib-runner.js)와 동일 값·동일 의미(절반 소진 =
//    converging)라 어휘를 재사용한다. 새 상수를 도입하지 않는다.
//  budget.hard 0.75 — FINISHING_MODE_RESERVE(lib-runner.js)가 20%를 마감분으로 예약하므로, execute 1회 +
//    verify 재시도가 들어갈 여유를 남기려면 20% + 마진 ≈ 25%가 필요하다. 기존 phase hard 0.85 를 쓰지 않는
//    이유: 0.85 는 프롬프트 조언만 바꾸는 값이라 실행 여유를 고려하지 않았다.
//  debt.count 5 — 통상 분해 breadth(3~5)의 상한. "한 번의 분해분을 통째로 미집행"인 상태를 뜻한다.
//  debt.ratio 0.8 — 열린 항목 5개 중 1개도 증거를 만들 수 없는 상태.
//    ALE 실측(자식 17개 전부 planning, executable 0 → planDebt=17, ratio=1.0)에서 확실히 발화한다.
//  debt.sustain 3 — hard 승격까지 요구하는 **연속** 임계 초과 스텝 수.
//    1스텝 = 부채 관측, 2스텝 = 부채 수치를 프롬프트로 되먹인 뒤 고칠 기회, 그래도 3스텝째 임계를 넘으면 hard.
//    sustain >= 1 강제 = 첫 평가는 절대 hard 가 아니다(soft 전 자유도 보존: 초기 넓은 분해를 막지 않는다).
export const CONVERGENCE_DEFAULTS = Object.freeze({
  mode: 'enforce',
  budget: Object.freeze({ soft: 0.50, hard: 0.75 }),
  depth: Object.freeze({ enabled: true }),
  debt: Object.freeze({ count: 5, ratio: 0.8, sustain: 3 }),
  decomposition: Object.freeze({ maxRetries: 1 }),
});

export const CONVERGENCE_EXTENSION_DEFAULTS = Object.freeze({ maxGrants: 1, fraction: 0.5 });

const PLANNING_READINESS = new Set(['needs_decomposition', 'needs_exploration', 'needs_prototype']);
export const PLANNING_ACTION_KINDS = new Set(['decompose', 'explore', 'prototype']);
const POLICY_APPROVING_MODES = new Set(['enforced', 'guarded', 'runner-managed']);

export function isExecutableTask({ readiness, verifiable } = {}) {
  return readiness === 'runnable' && verifiable === true;
}

export function classifyChildExecutability({ tasks = [], readinessOf, hasVerifiableAcceptance } = {}) {
  if (typeof readinessOf !== 'function') {
    throw new Error('classifyChildExecutability requires readinessOf');
  }
  if (typeof hasVerifiableAcceptance !== 'function') {
    throw new Error('classifyChildExecutability requires hasVerifiableAcceptance');
  }

  // 금지 — 자식 readiness 를 runnable 로 clamp 하지 마라. 실제로 못 하는데 할 수 있다고 우기는 것이 거짓완료다.
  // 미달의 출구는 재분해 1회 → 부모 통째 실행(검증가능 acceptance 보유 시) → 정직한 blocked 뿐이다.
  const byTask = tasks.map((task) => {
    let readiness;
    try {
      readiness = readinessOf(task);
    } catch {
      readiness = 'blocked';
    }
    const verifiable = hasVerifiableAcceptance(task) === true;
    const executable = isExecutableTask({ readiness, verifiable });
    // blockedBy 는 배열이 아닌 단일 객체로도 올 수 있다(분해 LLM 산출물 정규화 이전 형태).
    // 배열만 보면 좀비 자식 1건짜리 케이스를 통째로 놓친다.
    const blockers = Array.isArray(task?.blockedBy)
      ? task.blockedBy
      : (task?.blockedBy ? [task.blockedBy] : []);
    const unresolvedBlocker = blockers
      .some((blocker) => blocker && typeof blocker === 'object' && blocker.type === 'unresolved');
    return { id: task?.id, readiness, verifiable, executable, unresolvedBlocker };
  });

  return {
    childCount: tasks.length,
    executable: byTask.filter((task) => task.executable).length,
    executableIds: byTask.filter((task) => task.executable).map((task) => task.id),
    runnableCount: byTask.filter((task) => task.readiness === 'runnable').length,
    verifiableCount: byTask.filter((task) => task.verifiable).length,
    planningCount: byTask.filter((task) => PLANNING_READINESS.has(task.readiness)).length,
    blockedCount: byTask.filter((task) => task.readiness === 'blocked').length,
    unresolvedBlockerCount: byTask.filter((task) => task.unresolvedBlocker).length,
    byTask,
  };
}

export function decompositionQualityVerdict({
  quality,
  level,
  mode,
  attempt,
  maxRetries,
  parentVerifiable,
} = {}) {
  if (mode !== 'enforce') return { verdict: 'accept', reason: 'not_enforcing' };
  if (level !== 'hard') return { verdict: 'accept', reason: 'below_hard' };
  if (!quality) return { verdict: 'accept', reason: 'no_quality_signal' };
  if (quality.executable >= 1 && quality.unresolvedBlockerCount === 0) {
    return { verdict: 'accept', reason: 'meets_hard_requirement' };
  }
  if (attempt < maxRetries + 1) {
    return { verdict: 'redecompose', reason: 'below_hard_requirement_retry' };
  }
  if (parentVerifiable === true) {
    return { verdict: 'parent_fallback', reason: 'retry_exhausted_parent_verifiable' };
  }
  return { verdict: 'honest_block', reason: 'retry_exhausted_parent_unverifiable' };
}

// readiness 분류가 만든 action에 런 스코프 게이트를 적용한다. readiness 자체는 감사 문맥이고,
// 실제 재작성 대상은 호출부가 이미 매핑한 baseAction이다. hard에서도 검증 가능한 task만 execute로 내린다.
export function gateAwareActionForReadiness({ readiness, baseAction, level, verifiable } = {}) {
  void readiness;
  if (level !== 'hard') return { action: baseAction, demoted: false };
  if (!PLANNING_ACTION_KINDS.has(baseAction)) return { action: baseAction, demoted: false };
  if (verifiable === true) {
    return { action: 'execute', demoted: true, reason: 'convergence_hard_demotion' };
  }
  return {
    action: baseAction,
    demoted: false,
    demotionRefused: 'no_verifiable_acceptance',
  };
}

function pickNumber(optionValue, envValue) {
  if (optionValue != null && optionValue !== '') return Number(optionValue);
  if (envValue != null && envValue !== '') return Number(envValue);
  return null;
}

function requireFraction(value, label) {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`Invalid ${label} '${value}'; expected a finite number in (0, 1]`);
  }
  return value;
}

// options.convergence > env > CONVERGENCE_DEFAULTS. 잘못된 값은 여기서 throw 한다 —
// 호출부(runTaskOps)가 lock 획득 전에 부르므로 lock 이 남지 않는다.
export function normalizeConvergenceConfig(options = {}, env = process.env) {
  const raw = options && typeof options.convergence === 'object' && options.convergence !== null && !Array.isArray(options.convergence)
    ? options.convergence
    : {};
  const rawMode = raw.mode != null && raw.mode !== ''
    ? String(raw.mode)
    : (typeof options.convergence === 'string' && options.convergence !== ''
      ? String(options.convergence)
      : (env.TASKOPS_CONVERGENCE != null && env.TASKOPS_CONVERGENCE !== '' ? String(env.TASKOPS_CONVERGENCE) : CONVERGENCE_DEFAULTS.mode));
  const mode = rawMode.trim().toLowerCase();
  if (!CONVERGENCE_MODES.includes(mode)) {
    throw new Error(`Invalid convergence mode '${rawMode}'. Allowed: ${CONVERGENCE_MODES.join(', ')}`);
  }

  const rawBudget = raw.budget && typeof raw.budget === 'object' ? raw.budget : {};
  const soft = requireFraction(
    pickNumber(rawBudget.soft, env.TASKOPS_CONVERGENCE_BUDGET_SOFT) ?? CONVERGENCE_DEFAULTS.budget.soft,
    'convergence.budget.soft',
  );
  const hard = requireFraction(
    pickNumber(rawBudget.hard, env.TASKOPS_CONVERGENCE_BUDGET_HARD) ?? CONVERGENCE_DEFAULTS.budget.hard,
    'convergence.budget.hard',
  );
  if (soft > hard) {
    throw new Error(`Invalid convergence budget thresholds: soft (${soft}) must be <= hard (${hard})`);
  }

  const rawDepth = raw.depth && typeof raw.depth === 'object' ? raw.depth : {};
  let depthEnabled = CONVERGENCE_DEFAULTS.depth.enabled;
  if (rawDepth.enabled != null) depthEnabled = rawDepth.enabled === true || String(rawDepth.enabled).trim().toLowerCase() === 'true';
  else if (env.TASKOPS_CONVERGENCE_DEPTH != null && env.TASKOPS_CONVERGENCE_DEPTH !== '') {
    depthEnabled = String(env.TASKOPS_CONVERGENCE_DEPTH).trim().toLowerCase() === 'true';
  }

  const rawDebt = raw.debt && typeof raw.debt === 'object' ? raw.debt : {};
  const count = pickNumber(rawDebt.count, env.TASKOPS_CONVERGENCE_DEBT_COUNT) ?? CONVERGENCE_DEFAULTS.debt.count;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Invalid convergence.debt.count '${count}'; expected a non-negative integer`);
  }
  const ratio = pickNumber(rawDebt.ratio, env.TASKOPS_CONVERGENCE_DEBT_RATIO) ?? CONVERGENCE_DEFAULTS.debt.ratio;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error(`Invalid convergence.debt.ratio '${ratio}'; expected a finite number in [0, 1]`);
  }
  // sustain 0 을 허용하면 "첫 평가에서 곧바로 hard" 가 되어 soft 전 자유도 보존이 깨진다 — 하한을 1로 강제한다.
  const sustainRaw = rawDebt.sustain != null && rawDebt.sustain !== ''
    ? rawDebt.sustain
    : (env.TASKOPS_CONVERGENCE_DEBT_SUSTAIN != null && env.TASKOPS_CONVERGENCE_DEBT_SUSTAIN !== ''
      ? env.TASKOPS_CONVERGENCE_DEBT_SUSTAIN
      : CONVERGENCE_DEFAULTS.debt.sustain);
  const sustain = Number(sustainRaw);
  if (!Number.isInteger(sustain) || sustain < 1) {
    throw new Error(`Invalid convergence.debt.sustain '${sustainRaw}'; expected an integer >= 1`);
  }

  const rawDecomposition = raw.decomposition && typeof raw.decomposition === 'object' && !Array.isArray(raw.decomposition)
    ? raw.decomposition
    : {};
  const maxRetries = pickNumber(
    rawDecomposition.maxRetries,
    env.TASKOPS_CONVERGENCE_DECOMPOSITION_MAX_RETRIES,
  ) ?? CONVERGENCE_DEFAULTS.decomposition.maxRetries;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error(`Invalid convergence.decomposition.maxRetries '${maxRetries}'; expected a non-negative integer`);
  }

  const rawExtension = raw.extension && typeof raw.extension === 'object' && !Array.isArray(raw.extension)
    ? raw.extension
    : {};
  const maxGrants = pickNumber(rawExtension.maxGrants, env.TASKOPS_CONVERGENCE_EXTENSION_MAX)
    ?? CONVERGENCE_EXTENSION_DEFAULTS.maxGrants;
  if (!Number.isInteger(maxGrants) || maxGrants < 0) {
    throw new Error(`Invalid convergence.extension.maxGrants '${maxGrants}'; expected a non-negative integer`);
  }
  const fraction = requireFraction(
    pickNumber(rawExtension.fraction, env.TASKOPS_CONVERGENCE_EXTENSION_FRACTION)
      ?? CONVERGENCE_EXTENSION_DEFAULTS.fraction,
    'convergence.extension.fraction',
  );

  return {
    mode,
    budget: { soft, hard },
    depth: { enabled: depthEnabled },
    debt: { count, ratio, sustain },
    decomposition: { maxRetries },
    extension: { maxGrants, fraction },
  };
}

function compactExtensionEvidenceText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// 예산 연장 신청의 단일 순수 판정기. dispatch 시점 level만 소비하며 I/O나 예산 변경은 하지 않는다.
export function evaluateExtensionRequest({ request, level, mode, grantsUsed = 0, maxGrants = 0 } = {}) {
  if (!request) return null;
  if (request.malformed === true) return { decision: 'rejected', rejectionReason: 'malformed_marker' };
  if (mode !== 'enforce') return { decision: 'rejected', rejectionReason: 'convergence_not_enforcing' };
  if (!(Number(maxGrants) > 0) || Number(grantsUsed) >= Number(maxGrants)) {
    return { decision: 'rejected', rejectionReason: 'grant_cap_exhausted' };
  }
  if (level === 'none') {
    return { decision: 'rejected', rejectionReason: 'out_of_window_no_pressure' };
  }
  if (level === 'hard') {
    return { decision: 'rejected', rejectionReason: 'out_of_window_too_late' };
  }

  const reason = compactExtensionEvidenceText(request.reason);
  const remainingWork = compactExtensionEvidenceText(request.remainingWork);
  const hasObservedEvidence = Array.isArray(request.evidence)
    && request.evidence.some((entry) => entry && compactExtensionEvidenceText(entry.observed));
  if (
    level !== 'soft'
    || request.requested !== true
    || reason.length < 20
    || !hasObservedEvidence
    || !remainingWork
  ) {
    return { decision: 'rejected', rejectionReason: 'insufficient_evidence' };
  }
  return { decision: 'granted', rejectionReason: null };
}

// 예산축. step 축과 wall-clock 축 중 **더 많이 소진된 쪽**을 신호로 쓴다(OR 결합).
// 두 차원이 모두 없으면 축 비활성(절대 미발화) — 예산이 없는 런을 "예산 소진"으로 읽지 않는다.
//
// 주의(의도적 설계): 호출부는 budgetEnabled / maxStepsExplicit 과 **분리해서** 이 함수를 부른다.
// maxStepsExplicit 이 누락된 런(예: 어댑터가 안 넘긴 경우)에서 게이트가 조용히 죽는 것을 막기 위함이다.
export function budgetPressure({ stepsRun = 0, maxSteps = null, elapsedMs = 0, maxWallClockMs = null, thresholds = CONVERGENCE_DEFAULTS.budget } = {}) {
  const stepFrac = maxSteps != null && Number(maxSteps) > 0 ? Number(stepsRun) / Number(maxSteps) : null;
  const wallFrac = maxWallClockMs != null && Number(maxWallClockMs) > 0 ? Number(elapsedMs) / Number(maxWallClockMs) : null;
  if (stepFrac == null && wallFrac == null) {
    return { axis: 'budget', active: false, level: 'none', signal: null, stepFrac: null, wallFrac: null };
  }
  const consumed = Math.max(stepFrac == null ? -Infinity : stepFrac, wallFrac == null ? -Infinity : wallFrac);
  const level = consumed >= thresholds.hard ? 'hard' : (consumed >= thresholds.soft ? 'soft' : 'none');
  return { axis: 'budget', active: true, level, signal: consumed, stepFrac, wallFrac };
}

// 깊이축(층1 울타리). expectedPlan 이 없거나 invalid 면 축 비활성 — dark-room 가드: 울타리 부재를
// 압력 0으로도 1로도 읽지 않는다. 구조적 깊이 측정치(consumedDepth / realizedDepthBelow)만 소비하며
// P4 confinementRatio / breachCount / κ / divSplit 스칼라는 절대 읽지 않는다(ledger LIMITATIONS 무위반).
export function depthPressure({ coordinate = null, realizedDepth = 0, thresholds = CONVERGENCE_DEFAULTS.depth } = {}) {
  if (thresholds && thresholds.enabled === false) {
    return { axis: 'depth', active: false, level: 'none', signal: null };
  }
  if (!coordinate || coordinate.enabled !== true || !Number.isInteger(coordinate.expectedDepth)) {
    return { axis: 'depth', active: false, level: 'none', signal: null };
  }
  // 신호는 **이 task 아래로 실제 만들어진 깊이**(realizedDepthBelow) vs **이 task 아래로 계획한 깊이**
  // (expectedDepth) 다. coordinate.consumedDepth 는 ancestorChain 길이 = task **위쪽**으로 이미 쓴 깊이라
  // 차원이 다르다 — 그걸 섞으면 fallback 으로 expectedDepth=0 을 받은 갓 태어난 자식이 첫 분해도 하기 전에
  // overrun=consumedDepth>0 으로 hard 가 되어 버린다(범주 오류). consumedDepth 는 진단용으로만 싣는다.
  const realized = Number(realizedDepth) || 0;
  const depthOverrun = realized - coordinate.expectedDepth;
  // >= 0 은 "계획한 깊이를 다 썼다"(soft: novelty 입증 없이는 더 분해 금지),
  // > 0 은 "계획보다 깊다"(hard: 분해 금지 + 강제 runnable).
  const level = depthOverrun > 0 ? 'hard' : (depthOverrun >= 0 ? 'soft' : 'none');
  return {
    axis: 'depth', active: true, level, signal: depthOverrun,
    consumedDepth: coordinate.consumedDepth, realizedDepth: realized, expectedDepth: coordinate.expectedDepth,
  };
}

// 발산잔여축. **게이트 전용 신규 지표**다.
//
// 왜 progressLedger 의 openDiv/closedShare/κ/confinementRatio 를 쓰지 않는가:
// lib-progress-ledger.js 의 LIMITATIONS 가 그 스칼라들의 gate·reward 사용을 명시 금지한다
// ("closedShare 를 reward/gate 로 절대 자동사용 말 것", "reward/gate 절대 금지"). 따라서 그 스칼라를
// 읽는 대신 ledger **밖**에서 게이트 전용 지표를 새로 정의한다. ledger 출력·LIMITATIONS 는 무변경이다.
// 부수적 이점: O(T) 순수 계산이라 progressLedger 의 O(T²)+캐시 부재를 피한다.
//
// 이 축의 단계 정책(3차 실측 이후 개정):
//   1회 발화만으로는 soft 다. 부채가 **sustain 스텝 연속**으로 임계를 넘어야 hard 로 승격한다.
//   - (i) 첫 평가는 절대 hard 가 아니다 — 초기 넓은 분해를 벌하지 않는다(soft 전 자유도 보존).
//   - (ii) 임계 아래로 내려가면 criticalStreak 은 즉시 0 으로 리셋된다(누적 처벌 금지). 부채를 실제로
//         줄이는 행동(= 실행 가능한 자식을 만드는 것)이 곧바로 압력을 푸는 유일한 방법이다.
//   - (iii) debt **단독** hard 는 런을 종료시키지 않는다. 이유와 무한 반복 방지 장치는 lib-runner.js 의
//         applyConvergencePressure(convergence_debt_hard_planning_continued) 주석 참조.
// 이전 사양("영구 soft 전용")은 폐기됐다: 3차 ALE 실측에서 debtRatio 가 첫 스텝부터 1.0 이었는데도
// 축이 hard 로 갈 수 없어 아무 일도 일어나지 않았고, soft 는 novelty(각 kind 의 첫 발산은 무조건 novel)로
// 매번 무력화되어 발화만 하고 차단은 못 했다.
export function openPlanDebtPressure(
  tasks = [],
  thresholds = CONVERGENCE_DEFAULTS.debt,
  { hasVerifiableAcceptance, priorCriticalStreak = 0 } = {},
) {
  if (typeof hasVerifiableAcceptance !== 'function') {
    throw new Error('openPlanDebtPressure requires hasVerifiableAcceptance');
  }
  let planDebt = 0;
  let blockedDebt = 0;
  let executable = 0;
  const executableIds = [];
  for (const task of tasks) {
    const status = String(task?.status || '').trim();
    if (status === 'done' || status === 'cancelled') continue;
    let readiness;
    try {
      readiness = classifyTaskReadiness(task).runReadiness;
    } catch {
      continue;
    }
    const verifiable = hasVerifiableAcceptance(task) === true;
    // 분해 LLM 이 blocked 자식만 양산하면 debt 가 오히려 내려가 잡아야 할 병리를 축이 못 본다.
    if (readiness === 'blocked') {
      planDebt += 1;
      blockedDebt += 1;
    } else if (PLANNING_READINESS.has(readiness)) {
      planDebt += 1;
    }
    if (isExecutableTask({ readiness, verifiable })) {
      executable += 1;
      if (task?.id != null) executableIds.push(task.id);
    }
  }
  const debtRatio = planDebt / Math.max(1, planDebt + executable);
  const sustain = Number.isInteger(thresholds?.sustain) && thresholds.sustain >= 1
    ? thresholds.sustain
    : CONVERGENCE_DEFAULTS.debt.sustain;
  const critical = planDebt >= thresholds.count && debtRatio >= thresholds.ratio;
  const criticalStreak = critical ? Math.max(0, Number(priorCriticalStreak) || 0) + 1 : 0;
  const level = !critical ? 'none' : (criticalStreak >= sustain ? 'hard' : 'soft');
  return {
    axis: 'debt', active: true, level, signal: debtRatio,
    planDebt, blockedDebt, executable, executableIds, debtRatio,
    critical, criticalStreak, sustain,
  };
}

// OR 결합 — 어느 한 축이라도 hard 면 hard.
export function combinePressure(axes = []) {
  const active = axes.filter(Boolean);
  const level = active.some((a) => a.level === 'hard')
    ? 'hard'
    : (active.some((a) => a.level === 'soft') ? 'soft' : 'none');
  const snapshot = {};
  for (const a of active) snapshot[a.axis] = a;
  return { level, firedAxes: active.filter((a) => a.level === level && level !== 'none').map((a) => a.axis), snapshot };
}

// 문자열 집합의 자원-상대 fixpoint 시그니처. lib-runner.js 의 failureSignature 정규화 로직을 추출한 것으로,
// verify_retry 와 divergence novelty 가 **같은 정규화 규칙**을 쓰게 한다(정책은 각자 다르다).
export function canonicalizeElement(value) {
  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function canonicalStringSetSignature(list) {
  return []
    .concat(list || [])
    .map(canonicalizeElement)
    .filter(Boolean)
    .sort()
    .join(' | ')
    .slice(0, 500);
}

// novelty 는 "앞으로 할 발산이 새로울까"가 아니라 "**직전에 한 같은 종류의 발산이 실제로 새 possibility mass 를
// 열었나**"로 판정한다 — 게이트는 dispatch 전에 결정하므로 예측이 아니라 이력 기반이어야 정직하다
// (verify_retry 의 novel-extension 과 같은 구조). 해당 kind 의 이력이 없으면 첫 발산이므로 항상 통과한다.
export function divergenceNovelty(task, kind) {
  const ledger = Array.isArray(task?.divergenceLedger) ? task.divergenceLedger : [];
  const sameKind = ledger.filter((entry) => entry && entry.kind === kind);
  if (sameKind.length === 0) return { novel: true, reason: 'first_divergence' };
  const last = sameKind[sameKind.length - 1];
  return last.novel === true
    ? { novel: true, reason: 'last_divergence_opened_new_mass' }
    : { novel: false, reason: 'last_divergence_repeated_signature' };
}

// 강제 실행 후보 랭킹 — 완전 결정적. "가장 준비된" task 를 고른다.
export function rankForcedExecutionCandidates(candidates = []) {
  const policyRank = (mode) => (POLICY_APPROVING_MODES.has(mode) ? 0 : 1);
  const uncertaintyRank = (state) => {
    const s = String(state || '').trim();
    if (s === 'known') return 0;
    if (s === 'known_unknown') return 1;
    return 2;
  };
  return candidates.slice().sort((a, b) => {
    const byPolicy = policyRank(a.acceptance?.mode) - policyRank(b.acceptance?.mode);
    if (byPolicy !== 0) return byPolicy;
    const byChecks = (b.acceptance?.requiredChecks?.length || 0) - (a.acceptance?.requiredChecks?.length || 0);
    if (byChecks !== 0) return byChecks;
    const byUncertainty = uncertaintyRank(a.task?.uncertaintyState) - uncertaintyRank(b.task?.uncertaintyState);
    if (byUncertainty !== 0) return byUncertainty;
    const byConfidence = (Number(b.task?.confidenceScore) || 0) - (Number(a.task?.confidenceScore) || 0);
    if (byConfidence !== 0) return byConfidence;
    // 깊은 것 우선 = 작은 스코프 우선.
    const byDepth = (Number(b.consumedDepth) || 0) - (Number(a.consumedDepth) || 0);
    if (byDepth !== 0) return byDepth;
    const byOrder = (Number(a.task?.order) || 0) - (Number(b.task?.order) || 0);
    if (byOrder !== 0) return byOrder;
    return String(a.task?.id || '').localeCompare(String(b.task?.id || ''));
  });
}
