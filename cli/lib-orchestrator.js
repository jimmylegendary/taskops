import { randomUUID } from 'node:crypto';
import {
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

function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, Math.floor(ms));
}

function optionalPositiveInteger(value, name) {
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

function normalizeReportSink(value) {
  const sink = value == null || value === '' ? 'ledger' : String(value).trim();
  if (!['none', 'ledger'].includes(sink)) {
    throw new Error(`Invalid report sink '${value}'. Use none or ledger.`);
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

export function runQueueOnce(workDir, options = {}) {
  const runtimeAdapter = normalizeRuntimeAdapter(options.runtimeAdapter || options.runtime);
  const reportSink = normalizeReportSink(options.reportSink || options.report);
  const runnerId = options.runnerId || `taskops-runner-${process.pid}`;
  const ttlSeconds = options.ttlSeconds == null ? 300 : Number(options.ttlSeconds);
  const waveId = options.waveId || `wave-${randomUUID()}`;

  const claim = claimQueueItem(workDir, { runnerId, ttlSeconds });
  if (!claim.claimed || !claim.item || !claim.lease) {
    return {
      projectDir: claim.projectDir,
      workId: claim.workId,
      dbPath: claim.dbPath,
      claimed: false,
      stopReason: 'no_claimable_queue_item',
      waveId,
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
    report = insertProgressReport(workDir, {
      queueItemId: item.id,
      taskId: target.taskId,
      waveId,
      masterSessionKey: options.masterSessionKey || null,
      reportSink,
      status: errorSummary ? 'failed' : 'delivered',
      message: errorSummary
        ? `TaskOps ${waveId} (${claim.workId})\nqueueItem: ${item.id}\nstopReason: error\nreleaseStatus: failed\nerror: ${errorSummary}`
        : buildProgressMessage({ workId: claim.workId, waveId, item, runResult, releaseStatus }),
      errorSummary,
    }).report;
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
    releaseStatus,
    runResult,
    errorSummary,
    report,
  };
}

export function runQueueWatch(workDir, options = {}) {
  const runtimeAdapter = normalizeRuntimeAdapter(options.runtimeAdapter || options.runtime);
  const reportSink = normalizeReportSink(options.reportSink || options.report);
  const runnerId = options.runnerId || `taskops-runner-${process.pid}`;
  const ttlSeconds = options.ttlSeconds == null ? 300 : Number(options.ttlSeconds);
  const pollIntervalMs = optionalPositiveInteger(options.pollIntervalMs, 'poll interval ms') ?? 5000;
  const maxWaves = optionalPositiveInteger(options.maxWaves, 'max waves');
  const maxIdleCycles = optionalPositiveInteger(options.maxIdleCycles, 'max idle cycles');
  const idleExitAfterSeconds = optionalPositiveNumber(options.idleExitAfterSeconds, 'idle exit seconds');
  const until = normalizeUntil(options.until);
  const stopOnFailure = normalizeBool(options.stopOnFailure, true);
  const watchId = options.watchId || `watch-${randomUUID()}`;
  const startedAt = isoNow();
  let claimedWaves = 0;
  let idleCycles = 0;
  let firstIdleAt = null;
  let stopReason = null;
  let stopDetail = null;
  let finalExplain = null;
  const waves = [];

  while (true) {
    if (until != null && Date.now() >= until) {
      stopReason = 'deadline_reached';
      break;
    }
    if (maxWaves != null && claimedWaves >= maxWaves) {
      stopReason = 'max_waves';
      stopDetail = `Reached max waves ${claimedWaves}/${maxWaves}.`;
      break;
    }

    const waveId = `${watchId}-wave-${claimedWaves + 1}`;
    const result = runQueueOnce(workDir, {
      runtimeAdapter,
      runnerId,
      ttlSeconds,
      reportSink,
      masterSessionKey: options.masterSessionKey || null,
      agent: options.agent || null,
      runId: options.runId || null,
      timeout: options.timeout || null,
      actor: options.actor || runnerId,
      waveId,
    });

    if (result.claimed) {
      claimedWaves += 1;
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

    sleepMs(pollIntervalMs);
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
    idleCycles,
    maxWaves,
    maxIdleCycles,
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
