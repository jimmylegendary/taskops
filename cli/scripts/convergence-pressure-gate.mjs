#!/usr/bin/env node
// 층1 + 층2 — 수렴 압력 게이트(3축 × 2단계, OR 결합).
// ALE 실측 결함: 5분해/5탐색으로 예산을 전부 계획에 소비하고 execute 0회. execute 로 미는 힘이 없었다.
//
// 이 스모크가 지키는 계약:
//   (1) 예산/깊이 hard → planning 차단 + 강제 실행. 축이 비활성이면 절대 미발화.
//   (2) 거짓 완료 금지 — 검증 불가 task 는 강제 실행되지 않고 정직하게 convergence_blocked 로 끝난다.
//   (3) 게이트는 task 파일을 절대 쓰지 않는다.
//   (4) novelty 가 참인 발산은 soft 를 통과한다(필요한 발산을 벌하지 않는다).
//   (5) observe/off 모드는 스케줄을 바꾸지 않는다.
//   (6) 임계값은 설정 가능하다(하드코딩 아님).
// 검증은 events.jsonl · runResult · 실제 dispatch 된 action kind · task 파일 내용으로만 한다.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONVERGENCE_DEFAULTS, normalizeConvergenceConfig, openPlanDebtPressure } from '../lib-convergence.js';
import { runTaskOps } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-convergence-pressure-gate-'));
let seq = 0;

function run(args, options = {}) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...(options.env || {}) } });
  if (result.status !== (options.expectStatus ?? 0)) {
    throw new Error(`taskops ${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function hasVerifiableAcceptance(task) {
  const acceptance = task?.acceptance || {};
  return [...(acceptance.requiredChecks || []), ...(acceptance.requiredArtifacts || [])]
    .some((signal) => String(signal ?? '').trim().length > 0);
}

// 픽스처: 계획만 요구하는 planner task 하나 + 실행 가능한(requiredChecks 보유) executable task 하나.
// 게이트가 없으면 runner 는 planner 쪽 decompose 를 계속 고른다(readiness precedence).
function makeWork({ plannerExpectedDepth = 2, plannerConsumedFence = false, executable = true, executableChecks = ['node -e "process.exit(0)"'], plannerLedger = null, extraPlanners = 0 } = {}) {
  const id = `conv-gate-${seq += 1}`;
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Verify convergence pressure.', '--language', 'en']);

  const tasks = [];
  const planner = {
    id: 'task-planner',
    title: 'Planner',
    objective: 'Keep asking for more decomposition instead of producing evidence.',
    responsibility: 'Divergence probe.',
    completionCriteria: 'A child group exists.',
    order: 1,
    status: 'pending',
    runReadiness: 'needs_decomposition',
    uncertaintyState: 'known_unknown',
    confidenceScore: 0.4,
    decompositionConfidence: 0.85,
    expectedPlan: {
      expectedDepth: plannerExpectedDepth,
      expectedBreadth: 2,
      // consumedDepth 는 루트에서 0이므로, 울타리에 닿게 하려면 expectedDepth 를 0으로 낮춘다.
      rationale: 'Planner fence fixture.',
    },
  };
  if (plannerConsumedFence) planner.expectedPlan.expectedDepth = 0;
  tasks.push(planner);

  for (let i = 0; i < extraPlanners; i += 1) {
    tasks.push({
      id: `task-extra-planner-${i + 1}`,
      title: `Extra planner ${i + 1}`,
      objective: 'Add open plan debt without producing evidence.',
      responsibility: 'Debt probe.',
      completionCriteria: 'Never executed.',
      order: 10 + i,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      uncertaintyState: 'known_unknown',
      confidenceScore: 0.2,
      decompositionConfidence: 0.85,
      expectedPlan: { expectedDepth: 1, expectedBreadth: 2, rationale: 'Debt filler.' },
    });
  }

  // ALE 재현의 핵심: 이 task 는 objective/criteria/acceptance 를 모두 갖춘 **검증 가능한** task 인데,
  // uncertaintyState='known_unknown' 이라 readiness 분류가 계속 needs_decomposition 으로 미룬다
  // (uncertainty 경로가 primary라 execute 로 가는 문이 열리지 않는다). 게이트가 없으면 영원히 실행되지 않는다.
  if (executable) {
    tasks.push({
      id: 'task-deferred',
      title: 'Deferred but verifiable',
      objective: 'Produce the evidence the plan keeps deferring.',
      responsibility: 'Execution probe.',
      completionCriteria: 'The required check passes.',
      expectedResult: 'A verified check result.',
      // 스케줄러가 앞의 planner 들을 먼저 소모하도록 뒤로 민다 — 예산이 hard 에 닿을 때까지 이 task 는
      // 손대지 않은 리프로 남아 있어야 "계획만 하다 예산을 다 쓴" ALE 상태가 재현된다.
      order: 99,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      uncertaintyState: 'known_unknown',
      confidenceScore: 0.9,
      decompositionConfidence: 0.85,
      expectedPlan: { expectedDepth: 1, expectedBreadth: 1, rationale: 'Deferred by the readiness classifier.' },
      acceptance: executableChecks.length
        ? { mode: 'guarded', requiredChecks: executableChecks, expectedOutcome: 'A verified check result.' }
        : { mode: 'informational', expectedOutcome: 'Nothing verifiable.' },
    });
  }

  const specPath = join(tempRoot, `${id}-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2', version: 'v2', summary: 'Convergence gate fixture', selected: true, tasks,
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  // divergenceLedger 는 spec 작성기의 허용 필드가 아니라 spec 으로는 전달되지 않는다 —
  // 런너가 실제로 쓰는 직렬화기로 직접 심어야 게이트가 읽는 것과 같은 표현이 된다.
  if (plannerLedger) {
    const pp = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-planner.md');
    const raw = readFileSync(pp, 'utf8');
    const yaml = ['divergenceLedger:'];
    for (const e of plannerLedger) {
      yaml.push(`  - kind: ${e.kind}`);
      yaml.push(`    runNodeId: ${e.runNodeId}`);
      yaml.push(`    at: ${e.at}`);
      yaml.push(`    sigBefore: ${e.sigBefore}`);
      yaml.push(`    sigAfter: ${e.sigAfter}`);
      yaml.push(`    novel: ${e.novel}`);
    }
    const end = raw.indexOf('\n---', 4);
    writeFileSync(pp, `${raw.slice(0, end)}\n${yaml.join('\n')}${raw.slice(end)}`, 'utf8');
  }
  return workDir;
}

// 어떤 action 이든 즉시 성공시키는 fake executor: decompose 는 자식 하나를 authoring 하고,
// execute 는 결과를 stdout 으로 낸다. (실제 dispatch 된 kind 를 관찰하는 것이 목적이다.)
function makeFake(envVar) {
  const fakePath = join(tempRoot, `fake-${envVar}.mjs`);
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('--version')) { console.log('openclaw fake convergence gate'); process.exit(0); }
const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const workDir = process.env.${envVar};
appendFileSync(join(workDir, 'fake-calls.log'), (prompt.slice(0, 60).replace(/\\n/g, ' ')) + '\\n');

const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
if (childTaskGroupId && versionId) {
  const now = '2026-07-28T00:00:00.000Z';
  const groupDir = join(workDir, 'task-groups', childTaskGroupId);
  const versionDir = join(groupDir, 'versions', versionId);
  mkdirSync(join(versionDir, 'tasks'), { recursive: true });
  mkdirSync(join(versionDir, 'eow'), { recursive: true });
  writeFileSync(join(groupDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroup','id: ' + childTaskGroupId,'objective: Child group','createdAt: ' + now,'status: active','activeVersionId: ' + versionId,'---','# ' + childTaskGroupId,''].join('\\n'), 'utf8');
  writeFileSync(join(versionDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroupVersion','id: ' + versionId,'taskGroupId: ' + childTaskGroupId,'version: v1','summary: Child version','createdAt: ' + now,'status: active','---','# Child version',''].join('\\n'), 'utf8');
  writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- fake\\n', 'utf8');
  writeFileSync(join(versionDir, 'tasks', 'task-spawned.md'), ['---','taskOpsVersion: v1','entityType: task','id: task-spawned','taskGroupId: ' + childTaskGroupId,'taskGroupVersionId: ' + versionId,'title: Spawned','objective: Spawned child that still needs planning.','responsibility: Keep the divergence cycle going.','completionCriteria: More planning.','order: 1','createdAt: ' + now,'status: pending','runReadiness: needs_decomposition','uncertaintyState: known_unknown','expectedPlan:','  expectedDepth: 1','  expectedBreadth: 1','  rationale: Spawned child plan.','---','# Spawned',''].join('\\n'), 'utf8');
  console.log('decomposition authored');
  process.exit(0);
}
console.log(JSON.stringify({ executorSummary: 'executed', observed: { outcomeSummary: 'the required check was run' } }));
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function readEvents(workDir, runId) {
  const p = join(workDir, 'runs', runId, 'events.jsonl');
  return readFileSync(p, 'utf8').trim().split(/\n+/).filter(Boolean).map((l) => JSON.parse(l));
}
function evTypes(events, type) { return events.filter((e) => e.type === type); }

function snapshotTaskFiles(workDir) {
  const out = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) out[p] = readFileSync(p, 'utf8');
    }
  };
  walk(join(workDir, 'task-groups'));
  return out;
}

function exec(workDir, options = {}) {
  const envVar = `TASKOPS_CONV_GATE_${workDir.replace(/[^A-Za-z0-9]/g, '_').toUpperCase().slice(-40)}`;
  const fake = makeFake(envVar);
  writeFileSync(join(workDir, 'fake-calls.log'), '', 'utf8');
  const prev = process.env.TASKOPS_OPENCLAW_BIN;
  process.env.TASKOPS_OPENCLAW_BIN = fake;
  process.env[envVar] = workDir;
  let runResult = null; let thrown = null;
  try {
    // continueOnFailure = ALE 어댑터와 동일 설정: 탐색 실패가 런 전체를 죽이지 않게 한다.
    runResult = runTaskOps(workDir, { executor: 'openclaw-agent', agent: 'main', timeout: 30, continueOnFailure: true, ...options });
  } catch (err) { thrown = err; }
  if (prev == null) delete process.env.TASKOPS_OPENCLAW_BIN; else process.env.TASKOPS_OPENCLAW_BIN = prev;
  delete process.env[envVar];
  return { runResult, thrown };
}

try {
  // ============ A. 설정 표면 =====================================================================
  assert.equal(CONVERGENCE_DEFAULTS.budget.soft, 0.50, 'A1: default budget soft is 0.50');
  assert.equal(CONVERGENCE_DEFAULTS.budget.hard, 0.75, 'A1: default budget hard is 0.75');
  assert.equal(CONVERGENCE_DEFAULTS.debt.count, 5, 'A1: default debt count is 5');
  assert.equal(CONVERGENCE_DEFAULTS.debt.ratio, 0.8, 'A1: default debt ratio is 0.8');

  // options > env > 기본값
  assert.equal(normalizeConvergenceConfig({}, {}).budget.hard, 0.75, 'A2: default wins with no options/env');
  assert.equal(normalizeConvergenceConfig({}, { TASKOPS_CONVERGENCE_BUDGET_HARD: '0.6' }).budget.hard, 0.6, 'A2: env overrides default');
  assert.equal(
    normalizeConvergenceConfig({ convergence: { budget: { hard: 0.9 } } }, { TASKOPS_CONVERGENCE_BUDGET_HARD: '0.6' }).budget.hard,
    0.9, 'A2: options override env',
  );
  // 잘못된 값은 throw
  assert.throws(() => normalizeConvergenceConfig({ convergence: { mode: 'sideways' } }, {}), /convergence mode/i, 'A3: bad mode throws');
  assert.throws(() => normalizeConvergenceConfig({ convergence: { budget: { hard: -1 } } }, {}), /budget\.hard/i, 'A3: negative threshold throws');
  assert.throws(() => normalizeConvergenceConfig({ convergence: { budget: { hard: 2 } } }, {}), /budget\.hard/i, 'A3: >1 threshold throws');
  assert.throws(() => normalizeConvergenceConfig({ convergence: { budget: { soft: 0.9, hard: 0.5 } } }, {}), /soft .* <= hard/i, 'A3: soft>hard throws');
  assert.throws(() => normalizeConvergenceConfig({ convergence: { debt: { ratio: 3 } } }, {}), /debt\.ratio/i, 'A3: bad ratio throws');

  // 발산잔여축은 **연속 sustain 스텝** 임계 초과에서만 hard 로 승격한다. 첫 평가는 절대 hard 가 아니다
  // (soft 전 자유도 보존 — 초기 넓은 분해를 벌하지 않는다). 상세 계약은 convergence-debt-axis.mjs 참조.
  const debtTasks = Array.from({ length: 17 }, (_, i) => ({
    id: `t${i}`, status: 'pending', runReadiness: 'needs_decomposition',
    objective: 'o', responsibility: 'r', completionCriteria: 'c',
  }));
  const debt = openPlanDebtPressure(debtTasks, CONVERGENCE_DEFAULTS.debt, { hasVerifiableAcceptance });
  assert.equal(debt.planDebt, 17, 'A4: ALE shape yields planDebt=17');
  assert.equal(debt.level, 'soft', 'A4: debt axis fires soft');
  assert.notEqual(debt.level, 'hard', 'A4: 첫 평가(streak 이력 없음)는 절대 hard 가 아니다');
  const sustainedDebt = openPlanDebtPressure(debtTasks, CONVERGENCE_DEFAULTS.debt, {
    hasVerifiableAcceptance,
    priorCriticalStreak: CONVERGENCE_DEFAULTS.debt.sustain - 1,
  });
  assert.equal(sustainedDebt.level, 'hard', 'A4: sustain 스텝 연속이면 hard 로 승격한다');
  const smallDebt = openPlanDebtPressure(debtTasks.slice(0, 3), CONVERGENCE_DEFAULTS.debt, { hasVerifiableAcceptance });
  assert.equal(smallDebt.level, 'none', 'A4: planDebt=3 must not fire');
  // 이 축은 progressLedger 를 부르지 않는다(ledger LIMITATIONS 우회 없음).
  const convSrc = readFileSync(join(__dirname, '..', 'lib-convergence.js'), 'utf8');
  assert.equal(/progressLedger|confinementRatio|closedShare|kappaReabsorb|openDiv/.test(convSrc.replace(/^\s*\/\/.*$/gm, '')), false,
    'A5: the gate must not read any measurement-only ledger scalar');

  // ============ B. 예산축 hard → planning 차단 + 강제 실행 ==========================================
  // maxSteps=4 로 3스텝 소진(0.75) 시점에 hard. 앞의 스텝들은 planner 를 계속 분해한다.
  const budgetWork = makeWork({ extraPlanners: 2 });
  const budgetRun = exec(budgetWork, { maxSteps: 4, maxStepsExplicit: true });
  if (budgetRun.thrown) throw budgetRun.thrown;
  const budgetKinds = budgetRun.runResult.actions.map((a) => a.kind);
  const budgetEvents = readEvents(budgetWork, budgetRun.runResult.runId);
  assert.equal(budgetKinds.includes('execute'), true, `B1: budget hard must force an execute, got ${budgetKinds.join(',')}`);
  assert.equal(evTypes(budgetEvents, 'convergence_planning_blocked').length >= 1, true, 'B1: planning must be blocked');
  assert.equal(evTypes(budgetEvents, 'convergence_forced_execute').length >= 1, true, 'B1: a forced execute event must be logged');
  assert.equal(budgetRun.runResult.convergence.forcedExecutes >= 1, true, 'B1: runResult must count the forced execute');
  // 강제 실행 대상은 검증 가능한 task 여야 한다.
  const forced = evTypes(budgetEvents, 'convergence_forced_execute')[0];
  assert.equal(forced.taskId, 'task-deferred', 'B1: the forced task must be the one carrying verifiable acceptance');

  // 미발화: 소진율이 낮으면 계획 그대로.
  const lowWork = makeWork();
  const lowRun = exec(lowWork, { maxSteps: 20, maxStepsExplicit: true });
  if (lowRun.thrown) throw lowRun.thrown;
  const lowEarly = readEvents(lowWork, lowRun.runResult.runId);
  const firstBlocked = lowEarly.findIndex((e) => e.type === 'convergence_planning_blocked');
  assert.equal(lowRun.runResult.actions[0].kind, 'decompose', 'B2: the first step at low consumption must stay planning');
  assert.equal(firstBlocked === -1 || firstBlocked > 0, true, 'B2: no pressure may fire on the first step');

  // 축 비활성: maxSteps/maxWallClockMs 가 모두 없으면 예산축은 절대 발화하지 않는다.
  // (runTaskOps 는 둘 다 없으면 maxSteps=1 을 넣으므로 until 로 예산 차원을 비운다.)
  const noBudgetWork = makeWork();
  const noBudgetRun = exec(noBudgetWork, { until: new Date(Date.now() + 60_000).toISOString() });
  if (noBudgetRun.thrown) throw noBudgetRun.thrown;
  const noBudgetEvents = readEvents(noBudgetWork, noBudgetRun.runResult.runId);
  for (const e of evTypes(noBudgetEvents, 'convergence_pressure')) {
    assert.equal(e.snapshot.budget.active, false, 'B3: with no budget dimension the budget axis must be inactive');
  }

  // 독립성: maxStepsExplicit 을 안 넘겨도 게이트는 동일하게 발화한다(budgetEnabled 의존 없음).
  const implicitWork = makeWork({ extraPlanners: 2 });
  const implicitRun = exec(implicitWork, { maxSteps: 4 });
  if (implicitRun.thrown) throw implicitRun.thrown;
  assert.equal(
    implicitRun.runResult.actions.map((a) => a.kind).includes('execute'), true,
    'B4: the gate must fire without maxStepsExplicit (no budgetEnabled dependency)',
  );

  // 임계값이 하드코딩이 아님: hard=0.99 로 올리면 같은 픽스처에서 강제 실행이 사라진다.
  const looseWork = makeWork({ extraPlanners: 2 });
  const looseRun = exec(looseWork, { maxSteps: 4, maxStepsExplicit: true, convergence: { budget: { soft: 0.98, hard: 0.99 }, debt: { count: 999, ratio: 1 }, depth: { enabled: false } } });
  if (looseRun.thrown) throw looseRun.thrown;
  assert.equal(looseRun.runResult.convergence.forcedExecutes, 0, 'B5: raising the thresholds must silence the gate (not hardcoded)');

  // ============ C. 깊이 울타리(층1) ================================================================
  // expectedDepth=0 인데 여전히 needs_decomposition → depthOverrun=0 → soft. 이력이 없으면 novelty 로 통과.
  // 이력이 non-novel 이면 차단된다.
  const fenceNonNovel = makeWork({
    plannerConsumedFence: true,
    plannerLedger: [{ kind: 'decompose', runNodeId: 'n1', at: '2026-07-27T00:00:00.000Z', sigBefore: 'a', sigAfter: 'a', novel: false }],
  });
  const fenceRun = exec(fenceNonNovel, { maxSteps: 2, maxStepsExplicit: true, convergence: { budget: { soft: 0.99, hard: 1 }, debt: { count: 999, ratio: 1 } } });
  if (fenceRun.thrown) throw fenceRun.thrown;
  const fenceEvents = readEvents(fenceNonNovel, fenceRun.runResult.runId);
  const fencePressure = evTypes(fenceEvents, 'convergence_pressure');
  assert.equal(fencePressure.length >= 1, true, 'C1: the depth fence must fire on its own (budget/debt silenced)');
  assert.equal(fencePressure[0].firedAxes.includes('depth'), true, 'C1: the firing axis must be depth');
  assert.equal(evTypes(fenceEvents, 'convergence_planning_blocked').length >= 1, true, 'C1: a non-novel decompose at the fence must be blocked');

  // novelty 가 참이면 같은 울타리에서도 통과한다(필요한 발산을 벌하지 않는다).
  const fenceNovel = makeWork({
    plannerConsumedFence: true,
    plannerLedger: [{ kind: 'decompose', runNodeId: 'n1', at: '2026-07-27T00:00:00.000Z', sigBefore: 'a', sigAfter: 'b', novel: true }],
  });
  const novelRun = exec(fenceNovel, { maxSteps: 1, maxStepsExplicit: true, convergence: { budget: { soft: 0.99, hard: 1 }, debt: { count: 999, ratio: 1 } } });
  if (novelRun.thrown) throw novelRun.thrown;
  const novelEvents = readEvents(fenceNovel, novelRun.runResult.runId);
  assert.equal(novelRun.runResult.actions[0].kind, 'decompose', 'C2: a novel divergence must pass the soft fence');
  assert.equal(evTypes(novelEvents, 'convergence_planning_blocked').length, 0, 'C2: a novel divergence must not be blocked');

  // 이력이 아예 없으면 첫 발산은 항상 통과.
  const fenceFirst = makeWork({ plannerConsumedFence: true });
  const firstRun = exec(fenceFirst, { maxSteps: 1, maxStepsExplicit: true, convergence: { budget: { soft: 0.99, hard: 1 }, debt: { count: 999, ratio: 1 } } });
  if (firstRun.thrown) throw firstRun.thrown;
  assert.equal(firstRun.runResult.actions[0].kind, 'decompose', 'C3: the first divergence always passes');

  // 축 비활성: expectedPlan 이 없으면 깊이축은 발화하지 않는다.
  const noPlanWork = makeWork({ plannerConsumedFence: true });
  const plannerPath = join(noPlanWork, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-planner.md');
  writeFileSync(plannerPath, readFileSync(plannerPath, 'utf8').replace(/expectedPlan:[\s\S]*?rationale: [^\n]*\n/, ''), 'utf8');
  const noPlanRun = exec(noPlanWork, { maxSteps: 1, maxStepsExplicit: true, convergence: { budget: { soft: 0.99, hard: 1 }, debt: { count: 999, ratio: 1 } } });
  if (noPlanRun.thrown) throw noPlanRun.thrown;
  const noPlanEvents = readEvents(noPlanWork, noPlanRun.runResult.runId);
  for (const e of evTypes(noPlanEvents, 'convergence_pressure')) {
    assert.equal(e.snapshot.depth.active, false, 'C4: with no expectedPlan the depth axis must stay inactive (dark-room guard)');
  }

  // ============ D. 거짓 완료 금지 =================================================================
  // hard 인데 검증 가능한 task 가 하나도 없다 → 강제 실행 없이 정직하게 convergence_blocked.
  const noEvidenceWork = makeWork({ executable: false, extraPlanners: 2 });
  const before = snapshotTaskFiles(noEvidenceWork);
  const noEvidenceRun = exec(noEvidenceWork, { maxSteps: 4, maxStepsExplicit: true });
  if (noEvidenceRun.thrown) throw noEvidenceRun.thrown;
  assert.equal(noEvidenceRun.runResult.stopReason, 'convergence_blocked',
    `D1: with nothing verifiable the run must stop honestly, got ${noEvidenceRun.runResult.stopReason}`);
  assert.equal(noEvidenceRun.runResult.convergence.forcedExecutes, 0, 'D1: nothing may be forced into execution');
  assert.equal(noEvidenceRun.runResult.closure?.complete === true, false, 'D1: closure must not be complete');
  const after = snapshotTaskFiles(noEvidenceWork);
  // 게이트는 파일을 쓰지 않는다 — decompose 스텝이 쓴 것 외에 planner/executable 원본은 그대로여야 한다.
  for (const [path, content] of Object.entries(before)) {
    if (!content.includes('id: task-deferred')) continue; // 분해 스텝이 정당하게 건드리는 파일은 제외
    assert.equal(after[path], content, `D2: the gate must not mutate ${path}`);
  }
  // done 인 task 는 **분해로 닫힌 부모뿐**이어야 한다(그건 decompose closure 의 오래된 정상 동작이다).
  // 게이트가 실행되지도 않은 task 를 done 으로 만들었다면 여기서 잡힌다.
  for (const [path, content] of Object.entries(after)) {
    if (!content.includes('entityType: task')) continue;
    if (!/^status: done$/m.test(content)) continue;
    assert.equal(/^childTaskGroupId: /m.test(content), true,
      `D3: ${path} is done without having been closed by decomposition — a false completion`);
  }
  // 실행 자체가 한 번도 일어나지 않았음을 이벤트로 확인한다.
  const noEvidenceEvents = readEvents(noEvidenceWork, noEvidenceRun.runResult.runId);
  assert.equal(evTypes(noEvidenceEvents, 'task_started').length, 0,
    'D3: no task may be executed when nothing carries verifiable acceptance');

  // informational acceptance(체크 없음) task 는 강제 실행 후보가 아니다.
  const informationalWork = makeWork({ executableChecks: [], extraPlanners: 2 });
  const informationalRun = exec(informationalWork, { maxSteps: 4, maxStepsExplicit: true });
  if (informationalRun.thrown) throw informationalRun.thrown;
  assert.equal(informationalRun.runResult.convergence.forcedExecutes, 0,
    'D4: an informational/empty-acceptance task must never be forced into execution');
  assert.equal(informationalRun.runResult.stopReason, 'convergence_blocked', 'D4: it must stop honestly instead');

  // ============ E. observe / off ==================================================================
  const offWork = makeWork();
  const offRun = exec(offWork, { maxSteps: 4, maxStepsExplicit: true, convergence: { mode: 'off' } });
  if (offRun.thrown) throw offRun.thrown;
  const offEvents = readEvents(offWork, offRun.runResult.runId);
  assert.equal(offEvents.filter((e) => String(e.type).startsWith('convergence_')).length, 0, 'E1: mode=off must emit no convergence event');

  const observeWork = makeWork();
  const observeRun = exec(observeWork, { maxSteps: 4, maxStepsExplicit: true, convergence: { mode: 'observe' } });
  if (observeRun.thrown) throw observeRun.thrown;
  const observeEvents = readEvents(observeWork, observeRun.runResult.runId);
  assert.equal(evTypes(observeEvents, 'convergence_pressure').length >= 1, true, 'E2: observe must still measure');
  assert.equal(evTypes(observeEvents, 'convergence_forced_execute').length, 0, 'E2: observe must never rewrite the action');
  assert.deepEqual(
    observeRun.runResult.actions.map((a) => a.kind),
    offRun.runResult.actions.map((a) => a.kind),
    'E3: observe and off must produce an identical action sequence',
  );

  // 잘못된 설정은 lock 획득 전에 throw 한다(런너 lock 이 남지 않는다).
  const badWork = makeWork();
  const badRun = exec(badWork, { maxSteps: 1, convergence: { mode: 'sideways' } });
  assert.ok(badRun.thrown, 'E4: an invalid convergence mode must throw');
  assert.equal(
    (() => { try { statSync(join(badWork, '.taskops-runner.lock')); return true; } catch { return false; } })(),
    false, 'E4: the runner lock must not leak on an invalid config',
  );

  console.log('convergence-pressure-gate smoke passed');
} catch (err) {
  console.error(err);
  process.exit(1);
}
