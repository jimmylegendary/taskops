#!/usr/bin/env node
// 라운드 A — hard 수렴 압력을 readiness 분류 시점에 적용한다.
//
// 이 스모크가 지키는 계약:
//   (1) hard + 검증 가능한 planning task는 자기 자신이 execute로 dispatch된다.
//   (2) soft/none은 기존 readiness action을 바꾸지 않는다.
//   (3) hard여도 검증 가능한 acceptance가 없으면 강등을 거부하고 정직하게 blocked된다.
//   (4) computeNextAction/explainWork navigation은 런 스코프 게이트와 무관하게 그대로다.
// 문자열 존재가 아니라 실제 runTaskOps action, events.jsonl, stopReason을 관찰한다.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as convergence from '../lib-convergence.js';
import { computeNextAction, explainWork, runTaskOps } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-convergence-readiness-demotion-'));
let seq = 0;

function runCli(args) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error('taskops ' + args.join(' ') + ' 실패\nSTDOUT:\n' + result.stdout + '\nSTDERR:\n' + result.stderr);
  }
}

function taskPath(workDir, taskId) {
  return join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', taskId + '.md');
}

function makeWork({ verifiable }) {
  const id = 'conv-readiness-' + (seq += 1);
  const workDir = join(tempRoot, id);
  runCli(['init', workDir, '--id', id, '--title', id, '--objective', 'Readiness hard 강등을 검증한다.', '--language', 'ko']);

  const tasks = [
    {
      id: 'task-budget-primer',
      title: '예산 선행 소진',
      objective: '첫 planning 스텝으로 예산을 소진한다.',
      responsibility: 'hard 도달 전 한 스텝을 만든다.',
      completionCriteria: '자식 task group이 생성된다.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      uncertaintyState: 'known_unknown',
      confidenceScore: 0.4,
      decompositionConfidence: 0.85,
      expectedPlan: {
        expectedDepth: 1,
        expectedBreadth: 1,
        rationale: '두 번째 dispatch에서 budget hard에 도달시키는 선행 스텝.',
      },
    },
    {
      id: 'task-readiness-target',
      title: 'readiness 강등 대상',
      objective: '검증 가능한 acceptance를 실제 실행한다.',
      responsibility: 'hard readiness 강등의 현재 task가 된다.',
      // fixture 작성 후 stale convergenceAcceptanceGap을 심는다. 기존 forceExecute 후보에는 들지 않지만,
      // 실제 requiredChecks를 보는 새 자기강등 안전조건은 충족하므로 두 경로를 행동으로 구분할 수 있다.
      completionCriteria: 'fixture 생성용 임시 값.',
      order: 2,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      uncertaintyState: 'known_unknown',
      confidenceScore: 0.9,
      decompositionConfidence: 0.85,
      expectedPlan: {
        expectedDepth: 1,
        expectedBreadth: 1,
        rationale: 'readiness 분류가 planning으로 유지되는 대상.',
      },
      acceptance: verifiable
        ? {
            mode: 'guarded',
            requiredChecks: ['node -e ""'],
            expectedOutcome: 'runner가 required check를 실행해 통과시킨다.',
          }
        : {
            mode: 'informational',
            requiredChecks: [],
            requiredArtifacts: [],
            expectedOutcome: '검증 가능한 신호가 없다.',
          },
    },
  ];

  const specPath = join(tempRoot, id + '-spec.json');
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Readiness hard 강등 실제 런루프 fixture',
    selected: true,
    tasks,
  }), 'utf8');
  runCli(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);

  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(
    snapshotPath,
    readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'),
    'utf8',
  );

  const targetPath = taskPath(workDir, 'task-readiness-target');
  const targetRaw = readFileSync(targetPath, 'utf8');
  writeFileSync(
    targetPath,
    targetRaw.replace(/\n---\n/, '\nconvergenceAcceptanceGap: true\n---\n'),
    'utf8',
  );
  return workDir;
}

// 첫 스텝의 decompose 산출물만 만들고, execute에서는 구조화된 성공 결과를 반환한다.
function makeFakeExecutor(envVar) {
  const fakePath = join(tempRoot, 'fake-' + envVar + '.mjs');
  const source = [
    '#!/usr/bin/env node',
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "if (process.argv.includes('--version')) { console.log('openclaw fake readiness demotion'); process.exit(0); }",
    "const args = process.argv.slice(2);",
    "const messageIndex = args.indexOf('--message');",
    "const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';",
    'const workDir = process.env[' + JSON.stringify(envVar) + '];',
    "const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();",
    "const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();",
    "const write = (path, lines) => writeFileSync(path, lines.join('\\n'), 'utf8');",
    'if (childTaskGroupId && versionId) {',
    "  const now = '2026-07-30T00:00:00.000Z';",
    "  const groupDir = join(workDir, 'task-groups', childTaskGroupId);",
    "  const versionDir = join(groupDir, 'versions', versionId);",
    "  mkdirSync(join(versionDir, 'tasks'), { recursive: true });",
    "  mkdirSync(join(versionDir, 'eow'), { recursive: true });",
    "  write(join(groupDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroup','id: ' + childTaskGroupId,'objective: 예산 선행 소진 자식','createdAt: ' + now,'status: active','activeVersionId: ' + versionId,'---','# ' + childTaskGroupId,'']);",
    "  write(join(versionDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroupVersion','id: ' + versionId,'taskGroupId: ' + childTaskGroupId,'version: v1','summary: 예산 선행 소진 자식 version','createdAt: ' + now,'status: active','---','# Child version','']);",
    "  writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- fake\\n', 'utf8');",
    "  write(join(versionDir, 'tasks', 'task-spawned.md'), ['---','taskOpsVersion: v1','entityType: task','id: task-spawned','taskGroupId: ' + childTaskGroupId,'taskGroupVersionId: ' + versionId,'title: 선행 소진 자식','objective: 검증 대상 뒤에 남는 planning child.','responsibility: fixture 구조를 유지한다.','completionCriteria: 후속 planning.','order: 1','createdAt: ' + now,'status: pending','runReadiness: needs_decomposition','uncertaintyState: known_unknown','expectedPlan:','  expectedDepth: 1','  expectedBreadth: 1','  rationale: 선행 소진 자식 계획.','---','# Spawned','']);",
    "  console.log('decomposition authored');",
    '  process.exit(0);',
    '}',
    "console.log(JSON.stringify({ executorSummary: 'readiness 강등 실행 완료', observed: { outcomeSummary: 'runner required check 검증 대상 결과' } }));",
    '',
  ].join('\n');
  writeFileSync(fakePath, source, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function runWork(workDir) {
  const envVar = 'TASKOPS_READINESS_DEMOTION_' + seq;
  const fake = makeFakeExecutor(envVar);
  const previous = process.env.TASKOPS_OPENCLAW_BIN;
  process.env.TASKOPS_OPENCLAW_BIN = fake;
  process.env[envVar] = workDir;
  try {
    return runTaskOps(workDir, {
      executor: 'openclaw-agent',
      agent: 'main',
      timeout: 30,
      maxSteps: 2,
      maxStepsExplicit: true,
      convergence: {
        mode: 'enforce',
        budget: { soft: 0.25, hard: 0.5 },
        depth: { enabled: false },
        debt: { count: 999, ratio: 1 },
      },
    });
  } finally {
    if (previous == null) delete process.env.TASKOPS_OPENCLAW_BIN;
    else process.env.TASKOPS_OPENCLAW_BIN = previous;
    delete process.env[envVar];
  }
}

function readEvents(workDir, runId) {
  const raw = readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8').trim();
  return raw ? raw.split(/\n+/).map((line) => JSON.parse(line)) : [];
}

// 발화: 실제 런루프에서 첫 decompose가 1/2 예산을 쓴 다음 target의 hard 자기강등이 일어나야 한다.
const positiveWork = makeWork({ verifiable: true });
const navigation = computeNextAction(positiveWork);
const explanation = explainWork(positiveWork);
assert.equal(navigation.action, 'decompose', 'navigation의 computeNextAction은 게이트와 무관하게 decompose여야 한다.');
assert.equal(explanation.next.action, 'decompose', 'navigation의 explainWork는 게이트와 무관하게 decompose여야 한다.');

const positiveRun = runWork(positiveWork);
const positiveKinds = positiveRun.actions.map((action) => action.kind);
const targetAction = positiveRun.actions.find((action) => action.taskId === 'task-readiness-target');
assert.equal(
  targetAction?.kind,
  'execute',
  'hard에서 현재 readiness task가 execute로 dispatch되어야 한다. 실제 actions=' + positiveKinds.join(','),
);
const positiveEvents = readEvents(positiveWork, positiveRun.runId);
const demotionEvents = positiveEvents.filter((event) => event.type === 'convergence_readiness_demoted');
assert.equal(demotionEvents.length, 1, 'convergence_readiness_demoted 이벤트가 정확히 1건이어야 한다.');
assert.equal(demotionEvents[0].taskId, 'task-readiness-target', '강등 이벤트는 현재 target task를 가리켜야 한다.');
assert.equal(demotionEvents[0].fromKind, 'decompose', '강등 전 kind는 decompose여야 한다.');
assert.equal(demotionEvents[0].level, 'hard', '강등 이벤트 level은 hard여야 한다.');
assert.equal(demotionEvents[0].firedAxes.includes('budget'), true, '강등 이벤트는 budget 축 발화를 기록해야 한다.');
assert.equal(
  positiveEvents.filter((event) => event.type === 'convergence_forced_execute').length,
  1,
  '현재 task 자기강등도 기존 forced execute 감사 이벤트 계약을 보존해야 한다.',
);
assert.equal(positiveRun.convergence.readinessDemotions, 1, 'run 통계가 readiness 강등 1회를 세어야 한다.');
assert.equal(
  positiveRun.convergence.levelTrail.some((entry) => entry.step === 2 && entry.level === 'hard' && entry.firedAxes.includes('budget')),
  true,
  'levelTrail은 두 번째 dispatch의 hard budget 압력을 남겨야 한다.',
);

const gateAwareActionForReadiness = convergence.gateAwareActionForReadiness;
assert.equal(typeof gateAwareActionForReadiness, 'function', '순수 readiness 게이트 함수가 export되어야 한다.');

// 미발화: soft/none은 기존 ACTION_BY_READINESS 결과를 그대로 보존한다.
assert.deepEqual(
  gateAwareActionForReadiness({
    readiness: 'needs_decomposition',
    baseAction: 'decompose',
    level: 'soft',
    verifiable: true,
  }),
  { action: 'decompose', demoted: false },
  'soft는 decompose를 강등하면 안 된다.',
);
assert.deepEqual(
  gateAwareActionForReadiness({
    readiness: 'needs_decomposition',
    baseAction: 'decompose',
    level: 'none',
    verifiable: true,
  }),
  { action: 'decompose', demoted: false },
  'none은 decompose를 강등하면 안 된다.',
);

// 음성 대조군: hard여도 acceptance에 실행 가능한 check/artifact가 없으면 강등을 거부한다.
assert.deepEqual(
  gateAwareActionForReadiness({
    readiness: 'needs_decomposition',
    baseAction: 'decompose',
    level: 'hard',
    verifiable: false,
  }),
  { action: 'decompose', demoted: false, demotionRefused: 'no_verifiable_acceptance' },
  '검증 불가능한 hard planning task는 강등 거부 사유를 반환해야 한다.',
);

const negativeWork = makeWork({ verifiable: false });
const negativeRun = runWork(negativeWork);
const negativeEvents = readEvents(negativeWork, negativeRun.runId);
assert.equal(negativeRun.actions.some((action) => action.kind === 'execute'), false, '검증 불가능 target은 execute로 dispatch되면 안 된다.');
assert.equal(negativeRun.stopReason, 'convergence_blocked', '강등 거부 뒤에는 기존 forceExecute→blockHonestly 경로로 끝나야 한다.');
assert.equal(
  negativeEvents.filter((event) => event.type === 'convergence_readiness_demoted').length,
  0,
  '검증 불가능 target은 readiness 강등 이벤트를 만들면 안 된다.',
);
const negativePlanningBlocked = negativeEvents.find(
  (event) => event.type === 'convergence_planning_blocked' && event.level === 'hard',
);
assert.equal(
  negativePlanningBlocked?.demotionRefused,
  'no_verifiable_acceptance',
  'hard planning 차단 이벤트는 강등 거부 사유를 감사 필드로 남겨야 한다.',
);
assert.equal(negativeRun.convergence.readinessDemotions, 0, '음성 대조군의 readiness 강등 카운터는 0이어야 한다.');

console.log('convergence readiness demotion smoke passed');
