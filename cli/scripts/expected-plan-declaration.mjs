#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { buildAgentDecompositionPrompt, runTaskOps } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-expected-plan-declaration-'));

const parentExpectedPlan = {
  expectedDepth: 3,
  expectedBreadth: 5,
  rationale: 'The parent expects a short but non-trivial child decomposition tree.',
};

const validChildExpectedPlan = {
  expectedDepth: 2,
  expectedBreadth: 4,
  rationale: 'The child has one analysis split and one verification split remaining.',
};

function run(args, options = {}) {
  const result = spawnSync('node', [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== (options.expectStatus ?? 0)) {
    throw new Error(`taskops ${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function makeWork(id) {
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Verify expectedPlan declaration and fallback.', '--language', 'en']);
  const specPath = join(tempRoot, `${id}-root-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Expected plan declaration fixture',
    selected: true,
    tasks: [
      {
        id: 'task-plan-parent',
        title: 'Plan parent',
        objective: 'Decompose into one child carrying expectedPlan.',
        responsibility: 'Exercise child expectedPlan declaration and fallback.',
        completionCriteria: 'Child tasks have expectedPlan after decomposition closure.',
        order: 1,
        status: 'pending',
        runReadiness: 'needs_decomposition',
        uncertaintyState: 'known_unknown',
        confidenceScore: 0.6,
        expectedPlan: parentExpectedPlan,
      },
    ],
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function makeFakeOpenClaw() {
  const fakePath = join(tempRoot, 'fake-openclaw-expected-plan.mjs');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) {
  console.log('openclaw fake expected plan declaration');
  process.exit(0);
}

const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const workDir = process.env.TASKOPS_EXPECTED_PLAN_WORK_DIR;
const mode = process.env.TASKOPS_EXPECTED_PLAN_MODE || 'valid';
if (!workDir) {
  console.error('missing TASKOPS_EXPECTED_PLAN_WORK_DIR');
  process.exit(2);
}
if (!/Expected plan metadata is required on each child task/.test(prompt)) {
  console.error('missing expectedPlan prompt contract');
  process.exit(2);
}

const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
if (!childTaskGroupId || !versionId) {
  console.error('missing target ids in prompt');
  process.exit(2);
}

const now = '2026-06-29T00:00:00.000Z';
const groupDir = join(workDir, 'task-groups', childTaskGroupId);
const versionDir = join(groupDir, 'versions', versionId);
const tasksDir = join(versionDir, 'tasks');
mkdirSync(tasksDir, { recursive: true });
mkdirSync(join(versionDir, 'eow'), { recursive: true });

writeFileSync(join(groupDir, 'index.md'), [
  '---',
  'taskOpsVersion: v1',
  'entityType: taskGroup',
  'id: ' + childTaskGroupId,
  'objective: Expected plan child group',
  'createdAt: ' + now,
  'status: active',
  'activeVersionId: ' + versionId,
  '---',
  '# ' + childTaskGroupId,
  '',
].join('\\n'), 'utf8');

writeFileSync(join(versionDir, 'index.md'), [
  '---',
  'taskOpsVersion: v1',
  'entityType: taskGroupVersion',
  'id: ' + versionId,
  'taskGroupId: ' + childTaskGroupId,
  'version: v1',
  'summary: Expected plan child version',
  'createdAt: ' + now,
  'status: active',
  '---',
  '# Expected plan child version',
  '',
].join('\\n'), 'utf8');
writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- Authored by expected plan fake.\\n', 'utf8');

const lines = [
  '---',
  'taskOpsVersion: v1',
  'entityType: task',
  'id: task-child-plan',
  'taskGroupId: ' + childTaskGroupId,
  'taskGroupVersionId: ' + versionId,
  'title: Child plan',
  'objective: Carry expectedPlan metadata.',
  'responsibility: Exercise runner expectedPlan guard.',
  'completionCriteria: expectedPlan is present after closure.',
  'order: 1',
  'createdAt: ' + now,
  'status: pending',
  'runReadiness: blocked',
  'runReadinessReason: Fixture terminal guard.',
  'uncertaintyState: known_unknown',
  'confidenceScore: 0.4',
];
if (mode === 'valid') {
  lines.push(
    'expectedPlan:',
    '  expectedDepth: 2',
    '  expectedBreadth: 4',
    '  rationale: The child has one analysis split and one verification split remaining.',
  );
} else if (mode === 'invalid') {
  lines.push(
    'expectedPlan:',
    '  expectedDepth: many',
    '  expectedBreadth: -1',
    '  rationale: ""',
  );
}
lines.push('---', '# Child plan', '');
writeFileSync(join(tasksDir, 'task-child-plan.md'), lines.join('\\n'), 'utf8');

console.log(JSON.stringify({ result: { finalAssistantRawText: 'expectedPlan fixture authored in mode ' + mode } }));
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function childTaskPath(workDir) {
  return join(workDir, 'task-groups', 'tg-plan-parent', 'versions', 'tgv-plan-parent-v1', 'tasks', 'task-child-plan.md');
}

function readEvents(workDir, runId) {
  return readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8')
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const prompt = buildAgentDecompositionPrompt({
  project: { id: 'expected-plan-prompt', title: 'Expected plan prompt', objective: 'Verify prompt asks child plans.' },
  projectDir: join(tempRoot, 'prompt-work'),
  task: {
    id: 'task-plan-parent',
    title: 'Plan parent',
    objective: 'Decompose this task.',
    responsibility: 'Exercise expected plan prompt contract.',
    completionCriteria: 'Prompt asks each child for expectedPlan.',
    uncertaintyState: 'known_unknown',
    confidenceScore: 0.6,
    expectedPlan: parentExpectedPlan,
  },
  childTaskGroupId: 'tg-plan-parent',
  versionId: 'tgv-plan-parent-v1',
});
assert.match(prompt, /Expected plan metadata is required on each child task/);
assert.match(prompt, /expectedPlan\.expectedDepth/);
assert.match(prompt, /expectedPlan\.expectedBreadth/);
assert.match(prompt, /expectedPlan\.rationale/);

try {
  const fakeOpenClaw = makeFakeOpenClaw();
  const previousOpenClawBin = process.env.TASKOPS_OPENCLAW_BIN;
  const previousWorkDir = process.env.TASKOPS_EXPECTED_PLAN_WORK_DIR;
  const previousMode = process.env.TASKOPS_EXPECTED_PLAN_MODE;
  process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClaw;

  const validWorkDir = makeWork('expected-plan-valid');
  process.env.TASKOPS_EXPECTED_PLAN_WORK_DIR = validWorkDir;
  process.env.TASKOPS_EXPECTED_PLAN_MODE = 'valid';
  const validRun = runTaskOps(validWorkDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 10,
    targetTaskId: 'task-plan-parent',
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
  assert.equal(validRun.stepsRun, 1);
  assert.equal(validRun.actions[0].status, 'completed');
  assert.equal(validRun.actions[0].expectedPlanNormalization.validCount, 1);
  assert.equal(validRun.actions[0].expectedPlanNormalization.fallbackCount, 0);
  const validChild = parseMarkdownFile(childTaskPath(validWorkDir));
  assert.deepEqual(validChild.expectedPlan, validChildExpectedPlan);
  assert.deepEqual(parseProject(validWorkDir).errors, []);

  const missingWorkDir = makeWork('expected-plan-missing');
  process.env.TASKOPS_EXPECTED_PLAN_WORK_DIR = missingWorkDir;
  process.env.TASKOPS_EXPECTED_PLAN_MODE = 'missing';
  const missingRun = runTaskOps(missingWorkDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 10,
    targetTaskId: 'task-plan-parent',
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
  assert.equal(missingRun.actions[0].expectedPlanNormalization.fallbackCount, 1);
  const missingChild = parseMarkdownFile(childTaskPath(missingWorkDir));
  assert.equal(missingChild.expectedPlan.expectedDepth, 2);
  assert.equal(missingChild.expectedPlan.expectedBreadth, 5);
  assert.match(missingChild.expectedPlan.rationale, /Runner fallback/);
  assert.match(missingChild.expectedPlan.rationale, /expectedPlan must be an object/);
  const missingEvents = readEvents(missingWorkDir, missingRun.runId);
  assert.equal(missingEvents.some((event) => event.type === 'expected_plan_fallback_applied'), true);
  assert.deepEqual(parseProject(missingWorkDir).errors, []);

  const invalidWorkDir = makeWork('expected-plan-invalid');
  process.env.TASKOPS_EXPECTED_PLAN_WORK_DIR = invalidWorkDir;
  process.env.TASKOPS_EXPECTED_PLAN_MODE = 'invalid';
  const invalidRun = runTaskOps(invalidWorkDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 10,
    targetTaskId: 'task-plan-parent',
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
  assert.equal(invalidRun.actions[0].expectedPlanNormalization.fallbackCount, 1);
  const invalidChild = parseMarkdownFile(childTaskPath(invalidWorkDir));
  assert.equal(invalidChild.expectedPlan.expectedDepth, 2);
  assert.equal(invalidChild.expectedPlan.expectedBreadth, 5);
  assert.match(invalidChild.expectedPlan.rationale, /expectedPlan.expectedDepth must be a non-negative integer/);
  run(['restart', invalidWorkDir, '--from', 'task-child-plan', '--instruction', 'Verify fallback expectedPlan survives restart.', '--reason', 'expected_plan_fallback_preservation']);
  const restartedChild = parseMarkdownFile(join(invalidWorkDir, 'task-groups', 'tg-plan-parent', 'versions', 'tgv-plan-parent-v2', 'tasks', 'task-child-plan.md'));
  assert.deepEqual(restartedChild.expectedPlan, invalidChild.expectedPlan);
  assert.deepEqual(parseProject(invalidWorkDir).errors, []);

  if (previousOpenClawBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
  else process.env.TASKOPS_OPENCLAW_BIN = previousOpenClawBin;
  if (previousWorkDir == null) delete process.env.TASKOPS_EXPECTED_PLAN_WORK_DIR;
  else process.env.TASKOPS_EXPECTED_PLAN_WORK_DIR = previousWorkDir;
  if (previousMode == null) delete process.env.TASKOPS_EXPECTED_PLAN_MODE;
  else process.env.TASKOPS_EXPECTED_PLAN_MODE = previousMode;

  console.log('expected plan declaration smoke passed');
} catch (err) {
  console.error(err);
  process.exit(1);
}
