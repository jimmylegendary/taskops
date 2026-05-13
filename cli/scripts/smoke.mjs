#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
if (secondRunOut.stopReason !== 'all_closed' || secondRunOut.stepsRun !== 1 || secondRunOut.tasks[0].taskId !== 'task-second') {
  console.error('Expected the second run to finish task-second and stop with all_closed (closure complete)');
  console.error(secondRunOut);
  process.exit(1);
}
run(['validate', runnerWorkDir]);

// ---- decomposition child tasks must be picked up in the same runner invocation ----
const visibleDecomposeDir = join(tempRoot, 'runner-visible-decompose');
run(['init', visibleDecomposeDir, '--id', 'runner-visible-decompose', '--title', 'Runner visible decompose', '--objective', 'Verify decomposition child tasks become visible in the same run', '--language', 'en']);
const visibleParentSpec = join(tempRoot, 'runner-visible-parent-spec.json');
writeFileSync(visibleParentSpec, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Parent decomposition fixture',
  selected: true,
  tasks: [
    {
      id: 'task-parent',
      title: 'Parent task to decompose',
      objective: 'Expand into pre-authored child tasks.',
      responsibility: 'Own the decomposition step that exposes children.',
      completionCriteria: 'Child task group is referenced and children are visible.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      runReadinessReason: 'Parent must decompose so the pre-authored child task group becomes visible to the runner.',
      understandingLevel: 'partial'
    }
  ]
}, null, 2));
run(['decompose', visibleDecomposeDir, '--task-group-id', 'tg-root', '--spec', visibleParentSpec]);
const visibleParentSnapshot = join(visibleDecomposeDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(visibleParentSnapshot, readFileSync(visibleParentSnapshot, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
// Pre-author the child task group/version with a runnable child so dry-run decomposition reuses it
// and the child becomes selectable in the same invocation once the snapshot is extended.
const childSpecPath = join(tempRoot, 'runner-visible-child-spec.json');
writeFileSync(childSpecPath, JSON.stringify({
  versionId: 'tgv-parent-v1',
  version: 'v1',
  summary: 'Pre-authored child of task-parent',
  selected: true,
  tasks: [
    {
      id: 'task-parent-child',
      title: 'Child task that should be picked up in same run',
      objective: 'Run after the parent decomposition step extends the snapshot.',
      responsibility: 'Own the second runner step in the same invocation.',
      completionCriteria: 'Runner marks this child task done.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Objective, responsibility, and completion criteria are present.',
      understandingLevel: 'known'
    }
  ]
}, null, 2));
// Create child task group folder manually so decompose --task-group-id can attach a version into it.
const visibleChildGroupDir = join(visibleDecomposeDir, 'task-groups', 'tg-parent');
mkdirSync(join(visibleChildGroupDir, 'versions'), { recursive: true });
writeFileSync(join(visibleChildGroupDir, 'index.md'), `---\ntaskOpsVersion: v1\nentityType: taskGroup\nid: tg-parent\nobjective: Pre-authored decomposition of task-parent.\ncreatedAt: ${new Date().toISOString()}\nstatus: active\n---\n# tg-parent\n`, 'utf8');
run(['decompose', visibleDecomposeDir, '--task-group-id', 'tg-parent', '--spec', childSpecPath]);
const visibleRunOut = JSON.parse(run(['run', visibleDecomposeDir, '--executor', 'dry-run', '--max-steps', '2', '--json']).stdout);
const visibleActions = visibleRunOut.actions || visibleRunOut.tasks || [];
if (visibleRunOut.stepsRun !== 2 || visibleActions.length !== 2 || visibleRunOut.stopReason !== 'max_steps') {
  console.error('Expected two steps and max_steps stop when decomposition exposes a runnable child in the same invocation');
  console.error(visibleRunOut);
  process.exit(1);
}
if (visibleActions[0].kind !== 'decompose' || visibleActions[0].taskId !== 'task-parent') {
  console.error('Expected first step to decompose task-parent');
  console.error(visibleActions);
  process.exit(1);
}
if (visibleActions[1].kind !== 'execute' || visibleActions[1].taskId !== 'task-parent-child') {
  console.error('Expected second step to execute the pre-authored child task-parent-child after snapshot extension');
  console.error(visibleActions);
  process.exit(1);
}
const visibleSnapshotAfter = readFileSync(visibleParentSnapshot, 'utf8');
if (!visibleSnapshotAfter.includes('taskGroupId: tg-parent') || !visibleSnapshotAfter.includes('versionId: tgv-parent-v1')) {
  console.error('Snapshot must be extended with the decomposed child task group/version');
  console.error(visibleSnapshotAfter);
  process.exit(1);
}
run(['validate', visibleDecomposeDir]);

// ---- all_closed: fully closed work stops with the new reason instead of no_runnable ----
const allClosedDir = join(tempRoot, 'runner-all-closed');
run(['init', allClosedDir, '--id', 'runner-all-closed', '--title', 'Runner all closed', '--objective', 'Verify runner reports all_closed when work is fully closed', '--language', 'en']);
const allClosedSpec = join(tempRoot, 'runner-all-closed-spec.json');
writeFileSync(allClosedSpec, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Single runnable that closes the work',
  selected: true,
  tasks: [
    {
      id: 'task-only',
      title: 'Only runnable task',
      objective: 'Execute and close the work.',
      responsibility: 'Own the terminal runnable step.',
      completionCriteria: 'Runner marks this task done with EoW.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Objective, responsibility, and completion criteria are present.',
      understandingLevel: 'known'
    }
  ]
}, null, 2));
run(['decompose', allClosedDir, '--task-group-id', 'tg-root', '--spec', allClosedSpec]);
const allClosedSnapshot = join(allClosedDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(allClosedSnapshot, readFileSync(allClosedSnapshot, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const allClosedRunOut = JSON.parse(run(['run', allClosedDir, '--executor', 'dry-run', '--max-steps', '5', '--json']).stdout);
if (allClosedRunOut.stopReason !== 'all_closed' || allClosedRunOut.stepsRun !== 1) {
  console.error('Expected all_closed stop reason once work is fully closed by EoW');
  console.error(allClosedRunOut);
  process.exit(1);
}
const allClosedRunLog = readFileSync(join(allClosedDir, 'runs', 'run-main', 'run-log.md'), 'utf8');
if (!allClosedRunLog.includes('all_closed')) {
  console.error('Expected run-log.md to mention all_closed');
  console.error(allClosedRunLog);
  process.exit(1);
}

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

// ---- next / explain / close honest-loop commands ----
const honestDir = join(tempRoot, 'runner-honest-loop');
run(['init', honestDir, '--id', 'runner-honest', '--title', 'Runner honest', '--objective', 'Cover taskops next/explain/close', '--language', 'en']);
const honestSpecPath = join(tempRoot, 'runner-honest-spec.json');
writeFileSync(honestSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Honest loop fixture',
  selected: true,
  tasks: [
    {
      id: 'task-honest-run',
      title: 'Runnable task',
      objective: 'Provide a deterministic next=execute pick.',
      responsibility: 'Own the runnable step.',
      completionCriteria: 'Task marked done with EoW.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Objective, responsibility, and completion criteria are present.',
      understandingLevel: 'known'
    },
    {
      id: 'task-honest-blocked',
      title: 'Blocked sibling',
      objective: 'Stay blocked so close --reason manual_verified can attest.',
      responsibility: 'Owner is waiting on external input.',
      completionCriteria: 'External input arrives.',
      order: 2,
      status: 'blocked',
      runReadiness: 'blocked',
      runReadinessReason: 'Synthetic blocker for honest-loop smoke.',
      understandingLevel: 'partial'
    }
  ]
}, null, 2));
run(['decompose', honestDir, '--task-group-id', 'tg-root', '--spec', honestSpecPath]);
const honestSnapshotPath = join(honestDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(honestSnapshotPath, readFileSync(honestSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));

const nextBefore = JSON.parse(run(['next', honestDir, '--json']).stdout);
if (nextBefore.action !== 'execute' || nextBefore.target?.id !== 'task-honest-run') {
  console.error('Expected taskops next to recommend executing task-honest-run');
  console.error(nextBefore);
  process.exit(1);
}
if (!nextBefore.command || !nextBefore.command.includes('taskops run')) {
  console.error('Expected next command to include taskops run');
  console.error(nextBefore);
  process.exit(1);
}

const explainBefore = JSON.parse(run(['explain', honestDir, '--json']).stdout);
if (explainBefore.complete !== false || explainBefore.next.action !== 'execute') {
  console.error('Expected explain to report not-complete and next=execute');
  console.error(explainBefore);
  process.exit(1);
}
if (!explainBefore.openReasons.some((r) => r.includes('runnable')) || !explainBefore.openReasons.some((r) => r.includes('blocked'))) {
  console.error('Expected open reasons to mention runnable and blocked tasks');
  console.error(explainBefore);
  process.exit(1);
}

const closeMissingReason = spawnSync('node', [cli, 'close', honestDir, 'task-honest-blocked', '--json'], { encoding: 'utf8' });
if (closeMissingReason.status === 0) {
  console.error('Expected close on blocked task without --reason manual_verified to fail');
  console.error(closeMissingReason.stdout);
  process.exit(1);
}
if (!/refuse to close|status is/.test(closeMissingReason.stderr)) {
  console.error('Expected close failure message to explain refusal reason');
  console.error(closeMissingReason.stderr);
  process.exit(1);
}

const closeOk = JSON.parse(run(['close', honestDir, 'task-honest-blocked', '--reason', 'manual_verified', '--json']).stdout);
if (closeOk.closed !== true || closeOk.target.type !== 'task' || closeOk.target.id !== 'task-honest-blocked' || closeOk.eowId !== 'eow-task-honest-blocked') {
  console.error('Expected manual_verified close to write EoW for task-honest-blocked');
  console.error(closeOk);
  process.exit(1);
}
const honestBlockedEow = readFileSync(closeOk.eowPath, 'utf8');
if (!honestBlockedEow.includes('reason: manual_verified') || !honestBlockedEow.includes('declaredBy: taskops-close')) {
  console.error('Manual-verified EoW file missing expected frontmatter');
  console.error(honestBlockedEow);
  process.exit(1);
}

const closeAgain = spawnSync('node', [cli, 'close', honestDir, 'task-honest-blocked', '--reason', 'manual_verified', '--json'], { encoding: 'utf8' });
if (closeAgain.status === 0 || !/already closed/.test(closeAgain.stderr)) {
  console.error('Expected re-close to fail with already-closed message');
  console.error(closeAgain.stdout, closeAgain.stderr);
  process.exit(1);
}

// Run the remaining runnable task to fully close the work; then expect next=done.
const honestRunOut = JSON.parse(run(['run', honestDir, '--executor', 'dry-run', '--max-steps', '1', '--json']).stdout);
if (honestRunOut.tasks[0]?.taskId !== 'task-honest-run' || honestRunOut.tasks[0]?.status !== 'completed') {
  console.error('Expected runner to complete task-honest-run');
  console.error(honestRunOut);
  process.exit(1);
}
run(['validate', honestDir]);
const nextAfter = JSON.parse(run(['next', honestDir, '--json']).stdout);
if (nextAfter.action !== 'done' || nextAfter.stopReason !== 'all_closed') {
  console.error('Expected next to report done/all_closed after full closure');
  console.error(nextAfter);
  process.exit(1);
}
const explainAfter = JSON.parse(run(['explain', honestDir, '--json']).stdout);
if (explainAfter.complete !== true || explainAfter.next.action !== 'done' || explainAfter.openReasons.length !== 0) {
  console.error('Expected explain to report complete=true, next=done, and no open reasons after closure');
  console.error(explainAfter);
  process.exit(1);
}

// ---- close a run node by id with reason override ----
const closeRunNodeDir = join(tempRoot, 'runner-close-run-node');
run(['init', closeRunNodeDir, '--id', 'runner-close-run-node', '--title', 'Close run node', '--objective', 'Cover run-node close with reason override', '--language', 'en']);
// Manually write a non-done run node that is not yet closed by EoW.
const manualNodePath = join(closeRunNodeDir, 'runs', 'run-main', 'nodes', 'run-node-manual.md');
writeFileSync(manualNodePath, `---\ntaskOpsVersion: v1\nentityType: runNode\nid: run-node-manual\nrunId: run-main\ntype: implementation\ntitle: Manual node\nstatus: cancelled\ncreatedAt: 2026-05-12T00:00:00Z\n---\n# Manual node\n`, 'utf8');
const closeRunNodeOk = JSON.parse(run(['close', closeRunNodeDir, 'run-node-manual', '--reason', 'superseded', '--json']).stdout);
if (closeRunNodeOk.target.type !== 'runNode' || closeRunNodeOk.target.runId !== 'run-main' || closeRunNodeOk.target.id !== 'run-node-manual') {
  console.error('Expected run-node close target metadata');
  console.error(closeRunNodeOk);
  process.exit(1);
}
const runEowBody = readFileSync(closeRunNodeOk.eowPath, 'utf8');
if (!runEowBody.includes('reason: superseded') || !runEowBody.includes('graphType: run')) {
  console.error('Run-node EoW file missing expected frontmatter');
  console.error(runEowBody);
  process.exit(1);
}
const runEdgeBody = readFileSync(closeRunNodeOk.edgePath, 'utf8');
if (!runEdgeBody.includes('edgeType: closes_with') || !runEdgeBody.includes('toRunNodeId: eow-run-node-manual')) {
  console.error('Run-node close did not write expected closes_with edge');
  console.error(runEdgeBody);
  process.exit(1);
}
run(['validate', closeRunNodeDir]);

// Refuse to close a pending delegation without an attestation reason.
const delegateCloseDir = join(tempRoot, 'runner-close-delegate');
run(['init', delegateCloseDir, '--id', 'runner-close-delegate', '--title', 'Close delegate', '--objective', 'Verify delegate close refusal', '--language', 'en']);
writeFileSync(join(delegateCloseDir, 'runs', 'run-main', 'nodes', 'run-node-delegate-pending.md'), `---\ntaskOpsVersion: v1\nentityType: runNode\nid: run-node-delegate-pending\nrunId: run-main\ntype: delegate\ntitle: Pending delegate\nstatus: waiting\ndelegateeType: human\ndelegateeRef: stakeholder\nexpectedOutput: Approval or revision.\nrequestedAt: 2026-05-12T00:00:00Z\ncreatedAt: 2026-05-12T00:00:00Z\n---\n# Pending delegate\n`, 'utf8');
const delegateCloseFail = spawnSync('node', [cli, 'close', delegateCloseDir, 'run-node-delegate-pending', '--json'], { encoding: 'utf8' });
if (delegateCloseFail.status === 0 || !/pending delegation/.test(delegateCloseFail.stderr)) {
  console.error('Expected delegate close without override reason to fail');
  console.error(delegateCloseFail.stdout, delegateCloseFail.stderr);
  process.exit(1);
}
const delegateCloseOk = JSON.parse(run(['close', delegateCloseDir, 'run-node-delegate-pending', '--reason', 'cancelled', '--json']).stdout);
if (delegateCloseOk.target.id !== 'run-node-delegate-pending' || delegateCloseOk.reason !== 'cancelled') {
  console.error('Expected delegate close to succeed with --reason cancelled');
  console.error(delegateCloseOk);
  process.exit(1);
}

rmSync(tempRoot, { recursive: true, force: true });
console.log('OK: taskops CLI smoke passed');
