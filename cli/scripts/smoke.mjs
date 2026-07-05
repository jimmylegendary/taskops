#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { insertRunnerAttempt } from '../lib-queue.js';
import { filterConcurrentTargetValidationErrors, runTaskOps, sanitizeFmScalar } from '../lib-runner.js';
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
const reviewGuardWorkDir = join(tempRoot, 'review-guard-work');
const orchestratorWorkDir = join(tempRoot, 'orchestrator-work');
const watchWorkDir = join(tempRoot, 'watch-work');
const retryWorkDir = join(tempRoot, 'retry-work');
const staleRecoveryWorkDir = join(tempRoot, 'stale-recovery-work');
const expiredSelfReleaseWorkDir = join(tempRoot, 'expired-self-release-work');
const reportSinkWorkDir = join(tempRoot, 'report-sink-work');
const daemonWorkDir = join(tempRoot, 'daemon-work');
const daemonBatchWorkDir = join(tempRoot, 'daemon-batch-work');

const filteredConcurrentErrors = filterConcurrentTargetValidationErrors([
  '/tmp/work/runs/run-current: missing index.md',
  '/tmp/work/runs/run-other: missing index.md',
  '/tmp/work/runs/run-other/nodes/node.md: missing frontmatter',
  '/tmp/work/task-groups/tg-root/versions/tgv-root-v2/tasks/task-target.md: bad target task',
  '/tmp/work/task-groups/tg-root/versions/tgv-root-v2/tasks/task-other.md: unrelated task',
], {
  allowConcurrentTarget: true,
  runId: 'run-current',
  targetTaskId: 'task-target',
  targetTaskGroupVersionId: 'tgv-root-v2'
});
const expectedFilteredConcurrentErrors = [
  '/tmp/work/runs/run-current: missing index.md',
  '/tmp/work/task-groups/tg-root/versions/tgv-root-v2/tasks/task-target.md: bad target task'
];
if (JSON.stringify(filteredConcurrentErrors) !== JSON.stringify(expectedFilteredConcurrentErrors)) {
  console.error('Concurrent target validation filtering regressed');
  console.error(filteredConcurrentErrors);
  process.exit(1);
}

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
      acceptance: {
        mode: 'enforced',
        expectedOutcome: 'Runner marks this task done, records observed result evidence, reviews it, and writes EoW nodes.',
        assertions: {
          contentIncludes: ['dry-run executor synthetically completed task task-first']
        },
        requiredArtifacts: [],
        requiredChecks: []
      },
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

const taskFirstBeforeQueueSync = readFileSync(join(runnerWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-first.md'), 'utf8');
const queueSyncOut = JSON.parse(run(['queue', 'sync', runnerWorkDir, '--json']).stdout);
if (queueSyncOut.workId !== 'runner-work' || queueSyncOut.synced !== 2 || queueSyncOut.rows.length !== 2) {
  console.error('queue sync should project the two selected runner tasks');
  console.error(queueSyncOut);
  process.exit(1);
}
if (!queueSyncOut.rows.every((row) => row.status === 'pending' && row.readiness === 'runnable')) {
  console.error('queue sync rows should preserve pending runnable task state');
  console.error(queueSyncOut.rows);
  process.exit(1);
}
const queueListOut = JSON.parse(run(['queue', 'list', runnerWorkDir, '--json']).stdout);
if (queueListOut.rows.length !== 2 || queueListOut.rows[0].md_fingerprint.length !== 64) {
  console.error('queue list should read the persisted projection with fingerprints');
  console.error(queueListOut);
  process.exit(1);
}
const firstLeaseOut = JSON.parse(run(['queue', 'claim', runnerWorkDir, '--runner-id', 'smoke-a', '--ttl-seconds', '60', '--json']).stdout);
if (!firstLeaseOut.claimed || firstLeaseOut.lease.queue_item_id !== 'tgv-root-v2:task-first' || firstLeaseOut.lease.runner_id !== 'smoke-a') {
  console.error('queue claim should lease the deterministic first runnable item');
  console.error(firstLeaseOut);
  process.exit(1);
}
const secondLeaseOut = JSON.parse(run(['queue', 'claim', runnerWorkDir, '--runner-id', 'smoke-b', '--ttl-seconds', '60', '--json']).stdout);
if (!secondLeaseOut.claimed || secondLeaseOut.lease.queue_item_id !== 'tgv-root-v2:task-second') {
  console.error('second queue claim should skip the actively leased first item');
  console.error(secondLeaseOut);
  process.exit(1);
}
const heartbeatOut = JSON.parse(run(['queue', 'heartbeat', runnerWorkDir, firstLeaseOut.lease.id, '--ttl-seconds', '120', '--json']).stdout);
if (heartbeatOut.lease.id !== firstLeaseOut.lease.id || heartbeatOut.lease.status !== 'active') {
  console.error('queue heartbeat should preserve an active lease');
  console.error(heartbeatOut);
  process.exit(1);
}
const releaseOut = JSON.parse(run(['queue', 'release', runnerWorkDir, firstLeaseOut.lease.id, '--status', 'done', '--json']).stdout);
if (releaseOut.lease.id !== firstLeaseOut.lease.id || releaseOut.lease.status !== 'done') {
  console.error('queue release should mark the active lease done');
  console.error(releaseOut);
  process.exit(1);
}
const taskFirstAfterQueueSync = readFileSync(join(runnerWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-first.md'), 'utf8');
if (taskFirstBeforeQueueSync !== taskFirstAfterQueueSync) {
  console.error('queue sync must not mutate markdown task files');
  process.exit(1);
}

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
const reviewNodePath = join(runnerWorkDir, 'runs', 'run-main', 'nodes', 'review-run-node-task-first.md');
const reviewEowPath = join(runnerWorkDir, 'runs', 'run-main', 'nodes', 'eow-review-run-node-task-first.md');
const reviewEdgePath = join(runnerWorkDir, 'runs', 'run-main', 'edges', 'edge-run-node-task-first-to-review-run-node-task-first.md');
for (const p of [taskEowPath, runEowPath, runEdgePath, reviewNodePath, reviewEowPath, reviewEdgePath]) {
  try { readFileSync(p, 'utf8'); } catch {
    console.error(`Expected runner artifact at ${p}`);
    process.exit(1);
  }
}
const firstRunNode = parseFrontmatterText(readFileSync(join(runnerWorkDir, 'runs', 'run-main', 'nodes', 'run-node-task-first.md'), 'utf8'));
if (firstRunNode.result?.executorSummary == null || firstRunNode.result?.observed?.outcomeSummary == null || !Array.isArray(firstRunNode.result?.observed?.evidenceRefs)) {
  console.error('run node should record executorSummary separately from observed evidence');
  console.error(firstRunNode);
  process.exit(1);
}
const reviewNode = parseFrontmatterText(readFileSync(reviewNodePath, 'utf8'));
if (reviewNode.type !== 'review' || reviewNode.reviewReport?.decision !== 'approved' || !reviewNode.reviewReport?.reviewedAcceptanceHash || !reviewNode.reviewReport?.reviewedResultHash) {
  console.error('review node should contain an approved reviewReport with acceptance/result hashes');
  console.error(reviewNode);
  process.exit(1);
}
const taskEow = parseFrontmatterText(readFileSync(taskEowPath, 'utf8'));
const runEow = parseFrontmatterText(readFileSync(runEowPath, 'utf8'));
if (taskEow.reason !== 'approved_result' || runEow.reason !== 'approved_result' || taskEow.approvedByReviewNodeId !== 'review-run-node-task-first' || runEow.approvedByReviewNodeId !== 'review-run-node-task-first' || taskEow.approvedReviewMode !== 'enforced' || runEow.approvedReviewMode !== 'enforced') {
  console.error('approved execution EoW should reference the approved review node');
  console.error({ taskEow, runEow });
  process.exit(1);
}
const manualReview = JSON.parse(run(['review', runnerWorkDir, 'task-first', '--json']).stdout);
if (manualReview.reviewReport.decision !== 'approved' || manualReview.reviewNodeId !== 'review-run-node-task-first') {
  console.error('taskops review should regenerate the deterministic approved review report');
  console.error(manualReview);
  process.exit(1);
}
const runnerSummary = run(['summary', runnerWorkDir]).stdout;
if (!runnerSummary.includes('task task-first [done; runnable]') || !runnerSummary.includes('run-main/run-node-task-first') || !runnerSummary.includes('EoW eow-task-first')) {
  console.error('Runner summary missing expected entries');
  console.error(runnerSummary);
  process.exit(1);
}

run(['init', reviewGuardWorkDir, '--id', 'review-guard-work', '--title', 'Review Guard Work', '--objective', 'Smoke test guarded acceptance review', '--language', 'en']);
const reviewGuardSpecPath = join(tempRoot, 'review-guard-spec.json');
writeFileSync(reviewGuardSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Guarded acceptance fixture',
  selected: true,
  tasks: [
    {
      id: 'task-guarded',
      title: 'Guarded task',
      objective: 'Require a check result before closure can be trusted.',
      responsibility: 'Own guarded acceptance behavior.',
      completionCriteria: 'The task cannot close as approved without the required check result.',
      acceptance: {
        mode: 'guarded',
        expectedOutcome: 'Observed result and required check prove closure.',
        requiredArtifacts: [],
        requiredChecks: [{ command: 'npm test --workspace cli' }]
      },
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Fixture intentionally requires a check the dry-run executor will not observe.',
      understandingLevel: 'known',
      order: 1
    }
  ]
}, null, 2));
run(['decompose', reviewGuardWorkDir, '--task-group-id', 'tg-root', '--spec', reviewGuardSpecPath]);
const reviewGuardSnapshotPath = join(reviewGuardWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(reviewGuardSnapshotPath, readFileSync(reviewGuardSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const guardedRun = JSON.parse(run(['run', reviewGuardWorkDir, '--executor', 'dry-run', '--max-steps', '1', '--json'], 1).stdout);
if (guardedRun.stopReason !== 'task_failed' || guardedRun.actions[0]?.reviewDecision !== 'needs_verification') {
  console.error('guarded acceptance should block closure when required checks are not observed');
  console.error(guardedRun);
  process.exit(1);
}
const guardedReview = parseFrontmatterText(readFileSync(join(reviewGuardWorkDir, 'runs', 'run-main', 'nodes', 'review-run-node-task-guarded.md'), 'utf8'));
const guardedTask = parseFrontmatterText(readFileSync(join(reviewGuardWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-guarded.md'), 'utf8'));
if (guardedReview.reviewReport?.decision !== 'needs_verification' || !guardedReview.reviewReport?.missingExpected?.includes('required check not observed: npm test --workspace cli') || guardedTask.status !== 'blocked') {
  console.error('guarded review should record missing check and block the task');
  console.error({ guardedReview, guardedTask });
  process.exit(1);
}
run(['validate', reviewGuardWorkDir]);

run(['init', orchestratorWorkDir, '--id', 'orchestrator-work', '--title', 'Orchestrator Work', '--objective', 'Smoke test queue-backed orchestration', '--language', 'en']);
const orchestratorSpecPath = join(tempRoot, 'orchestrator-spec.json');
writeFileSync(orchestratorSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Orchestrator-ready decomposition',
  selected: true,
  tasks: [
    {
      id: 'task-first',
      title: 'First orchestrator task',
      objective: 'Remain pending while an active lease protects this task.',
      responsibility: 'Prove the queue-backed runner respects active leases.',
      completionCriteria: 'This task is not executed when a different queue item is claimed.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Ready, but intentionally pre-leased by the smoke test.',
      understandingLevel: 'known',
      order: 1
    },
    {
      id: 'task-second',
      title: 'Second orchestrator task',
      objective: 'Be executed by taskops runner once after the first task is pre-leased.',
      responsibility: 'Prove queue claim controls the executed task.',
      completionCriteria: 'This task is marked done and receives EoW while task-first stays pending.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Ready and not pre-leased.',
      understandingLevel: 'known',
      order: 2
    }
  ]
}, null, 2));
run(['decompose', orchestratorWorkDir, '--task-group-id', 'tg-root', '--spec', orchestratorSpecPath]);
const orchestratorSnapshotPath = join(orchestratorWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(orchestratorSnapshotPath, readFileSync(orchestratorSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const protectedLease = JSON.parse(run(['queue', 'claim', orchestratorWorkDir, '--runner-id', 'protector', '--ttl-seconds', '300', '--json']).stdout);
if (!protectedLease.claimed || protectedLease.lease.queue_item_id !== 'tgv-root-v2:task-first') {
  console.error('Expected pre-lease to protect task-first');
  console.error(protectedLease);
  process.exit(1);
}
const orchestratorOut = JSON.parse(run([
  'runner', 'once', orchestratorWorkDir,
  '--runtime', 'dry-run',
  '--runner-id', 'orchestrator-smoke',
  '--report-sink', 'ledger',
  '--master-session-key', 'agent:main:webchat:channel:taskops-smoke',
  '--wave-id', 'wave-smoke-1',
  '--json'
]).stdout);
if (!orchestratorOut.claimed || orchestratorOut.queueItem.id !== 'tgv-root-v2:task-second' || orchestratorOut.releaseStatus !== 'done') {
  console.error('queue-backed runner should claim and complete task-second while task-first is leased');
  console.error(orchestratorOut);
  process.exit(1);
}
if (orchestratorOut.runResult.tasks[0].taskId !== 'task-second') {
  console.error('queue-backed runner executed a task other than the claimed queue item');
  console.error(orchestratorOut.runResult);
  process.exit(1);
}
const orchestratorFirstTask = readFileSync(join(orchestratorWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-first.md'), 'utf8');
const orchestratorSecondTask = readFileSync(join(orchestratorWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-second.md'), 'utf8');
if (!orchestratorFirstTask.includes('status: pending') || orchestratorFirstTask.includes('runRefs:')) {
  console.error('task-first should remain untouched because its active lease was held by another runner');
  console.error(orchestratorFirstTask);
  process.exit(1);
}
if (!orchestratorSecondTask.includes('status: done') || !orchestratorSecondTask.includes('runRefs:')) {
  console.error('task-second should be completed by queue-backed runner once');
  console.error(orchestratorSecondTask);
  process.exit(1);
}
const reportsOut = JSON.parse(run(['queue', 'reports', orchestratorWorkDir, '--json']).stdout);
if (reportsOut.reports.length !== 1 || reportsOut.reports[0].wave_id !== 'wave-smoke-1' || reportsOut.reports[0].master_session_key !== 'agent:main:webchat:channel:taskops-smoke') {
  console.error('queue-backed runner should write exactly one master-session progress report ledger row');
  console.error(reportsOut);
  process.exit(1);
}
if (!reportsOut.reports[0].message.includes('queueItem: tgv-root-v2:task-second') || !reportsOut.reports[0].message.includes('completed: execute:task-second')) {
  console.error('progress report should summarize the claimed task and completed action');
  console.error(reportsOut.reports[0]);
  process.exit(1);
}
run(['validate', orchestratorWorkDir]);

run(['init', watchWorkDir, '--id', 'watch-work', '--title', 'Watch Work', '--objective', 'Smoke test queue-backed watch runner', '--language', 'en']);
const watchSpecPath = join(tempRoot, 'watch-spec.json');
writeFileSync(watchSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Watch-runner decomposition',
  selected: true,
  tasks: [
    {
      id: 'task-watch-first',
      title: 'First watch task',
      objective: 'Be executed by the first watch wave.',
      responsibility: 'Prove watch mode drains the first queue item.',
      completionCriteria: 'This task is marked done and receives TaskOps run and task EoW.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Ready for dry-run watch execution.',
      understandingLevel: 'known',
      order: 1
    },
    {
      id: 'task-watch-second',
      title: 'Second watch task',
      objective: 'Be executed by the second watch wave.',
      responsibility: 'Prove watch mode loops after a successful first claim.',
      completionCriteria: 'This task is marked done and the watch exits all_closed after queue drain.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Ready for dry-run watch execution.',
      understandingLevel: 'known',
      order: 2
    }
  ]
}, null, 2));
run(['decompose', watchWorkDir, '--task-group-id', 'tg-root', '--spec', watchSpecPath]);
const watchSnapshotPath = join(watchWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(watchSnapshotPath, readFileSync(watchSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const watchOut = JSON.parse(run([
  'runner', 'watch', watchWorkDir,
  '--runtime', 'dry-run',
  '--runner-id', 'watch-smoke',
  '--report-sink', 'ledger',
  '--master-session-key', 'agent:main:webchat:channel:taskops-watch-smoke',
  '--watch-id', 'watch-smoke-1',
  '--poll-interval-ms', '1',
  '--max-waves', '5',
  '--json'
]).stdout);
if (watchOut.stopReason !== 'all_closed' || watchOut.claimedWaves !== 2 || watchOut.claimedItems !== 2 || watchOut.waves.length !== 2) {
  console.error('runner watch should drain two executable tasks with one-shot worker evidence and stop all_closed');
  console.error(watchOut);
  process.exit(1);
}
const watchWorkerQueueItems = watchOut.waves.map((wave) => wave.queueItem.id).sort();
if (watchWorkerQueueItems.join(',') !== 'tgv-root-v2:task-watch-first,tgv-root-v2:task-watch-second') {
  console.error('runner watch should claim all executable queue items through the worker pool');
  console.error(watchWorkerQueueItems);
  process.exit(1);
}
const watchFirstTask = readFileSync(join(watchWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-watch-first.md'), 'utf8');
const watchSecondTask = readFileSync(join(watchWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-watch-second.md'), 'utf8');
if (!watchFirstTask.includes('status: done') || !watchSecondTask.includes('status: done')) {
  console.error('runner watch should mark both tasks done');
  console.error({ watchFirstTask, watchSecondTask });
  process.exit(1);
}
const watchReportsOut = JSON.parse(run(['queue', 'reports', watchWorkDir, '--json']).stdout);
if (watchReportsOut.reports.length !== 2 || !watchReportsOut.reports.every((report) => report.master_session_key === 'agent:main:webchat:channel:taskops-watch-smoke')) {
  console.error('runner watch should write one progress ledger row per claimed worker transaction');
  console.error(watchReportsOut);
  process.exit(1);
}
run(['validate', watchWorkDir]);

run(['init', retryWorkDir, '--id', 'retry-work', '--title', 'Retry Work', '--objective', 'Smoke test queue retry caps', '--language', 'en']);
const retrySpecPath = join(tempRoot, 'retry-spec.json');
writeFileSync(retrySpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Retry-cap decomposition',
  selected: true,
  tasks: [
    {
      id: 'task-retry',
      title: 'Retry-capped task',
      objective: 'Stay pending while a delegation makes execution fail before a step starts.',
      responsibility: 'Prove max-attempts prevents a watch loop from repeatedly reclaiming the same unchanged task.',
      completionCriteria: 'The runner stops claiming this task after the configured failed-attempt budget is exhausted.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Ready, but a run-level delegate intentionally pauses execution.',
      understandingLevel: 'known',
      order: 1
    }
  ]
}, null, 2));
run(['decompose', retryWorkDir, '--task-group-id', 'tg-root', '--spec', retrySpecPath]);
const retrySnapshotPath = join(retryWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(retrySnapshotPath, readFileSync(retrySnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
writeFileSync(join(retryWorkDir, 'runs', 'run-main', 'nodes', 'run-node-retry-delegate.md'), `---
taskOpsVersion: v1
entityType: runNode
id: run-node-retry-delegate
runId: run-main
type: delegate
title: Retry blocker delegate
status: waiting
delegateeType: self
delegateeRef: self
request: Resolve this deliberate retry smoke blocker.
expectedOutput: A decision that allows the task to proceed.
requestedAt: 2026-05-12T00:00:00Z
createdAt: 2026-05-12T00:00:00Z
---
# Retry blocker delegate
`, 'utf8');
const retryWatchOut = JSON.parse(run([
  'runner', 'watch', retryWorkDir,
  '--runtime', 'dry-run',
  '--runner-id', 'retry-smoke',
  '--report-sink', 'ledger',
  '--watch-id', 'retry-smoke-1',
  '--poll-interval-ms', '1',
  '--max-attempts', '2',
  '--max-idle-cycles', '1',
  '--continue-on-failure',
  '--json'
]).stdout);
if (retryWatchOut.stopReason !== 'idle_cycles' || retryWatchOut.claimedWaves !== 2 || retryWatchOut.claimedItems !== 2 || retryWatchOut.waves.length !== 2) {
  console.error('runner watch should stop reclaiming an unchanged failing item after max-attempts=2');
  console.error(retryWatchOut);
  process.exit(1);
}
if (!retryWatchOut.waves.every((wave) => wave.releaseStatus === 'failed' && wave.runResult?.stopReason === 'delegation_pending')) {
  console.error('retry smoke waves should fail because the delegate is still pending');
  console.error(retryWatchOut.waves);
  process.exit(1);
}
const retryListOut = JSON.parse(run(['queue', 'list', retryWorkDir, '--json']).stdout);
if (retryListOut.rows[0].failed_attempts !== 2) {
  console.error('queue list should expose failed attempts for the current task fingerprint');
  console.error(retryListOut);
  process.exit(1);
}
const retryClaimBlocked = JSON.parse(run(['queue', 'claim', retryWorkDir, '--runner-id', 'retry-claim', '--max-attempts', '2', '--json']).stdout);
if (retryClaimBlocked.claimed !== false) {
  console.error('queue claim should refuse an unchanged item at its max-attempts budget');
  console.error(retryClaimBlocked);
  process.exit(1);
}
const retryTaskPath = join(retryWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-retry.md');
writeFileSync(retryTaskPath, readFileSync(retryTaskPath, 'utf8') + '\nRetry fingerprint reset note.\n');
const retryClaimReset = JSON.parse(run(['queue', 'claim', retryWorkDir, '--runner-id', 'retry-claim-reset', '--max-attempts', '2', '--json']).stdout);
if (!retryClaimReset.claimed || retryClaimReset.item.id !== 'tgv-root-v2:task-retry') {
  console.error('queue claim should allow retries again after the task markdown fingerprint changes');
  console.error(retryClaimReset);
  process.exit(1);
}
run(['queue', 'release', retryWorkDir, retryClaimReset.lease.id, '--status', 'cancelled', '--json']);
run(['validate', retryWorkDir]);

run(['init', staleRecoveryWorkDir, '--id', 'stale-recovery-work', '--title', 'Stale Recovery Work', '--objective', 'Smoke test stale lease recovery', '--language', 'en']);
const staleRecoverySpecPath = join(tempRoot, 'stale-recovery-spec.json');
writeFileSync(staleRecoverySpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Stale lease recovery decomposition',
  selected: true,
  tasks: [
    {
      id: 'task-stale',
      title: 'Stale lease task',
      objective: 'Remain claimable only after the stale lease and running attempt are recovered honestly.',
      responsibility: 'Prove an externally killed runner leaves recoverable queue evidence.',
      completionCriteria: 'Expired active lease becomes stale, linked running attempt becomes failed, and max-attempts blocks reclaim.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Ready for queue stale recovery smoke.',
      understandingLevel: 'known',
      order: 1
    }
  ]
}, null, 2));
run(['decompose', staleRecoveryWorkDir, '--task-group-id', 'tg-root', '--spec', staleRecoverySpecPath]);
const staleRecoverySnapshotPath = join(staleRecoveryWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(staleRecoverySnapshotPath, readFileSync(staleRecoverySnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const staleClaim = JSON.parse(run(['queue', 'claim', staleRecoveryWorkDir, '--runner-id', 'stale-smoke', '--ttl-seconds', '300', '--json']).stdout);
if (!staleClaim.claimed || staleClaim.item.id !== 'tgv-root-v2:task-stale') {
  console.error('stale recovery smoke should claim the single runnable task');
  console.error(staleClaim);
  process.exit(1);
}
insertRunnerAttempt(staleRecoveryWorkDir, {
  id: 'attempt-stale-smoke',
  queueItemId: staleClaim.item.id,
  leaseId: staleClaim.lease.id,
  runnerId: 'stale-smoke',
  runtimeAdapter: 'openclaw-cli',
  status: 'running',
  startedAt: new Date(Date.now() - 60_000).toISOString(),
});
const staleDb = new DatabaseSync(staleClaim.dbPath);
staleDb.prepare(`
  UPDATE leases
  SET expires_at = ?
  WHERE id = ?
`).run(new Date(Date.now() - 10_000).toISOString(), staleClaim.lease.id);
staleDb.close();
const staleListOut = JSON.parse(run(['queue', 'list', staleRecoveryWorkDir, '--json']).stdout);
if (staleListOut.rows[0].failed_attempts !== 1) {
  console.error('queue list should recover stale active leases and expose the failed attempt count');
  console.error(staleListOut);
  process.exit(1);
}
const staleDbAfter = new DatabaseSync(staleClaim.dbPath);
const staleLeaseRow = staleDbAfter.prepare('SELECT status FROM leases WHERE id = ?').get(staleClaim.lease.id);
const staleAttemptRow = staleDbAfter.prepare('SELECT status, stop_reason, error_summary FROM runner_attempts WHERE id = ?').get('attempt-stale-smoke');
staleDbAfter.close();
if (staleLeaseRow?.status !== 'stale' || staleAttemptRow?.status !== 'failed' || staleAttemptRow?.stop_reason !== 'stale_lease') {
  console.error('stale recovery should mark lease stale and linked running attempt failed');
  console.error({ staleLeaseRow, staleAttemptRow });
  process.exit(1);
}
const staleClaimBlocked = JSON.parse(run(['queue', 'claim', staleRecoveryWorkDir, '--runner-id', 'stale-smoke-again', '--max-attempts', '1', '--json']).stdout);
if (staleClaimBlocked.claimed !== false) {
  console.error('queue claim should respect the recovered failed attempt at max-attempts=1');
  console.error(staleClaimBlocked);
  process.exit(1);
}
run(['validate', staleRecoveryWorkDir]);

run(['init', expiredSelfReleaseWorkDir, '--id', 'expired-self-release-work', '--title', 'Expired Self Release Work', '--objective', 'Smoke test late lease release from a still-running worker', '--language', 'en']);
const expiredSelfReleaseSpecPath = join(tempRoot, 'expired-self-release-spec.json');
writeFileSync(expiredSelfReleaseSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Expired self release decomposition',
  selected: true,
  tasks: [
    {
      id: 'task-late-release',
      title: 'Late release task',
      objective: 'Let a still-running worker release its own lease even if the TTL timestamp has passed.',
      responsibility: 'Protect live worker completion from self-staling at release time.',
      completionCriteria: 'Expired active lease can be released by its holder without being marked stale first.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Ready for late release smoke.',
      understandingLevel: 'known',
      order: 1
    }
  ]
}, null, 2));
run(['decompose', expiredSelfReleaseWorkDir, '--task-group-id', 'tg-root', '--spec', expiredSelfReleaseSpecPath]);
const expiredSelfReleaseSnapshotPath = join(expiredSelfReleaseWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(expiredSelfReleaseSnapshotPath, readFileSync(expiredSelfReleaseSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const expiredSelfClaim = JSON.parse(run(['queue', 'claim', expiredSelfReleaseWorkDir, '--runner-id', 'expired-self-smoke', '--ttl-seconds', '1', '--json']).stdout);
insertRunnerAttempt(expiredSelfReleaseWorkDir, {
  id: 'attempt-expired-self-smoke',
  queueItemId: expiredSelfClaim.item.id,
  leaseId: expiredSelfClaim.lease.id,
  runnerId: 'expired-self-smoke',
  runtimeAdapter: 'dry-run',
  status: 'running',
  startedAt: new Date(Date.now() - 60_000).toISOString(),
});
const expiredSelfDb = new DatabaseSync(expiredSelfClaim.dbPath);
expiredSelfDb.prepare(`
  UPDATE leases
  SET expires_at = ?
  WHERE id = ?
`).run(new Date(Date.now() - 10_000).toISOString(), expiredSelfClaim.lease.id);
expiredSelfDb.close();
const expiredSelfReleaseOut = JSON.parse(run(['queue', 'release', expiredSelfReleaseWorkDir, expiredSelfClaim.lease.id, '--status', 'done', '--json']).stdout);
if (expiredSelfReleaseOut.lease?.status !== 'done') {
  console.error('queue release should not mark its own active lease stale before releasing it');
  console.error(expiredSelfReleaseOut);
  process.exit(1);
}
const expiredSelfDbAfter = new DatabaseSync(expiredSelfClaim.dbPath);
const expiredSelfRows = {
  lease: expiredSelfDbAfter.prepare('SELECT status FROM leases WHERE id = ?').get(expiredSelfClaim.lease.id),
  attempt: expiredSelfDbAfter.prepare('SELECT status, stop_reason FROM runner_attempts WHERE id = ?').get('attempt-expired-self-smoke'),
};
expiredSelfDbAfter.close();
if (expiredSelfRows.lease?.status !== 'done' || expiredSelfRows.attempt?.status !== 'done') {
  console.error('late self release should leave the lease and linked attempt done, not stale/failed');
  console.error(expiredSelfRows);
  process.exit(1);
}
run(['validate', expiredSelfReleaseWorkDir]);

run(['init', reportSinkWorkDir, '--id', 'report-sink-work', '--title', 'Report Sink Work', '--objective', 'Smoke test report sink failure ledger', '--language', 'en']);
const reportSinkSpecPath = join(tempRoot, 'report-sink-spec.json');
writeFileSync(reportSinkSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Report sink decomposition',
  selected: true,
  tasks: [
    {
      id: 'task-report-sink',
      title: 'Report sink task',
      objective: 'Complete while report delivery fails cleanly.',
      responsibility: 'Prove OpenClaw chat-inject report sink failures are recorded without corrupting task execution.',
      completionCriteria: 'Task closes, and the report ledger row records the missing master-session-key failure.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Ready for dry-run execution.',
      understandingLevel: 'known',
      order: 1
    }
  ]
}, null, 2));
run(['decompose', reportSinkWorkDir, '--task-group-id', 'tg-root', '--spec', reportSinkSpecPath]);
const reportSinkSnapshotPath = join(reportSinkWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(reportSinkSnapshotPath, readFileSync(reportSinkSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const reportSinkOut = JSON.parse(run([
  'runner', 'once', reportSinkWorkDir,
  '--runtime', 'dry-run',
  '--runner-id', 'report-sink-smoke',
  '--report-sink', 'openclaw-chat-inject',
  '--wave-id', 'report-sink-smoke-1',
  '--json'
]).stdout);
if (reportSinkOut.releaseStatus !== 'done' || reportSinkOut.report?.status !== 'failed' || !reportSinkOut.report.error_summary.includes('master-session-key')) {
  console.error('openclaw-chat-inject report sink should fail cleanly without master-session-key while task execution succeeds');
  console.error(reportSinkOut);
  process.exit(1);
}
const reportSinkReportsOut = JSON.parse(run(['queue', 'reports', reportSinkWorkDir, '--json']).stdout);
if (reportSinkReportsOut.reports.length !== 1 || reportSinkReportsOut.reports[0].report_sink !== 'openclaw-chat-inject' || reportSinkReportsOut.reports[0].status !== 'failed') {
  console.error('report sink failure should be recorded in the progress report ledger');
  console.error(reportSinkReportsOut);
  process.exit(1);
}
run(['validate', reportSinkWorkDir]);

run(['init', daemonWorkDir, '--id', 'daemon-work', '--title', 'Daemon Work', '--objective', 'Smoke test the taskops daemon supervisor surface', '--language', 'en']);
const daemonSpecPath = join(tempRoot, 'daemon-spec.json');
writeFileSync(daemonSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Daemon-ready decomposition',
  selected: true,
  tasks: [
    {
      id: 'task-daemon',
      title: 'Daemon task',
      objective: 'Be executed by the foreground daemon loop.',
      responsibility: 'Prove taskops daemon run supervises runner watch cycles without systemd.',
      completionCriteria: 'Task closes and the daemon reports one all_closed cycle.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Ready for dry-run daemon execution.',
      understandingLevel: 'known',
      order: 1
    }
  ]
}, null, 2));
run(['decompose', daemonWorkDir, '--task-group-id', 'tg-root', '--spec', daemonSpecPath]);
const daemonSnapshotPath = join(daemonWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(daemonSnapshotPath, readFileSync(daemonSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const daemonUnitOut = JSON.parse(run([
  'daemon', 'unit', daemonWorkDir,
  '--name', 'daemon-smoke',
  '--runtime', 'dry-run',
  '--runner-id', 'daemon-smoke-runner',
  '--timeout', '10',
  '--max-attempts', '2',
  '--max-parallel', '4',
  '--report-sink', 'ledger',
  '--max-daemon-cycles', '1',
  '--json'
]).stdout);
if (daemonUnitOut.serviceName !== 'taskopsd-daemon-smoke.service' || !daemonUnitOut.unit.includes('ExecStart=') || !daemonUnitOut.unit.includes(' daemon run ') || !daemonUnitOut.unit.includes('--runtime dry-run') || !daemonUnitOut.unit.includes('--max-parallel 4') || !daemonUnitOut.unit.includes('Restart=always')) {
  console.error('daemon unit should render a user-systemd service around taskops daemon run');
  console.error(daemonUnitOut);
  process.exit(1);
}
const daemonInstallDryRun = JSON.parse(run([
  'daemon', 'install', daemonWorkDir,
  '--name', 'daemon-smoke',
  '--runtime', 'dry-run',
  '--dry-run',
  '--json'
]).stdout);
if (daemonInstallDryRun.installed !== false || daemonInstallDryRun.dryRun !== true || !daemonInstallDryRun.unit.includes('Restart=always')) {
  console.error('daemon install --dry-run should not touch systemd but should return the rendered unit');
  console.error(daemonInstallDryRun);
  process.exit(1);
}
const daemonEnableDryRun = JSON.parse(run([
  'daemon', 'enable', daemonWorkDir,
  '--name', 'daemon-smoke',
  '--runtime', 'dry-run',
  '--dry-run',
  '--json'
]).stdout);
if (daemonEnableDryRun.enabled !== false || daemonEnableDryRun.dryRun !== true || daemonEnableDryRun.startRequested !== true || daemonEnableDryRun.activation.mode !== 'runner-managed' || daemonEnableDryRun.activation.supervisor !== 'user-systemd') {
  console.error('daemon enable --dry-run should describe runner-managed activation without touching systemd');
  console.error(daemonEnableDryRun);
  process.exit(1);
}
if (!daemonEnableDryRun.activationPath.endsWith(join('.taskops', 'runner.json')) || daemonEnableDryRun.activation.syncedQueueItems !== null) {
  console.error('daemon enable --dry-run should report the activation path and avoid queue sync mutation');
  console.error(daemonEnableDryRun);
  process.exit(1);
}
const daemonEnableNoStartDryRun = JSON.parse(run([
  'daemon', 'enable', daemonWorkDir,
  '--name', 'daemon-smoke',
  '--runtime', 'dry-run',
  '--no-start',
  '--dry-run',
  '--json'
]).stdout);
if (daemonEnableNoStartDryRun.startRequested !== false || daemonEnableNoStartDryRun.activation.started !== false) {
  console.error('daemon enable --no-start should install activation without requesting service start');
  console.error(daemonEnableNoStartDryRun);
  process.exit(1);
}
const daemonRunOut = JSON.parse(run([
  'daemon', 'run', daemonWorkDir,
  '--name', 'daemon-smoke',
  '--runtime', 'dry-run',
  '--runner-id', 'daemon-smoke-runner',
  '--report-sink', 'ledger',
  '--daemon-poll-interval-ms', '1',
  '--max-daemon-cycles', '1',
  '--json'
]).stdout);
if (daemonRunOut.cycles.length !== 1 || daemonRunOut.cycles[0].stopReason !== 'all_closed' || daemonRunOut.cycles[0].claimedWaves !== 1) {
  console.error('daemon run should execute a foreground supervise cycle and stop at max-daemon-cycles in smoke');
  console.error(daemonRunOut);
  process.exit(1);
}
const daemonTaskAfter = readFileSync(join(daemonWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-daemon.md'), 'utf8');
if (!daemonTaskAfter.includes('status: done') || !daemonTaskAfter.includes('runRefs:')) {
  console.error('daemon run should close the daemon smoke task through the runner watch cycle');
  console.error(daemonTaskAfter);
  process.exit(1);
}
const daemonReportsOut = JSON.parse(run(['queue', 'reports', daemonWorkDir, '--json']).stdout);
if (daemonReportsOut.reports.length !== 1 || daemonReportsOut.reports[0].status !== 'delivered') {
  console.error('daemon run should preserve runner progress reporting through the ledger sink');
  console.error(daemonReportsOut);
  process.exit(1);
}

run(['init', daemonBatchWorkDir, '--id', 'daemon-batch-work', '--title', 'Daemon Batch Work', '--objective', 'Verify taskopsd leases all currently executable tasks and respects dependencies.', '--language', 'en']);
const daemonBatchSpecPath = join(tempRoot, 'daemon-batch-spec.json');
writeFileSync(daemonBatchSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Batch daemon dependency fixture',
  selected: true,
  tasks: [
    {
      id: 'task-a',
      title: 'Independent task A',
      objective: 'Complete independent task A.',
      responsibility: 'Own independent branch A.',
      completionCriteria: 'A is done.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Independent and ready.',
      understandingLevel: 'known',
      order: 1
    },
    {
      id: 'task-b',
      title: 'Independent task B',
      objective: 'Complete independent task B.',
      responsibility: 'Own independent branch B.',
      completionCriteria: 'B is done.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Independent and ready.',
      understandingLevel: 'known',
      order: 2
    },
    {
      id: 'task-c',
      title: 'Dependent task C',
      objective: 'Run only after task A is done.',
      responsibility: 'Verify dependency-aware queue projection.',
      completionCriteria: 'C is done after A.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Runnable only after blocker resolution.',
      blockedBy: [{ type: 'task', id: 'task-a', taskGroupVersionId: 'tgv-root-v2' }],
      understandingLevel: 'known',
      order: 3
    }
  ]
}, null, 2));
run(['decompose', daemonBatchWorkDir, '--task-group-id', 'tg-root', '--spec', daemonBatchSpecPath]);
const daemonBatchSnapshotPath = join(daemonBatchWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(daemonBatchSnapshotPath, readFileSync(daemonBatchSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const daemonBatchInitialQueue = JSON.parse(run(['queue', 'sync', daemonBatchWorkDir, '--json']).stdout);
const blockedC = daemonBatchInitialQueue.rows.find((row) => row.task_id === 'task-c');
if (!blockedC || blockedC.status !== 'blocked' || blockedC.readiness !== 'blocked' || !blockedC.blocked_reason?.includes('task-a')) {
  console.error('queue sync should mark blockedBy-dependent task unavailable before its dependency closes');
  console.error(daemonBatchInitialQueue);
  process.exit(1);
}
const daemonBatchRunOut = JSON.parse(run([
  'daemon', 'run', daemonBatchWorkDir,
  '--name', 'daemon-batch-smoke',
  '--runtime', 'dry-run',
  '--runner-id', 'daemon-batch-smoke-runner',
  '--report-sink', 'ledger',
  '--daemon-poll-interval-ms', '1',
  '--max-daemon-cycles', '1',
  '--max-parallel', '8',
  '--json'
]).stdout);
if (daemonBatchRunOut.cycles.length !== 1 || daemonBatchRunOut.cycles[0].stopReason !== 'all_closed' || daemonBatchRunOut.cycles[0].claimedWaves !== 3 || daemonBatchRunOut.cycles[0].claimedItems !== 3) {
  console.error('daemon batch run should finish all three tasks through one-shot worker-pool slots');
  console.error(daemonBatchRunOut);
  process.exit(1);
}
const daemonBatchIds = daemonBatchRunOut.cycles[0].waveDetails.map((wave) => wave.queueItemId).sort();
if (daemonBatchIds.join(',') !== 'tgv-root-v2:task-a,tgv-root-v2:task-b,tgv-root-v2:task-c') {
  console.error('daemon batch run should claim every dependency-eligible queue item exactly once');
  console.error(daemonBatchRunOut);
  process.exit(1);
}
const daemonBatchQueueAfter = JSON.parse(run(['queue', 'list', daemonBatchWorkDir, '--json']).stdout);
if (daemonBatchQueueAfter.rows.some((row) => row.status !== 'done')) {
  console.error('daemon batch queue should end with all rows done');
  console.error(daemonBatchQueueAfter);
  process.exit(1);
}
const daemonBatchReportsOut = JSON.parse(run(['queue', 'reports', daemonBatchWorkDir, '--json']).stdout);
if (daemonBatchReportsOut.reports.length !== 3) {
  console.error('daemon batch run should write one progress report per worker transaction');
  console.error(daemonBatchReportsOut);
  process.exit(1);
}

const daemonErrorOut = JSON.parse(run([
  'daemon', 'run', join(tempRoot, 'missing-daemon-work'),
  '--name', 'daemon-error-smoke',
  '--runtime', 'dry-run',
  '--max-daemon-cycles', '1',
  '--failure-backoff-ms', '1',
  '--json'
], 1).stdout);
if (daemonErrorOut.cycles.length !== 1 || daemonErrorOut.cycles[0].stopReason !== 'daemon_error' || !daemonErrorOut.cycles[0].stopDetail) {
  console.error('daemon run should capture watch-level exceptions as daemon_error cycles instead of crashing');
  console.error(daemonErrorOut);
  process.exit(1);
}
run(['validate', daemonWorkDir]);

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
    },
    {
      id: 'task-dependent-unknown',
      title: 'Dependent work with stale runnable intent',
      objective: 'Remain exploratory after the prerequisite resolves because unknowns still exist.',
      responsibility: 'Prove blocker recheck reclassifies stale unblock readiness.',
      completionCriteria: 'The task is reopened as needs_exploration instead of stale runnable.',
      order: 3,
      status: 'blocked',
      runReadiness: 'blocked',
      unblockRunReadiness: 'runnable',
      runReadinessReason: 'Waiting for task-prereq.',
      blockedBy: [{ type: 'task', id: 'task-prereq', taskGroupVersionId: 'tgv-root-v2' }],
      understandingLevel: 'unknown',
      unknowns: ['Still need source discovery']
    }
  ]
}, null, 2));
run(['decompose', blockerWorkDir, '--task-group-id', 'tg-root', '--spec', blockerSpecPath]);
const blockerSnapshotPath = join(blockerWorkDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(blockerSnapshotPath, readFileSync(blockerSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const unblockDryRunOut = JSON.parse(run(['unblock-check', blockerWorkDir, '--dry-run', '--json']).stdout);
if (unblockDryRunOut.unblocked.length !== 2 || !unblockDryRunOut.unblocked.some((item) => item.taskId === 'task-dependent') || !unblockDryRunOut.unblocked.some((item) => item.taskId === 'task-dependent-unknown')) {
  console.error('Expected unblock-check to detect resolved task dependency');
  console.error(unblockDryRunOut);
  process.exit(1);
}
const blockerRunOut = JSON.parse(run(['run', blockerWorkDir, '--executor', 'dry-run', '--max-steps', '1', '--json']).stdout);
if (blockerRunOut.stopReason !== 'max_steps' || blockerRunOut.stepsRun !== 1 || blockerRunOut.actions[0]?.taskId !== 'task-dependent') {
  console.error('Expected runner to unblock and execute the clean dependent task first');
  console.error(blockerRunOut);
  process.exit(1);
}
const blockerSecondRunOut = JSON.parse(run(['run', blockerWorkDir, '--executor', 'dry-run', '--max-steps', '1', '--json']).stdout);
if (blockerSecondRunOut.stopReason !== 'max_steps' || blockerSecondRunOut.stepsRun !== 1 || blockerSecondRunOut.actions[0]?.taskId !== 'task-dependent-unknown' || blockerSecondRunOut.actions[0]?.kind !== 'explore') {
  console.error('Expected runner to reclassify stale unblocked task and run exploration next');
  console.error(blockerSecondRunOut);
  process.exit(1);
}
const staleUnblockTask = parseFrontmatterText(readFileSync(join(blockerWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-dependent-unknown.md'), 'utf8'));
if (staleUnblockTask.status !== 'done' || staleUnblockTask.runReadiness !== 'needs_decomposition') {
  console.error('explored stale unblocked task should be ready for decomposition after exploratory closure');
  console.error(staleUnblockTask);
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

// ---- loopback policy: any pending delegation auto-resolves within budget and records executor ----
const loopbackOkDir = join(tempRoot, 'runner-loopback-ok');
run(['init', loopbackOkDir, '--id', 'runner-loopback-ok', '--title', 'Loopback ok', '--objective', 'Verify loopback resolves a waiting delegation within budget', '--language', 'en']);
writeFileSync(join(loopbackOkDir, 'runs', 'run-main', 'nodes', 'run-node-human-delegate.md'), `---
taskOpsVersion: v1
entityType: runNode
id: run-node-human-delegate
runId: run-main
type: delegate
title: Self delegate awaiting loopback
status: waiting
delegateeType: self
delegateeRef: self
request: Review and decide via loopback.
expectedOutput: Loopback artifact attached.
requestedAt: 2026-05-12T00:00:00Z
createdAt: 2026-05-12T00:00:00Z
---
# Human delegate
`, 'utf8');
const loopbackOkOut = runTaskOps(loopbackOkDir, { executor: 'dry-run', loopback: 'self', maxLoopbacks: 2, maxSteps: 5, actor: 'Nova' });
if (loopbackOkOut.loopbacksUsed !== 1 || loopbackOkOut.loopbackPolicy !== 'self' || loopbackOkOut.actorName !== 'Nova') {
  console.error('Expected loopbacksUsed=1 with loopbackPolicy=self and actorName=Nova');
  console.error(loopbackOkOut);
  process.exit(1);
}
if (!loopbackOkOut.actions.some((a) => a.kind === 'loopback' && a.status === 'completed' && a.delegateRunNodeId === 'run-node-human-delegate' && a.executedBy === 'Nova' && a.executionMode === 'loopback')) {
  console.error('Expected a completed loopback action for run-node-human-delegate executed by Nova');
  console.error(loopbackOkOut.actions);
  process.exit(1);
}
const loopbackArtifactPath = join(loopbackOkDir, 'runs', 'run-main', 'artifacts', 'run-node-loopback-run-node-human-delegate.md');
const loopbackArtifactBody = readFileSync(loopbackArtifactPath, 'utf8');
if (!loopbackArtifactBody.includes('Loopback resolution artifact for run-node-human-delegate') || !loopbackArtifactBody.includes('- actualExecutor: Nova')) {
  console.error('Expected dry-run loopback artifact to mention the delegate id and actual executor');
  console.error(loopbackArtifactBody);
  process.exit(1);
}
const loopbackDelegateBody = readFileSync(join(loopbackOkDir, 'runs', 'run-main', 'nodes', 'run-node-human-delegate.md'), 'utf8');
if (!loopbackDelegateBody.includes('status: done') || !loopbackDelegateBody.includes('resolvedBy: loopback') || !loopbackDelegateBody.includes('executionMode: loopback') || !loopbackDelegateBody.includes('executedBy: Nova')) {
  console.error('Delegate node must close with loopback execution audit fields after loopback');
  console.error(loopbackDelegateBody);
  process.exit(1);
}
const loopbackEdgePath = join(loopbackOkDir, 'runs', 'run-main', 'edges', 'edge-run-node-human-delegate-loopback-1.md');
const loopbackEdgeBody = readFileSync(loopbackEdgePath, 'utf8');
if (!loopbackEdgeBody.includes('edgeType: loopback') || !loopbackEdgeBody.includes('toRunNodeId: run-node-loopback-run-node-human-delegate')) {
  console.error('Expected loopback edge from delegate to resolution node');
  console.error(loopbackEdgeBody);
  process.exit(1);
}
run(['validate', loopbackOkDir]);

// ---- loopback policy: budget exhausted yields max_loopbacks ----
const loopbackBudgetDir = join(tempRoot, 'runner-loopback-budget');
run(['init', loopbackBudgetDir, '--id', 'runner-loopback-budget', '--title', 'Loopback budget', '--objective', 'Verify loopback budget enforcement', '--language', 'en']);
writeFileSync(join(loopbackBudgetDir, 'runs', 'run-main', 'nodes', 'run-node-self-delegate.md'), `---
taskOpsVersion: v1
entityType: runNode
id: run-node-self-delegate
runId: run-main
type: delegate
title: Self delegate awaiting loopback
status: waiting
delegateeType: self
delegateeRef: self
request: Resolve via self-loopback.
expectedOutput: Loopback artifact attached.
requestedAt: 2026-05-12T00:00:00Z
createdAt: 2026-05-12T00:00:00Z
---
# Self delegate
`, 'utf8');
const loopbackBudgetOut = runTaskOps(loopbackBudgetDir, { executor: 'dry-run', loopback: 'self', maxLoopbacks: 0 });
if (loopbackBudgetOut.stopReason !== 'max_loopbacks') {
  console.error('Expected stopReason=max_loopbacks when --max-loopbacks=0 with pending self delegate');
  console.error(loopbackBudgetOut);
  process.exit(1);
}

// ---- loopback default: without loopback, any delegate still stops with delegation_pending ----
const loopbackDefaultStopDir = join(tempRoot, 'runner-loopback-default-stop');
run(['init', loopbackDefaultStopDir, '--id', 'runner-loopback-default-stop', '--title', 'Loopback default stop', '--objective', 'Verify default mode surfaces delegation instead of auto-resolving', '--language', 'en']);
writeFileSync(join(loopbackDefaultStopDir, 'runs', 'run-main', 'nodes', 'run-node-human-review.md'), `---
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
const loopbackDefaultStopOut = runTaskOps(loopbackDefaultStopDir, { executor: 'dry-run' });
if (loopbackDefaultStopOut.stopReason !== 'delegation_pending' || loopbackDefaultStopOut.loopbacksUsed !== 0) {
  console.error('Expected default loopback=none to stop with delegation_pending');
  console.error(loopbackDefaultStopOut);
  process.exit(1);
}

// ---- restart: rebuild active version, mark downstream pending, preserve upstream done ----
const restartDir = join(tempRoot, 'runner-restart');
run(['init', restartDir, '--id', 'runner-restart', '--title', 'Restart fixture', '--objective', 'Verify restart from task', '--language', 'en']);
const restartSpecPath = join(tempRoot, 'restart-spec.json');
writeFileSync(restartSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Restart fixture initial decomposition',
  selected: true,
  tasks: [
    { id: 'task-upstream', title: 'Upstream done', objective: 'Already complete.', responsibility: 'Owner finished it.', completionCriteria: 'Marked done.', order: 1, status: 'done', runReadiness: 'runnable', understandingLevel: 'known' },
    { id: 'task-target', title: 'Restart target', objective: 'This task is the restart point.', responsibility: 'Re-do this task with new instruction.', completionCriteria: 'Re-execute.', order: 2, status: 'done', runReadiness: 'runnable', understandingLevel: 'known' },
    { id: 'task-downstream', title: 'Downstream pending', objective: 'Depends on restart target.', responsibility: 'Re-run after restart.', completionCriteria: 'Re-execute.', order: 3, status: 'done', runReadiness: 'runnable', understandingLevel: 'known' },
  ],
}, null, 2));
run(['decompose', restartDir, '--task-group-id', 'tg-root', '--spec', restartSpecPath]);
const restartSnapshotPath = join(restartDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(restartSnapshotPath, readFileSync(restartSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
// Seed an EoW only for the upstream task so the preservation EoW has a source reference.
// Skip target/downstream EoWs so the restarted v3 runner can re-write its own EoWs without
// colliding with historical EoW IDs from v2.
writeFileSync(join(restartDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-upstream.md'), `---\ntaskOpsVersion: v1\nentityType: eow\nid: eow-task-upstream\ngraphType: task\nattachedToType: task\nattachedToId: task-upstream\nreason: smoke_seed\ndeclaredBy: smoke\ndeclaredAt: 2026-05-12T00:00:00Z\ncreatedAt: 2026-05-12T00:00:00Z\nstatus: done\ntaskGroupVersionId: tgv-root-v2\n---\n# EoW: task-upstream\n`, 'utf8');
run(['validate', restartDir]);
const restartOut = JSON.parse(run(['restart', restartDir, '--from', 'task-target', '--instruction', 'Re-do task-target with updated context', '--reason', 'smoke_restart', '--json']).stdout);
if (restartOut.fromVersionId !== 'tgv-root-v2' || restartOut.toVersionId !== 'tgv-root-v3' || restartOut.fromTaskId !== 'task-target') {
  console.error('Expected restart to bump tgv-root-v2 -> tgv-root-v3');
  console.error(restartOut);
  process.exit(1);
}
if (restartOut.preservedTaskCount !== 1 || restartOut.resetTaskCount !== 1) {
  console.error('Expected 1 preserved upstream task and 1 reset downstream task');
  console.error(restartOut);
  process.exit(1);
}
const newVersionTasksDir = join(restartDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks');
const upstreamAfter = readFileSync(join(newVersionTasksDir, 'task-upstream.md'), 'utf8');
if (!upstreamAfter.includes('status: done') || !upstreamAfter.includes('preservedUpstream: true') || !upstreamAfter.includes('preservedFromVersionId: tgv-root-v2')) {
  console.error('Upstream task must remain done with preservedUpstream metadata');
  console.error(upstreamAfter);
  process.exit(1);
}
const targetAfter = readFileSync(join(newVersionTasksDir, 'task-target.md'), 'utf8');
if (!targetAfter.includes('status: pending') || !targetAfter.includes('restartInstruction: Re-do task-target with updated context') || !targetAfter.includes('restartReason: smoke_restart') || !targetAfter.includes('restartedFromVersionId: tgv-root-v2')) {
  console.error('Target task must be pending with restart metadata');
  console.error(targetAfter);
  process.exit(1);
}
const downstreamAfter = readFileSync(join(newVersionTasksDir, 'task-downstream.md'), 'utf8');
if (!downstreamAfter.includes('status: pending')) {
  console.error('Downstream task must be reset to pending');
  console.error(downstreamAfter);
  process.exit(1);
}
const newVersionEowDir = join(restartDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'eow');
const upstreamEow = readFileSync(join(newVersionEowDir, 'eow-task-upstream-tgv-root-v3.md'), 'utf8');
if (!upstreamEow.includes('reason: preserved_upstream_after_restart') || !upstreamEow.includes('preservedFromVersionId: tgv-root-v2')) {
  console.error('Preservation EoW must use preserved_upstream_after_restart reason');
  console.error(upstreamEow);
  process.exit(1);
}
const sourceVersionAfter = readFileSync(join(restartDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'index.md'), 'utf8');
if (!sourceVersionAfter.includes('selected: false') || !sourceVersionAfter.includes('supersededByVersionId: tgv-root-v3')) {
  console.error('Source version must be marked selected=false and supersededByVersionId');
  console.error(sourceVersionAfter);
  process.exit(1);
}
const newVersionIndex = readFileSync(join(restartDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'index.md'), 'utf8');
if (!newVersionIndex.includes('selected: true') || !newVersionIndex.includes('supersedesVersionId: tgv-root-v2') || !newVersionIndex.includes('restartedFromVersionId: tgv-root-v2')) {
  console.error('New version index must mark selected, supersedes, and restart metadata');
  console.error(newVersionIndex);
  process.exit(1);
}
const restartSnapshotAfter = readFileSync(restartSnapshotPath, 'utf8');
if (!restartSnapshotAfter.includes('versionId: tgv-root-v3') || restartSnapshotAfter.includes('versionId: tgv-root-v2')) {
  console.error('Active snapshot must point at tgv-root-v3 and no longer at tgv-root-v2');
  console.error(restartSnapshotAfter);
  process.exit(1);
}
const restartWorkLog = readFileSync(join(restartDir, 'work-log.md'), 'utf8');
if (!restartWorkLog.includes('restart from task=task-target')) {
  console.error('work-log.md must record the restart event');
  console.error(restartWorkLog);
  process.exit(1);
}
run(['validate', restartDir]);
const restartRunOut = JSON.parse(run(['run', restartDir, '--executor', 'dry-run', '--max-steps', '5', '--json']).stdout);
const restartActions = restartRunOut.actions || restartRunOut.tasks || [];
const restartTaskIds = restartActions.map((a) => a.taskId);
if (!restartTaskIds.includes('task-target') || !restartTaskIds.includes('task-downstream') || restartTaskIds.includes('task-upstream')) {
  console.error('Restart runner must re-execute target+downstream but not upstream');
  console.error(restartActions);
  process.exit(1);
}

// ---- restart input validation: missing instruction and missing task ----
const restartFailMissingInstr = spawnSync('node', [cli, 'restart', restartDir, '--from', 'task-target', '--json'], { encoding: 'utf8' });
if (restartFailMissingInstr.status === 0 || !/instruction/i.test(restartFailMissingInstr.stderr)) {
  console.error('Expected restart without --instruction to fail');
  console.error(restartFailMissingInstr.stdout, restartFailMissingInstr.stderr);
  process.exit(1);
}
const restartFailMissingTask = spawnSync('node', [cli, 'restart', restartDir, '--from', 'task-nonexistent', '--instruction', 'whatever', '--json'], { encoding: 'utf8' });
if (restartFailMissingTask.status === 0 || !/not found/i.test(restartFailMissingTask.stderr)) {
  console.error('Expected restart with unknown --from to fail');
  console.error(restartFailMissingTask.stdout, restartFailMissingTask.stderr);
  process.exit(1);
}

// ---- restart instruction-file: multiline prompts must not corrupt frontmatter ----
const restartFileDir = join(tempRoot, 'runner-restart-instruction-file');
run(['init', restartFileDir, '--id', 'runner-restart-instruction-file', '--title', 'Restart instruction file fixture', '--objective', 'Verify multiline instruction-file restart', '--language', 'en']);
const restartFileSpecPath = join(tempRoot, 'restart-file-spec.json');
writeFileSync(restartFileSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Restart instruction file fixture initial decomposition',
  selected: true,
  tasks: [
    { id: 'task-before', title: 'Before', objective: 'Already complete.', responsibility: 'Keep this done.', completionCriteria: 'Done.', order: 1, status: 'done', runReadiness: 'runnable', understandingLevel: 'known' },
    { id: 'task-restart-file', title: 'Restart from file', objective: 'Restart using file instruction.', responsibility: 'Re-do from file prompt.', completionCriteria: 'Pending after restart.', order: 2, status: 'done', runReadiness: 'runnable', understandingLevel: 'known' },
  ],
}, null, 2));
run(['decompose', restartFileDir, '--task-group-id', 'tg-root', '--spec', restartFileSpecPath]);
const restartFileSnapshotPath = join(restartFileDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(restartFileSnapshotPath, readFileSync(restartFileSnapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'));
const multilineInstructionPath = join(tempRoot, 'restart-multiline-instruction.md');
writeFileSync(multilineInstructionPath, 'Line one: preserve context\n- bullet A\n- bullet B\nFinal line.\n', 'utf8');
const restartFileOut = JSON.parse(run(['restart', restartFileDir, '--from', 'task-restart-file', '--instruction-file', multilineInstructionPath, '--reason', 'multiline_file', '--json']).stdout);
if (restartFileOut.toVersionId !== 'tgv-root-v3' || restartFileOut.instructionLength <= 'Line one'.length) {
  console.error('Expected instruction-file restart to create tgv-root-v3 with non-trivial instruction length');
  console.error(restartFileOut);
  process.exit(1);
}
const restartFileTaskBody = readFileSync(join(restartFileDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-restart-file.md'), 'utf8');
if (!restartFileTaskBody.includes('restartInstruction: Line one: preserve context - bullet A - bullet B Final line.')) {
  console.error('Multiline instruction-file content must be safely serialized as a single frontmatter scalar');
  console.error(restartFileTaskBody);
  process.exit(1);
}
run(['validate', restartFileDir]);

function activateVersion(workDir, versionId) {
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', `versionId: ${versionId}`));
}

function makeOneTaskWork(workDir, { id, taskId = 'task-main', blockedBy = null, acceptance = null } = {}) {
  run(['init', workDir, '--id', id, '--title', id, '--objective', `Smoke ${id}`, '--language', 'en']);
  const specPath = join(tempRoot, `${id}.json`);
  const task = {
    id: taskId,
    title: taskId,
    objective: `Complete ${taskId}.`,
    responsibility: `Own ${taskId}.`,
    completionCriteria: `${taskId} is done.`,
    status: 'pending',
    runReadiness: 'runnable',
    runReadinessReason: 'Smoke fixture is ready.',
    understandingLevel: 'known',
    order: 1,
  };
  if (blockedBy) task.blockedBy = blockedBy;
  if (acceptance) task.acceptance = acceptance;
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: `${id} decomposition`,
    selected: true,
    tasks: [task],
  }, null, 2));
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  activateVersion(workDir, 'tgv-root-v2');
}

function writeDelegate(workDir, {
  id,
  delegateeType,
  delegateeRef,
  sourceTaskId = 'task-main',
  sourceTaskGroupVersionId = 'tgv-root-v2',
  selfDelegate = false,
}) {
  const selfLine = selfDelegate ? 'selfDelegate: true\n' : '';
  writeFileSync(join(workDir, 'runs', 'run-main', 'nodes', `${id}.md`), `---
taskOpsVersion: v1
entityType: runNode
id: ${id}
runId: run-main
type: delegate
title: ${id}
status: waiting
delegateeType: ${delegateeType}
delegateeRef: ${delegateeRef}
${selfLine}sourceTaskId: ${sourceTaskId}
sourceTaskGroupVersionId: ${sourceTaskGroupVersionId}
request: Resolve this delegated smoke step.
expectedOutput: A concrete resolution.
requestedAt: 2026-05-12T00:00:00Z
createdAt: 2026-05-12T00:00:00Z
---
# ${id}
`, 'utf8');
}

// ---- queue-backed loopback: propagated through runner watch and target-aware release ----
const queueLoopbackDir = join(tempRoot, 'queue-loopback-self');
makeOneTaskWork(queueLoopbackDir, { id: 'queue-loopback-self' });
writeDelegate(queueLoopbackDir, { id: 'run-node-self-loop', delegateeType: 'self', delegateeRef: 'self', selfDelegate: true });
const queueLoopbackOut = JSON.parse(run([
  'runner', 'watch', queueLoopbackDir,
  '--runtime', 'dry-run',
  '--runner-id', 'queue-loopback-smoke',
  '--loopback', 'self',
  '--max-loopbacks', '1',
  '--max-waves', '2',
  '--report-sink', 'ledger',
  '--json'
]).stdout);
if (queueLoopbackOut.stopReason !== 'all_closed' || queueLoopbackOut.claimedItems !== 1 || queueLoopbackOut.loopbackPolicy !== 'self') {
  console.error('runner watch should propagate loopback self and close the claimed task after resolving a self delegate');
  console.error(queueLoopbackOut);
  process.exit(1);
}
const queueLoopbackWave = queueLoopbackOut.waves[0];
if (queueLoopbackWave.releaseStatus !== 'done' || queueLoopbackWave.targetCompleted !== true || queueLoopbackWave.runResult.loopbacksUsed !== 1) {
  console.error('loopback-enabled queue worker should report target completion only after the claimed task completes');
  console.error(queueLoopbackWave);
  process.exit(1);
}
if (queueLoopbackWave.runResult.maxSteps !== 50) {
  console.error('queue-backed loopback workers should use an independent default total-step safety cap, not maxLoopbacks + 1');
  console.error(queueLoopbackWave.runResult);
  process.exit(1);
}
if (!queueLoopbackWave.runResult.actions.some((a) => a.kind === 'loopback' && a.delegateRunNodeId === 'run-node-self-loop')) {
  console.error('queue-backed loopback run should include a loopback action');
  console.error(queueLoopbackWave.runResult.actions);
  process.exit(1);
}
const queueLoopbackReports = JSON.parse(run(['queue', 'reports', queueLoopbackDir, '--json']).stdout);
if (!queueLoopbackReports.reports[0].message.includes('targetCompleted: true')) {
  console.error('progress report should record final target completion');
  console.error(queueLoopbackReports.reports[0]);
  process.exit(1);
}
const queueLoopbackDelegate = readFileSync(join(queueLoopbackDir, 'runs', 'run-main', 'nodes', 'run-node-self-loop.md'), 'utf8');
if (!queueLoopbackDelegate.includes('resolvedBy: loopback')) {
  console.error('self delegate should be resolved by loopback in queue-backed execution');
  console.error(queueLoopbackDelegate);
  process.exit(1);
}
run(['validate', queueLoopbackDir]);

// ---- queue-backed loopback-only progress must not release claimed task as done ----
const loopbackOnlyDir = join(tempRoot, 'queue-loopback-only');
makeOneTaskWork(loopbackOnlyDir, { id: 'queue-loopback-only' });
writeDelegate(loopbackOnlyDir, { id: 'run-node-loopback-only', delegateeType: 'self', delegateeRef: 'self', selfDelegate: true });
const loopbackOnlyOut = JSON.parse(run([
  'runner', 'once', loopbackOnlyDir,
  '--runtime', 'dry-run',
  '--runner-id', 'loopback-only-smoke',
  '--loopback', 'self',
  '--max-loopbacks', '1',
  '--max-steps', '1',
  '--report-sink', 'ledger',
  '--json'
], 1).stdout);
if (loopbackOnlyOut.releaseStatus !== 'failed' || loopbackOnlyOut.targetCompleted !== false || loopbackOnlyOut.runResult.loopbacksUsed !== 1) {
  console.error('loopback-only progress must not be treated as claimed task completion');
  console.error(loopbackOnlyOut);
  process.exit(1);
}
const loopbackOnlyTask = readFileSync(join(loopbackOnlyDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-main.md'), 'utf8');
if (!loopbackOnlyTask.includes('status: pending')) {
  console.error('claimed task should remain pending after loopback-only progress');
  console.error(loopbackOnlyTask);
  process.exit(1);
}

// ---- queue-backed loopback none and non-self delegate stay honest ----
const loopbackNoneDir = join(tempRoot, 'queue-loopback-none');
makeOneTaskWork(loopbackNoneDir, { id: 'queue-loopback-none' });
writeDelegate(loopbackNoneDir, { id: 'run-node-none-self', delegateeType: 'self', delegateeRef: 'self', selfDelegate: true });
const loopbackNoneOut = JSON.parse(run([
  'runner', 'watch', loopbackNoneDir,
  '--runtime', 'dry-run',
  '--runner-id', 'loopback-none-smoke',
  '--loopback', 'none',
  '--max-waves', '1',
  '--json'
], 1).stdout);
if (loopbackNoneOut.stopReason !== 'wave_failed' || loopbackNoneOut.waves[0].runResult.stopReason !== 'delegation_pending') {
  console.error('loopback none should surface delegation_pending through queue automation');
  console.error(loopbackNoneOut);
  process.exit(1);
}

const nonSelfLoopbackDir = join(tempRoot, 'queue-non-self-loopback');
makeOneTaskWork(nonSelfLoopbackDir, { id: 'queue-non-self-loopback' });
writeDelegate(nonSelfLoopbackDir, { id: 'run-node-human-loop', delegateeType: 'human', delegateeRef: 'stakeholder' });
const nonSelfLoopbackOut = JSON.parse(run([
  'runner', 'watch', nonSelfLoopbackDir,
  '--runtime', 'dry-run',
  '--runner-id', 'non-self-loopback-smoke',
  '--loopback', 'self',
  '--max-loopbacks', '2',
  '--max-waves', '1',
  '--json'
], 1).stdout);
if (nonSelfLoopbackOut.waves[0].runResult.loopbacksUsed !== 0 || nonSelfLoopbackOut.waves[0].runResult.stopReason !== 'delegation_pending') {
  console.error('loopback self must not execute non-self delegates');
  console.error(nonSelfLoopbackOut);
  process.exit(1);
}
const nonSelfDelegate = readFileSync(join(nonSelfLoopbackDir, 'runs', 'run-main', 'nodes', 'run-node-human-loop.md'), 'utf8');
if (!nonSelfDelegate.includes('status: waiting') || nonSelfDelegate.includes('resolvedBy: loopback')) {
  console.error('non-self delegate must remain waiting and unresolved by loopback');
  console.error(nonSelfDelegate);
  process.exit(1);
}

const conflictingSelfFlagDir = join(tempRoot, 'queue-conflicting-self-flag');
makeOneTaskWork(conflictingSelfFlagDir, { id: 'queue-conflicting-self-flag' });
writeDelegate(conflictingSelfFlagDir, { id: 'run-node-conflicting-self-flag', delegateeType: 'human', delegateeRef: 'stakeholder', selfDelegate: true });
const conflictingSelfFlagOut = JSON.parse(run([
  'runner', 'watch', conflictingSelfFlagDir,
  '--runtime', 'dry-run',
  '--runner-id', 'conflicting-self-flag-smoke',
  '--loopback', 'self',
  '--max-loopbacks', '2',
  '--max-waves', '1',
  '--json'
], 1).stdout);
if (conflictingSelfFlagOut.waves[0].runResult.loopbacksUsed !== 0 || conflictingSelfFlagOut.waves[0].runResult.stopReason !== 'delegation_pending') {
  console.error('selfDelegate=true must not override explicit non-self delegatee fields');
  console.error(conflictingSelfFlagOut);
  process.exit(1);
}

const runLoopbackFailureDir = join(tempRoot, 'run-loopback-failure-exit');
makeOneTaskWork(runLoopbackFailureDir, { id: 'run-loopback-failure-exit' });
writeDelegate(runLoopbackFailureDir, { id: 'run-node-run-loopback-failure', delegateeType: 'human', delegateeRef: 'stakeholder' });
const runLoopbackFailure = run([
  'run', runLoopbackFailureDir,
  '--executor', 'dry-run',
  '--loopback', 'self',
  '--max-loopbacks', '1',
  '--json'
], 1);
const runLoopbackFailureOut = JSON.parse(runLoopbackFailure.stdout);
if (runLoopbackFailureOut.cycles[0].stopReason !== 'wave_failed') {
  console.error('user-facing taskops run --loopback self should exit nonzero when daemon-backed watch fails');
  console.error(runLoopbackFailureOut);
  process.exit(1);
}

const runIdLoopbackDir = join(tempRoot, 'run-loopback-run-id');
makeOneTaskWork(runIdLoopbackDir, { id: 'run-loopback-run-id' });
writeDelegate(runIdLoopbackDir, { id: 'run-node-run-id-loopback', delegateeType: 'self', delegateeRef: 'self', selfDelegate: true });
const runIdLoopbackOut = JSON.parse(run([
  'run', runIdLoopbackDir,
  '--executor', 'dry-run',
  '--loopback', 'self',
  '--max-loopbacks', '1',
  '--max-steps', '2',
  '--run-id', 'custom-loopback-run',
  '--json'
]).stdout);
if (runIdLoopbackOut.cycles[0].stopReason !== 'all_closed' || !runIdLoopbackOut.cycles[0].waveDetails[0].stopReason) {
  console.error('run-id loopback smoke should complete through daemon-backed execution');
  console.error(runIdLoopbackOut);
  process.exit(1);
}
const expectedWorkerRunDir = join(runIdLoopbackDir, 'runs', 'custom-loopback-run-tgv-root-v2-task-main');
if (!readdirSync(join(runIdLoopbackDir, 'runs')).includes('custom-loopback-run-tgv-root-v2-task-main') || !readFileSync(join(expectedWorkerRunDir, 'events.jsonl'), 'utf8').includes('"type":"runner_stopped"')) {
  console.error('--run-id should be preserved as the prefix for daemon-backed loopback worker run ids');
  console.error(readdirSync(join(runIdLoopbackDir, 'runs')));
  process.exit(1);
}

// ---- daemon loopback unit/enable/delegate entrypoint propagation ----
const daemonLoopbackDir = join(tempRoot, 'daemon-loopback-options');
makeOneTaskWork(daemonLoopbackDir, { id: 'daemon-loopback-options' });
const daemonLoopbackUnit = JSON.parse(run([
  'daemon', 'unit', daemonLoopbackDir,
  '--name', 'daemon-loopback-options',
  '--runtime', 'dry-run',
  '--loopback', 'self',
  '--max-loopbacks', '4',
  '--max-parallel', '3',
  '--max-steps', '7',
  '--json'
]).stdout);
if (!daemonLoopbackUnit.unit.includes('--loopback self') || !daemonLoopbackUnit.unit.includes('--max-loopbacks 4') || !daemonLoopbackUnit.unit.includes('--max-parallel 3') || !daemonLoopbackUnit.unit.includes('--max-steps 7')) {
  console.error('daemon unit should preserve loopback and worker-pool options');
  console.error(daemonLoopbackUnit.unit);
  process.exit(1);
}
const daemonLoopbackEnable = JSON.parse(run([
  'daemon', 'enable', daemonLoopbackDir,
  '--name', 'daemon-loopback-options',
  '--runtime', 'dry-run',
  '--loopback', 'self',
  '--max-loopbacks', '4',
  '--max-parallel', '3',
  '--dry-run',
  '--json'
]).stdout);
if (daemonLoopbackEnable.activation.loopbackPolicy !== 'self' || daemonLoopbackEnable.activation.maxLoopbacks !== 4 || daemonLoopbackEnable.activation.maxParallel !== 3 || !daemonLoopbackEnable.activationPath.endsWith(join('.taskops', 'runner.json'))) {
  console.error('daemon enable --dry-run should expose persisted loopback activation settings');
  console.error(daemonLoopbackEnable);
  process.exit(1);
}

const delegatedEntrypointDir = join(tempRoot, 'delegated-entrypoint');
const delegatedEntrypointCheckMarker = join(tempRoot, 'delegated-entrypoint-check-marker');
const delegatedEntrypointCheck = `test -f ${delegatedEntrypointCheckMarker} || { touch ${delegatedEntrypointCheckMarker}; exit 1; }`;
makeOneTaskWork(delegatedEntrypointDir, {
  id: 'delegated-entrypoint',
  acceptance: {
    mode: 'guarded',
    expectedOutcome: 'The delegated entrypoint worker reaches runner-verified completion.',
    requiredChecks: [{ command: delegatedEntrypointCheck }],
  },
});
writeDelegate(delegatedEntrypointDir, { id: 'run-node-delegated-entrypoint', delegateeType: 'self', delegateeRef: 'self', selfDelegate: true });
const delegatedEntrypointOut = JSON.parse(run([
  'delegate', delegatedEntrypointDir,
  '--foreground',
  '--runtime', 'dry-run',
  '--verify-checks',
  '--verify-retries', '1',
  '--max-loopbacks', '1',
  '--max-steps', '4',
  '--max-daemon-cycles', '1',
  '--json'
]).stdout);
const delegatedEntrypointCycle = delegatedEntrypointOut.cycles[0];
const delegatedEntrypointWave = delegatedEntrypointCycle.waveDetails[0];
if (delegatedEntrypointCycle.stopReason !== 'all_closed' || delegatedEntrypointCycle.claimedItems !== 1 || delegatedEntrypointWave?.releaseStatus !== 'done' || delegatedEntrypointWave?.targetCompleted !== true) {
  console.error('high-level delegate entrypoint should reuse daemon run internals and complete the claimed task');
  console.error(delegatedEntrypointOut);
  process.exit(1);
}
const delegatedEntrypointRunDir = join(delegatedEntrypointDir, 'runs', 'run-tgv-root-v2-task-main');
const delegatedEntrypointReview = parseFrontmatterText(readFileSync(join(delegatedEntrypointRunDir, 'nodes', 'review-run-node-task-main.md'), 'utf8'));
const delegatedEntrypointRunNode = parseFrontmatterText(readFileSync(join(delegatedEntrypointRunDir, 'nodes', 'run-node-task-main.md'), 'utf8'));
const delegatedEntrypointTask = parseFrontmatterText(readFileSync(join(delegatedEntrypointDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-main.md'), 'utf8'));
const delegatedEntrypointEvents = readFileSync(join(delegatedEntrypointRunDir, 'events.jsonl'), 'utf8');
const delegatedEntrypointRunnerCheck = (delegatedEntrypointRunNode.result?.observed?.checkResults || [])
  .find((check) => check.command === delegatedEntrypointCheck);
if (
  delegatedEntrypointTask.status !== 'done'
  || delegatedEntrypointReview.reviewReport?.decision !== 'approved'
  || delegatedEntrypointReview.reviewReport?.verified !== true
  || delegatedEntrypointRunnerCheck?.status !== 'passed'
  || delegatedEntrypointRunnerCheck?.verifiedBy !== 'runner'
  || !delegatedEntrypointEvents.includes('"type":"verify_retry"')
) {
  console.error('taskops delegate --foreground should propagate --verify-checks/--verify-retries into the worker path and close with runner-verified evidence');
  console.error({
    taskStatus: delegatedEntrypointTask.status,
    reviewReport: delegatedEntrypointReview.reviewReport,
    checkResults: delegatedEntrypointRunNode.result?.observed?.checkResults || [],
    events: delegatedEntrypointEvents,
  });
  process.exit(1);
}

const runLoopbackEntrypointDir = join(tempRoot, 'run-loopback-entrypoint');
makeOneTaskWork(runLoopbackEntrypointDir, { id: 'run-loopback-entrypoint' });
writeDelegate(runLoopbackEntrypointDir, { id: 'run-node-run-loopback-entrypoint', delegateeType: 'self', delegateeRef: 'self', selfDelegate: true });
const runLoopbackEntrypointOut = JSON.parse(run([
  'run', runLoopbackEntrypointDir,
  '--executor', 'dry-run',
  '--loopback', 'self',
  '--max-loopbacks', '1',
  '--max-steps', '2',
  '--max-daemon-cycles', '1',
  '--json'
]).stdout);
if (runLoopbackEntrypointOut.cycles[0].stopReason !== 'all_closed' || runLoopbackEntrypointOut.cycles[0].claimedItems !== 1) {
  console.error('user-facing taskops run --loopback self should route through daemon-backed queue execution');
  console.error(runLoopbackEntrypointOut);
  process.exit(1);
}

// ---- queue projection backlog is separate from maxParallel worker-pool limit ----
const poolRefillDir = join(tempRoot, 'pool-refill-work');
run(['init', poolRefillDir, '--id', 'pool-refill-work', '--title', 'Pool refill work', '--objective', 'Verify maxParallel is active worker count, not queue size', '--language', 'en']);
const poolTasks = [];
for (let i = 1; i <= 10; i += 1) {
  poolTasks.push({
    id: `task-pool-${String(i).padStart(2, '0')}`,
    title: `Pool task ${i}`,
    objective: `Complete pool task ${i}.`,
    responsibility: `Own pool task ${i}.`,
    completionCriteria: `Pool task ${i} is done.`,
    status: 'pending',
    runReadiness: 'runnable',
    runReadinessReason: 'Ready for dry-run worker pool smoke.',
    understandingLevel: 'known',
    order: i,
  });
}
const poolSpecPath = join(tempRoot, 'pool-refill-spec.json');
writeFileSync(poolSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Pool refill decomposition',
  selected: true,
  tasks: poolTasks,
}, null, 2));
run(['decompose', poolRefillDir, '--task-group-id', 'tg-root', '--spec', poolSpecPath]);
activateVersion(poolRefillDir, 'tgv-root-v2');
const poolSync = JSON.parse(run(['queue', 'sync', poolRefillDir, '--json']).stdout);
if (poolSync.synced !== 10 || poolSync.rows.length !== 10) {
  console.error('queue sync should project all selected tasks, independent of maxParallel');
  console.error(poolSync);
  process.exit(1);
}
const poolWatch = JSON.parse(run([
  'runner', 'watch', poolRefillDir,
  '--runtime', 'dry-run',
  '--runner-id', 'pool-refill-smoke',
  '--max-parallel', '3',
  '--max-waves', '20',
  '--json'
]).stdout);
if (poolWatch.stopReason !== 'all_closed' || poolWatch.maxParallel !== 3 || poolWatch.claimedItems !== 10 || poolWatch.waves.length !== 10) {
  console.error('runner watch should drain ten queued tasks with maxParallel=3 while keeping queue projection separate from concurrency');
  console.error(poolWatch);
  process.exit(1);
}
const poolDb = new DatabaseSync(join(poolRefillDir, '.taskops', 'queue.sqlite'));
const poolCounts = {
  queueItems: poolDb.prepare('SELECT COUNT(*) AS n FROM queue_items').get().n,
  leases: poolDb.prepare('SELECT COUNT(*) AS n FROM leases').get().n,
  doneLeases: poolDb.prepare("SELECT COUNT(*) AS n FROM leases WHERE status = 'done'").get().n,
  attempts: poolDb.prepare('SELECT COUNT(*) AS n FROM runner_attempts').get().n,
};
poolDb.close();
if (poolCounts.queueItems !== 10 || poolCounts.leases !== 10 || poolCounts.doneLeases !== 10 || poolCounts.attempts !== 10) {
  console.error('worker pool smoke should leave one-shot lease/attempt evidence for every selected task');
  console.error(poolCounts);
  process.exit(1);
}

rmSync(tempRoot, { recursive: true, force: true });
console.log('OK: taskops CLI smoke passed');
