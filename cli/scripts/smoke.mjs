#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sanitizeFmScalar } from '../lib-runner.js';
import { parseFrontmatterText } from '../lib-taskops.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'bin', 'taskops.js');
const repoRoot = join(here, '..', '..');
const canonicalExampleDir = join(repoRoot, 'examples', 'taskops-canonical-minimal-v1');
const richerExampleDir = join(repoRoot, 'examples', 'taskops-minimal-v1');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-smoke-'));
const projectDir = join(tempRoot, 'demo-project');
const vaultDir = join(tempRoot, 'vault');
const remoteBareDir = join(tempRoot, 'vault-remote.git');
const runnerWorkDir = join(tempRoot, 'runner-work');

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

run(['init', projectDir, '--id', 'demo-project', '--title', 'Demo Project', '--objective', 'Smoke test the TaskOps CLI', '--language', 'ko']);
const rootVersionIndex = readFileSync(join(projectDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'index.md'), 'utf8');
if (!rootVersionIndex.includes('summary: 초기 루트 분해')) {
  console.error('init did not write the expected localized version summary');
  console.error(rootVersionIndex);
  process.exit(1);
}
const specPath = join(tempRoot, 'spec.json');
writeFileSync(specPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Second decomposition',
  selected: true,
  tasks: [
    {
      id: 'task-alpha',
      title: 'Alpha task',
      objective: 'Do alpha',
      responsibility: 'Own alpha',
      completionCriteria: 'Alpha done',
      status: 'active',
      runReadiness: 'runnable',
      runReadinessReason: 'Smoke fixture has objective, responsibility, and completion criteria.',
      understandingLevel: 'known'
    },
    {
      id: 'task-discovery',
      title: 'Discovery task',
      objective: 'Understand an unknown API before decomposing implementation',
      responsibility: 'Learn enough constraints to make the next decomposition honest',
      completionCriteria: 'Exploratory notes list learned facts, failed approaches, remaining unknowns, and next task candidates',
      status: 'pending',
      runReadiness: 'needs_exploration',
      runReadinessReason: 'The task contains unknown unknowns that cannot be decomposed yet.',
      understandingLevel: 'partial',
      unknowns: ['API retry behavior'],
      nextLearningGoal: 'Run a minimal API trial and record constraints.',
      order: 2
    }
  ]
}, null, 2));
run(['decompose', projectDir, '--task-group-id', 'tg-root', '--spec', specPath]);
run(['validate', projectDir]);
const summary = run(['summary', projectDir]).stdout;
if (!summary.includes('Demo Project') || !summary.includes('task-alpha') || !summary.includes('task-discovery [pending; needs_exploration]') || !summary.includes('- Work objective: Smoke test the TaskOps CLI') || !summary.includes('## Selected version') || !summary.includes('초기 루트 분해')) {
  console.error('Unexpected summary output');
  console.error(summary);
  process.exit(1);
}
const classification = JSON.parse(run(['classify-runnable', projectDir, 'task-discovery', '--json']).stdout);
if (classification.classification.runReadiness !== 'needs_exploration' || classification.classification.nextAction !== 'create_exploratory_run') {
  console.error('classify-runnable did not preserve explicit exploratory readiness');
  console.error(classification);
  process.exit(1);
}
run(['show', projectDir, '--json']);
run(['summary', projectDir, '--write']);
const summaryFile = readFileSync(join(projectDir, 'summary.md'), 'utf8');
if (!summaryFile.includes('## Task groups')) {
  console.error('summary.md missing expected content');
  process.exit(1);
}

for (const [label, exampleDir, expectedSnippet] of [
  ['canonical example', canonicalExampleDir, '# TaskOps canonical minimal v1 example'],
  ['richer example', richerExampleDir, '# TaskOps richer v1 fixture']
]) {
  run(['validate', exampleDir]);
  const exampleSummary = run(['summary', exampleDir]).stdout;
  if (!exampleSummary.includes(expectedSnippet)) {
    console.error(`Unexpected summary output for ${label}`);
    console.error(exampleSummary);
    process.exit(1);
  }
}

run(['vault-init', vaultDir, '--branch', 'main', '--language', 'ko']);
const initialSyncConfig = JSON.parse(readFileSync(join(vaultDir, '.taskops', 'taskops-sync.json'), 'utf8'));
if (initialSyncConfig.language !== 'ko') {
  console.error('taskops-sync.json missing expected language setting');
  console.error(initialSyncConfig);
  process.exit(1);
}
spawnSync('git', ['config', 'user.name', 'TaskOps Smoke'], { cwd: vaultDir, encoding: 'utf8' });
spawnSync('git', ['config', 'user.email', 'smoke@example.com'], { cwd: vaultDir, encoding: 'utf8' });
spawnSync('git', ['init', '--bare', remoteBareDir], { encoding: 'utf8' });
run(['vault-init', vaultDir, '--repo-url', remoteBareDir, '--branch', 'main', '--auto-sync', 'true', '--language', 'ko']);
writeFileSync(join(vaultDir, 'README.md'), '# Vault smoke\n');
run(['git-sync', vaultDir, '--message', 'Initial vault sync']);
const gitStatus = JSON.parse(run(['git-status', vaultDir]).stdout);
if (!gitStatus.remoteUrl || gitStatus.sync !== 'in-sync') {
  console.error('Vault git sync did not reach in-sync state');
  console.error(gitStatus);
  process.exit(1);
}

run(['init', runnerWorkDir, '--id', 'runner-work', '--title', 'Runner Work', '--objective', 'Smoke test the taskops runner', '--language', 'en']);
const runnerSpecPath = join(tempRoot, 'runner-spec.json');
writeFileSync(runnerSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Runner-ready decomposition',
  selected: true,
  tasks: [
    {
      id: 'task-first',
      title: 'First runner task',
      objective: 'Validate that the runner can advance one runnable task.',
      responsibility: 'Own the first checkable runner step.',
      completionCriteria: 'Runner marks this task done and writes EoW nodes.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Objective, responsibility, and completion criteria are present with no unknowns.',
      understandingLevel: 'known',
      order: 1
    },
    {
      id: 'task-second',
      title: 'Second runner task',
      objective: 'Provide a second runnable task to confirm max-steps stops in time.',
      responsibility: 'Own the second checkable runner step.',
      completionCriteria: 'Runner picks this task only when allowed by step budget.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Objective, responsibility, and completion criteria are present with no unknowns.',
      understandingLevel: 'known',
      order: 2
    }
  ]
}, null, 2));
run(['decompose', runnerWorkDir, '--task-group-id', 'tg-root', '--spec', runnerSpecPath]);
const runnerSnapshotPath = join(runnerWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(runnerSnapshotPath, readFileSync(runnerSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));

const pastDeadline = new Date(Date.now() - 60_000).toISOString();
const pastDeadlineOut = JSON.parse(run(['run', runnerWorkDir, '--executor', 'dry-run', '--until', pastDeadline, '--json']).stdout);
if (pastDeadlineOut.stopReason !== 'deadline_reached' || pastDeadlineOut.stepsRun !== 0 || pastDeadlineOut.tasks.length !== 0) {
  console.error('Expected runner with past --until to stop with deadline_reached and zero steps');
  console.error(pastDeadlineOut);
  process.exit(1);
}

const firstRunOut = JSON.parse(run(['run', runnerWorkDir, '--executor', 'dry-run', '--max-steps', '1', '--json']).stdout);
if (firstRunOut.stopReason !== 'max_steps' || firstRunOut.stepsRun !== 1 || firstRunOut.tasks.length !== 1) {
  console.error('Expected runner with --max-steps 1 to complete exactly one task and stop with max_steps');
  console.error(firstRunOut);
  process.exit(1);
}
if (firstRunOut.tasks[0].taskId !== 'task-first' || firstRunOut.tasks[0].status !== 'completed') {
  console.error('Runner did not pick the deterministic first task');
  console.error(firstRunOut);
  process.exit(1);
}

run(['validate', runnerWorkDir]);

const firstTaskAfter = readFileSync(join(runnerWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-first.md'), 'utf8');
if (!firstTaskAfter.includes('status: done') || !firstTaskAfter.includes('runRefs:') || !firstTaskAfter.includes('runId: run-main')) {
  console.error('task-first.md should reflect done status and runRef to run-main after a dry-run');
  console.error(firstTaskAfter);
  process.exit(1);
}
const taskEowPath = join(runnerWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-first.md');
const runEowPath = join(runnerWorkDir, 'runs', 'run-main', 'nodes', 'eow-run-node-task-first.md');
const runEdgePath = join(runnerWorkDir, 'runs', 'run-main', 'edges', 'edge-run-node-task-first-to-eow.md');
for (const p of [taskEowPath, runEowPath, runEdgePath]) {
  try { readFileSync(p, 'utf8'); } catch {
    console.error(`Expected runner artifact at ${p}`);
    process.exit(1);
  }
}
const runnerSummary = run(['summary', runnerWorkDir]).stdout;
if (!runnerSummary.includes('task task-first [done; runnable]') || !runnerSummary.includes('run-main/run-node-task-first') || !runnerSummary.includes('EoW eow-task-first')) {
  console.error('Runner summary missing expected entries');
  console.error(runnerSummary);
  process.exit(1);
}

if (sanitizeFmScalar('one\nline\r\nthree\ttab').includes('\n')) {
  console.error('sanitizeFmScalar must strip newlines and tabs');
  process.exit(1);
}
if (sanitizeFmScalar('') !== 'executor_failed' || sanitizeFmScalar(null) !== 'executor_failed') {
  console.error('sanitizeFmScalar must fall back to executor_failed for empty/null');
  process.exit(1);
}
const longSanitized = sanitizeFmScalar('x'.repeat(2000));
if (longSanitized.length !== 500 || !longSanitized.endsWith('...')) {
  console.error('sanitizeFmScalar must cap length and add ellipsis marker');
  process.exit(1);
}
const collapsedSanitized = sanitizeFmScalar('  many   spaces\n\n  here   ');
if (collapsedSanitized !== 'many spaces here') {
  console.error('sanitizeFmScalar must collapse whitespace and trim');
  console.error(collapsedSanitized);
  process.exit(1);
}
const reasonProbeFm = `---\nlastRunFailureReason: ${sanitizeFmScalar('boom: line1\nline2\nlots of: colons')}\n---\n`;
const reasonProbeParsed = parseFrontmatterText(reasonProbeFm, '<probe>');
if (typeof reasonProbeParsed.lastRunFailureReason !== 'string' || reasonProbeParsed.lastRunFailureReason.includes('\n')) {
  console.error('Sanitized failure reason must round-trip as a single-line scalar');
  console.error(reasonProbeParsed);
  process.exit(1);
}

const secondRunOut = JSON.parse(run(['run', runnerWorkDir, '--executor', 'dry-run', '--max-steps', '5', '--json']).stdout);
if (secondRunOut.stopReason !== 'no_runnable' || secondRunOut.stepsRun !== 1 || secondRunOut.tasks[0].taskId !== 'task-second') {
  console.error('Expected the second run to finish task-second and stop with no_runnable');
  console.error(secondRunOut);
  process.exit(1);
}
run(['validate', runnerWorkDir]);

rmSync(tempRoot, { recursive: true, force: true });
console.log('OK: taskops CLI smoke passed');
