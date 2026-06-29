#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyTaskReadiness, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-expected-plan-committing-guard-'));

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

function taskIdFor(id) {
  return `task-${id}`;
}

function childGroupIdFor(id) {
  return `tg-${id}`;
}

function childVersionIdFor(id) {
  return `tgv-${id}-v1`;
}

function childTaskPath(workDir, id, childTaskId, versionId = childVersionIdFor(id)) {
  return join(workDir, 'task-groups', childGroupIdFor(id), 'versions', versionId, 'tasks', `${childTaskId}.md`);
}

function makeWork(id, { expectedPlan = null } = {}) {
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Verify committing scope deferral.', '--language', 'en']);
  const task = {
    id: taskIdFor(id),
    title: 'Committing guard parent',
    objective: 'Decompose into child tasks for committing guard verification.',
    responsibility: 'Exercise post-authoring committing scope deferral.',
    completionCriteria: 'Child task readiness is normalized only when committing guard conditions apply.',
    order: 1,
    status: 'pending',
    runReadiness: 'needs_decomposition',
  };
  if (expectedPlan) task.expectedPlan = expectedPlan;
  const specPath = join(tempRoot, `${id}-root-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Committing guard fixture',
    selected: true,
    tasks: [task],
  }, null, 2), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function makeFakeOpenClaw() {
  const fakePath = join(tempRoot, 'fake-openclaw-committing-guard.mjs');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) {
  console.log('openclaw fake committing guard');
  process.exit(0);
}

const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const workDir = process.env.TASKOPS_COMMIT_GUARD_WORK_DIR;
const mode = process.env.TASKOPS_COMMIT_GUARD_MODE || 'mixed';
const expectedPhase = process.env.TASKOPS_COMMIT_GUARD_EXPECTED_PHASE || '';
if (!workDir) {
  console.error('missing TASKOPS_COMMIT_GUARD_WORK_DIR');
  process.exit(2);
}
if (expectedPhase === 'none') {
  if (/Expected plan phase:/.test(prompt)) {
    console.error('planless prompt unexpectedly included expected plan phase');
    process.exit(2);
  }
} else if (expectedPhase && !new RegExp('Expected plan phase: ' + expectedPhase + '\\\\.').test(prompt)) {
  console.error('expected phase ' + expectedPhase + ' missing from prompt');
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
  'objective: Committing guard child group',
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
  'summary: Committing guard child version',
  'createdAt: ' + now,
  'status: active',
  '---',
  '# Committing guard child version',
  '',
].join('\\n'), 'utf8');
writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- Authored by committing guard fake.\\n', 'utf8');

const taskSets = {
  mixed: [
    {
      id: 'task-child-needs-decomposition',
      title: 'Child needs decomposition',
      objective: 'Open another child scope.',
      responsibility: 'Represent worker-authored deeper scope.',
      completionCriteria: 'This should be deferred only in committing phase.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      runReadinessReason: 'Worker authored another decomposition scope.',
      expectedDepth: 1,
      expectedBreadth: 2,
    },
    {
      id: 'task-child-runnable',
      title: 'Child runnable',
      objective: 'Remain runnable terminal work.',
      responsibility: 'Verify terminal runnable child is untouched.',
      completionCriteria: 'Runnable terminal child remains runnable.',
      order: 2,
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Worker authored terminal runnable child.',
      expectedDepth: 0,
      expectedBreadth: 1,
    },
    {
      id: 'task-child-blocked',
      title: 'Child blocked',
      objective: 'Remain blocked terminal work.',
      responsibility: 'Verify terminal blocked child is untouched.',
      completionCriteria: 'Blocked terminal child remains blocked.',
      order: 3,
      status: 'blocked',
      runReadiness: 'blocked',
      runReadinessReason: 'Worker authored terminal blocked child.',
      expectedDepth: 0,
      expectedBreadth: 0,
    },
    {
      id: 'task-child-explore',
      title: 'Child explore',
      objective: 'Remain exploration-ready terminal work.',
      responsibility: 'Verify exploration-ready child is untouched.',
      completionCriteria: 'Exploration-ready child remains needs_exploration.',
      order: 4,
      status: 'pending',
      runReadiness: 'needs_exploration',
      runReadinessReason: 'Worker authored terminal exploration-ready child.',
      expectedDepth: 0,
      expectedBreadth: 1,
    },
  ],
  terminal: [
    {
      id: 'task-child-runnable',
      title: 'Child runnable',
      objective: 'Remain runnable terminal work.',
      responsibility: 'Verify no-op guard for terminal-only decomposition.',
      completionCriteria: 'Runnable child remains runnable.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Worker authored terminal runnable child.',
      expectedDepth: 0,
      expectedBreadth: 1,
    },
    {
      id: 'task-child-blocked',
      title: 'Child blocked',
      objective: 'Remain blocked terminal work.',
      responsibility: 'Verify no-op guard for blocked terminal child.',
      completionCriteria: 'Blocked child remains blocked.',
      order: 2,
      status: 'blocked',
      runReadiness: 'blocked',
      runReadinessReason: 'Worker authored terminal blocked child.',
      expectedDepth: 0,
      expectedBreadth: 0,
    },
  ],
  needsOnly: [
    {
      id: 'task-child-needs-decomposition',
      title: 'Child needs decomposition',
      objective: 'Open another child scope.',
      responsibility: 'Verify non-committing and planless guard no-op.',
      completionCriteria: 'Child remains needs_decomposition when guard is inactive.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      runReadinessReason: 'Worker authored another decomposition scope.',
      expectedDepth: 1,
      expectedBreadth: 2,
    },
  ],
};

const tasks = taskSets[mode];
if (!tasks) {
  console.error('unknown mode ' + mode);
  process.exit(2);
}

for (const task of tasks) {
  const lines = [
    '---',
    'taskOpsVersion: v1',
    'entityType: task',
    'id: ' + task.id,
    'taskGroupId: ' + childTaskGroupId,
    'taskGroupVersionId: ' + versionId,
    'title: ' + task.title,
    'objective: ' + task.objective,
    'responsibility: ' + task.responsibility,
    'completionCriteria: ' + task.completionCriteria,
    'order: ' + task.order,
    'createdAt: ' + now,
    'status: ' + task.status,
    'runReadiness: ' + task.runReadiness,
    'runReadinessReason: ' + task.runReadinessReason,
    'expectedPlan:',
    '  expectedDepth: ' + task.expectedDepth,
    '  expectedBreadth: ' + task.expectedBreadth,
    '  rationale: Guard fixture plan for ' + task.id + '.',
    '---',
    '# ' + task.title,
    '',
  ];
  writeFileSync(join(tasksDir, task.id + '.md'), lines.join('\\n'), 'utf8');
}

console.log(JSON.stringify({ result: { finalAssistantRawText: 'committing guard fixture authored in mode ' + mode } }));
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function readEvents(workDir, runId) {
  const text = readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8').trim();
  if (!text) return [];
  return text.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

function countOpenNeedsDecomposition(parsed) {
  return [...parsed.tasks.values()].filter((task) => (
    !['done', 'cancelled'].includes(task.status)
    && task.runReadiness === 'needs_decomposition'
  )).length;
}

function runOne(workDir, id, { mode, expectedPhase }) {
  process.env.TASKOPS_COMMIT_GUARD_WORK_DIR = workDir;
  process.env.TASKOPS_COMMIT_GUARD_MODE = mode;
  process.env.TASKOPS_COMMIT_GUARD_EXPECTED_PHASE = expectedPhase;
  return runTaskOps(workDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 10,
    targetTaskId: taskIdFor(id),
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
}

try {
  const fakeOpenClaw = makeFakeOpenClaw();
  const previousOpenClawBin = process.env.TASKOPS_OPENCLAW_BIN;
  const previousWorkDir = process.env.TASKOPS_COMMIT_GUARD_WORK_DIR;
  const previousMode = process.env.TASKOPS_COMMIT_GUARD_MODE;
  const previousExpectedPhase = process.env.TASKOPS_COMMIT_GUARD_EXPECTED_PHASE;
  process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClaw;

  const committingPlan = {
    expectedDepth: 0,
    expectedBreadth: 4,
    rationale: 'Parent is already in committing phase.',
  };
  const exploringPlan = {
    expectedDepth: 4,
    expectedBreadth: 4,
    rationale: 'Parent is still in exploring phase.',
  };

  const mixedId = 'commit-mixed';
  const mixedWorkDir = makeWork(mixedId, { expectedPlan: committingPlan });
  const mixedRun = runOne(mixedWorkDir, mixedId, { mode: 'mixed', expectedPhase: 'committing' });
  assert.equal(mixedRun.actions[0].status, 'completed');
  assert.equal(mixedRun.actions[0].committingScopeDeferral.enabled, true);
  assert.equal(mixedRun.actions[0].committingScopeDeferral.deferredCount, 1);
  assert.equal(mixedRun.actions[0].committingScopeDeferral.deferredChildren[0].originalRunReadiness, 'needs_decomposition');

  const mixedEvents = readEvents(mixedWorkDir, mixedRun.runId);
  const deferralEvents = mixedEvents.filter((event) => event.type === 'committing_scope_deferred');
  assert.equal(deferralEvents.length, 1);
  assert.equal(deferralEvents[0].summary.deferredCount, 1);
  assert.equal(deferralEvents[0].summary.guardMode, 'soft_post_authoring');
  assert.equal(deferralEvents[0].summary.reason, 'committing_phase_needs_decomposition_child');
  assert.equal(deferralEvents[0].coordinate.phase, 'committing');
  assert.equal(deferralEvents[0].coordinate.planProgress, 1);
  assert.equal(deferralEvents[0].deferredChildren[0].taskId, 'task-child-needs-decomposition');
  assert.equal(deferralEvents[0].deferredChildren[0].originalRunReadiness, 'needs_decomposition');
  assert.equal(deferralEvents[0].deferredChildren[0].newRunReadiness, 'blocked');

  const deferredChild = parseMarkdownFile(childTaskPath(mixedWorkDir, mixedId, 'task-child-needs-decomposition'));
  assert.equal(deferredChild.status, 'blocked');
  assert.equal(deferredChild.runReadiness, 'blocked');
  assert.match(deferredChild.runReadinessReason, /Committing scope deferred by taskops-runner/);
  assert.equal(deferredChild.expectedPlan.expectedDepth, 1, 'guard must not overwrite expectedPlan normalization');

  const runnableChild = parseMarkdownFile(childTaskPath(mixedWorkDir, mixedId, 'task-child-runnable'));
  assert.equal(runnableChild.status, 'pending');
  assert.equal(runnableChild.runReadiness, 'runnable');
  assert.equal(runnableChild.runReadinessReason, 'Worker authored terminal runnable child.');

  const blockedChild = parseMarkdownFile(childTaskPath(mixedWorkDir, mixedId, 'task-child-blocked'));
  assert.equal(blockedChild.status, 'blocked');
  assert.equal(blockedChild.runReadiness, 'blocked');
  assert.equal(blockedChild.runReadinessReason, 'Worker authored terminal blocked child.');

  const exploreChild = parseMarkdownFile(childTaskPath(mixedWorkDir, mixedId, 'task-child-explore'));
  assert.equal(exploreChild.status, 'pending');
  assert.equal(exploreChild.runReadiness, 'needs_exploration');
  assert.equal(exploreChild.runReadinessReason, 'Worker authored terminal exploration-ready child.');

  const mixedParsed = parseProject(mixedWorkDir);
  assert.deepEqual(mixedParsed.errors, []);
  assert.equal(countOpenNeedsDecomposition(mixedParsed), 0, 'committing guard should leave no open needs_decomposition child');

  run(['restart', mixedWorkDir, '--from', 'task-child-needs-decomposition', '--instruction', 'Review deferred committing scope before expanding.', '--reason', 'committing_scope_review']);
  const restartedDeferredChild = parseMarkdownFile(childTaskPath(mixedWorkDir, mixedId, 'task-child-needs-decomposition', 'tgv-commit-mixed-v2'));
  assert.equal(restartedDeferredChild.status, 'pending');
  assert.equal(restartedDeferredChild.runReadiness, 'blocked');
  assert.equal(classifyTaskReadiness(restartedDeferredChild).runReadiness, 'blocked');
  const restartParsed = parseProject(mixedWorkDir);
  assert.deepEqual(restartParsed.errors, []);
  const blockedTargetRun = runTaskOps(mixedWorkDir, {
    executor: 'dry-run',
    maxSteps: 1,
    maxStepsExplicit: true,
    targetTaskId: 'task-child-needs-decomposition',
    targetTaskGroupVersionId: 'tgv-commit-mixed-v2',
    allowConcurrentTarget: true,
  });
  assert.equal(blockedTargetRun.stepsRun, 0);
  assert.equal(blockedTargetRun.stopReason, 'blocked_only');

  const terminalId = 'commit-terminal';
  const terminalWorkDir = makeWork(terminalId, { expectedPlan: committingPlan });
  const terminalRun = runOne(terminalWorkDir, terminalId, { mode: 'terminal', expectedPhase: 'committing' });
  assert.equal(terminalRun.actions[0].committingScopeDeferral.enabled, true);
  assert.equal(terminalRun.actions[0].committingScopeDeferral.deferredCount, 0);
  assert.equal(readEvents(terminalWorkDir, terminalRun.runId).some((event) => event.type === 'committing_scope_deferred'), false);
  assert.equal(parseMarkdownFile(childTaskPath(terminalWorkDir, terminalId, 'task-child-runnable')).runReadiness, 'runnable');
  assert.deepEqual(parseProject(terminalWorkDir).errors, []);

  const exploringId = 'explore-needs';
  const exploringWorkDir = makeWork(exploringId, { expectedPlan: exploringPlan });
  const exploringRun = runOne(exploringWorkDir, exploringId, { mode: 'needsOnly', expectedPhase: 'exploring' });
  assert.equal(exploringRun.actions[0].committingScopeDeferral.enabled, false);
  assert.equal(exploringRun.actions[0].committingScopeDeferral.deferredCount, 0);
  assert.equal(readEvents(exploringWorkDir, exploringRun.runId).some((event) => event.type === 'committing_scope_deferred'), false);
  const exploringChild = parseMarkdownFile(childTaskPath(exploringWorkDir, exploringId, 'task-child-needs-decomposition'));
  assert.equal(exploringChild.status, 'pending');
  assert.equal(exploringChild.runReadiness, 'needs_decomposition');
  assert.deepEqual(parseProject(exploringWorkDir).errors, []);

  const planlessId = 'planless-needs';
  const planlessWorkDir = makeWork(planlessId);
  const planlessRun = runOne(planlessWorkDir, planlessId, { mode: 'needsOnly', expectedPhase: 'none' });
  assert.equal(planlessRun.actions[0].committingScopeDeferral.enabled, false);
  assert.equal(planlessRun.actions[0].committingScopeDeferral.deferredCount, 0);
  assert.equal(readEvents(planlessWorkDir, planlessRun.runId).some((event) => event.type === 'committing_scope_deferred'), false);
  const planlessChild = parseMarkdownFile(childTaskPath(planlessWorkDir, planlessId, 'task-child-needs-decomposition'));
  assert.equal(planlessChild.status, 'pending');
  assert.equal(planlessChild.runReadiness, 'needs_decomposition');
  assert.deepEqual(parseProject(planlessWorkDir).errors, []);

  if (previousOpenClawBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
  else process.env.TASKOPS_OPENCLAW_BIN = previousOpenClawBin;
  if (previousWorkDir == null) delete process.env.TASKOPS_COMMIT_GUARD_WORK_DIR;
  else process.env.TASKOPS_COMMIT_GUARD_WORK_DIR = previousWorkDir;
  if (previousMode == null) delete process.env.TASKOPS_COMMIT_GUARD_MODE;
  else process.env.TASKOPS_COMMIT_GUARD_MODE = previousMode;
  if (previousExpectedPhase == null) delete process.env.TASKOPS_COMMIT_GUARD_EXPECTED_PHASE;
  else process.env.TASKOPS_COMMIT_GUARD_EXPECTED_PHASE = previousExpectedPhase;

  console.log('expected plan committing guard smoke passed');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
