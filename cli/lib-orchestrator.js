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
import { runTaskOps } from './lib-runner.js';

function isoNow() {
  return new Date().toISOString();
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

export function listRunnerReports(workDir) {
  return listProgressReports(workDir);
}
