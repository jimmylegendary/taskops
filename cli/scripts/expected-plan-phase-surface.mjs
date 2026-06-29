#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXPECTED_PLAN_PHASE_THRESHOLDS,
  buildAgentDecompositionPrompt,
  buildAgentExecutionPrompt,
  buildAgentExplorationPrompt,
  buildAgentLoopbackPrompt,
  computeStepBudget,
  expectedPlanPhaseForProgress,
} from '../lib-runner.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-expected-plan-phase-surface-'));

function coordinateFor(progress) {
  const phase = expectedPlanPhaseForProgress(progress);
  return {
    enabled: true,
    source: 'expectedPlan',
    taskId: 'task-phase',
    consumedDepth: progress === 0 ? 0 : 1,
    consumedDepthSinceDeclaration: progress === 0 ? 0 : 1,
    expectedDepth: progress === 0 ? 3 : Math.round(1 / progress),
    expectedBreadth: 2,
    planProgress: progress,
    phase,
    phaseThresholds: { ...EXPECTED_PLAN_PHASE_THRESHOLDS },
    rationale: 'Phase surface fixture.',
    lineageDiagnostic: {
      consumedDepth: progress === 0 ? 0 : 1,
      cumulativeExpectedDepth: 4,
      cumulativePlanProgress: progress / 2,
      planCount: 2,
    },
  };
}

function budgetFor(progress, { finishingMode = false } = {}) {
  return {
    ...computeStepBudget({ stepsRun: finishingMode ? 2 : 1, maxSteps: 4, budgetEnabled: true }),
    finishingMode,
    expectedPlanCoordinate: coordinateFor(progress),
  };
}

function fixtureProject() {
  return { id: 'expected-plan-phase', title: 'Expected Plan Phase', objective: 'Phase surface fixture' };
}

function fixtureTask() {
  return {
    id: 'task-phase',
    title: 'Phase task',
    objective: 'Check action-aware phase prompt surface.',
    responsibility: 'Own phase surface fixture.',
    completionCriteria: 'Prompt includes the expected advisory wording.',
    expectedPlan: {
      expectedDepth: 2,
      expectedBreadth: 2,
      rationale: 'Prompt fixture.',
    },
  };
}

function assertOnlyAction(prompt, expected, unexpected) {
  assert.match(prompt, new RegExp(`${expected} advisory:`));
  for (const label of unexpected) {
    assert.doesNotMatch(prompt, new RegExp(`${label} advisory:`));
  }
}

try {
  assert.deepEqual(EXPECTED_PLAN_PHASE_THRESHOLDS, { soft: 0.5, hard: 0.85 });
  assert.equal(expectedPlanPhaseForProgress(0), 'exploring');
  assert.equal(expectedPlanPhaseForProgress(0.499), 'exploring');
  assert.equal(expectedPlanPhaseForProgress(0.5), 'converging');
  assert.equal(expectedPlanPhaseForProgress(0.6), 'converging');
  assert.equal(expectedPlanPhaseForProgress(0.84), 'converging');
  assert.equal(expectedPlanPhaseForProgress(0.85), 'committing');
  assert.equal(expectedPlanPhaseForProgress(1), 'committing');

  const project = fixtureProject();
  const task = fixtureTask();
  const baseline = buildAgentExecutionPrompt({ project, task });
  const legacy = buildAgentExecutionPrompt({
    project,
    task,
    budget: computeStepBudget({ stepsRun: 1, maxSteps: 4, budgetEnabled: true }),
  });
  assert.equal(legacy, baseline, 'planless/coordinate-less budget surface must remain legacy byte-compatible');

  const decompose = buildAgentDecompositionPrompt({
    project,
    projectDir: tempRoot,
    task,
    childTaskGroupId: 'tg-phase-child',
    versionId: 'tgv-phase-child-v1',
    budget: budgetFor(0.85),
  });
  assert.match(decompose, /Expected plan phase: committing\./);
  assert.match(decompose, /Decomposition advisory: committing phase\./);
  assert.match(decompose, /unless it is strictly necessary and still fully closable/);
  assertOnlyAction(decompose, 'Decomposition', ['Execution', 'Exploration', 'Loopback']);
  assert.doesNotMatch(decompose, /Runner enforcement|hard block|refuse/i);

  const execute = buildAgentExecutionPrompt({
    project,
    task,
    budget: budgetFor(0.6),
  });
  assert.match(execute, /Expected plan phase: converging\./);
  assert.match(execute, /Execution advisory: converging phase\./);
  assertOnlyAction(execute, 'Execution', ['Decomposition', 'Exploration', 'Loopback']);
  assert.doesNotMatch(execute, /Execution partial request protocol:/, 'phase alone must not expose the partial protocol');

  const executeFinishing = buildAgentExecutionPrompt({
    project,
    task,
    budget: budgetFor(1, { finishingMode: true }),
  });
  assert.match(executeFinishing, /Expected plan phase: committing\./);
  assert.match(executeFinishing, /Budget \/ finishing mode:/);
  assert.match(executeFinishing, /Execution partial request protocol:/, 'finishingMode still controls partial protocol');

  const explore = buildAgentExplorationPrompt({
    project,
    task,
    runId: 'run-main',
    runNodeId: 'run-node-explore',
    artifactPath: join(tempRoot, 'runs', 'run-main', 'artifacts', 'run-node-explore.md'),
    budget: budgetFor(0.499),
  });
  assert.match(explore, /Expected plan phase: exploring\./);
  assert.match(explore, /Exploration advisory: exploring phase\./);
  assertOnlyAction(explore, 'Exploration', ['Decomposition', 'Execution', 'Loopback']);

  const loopback = buildAgentLoopbackPrompt({
    project,
    delegate: {
      runId: 'run-main',
      id: 'run-node-delegate',
      status: 'waiting',
      type: 'delegate',
      request: 'Resolve phase fixture delegation.',
      expectedOutput: 'A concise answer.',
      sourceTaskId: task.id,
      sourceTaskGroupVersionId: 'tgv-root-v1',
    },
    runId: 'run-main',
    loopbackNodeId: 'run-node-loopback',
    artifactPath: join(tempRoot, 'runs', 'run-main', 'artifacts', 'run-node-loopback.md'),
    actorName: 'self',
    budget: budgetFor(0.85),
  });
  assert.match(loopback, /Expected plan phase: committing\./);
  assert.match(loopback, /Loopback advisory: committing phase\./);
  assertOnlyAction(loopback, 'Loopback', ['Decomposition', 'Execution', 'Exploration']);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('expected plan phase surface smoke passed');
