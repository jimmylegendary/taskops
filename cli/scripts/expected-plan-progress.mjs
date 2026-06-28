#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildAgentDecompositionPrompt,
  buildAgentExecutionPrompt,
  computeExpectedPlanCoordinate,
  computeStepBudget,
} from '../lib-runner.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-expected-plan-progress-'));
const cli = new URL('../bin/taskops.js', import.meta.url).pathname;

function run(args, expected = 0) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  if (result.status !== expected) {
    console.error('CMD FAILED', args.join(' '));
    console.error(result.stdout);
    console.error(result.stderr);
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(1);
  }
  return result;
}

function taskKey(versionId, taskId) {
  return `${versionId}:${taskId}`;
}

function makeParsedDepthFixture() {
  const rootTask = {
    id: 'task-root-plan',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Root plan',
    expectedPlan: {
      expectedDepth: 2,
      expectedBreadth: 2,
      rationale: 'Root expects two lineage levels.',
    },
    childTaskGroupId: 'tg-child-plan',
  };
  const childTask = {
    id: 'task-child-plan',
    taskGroupId: 'tg-child-plan',
    taskGroupVersionId: 'tgv-child-plan-v1',
    title: 'Child plan',
    expectedPlan: {
      expectedDepth: 2,
      expectedBreadth: 1,
      rationale: 'Child expects two local levels.',
    },
    childTaskGroupId: 'tg-grandchild-plan',
  };
  const grandchildTask = {
    id: 'task-grandchild-terminal-plan',
    taskGroupId: 'tg-grandchild-plan',
    taskGroupVersionId: 'tgv-grandchild-plan-v1',
    title: 'Grandchild terminal plan',
    expectedPlan: {
      expectedDepth: 0,
      expectedBreadth: 0,
      rationale: 'Grandchild is terminal by plan.',
    },
  };
  const rootVersion = {
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    tasks: [rootTask],
  };
  const childVersion = {
    id: 'tgv-child-plan-v1',
    taskGroupId: 'tg-child-plan',
    decomposedFromTaskId: rootTask.id,
    decomposedFromTaskGroupId: rootTask.taskGroupId,
    decomposedFromTaskGroupVersionId: rootTask.taskGroupVersionId,
    decomposedByRunId: 'run-main',
    decomposedByRunNodeId: 'run-node-root',
    tasks: [childTask],
  };
  const grandchildVersion = {
    id: 'tgv-grandchild-plan-v1',
    taskGroupId: 'tg-grandchild-plan',
    decomposedFromTaskId: childTask.id,
    decomposedFromTaskGroupId: childTask.taskGroupId,
    decomposedFromTaskGroupVersionId: childTask.taskGroupVersionId,
    decomposedByRunId: 'run-main',
    decomposedByRunNodeId: 'run-node-child',
    tasks: [grandchildTask],
  };
  const activeSnapshot = {
    id: 'snapshot-root-v1',
    selectedVersions: [
      { taskGroupId: 'tg-root', versionId: rootVersion.id },
      { taskGroupId: 'tg-child-plan', versionId: childVersion.id },
      { taskGroupId: 'tg-grandchild-plan', versionId: grandchildVersion.id },
    ],
  };
  const parsed = {
    project: { id: 'expected-plan-progress', activeSnapshotId: activeSnapshot.id },
    snapshots: new Map([[activeSnapshot.id, activeSnapshot]]),
    versions: new Map([
      [rootVersion.id, rootVersion],
      [childVersion.id, childVersion],
      [grandchildVersion.id, grandchildVersion],
    ]),
    tasks: new Map([
      [taskKey(rootTask.taskGroupVersionId, rootTask.id), rootTask],
      [taskKey(childTask.taskGroupVersionId, childTask.id), childTask],
      [taskKey(grandchildTask.taskGroupVersionId, grandchildTask.id), grandchildTask],
    ]),
    runNodes: new Map(),
  };
  return { parsed, activeSnapshot, rootTask, childTask, grandchildTask };
}

function makeRunnableWork(name, { includePlan }) {
  const workDir = join(tempRoot, name);
  run(['init', workDir, '--id', name, '--title', name, '--objective', 'Expected plan progress smoke', '--language', 'en']);
  const specPath = join(tempRoot, `${name}-spec.json`);
  const task = {
    id: 'task-progress',
    title: 'Progress task',
    objective: 'Run once so the runner exposes prompt-time expectedPlan coordinate.',
    responsibility: 'Own expectedPlan progress smoke.',
    completionCriteria: 'Dry-run runner completes the task and returns budget metadata.',
    status: 'pending',
    runReadiness: 'runnable',
    runReadinessReason: 'Runnable fixture.',
    order: 1,
  };
  if (includePlan) {
    task.expectedPlan = {
      expectedDepth: 0,
      expectedBreadth: 0,
      rationale: 'Runnable fixture is terminal and should not need decomposition.',
    };
  }
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Expected plan progress runnable fixture',
    selected: true,
    tasks: [task],
  }, null, 2));
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
  return workDir;
}

try {
  const { parsed, activeSnapshot, rootTask, childTask, grandchildTask } = makeParsedDepthFixture();
  const rootCoordinate = computeExpectedPlanCoordinate({ parsed, task: rootTask, activeSnapshot });
  assert.equal(rootCoordinate.consumedDepth, 0);
  assert.equal(rootCoordinate.consumedDepthSinceDeclaration, 0);
  assert.equal(rootCoordinate.expectedDepth, 2);
  assert.equal(rootCoordinate.planProgress, 0);

  const childCoordinate = computeExpectedPlanCoordinate({ parsed, task: childTask, activeSnapshot });
  assert.equal(childCoordinate.consumedDepth, 1);
  assert.equal(childCoordinate.consumedDepthSinceDeclaration, 1);
  assert.equal(childCoordinate.expectedDepth, 2);
  assert.equal(childCoordinate.planProgress, 0.5);
  assert.equal(childCoordinate.lineageDiagnostic.cumulativeExpectedDepth, 4);
  assert.equal(childCoordinate.lineageDiagnostic.cumulativePlanProgress, 0.25);

  const grandchildCoordinate = computeExpectedPlanCoordinate({ parsed, task: grandchildTask, activeSnapshot });
  assert.equal(grandchildCoordinate.consumedDepth, 2);
  assert.equal(grandchildCoordinate.expectedDepth, 0);
  assert.equal(grandchildCoordinate.planProgress, 1, 'expectedDepth=0 must be divide-by-zero safe and clamp to complete progress');
  assert.equal(grandchildCoordinate.lineageDiagnostic.cumulativeExpectedDepth, 4);
  assert.equal(grandchildCoordinate.lineageDiagnostic.cumulativePlanProgress, 0.5);

  const noPlanCoordinate = computeExpectedPlanCoordinate({
    parsed,
    task: { id: 'task-no-plan', taskGroupVersionId: 'tgv-root-v1' },
    activeSnapshot,
  });
  assert.equal(noPlanCoordinate, null);

  const promptProject = { id: 'expected-plan-progress', title: 'Expected Plan Progress', objective: 'Prompt coordinate fixture' };
  const promptTask = {
    id: 'task-prompt',
    title: 'Prompt task',
    objective: 'Check expectedPlan coordinate prompt.',
    responsibility: 'Own prompt coordinate fixture.',
    completionCriteria: 'The prompt exposes coordinates without enabling phase transitions.',
    expectedPlan: childTask.expectedPlan,
  };
  const baselinePrompt = buildAgentExecutionPrompt({ project: promptProject, task: promptTask });
  const legacyPrompt = buildAgentExecutionPrompt({
    project: promptProject,
    task: promptTask,
    budget: computeStepBudget({ stepsRun: 1, maxSteps: 4, budgetEnabled: true }),
  });
  assert.equal(legacyPrompt, baselinePrompt, 'budget without derived expectedPlan coordinate must preserve legacy prompt bytes');

  const coordinateBudget = {
    ...computeStepBudget({ stepsRun: 1, maxSteps: 4, budgetEnabled: true }),
    expectedPlanCoordinate: childCoordinate,
  };
  const coordinatePrompt = buildAgentDecompositionPrompt({
    project: promptProject,
    projectDir: tempRoot,
    task: promptTask,
    childTaskGroupId: 'tg-child',
    versionId: 'tgv-child-v1',
    budget: coordinateBudget,
  });
  assert.match(coordinatePrompt, /Budget \/ expected plan coordinate:/);
  assert.match(coordinatePrompt, /Remaining step budget: 3 \/ 4\./);
  assert.match(coordinatePrompt, /Lineage depth consumed: 1\. Current task expectedDepth: 2\. Consumed\/expected progress: 1 \/ 2 \(50%\)\./);
  assert.match(coordinatePrompt, /Diagnostic only: lineage cumulative expectedDepth=4, lineage progress=1\/4 \(25%\)\./);
  assert.doesNotMatch(coordinatePrompt, /Budget \/ finishing mode:/);
  assert.doesNotMatch(coordinatePrompt, /exploring|converging|committing/i);

  const executionCoordinatePrompt = buildAgentExecutionPrompt({
    project: promptProject,
    task: promptTask,
    budget: coordinateBudget,
  });
  assert.match(executionCoordinatePrompt, /Budget \/ expected plan coordinate:/);
  assert.doesNotMatch(executionCoordinatePrompt, /Execution partial request protocol:/, 'non-finishing coordinate prompt must not expose partial protocol');

  const planWork = makeRunnableWork('expected-plan-progress-work', { includePlan: true });
  const planRun = JSON.parse(run(['run', planWork, '--executor', 'dry-run', '--max-steps', '4', '--json']).stdout);
  assert.equal(planRun.actions[0].budget.expectedPlanCoordinate.enabled, true);
  assert.equal(planRun.actions[0].budget.expectedPlanCoordinate.consumedDepth, 0);
  assert.equal(planRun.actions[0].budget.expectedPlanCoordinate.expectedDepth, 0);
  assert.equal(planRun.actions[0].budget.expectedPlanCoordinate.planProgress, 1);

  const legacyWork = makeRunnableWork('expected-plan-progress-legacy-work', { includePlan: false });
  const legacyRun = JSON.parse(run(['run', legacyWork, '--executor', 'dry-run', '--max-steps', '4', '--json']).stdout);
  assert.equal(legacyRun.actions[0].budget.expectedPlanCoordinate, undefined);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('expected plan progress smoke passed');
