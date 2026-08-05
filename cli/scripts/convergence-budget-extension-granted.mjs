#!/usr/bin/env node
// 라운드 D — soft 창에서 근거가 있는 신청만 예산을 늘리고, 완료 기준은 그대로 보존한다.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile } from '../lib-taskops.js';
import * as runner from '../lib-runner.js';

const { runTaskOps } = runner;
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(scriptDir, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-convergence-extension-granted-'));
const initialMaxSteps = 10;
const initialMaxWallClockMs = 60_000;
const reason = '실제 남은 독립 실행 과제가 여섯 개라 현재 예산 안에서 검증까지 정직하게 끝낼 수 없습니다.';
const evidence = [{ claim: '열린 실행 과제가 남아 있다.', observed: '이번 런에서 task-01부터 task-06까지 실행했고 task-07부터 task-12가 아직 열려 있음을 확인했다.' }];
const remainingWork = 'task-07부터 task-12까지 실행하고 각 requiredChecks를 검증한다.';
const requestLine = 'TASKOPS_BUDGET_EXTENSION_REQUEST: ' + JSON.stringify({
  requested: true,
  reason,
  evidence,
  remainingWork,
  requestedSteps: 5,
});

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: process.env });
  if (result.status !== 0) {
    throw new Error('taskops ' + args.join(' ') + ' 실패\nSTDOUT:\n' + result.stdout + '\nSTDERR:\n' + result.stderr);
  }
}

function taskPath(workDir, taskId) {
  return join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', taskId + '.md');
}

function makeWork() {
  const id = 'round-d-extension-granted';
  const workDir = join(tempRoot, id);
  runCli(['init', workDir, '--id', id, '--title', id, '--objective', '근거 있는 예산 연장을 검증한다.', '--language', 'ko']);
  const tasks = Array.from({ length: 12 }, (_, index) => {
    const n = String(index + 1).padStart(2, '0');
    return {
      id: 'task-' + n,
      title: '독립 실행 과제 ' + n,
      objective: '독립 실행 과제 ' + n + '을 수행하고 검증한다.',
      responsibility: '자신의 독립 범위만 실행한다.',
      completionCriteria: 'runner requiredChecks가 통과한다.',
      expectedResult: 'runner 검증이 통과한 실행 결과',
      order: index + 1,
      status: 'pending',
      runReadiness: 'runnable',
      understandingLevel: 'known',
      uncertaintyState: 'known',
      confidenceScore: 0.9,
      decompositionConfidence: 0.9,
      expectedPlan: { expectedDepth: 0, expectedBreadth: 1, rationale: '이미 원자적인 실행 단위다.' },
      acceptance: {
        mode: 'guarded',
        expectedOutcome: 'runner 검증이 통과한 실행 결과',
        requiredChecks: ['node -e "process.exit(0)"'],
        requiredArtifacts: [],
      },
    };
  });
  const specPath = join(tempRoot, id + '-spec.json');
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: '라운드 D 승인 픽스처',
    selected: true,
    tasks,
  }), 'utf8');
  runCli(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function makeFakeExecutor() {
  const fakePath = join(tempRoot, 'fake-openclaw-extension-granted.mjs');
  const source = [
    '#!/usr/bin/env node',
    "import { writeFileSync } from 'node:fs';",
    "if (process.argv.includes('--version')) { console.log('openclaw fake extension granted'); process.exit(0); }",
    "const args = process.argv.slice(2);",
    "const messageIndex = args.indexOf('--message');",
    "const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';",
    "const taskId = (prompt.match(/Task: ([^ ]+) —/) || [])[1] || '';",
    "const plan = JSON.parse(process.env.TASKOPS_EXTENSION_MARKERS || '{}');",
    "if (taskId === process.env.TASKOPS_EXTENSION_DUMP_TASK && process.env.TASKOPS_EXTENSION_PROMPT_DUMP) writeFileSync(process.env.TASKOPS_EXTENSION_PROMPT_DUMP, prompt, 'utf8');",
    "const lines = ['fake executor finished task ' + taskId];",
    "if (plan[taskId]) lines.push(plan[taskId]);",
    "console.log(JSON.stringify({ result: { finalAssistantRawText: lines.join('\\n') } }));",
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

function acceptanceSnapshot(workDir) {
  return Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
    const taskId = 'task-' + String(index + 1).padStart(2, '0');
    return [taskId, parseMarkdownFile(taskPath(workDir, taskId)).acceptance];
  }));
}

const workDir = makeWork();
const beforeAcceptance = acceptanceSnapshot(workDir);
const fakeExecutor = makeFakeExecutor();
const promptDump = join(tempRoot, 'soft-execute-prompt.txt');
const previousBin = process.env.TASKOPS_OPENCLAW_BIN;
const previousMarkers = process.env.TASKOPS_EXTENSION_MARKERS;
const previousDumpTask = process.env.TASKOPS_EXTENSION_DUMP_TASK;
const previousDump = process.env.TASKOPS_EXTENSION_PROMPT_DUMP;
process.env.TASKOPS_OPENCLAW_BIN = fakeExecutor;
process.env.TASKOPS_EXTENSION_MARKERS = JSON.stringify({ 'task-06': requestLine });
process.env.TASKOPS_EXTENSION_DUMP_TASK = 'task-06';
process.env.TASKOPS_EXTENSION_PROMPT_DUMP = promptDump;

let runResult;
try {
  runResult = runTaskOps(workDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    timeout: 30,
    verifyChecks: true,
    maxSteps: initialMaxSteps,
    maxStepsExplicit: true,
    maxWallClockMs: initialMaxWallClockMs,
    convergence: {
      mode: 'enforce',
      budget: { soft: 0.5, hard: 0.95 },
      depth: { enabled: false },
      debt: { count: 999, ratio: 1 },
      extension: { maxGrants: 1, fraction: 0.5 },
    },
  });
} finally {
  if (previousBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
  else process.env.TASKOPS_OPENCLAW_BIN = previousBin;
  if (previousMarkers == null) delete process.env.TASKOPS_EXTENSION_MARKERS;
  else process.env.TASKOPS_EXTENSION_MARKERS = previousMarkers;
  if (previousDumpTask == null) delete process.env.TASKOPS_EXTENSION_DUMP_TASK;
  else process.env.TASKOPS_EXTENSION_DUMP_TASK = previousDumpTask;
  if (previousDump == null) delete process.env.TASKOPS_EXTENSION_PROMPT_DUMP;
  else process.env.TASKOPS_EXTENSION_PROMPT_DUMP = previousDump;
}

const events = readEvents(workDir, runResult.runId);
const requested = events.filter((event) => event.type === 'convergence_extension_requested');
const granted = events.filter((event) => event.type === 'convergence_extension_granted');
assert.equal(requested.length, 1, '신청 이벤트는 정확히 1건이어야 한다.');
assert.equal(granted.length, 1, '승인 이벤트는 정확히 1건이어야 한다.');
assert.ok(events.indexOf(requested[0]) < events.indexOf(granted[0]), 'requested 뒤에 granted가 기록되어야 한다.');
assert.equal(requested[0].taskId, 'task-06');
assert.equal(requested[0].kind, 'execute');
assert.equal(requested[0].level, 'soft');
assert.equal(requested[0].reason, reason, 'events.jsonl은 신청 reason 원문을 보존해야 한다.');
assert.deepEqual(requested[0].evidence, evidence, 'events.jsonl은 evidence 원문을 보존해야 한다.');
assert.equal(requested[0].evidenceCount, 1);
assert.equal(requested[0].requestedSteps, 5);
assert.equal(granted[0].stepsBefore, 10);
assert.equal(granted[0].stepsAfter, 15);
assert.equal(granted[0].wallBefore, 60_000);
assert.equal(granted[0].wallAfter, 90_000);

assert.equal(runResult.maxSteps, 15, 'top-level final maxSteps도 연장값이어야 한다.');
assert.equal(runResult.maxWallClockMs, 90_000, 'top-level wall cap도 같은 grant에서 늘어나야 한다.');
assert.equal(runResult.convergence.extensions.initialMaxSteps, 10);
assert.equal(runResult.convergence.extensions.finalMaxSteps, 15);
assert.equal(runResult.convergence.extensions.initialMaxWallClockMs, 60_000);
assert.equal(runResult.convergence.extensions.finalMaxWallClockMs, 90_000);
assert.equal(runResult.convergence.extensions.requested, 1);
assert.equal(runResult.convergence.extensions.granted, 1);
assert.equal(runResult.convergence.extensions.rejected, 0);
assert.equal(runResult.stepsRun > 10, true, '기존 10-step 상한을 넘어 실제 실행이 계속되어야 한다.');
assert.notEqual(runResult.stopReason, 'max_steps', '연장 승인 직후 기존 상한에서 멈추면 안 된다.');

const requestTask = parseMarkdownFile(taskPath(workDir, 'task-06'));
assert.equal(requestTask.budgetExtensionRequests.length, 1);
assert.equal(requestTask.budgetExtensionRequests[0].decision, 'granted');
assert.equal(requestTask.budgetExtensionRequests[0].reason, reason, 'task frontmatter도 reason 원문을 보존해야 한다.');
assert.deepEqual(acceptanceSnapshot(workDir), beforeAcceptance, '연장은 어떤 task의 acceptance도 바꾸면 안 된다.');

const prompt = readFileSync(promptDump, 'utf8');
assert.match(prompt, /TASKOPS_BUDGET_EXTENSION_REQUEST/, 'soft execute의 실제 fake executor prompt에 신청 프로토콜이 배선되어야 한다.');
const runIndex = parseMarkdownFile(join(workDir, 'runs', runResult.runId, 'index.md'));
assert.equal(runIndex.convergenceExtensions.granted, 1, 'run index frontmatter에 extension 감사를 스탬프해야 한다.');
const runLog = readFileSync(join(workDir, 'runs', runResult.runId, 'run-log.md'), 'utf8');
assert.match(runLog, /convergence_extension_granted/, 'run log에도 승인 한 줄을 남겨야 한다.');

assert.equal(typeof runner.parseBudgetExtensionRequestFromExecutorResult, 'function', '예산 연장 파서를 export해야 한다.');
for (const sample of [
  { stdout: requestLine },
  { message: requestLine },
  { finalAssistantRawText: requestLine },
  JSON.stringify({ result: { payloads: [{ message: JSON.stringify({ finalAssistantRawText: requestLine }) }] } }),
]) {
  const parsed = runner.parseBudgetExtensionRequestFromExecutorResult(sample);
  assert.equal(parsed.requested, true, 'stdout/message/raw/nested JSON 모두 requested=true를 찾아야 한다.');
  assert.equal(parsed.reason, reason);
}
const malformed = runner.parseBudgetExtensionRequestFromExecutorResult({ stdout: 'TASKOPS_BUDGET_EXTENSION_REQUEST: {broken' });
assert.equal(malformed.malformed, true);
assert.equal(malformed.rawLine, 'TASKOPS_BUDGET_EXTENSION_REQUEST: {broken');

console.log('convergence budget extension granted smoke passed');
