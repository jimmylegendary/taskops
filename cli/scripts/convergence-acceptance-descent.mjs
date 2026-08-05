#!/usr/bin/env node
// 라운드 C — 분해로 부모 acceptance 를 소진하지 못하게 하는 기록(R2) + hard 지연 재검증(R3).
// 소스 토큰이 아니라 실제 task frontmatter, events.jsonl, dispatch, runner-authored checkResults 를 검증한다.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile, parseProject } from '../lib-taskops.js';
import * as runner from '../lib-runner.js';

const { closeTarget, runTaskOps } = runner;
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(scriptDir, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-convergence-acceptance-descent-'));
const failingParentCheck = 'node -e "process.exit(9)"';
const passingTierOneCheck = 'node -e "process.exit(0)"';
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

function parentTaskPath(workDir) {
  return taskPath(workDir, 'tg-root', 'tgv-root-v2', 'task-parent');
}

function childTaskPath(workDir) {
  return taskPath(workDir, 'tg-parent', 'tgv-parent-v1', 'task-child');
}

function readEvents(workDir, runId) {
  return readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8')
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function eventsOfType(events, type) {
  return events.filter((event) => event.type === type);
}

function activeSnapshotFor(parsed) {
  return parsed.snapshots.get(parsed.project.activeSnapshotId) || null;
}

function makeWork({ tierOne = false, parentCheck = failingParentCheck } = {}) {
  fixtureSeq += 1;
  const id = 'round-c-' + fixtureSeq;
  const workDir = join(tempRoot, id);
  runCli(['init', workDir, '--id', id, '--title', id, '--objective', '분해 뒤에도 부모 acceptance 를 검증한다.', '--language', 'ko']);

  const tasks = [
    {
      id: 'task-parent',
      title: '검증을 가진 분해 부모',
      objective: '자식 분해 뒤 부모의 독립 체크를 실행한다.',
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
    },
    {
      id: 'task-pressure',
      title: 'hard 압력 발화용 계획 task',
      objective: 'hard 압력에서 실행 후보 선택을 요청한다.',
      responsibility: '계획 action 을 제공한다.',
      completionCriteria: '후보 선택기가 실행 task 로 대체한다.',
      order: 2,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      uncertaintyState: 'known_unknown',
      confidenceScore: 0.4,
      decompositionConfidence: 0.9,
      expectedPlan: { expectedDepth: 1, expectedBreadth: 1, rationale: 'hard 압력 전까지 계획 후보로 남는다.' },
    },
  ];
  if (tierOne) {
    tasks.push({
      id: 'task-tier-one',
      title: '열린 검증 가능 tier-1 task',
      objective: '지연 부모보다 먼저 실행된다.',
      responsibility: 'tier-1 우선순위를 증명한다.',
      completionCriteria: '필수 체크가 runner 검증으로 통과한다.',
      expectedResult: '필수 체크가 runner 검증으로 통과한다.',
      order: 3,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      uncertaintyState: 'known_unknown',
      confidenceScore: 0.9,
      decompositionConfidence: 0.8,
      expectedPlan: { expectedDepth: 1, expectedBreadth: 1, rationale: '열린 검증 가능 후보다.' },
      acceptance: {
        mode: 'guarded',
        expectedOutcome: '필수 체크가 runner 검증으로 통과한다.',
        requiredChecks: [passingTierOneCheck],
      },
    });
  }

  const specPath = join(tempRoot, id + '-root-spec.json');
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: '라운드 C acceptance 하강 픽스처',
    selected: true,
    tasks,
  }), 'utf8');
  runCli(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function makeFakeExecutor() {
  const fakePath = join(tempRoot, 'fake-openclaw-round-c.mjs');
  const fakeSource = [
    '#!/usr/bin/env node',
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "if (process.argv.includes('--version')) { console.log('openclaw fake round C'); process.exit(0); }",
    "const args = process.argv.slice(2);",
    "const messageIndex = args.indexOf('--message');",
    "const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';",
    "const workDir = process.env.TASKOPS_ROUND_C_WORK_DIR;",
    "const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();",
    "const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();",
    "if (childTaskGroupId && versionId) {",
    "  const now = '2026-07-30T00:00:00.000Z';",
    "  const groupDir = join(workDir, 'task-groups', childTaskGroupId);",
    "  const versionDir = join(groupDir, 'versions', versionId);",
    "  mkdirSync(join(versionDir, 'tasks'), { recursive: true });",
    "  mkdirSync(join(versionDir, 'eow'), { recursive: true });",
    "  writeFileSync(join(groupDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroup','id: ' + childTaskGroupId,'objective: 부모 acceptance 하강 자식 그룹','createdAt: ' + now,'status: active','activeVersionId: ' + versionId,'---','# ' + childTaskGroupId,''].join('\\n'), 'utf8');",
    "  writeFileSync(join(versionDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroupVersion','id: ' + versionId,'taskGroupId: ' + childTaskGroupId,'version: v1','summary: 라운드 C 자식 버전','createdAt: ' + now,'status: active','---','# 라운드 C 자식 버전',''].join('\\n'), 'utf8');",
    "  writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- round C fake\\n', 'utf8');",
    "  const childLines = ['---','taskOpsVersion: v1','entityType: task','id: task-child','taskGroupId: ' + childTaskGroupId,'taskGroupVersionId: ' + versionId,'title: 분해 자식','objective: 부모 분해의 자식 산출물을 만든다.','responsibility: 자식 범위만 담당한다.','completionCriteria: 자식 범위가 종단된다.','expectedResult: 자식 범위 산출물','order: 1','createdAt: ' + now,'status: pending','runReadiness: runnable','uncertaintyState: known','confidenceScore: 0.9','decompositionConfidence: 0.1','expectedPlan:','  expectedDepth: 0','  expectedBreadth: 1','  rationale: 이미 실행 가능한 리프다.'];",
    "  const coveredCheck = process.env.TASKOPS_ROUND_C_CHILD_CHECK || '';",
    "  if (coveredCheck) childLines.push('acceptance:','  mode: guarded','  expectedOutcome: 자식이 부모 체크를 명시적으로 인수한다.','  requiredChecks:','    - ' + JSON.stringify(coveredCheck));",
    "  childLines.push('---','# 분해 자식','');",
    "  writeFileSync(join(versionDir, 'tasks', 'task-child.md'), childLines.join('\\n'), 'utf8');",
    "  console.log('decomposition authored');",
    "  process.exit(0);",
    "}",
    "console.log(JSON.stringify({ executorSummary: '실행 완료', observed: { outcomeSummary: '필수 체크가 runner 검증으로 통과한다.' } }));",
    '',
  ].join('\n');
  writeFileSync(fakePath, fakeSource, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

const fakeExecutorPath = makeFakeExecutor();

function executeRunner(workDir, options = {}, { childCheck = '' } = {}) {
  const previousBin = process.env.TASKOPS_OPENCLAW_BIN;
  const previousWorkDir = process.env.TASKOPS_ROUND_C_WORK_DIR;
  const previousChildCheck = process.env.TASKOPS_ROUND_C_CHILD_CHECK;
  process.env.TASKOPS_OPENCLAW_BIN = fakeExecutorPath;
  process.env.TASKOPS_ROUND_C_WORK_DIR = workDir;
  if (childCheck) process.env.TASKOPS_ROUND_C_CHILD_CHECK = childCheck;
  else delete process.env.TASKOPS_ROUND_C_CHILD_CHECK;
  try {
    return runTaskOps(workDir, {
      executor: 'openclaw-agent',
      agent: 'main',
      timeout: 30,
      continueOnFailure: true,
      ...options,
    });
  } finally {
    if (previousBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
    else process.env.TASKOPS_OPENCLAW_BIN = previousBin;
    if (previousWorkDir == null) delete process.env.TASKOPS_ROUND_C_WORK_DIR;
    else process.env.TASKOPS_ROUND_C_WORK_DIR = previousWorkDir;
    if (previousChildCheck == null) delete process.env.TASKOPS_ROUND_C_CHILD_CHECK;
    else process.env.TASKOPS_ROUND_C_CHILD_CHECK = previousChildCheck;
  }
}

function decomposeOnce(workDir, { childCheck = '' } = {}) {
  const result = executeRunner(workDir, {
    maxSteps: 1,
    maxStepsExplicit: true,
    convergence: {
      mode: 'enforce',
      budget: { soft: 1, hard: 1 },
      depth: { enabled: false },
      debt: { count: 999, ratio: 1 },
    },
  }, { childCheck });
  assert.equal(result.actions.length, 1, '준비 단계는 정확히 한 action 이어야 한다.');
  assert.equal(result.actions[0].kind, 'decompose', '준비 단계는 부모를 분해해야 한다.');
  assert.equal(result.actions[0].taskId, 'task-parent', '분해 대상은 acceptance 를 가진 부모여야 한다.');
  return result;
}

function closeOnlyChild(workDir) {
  assert.equal(parseMarkdownFile(childTaskPath(workDir)).status, 'pending', '자식 종단 전 상태는 pending 이어야 한다.');
  closeTarget(workDir, 'task-child', { reason: 'manual_verified' });
  assert.equal(parseMarkdownFile(childTaskPath(workDir)).status, 'done', 'hard 재검증 전에 모든 자식이 종단되어야 한다.');
}

function executeRunNodeFor(workDir, runId, taskId) {
  const nodesDir = join(workDir, 'runs', runId, 'nodes');
  return readdirSync(nodesDir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('eow-'))
    .map((name) => {
      try { return parseMarkdownFile(join(nodesDir, name)); } catch { return null; }
    })
    .filter(Boolean)
    .find((node) => node.sourceTaskId === taskId && node.actionKind === 'execute');
}

function runHardReverify(workDir) {
  return executeRunner(workDir, {
    // 첫 step 은 pressure task 를 분해하고, 1/2 소진 시점의 두 번째 dispatch 에서 hard 를 발화한다.
    maxSteps: 2,
    maxStepsExplicit: true,
    convergence: {
      mode: 'enforce',
      budget: { soft: 0.5, hard: 0.5 },
      depth: { enabled: false },
      debt: { count: 999, ratio: 1 },
    },
  });
}

try {
  // 1. 미커버 분해: R2 기록은 남기되 부모 done 계약은 유지한다.
  const gapWork = makeWork();
  const gapRun = decomposeOnce(gapWork);
  const gapEvents = readEvents(gapWork, gapRun.runId);
  const descentGaps = eventsOfType(gapEvents, 'convergence_acceptance_descent_gap');
  assert.equal(descentGaps.length, 1, '부모 체크가 자식 union 에 없으면 descent gap 이벤트가 한 번 발화해야 한다.');
  assert.deepEqual(descentGaps[0].uncoveredChecks, [failingParentCheck], 'gap 이벤트는 미커버 부모 체크를 기록해야 한다.');
  assert.deepEqual(descentGaps[0].uncoveredArtifacts, [], '없는 부모 산출물을 gap 으로 날조하면 안 된다.');
  assert.equal(descentGaps[0].childTaskGroupId, 'tg-parent', 'gap 이벤트는 실제 자식 그룹을 가리켜야 한다.');
  assert.equal(descentGaps[0].level, 'none', '압력이 없는 분해에서도 R2 측정은 발화해야 한다.');

  const deferredParent = parseMarkdownFile(parentTaskPath(gapWork));
  assert.equal(deferredParent.status, 'done', '분해 성공 부모는 기존 계약대로 done 이어야 한다.');
  assert.deepEqual(deferredParent.convergenceDeferredAcceptance?.requiredChecks, [failingParentCheck], '부모 frontmatter 에 미커버 체크를 스탬프해야 한다.');
  assert.deepEqual(deferredParent.convergenceDeferredAcceptance?.requiredArtifacts, [], '부모 frontmatter 에 없는 산출물을 스탬프하면 안 된다.');
  assert.equal(deferredParent.convergenceDeferredAcceptance?.childTaskGroupId, 'tg-parent', '지연 스탬프는 실제 자식 그룹을 기록해야 한다.');
  assert.equal(Number.isNaN(Date.parse(deferredParent.convergenceDeferredAcceptance?.closedByDecompositionAt || '')), false, '지연 스탬프는 유효한 분해 종료 시각을 기록해야 한다.');

  // 4. 정당한 분해: 자식 union 이 부모 체크를 덮으면 gap 이벤트는 없지만 부모 acceptance 원장은 남는다.
  const coveredWork = makeWork();
  const coveredRun = decomposeOnce(coveredWork, { childCheck: failingParentCheck });
  const coveredEvents = readEvents(coveredWork, coveredRun.runId);
  assert.equal(eventsOfType(coveredEvents, 'convergence_acceptance_descent_gap').length, 0, '정당한 분해는 gap 이벤트를 만들면 안 된다.');
  const coveredParent = parseMarkdownFile(parentTaskPath(coveredWork));
  assert.ok(coveredParent.convergenceDeferredAcceptance, '자식 union 이 부모 체크를 덮어도 부모 acceptance 지연 원장은 남아야 한다.');
  assert.deepEqual(coveredParent.convergenceDeferredAcceptance.uncovered?.checks, [], '완전히 덮인 부모 체크의 uncovered 원장은 비어야 한다.');
  assert.deepEqual(coveredParent.convergenceDeferredAcceptance.uncovered?.artifacts, [], '완전히 덮인 부모 산출물의 uncovered 원장은 비어야 한다.');
  assert.deepEqual(coveredParent.convergenceDeferredAcceptance.requiredChecks, [], '하위호환 requiredChecks 키도 uncovered 값인 빈 배열이어야 한다.');
  assert.deepEqual(coveredParent.convergenceDeferredAcceptance.requiredArtifacts, [], '하위호환 requiredArtifacts 키도 uncovered 값인 빈 배열이어야 한다.');
  assert.deepEqual(coveredParent.convergenceDeferredAcceptance.full?.checks, [failingParentCheck], 'full 원장은 부모의 실제 체크를 보존해야 한다.');
  assert.deepEqual(coveredParent.convergenceDeferredAcceptance.full?.artifacts, [], '부모에 없는 산출물을 full 원장에 날조하면 안 된다.');
  assert.equal(coveredParent.status, 'done', '정당한 분해 부모도 기존 done 계약을 유지해야 한다.');

  // tier-2 공통 전제와 선택기 음성 대조.
  closeOnlyChild(gapWork);
  const parsedGap = parseProject(gapWork);
  assert.deepEqual(parsedGap.errors, [], 'tier-2 선택 전 픽스처 그래프는 유효해야 한다.');
  const selectForcedExecutionCandidate = runner.selectForcedExecutionCandidate;
  assert.equal(typeof selectForcedExecutionCandidate, 'function', 'selectForcedExecutionCandidate 를 export 해야 한다.');
  assert.equal(selectForcedExecutionCandidate({ parsed: parsedGap, activeSnapshot: activeSnapshotFor(parsedGap), level: 'soft', mode: 'enforce' }), null, 'soft 압력에서는 tier-2 를 쓰면 안 된다.');
  assert.equal(selectForcedExecutionCandidate({ parsed: parsedGap, activeSnapshot: activeSnapshotFor(parsedGap), level: 'hard', mode: 'observe' }), null, 'observe 모드에서는 tier-2 를 쓰면 안 된다.');
  assert.equal(selectForcedExecutionCandidate({ parsed: parsedGap, activeSnapshot: activeSnapshotFor(parsedGap) }), null, '기본 level/mode 는 tier-2 를 비활성화해야 한다.');
  assert.equal(parseMarkdownFile(parentTaskPath(gapWork)).status, 'done', '비발화 선택은 부모 파일을 변경하면 안 된다.');

  // 5. 열린 검증 가능 tier-1 이 있으면 지연 부모보다 먼저 선택한다.
  const tierOneWork = makeWork({ tierOne: true });
  decomposeOnce(tierOneWork);
  closeOnlyChild(tierOneWork);
  const parsedTierOne = parseProject(tierOneWork);
  assert.deepEqual(parsedTierOne.errors, [], 'tier-1 픽스처 그래프는 유효해야 한다.');
  const tierOneCandidate = selectForcedExecutionCandidate({
    parsed: parsedTierOne,
    activeSnapshot: activeSnapshotFor(parsedTierOne),
    level: 'hard',
    mode: 'enforce',
  });
  assert.equal(tierOneCandidate?.task?.id, 'task-tier-one', 'tier-1 후보가 지연 부모보다 먼저 선택되어야 한다.');
  assert.equal(parseMarkdownFile(parentTaskPath(tierOneWork)).status, 'done', 'tier-1 이 선택되면 tier-2 부모를 되살리면 안 된다.');

  // 2 + 3. hard+enforce tier-2 는 부모를 되살려 실행하고, 실패 체크는 부모를 blocked 로 만든다.
  const hardRun = runHardReverify(gapWork);
  assert.equal(hardRun.actions.length, 2, 'hard 재검증 런은 pressure 준비와 부모 실행 두 action 이어야 한다.');
  assert.equal(hardRun.actions[0].kind, 'decompose', '첫 step 은 유효 임계값까지 예산을 소진해야 한다.');
  const deferredExecute = hardRun.actions[1];
  assert.equal(deferredExecute.kind, 'execute', 'tier-2 부모는 execute 로 dispatch 되어야 한다.');
  assert.equal(deferredExecute.taskId, 'task-parent', 'tier-2 는 deferred acceptance 부모를 선택해야 한다.');

  const hardEvents = readEvents(gapWork, hardRun.runId);
  const reverifyEvents = eventsOfType(hardEvents, 'convergence_deferred_acceptance_reverify');
  assert.equal(reverifyEvents.length, 1, '지연 부모 선택 시 reverify 이벤트가 한 번 발화해야 한다.');
  assert.equal(reverifyEvents[0].taskId, 'task-parent', 'reverify 이벤트는 되살린 부모를 가리켜야 한다.');
  assert.equal(reverifyEvents[0].level, 'hard', 'reverify 이벤트는 hard 발화를 기록해야 한다.');
  assert.equal(reverifyEvents[0].firedAxes.includes('budget'), true, 'reverify 이벤트는 실제 발화 축을 기록해야 한다.');

  const executeNode = executeRunNodeFor(gapWork, hardRun.runId, 'task-parent');
  assert.ok(executeNode, '되살린 부모의 실제 execute run node 가 있어야 한다.');
  const checkResults = executeNode.result?.observed?.checkResults || [];
  assert.equal(checkResults.length, 1, '강제 실행은 부모 requiredChecks 를 runner 검증해야 한다.');
  assert.equal(checkResults[0].command, failingParentCheck, 'runner 는 부모의 실제 requiredCheck 를 실행해야 한다.');
  assert.equal(checkResults[0].verifiedBy, 'runner', 'checkResults 는 runner 작성이어야 한다.');
  assert.equal(checkResults[0].status, 'failed', '픽스처 체크는 실제 failed 로 관찰되어야 한다.');

  const blockedParent = parseMarkdownFile(parentTaskPath(gapWork));
  assert.equal(blockedParent.status, 'blocked', '실패 체크 뒤 부모는 blocked 여야 한다.');
  assert.notEqual(blockedParent.status, 'done', '실패 체크 뒤 부모를 done 으로 거짓 완료하면 안 된다.');
  assert.equal(Number.isNaN(Date.parse(blockedParent.convergenceDeferredAcceptance?.reverifiedAt || '')), false, '되살린 이유를 reverifiedAt 으로 남겨야 한다.');

  // 7. closure 상호작용: 체크가 통과하면 기존 분해 EoW를 감사 가능하게 승격하고 부모를 done 으로 닫는다.
  const passingWork = makeWork({ parentCheck: passingTierOneCheck });
  decomposeOnce(passingWork);
  closeOnlyChild(passingWork);
  const passingRun = runHardReverify(passingWork);
  const passingExecute = passingRun.actions[1];
  assert.equal(passingExecute?.kind, 'execute', '통과 경로도 지연 부모를 execute 해야 한다.');
  assert.equal(passingExecute?.taskId, 'task-parent', '통과 경로의 execute 대상은 지연 부모여야 한다.');
  assert.equal(passingExecute?.status, 'completed', 'runner 검증 통과 뒤 execute 는 완료되어야 한다.');
  const passingNode = executeRunNodeFor(passingWork, passingRun.runId, 'task-parent');
  const passingChecks = passingNode?.result?.observed?.checkResults || [];
  assert.equal(passingChecks[0]?.verifiedBy, 'runner', '통과 체크도 runner 작성 증거여야 한다.');
  assert.equal(passingChecks[0]?.status, 'passed', '통과 픽스처 체크는 실제 passed 여야 한다.');
  const passingParent = parseMarkdownFile(parentTaskPath(passingWork));
  assert.equal(passingParent.status, 'done', '통과 체크 뒤 부모는 done 으로 다시 닫혀야 한다.');
  const passingEvents = readEvents(passingWork, passingRun.runId);
  assert.equal(
    eventsOfType(passingEvents, 'convergence_deferred_acceptance_reverify').length,
    1,
    '재검증 성공 런 전체에서 deferred acceptance 이벤트는 정확히 한 번이어야 한다.',
  );
  const postSuccessParsed = parseProject(passingWork);
  const postSuccessCandidate = selectForcedExecutionCandidate({
    parsed: postSuccessParsed,
    activeSnapshot: activeSnapshotFor(postSuccessParsed),
    level: 'hard',
    mode: 'enforce',
  });
  assert.notEqual(
    postSuccessCandidate?.task?.id,
    'task-parent',
    '이미 성공적으로 재검증한 deferred acceptance 부모를 다음 hard 후보로 다시 선택하면 안 된다.',
  );
  assert.equal(
    parseMarkdownFile(parentTaskPath(passingWork)).status,
    'done',
    '재검증 완료 부모는 후속 hard 후보 조회만으로 다시 pending 이 되면 안 된다.',
  );
  const passingParsed = parseProject(passingWork);
  assert.deepEqual(passingParsed.errors, [], '지연 재검증 성공 뒤 closure 그래프는 유효해야 한다.');
  const promotedTaskEow = [...passingParsed.eowNodes.values()].find((eow) => (
    eow.graphType === 'task'
    && eow.attachedToId === 'task-parent'
    && eow.taskGroupVersionId === 'tgv-root-v2'
  ));
  assert.ok(promotedTaskEow, '재검증 성공 부모의 task EoW가 있어야 한다.');
  assert.equal(promotedTaskEow.reason, 'approved_result', '기존 분해 EoW는 승인 결과 EoW로 승격되어야 한다.');
  assert.equal(promotedTaskEow.reverifiedFromReason, 'decomposed_by_runner', '승격 전 분해 종료 이유를 감사 흔적으로 보존해야 한다.');
  assert.equal(promotedTaskEow.approvedByReviewNodeId, passingExecute.reviewNodeId, '승격 EoW는 실제 승인 review를 가리켜야 한다.');

  console.log('convergence-acceptance-descent smoke passed');
} catch (error) {
  console.error(error);
  process.exit(1);
}
