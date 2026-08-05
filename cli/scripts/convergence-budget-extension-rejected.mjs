#!/usr/bin/env node
// 라운드 D — 근거·창·상한 판정은 단일 정책으로 거부하되 런과 기존 acceptance는 보존한다.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile } from '../lib-taskops.js';
import * as convergence from '../lib-convergence.js';
import * as runner from '../lib-runner.js';

const { runTaskOps } = runner;
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(scriptDir, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-convergence-extension-rejected-'));
let seq = 0;

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error('taskops ' + args.join(' ') + ' 실패\n' + result.stdout + '\n' + result.stderr);
}

function taskPath(workDir, taskId) {
  return join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', taskId + '.md');
}

function makeWork(label, taskCount) {
  const id = 'round-d-rejected-' + label + '-' + (seq += 1);
  const workDir = join(tempRoot, id);
  runCli(['init', workDir, '--id', id, '--title', id, '--objective', '예산 연장 거부를 검증한다.', '--language', 'ko']);
  const tasks = Array.from({ length: taskCount }, (_, index) => {
    const n = String(index + 1).padStart(2, '0');
    return {
      id: 'task-' + n,
      title: '거부 픽스처 과제 ' + n,
      objective: '거부 뒤에도 독립 실행 과제 ' + n + '을 수행한다.',
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
  writeFileSync(specPath, JSON.stringify({ versionId: 'tgv-root-v2', version: 'v2', summary: label, selected: true, tasks }), 'utf8');
  runCli(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function makeFakeExecutor() {
  const fakePath = join(tempRoot, 'fake-openclaw-extension-rejected.mjs');
  const source = [
    '#!/usr/bin/env node',
    "import { writeFileSync } from 'node:fs';",
    "if (process.argv.includes('--version')) { console.log('openclaw fake extension rejected'); process.exit(0); }",
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

const fakeExecutor = makeFakeExecutor();

function lineFor({ reason, evidence, remainingWork = '뒤에 남은 독립 task를 실행하고 검증한다.' }) {
  return 'TASKOPS_BUDGET_EXTENSION_REQUEST: ' + JSON.stringify({ requested: true, reason, evidence, remainingWork });
}

function readEvents(workDir, runId) {
  const raw = readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8').trim();
  return raw ? raw.split(/\n+/).map((line) => JSON.parse(line)) : [];
}

function runCase({ label, taskCount = 8, markers = {}, budget, extension = { maxGrants: 1, fraction: 0.5 }, dumpTask = null }) {
  const workDir = makeWork(label, taskCount);
  const dumpPath = dumpTask ? join(tempRoot, label + '-prompt.txt') : null;
  const previous = {
    bin: process.env.TASKOPS_OPENCLAW_BIN,
    markers: process.env.TASKOPS_EXTENSION_MARKERS,
    dumpTask: process.env.TASKOPS_EXTENSION_DUMP_TASK,
    dump: process.env.TASKOPS_EXTENSION_PROMPT_DUMP,
  };
  process.env.TASKOPS_OPENCLAW_BIN = fakeExecutor;
  process.env.TASKOPS_EXTENSION_MARKERS = JSON.stringify(markers);
  if (dumpTask) {
    process.env.TASKOPS_EXTENSION_DUMP_TASK = dumpTask;
    process.env.TASKOPS_EXTENSION_PROMPT_DUMP = dumpPath;
  } else {
    delete process.env.TASKOPS_EXTENSION_DUMP_TASK;
    delete process.env.TASKOPS_EXTENSION_PROMPT_DUMP;
  }
  let result;
  try {
    result = runTaskOps(workDir, {
      executor: 'openclaw-agent',
      agent: 'main',
      timeout: 30,
      verifyChecks: true,
      maxSteps: 10,
      maxStepsExplicit: true,
      maxWallClockMs: 60_000,
      convergence: {
        mode: 'enforce',
        budget,
        depth: { enabled: false },
        debt: { count: 999, ratio: 1 },
        extension,
      },
    });
  } finally {
    if (previous.bin == null) delete process.env.TASKOPS_OPENCLAW_BIN; else process.env.TASKOPS_OPENCLAW_BIN = previous.bin;
    if (previous.markers == null) delete process.env.TASKOPS_EXTENSION_MARKERS; else process.env.TASKOPS_EXTENSION_MARKERS = previous.markers;
    if (previous.dumpTask == null) delete process.env.TASKOPS_EXTENSION_DUMP_TASK; else process.env.TASKOPS_EXTENSION_DUMP_TASK = previous.dumpTask;
    if (previous.dump == null) delete process.env.TASKOPS_EXTENSION_PROMPT_DUMP; else process.env.TASKOPS_EXTENSION_PROMPT_DUMP = previous.dump;
  }
  return { workDir, result, events: readEvents(workDir, result.runId), dumpPath };
}

function rejectionFor(run) {
  return run.events.filter((event) => event.type === 'convergence_extension_rejected');
}

function assertRejectedAudit(run, taskId, rejectionReason, originalReason) {
  const requested = run.events.filter((event) => event.type === 'convergence_extension_requested');
  const rejected = rejectionFor(run);
  assert.equal(requested.length, 1, run.result.runId + ': requested 1건');
  assert.equal(rejected.length, 1, run.result.runId + ': rejected 1건');
  assert.ok(run.events.indexOf(requested[0]) < run.events.indexOf(rejected[0]), 'requested 뒤에 rejected가 와야 한다.');
  assert.equal(rejected[0].rejectionReason, rejectionReason);
  const task = parseMarkdownFile(taskPath(run.workDir, taskId));
  assert.equal(task.budgetExtensionRequests.length, 1, '신청 task frontmatter에 1건 append해야 한다.');
  assert.equal(task.budgetExtensionRequests[0].decision, 'rejected');
  assert.equal(task.budgetExtensionRequests[0].rejectionReason, rejectionReason);
  if (originalReason) {
    assert.equal(requested[0].reason, originalReason, 'events reason 원문을 보존해야 한다.');
    assert.equal(task.budgetExtensionRequests[0].reason, originalReason, 'frontmatter reason 원문을 보존해야 한다.');
  }
}

assert.equal(typeof convergence.evaluateExtensionRequest, 'function', '순수 연장 판정기를 export해야 한다.');
assert.deepEqual(convergence.CONVERGENCE_EXTENSION_DEFAULTS, { maxGrants: 1, fraction: 0.5 });
assert.deepEqual(
  convergence.normalizeConvergenceConfig({ convergence: { extension: { maxGrants: 2, fraction: 0.25 } } }, {}).extension,
  { maxGrants: 2, fraction: 0.25 },
  'option extension 설정을 정규화해야 한다.',
);
assert.deepEqual(
  convergence.normalizeConvergenceConfig({}, { TASKOPS_CONVERGENCE_EXTENSION_MAX: '3', TASKOPS_CONVERGENCE_EXTENSION_FRACTION: '0.4' }).extension,
  { maxGrants: 3, fraction: 0.4 },
  '환경변수 extension 설정을 정규화해야 한다.',
);
assert.throws(() => convergence.normalizeConvergenceConfig({ convergence: { extension: { maxGrants: -1 } } }, {}), /non-negative integer/);
assert.throws(() => convergence.normalizeConvergenceConfig({ convergence: { extension: { maxGrants: 1.5 } } }, {}), /non-negative integer/);
assert.throws(() => convergence.normalizeConvergenceConfig({ convergence: { extension: { fraction: 0 } } }, {}), /\(0, 1\]/);
assert.throws(() => convergence.normalizeConvergenceConfig({ convergence: { extension: { fraction: 1.1 } } }, {}), /\(0, 1\]/);

const validRequest = {
  requested: true,
  reason: '이번 런에서 관찰한 열린 작업 때문에 현재 예산만으로는 검증까지 끝낼 수 없습니다.',
  evidence: [{ claim: '열린 작업 존재', observed: 'task-07과 task-08이 실제로 pending 상태임을 관찰했다.' }],
  remainingWork: 'task-07과 task-08 실행 및 검증',
};
assert.deepEqual(convergence.evaluateExtensionRequest({ request: { malformed: true }, level: 'soft', mode: 'enforce', grantsUsed: 0, maxGrants: 1 }), { decision: 'rejected', rejectionReason: 'malformed_marker' });
assert.equal(convergence.evaluateExtensionRequest({ request: validRequest, level: 'soft', mode: 'observe', grantsUsed: 0, maxGrants: 1 }).rejectionReason, 'convergence_not_enforcing');
assert.equal(convergence.evaluateExtensionRequest({ request: validRequest, level: 'soft', mode: 'enforce', grantsUsed: 1, maxGrants: 1 }).rejectionReason, 'grant_cap_exhausted');
assert.equal(convergence.evaluateExtensionRequest({ request: validRequest, level: 'none', mode: 'enforce', grantsUsed: 0, maxGrants: 1 }).rejectionReason, 'out_of_window_no_pressure');
assert.equal(convergence.evaluateExtensionRequest({ request: validRequest, level: 'hard', mode: 'enforce', grantsUsed: 0, maxGrants: 1 }).rejectionReason, 'out_of_window_too_late');
assert.equal(convergence.evaluateExtensionRequest({ request: { ...validRequest, evidence: [] }, level: 'soft', mode: 'enforce', grantsUsed: 0, maxGrants: 1 }).rejectionReason, 'insufficient_evidence');
assert.deepEqual(convergence.evaluateExtensionRequest({ request: validRequest, level: 'soft', mode: 'enforce', grantsUsed: 0, maxGrants: 1 }), { decision: 'granted', rejectionReason: null });

const insufficientReason = '남은 과제가 많아서 현재 예산만으로 모든 검증을 정직하게 마치기 어렵습니다.';
const insufficient = runCase({
  label: 'insufficient',
  markers: { 'task-06': lineFor({ reason: insufficientReason, evidence: [] }) },
  budget: { soft: 0.5, hard: 0.95 },
});
assertRejectedAudit(insufficient, 'task-06', 'insufficient_evidence', insufficientReason);
assert.equal(insufficient.result.maxSteps, 10);
assert.equal(insufficient.result.maxWallClockMs, 60_000);
assert.equal(insufficient.result.actions.length > 6, true, '근거 부족 거부 뒤에도 런은 계속되어야 한다.');

const earlyReason = '아직 압력은 없지만 나중에 남을 과제를 예상하여 예산을 미리 더 받고 싶습니다.';
const early = runCase({
  label: 'early',
  markers: { 'task-01': lineFor({ reason: earlyReason, evidence: validRequest.evidence }) },
  budget: { soft: 0.5, hard: 0.95 },
});
assertRejectedAudit(early, 'task-01', 'out_of_window_no_pressure', earlyReason);
assert.equal(early.result.maxSteps, 10);
assert.equal(early.result.maxWallClockMs, 60_000);
assert.equal(early.result.actions.length > 1, true, '이른 신청 거부 뒤에도 런은 계속되어야 한다.');

const lateReason = '이미 hard 압력에 도달했지만 남은 작업을 이유로 뒤늦게 예산을 더 요청합니다.';
const late = runCase({
  label: 'late',
  markers: { 'task-06': lineFor({ reason: lateReason, evidence: validRequest.evidence }) },
  budget: { soft: 0.25, hard: 0.5 },
});
assertRejectedAudit(late, 'task-06', 'out_of_window_too_late', lateReason);
assert.equal(late.result.maxSteps, 10);
assert.equal(late.result.maxWallClockMs, 60_000);
assert.equal(late.result.actions.length > 6, true, '늦은 신청 거부 뒤에도 런은 계속되어야 한다.');

const capReasonOne = '첫 soft 창에서 실제 열린 작업을 관찰하여 검증 완료에 필요한 연장을 신청합니다.';
const capReasonTwo = '첫 승인 뒤에도 실제 열린 작업이 남아 있어 같은 형식의 두 번째 정당한 신청을 제출합니다.';
const cap = runCase({
  label: 'cap',
  markers: {
    'task-04': lineFor({ reason: capReasonOne, evidence: validRequest.evidence }),
    'task-06': lineFor({ reason: capReasonTwo, evidence: validRequest.evidence }),
  },
  budget: { soft: 0.3, hard: 0.95 },
});
const capRequested = cap.events.filter((event) => event.type === 'convergence_extension_requested');
const capGranted = cap.events.filter((event) => event.type === 'convergence_extension_granted');
const capRejected = rejectionFor(cap);
assert.equal(capRequested.length, 2);
assert.equal(capGranted.length, 1);
assert.equal(capRejected.length, 1);
assert.equal(capRejected[0].rejectionReason, 'grant_cap_exhausted');
assert.equal(cap.result.maxSteps, 15, '두 번째 거부는 첫 승인 뒤 예산을 다시 늘리면 안 된다.');
assert.equal(cap.result.maxWallClockMs, 90_000);
const capTask = parseMarkdownFile(taskPath(cap.workDir, 'task-06'));
assert.equal(capTask.budgetExtensionRequests[0].decision, 'rejected');
assert.equal(capTask.budgetExtensionRequests[0].rejectionReason, 'grant_cap_exhausted');
assert.equal(capTask.budgetExtensionRequests[0].reason, capReasonTwo);

const malformed = runCase({
  label: 'malformed',
  taskCount: 3,
  markers: { 'task-01': 'TASKOPS_BUDGET_EXTENSION_REQUEST: {broken' },
  budget: { soft: 0.5, hard: 0.95 },
});
assertRejectedAudit(malformed, 'task-01', 'malformed_marker');
assert.equal(malformed.events.filter((event) => event.type === 'convergence_extension_malformed').length, 1, '깨진 마커는 malformed 이벤트도 남겨야 한다.');

const noMarker = runCase({
  label: 'no-marker-disabled',
  taskCount: 2,
  markers: {},
  budget: { soft: 0.5, hard: 0.95 },
  extension: { maxGrants: 0, fraction: 0.5 },
  dumpTask: 'task-02',
});
assert.equal(noMarker.events.filter((event) => event.type.startsWith('convergence_extension_')).length, 0, '마커가 없으면 extension 이벤트는 0건이어야 한다.');
assert.deepEqual(
  { requested: noMarker.result.convergence.extensions.requested, granted: noMarker.result.convergence.extensions.granted, rejected: noMarker.result.convergence.extensions.rejected },
  { requested: 0, granted: 0, rejected: 0 },
);
assert.doesNotMatch(readFileSync(noMarker.dumpPath, 'utf8'), /TASKOPS_BUDGET_EXTENSION_REQUEST/, 'maxGrants=0이면 soft에서도 프롬프트를 주입하면 안 된다.');

console.log('convergence budget extension rejected smoke passed');
