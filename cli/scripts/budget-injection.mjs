#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAgentExecutionPrompt,
  computeStepBudget,
  FINISHING_MODE_RESERVE,
} from '../lib-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-budget-'));

function run(args, expected = 0) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  if (res.status !== expected) {
    console.error('CMD FAILED', args.join(' '));
    console.error(res.stdout);
    console.error(res.stderr);
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(1);
  }
  return res;
}

function makeRunnableWork(name) {
  const workDir = join(tempRoot, name);
  run(['init', workDir, '--id', name, '--title', name, '--objective', 'Budget injection smoke work', '--language', 'en']);
  const specPath = join(tempRoot, `${name}-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Budget runnable task',
    selected: true,
    tasks: [{
      id: 'task-budget',
      title: 'Budget task',
      objective: 'Run once so the JSON result exposes the step budget.',
      responsibility: 'Own the dry-run budget smoke.',
      completionCriteria: 'Dry-run runner completes the task and records budget metadata.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'The fixture has objective, responsibility, and completion criteria.',
      understandingLevel: 'known',
      order: 1,
    }],
  }, null, 2));
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
  return workDir;
}

try {
  assert.equal(FINISHING_MODE_RESERVE(10), 2);
  assert.equal(FINISHING_MODE_RESERVE(3), 2);

  assert.deepEqual(
    computeStepBudget({ stepsRun: 8, maxSteps: 10, budgetEnabled: false }),
    { enabled: false, finishingMode: false },
    'budget disabled should be a no-op even when maxSteps exists',
  );
  assert.deepEqual(
    computeStepBudget({ stepsRun: 7, maxSteps: 10, budgetEnabled: true }),
    { enabled: true, stepsRun: 7, maxSteps: 10, remaining: 3, finishingMode: false },
    '10-step budget should not enter finishing mode with 3 steps remaining',
  );
  assert.deepEqual(
    computeStepBudget({ stepsRun: 8, maxSteps: 10, budgetEnabled: true }),
    { enabled: true, stepsRun: 8, maxSteps: 10, remaining: 2, finishingMode: true },
    '10-step budget should enter finishing mode with 2 steps remaining',
  );
  assert.deepEqual(
    computeStepBudget({ stepsRun: 1, maxSteps: 3, budgetEnabled: true }),
    { enabled: true, stepsRun: 1, maxSteps: 3, remaining: 2, finishingMode: true },
    'small budgets should honor the reserve floor of 2 steps',
  );

  const promptProject = { id: 'budget-work', title: 'Budget Work', objective: 'Budget prompt fixture' };
  const promptTask = {
    id: 'task-budget',
    title: 'Budget task',
    objective: 'Check prompt budget suffix behavior.',
    responsibility: 'Own the prompt fixture.',
    completionCriteria: 'The prompt is byte-identical until finishing mode is enabled.',
  };
  const baselinePrompt = buildAgentExecutionPrompt({ project: promptProject, task: promptTask });
  const disabledPrompt = buildAgentExecutionPrompt({
    project: promptProject,
    task: promptTask,
    budget: computeStepBudget({ stepsRun: 8, maxSteps: 10, budgetEnabled: false }),
  });
  assert.equal(disabledPrompt, baselinePrompt, 'disabled budget must preserve the exact prompt bytes');

  const finishingPrompt = buildAgentExecutionPrompt({
    project: promptProject,
    task: promptTask,
    budget: computeStepBudget({ stepsRun: 8, maxSteps: 10, budgetEnabled: true }),
  });
  assert.ok(finishingPrompt.startsWith(baselinePrompt), 'finishing prompt should preserve the stable prefix');
  assert.match(finishingPrompt, /남은 step이 얼마 없다 \(remaining 2 \/ 10\)/);

  const noBudgetWork = makeRunnableWork('budget-disabled-work');
  const noBudgetRun = JSON.parse(run(['run', noBudgetWork, '--executor', 'dry-run', '--json']).stdout);
  assert.equal(noBudgetRun.maxStepsExplicit, false);
  assert.deepEqual(noBudgetRun.finalBudget, { enabled: false, finishingMode: false });
  assert.equal(noBudgetRun.actions[0].budget.enabled, false);
  assert.equal(noBudgetRun.actions[0].budget.finishingMode, false);

  const explicitBudgetWork = makeRunnableWork('budget-enabled-work');
  const explicitBudgetRun = JSON.parse(run(['run', explicitBudgetWork, '--executor', 'dry-run', '--max-steps', '1', '--json']).stdout);
  assert.equal(explicitBudgetRun.maxStepsExplicit, true);
  assert.equal(explicitBudgetRun.actions[0].budget.enabled, true);
  assert.equal(explicitBudgetRun.actions[0].budget.stepsRun, 0);
  assert.equal(explicitBudgetRun.actions[0].budget.maxSteps, 1);
  assert.equal(explicitBudgetRun.actions[0].budget.remaining, 1);
  assert.equal(explicitBudgetRun.actions[0].budget.finishingMode, true);
  assert.equal(explicitBudgetRun.finalBudget.enabled, true);
  assert.equal(explicitBudgetRun.finalBudget.remaining, 0);
  assert.equal(explicitBudgetRun.finalBudget.finishingMode, true);

  const workerDefaultWork = makeRunnableWork('worker-default-budget-work');
  run(['queue', 'sync', workerDefaultWork]);
  const workerDefault = JSON.parse(run([
    'runner', 'watch', workerDefaultWork,
    '--runtime', 'dry-run',
    '--max-waves', '1',
    '--poll-interval-ms', '1',
    '--json',
  ]).stdout);
  const defaultWorkerRun = workerDefault.waves[0].runResult;
  assert.equal(defaultWorkerRun.maxStepsExplicit, false, 'worker default --max-steps should not enable budget');
  assert.deepEqual(defaultWorkerRun.finalBudget, { enabled: false, finishingMode: false });
  assert.equal(defaultWorkerRun.actions[0].budget.enabled, false);

  const workerExplicitWork = makeRunnableWork('worker-explicit-budget-work');
  run(['queue', 'sync', workerExplicitWork]);
  const workerExplicit = JSON.parse(run([
    'runner', 'watch', workerExplicitWork,
    '--runtime', 'dry-run',
    '--max-steps', '2',
    '--max-waves', '1',
    '--poll-interval-ms', '1',
    '--json',
  ]).stdout);
  const explicitWorkerRun = workerExplicit.waves[0].runResult;
  assert.equal(explicitWorkerRun.maxStepsExplicit, true, 'worker should preserve parent explicit maxSteps intent');
  assert.equal(explicitWorkerRun.actions[0].budget.enabled, true);
  assert.equal(explicitWorkerRun.actions[0].budget.maxSteps, 2);
  assert.equal(explicitWorkerRun.actions[0].budget.remaining, 2);
  assert.equal(explicitWorkerRun.actions[0].budget.finishingMode, true);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('budget injection smoke passed');
