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
const OUTER_TIMEOUT_SECONDS = 420;
const WORKER_TIMEOUT_SECONDS = 360;
const MAX_STEPS = 4;
const MAX_WAVES = 4;
const MAX_LOOPBACKS = 2;

const EXPECTED_WARNING_PATTERNS = [
  {
    key: 'readinessConsistency',
    pattern: "readiness consistency: explicit runReadiness 'runnable' differs from uncertainty readiness 'needs_exploration'",
  },
  {
    key: 'activeStructural',
    pattern: 'work status is active while graph is structurally complete',
  },
];

function parseArgs(argv) {
  const out = {
    trials: 3,
    runtime: 'claude-code',
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
  if (out.runtime !== 'claude-code') throw new Error('real baseline harness supports only --runtime claude-code');
  return out;
}

function runCli(args, { cwd = repoRoot, timeoutMs = null, command = process.execPath, prefixArgs = [] } = {}) {
  const startedAt = Date.now();
  const proc = spawnSync(command, [...prefixArgs, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: timeoutMs ?? undefined,
  });
  return {
    status: proc.status,
    signal: proc.signal,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    error: proc.error ? String(proc.error.message || proc.error) : null,
    elapsedMs: Date.now() - startedAt,
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
    `${OUTER_TIMEOUT_SECONDS}s`,
    process.execPath,
    cliPath,
    'daemon',
    'run',
    workDir,
    '--name', name,
    '--runtime', 'claude-code',
    '--runner-id', runnerId,
    '--report-sink', 'ledger',
    '--daemon-poll-interval-ms', '1',
    '--poll-interval-ms', '1',
    '--max-daemon-cycles', '1',
    '--max-steps', String(MAX_STEPS),
    '--max-waves', String(MAX_WAVES),
    '--timeout', String(WORKER_TIMEOUT_SECONDS),
    '--loopback', 'self',
    '--max-loopbacks', String(MAX_LOOPBACKS),
    '--json',
  ];
  const result = runCli(args, { command: 'timeout' });
  let json = null;
  let parseError = null;
  if (result.stdout.trim()) {
    try {
      json = JSON.parse(result.stdout);
    } catch (error) {
      parseError = String(error.message || error);
    }
  }
  return { command: `timeout ${args.join(' ')}`, result, json, parseError };
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
runReadinessReason: Clean harness fixture is ready for claude-code daemon/delegate execution.
understandingLevel: known
---
# Queue loopback task

Fixture for ${workId}.
`, 'utf8');
  return taskPath;
}

function writeSelfDelegate(workDir, { delegateId }) {
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
  const readinessConsistency = warnings.filter((warning) => warning.includes(EXPECTED_WARNING_PATTERNS[0].pattern)).length;
  const terminalTaskMissingEow = warnings.filter((warning) => warning.includes("terminal task '") && warning.includes('has no EoW node')).length;
  const missingTaskBackReference = warnings.filter((warning) => warning.includes('points to task') && warning.includes('no matching runRefs')).length;
  const unexpected = warnings.filter((warning) => (
    !warning.includes('multiple selected/active versions detected')
    && !warning.includes('work status is active while graph is structurally complete')
    && !warning.includes(EXPECTED_WARNING_PATTERNS[0].pattern)
    && !(allowOpenFixtureWarnings && warning.includes("terminal task '") && warning.includes('has no EoW node'))
    && !(allowOpenFixtureWarnings && warning.includes('points to task') && warning.includes('no matching runRefs'))
  ));
  return {
    selectedVersion,
    readinessConsistency,
    activeStructural,
    terminalTaskMissingEow,
    missingTaskBackReference,
    unexpected,
  };
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

function timestampMs(event) {
  const raw = event?.ts || event?.timestamp || event?.createdAt || event?.at;
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function eventTimings(events) {
  const firstOf = (type) => events.find((event) => event.type === type);
  const loopbackStart = firstOf('loopback_started');
  const loopbackDone = firstOf('loopback_completed');
  const taskStart = firstOf('task_started');
  const taskDone = firstOf('task_completed');
  const runnerStart = firstOf('runner_started');
  const runnerStopped = firstOf('runner_stopped');
  const elapsed = (start, end) => {
    const startMs = timestampMs(start);
    const endMs = timestampMs(end);
    return startMs != null && endMs != null ? endMs - startMs : null;
  };
  return {
    loopbackStartedAt: loopbackStart?.ts || null,
    loopbackCompletedAt: loopbackDone?.ts || null,
    taskStartedAt: taskStart?.ts || null,
    taskCompletedAt: taskDone?.ts || null,
    runnerStartedAt: runnerStart?.ts || null,
    runnerStoppedAt: runnerStopped?.ts || null,
    loopbackElapsedMs: elapsed(loopbackStart, loopbackDone),
    taskElapsedMs: elapsed(taskStart, taskDone),
    runnerElapsedMs: elapsed(runnerStart, runnerStopped),
    runnerStopReason: runnerStopped?.stopReason || null,
    runnerStepsRun: runnerStopped?.stepsRun ?? null,
  };
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
    const attempts = db.prepare('SELECT id, queue_item_id, lease_id, runner_id, runtime_adapter, status, run_id, stop_reason, error_summary FROM runner_attempts ORDER BY id').all();
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
  const workId = `daemon-delegate-real-baseline-${trialIndex}`;
  const workDir = join(root, `trial-${trialIndex}`, 'work');
  mkdirSync(dirname(workDir), { recursive: true });
  runTaskops(['init', workDir, '--id', workId, '--title', `Daemon delegate real baseline ${trialIndex}`, '--objective', 'Verify real claude-code daemon/delegate queue and loopback wiring', '--language', 'en']);
  const taskId = 'task-main';
  const delegateId = 'run-node-self-loop';
  const taskPath = writeTask(workDir, { taskId, workId });
  const delegatePath = writeSelfDelegate(workDir, { delegateId });
  const parsed = parseProject(workDir);
  const warnings = countWarnings(parsed.warnings, { allowOpenFixtureWarnings: true });
  assert.deepEqual(parsed.errors, [], 'clean fixture pre-run errors should be empty');
  assert.equal(warnings.selectedVersion, 0, 'clean fixture should not have selected-version warning before run');
  assert.equal(warnings.activeStructural, 0, 'clean fixture should not be structurally complete before run');
  assert.equal(warnings.readinessConsistency, 0, 'clean fixture should not have readiness consistency warning before run');
  assert.equal(warnings.terminalTaskMissingEow, 1, 'clean fixture should start open with one terminal task missing EoW warning');
  assert.equal(warnings.missingTaskBackReference, 0, 'clean fixture delegate should not produce task runRef back-reference warnings');
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
    frontmatter: extractFrontmatter(text),
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

function extractFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

function relevantTaskFrontmatter(frontmatter) {
  const keys = new Set([
    'status',
    'runReadiness',
    'runReadinessReason',
    'uncertaintyState',
    'understandingLevel',
    'runRefs',
    'knownList',
    'surpriseHistory',
  ]);
  const lines = frontmatter.split('\n');
  const out = [];
  let captureIndent = null;
  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):/);
    if (keyMatch) {
      if (keys.has(keyMatch[1])) {
        out.push(line);
        captureIndent = 0;
      } else {
        captureIndent = null;
      }
      continue;
    }
    if (captureIndent != null && (/^\s+-/.test(line) || /^\s{2,}\S/.test(line) || line.trim() === '')) {
      out.push(line);
    }
  }
  return out.join('\n').trim();
}

function check(condition, label, failures, details = null) {
  if (!condition) failures.push(details == null ? label : { label, details });
}

function checkWarnings(warningCounts, failures) {
  check(warningCounts.selectedVersion === 0, 'selected-version warning should be absent', failures, warningCounts);
  check(warningCounts.readinessConsistency === 1, 'readiness consistency warning should appear exactly once', failures, warningCounts);
  check(warningCounts.activeStructural === 1, 'active/structural warning should appear exactly once', failures, warningCounts);
  check(warningCounts.unexpected.length === 0, 'unexpected warnings should be absent', failures, warningCounts.unexpected);
}

function evaluateInvariants({ daemonOut, cycle, wave, db, events, parsed, warningCounts, explain, task, delegate, loopbackArtifactExists, fixture }) {
  const failures = [];
  check(daemonOut?.workDir === resolve(fixture.workDir), 'daemon workDir should match fixture workDir', failures);
  check(Array.isArray(daemonOut?.cycles) && daemonOut.cycles.length === 1, 'daemon should run exactly one bounded cycle', failures, daemonOut?.cycles?.length);
  check(cycle?.stopReason === 'all_closed', 'daemon cycle should stop all_closed', failures, cycle?.stopReason);
  check(cycle?.claimedWaves === 1, 'daemon should claim one wave', failures, cycle?.claimedWaves);
  check(cycle?.claimedItems === 1, 'daemon should claim one item', failures, cycle?.claimedItems);
  check(wave?.releaseStatus === 'done', 'claimed wave should release done', failures, wave?.releaseStatus);
  check(wave?.targetCompleted === true, 'claimed wave should complete target after loopback', failures, wave?.targetCompleted);
  check(db.counts.queue_items === 1, 'should have one queue item row', failures, db.counts);
  check(db.counts.leases === 1, 'should have one lease row', failures, db.counts);
  check(db.counts.runner_attempts === 1, 'should have one runner attempt row', failures, db.counts);
  check(db.counts.progress_reports === 1, 'should have one progress report row', failures, db.counts);
  check(JSON.stringify(db.queueItems.map((row) => row.status)) === JSON.stringify(['done']), 'queue item should be done', failures, db.queueItems);
  check(JSON.stringify(db.leases.map((row) => row.status)) === JSON.stringify(['done']), 'lease should be done', failures, db.leases);
  check(JSON.stringify(db.attempts.map((row) => row.status)) === JSON.stringify(['done']), 'attempt should be done', failures, db.attempts);
  check(db.attempts.every((row) => row.runtime_adapter === 'claude-code'), 'attempt should record claude-code runtime', failures, db.attempts);
  check(JSON.stringify(db.reports.map((row) => row.status)) === JSON.stringify(['delivered']), 'progress report should be delivered', failures, db.reports);
  check(db.queueItems.every((row) => row.work_root === resolve(fixture.workDir)), 'queue work_root should match fixture workDir', failures, db.queueItems);
  check(db.reports.every((row) => row.work_id === fixture.workId), 'report work_id should match fixture work id', failures, db.reports);
  check(task.statusDone === true, 'task should be done', failures);
  check(task.hasRunRefs === true, 'task should have runRefs', failures);
  check(delegate.statusDone === true, 'delegate should be done', failures);
  check(delegate.resolvedByLoopback === true, 'delegate should be resolved by loopback', failures);
  check(loopbackArtifactExists === true, 'loopback artifact should exist', failures);
  check((events.counts.loopback_started || 0) === 1, 'events should include one loopback_started', failures, events.counts);
  check((events.counts.loopback_completed || 0) === 1, 'events should include one loopback_completed', failures, events.counts);
  check((events.counts.task_completed || 0) === 1, 'events should include one task_completed', failures, events.counts);
  check((events.counts.runner_stopped || 0) === 1, 'events should include one runner_stopped', failures, events.counts);
  check(parsed.errors.length === 0, 'post-run validation errors should be empty', failures, parsed.errors);
  checkWarnings(warningCounts, failures);
  check(explain.closure?.complete === true, 'explain closure.complete should be true', failures, explain.closure);
  return failures;
}

function runTrial(root, trialIndex) {
  const fixture = createCleanFixture(root, trialIndex);
  const runnerId = `daemon-delegate-real-baseline-${trialIndex}`;
  const daemon = runDaemon(fixture.workDir, { name: runnerId, runnerId });
  const trialBase = {
    trial: trialIndex,
    fixture,
    command: daemon.command,
    commandResult: {
      exitCode: daemon.result.status,
      signal: daemon.result.signal,
      elapsedMs: daemon.result.elapsedMs,
      stderr: daemon.result.stderr,
      error: daemon.result.error,
      parseError: daemon.parseError,
    },
  };
  if (!daemon.json) {
    return {
      ...trialBase,
      invariantPass: false,
      invariantFailures: [{ label: 'daemon stdout should parse as JSON', details: daemon.parseError || daemon.result.stdout.slice(0, 2000) }],
    };
  }

  let post = null;
  try {
    const daemonOut = daemon.json;
    const cycle = daemonOut.cycles?.[0] || null;
    const wave = cycle?.waveDetails?.[0] || null;
    const parsed = parseProject(fixture.workDir);
    const warningCounts = countWarnings(parsed.warnings);
    const events = parseEvents(fixture.workDir);
    const timings = eventTimings(events.events);
    const db = readQueueDb(fixture.workDir);
    const task = readTaskStatus(fixture.workDir, fixture.taskId);
    const delegate = readDelegateStatus(fixture.workDir, fixture.delegateId);
    const loopbackArtifactPath = join(fixture.workDir, 'runs', 'run-main', 'artifacts', `run-node-loopback-${fixture.delegateId}.md`);
    const loopbackArtifactExists = existsSync(loopbackArtifactPath);
    const explain = JSON.parse(runTaskops(['explain', fixture.workDir, '--json']).stdout);
    const invariantFailures = evaluateInvariants({
      daemonOut,
      cycle,
      wave,
      db,
      events,
      parsed,
      warningCounts,
      explain,
      task,
      delegate,
      loopbackArtifactExists,
      fixture,
    });
    post = {
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
        timings,
      },
      task: {
        path: task.taskPath,
        statusDone: task.statusDone,
        hasRunRefs: task.hasRunRefs,
        frontmatterRelevant: relevantTaskFrontmatter(task.frontmatter),
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
        warningCounts,
        explainClosureComplete: explain.closure?.complete === true,
      },
      variant: {
        loopbackElapsedMs: timings.loopbackElapsedMs,
        taskElapsedMs: timings.taskElapsedMs,
        runnerElapsedMs: timings.runnerElapsedMs,
        commandElapsedMs: daemon.result.elapsedMs,
        queueReadiness: db.queueItems.map((row) => row.readiness),
        reportMessage: db.reports[0]?.message || null,
      },
      invariantPass: invariantFailures.length === 0,
      invariantFailures,
    };
  } catch (error) {
    post = {
      invariantPass: false,
      invariantFailures: [{ label: 'trial collection threw', details: String(error.stack || error.message || error) }],
    };
  }
  return { ...trialBase, ...post };
}

function trialFailureSummary(trial) {
  const cycle = trial.daemon?.cycles?.[0] || null;
  const wave = cycle?.waveDetails?.[0] || null;
  const attempt = trial.db?.attempts?.[0] || null;
  return {
    trial: trial.trial,
    commandExitCode: trial.commandResult.exitCode,
    commandSignal: trial.commandResult.signal,
    commandElapsedMs: trial.commandResult.elapsedMs,
    daemonStopReason: cycle?.stopReason || null,
    waveReleaseStatus: wave?.releaseStatus || null,
    waveStopReason: wave?.stopReason || null,
    targetCompleted: wave?.targetCompleted ?? null,
    attemptStatus: attempt?.status || null,
    attemptStopReason: attempt?.stop_reason || null,
    attemptErrorSummary: attempt?.error_summary || null,
    warningCounts: trial.postRun?.warningCounts || null,
    invariantFailures: trial.invariantFailures || [],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputRoot = args.outputRoot
    ? resolve(args.outputRoot)
    : join(tmpdir(), `taskops-daemon-delegate-real-baseline-${Date.now()}-${randomUUID().slice(0, 8)}`);
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  const trials = [];
  for (let i = 1; i <= args.trials; i += 1) {
    trials.push(runTrial(outputRoot, i));
  }
  const invariantPass = trials.filter((trial) => trial.invariantPass).length;
  const failures = trials.filter((trial) => !trial.invariantPass).map(trialFailureSummary);
  const report = {
    ok: invariantPass === args.trials,
    harness: 'daemon-delegate-real-baseline',
    runtime: args.runtime,
    repoRoot,
    cliPath,
    outputRoot,
    trialCount: args.trials,
    workerTimeoutSeconds: WORKER_TIMEOUT_SECONDS,
    outerTimeoutSeconds: OUTER_TIMEOUT_SECONDS,
    expectedWarnings: EXPECTED_WARNING_PATTERNS.map((entry) => entry.pattern),
    reliability: {
      trials: args.trials,
      invariantPass,
      failures,
    },
    trials,
  };
  const reportPath = join(outputRoot, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (args.json) {
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  } else {
    console.log(`OK=${report.ok} daemon/delegate real baseline trials=${args.trials} invariantPass=${invariantPass}/${args.trials}`);
    console.log(`outputRoot=${outputRoot}`);
    console.log(`report=${reportPath}`);
    for (const trial of trials) {
      const cycle = trial.daemon?.cycles?.[0] || {};
      const wave = cycle.waveDetails?.[0] || {};
      const timings = trial.events?.timings || {};
      console.log(`trial=${trial.trial} invariantPass=${trial.invariantPass} stopReason=${cycle.stopReason || 'n/a'} release=${wave.releaseStatus || 'n/a'} targetCompleted=${wave.targetCompleted ?? 'n/a'} elapsedMs=${trial.commandResult.elapsedMs}`);
      console.log(`trial=${trial.trial} loopbackMs=${timings.loopbackElapsedMs ?? 'n/a'} taskMs=${timings.taskElapsedMs ?? 'n/a'} warnings=${JSON.stringify(trial.postRun?.warningCounts || null)}`);
      if (!trial.invariantPass) console.log(`trial=${trial.trial} failures=${JSON.stringify(trial.invariantFailures)}`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}

main();
