#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseProject } from '../lib-taskops.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const cliPath = join(repoRoot, 'cli', 'bin', 'taskops.js');

function parseArgs(argv) {
  const out = {
    trials: 2,
    runtime: 'dry-run',
    outputRoot: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--trials') out.trials = Number(argv[++i]);
    else if (arg === '--runtime') out.runtime = String(argv[++i]);
    else if (arg === '--output-root') out.outputRoot = String(argv[++i]);
    else if (arg === '--json') out.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(out.trials) || out.trials < 1) throw new Error('--trials must be a positive integer');
  if (out.runtime !== 'dry-run') throw new Error('Step 2 daemon/delegate harness currently supports only --runtime dry-run');
  return out;
}

function runCli(args, { cwd = repoRoot, timeoutMs = null, command = process.execPath, prefixArgs = [] } = {}) {
  const proc = spawnSync(command, [...prefixArgs, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs ?? undefined,
  });
  return {
    status: proc.status,
    signal: proc.signal,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    error: proc.error ? String(proc.error.message || proc.error) : null,
  };
}

function runTaskops(args, options = {}) {
  const result = runCli([cliPath, ...args], options);
  if (result.status !== 0) {
    throw new Error(`taskops ${args.join(' ')} failed with status ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result;
}

function runDaemon(workDir, { name, runnerId }) {
  const args = [
    '90s',
    process.execPath,
    cliPath,
    'daemon',
    'run',
    workDir,
    '--name', name,
    '--runtime', 'dry-run',
    '--runner-id', runnerId,
    '--report-sink', 'ledger',
    '--daemon-poll-interval-ms', '1',
    '--poll-interval-ms', '1',
    '--max-daemon-cycles', '1',
    '--max-steps', '4',
    '--max-waves', '4',
    '--timeout', '10',
    '--loopback', 'self',
    '--max-loopbacks', '2',
    '--json',
  ];
  const result = runCli(args, { command: 'timeout' });
  if (result.status !== 0) {
    throw new Error(`daemon run failed with status ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return { command: `timeout ${args.join(' ')}`, result, json: JSON.parse(result.stdout) };
}

function writeTask(workDir, { taskId, workId }) {
  const now = new Date().toISOString();
  const taskPath = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'tasks', `${taskId}.md`);
  writeFileSync(taskPath, `---
taskOpsVersion: v1
entityType: task
id: ${taskId}
taskGroupId: tg-root
taskGroupVersionId: tgv-root-v1
title: Queue loopback task
objective: Complete the queue loopback task after resolving the self delegate.
responsibility: Prove daemon/watch queue execution can resolve a self delegate and then close the claimed task.
completionCriteria: The task is done, task/run EoW exists, and queue/lease/attempt/report ledger rows are coherent.
order: 1
createdAt: ${now}
status: pending
runReadiness: runnable
runReadinessReason: Clean harness fixture is ready for dry-run daemon/delegate execution.
understandingLevel: known
---
# Queue loopback task

Fixture for ${workId}.
`, 'utf8');
  return taskPath;
}

function writeSelfDelegate(workDir, { delegateId, taskId }) {
  const delegatePath = join(workDir, 'runs', 'run-main', 'nodes', `${delegateId}.md`);
  writeFileSync(delegatePath, `---
taskOpsVersion: v1
entityType: runNode
id: ${delegateId}
runId: run-main
type: delegate
title: Self delegate resolution
status: waiting
delegateeType: self
delegateeRef: self
selfDelegate: true
request: Resolve this self-delegated queue harness step before the task executes.
expectedOutput: A concrete loopback resolution artifact.
requestedAt: 2026-06-30T00:00:00.000Z
createdAt: 2026-06-30T00:00:00.000Z
---
# Self delegate resolution
`, 'utf8');
  return delegatePath;
}

function countWarnings(warnings, { allowOpenFixtureWarnings = false } = {}) {
  const selectedVersion = warnings.filter((warning) => warning.includes('multiple selected/active versions detected')).length;
  const activeStructural = warnings.filter((warning) => warning.includes('work status is active while graph is structurally complete')).length;
  const terminalTaskMissingEow = warnings.filter((warning) => warning.includes("terminal task '") && warning.includes('has no EoW node')).length;
  const missingTaskBackReference = warnings.filter((warning) => warning.includes('points to task') && warning.includes('no matching runRefs')).length;
  const unexpected = warnings.filter((warning) => (
    !warning.includes('multiple selected/active versions detected')
    && !warning.includes('work status is active while graph is structurally complete')
    && !(allowOpenFixtureWarnings && warning.includes("terminal task '") && warning.includes('has no EoW node'))
    && !(allowOpenFixtureWarnings && warning.includes('points to task') && warning.includes('no matching runRefs'))
  ));
  return { selectedVersion, activeStructural, terminalTaskMissingEow, missingTaskBackReference, unexpected };
}

function parseEvents(workDir) {
  const runsDir = join(workDir, 'runs');
  const eventsPaths = existsSync(runsDir)
    ? readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(runsDir, entry.name, 'events.jsonl'))
      .filter((eventsPath) => existsSync(eventsPath))
      .sort()
    : [];
  const events = eventsPaths.flatMap((eventsPath) => readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line)));
  const counts = {};
  for (const event of events) counts[event.type] = (counts[event.type] || 0) + 1;
  return { eventsPaths, events, counts };
}

function readQueueDb(workDir) {
  const dbPath = join(workDir, '.taskops', 'queue.sqlite');
  assert.equal(existsSync(dbPath), true, 'queue.sqlite should exist inside the temp workdir');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const tables = tableRows.map((row) => row.name);
    const queueItems = db.prepare('SELECT id, work_root, task_id, run_id, readiness, status FROM queue_items ORDER BY id').all();
    const leases = db.prepare('SELECT id, queue_item_id, runner_id, status FROM leases ORDER BY id').all();
    const attempts = db.prepare('SELECT id, queue_item_id, lease_id, runner_id, runtime_adapter, status, run_id, stop_reason FROM runner_attempts ORDER BY id').all();
    const reports = db.prepare('SELECT id, work_root, work_id, queue_item_id, task_id, wave_id, report_sink, status, message FROM progress_reports ORDER BY id').all();
    return {
      dbPath,
      tables,
      counts: {
        queue_items: queueItems.length,
        leases: leases.length,
        runner_attempts: attempts.length,
        progress_reports: reports.length,
      },
      queueItems,
      leases,
      attempts,
      reports,
    };
  } finally {
    db.close();
  }
}

function createCleanFixture(root, trialIndex) {
  const workId = `daemon-delegate-harness-${trialIndex}`;
  const workDir = join(root, `trial-${trialIndex}`, 'work');
  mkdirSync(dirname(workDir), { recursive: true });
  runTaskops(['init', workDir, '--id', workId, '--title', `Daemon delegate harness ${trialIndex}`, '--objective', 'Verify dry-run daemon/delegate queue and loopback wiring', '--language', 'en']);
  const taskId = 'task-main';
  const delegateId = 'run-node-self-loop';
  const taskPath = writeTask(workDir, { taskId, workId });
  const delegatePath = writeSelfDelegate(workDir, { delegateId, taskId });
  const parsed = parseProject(workDir);
  const warnings = countWarnings(parsed.warnings, { allowOpenFixtureWarnings: true });
  assert.deepEqual(parsed.errors, [], 'clean fixture pre-run errors should be empty');
  assert.equal(warnings.selectedVersion, 0, 'clean fixture should not have selected-version warning before run');
  assert.equal(warnings.activeStructural, 0, 'clean fixture should not be structurally complete before run');
  assert.equal(warnings.terminalTaskMissingEow, 1, 'clean fixture should start open with one terminal task missing EoW warning');
  assert.equal(warnings.missingTaskBackReference, 0, 'clean fixture delegate should have task runRefs back-reference');
  assert.deepEqual(warnings.unexpected, [], 'clean fixture should not have unexpected pre-run warnings');
  return { workId, workDir, taskId, delegateId, taskPath, delegatePath, preRun: { errors: parsed.errors, warnings: parsed.warnings } };
}

function readTaskStatus(workDir, taskId) {
  const taskPath = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'tasks', `${taskId}.md`);
  const text = readFileSync(taskPath, 'utf8');
  return {
    taskPath,
    statusDone: /^status: done$/m.test(text),
    hasRunRefs: /^runRefs:/m.test(text),
    text,
  };
}

function readDelegateStatus(workDir, delegateId) {
  const delegatePath = join(workDir, 'runs', 'run-main', 'nodes', `${delegateId}.md`);
  const text = readFileSync(delegatePath, 'utf8');
  return {
    delegatePath,
    statusDone: /^status: done$/m.test(text),
    resolvedByLoopback: /^resolvedBy: loopback$/m.test(text),
    text,
  };
}

function runTrial(root, trialIndex) {
  const fixture = createCleanFixture(root, trialIndex);
  const runnerId = `daemon-delegate-harness-${trialIndex}`;
  const daemon = runDaemon(fixture.workDir, { name: runnerId, runnerId });
  const daemonOut = daemon.json;
  const cycle = daemonOut.cycles?.[0];
  const wave = cycle?.waveDetails?.[0];

  const parsed = parseProject(fixture.workDir);
  const postWarnings = countWarnings(parsed.warnings);
  const events = parseEvents(fixture.workDir);
  const db = readQueueDb(fixture.workDir);
  const task = readTaskStatus(fixture.workDir, fixture.taskId);
  const delegate = readDelegateStatus(fixture.workDir, fixture.delegateId);
  const loopbackArtifactPath = join(fixture.workDir, 'runs', 'run-main', 'artifacts', `run-node-loopback-${fixture.delegateId}.md`);
  const loopbackArtifactExists = existsSync(loopbackArtifactPath);
  const loopbackArtifact = loopbackArtifactExists ? readFileSync(loopbackArtifactPath, 'utf8') : '';
  const explain = JSON.parse(runTaskops(['explain', fixture.workDir, '--json']).stdout);

  assert.equal(daemonOut.workDir, resolve(fixture.workDir), 'daemon workDir should match fixture workDir');
  assert.equal(daemonOut.cycles.length, 1, 'daemon should run exactly one bounded cycle');
  assert.equal(cycle.stopReason, 'all_closed', 'daemon cycle should stop all_closed');
  assert.equal(cycle.claimedWaves, 1, 'daemon should claim one wave');
  assert.equal(cycle.claimedItems, 1, 'daemon should claim one item');
  assert.equal(wave.releaseStatus, 'done', 'claimed wave should release done');
  assert.equal(wave.targetCompleted, true, 'claimed wave should complete target after loopback');
  assert.equal(db.counts.queue_items, 1, 'should have one queue item row');
  assert.equal(db.counts.leases, 1, 'should have one lease row');
  assert.equal(db.counts.runner_attempts, 1, 'should have one runner attempt row');
  assert.equal(db.counts.progress_reports, 1, 'should have one progress report row');
  assert.deepEqual(db.queueItems.map((row) => row.status), ['done'], 'queue item should be done');
  assert.deepEqual(db.leases.map((row) => row.status), ['done'], 'lease should be done');
  assert.deepEqual(db.attempts.map((row) => row.status), ['done'], 'attempt should be done');
  assert.deepEqual(db.attempts.map((row) => row.run_id), ['run-tgv-root-v1-task-main'], 'attempt should record the targeted task run id');
  assert.deepEqual(db.reports.map((row) => row.status), ['delivered'], 'progress report should be delivered');
  assert.match(db.reports[0].message, /completed: loopback:run-node-self-loop, execute:task-main/, 'progress report should record loopback then task execution');
  assert.match(db.reports[0].message, /targetCompleted: true/, 'progress report should record final target completion');
  assert.equal(new Set(db.queueItems.map((row) => row.work_root)).size, 1, 'queue work_root should be singular');
  assert.equal(db.queueItems[0].work_root, resolve(fixture.workDir), 'queue work_root should match fixture workDir');
  assert.deepEqual([...new Set(db.reports.map((row) => row.work_id))], [fixture.workId], 'report work_id should match fixture work id');
  assert.equal(task.statusDone, true, 'task should be done');
  assert.equal(task.hasRunRefs, true, 'task should have runRefs');
  assert.equal(delegate.statusDone, true, 'delegate should be done');
  assert.equal(delegate.resolvedByLoopback, true, 'delegate should be resolved by loopback');
  assert.equal(loopbackArtifactExists, true, 'dry-run loopback artifact should exist');
  assert.match(loopbackArtifact, /executionMode: loopback/, 'loopback artifact should record executionMode');
  assert.equal(events.counts.loopback_started, 1, 'events should include one loopback_started');
  assert.equal(events.counts.loopback_completed, 1, 'events should include one loopback_completed');
  assert.deepEqual(parsed.errors, [], 'post-run validation errors should be empty');
  assert.equal(postWarnings.selectedVersion, 0, 'post-run selected-version warning should be absent');
  assert.equal(postWarnings.activeStructural, 1, 'post-run active/structural warning should be exactly one');
  assert.deepEqual(postWarnings.unexpected, [], 'post-run unexpected warnings should be absent');
  assert.equal(explain.closure?.complete, true, 'explain closure.complete should be true');

  const semantic = {
    stopReason: cycle.stopReason,
    cycles: daemonOut.cycles.length,
    claimedWaves: cycle.claimedWaves,
    claimedItems: cycle.claimedItems,
    waveReleaseStatus: wave.releaseStatus,
    waveTargetCompleted: wave.targetCompleted,
    queueCounts: db.counts,
    queueStatuses: db.queueItems.map((row) => `${row.id}:${row.status}:${row.readiness}`),
    leaseStatuses: db.leases.map((row) => row.status),
    attemptStatuses: db.attempts.map((row) => `${row.runtime_adapter}:${row.status}:${row.stop_reason || ''}`),
    reportStatuses: db.reports.map((row) => `${row.report_sink}:${row.status}`),
    loopbackEvents: {
      started: events.counts.loopback_started || 0,
      completed: events.counts.loopback_completed || 0,
    },
    taskDone: task.statusDone,
    delegateDone: delegate.statusDone,
    delegateResolvedByLoopback: delegate.resolvedByLoopback,
    loopbackArtifactExists,
    validateWarnings: {
      selectedVersion: postWarnings.selectedVersion,
      activeStructural: postWarnings.activeStructural,
      unexpected: postWarnings.unexpected.length,
    },
    closureComplete: explain.closure?.complete === true,
    workIdConsistency: {
      daemonWorkDirMatches: daemonOut.workDir === resolve(fixture.workDir),
      queueWorkRootMatches: db.queueItems.every((row) => row.work_root === resolve(fixture.workDir)),
      reportWorkIdMatches: db.reports.every((row) => row.work_id === fixture.workId),
    },
  };

  return {
    trial: trialIndex,
    fixture,
    command: daemon.command,
    daemon: {
      name: daemonOut.name,
      runnerId: daemonOut.runnerId,
      workDir: daemonOut.workDir,
      cycles: daemonOut.cycles,
    },
    db,
    events: {
      paths: events.eventsPaths,
      counts: events.counts,
    },
    task: {
      path: task.taskPath,
      statusDone: task.statusDone,
      hasRunRefs: task.hasRunRefs,
    },
    delegate: {
      path: delegate.delegatePath,
      statusDone: delegate.statusDone,
      resolvedByLoopback: delegate.resolvedByLoopback,
    },
    loopbackArtifactPath,
    loopbackArtifactExists,
    postRun: {
      errors: parsed.errors,
      warnings: parsed.warnings,
      warningCounts: postWarnings,
      explainClosureComplete: explain.closure?.complete === true,
    },
    semantic,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputRoot = args.outputRoot
    ? resolve(args.outputRoot)
    : join(tmpdir(), `taskops-daemon-delegate-harness-${Date.now()}-${randomUUID().slice(0, 8)}`);
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  const trials = [];
  for (let i = 1; i <= args.trials; i += 1) {
    trials.push(runTrial(outputRoot, i));
  }
  const [first, ...rest] = trials.map((trial) => trial.semantic);
  const deterministic = rest.every((trial) => JSON.stringify(trial) === JSON.stringify(first));
  const report = {
    ok: true,
    harness: 'daemon-delegate-dry-run',
    runtime: args.runtime,
    repoRoot,
    cliPath,
    outputRoot,
    trialCount: args.trials,
    deterministic,
    trials,
  };
  const reportPath = join(outputRoot, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (args.json) {
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  } else {
    console.log(`OK daemon/delegate harness dry-run trials=${args.trials} deterministic=${deterministic}`);
    console.log(`outputRoot=${outputRoot}`);
    console.log(`report=${reportPath}`);
    for (const trial of trials) {
      const cycle = trial.daemon.cycles[0];
      const wave = cycle.waveDetails[0];
      console.log(`trial=${trial.trial} stopReason=${cycle.stopReason} claimedWaves=${cycle.claimedWaves} claimedItems=${cycle.claimedItems} release=${wave.releaseStatus} targetCompleted=${wave.targetCompleted} loopbackStarted=${trial.events.counts.loopback_started || 0} loopbackCompleted=${trial.events.counts.loopback_completed || 0}`);
      console.log(`trial=${trial.trial} db=${trial.db.dbPath} counts=${JSON.stringify(trial.db.counts)} warnings=${JSON.stringify(trial.postRun.warningCounts)}`);
    }
  }
}

main();
