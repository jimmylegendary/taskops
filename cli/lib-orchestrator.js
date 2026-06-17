import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  claimQueueItems,
  claimQueueItem,
  insertProgressReport,
  insertRunnerAttempt,
  listProgressReports,
  releaseLease,
  syncQueueProjection,
  updateRunnerAttempt,
} from './lib-queue.js';
import { explainWork, runTaskOps } from './lib-runner.js';

function isoNow() {
  return new Date().toISOString();
}

function sleepMs(ms, shouldStop = null) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  if (typeof shouldStop === 'function' && shouldStop()) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let poll = null;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      resolve();
    };
    const timer = setTimeout(done, Math.floor(ms));
    if (typeof shouldStop === 'function') {
      poll = setInterval(() => {
        if (shouldStop()) done();
      }, 50);
    }
  });
}

function optionalPositiveInteger(value, name) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${value}`);
  return Math.floor(n);
}

function optionalNonNegativeInteger(value, name) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${value}`);
  return Math.floor(n);
}

function optionalPositiveNumber(value, name) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${value}`);
  return n;
}

function normalizeUntil(value) {
  if (value == null || value === '') return null;
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) throw new Error(`Invalid --until '${value}'; expected an ISO-8601 timestamp or Date-parseable string`);
  return parsed;
}

function normalizeBool(value, fallback) {
  if (value == null || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseQueueItemId(id) {
  const raw = String(id || '');
  const idx = raw.indexOf(':');
  if (idx <= 0 || idx >= raw.length - 1) {
    throw new Error(`Invalid queue item id '${raw}'; expected '<taskGroupVersionId>:<taskId>'`);
  }
  return {
    taskGroupVersionId: raw.slice(0, idx),
    taskId: raw.slice(idx + 1),
  };
}

function normalizeRuntimeAdapter(value) {
  const runtime = value == null || value === '' ? 'dry-run' : String(value).trim();
  if (!['dry-run', 'openclaw-cli'].includes(runtime)) {
    throw new Error(`Invalid runtime adapter '${value}'. Use dry-run or openclaw-cli.`);
  }
  return runtime;
}

function executorForRuntime(runtimeAdapter) {
  switch (runtimeAdapter) {
    case 'dry-run': return 'dry-run';
    case 'openclaw-cli': return 'openclaw-agent';
    default: throw new Error(`Unsupported runtime adapter '${runtimeAdapter}'`);
  }
}

function safeIdPart(value) {
  const safe = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return safe || 'item';
}

function normalizeReportSink(value) {
  const sink = value == null || value === '' ? 'ledger' : String(value).trim();
  if (!['none', 'ledger', 'openclaw-chat-inject'].includes(sink)) {
    throw new Error(`Invalid report sink '${value}'. Use none, ledger, or openclaw-chat-inject.`);
  }
  return sink;
}

function terminalStatusFromRun(result) {
  if (result.stopReason === 'task_failed' || result.stopReason === 'validation_failed') return 'failed';
  if ((result.tasks || result.actions || []).some((action) => action.status === 'failed')) return 'failed';
  if (result.stepsRun > 0) return 'done';
  return 'failed';
}

function buildProgressMessage({ workId, waveId, item, runResult, releaseStatus }) {
  const actions = runResult.actions || runResult.tasks || [];
  const completed = actions.filter((action) => action.status === 'completed')
    .map((action) => `${action.kind}:${action.taskId || action.delegateRunNodeId}`)
    .join(', ') || 'none';
  const failed = actions.filter((action) => action.status === 'failed')
    .map((action) => `${action.kind}:${action.taskId || action.delegateRunNodeId}`)
    .join(', ') || 'none';
  return [
    `TaskOps ${waveId} (${workId})`,
    `queueItem: ${item.id}`,
    `stopReason: ${runResult.stopReason}`,
    `releaseStatus: ${releaseStatus}`,
    `completed: ${completed}`,
    `failed: ${failed}`,
  ].join('\n');
}

function injectOpenClawChatReport({ masterSessionKey, message, label, timeoutMs = 10000 }) {
  if (!masterSessionKey) {
    return { ok: false, errorSummary: 'openclaw-chat-inject report sink requires --master-session-key' };
  }
  const params = {
    sessionKey: masterSessionKey,
    message,
    label: label || 'TaskOps progress',
  };
  const result = spawnSync('openclaw', [
    'gateway', 'call', 'chat.inject',
    '--params', JSON.stringify(params),
    '--json',
    '--timeout', String(timeoutMs),
  ], { encoding: 'utf8', timeout: timeoutMs + 1000 });
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  if (result.error) return { ok: false, errorSummary: result.error.message, stdout, stderr };
  if (result.status !== 0) return { ok: false, errorSummary: stderr || stdout || `openclaw gateway call exited with status ${result.status}`, stdout, stderr };
  return { ok: true, stdout, stderr };
}

function writeProgressReport(workDir, {
  item,
  target,
  waveId,
  masterSessionKey,
  reportSink,
  message,
  errorSummary,
}) {
  if (reportSink === 'none') return null;
  let status = errorSummary ? 'failed' : 'delivered';
  let deliveryError = errorSummary || null;
  if (reportSink === 'openclaw-chat-inject') {
    const delivered = injectOpenClawChatReport({
      masterSessionKey,
      message,
      label: `TaskOps ${waveId}`,
    });
    if (!delivered.ok) {
      status = 'failed';
      deliveryError = delivered.errorSummary || 'openclaw-chat-inject delivery failed';
    }
  }
  return insertProgressReport(workDir, {
    queueItemId: item.id,
    taskId: target.taskId,
    waveId,
    masterSessionKey: masterSessionKey || null,
    reportSink,
    status,
    message,
    errorSummary: deliveryError,
  }).report;
}

function runWorkerProcess(args, timeoutMs = null) {
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer = null;
    if (timeoutMs != null && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs + 1000);
    }
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({ status: 1, stdout: stdout.trim(), stderr: stderr.trim(), error, timedOut });
    });
    child.on('close', (status, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ status, signal, stdout: stdout.trim(), stderr: stderr.trim(), timedOut });
    });
  });
}

async function runClaimedQueueItemWorker(workDir, { claim, runtimeAdapter, runnerId, reportSink, masterSessionKey, agent, runId, timeout, actor, waveId, cliPath, nodePath }) {
  const item = claim.item;
  const lease = claim.lease;
  const target = parseQueueItemId(item.id);
  const workerRunId = runId
    ? `${safeIdPart(runId)}-${safeIdPart(item.id)}`
    : `run-${safeIdPart(item.id)}`;
  const attemptId = `attempt-${randomUUID()}`;
  insertRunnerAttempt(workDir, {
    id: attemptId,
    queueItemId: item.id,
    leaseId: lease.id,
    runnerId,
    runtimeAdapter,
    status: 'running',
    startedAt: isoNow(),
  });

  const args = [
    nodePath || process.execPath,
    cliPath || process.argv[1],
    'run',
    workDir,
    '--executor',
    executorForRuntime(runtimeAdapter),
    '--max-steps',
    '1',
    '--target-task-id',
    target.taskId,
    '--target-task-group-version-id',
    target.taskGroupVersionId,
    '--allow-concurrent-target',
    '--run-id',
    workerRunId,
    '--json',
  ];
  if (agent) args.push('--agent', agent);
  if (timeout != null) args.push('--timeout', String(timeout));
  if (actor) args.push('--actor', actor);

  let runResult;
  let releaseStatus = 'failed';
  let errorSummary = null;
  let report = null;
  const worker = await runWorkerProcess(args, timeout == null ? null : Number(timeout) * 1000);
  if (worker.status === 0 && worker.stdout) {
    try {
      runResult = JSON.parse(worker.stdout);
      releaseStatus = terminalStatusFromRun(runResult);
    } catch (error) {
      errorSummary = `worker JSON parse failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    errorSummary = worker.timedOut
      ? `worker timed out after ${timeout}s`
      : (worker.stderr || worker.stdout || worker.error?.message || `worker exited with status ${worker.status}`);
  }
  if (!runResult) {
    runResult = {
      workId: null,
      runId: null,
      stopReason: worker.timedOut ? 'timeout' : 'error',
      stopDetail: errorSummary,
      stepsRun: 0,
      actions: [],
    };
  }

  const finishedAt = isoNow();
  updateRunnerAttempt(workDir, attemptId, {
    status: releaseStatus === 'done' ? 'done' : 'failed',
    finishedAt,
    runId: runResult?.runId || null,
    stopReason: runResult?.stopReason || null,
    errorSummary,
  });
  releaseLease(workDir, lease.id, { status: releaseStatus });

  if (reportSink !== 'none') {
    const message = errorSummary
      ? `TaskOps ${waveId} (${item.work_id || ''})\nqueueItem: ${item.id}\nstopReason: error\nreleaseStatus: failed\nerror: ${errorSummary}`
      : buildProgressMessage({ workId: item.work_id || runResult.workId || '', waveId, item, runResult, releaseStatus });
    report = writeProgressReport(workDir, {
      item,
      target,
      waveId,
      masterSessionKey: masterSessionKey || null,
      reportSink,
      message,
      errorSummary,
    });
  }

  return {
    claimed: true,
    waveId,
    queueItem: item,
    lease,
    attemptId,
    runtimeAdapter,
    runResult,
    releaseStatus,
    errorSummary,
    report,
    worker: {
      status: worker.status,
      signal: worker.signal || null,
      timedOut: worker.timedOut,
      stdout: worker.stdout,
      stderr: worker.stderr,
    },
  };
}

export async function runQueueWave(workDir, options = {}) {
  const runtimeAdapter = normalizeRuntimeAdapter(options.runtimeAdapter || options.runtime);
  const reportSink = normalizeReportSink(options.reportSink || options.report);
  const runnerId = options.runnerId || `taskops-runner-${process.pid}`;
  const ttlSeconds = options.ttlSeconds == null ? 300 : Number(options.ttlSeconds);
  const maxAttempts = optionalNonNegativeInteger(options.maxAttempts, 'max attempts');
  const maxParallel = optionalPositiveInteger(options.maxParallel, 'max parallel') ?? 8;
  const waveId = options.waveId || `wave-${randomUUID()}`;
  const claim = claimQueueItems(workDir, { runnerId, ttlSeconds, maxAttempts, limit: maxParallel });
  if (!claim.claimed || claim.claims.length === 0) {
    return {
      projectDir: claim.projectDir,
      workId: claim.workId,
      dbPath: claim.dbPath,
      claimed: false,
      stopReason: 'no_claimable_queue_item',
      waveId,
      maxAttempts,
      maxParallel,
      workers: [],
    };
  }

  const workers = await Promise.all(claim.claims.map((itemClaim, index) => runClaimedQueueItemWorker(workDir, {
    claim: itemClaim,
    runtimeAdapter,
    runnerId: `${runnerId}-worker-${index + 1}`,
    reportSink,
    masterSessionKey: options.masterSessionKey || null,
    agent: options.agent || null,
    runId: options.runId || null,
    timeout: options.timeout || null,
    actor: options.actor || runnerId,
    waveId: `${waveId}-worker-${index + 1}`,
    cliPath: options.cliPath || process.argv[1],
    nodePath: options.nodePath || process.execPath,
  })));
  syncQueueProjection(workDir);
  return {
    projectDir: claim.projectDir,
    workId: claim.workId,
    dbPath: claim.dbPath,
    claimed: true,
    waveId,
    runtimeAdapter,
    maxAttempts,
    maxParallel,
    claimedCount: claim.claims.length,
    workers,
    releaseStatus: workers.some((worker) => worker.releaseStatus === 'failed') ? 'failed' : 'done',
  };
}

export function runQueueOnce(workDir, options = {}) {
  const runtimeAdapter = normalizeRuntimeAdapter(options.runtimeAdapter || options.runtime);
  const reportSink = normalizeReportSink(options.reportSink || options.report);
  const runnerId = options.runnerId || `taskops-runner-${process.pid}`;
  const ttlSeconds = options.ttlSeconds == null ? 300 : Number(options.ttlSeconds);
  const maxAttempts = optionalNonNegativeInteger(options.maxAttempts, 'max attempts');
  const waveId = options.waveId || `wave-${randomUUID()}`;

  const claim = claimQueueItem(workDir, { runnerId, ttlSeconds, maxAttempts });
  if (!claim.claimed || !claim.item || !claim.lease) {
    return {
      projectDir: claim.projectDir,
      workId: claim.workId,
      dbPath: claim.dbPath,
      claimed: false,
      stopReason: 'no_claimable_queue_item',
      waveId,
      maxAttempts,
    };
  }

  const item = claim.item;
  const lease = claim.lease;
  const target = parseQueueItemId(item.id);
  const attemptId = `attempt-${randomUUID()}`;
  insertRunnerAttempt(workDir, {
    id: attemptId,
    queueItemId: item.id,
    leaseId: lease.id,
    runnerId,
    runtimeAdapter,
    status: 'running',
    startedAt: isoNow(),
  });

  let runResult;
  let releaseStatus = 'failed';
  let errorSummary = null;
  let report = null;
  try {
    runResult = runTaskOps(workDir, {
      executor: executorForRuntime(runtimeAdapter),
      agent: options.agent || null,
      runId: options.runId || null,
      maxSteps: 1,
      timeout: options.timeout || null,
      actor: options.actor || runnerId,
      targetTaskId: target.taskId,
      targetTaskGroupVersionId: target.taskGroupVersionId,
    });
    releaseStatus = terminalStatusFromRun(runResult);
  } catch (error) {
    errorSummary = error instanceof Error ? error.message : String(error);
    runResult = {
      workId: claim.workId,
      runId: null,
      stopReason: 'error',
      stopDetail: errorSummary,
      stepsRun: 0,
      tasks: [],
      actions: [],
    };
  } finally {
    const finishedAt = isoNow();
    updateRunnerAttempt(workDir, attemptId, {
      status: releaseStatus === 'done' ? 'done' : 'failed',
      finishedAt,
      runId: runResult?.runId || null,
      stopReason: runResult?.stopReason || null,
      errorSummary,
    });
    try {
      releaseLease(workDir, lease.id, { status: releaseStatus });
    } finally {
      syncQueueProjection(workDir);
    }
  }

  if (reportSink !== 'none') {
    const message = errorSummary
        ? `TaskOps ${waveId} (${claim.workId})\nqueueItem: ${item.id}\nstopReason: error\nreleaseStatus: failed\nerror: ${errorSummary}`
        : buildProgressMessage({ workId: claim.workId, waveId, item, runResult, releaseStatus });
    report = writeProgressReport(workDir, {
      item,
      target,
      waveId,
      masterSessionKey: options.masterSessionKey || null,
      reportSink,
      message,
      errorSummary,
    });
  }

  return {
    projectDir: claim.projectDir,
    workId: claim.workId,
    dbPath: claim.dbPath,
    claimed: true,
    waveId,
    queueItem: item,
    lease,
    attemptId,
    runtimeAdapter,
    maxAttempts,
    releaseStatus,
    runResult,
    errorSummary,
    report,
  };
}

export async function runQueueWatch(workDir, options = {}) {
  const runtimeAdapter = normalizeRuntimeAdapter(options.runtimeAdapter || options.runtime);
  const reportSink = normalizeReportSink(options.reportSink || options.report);
  const runnerId = options.runnerId || `taskops-runner-${process.pid}`;
  const ttlSeconds = options.ttlSeconds == null ? 300 : Number(options.ttlSeconds);
  const maxAttempts = optionalNonNegativeInteger(options.maxAttempts, 'max attempts') ?? 3;
  const maxParallel = optionalPositiveInteger(options.maxParallel, 'max parallel') ?? 8;
  const pollIntervalMs = optionalPositiveInteger(options.pollIntervalMs, 'poll interval ms') ?? 5000;
  const maxWaves = optionalPositiveInteger(options.maxWaves, 'max waves');
  const maxIdleCycles = optionalPositiveInteger(options.maxIdleCycles, 'max idle cycles');
  const idleExitAfterSeconds = optionalPositiveNumber(options.idleExitAfterSeconds, 'idle exit seconds');
  const until = normalizeUntil(options.until);
  const stopOnFailure = normalizeBool(options.stopOnFailure, true);
  const watchId = options.watchId || `watch-${randomUUID()}`;
  const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
  const startedAt = isoNow();
  let claimedWaves = 0;
  let claimedItems = 0;
  let idleCycles = 0;
  let firstIdleAt = null;
  let stopReason = null;
  let stopDetail = null;
  let finalExplain = null;
  const waves = [];

  while (true) {
    if (shouldStop()) {
      stopReason = 'stopped';
      stopDetail = 'Stop requested by supervisor.';
      break;
    }
    if (until != null && Date.now() >= until) {
      stopReason = 'deadline_reached';
      break;
    }
    try {
      finalExplain = explainWork(workDir);
      if (finalExplain.complete) {
        stopReason = 'all_closed';
        break;
      }
    } catch {
      finalExplain = null;
    }
    if (maxWaves != null && claimedWaves >= maxWaves) {
      stopReason = 'max_waves';
      stopDetail = `Reached max waves ${claimedWaves}/${maxWaves}.`;
      break;
    }

    const waveId = `${watchId}-wave-${claimedWaves + 1}`;
    const result = await runQueueWave(workDir, {
      runtimeAdapter,
      runnerId,
      ttlSeconds,
      reportSink,
      masterSessionKey: options.masterSessionKey || null,
      agent: options.agent || null,
      runId: options.runId || null,
      timeout: options.timeout || null,
      actor: options.actor || runnerId,
      maxAttempts,
      waveId,
      maxParallel,
      cliPath: options.cliPath || process.argv[1],
      nodePath: options.nodePath || process.execPath,
    });

    if (result.claimed) {
      claimedWaves += 1;
      claimedItems += result.claimedCount || 1;
      idleCycles = 0;
      firstIdleAt = null;
      waves.push(result);
      if (result.releaseStatus === 'failed' && stopOnFailure) {
        stopReason = 'wave_failed';
        stopDetail = result.errorSummary || result.runResult?.stopDetail || result.runResult?.stopReason || 'Runner wave failed.';
        break;
      }
      continue;
    }

    idleCycles += 1;
    if (!firstIdleAt) firstIdleAt = Date.now();

    finalExplain = explainWork(workDir);
    if (finalExplain.complete) {
      stopReason = 'all_closed';
      break;
    }

    if (maxIdleCycles != null && idleCycles >= maxIdleCycles) {
      stopReason = 'idle_cycles';
      stopDetail = `No claimable queue item after ${idleCycles} idle cycle(s).`;
      break;
    }

    if (idleExitAfterSeconds != null && firstIdleAt != null) {
      const idleMs = Date.now() - firstIdleAt;
      if (idleMs >= idleExitAfterSeconds * 1000) {
        stopReason = 'idle_timeout';
        stopDetail = `No claimable queue item for ${idleExitAfterSeconds} second(s).`;
        break;
      }
    }

    await sleepMs(pollIntervalMs, shouldStop);
  }

  const stoppedAt = isoNow();
  if (!finalExplain) {
    try {
      finalExplain = explainWork(workDir);
    } catch (error) {
      finalExplain = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    projectDir: waves[0]?.projectDir || finalExplain.projectDir || null,
    workId: waves[0]?.workId || finalExplain.workId || null,
    dbPath: waves[0]?.dbPath || finalExplain.dbPath || null,
    watchId,
    runnerId,
    runtimeAdapter,
    reportSink,
    startedAt,
    stoppedAt,
    stopReason: stopReason || 'stopped',
    stopDetail,
    claimedWaves,
    claimedItems,
    idleCycles,
    maxWaves,
    maxIdleCycles,
    maxAttempts,
    maxParallel,
    idleExitAfterSeconds,
    pollIntervalMs,
    stopOnFailure,
    finalExplain,
    waves,
  };
}

export function listRunnerReports(workDir) {
  return listProgressReports(workDir);
}
