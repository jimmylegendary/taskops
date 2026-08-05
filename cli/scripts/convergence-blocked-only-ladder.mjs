#!/usr/bin/env node
// 라운드 E — blocked_only 종료 **전에** hard 사다리를 한 번 태운다.
//
// 실측 배경(1~4차 ALE): 런루프는 (1) 후보를 수집해 비면 blocked_only 로 즉시 break 하고,
// (2) 수렴 게이트는 next 가 있을 때만 적용됐다. 그래서 "실행할 게 없다" 가 hard 사다리보다 먼저 이겨
// tier-2(분해로 done 소비된 부모의 지연 acceptance 되살리기)는 **한 번도 실행된 적이 없었다**.
//
// 이 테스트는 소스 토큰이 아니라 실제 dispatch / task frontmatter / events.jsonl / runner 가 쓴
// checkResults 를 검증한다. 기능을 지우면(사다리 호출 제거) 반드시 실패해야 한다.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile } from '../lib-taskops.js';
import { CONVERGENCE_DEFAULTS, openPlanDebtPressure } from '../lib-convergence.js';
import * as runner from '../lib-runner.js';

const { runTaskOps } = runner;
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(scriptDir, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-convergence-blocked-only-ladder-'));
const passingParentCheck = 'node -e "process.exit(0)"';
const failingParentCheck = 'node -e "process.exit(9)"';
let fixtureSeq = 0;

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: process.env });
  if (result.status !== 0) {
    throw new Error('taskops ' + args.join(' ') + ' failed\nSTDOUT:\n' + result.stdout + '\nSTDERR:\n' + result.stderr);
  }
  return result.stdout;
}

function taskPath(workDir, groupId, versionId, taskId) {
  return join(workDir, 'task-groups', groupId, 'versions', versionId, 'tasks', taskId + '.md');
}

const parentTaskPath = (workDir) => taskPath(workDir, 'tg-root', 'tgv-root-v2', 'task-parent');
const childTaskPath = (workDir) => taskPath(workDir, 'tg-parent', 'tgv-parent-v1', 'task-child');

function readEvents(workDir, runId) {
  return readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8')
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const eventsOfType = (events, type) => events.filter((event) => event.type === type);

function executeRunNodeFor(workDir, runId, taskId) {
  const nodesDir = join(workDir, 'runs', runId, 'nodes');
  return readdirSync(nodesDir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('eow-'))
    .map((name) => { try { return parseMarkdownFile(join(nodesDir, name)); } catch { return null; } })
    .filter(Boolean)
    .find((node) => node.sourceTaskId === taskId && node.actionKind === 'execute');
}

// 픽스처: 루트에 **검증 가능한 acceptance 를 가진 부모 하나만** 둔다.
// 1스텝: 부모가 분해되어 done 으로 소비되고 convergenceDeferredAcceptance 가 스탬프된다.
// 그 분해가 만드는 유일한 자식은 blocked 라서, 2스텝의 후보 수집은 반드시 비어 blocked_only 가 된다.
function makeWork({ parentCheck = passingParentCheck } = {}) {
  fixtureSeq += 1;
  const id = 'round-e-' + fixtureSeq;
  const workDir = join(tempRoot, id);
  runCli(['init', workDir, '--id', id, '--title', id, '--objective', 'blocked_only 앞에서 hard 사다리를 태운다.', '--language', 'ko']);

  const tasks = [{
    id: 'task-parent',
    title: '검증을 가진 분해 부모',
    objective: '자식이 전부 막혀도 부모의 독립 체크로 증거를 만든다.',
    responsibility: '부모 acceptance 하강 계약을 보존한다.',
    completionCriteria: '부모 requiredChecks 가 runner 검증을 통과한다.',
    expectedResult: '필수 체크가 runner 검증으로 통과한다.',
    order: 1,
    status: 'pending',
    runReadiness: 'needs_decomposition',
    uncertaintyState: 'known_unknown',
    confidenceScore: 0.8,
    decompositionConfidence: 0.9,
    expectedPlan: { expectedDepth: 1, expectedBreadth: 1, rationale: '부모를 한 단계 자식으로 분해한다.' },
    acceptance: {
      mode: 'guarded',
      expectedOutcome: '필수 체크가 runner 검증으로 통과한다.',
      requiredChecks: [parentCheck],
    },
  }];

  const specPath = join(tempRoot, id + '-root-spec.json');
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: '라운드 E blocked_only 사다리 픽스처',
    selected: true,
    tasks,
  }), 'utf8');
  runCli(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function makeFakeExecutor() {
  const fakePath = join(tempRoot, 'fake-openclaw-round-e.mjs');
  const source = [
    '#!/usr/bin/env node',
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "if (process.argv.includes('--version')) { console.log('openclaw fake round E'); process.exit(0); }",
    "const args = process.argv.slice(2);",
    "const messageIndex = args.indexOf('--message');",
    "const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';",
    "const workDir = process.env.TASKOPS_ROUND_E_WORK_DIR;",
    "const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();",
    "const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();",
    'if (childTaskGroupId && versionId) {',
    "  const now = '2026-07-30T00:00:00.000Z';",
    "  const groupDir = join(workDir, 'task-groups', childTaskGroupId);",
    "  const versionDir = join(groupDir, 'versions', versionId);",
    "  mkdirSync(join(versionDir, 'tasks'), { recursive: true });",
    "  mkdirSync(join(versionDir, 'eow'), { recursive: true });",
    "  writeFileSync(join(groupDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroup','id: ' + childTaskGroupId,'objective: 막힌 자식 그룹','createdAt: ' + now,'status: active','activeVersionId: ' + versionId,'---','# ' + childTaskGroupId,''].join('\\n'), 'utf8');",
    "  writeFileSync(join(versionDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroupVersion','id: ' + versionId,'taskGroupId: ' + childTaskGroupId,'version: v1','summary: 라운드 E 자식 버전','createdAt: ' + now,'status: active','---','# 라운드 E 자식 버전',''].join('\\n'), 'utf8');",
    "  writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- round E fake\\n', 'utf8');",
    // 자식은 외부 사정으로 막혀 있다 — 후보 수집이 비게 만드는 유일한 장치다(blockedBy 좀비 마커는 쓰지 않는다).
    "  writeFileSync(join(versionDir, 'tasks', 'task-child.md'), ['---','taskOpsVersion: v1','entityType: task','id: task-child','taskGroupId: ' + childTaskGroupId,'taskGroupVersionId: ' + versionId,'title: 막힌 분해 자식','objective: 외부 사정으로 지금은 진행할 수 없다.','responsibility: 자식 범위만 담당한다.','completionCriteria: 외부 차단이 풀리면 종단된다.','order: 1','createdAt: ' + now,'status: blocked','runReadiness: blocked','runReadinessReason: 픽스처 외부 차단.','blockedReason: fixture_external_block','expectedPlan:','  expectedDepth: 0','  expectedBreadth: 1','  rationale: 막힌 리프다.','---','# 막힌 자식',''].join('\\n'), 'utf8');",
    "  console.log('decomposition authored');",
    '  process.exit(0);',
    '}',
    "console.log(JSON.stringify({ executorSummary: '부모 범위를 통째로 실행했다', observed: { outcomeSummary: '필수 체크가 runner 검증으로 통과한다.' } }));",
    '',
  ].join('\n');
  writeFileSync(fakePath, source, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

const fakeExecutorPath = makeFakeExecutor();

function executeRunner(workDir, options = {}) {
  const previousBin = process.env.TASKOPS_OPENCLAW_BIN;
  const previousWorkDir = process.env.TASKOPS_ROUND_E_WORK_DIR;
  process.env.TASKOPS_OPENCLAW_BIN = fakeExecutorPath;
  process.env.TASKOPS_ROUND_E_WORK_DIR = workDir;
  try {
    return runTaskOps(workDir, {
      executor: 'openclaw-agent',
      agent: 'main',
      timeout: 30,
      maxSteps: 4,
      maxStepsExplicit: true,
      // 예산·깊이·부채 축은 전부 비활성이다. 따라서 아래에서 관측되는 강제 실행은
      // **오직 blocked_only 사다리**만이 만들 수 있다(통상 압력 경로의 부수효과가 아니다).
      convergence: {
        mode: 'enforce',
        budget: { soft: 0.95, hard: 0.99 },
        depth: { enabled: false },
        debt: { count: 999, ratio: 1 },
      },
      ...options,
    });
  } finally {
    if (previousBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
    else process.env.TASKOPS_OPENCLAW_BIN = previousBin;
    if (previousWorkDir == null) delete process.env.TASKOPS_ROUND_E_WORK_DIR;
    else process.env.TASKOPS_ROUND_E_WORK_DIR = previousWorkDir;
  }
}

try {
  // ---- 1. 본 사례: 후보가 비어도 blocked_only 로 즉사하지 않고 tier-2 부모를 되살려 실행한다. -----------
  const work = makeWork();
  const result = executeRunner(work);

  assert.deepEqual(
    result.actions.map((action) => action.kind),
    ['decompose', 'execute'],
    'blocked_only 직전에 사다리가 실행 후보를 만들어야 한다(1~4차에서는 decompose 하나로 끝났다).',
  );
  assert.equal(result.actions[1].taskId, 'task-parent', '사다리는 분해로 소비된 검증 가능한 부모를 되살려야 한다.');
  assert.equal(result.actions[1].status, 'completed', '되살린 부모 실행은 runner 검증까지 통과해야 한다.');

  const events = readEvents(work, result.runId);
  const ladderEvents = eventsOfType(events, 'convergence_blocked_only_ladder');
  assert.ok(ladderEvents.length >= 1, 'blocked_only 앞에서 사다리 발화 이벤트를 남겨야 한다.');
  assert.equal(ladderEvents[0].stopReasonDeferred, 'blocked_only', '사다리는 어떤 종료를 유예했는지 기록해야 한다.');

  const forced = eventsOfType(events, 'convergence_forced_execute')
    .filter((event) => event.reason === 'blocked_only_ladder');
  assert.equal(forced.length, 1, '사다리 강제 실행은 감사 가능한 forced_execute 이벤트로 남아야 한다.');
  assert.equal(forced[0].taskId, 'task-parent', 'forced_execute 는 되살린 부모를 가리켜야 한다.');
  assert.equal(forced[0].level, 'hard', '사다리는 hard 등급으로 발화해야 한다.');

  const reverify = eventsOfType(events, 'convergence_deferred_acceptance_reverify');
  assert.equal(reverify.length, 1, 'tier-2 되살리기(폴백B 급소)가 실제로 실행되어야 한다.');
  assert.equal(reverify[0].taskId, 'task-parent', 'reverify 이벤트는 되살린 부모를 가리켜야 한다.');

  // 사다리가 후보를 다 쓴 뒤에는 정직하게 blocked_only 로 끝난다(억지 후보 생성 금지).
  assert.equal(result.stopReason, 'blocked_only', '사다리 소진 후에는 정직하게 blocked_only 로 끝나야 한다.');
  assert.ok(
    eventsOfType(events, 'convergence_blocked_only_ladder_exhausted').length >= 1,
    '후보가 없으면 소진 이벤트를 남기고 정직하게 종료해야 한다.',
  );
  assert.ok(
    result.convergence?.blockedOnlyLadder?.attempts >= 2,
    '사다리 시도 횟수가 런 통계에 노출되어야 한다.',
  );
  assert.equal(result.convergence.blockedOnlyLadder.forcedExecutes, 1, '사다리 강제 실행 횟수가 집계되어야 한다.');

  // 무한 루프 금지 — 사다리는 런당 제한된 횟수만 발화한다.
  assert.ok(
    result.convergence.blockedOnlyLadder.attempts <= runner.BLOCKED_ONLY_LADDER_MAX_ATTEMPTS,
    '사다리는 런당 상한을 절대 넘지 않아야 한다.',
  );

  // 거짓 완료 금지 — 되살린 부모는 runner 가 실제로 돌린 체크 결과로만 닫힌다.
  const parent = parseMarkdownFile(parentTaskPath(work));
  assert.equal(parent.status, 'done', '체크가 통과했으므로 되살린 부모는 done 이어야 한다.');
  assert.ok(String(parent.convergenceDeferredAcceptance?.reverifiedAt || '').trim(), '재검증 스탬프가 남아야 한다.');
  const runNode = executeRunNodeFor(work, result.runId, 'task-parent');
  assert.ok(runNode, '되살린 부모의 execute run node 가 있어야 한다.');
  const checkResults = runNode.result?.observed?.checkResults || [];
  assert.equal(checkResults.length, 1, 'runner 가 부모의 지연 체크를 실제로 실행해야 한다.');
  assert.equal(checkResults[0].command, passingParentCheck, '실행된 체크는 지연된 부모 체크여야 한다.');
  assert.equal(checkResults[0].status, 'passed', '통과 판정은 실제 실행 결과여야 한다.');
  assert.equal(checkResults[0].verifiedBy, 'runner', '자기보고가 아니라 runner 검증이어야 한다.');

  // 막힌 자식을 사다리가 억지로 실행하거나 닫으면 안 된다.
  assert.equal(parseMarkdownFile(childTaskPath(work)).status, 'blocked', '사다리는 막힌 자식을 건드리면 안 된다.');

  // ---- 2. 거짓 완료 방화벽: 되살린 부모의 체크가 실패하면 절대 done 이 되면 안 된다. -------------------
  const failWork = makeWork({ parentCheck: failingParentCheck });
  const failResult = executeRunner(failWork);
  const failForced = eventsOfType(readEvents(failWork, failResult.runId), 'convergence_forced_execute')
    .filter((event) => event.reason === 'blocked_only_ladder');
  assert.equal(failForced.length, 1, '체크가 실패할 예정이어도 사다리는 동일하게 발화해야 한다.');
  const failedParent = parseMarkdownFile(parentTaskPath(failWork));
  assert.notEqual(failedParent.status, 'done', '실패한 체크로 부모를 done 으로 닫으면 거짓 완료다.');
  assert.notEqual(failResult.stopReason, 'all_closed', '실패를 all_closed 로 덮으면 안 된다.');

  // ---- 3. 음성 대조: observe 모드에서는 사다리가 절대 발화하지 않는다(자유도 보존). ------------------
  const observeWork = makeWork();
  const observeResult = executeRunner(observeWork, {
    convergence: {
      mode: 'observe',
      budget: { soft: 0.95, hard: 0.99 },
      depth: { enabled: false },
      debt: { count: 999, ratio: 1 },
    },
  });
  assert.deepEqual(
    observeResult.actions.map((action) => action.kind),
    ['decompose'],
    'observe 모드는 사다리를 태우지 않는다.',
  );
  assert.equal(observeResult.stopReason, 'blocked_only', 'observe 모드는 기존 blocked_only 계약을 그대로 유지한다.');
  const observeEvents = readEvents(observeWork, observeResult.runId);
  assert.equal(eventsOfType(observeEvents, 'convergence_blocked_only_ladder').length, 0, 'observe 모드에서 사다리 이벤트가 있으면 안 된다.');
  const observeParent = parseMarkdownFile(parentTaskPath(observeWork));
  assert.equal(observeParent.status, 'done', 'observe 모드는 부모 파일을 되살리면 안 된다.');
  assert.equal(String(observeParent.convergenceDeferredAcceptance?.reverifiedAt || '').trim(), '', 'observe 모드는 재검증 스탬프를 남기면 안 된다.');

  // ---- 3b. 사다리 자체가 실패해도 런은 죽지 않고 원래의 정직한 종료로 되돌아간다. --------------------
  // 실제 실패를 주입한다: tier-2 되살리기는 부모 frontmatter 를 써야 하는데, 그 디렉터리를 읽기 전용으로
  // 만들면 원자적 쓰기가 EACCES 로 터진다(가짜 스텁이 아니라 진짜 I/O 실패다).
  if (process.getuid && process.getuid() !== 0) {
    const crashWork = makeWork();
    const firstStep = executeRunner(crashWork, { maxSteps: 1 });
    assert.deepEqual(firstStep.actions.map((action) => action.kind), ['decompose'], '주입 전 준비 스텝은 분해여야 한다.');
    const rootTasksDir = join(crashWork, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks');
    chmodSync(rootTasksDir, 0o555);
    let crashResult;
    try {
      crashResult = executeRunner(crashWork);
    } finally {
      chmodSync(rootTasksDir, 0o755);
    }
    assert.equal(crashResult.stopReason, 'blocked_only', '사다리가 터져도 런은 원래의 정직한 종료로 끝나야 한다.');
    assert.equal(crashResult.convergence.blockedOnlyLadder.errors >= 1, true, '사다리 실패는 집계되어야 한다.');
    const crashEvents = readEvents(crashWork, crashResult.runId);
    assert.ok(
      eventsOfType(crashEvents, 'convergence_blocked_only_ladder_error').length >= 1,
      '사다리 실패는 감사 가능한 이벤트로 남아야 한다(조용히 삼키면 안 된다).',
    );
    assert.equal(parseMarkdownFile(parentTaskPath(crashWork)).status, 'done', '실패한 사다리가 부모 상태를 훼손하면 안 된다.');
  }

  // ---- 4. debt hard 임계 도달성: 4스텝 런에서 sustain=3 이 실제로 도달 가능한지 상수 변경 없이 증명한다. --
  // 게이트는 dispatch 마다 한 번 평가되므로 4스텝 런은 평가를 4회 한다. 아래가 참이면 임계를 낮출 이유가 없다
  // (낮추면 soft 전 자유도, 즉 초기 넓은 분해가 죽는다).
  const debtTasks = Array.from({ length: 6 }, (_, index) => ({
    id: 'debt-' + (index + 1),
    status: 'pending',
    runReadiness: 'needs_decomposition',
  }));
  const debtLevels = [];
  let streak = 0;
  for (let step = 0; step < 4; step += 1) {
    const axis = openPlanDebtPressure(debtTasks, CONVERGENCE_DEFAULTS.debt, {
      hasVerifiableAcceptance: () => false,
      priorCriticalStreak: streak,
    });
    streak = axis.criticalStreak;
    debtLevels.push(axis.level);
  }
  assert.deepEqual(
    debtLevels,
    ['soft', 'soft', 'hard', 'hard'],
    'sustain=3 은 4스텝 런의 3번째 평가에서 hard 에 도달한다 — 임계를 낮출 근거가 없다.',
  );
  assert.notEqual(debtLevels[0], 'hard', '첫 평가는 절대 hard 가 아니어야 한다(soft 전 자유도 보존).');
  assert.equal(CONVERGENCE_DEFAULTS.debt.sustain, 3, 'sustain 기본값은 3으로 유지한다(도달 가능성이 실측으로 증명됐다).');

  console.log('OK convergence blocked_only ladder (hard ladder fires before honest blocked_only)');
} finally {
  // tempRoot 는 진단을 위해 남긴다(다른 수렴 테스트와 동일한 관행).
}
