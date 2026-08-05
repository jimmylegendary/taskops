#!/usr/bin/env node
// 발산잔여(부채)축 — openPlanDebtPressure 의 계약.
//
// 3차 실측이 확정한 결함:
//   (a) blocked task 를 debt 에서 제외해, 분해 LLM 이 blocked 자식만 양산하면 debt 가 **내려간다**
//       (잡아야 할 병리를 축이 못 본다).
//   (b) executable 을 readiness runnable 만으로 셌다 — 강제 실행 후보 선정(selectForcedExecutionCandidate)은
//       검증가능 acceptance 까지 요구하므로 **정의가 두 개**였다.
//   (c) 이 축은 "영구 soft 전용"이라 hard 승격 경로가 없었다. debtRatio=1.0 으로 처음부터 최대치로 발화했는데도
//       아무 일도 일어나지 않았다.
//   (d) soft 는 novelty 로 무력화된다(각 task 의 각 kind 는 첫 시도가 무조건 novel). 발화만 하고 차단은 못 한다.
//
// 이 스모크가 지키는 계약:
//   A. blocked 는 debt 에 **포함**된다. planning→blocked 로 바뀌어도 부채는 내려가지 않는다.
//   B. executable = readiness runnable **AND** 검증가능 acceptance. debt 축과 강제 실행 후보 선정이 **같은 정의**를 쓴다.
//   C. 부채가 sustain 스텝 연속으로 임계를 넘으면 hard 로 승격한다. 첫 평가는 절대 hard 가 아니다(soft 전 자유도 보존).
//   D. debt **단독** hard 는 런을 죽이지 않는다 — 계획을 통과시키되 hard 프롬프트 + 분해 품질 게이트로 수렴시킨다.
//      (여기서 convergence_blocked 로 멈추면 3차의 execute=0 + 조기종료를 그대로 재현한다.)
//   E. novelty 로 통과하더라도 **부채 수치는 프롬프트로 전달**된다(발산을 벌하지 않으면서 정보는 준다).
//
// 검증은 순수 함수 반환값 · events.jsonl · runResult · 실제 프롬프트 전문 · task 파일 내용으로만 한다.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CONVERGENCE_DEFAULTS,
  normalizeConvergenceConfig,
  openPlanDebtPressure,
} from '../lib-convergence.js';
import {
  buildAgentDecompositionPrompt,
  buildAgentExplorationPrompt,
  runTaskOps,
  selectForcedExecutionCandidate,
} from '../lib-runner.js';
import { parseProject } from '../lib-taskops.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-convergence-debt-axis-'));
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

const baseFields = { objective: 'o', responsibility: 'r', completionCriteria: 'c' };
const debtOpts = { hasVerifiableAcceptance };

function planningTasks(n, prefix = 'plan') {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`, status: 'pending', runReadiness: 'needs_decomposition', ...baseFields,
  }));
}
function blockedTasks(n, prefix = 'blk', status = 'pending') {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`, status, runReadiness: 'blocked', ...baseFields,
  }));
}

// ============ A. blocked 는 debt 에 포함된다 ======================================================
{
  const onlyBlocked = openPlanDebtPressure(blockedTasks(6), CONVERGENCE_DEFAULTS.debt, debtOpts);
  assert.equal(onlyBlocked.planDebt, 6, 'A1: blocked task 는 planDebt 에 포함되어야 한다');
  assert.equal(onlyBlocked.blockedDebt, 6, 'A1: blockedDebt 가 따로 계측되어야 한다');
  assert.equal(onlyBlocked.executable, 0, 'A1: 실행 가능한 task 는 없다');
  assert.equal(onlyBlocked.debtRatio, 1, 'A1: debtRatio=1.0');
  assert.equal(onlyBlocked.level, 'soft', 'A1: 첫 평가는 soft');

  const mixed = openPlanDebtPressure(
    [...planningTasks(3), ...blockedTasks(3)], CONVERGENCE_DEFAULTS.debt, debtOpts,
  );
  assert.equal(mixed.planDebt, 6, 'A2: planning 3 + blocked 3 = planDebt 6');
  assert.equal(mixed.blockedDebt, 3, 'A2: blockedDebt 3');

  const terminal = openPlanDebtPressure(
    [...blockedTasks(3, 'done', 'done'), ...blockedTasks(3, 'cxl', 'cancelled')],
    CONVERGENCE_DEFAULTS.debt, debtOpts,
  );
  assert.equal(terminal.planDebt, 0, 'A3: done/cancelled 은 debt 에서 제외된다');

  // 병리 실증: 분해가 planning 자식 6개를 만들었다가 전부 blocked 로 바뀌어도 부채는 내려가면 안 된다.
  const before = openPlanDebtPressure(planningTasks(6), CONVERGENCE_DEFAULTS.debt, debtOpts);
  const after = openPlanDebtPressure(blockedTasks(6), CONVERGENCE_DEFAULTS.debt, debtOpts);
  assert.equal(after.planDebt, before.planDebt, 'A4: planning→blocked 로 바뀌어도 planDebt 가 내려가면 안 된다');
  assert.equal(after.level, before.level, 'A4: 병리가 심해졌는데 압력이 약해지면 안 된다');
}

// ============ B. executable = runnable AND 검증가능 acceptance ====================================
const runnableUnverifiable = {
  id: 'task-unverifiable', status: 'pending', runReadiness: 'runnable',
  uncertaintyState: 'known', confidenceScore: 0.9,
  objective: 'o', responsibility: 'r', completionCriteria: 'c', expectedResult: 'e',
};
const runnableVerifiable = {
  ...runnableUnverifiable,
  id: 'task-verifiable',
  acceptance: { mode: 'guarded', requiredChecks: ['node -e "process.exit(0)"'], expectedOutcome: 'the check passes' },
};
{
  const withoutAcceptance = openPlanDebtPressure(
    [...planningTasks(5), runnableUnverifiable], CONVERGENCE_DEFAULTS.debt, debtOpts,
  );
  assert.equal(withoutAcceptance.executable, 0, 'B1: 검증 불가 runnable 은 executable 이 아니다');
  assert.equal(withoutAcceptance.debtRatio, 1, 'B1: 따라서 부채비율은 내려가지 않는다');

  const withAcceptance = openPlanDebtPressure(
    [...planningTasks(5), runnableVerifiable], CONVERGENCE_DEFAULTS.debt, debtOpts,
  );
  assert.equal(withAcceptance.executable, 1, 'B2: 검증가능 runnable 은 executable 이다');
  assert.equal(withAcceptance.debtRatio < 1, true, 'B2: executable 이 생기면 부채비율이 내려간다');
}

// B3. 정의 통일 — debt 축이 executable 로 센 task 와 강제 실행 후보 선정이 고른 task 가 일치해야 한다.
{
  const id = `debt-unify-${seq += 1}`;
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Unify the executable predicate.', '--language', 'en']);
  const specPath = join(tempRoot, `${id}-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2', version: 'v2', summary: 'debt/forced-execute unification', selected: true,
    tasks: [
      { ...planningTasks(1, 'task-planner')[0], id: 'task-planner-1', order: 1, title: 'Planner', objective: 'Plan forever.', responsibility: 'Divergence probe.', completionCriteria: 'Never.', uncertaintyState: 'known_unknown', confidenceScore: 0.3 },
      { ...runnableUnverifiable, order: 2, title: 'Runnable but unverifiable', objective: 'No verifiable acceptance.', responsibility: 'Probe.', completionCriteria: 'Nothing measurable.' },
      { ...runnableVerifiable, order: 3, title: 'Runnable and verifiable', objective: 'Produce the evidence.', responsibility: 'Probe.', completionCriteria: 'The required check passes.' },
    ],
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');

  const parsed = parseProject(workDir);
  assert.deepEqual(parsed.errors, [], 'B3: 픽스처 프로젝트는 유효해야 한다');
  const tasks = [...parsed.tasks.values()];
  const debt = openPlanDebtPressure(tasks, CONVERGENCE_DEFAULTS.debt, debtOpts);
  const activeSnapshot = parsed.snapshots.get(parsed.project.activeSnapshotId) || null;
  const forced = selectForcedExecutionCandidate({ parsed, activeSnapshot, level: 'hard', mode: 'enforce' });
  assert.equal(debt.executable, 1, 'B3: debt 축은 검증가능 runnable 1개만 executable 로 센다');
  assert.equal(Array.isArray(debt.executableIds) ? debt.executableIds[0] : null, 'task-verifiable',
    'B3: debt 축이 센 executable 은 task-verifiable 이어야 한다');
  assert.equal(forced?.task?.id, 'task-verifiable',
    'B3: 강제 실행 후보 선정도 같은 task 를 골라야 한다(정의 통일)');
}

// ============ C. hard 승격 경로와 그 안전장치 =====================================================
{
  assert.equal(CONVERGENCE_DEFAULTS.debt.sustain, 3, 'C1: 기본 sustain 은 3 스텝이다');

  assert.equal(normalizeConvergenceConfig({}, {}).debt.sustain, 3, 'C2: 기본값');
  assert.equal(normalizeConvergenceConfig({}, { TASKOPS_CONVERGENCE_DEBT_SUSTAIN: '2' }).debt.sustain, 2, 'C2: env 가 기본값을 덮는다');
  assert.equal(
    normalizeConvergenceConfig({ convergence: { debt: { sustain: 4 } } }, { TASKOPS_CONVERGENCE_DEBT_SUSTAIN: '2' }).debt.sustain,
    4, 'C2: options 가 env 를 덮는다',
  );
  for (const bad of [0, -1, 1.5, 'x']) {
    assert.throws(
      () => normalizeConvergenceConfig({ convergence: { debt: { sustain: bad } } }, {}),
      /debt\.sustain/i,
      `C2: 잘못된 sustain(${bad})은 throw 해야 한다`,
    );
  }

  const critical = planningTasks(6);
  const at = (priorCriticalStreak, thresholds = CONVERGENCE_DEFAULTS.debt) => openPlanDebtPressure(
    critical, thresholds, { ...debtOpts, priorCriticalStreak },
  );
  assert.equal(at(0).level, 'soft', 'C3: 첫 평가는 soft');
  assert.equal(at(0).criticalStreak, 1, 'C3: streak 1');
  assert.equal(at(1).level, 'soft', 'C3: 두 번째도 soft');
  assert.equal(at(1).criticalStreak, 2, 'C3: streak 2');
  assert.equal(at(2).level, 'hard', 'C3: sustain(3) 연속이면 hard 로 승격한다');
  assert.equal(at(2).criticalStreak, 3, 'C3: streak 3');

  const sustain2 = { ...CONVERGENCE_DEFAULTS.debt, sustain: 2 };
  assert.equal(at(0, sustain2).level, 'soft', 'C4: sustain=2 의 첫 평가는 여전히 soft');
  assert.equal(at(1, sustain2).level, 'hard', 'C4: sustain=2 면 2연속에서 hard');

  // 리셋 — 부채가 임계 아래로 내려가면 streak 은 0 이 된다(누적 처벌 금지).
  const recovered = openPlanDebtPressure(planningTasks(3), CONVERGENCE_DEFAULTS.debt, { ...debtOpts, priorCriticalStreak: 5 });
  assert.equal(recovered.level, 'none', 'C5: 임계 아래면 미발화');
  assert.equal(recovered.criticalStreak, 0, 'C5: streak 이 리셋된다');
  assert.equal(recovered.critical, false, 'C5: critical=false');

  // executable 이 생겨 비율이 내려가도 리셋된다.
  const withEvidence = openPlanDebtPressure(
    [...planningTasks(5), runnableVerifiable, { ...runnableVerifiable, id: 'task-verifiable-2' }],
    CONVERGENCE_DEFAULTS.debt, { ...debtOpts, priorCriticalStreak: 9 },
  );
  assert.equal(withEvidence.criticalStreak, 0, 'C5: 증거가 생기면 streak 이 리셋된다');

  // soft 전 자유도 보존 — priorCriticalStreak 을 안 주면(첫 평가) 절대 hard 가 아니다.
  for (const n of [1, 5, 17, 40]) {
    assert.notEqual(openPlanDebtPressure(planningTasks(n), CONVERGENCE_DEFAULTS.debt, debtOpts).level, 'hard',
      `C6: 첫 평가(task ${n}개)는 아무리 부채가 커도 hard 가 아니다`);
  }
}

// ============ D/E 통합 — fake adapter 로 실제 런을 돌린다 =========================================
function makeFake(envVar) {
  const fakePath = join(tempRoot, `fake-${envVar}.mjs`);
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('--version')) { console.log('openclaw fake debt axis'); process.exit(0); }
const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const workDir = process.env.${envVar};
const promptDir = join(workDir, 'fake-prompts');
mkdirSync(promptDir, { recursive: true });
writeFileSync(join(promptDir, String(readdirSync(promptDir).length + 1).padStart(3, '0') + '.txt'), prompt, 'utf8');

const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
if (childTaskGroupId && versionId) {
  const now = '2026-08-05T00:00:00.000Z';
  const groupDir = join(workDir, 'task-groups', childTaskGroupId);
  const versionDir = join(groupDir, 'versions', versionId);
  const childTaskId = 'task-spawned-' + versionId;
  mkdirSync(join(versionDir, 'tasks'), { recursive: true });
  mkdirSync(join(versionDir, 'eow'), { recursive: true });
  writeFileSync(join(groupDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroup','id: ' + childTaskGroupId,'objective: Child group','createdAt: ' + now,'status: active','activeVersionId: ' + versionId,'---','# ' + childTaskGroupId,''].join('\\n'), 'utf8');
  writeFileSync(join(versionDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroupVersion','id: ' + versionId,'taskGroupId: ' + childTaskGroupId,'version: v1','summary: Child version','createdAt: ' + now,'status: active','---','# Child version',''].join('\\n'), 'utf8');
  writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- fake\\n', 'utf8');
  // 자식도 계획만 요구한다 = 부채는 줄지 않는다(3차 ALE 병리 재현).
  writeFileSync(join(versionDir, 'tasks', childTaskId + '.md'), ['---','taskOpsVersion: v1','entityType: task','id: ' + childTaskId,'taskGroupId: ' + childTaskGroupId,'taskGroupVersionId: ' + versionId,'title: Spawned','objective: Spawned child that still needs planning.','responsibility: Keep the divergence cycle going.','completionCriteria: More planning.','order: 1','createdAt: ' + now,'status: pending','runReadiness: needs_decomposition','uncertaintyState: known_unknown','expectedPlan:','  expectedDepth: 1','  expectedBreadth: 1','  rationale: Spawned child plan.','---','# Spawned',''].join('\\n'), 'utf8');
  console.log('decomposition authored');
  process.exit(0);
}
console.log(JSON.stringify({ executorSummary: 'executed', observed: { outcomeSummary: 'the required check was run' } }));
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function exec(workDir, options = {}) {
  const envVar = `TASKOPS_DEBT_AXIS_${workDir.replace(/[^A-Za-z0-9]/g, '_').toUpperCase().slice(-40)}`;
  const fake = makeFake(envVar);
  const prev = process.env.TASKOPS_OPENCLAW_BIN;
  process.env.TASKOPS_OPENCLAW_BIN = fake;
  process.env[envVar] = workDir;
  let runResult = null; let thrown = null;
  try {
    runResult = runTaskOps(workDir, { executor: 'openclaw-agent', agent: 'main', timeout: 30, continueOnFailure: true, ...options });
  } catch (err) { thrown = err; }
  if (prev == null) delete process.env.TASKOPS_OPENCLAW_BIN; else process.env.TASKOPS_OPENCLAW_BIN = prev;
  delete process.env[envVar];
  return { runResult, thrown };
}

function readEvents(workDir, runId) {
  return readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8')
    .trim().split(/\n+/).filter(Boolean).map((l) => JSON.parse(l));
}

function allTaskFiles(workDir) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) out.push([p, readFileSync(p, 'utf8')]);
    }
  };
  walk(join(workDir, 'task-groups'));
  return out;
}

function makeDebtWork(plannerCount = 6) {
  const id = `debt-run-${seq += 1}`;
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Verify the debt axis.', '--language', 'en']);
  const tasks = Array.from({ length: plannerCount }, (_, i) => ({
    id: `task-planner-${i + 1}`,
    title: `Planner ${i + 1}`,
    objective: 'Keep asking for more decomposition instead of producing evidence.',
    responsibility: 'Divergence probe.',
    completionCriteria: 'A child group exists.',
    order: i + 1,
    status: 'pending',
    runReadiness: 'needs_decomposition',
    uncertaintyState: 'known_unknown',
    confidenceScore: 0.4,
    decompositionConfidence: 0.85,
    expectedPlan: { expectedDepth: 2, expectedBreadth: 2, rationale: 'Debt fixture.' },
  }));
  const specPath = join(tempRoot, `${id}-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2', version: 'v2', summary: 'Debt axis fixture', selected: true, tasks,
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  mkdirSync(join(workDir, 'fake-prompts'), { recursive: true });
  return workDir;
}

// D. debt 단독 hard: 승격은 하되 런을 죽이지 않는다.
{
  const workDir = makeDebtWork(6);
  const { runResult, thrown } = exec(workDir, {
    maxSteps: 6,
    maxStepsExplicit: true,
    // 예산축·깊이축을 침묵시켜 **debt 축만** 발화하게 한다.
    convergence: { budget: { soft: 0.98, hard: 0.99 }, depth: { enabled: false }, debt: { count: 5, ratio: 0.8, sustain: 2 } },
  });
  if (thrown) throw thrown;
  const events = readEvents(workDir, runResult.runId);
  const pressures = events.filter((e) => e.type === 'convergence_pressure');
  const debtHard = pressures.filter((e) => e.level === 'hard'
    && Array.isArray(e.firedAxes) && e.firedAxes.length === 1 && e.firedAxes[0] === 'debt');
  assert.equal(debtHard.length >= 1, true,
    `D1: debt 축 단독으로 hard 가 발화해야 한다 (관측된 pressure: ${JSON.stringify(pressures.map((e) => [e.level, e.firedAxes]))})`);
  assert.equal(runResult.stopReason === 'convergence_blocked', false,
    `D2: debt 단독 hard 는 런을 죽이면 안 된다 (stopReason=${runResult.stopReason})`);
  assert.equal(events.filter((e) => e.type === 'convergence_blocked').length, 0,
    'D2: convergence_blocked 이벤트가 없어야 한다');
  assert.equal(events.filter((e) => e.type === 'convergence_debt_hard_planning_continued').length >= 1, true,
    'D3: 부채 단독 hard 에서 계획을 계속했다는 사실이 이벤트로 남아야 한다');

  // hard 발화 뒤에도 스텝이 계속 dispatch 되었는가.
  const firstHardIndex = events.findIndex((e) => e.type === 'convergence_pressure' && e.level === 'hard');
  const dispatchAfterHard = events.slice(firstHardIndex + 1)
    .some((e) => e.type === 'convergence_pressure' || e.type === 'decomposition_quality_evaluated');
  assert.equal(dispatchAfterHard, true, 'D4: hard 발화 뒤에도 런이 계속되어야 한다(조기종료 금지)');
  assert.equal(runResult.convergence.hardFires >= 1, true, 'D6: runResult 가 hard 발화를 계측해야 한다');

  // 거짓 완료 금지 — 검증 가능한 task 가 하나도 없는 런에서 hard 압력이 실행을 날조하면 안 된다.
  assert.equal(runResult.actions.filter((a) => a.kind === 'execute').length, 0,
    'D5: 검증가능 acceptance 가 없는데 execute 를 만들어내면 안 된다');
  for (const [path, text] of allTaskFiles(workDir)) {
    assert.equal(/^runReadiness: runnable$/m.test(text), false,
      `D5: 게이트가 task readiness 를 runnable 로 상향하면 안 된다 (${path})`);
    assert.equal(/^uncertaintyState: known$/m.test(text), false,
      `D5: 게이트가 uncertaintyState 를 known 으로 상향하면 안 된다 (${path})`);
  }

  // E4. 런루프→프롬프트 배선: 실제 분해 프롬프트에 부채 수치가 실려 나갔는가.
  const prompts = readdirSync(join(workDir, 'fake-prompts')).sort()
    .map((f) => readFileSync(join(workDir, 'fake-prompts', f), 'utf8'));
  const withDebt = prompts.filter((p) => p.includes('미집행 계획 부채 실측'));
  assert.equal(withDebt.length >= 1, true,
    `E4: 실제 dispatch 된 프롬프트에 부채 실측이 실려야 한다 (프롬프트 ${prompts.length}건)`);
  assert.equal(/열린 계획 task \d+개/.test(withDebt[0]), true, 'E4: 부채 수치(열린 계획 task 수)가 들어가야 한다');
}

// E. 프롬프트 계약(단위).
{
  const project = { id: 'debt-prompt', title: 'Debt prompt', objective: '부채 피드백 계약' };
  const task = {
    id: 'task-debt-prompt', title: 'Debt prompt task', objective: '검증 가능한 자식으로 분해한다.',
    responsibility: 'prompt 계약 검증', completionCriteria: '단계별 지시를 반환한다.',
    uncertaintyState: 'known_unknown', confidenceScore: 0.5,
    expectedPlan: { expectedDepth: 2, expectedBreadth: 3, rationale: '두 단계 fixture.' },
  };
  const decomposition = (convergence) => buildAgentDecompositionPrompt({
    project, projectDir: process.cwd(), task,
    childTaskGroupId: 'tg-debt-child', versionId: 'tgv-debt-child-v1',
    budget: null, convergence,
  });
  const exploration = (convergence) => buildAgentExplorationPrompt({
    project, task, runId: 'run-debt', runNodeId: 'rn-debt',
    artifactPath: join(tmpdir(), 'taskops-debt-exploration.md'), budget: null, convergence,
  });

  const debtSummary = { level: 'soft', planDebt: 17, blockedDebt: 4, executable: 0, debtRatio: 1, criticalStreak: 1, sustain: 3 };
  // novelty 로 통과하는 상황(soft)이라도 수치는 전달되어야 한다.
  const softDebt = { level: 'soft', firedAxes: ['debt'], debt: debtSummary, extensionWindowOpen: false, grantsRemaining: 0 };
  for (const [name, build] of [['decompose', decomposition], ['explore', exploration]]) {
    const prompt = build(softDebt);
    assert.equal(prompt.includes('미집행 계획 부채 실측'), true, `E1/E2(${name}): 부채 실측 문구가 있어야 한다`);
    assert.equal(prompt.includes('17'), true, `E1/E2(${name}): planDebt 수치가 있어야 한다`);
    assert.equal(prompt.includes('4'), true, `E1/E2(${name}): blockedDebt 수치가 있어야 한다`);
    assert.equal(/즉시 실행 가능/.test(prompt), true, `E1/E2(${name}): 실행 가능의 정의를 알려줘야 한다`);
  }

  // 불변식: 축이 미발화면 프롬프트는 convergence=null 과 바이트 단위로 같아야 한다.
  for (const [name, build] of [['decompose', decomposition], ['explore', exploration]]) {
    assert.equal(
      build({ level: 'none', firedAxes: [], debt: null, extensionWindowOpen: true, grantsRemaining: 2 }),
      build(null),
      `E3(${name}): level=none 은 convergence=null 과 동일해야 한다`,
    );
  }
}

console.log('convergence-debt-axis smoke passed');
