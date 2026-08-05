#!/usr/bin/env node
// 라운드 D — hard 압력은 검증 불가능한 planning task를 억지 execute/done으로 만들 수 없다.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(scriptDir, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-convergence-hard-no-false-done-'));
let seq = 0;

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error('taskops ' + args.join(' ') + ' 실패\n' + result.stdout + '\n' + result.stderr);
}

function taskPath(workDir, taskId) {
  return join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', taskId + '.md');
}

function makeWork(checkKind) {
  const id = 'round-d-no-false-done-' + checkKind + '-' + (seq += 1);
  const workDir = join(tempRoot, id);
  runCli(['init', workDir, '--id', id, '--title', id, '--objective', 'hard 거짓 완료 방화벽을 검증한다.', '--language', 'ko']);
  const targetAcceptance = checkKind === 'none'
    ? { mode: 'informational', expectedOutcome: '검증 신호가 없는 계획 과제', requiredChecks: [], requiredArtifacts: [] }
    : {
        mode: 'guarded',
        expectedOutcome: 'runner가 실제 requiredChecks를 실행한다.',
        requiredChecks: [checkKind === 'pass' ? 'node -e "process.exit(0)"' : 'node -e "process.exit(7)"'],
        requiredArtifacts: [],
      };
  const tasks = [
    {
      id: 'task-budget-primer',
      title: 'hard 발화 선행 분해',
      objective: '첫 step을 사용해 다음 dispatch를 hard로 만든다.',
      responsibility: '예산 압력만 준비한다.',
      completionCriteria: '자식 task group이 생성된다.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      uncertaintyState: 'known_unknown',
      confidenceScore: 0.4,
      decompositionConfidence: 0.9,
      expectedPlan: { expectedDepth: 1, expectedBreadth: 1, rationale: 'hard 발화를 위한 한 단계 분해다.' },
    },
    {
      id: 'task-target',
      title: 'hard 강등 검증 대상',
      objective: '완료 기준을 무르게 하지 않고 실행 가능성을 판정한다.',
      responsibility: '검증가능성에 따른 hard 분기를 증명한다.',
      completionCriteria: '검증 가능한 경우에만 execute되고 실제 check 결과로 닫힌다.',
      expectedResult: 'runner가 검증한 상태 전이',
      order: 2,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      uncertaintyState: 'known_unknown',
      confidenceScore: 0.9,
      decompositionConfidence: 0.9,
      expectedPlan: { expectedDepth: 1, expectedBreadth: 1, rationale: 'hard 전에는 planning으로 분류되는 대상이다.' },
      acceptance: targetAcceptance,
    },
  ];
  const specPath = join(tempRoot, id + '-spec.json');
  writeFileSync(specPath, JSON.stringify({ versionId: 'tgv-root-v2', version: 'v2', summary: checkKind, selected: true, tasks }), 'utf8');
  runCli(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function makeFakeExecutor(envName) {
  const fakePath = join(tempRoot, 'fake-' + envName + '.mjs');
  const source = [
    '#!/usr/bin/env node',
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "if (process.argv.includes('--version')) { console.log('openclaw fake no false done'); process.exit(0); }",
    "const args = process.argv.slice(2);",
    "const messageIndex = args.indexOf('--message');",
    "const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';",
    'const workDir = process.env[' + JSON.stringify(envName) + '];',
    "const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();",
    "const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();",
    "const write = (path, lines) => writeFileSync(path, lines.join('\\n'), 'utf8');",
    'if (childTaskGroupId && versionId) {',
    "  const now = '2026-07-30T00:00:00.000Z';",
    "  const groupDir = join(workDir, 'task-groups', childTaskGroupId);",
    "  const versionDir = join(groupDir, 'versions', versionId);",
    "  mkdirSync(join(versionDir, 'tasks'), { recursive: true });",
    "  mkdirSync(join(versionDir, 'eow'), { recursive: true });",
    "  write(join(groupDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroup','id: ' + childTaskGroupId,'objective: hard 발화 자식 그룹','createdAt: ' + now,'status: active','activeVersionId: ' + versionId,'---','# Child group','']);",
    "  write(join(versionDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroupVersion','id: ' + versionId,'taskGroupId: ' + childTaskGroupId,'version: v1','summary: hard 발화 자식 version','createdAt: ' + now,'status: active','---','# Child version','']);",
    "  writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- fake\\n', 'utf8');",
    "  write(join(versionDir, 'tasks', 'task-spawned.md'), ['---','taskOpsVersion: v1','entityType: task','id: task-spawned','taskGroupId: ' + childTaskGroupId,'taskGroupVersionId: ' + versionId,'title: 후속 계획 자식','objective: fixture 후속 계획을 유지한다.','responsibility: fixture 구조만 유지한다.','completionCriteria: 후속 계획.','order: 1','createdAt: ' + now,'status: pending','runReadiness: needs_decomposition','uncertaintyState: known_unknown','expectedPlan:','  expectedDepth: 1','  expectedBreadth: 1','  rationale: 후속 계획 자식.','---','# Spawned','']);",
    "  console.log('decomposition authored');",
    '  process.exit(0);',
    '}',
    "console.log(JSON.stringify({ result: { finalAssistantRawText: 'hard target execution finished' } }));",
    '',
  ].join('\n');
  writeFileSync(fakePath, source, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function readEvents(workDir, runId) {
  const raw = readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8').trim();
  return raw ? raw.split(/\n+/).map((line) => JSON.parse(line)) : [];
}

function runCase(checkKind) {
  const workDir = makeWork(checkKind);
  const envName = 'TASKOPS_NO_FALSE_DONE_' + seq;
  const fake = makeFakeExecutor(envName);
  const previous = process.env.TASKOPS_OPENCLAW_BIN;
  process.env.TASKOPS_OPENCLAW_BIN = fake;
  process.env[envName] = workDir;
  let result;
  try {
    result = runTaskOps(workDir, {
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
        extension: { maxGrants: 1, fraction: 0.5 },
      },
    });
  } finally {
    if (previous == null) delete process.env.TASKOPS_OPENCLAW_BIN;
    else process.env.TASKOPS_OPENCLAW_BIN = previous;
    delete process.env[envName];
  }
  return { workDir, result, events: readEvents(workDir, result.runId) };
}

const negative = runCase('none');
const negativeTarget = parseMarkdownFile(taskPath(negative.workDir, 'task-target'));
assert.equal(negative.result.actions.some((action) => action.taskId === 'task-target' && action.kind === 'execute'), false, '검증 불가능 target을 execute로 강등하면 안 된다.');
assert.notEqual(negativeTarget.status, 'done', '검증 불가능 target은 done이 아니어야 한다.');
assert.equal(negative.result.stopReason, 'convergence_blocked', '검증 불가능 후보뿐이면 정직하게 convergence_blocked로 멈춰야 한다.');
const refusal = negative.events.find((event) => event.type === 'convergence_planning_blocked' && event.taskId === 'task-target');
assert.equal(refusal?.demotionRefused, 'no_verifiable_acceptance', 'hard 거부 이벤트에 demotionRefused를 남겨야 한다.');

const passing = runCase('pass');
const passingAction = passing.result.actions.find((action) => action.taskId === 'task-target');
assert.equal(passingAction?.kind, 'execute', '성공 requiredChecks가 있으면 hard 강등 문이 열려야 한다.');
assert.equal(passingAction?.status, 'completed');
assert.equal(parseMarkdownFile(taskPath(passing.workDir, 'task-target')).status, 'done', '실제 성공 check 뒤에는 done이 허용된다.');

const failing = runCase('fail');
const failingAction = failing.result.actions.find((action) => action.taskId === 'task-target');
assert.equal(failingAction?.kind, 'execute', '실패 requiredChecks도 검증 가능한 task이므로 execute까지는 가야 한다.');
const failingTarget = parseMarkdownFile(taskPath(failing.workDir, 'task-target'));
assert.equal(failingTarget.status, 'blocked', '실제 check 실패 뒤에는 blocked여야 한다.');
assert.notEqual(failingTarget.status, 'done', '실패 check를 done으로 거짓 완료하면 안 된다.');

// 이 스크립트도 라운드 D run 감사 구조를 소비해 신규 테스트 자체가 구현 전 RED가 되게 한다.
assert.ok(negative.result.convergence.extensions, '모든 run 결과에 convergence.extensions 감사 구조가 있어야 한다.');
assert.equal(negative.result.convergence.extensions.initialMaxSteps, 2);
assert.equal(negative.result.convergence.extensions.finalMaxSteps, 2);

console.log('convergence hard no false done smoke passed');
