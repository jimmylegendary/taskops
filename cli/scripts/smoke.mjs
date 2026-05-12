#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

// ---- runner semantics: decomposition + exploration + blocked + waiting ----
const dispatchWorkDir = join(tempRoot, 'runner-dispatch');
run(['init', dispatchWorkDir, '--id', 'runner-dispatch', '--title', 'Runner dispatch', '--objective', 'Smoke test runner readiness dispatch', '--language', 'en']);
const dispatchSpecPath = join(tempRoot, 'runner-dispatch-spec.json');
writeFileSync(dispatchSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Mixed readiness decomposition',
  selected: true,
  tasks: [
    {
      id: 'task-explore',
      title: 'Explore unknown surface',
      objective: 'Surface unknowns about an unfamiliar surface before decomposing.',
      responsibility: 'Author an exploration record so the next pass can decompose honestly.',
      completionCriteria: 'Exploration artifact lists learned facts, unknowns, and a suggested next step.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_exploration',
      runReadinessReason: 'Inner structure is unknown; explore before decomposing.',
      understandingLevel: 'unknown',
      unknowns: ['Surface boundaries', 'Failure modes'],
      nextLearningGoal: 'Sketch the smallest probe that exposes the boundary.'
    },
    {
      id: 'task-decompose',
      title: 'Decompose mid-confidence area',
      objective: 'Split a mid-confidence area into child responsibilities.',
      responsibility: 'Own the decomposition into a child task group with a v1 version.',
      completionCriteria: 'A child task group + version exists with at least one child task.',
      order: 2,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      runReadinessReason: 'Domain understanding is sufficient to split into responsibilities.',
      understandingLevel: 'partial'
    },
    {
      id: 'task-blocked',
      title: 'Blocked area waiting on external input',
      objective: 'Cannot progress without external input.',
      responsibility: 'Owner must supply input before this becomes runnable.',
      completionCriteria: 'External input has arrived and is reflected in the task graph.',
      order: 3,
      status: 'pending',
      runReadiness: 'blocked',
      runReadinessReason: 'Blocked on missing external input.',
      understandingLevel: 'partial'
    }
  ]
}, null, 2));
run(['decompose', dispatchWorkDir, '--task-group-id', 'tg-root', '--spec', dispatchSpecPath]);
const dispatchSnapshotPath = join(dispatchWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(dispatchSnapshotPath, readFileSync(dispatchSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));

const exploreRunOut = JSON.parse(run(['run', dispatchWorkDir, '--executor', 'dry-run', '--max-steps', '1', '--json']).stdout);
if (exploreRunOut.stopReason !== 'max_steps' || exploreRunOut.stepsRun !== 1 || (exploreRunOut.actions || exploreRunOut.tasks)[0].kind !== 'explore') {
  console.error('Expected the first dispatch step to be an exploration action');
  console.error(exploreRunOut);
  process.exit(1);
}
const exploreArtifactPath = join(dispatchWorkDir, 'runs', 'run-main', 'artifacts', 'run-node-task-explore.md');
const exploreArtifactBody = readFileSync(exploreArtifactPath, 'utf8');
if (!exploreArtifactBody.includes('Exploration artifact for task-explore') || !exploreArtifactBody.includes('Recorded unknowns')) {
  console.error('Dry-run exploration did not write the expected artifact body');
  console.error(exploreArtifactBody);
  process.exit(1);
}
const exploreTaskAfter = readFileSync(join(dispatchWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-explore.md'), 'utf8');
if (!exploreTaskAfter.includes('status: done') || !exploreTaskAfter.includes('runReadiness: needs_decomposition') || !exploreTaskAfter.includes('runRefs:')) {
  console.error('task-explore must be marked done with runReadiness=needs_decomposition after exploration step');
  console.error(exploreTaskAfter);
  process.exit(1);
}
run(['validate', dispatchWorkDir]);

const decomposeRunOut = JSON.parse(run(['run', dispatchWorkDir, '--executor', 'dry-run', '--max-steps', '1', '--json']).stdout);
if (decomposeRunOut.stopReason !== 'max_steps' || decomposeRunOut.stepsRun !== 1) {
  console.error('Expected the second dispatch step to consume one action');
  console.error(decomposeRunOut);
  process.exit(1);
}
const decomposeAction = (decomposeRunOut.actions || decomposeRunOut.tasks)[0];
// After exploration, task-explore's readiness is needs_decomposition (lower task-order priority than task-decompose since order=1 still beats order=2).
if (decomposeAction.kind !== 'decompose' || !['task-explore', 'task-decompose'].includes(decomposeAction.taskId)) {
  console.error('Expected the second dispatch step to be a decomposition action on one of the open tasks');
  console.error(decomposeAction);
  process.exit(1);
}
const decomposeChildIndex = join(dispatchWorkDir, 'task-groups', decomposeAction.childTaskGroupId, 'versions', decomposeAction.versionId, 'index.md');
const decomposeChildIndexBody = readFileSync(decomposeChildIndex, 'utf8');
if (!decomposeChildIndexBody.includes('entityType: taskGroupVersion')) {
  console.error('Dry-run decomposition did not write a valid child task group version');
  console.error(decomposeChildIndexBody);
  process.exit(1);
}
const decomposeParentTaskPath = join(dispatchWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', `${decomposeAction.taskId}.md`);
const decomposeParentBody = readFileSync(decomposeParentTaskPath, 'utf8');
if (!decomposeParentBody.includes(`childTaskGroupId: ${decomposeAction.childTaskGroupId}`) || !decomposeParentBody.includes('status: done')) {
  console.error('Decomposed parent task must reference the child task group and be marked done');
  console.error(decomposeParentBody);
  process.exit(1);
}
const decomposeChildTasks = readdirSync(join(dispatchWorkDir, 'task-groups', decomposeAction.childTaskGroupId, 'versions', decomposeAction.versionId, 'tasks'));
if (decomposeChildTasks.length < 1) {
  console.error('Dry-run decomposition must create at least one child task');
  console.error(decomposeChildTasks);
  process.exit(1);
}
const decomposeChildBody = readFileSync(join(dispatchWorkDir, 'task-groups', decomposeAction.childTaskGroupId, 'versions', decomposeAction.versionId, 'tasks', decomposeChildTasks[0]), 'utf8');
if (!decomposeChildBody.includes('runReadiness: blocked')) {
  console.error('Dry-run synthetic child task must be runReadiness=blocked to prevent auto-progress');
  console.error(decomposeChildBody);
  process.exit(1);
}
run(['validate', dispatchWorkDir]);

const drainRunOut = JSON.parse(run(['run', dispatchWorkDir, '--executor', 'dry-run', '--max-steps', '5', '--json']).stdout);
if (drainRunOut.stopReason !== 'blocked_only') {
  console.error('Expected dispatch runner to stop with blocked_only once decomposable tasks are consumed');
  console.error(drainRunOut);
  process.exit(1);
}
run(['validate', dispatchWorkDir]);

// ---- waiting stop reason ----
const waitingWorkDir = join(tempRoot, 'runner-waiting');
run(['init', waitingWorkDir, '--id', 'runner-waiting', '--title', 'Runner waiting', '--objective', 'Verify the runner pauses on waiting tasks', '--language', 'en']);
const waitingSpecPath = join(tempRoot, 'runner-waiting-spec.json');
writeFileSync(waitingSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Waiting task fixture',
  selected: true,
  tasks: [
    {
      id: 'task-waiting',
      title: 'Awaiting an external decision',
      objective: 'Surface the waiting state to the runner.',
      responsibility: 'Owner is waiting on a stakeholder decision.',
      completionCriteria: 'Decision arrives and the task is unblocked.',
      order: 1,
      status: 'waiting',
      runReadiness: 'runnable',
      runReadinessReason: 'All run criteria present but parked while waiting on an external decision.',
      understandingLevel: 'known'
    }
  ]
}, null, 2));
run(['decompose', waitingWorkDir, '--task-group-id', 'tg-root', '--spec', waitingSpecPath]);
const waitingSnapshotPath = join(waitingWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(waitingSnapshotPath, readFileSync(waitingSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const waitingRunOut = JSON.parse(run(['run', waitingWorkDir, '--executor', 'dry-run', '--max-steps', '3', '--json']).stdout);
if (waitingRunOut.stopReason !== 'waiting' || waitingRunOut.stepsRun !== 0) {
  console.error('Expected the runner to stop with waiting when the next task is in status: waiting');
  console.error(waitingRunOut);
  process.exit(1);
}

// ---- delegate waiting must surface as delegation_pending, not generic waiting ----
const delegateWorkDir = join(tempRoot, 'runner-delegate-waiting');
run(['init', delegateWorkDir, '--id', 'runner-delegate-waiting', '--title', 'Runner delegate waiting', '--objective', 'Verify delegated waiting gets a precise stop reason', '--language', 'en']);
writeFileSync(join(delegateWorkDir, 'runs', 'run-main', 'nodes', 'run-node-human-review.md'), `---
taskOpsVersion: v1
entityType: runNode
id: run-node-human-review
runId: run-main
type: delegate
title: Human review
status: waiting
delegateeType: human
delegateeRef: stakeholder
request: Review the proposed change.
expectedOutput: Approval or requested revision.
requestedAt: 2026-05-12T00:00:00Z
createdAt: 2026-05-12T00:00:00Z
---
# Human review
`, 'utf8');
const delegateRunOut = JSON.parse(run(['run', delegateWorkDir, '--executor', 'dry-run', '--max-steps', '3', '--json']).stdout);
if (delegateRunOut.stopReason !== 'delegation_pending' || delegateRunOut.stepsRun !== 0) {
  console.error('Expected type=delegate/status=waiting to stop with delegation_pending, not waiting');
  console.error(delegateRunOut);
  process.exit(1);
}

// ---- blockedBy dependencies should unblock before runner selection ----
const blockerWorkDir = join(tempRoot, 'runner-blocker-recheck');
run(['init', blockerWorkDir, '--id', 'runner-blocker-recheck', '--title', 'Runner blocker recheck', '--objective', 'Verify blocked tasks can reopen when dependencies resolve', '--language', 'en']);
const blockerSpecPath = join(tempRoot, 'runner-blocker-spec.json');
writeFileSync(blockerSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Blocker recheck fixture',
  selected: true,
  tasks: [
    {
      id: 'task-prereq',
      title: 'Resolved prerequisite',
      objective: 'Represent already-complete prerequisite work.',
      responsibility: 'Prerequisite owner has finished the needed work.',
      completionCriteria: 'Prerequisite is marked done.',
      order: 1,
      status: 'done',
      runReadiness: 'runnable',
      understandingLevel: 'known'
    },
    {
      id: 'task-dependent',
      title: 'Dependent work',
      objective: 'Run after the prerequisite is complete.',
      responsibility: 'Execute once dependencies are resolved.',
      completionCriteria: 'Dependent work has been executed.',
      order: 2,
      status: 'blocked',
      runReadiness: 'blocked',
      runReadinessReason: 'Waiting for task-prereq.',
      blockedBy: [{ type: 'task', id: 'task-prereq', taskGroupVersionId: 'tgv-root-v2' }],
      understandingLevel: 'known'
    }
  ]
}, null, 2));
run(['decompose', blockerWorkDir, '--task-group-id', 'tg-root', '--spec', blockerSpecPath]);
const blockerSnapshotPath = join(blockerWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(blockerSnapshotPath, readFileSync(blockerSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const unblockDryRunOut = JSON.parse(run(['unblock-check', blockerWorkDir, '--dry-run', '--json']).stdout);
if (unblockDryRunOut.unblocked.length !== 1 || unblockDryRunOut.unblocked[0].taskId !== 'task-dependent') {
  console.error('Expected unblock-check to detect resolved task dependency');
  console.error(unblockDryRunOut);
  process.exit(1);
}
const blockerRunOut = JSON.parse(run(['run', blockerWorkDir, '--executor', 'dry-run', '--max-steps', '1', '--json']).stdout);
if (blockerRunOut.stopReason !== 'max_steps' || blockerRunOut.stepsRun !== 1 || blockerRunOut.actions[0]?.taskId !== 'task-dependent') {
  console.error('Expected runner to unblock and execute task-dependent');
  console.error(blockerRunOut);
  process.exit(1);
}

rmSync(tempRoot, { recursive: true, force: true });
console.log('OK: taskops CLI smoke passed');
