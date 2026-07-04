import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  claimQueueItems,
  claimQueueItem,
  heartbeatLease,
  insertProgressReport,
  insertRunnerAttempt,
  listProgressReports,
  releaseLease,
  syncQueueProjection,
  updateRunnerAttempt,
} from './lib-queue.js';
import { DEFAULT_MAX_LOOPBACKS, explainWork, runTaskOps } from './lib-runner.js';
import { executorForRuntime, normalizeRuntimeAdapter } from './lib-runtime-adapters.js';
import { auditParsedWork } from './lib-audit.js';
import { parseProject } from './lib-taskops.js';

const DEFAULT_LOOPBACK_WORKER_MAX_STEPS = 50;

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

function normalizeLoopbackPolicy(value) {
  const policy = value == null || value === '' ? 'none' : String(value).trim().toLowerCase();
  if (!['none', 'self'].includes(policy)) throw new Error(`Invalid loopback policy '${value}'. Use none or self.`);
  return policy;
}

function normalizeMaxLoopbacks(value, loopbackPolicy) {
  if (loopbackPolicy === 'none') return 0;
  if (value == null || value === '') return DEFAULT_MAX_LOOPBACKS;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid max loopbacks: ${value}`);
  return Math.floor(n);
}

function normalizeWorkerMaxSteps(value, { loopbackPolicy }) {
  if (value != null && value !== '') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid max steps: ${value}`);
    return Math.floor(n);
  }
  if (loopbackPolicy === 'self') return DEFAULT_LOOPBACK_WORKER_MAX_STEPS;
  return 1;
}

function normalizeWorkerMaxStepsExplicit(options = {}) {
  if (options.maxStepsExplicit === true || options.maxStepsExplicit === 'true') return true;
  if (options.maxStepsExplicit === false || options.maxStepsExplicit === 'false') return false;
  return options.maxSteps != null && options.maxSteps !== '';
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

function targetCompleted(result, target) {
  if (result.stopReason === 'all_closed') return true;
  const actions = result.actions || result.tasks || [];
  return actions.some((action) => (
    action
    && action.status === 'completed'
    && action.kind !== 'loopback'
    && action.taskId === target.taskId
  ));
}

function targetPartial(result, target) {
  const actions = result.actions || result.tasks || [];
  return actions.some((action) => (
    action
    && action.status === 'partial'
    && action.kind !== 'loopback'
    && action.taskId === target.taskId
  ));
}

function releaseSucceeded(releaseStatus) {
  return releaseStatus === 'done' || releaseStatus === 'partial';
}

function leaseReleaseStatus(releaseStatus) {
  return releaseSucceeded(releaseStatus) ? 'done' : 'failed';
}

function terminalStatusFromRun(result, target) {
  const actions = result.actions || result.tasks || [];
  if (result.stopReason === 'task_failed' || result.stopReason === 'validation_failed') return 'failed';
  if (actions.some((action) => action.status === 'failed')) return 'failed';
  if (targetCompleted(result, target)) return 'done';
  if (targetPartial(result, target)) return 'partial';
  return 'failed';
}

function buildProgressMessage({ workId, waveId, item, target, runResult, releaseStatus }) {
  const actions = runResult.actions || runResult.tasks || [];
  const completed = actions.filter((action) => action.status === 'completed')
    .map((action) => `${action.kind}:${action.taskId || action.delegateRunNodeId}`)
    .join(', ') || 'none';
  const failed = actions.filter((action) => action.status === 'failed')
    .map((action) => `${action.kind}:${action.taskId || action.delegateRunNodeId}`)
    .join(', ') || 'none';
  const partial = actions.filter((action) => action.status === 'partial')
    .map((action) => `${action.kind}:${action.taskId || action.delegateRunNodeId}`)
    .join(', ') || 'none';
  return [
    `TaskOps ${waveId} (${workId})`,
    `queueItem: ${item.id}`,
    `stopReason: ${runResult.stopReason}`,
    `releaseStatus: ${releaseStatus}`,
    `completed: ${completed}`,
    `partial: ${partial}`,
    `targetCompleted: ${targetCompleted(runResult, target)}`,
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

function startLeaseHeartbeat(workDir, leaseId, { ttlSeconds = 300 } = {}) {
  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) return { stop: () => {}, errors: [] };
  const intervalMs = Math.max(1000, Math.min(60000, Math.floor((ttl * 1000) / 3)));
  const errors = [];
  const timer = setInterval(() => {
    try {
      heartbeatLease(workDir, leaseId, { ttlSeconds: ttl });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    errors,
    stop: () => clearInterval(timer),
  };
}

async function runClaimedQueueItemWorker(workDir, {
  claim,
  runtimeAdapter,
  runnerId,
  reportSink,
  masterSessionKey,
  agent,
  runId,
  timeout,
  actor,
  waveId,
  cliPath,
  nodePath,
  loopbackPolicy,
  maxLoopbacks,
  maxSteps,
  maxStepsExplicit,
  until,
  ttlSeconds,
  verifyChecks = false,
  continueOnFailure = false,
}) {
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
    String(maxSteps),
    '--target-task-id',
    target.taskId,
    '--target-task-group-version-id',
    target.taskGroupVersionId,
    '--allow-concurrent-target',
    '--run-id',
    workerRunId,
    '--json',
  ];
  if (maxStepsExplicit) args.push('--max-steps-explicit');
  if (agent) args.push('--agent', agent);
  if (timeout != null) args.push('--timeout', String(timeout));
  if (actor) args.push('--actor', actor);
  if (until) args.push('--until', until);
  if (loopbackPolicy !== 'none') args.push('--loopback', loopbackPolicy, '--max-loopbacks', String(maxLoopbacks));
  // verified execution + isolate-and-continue must compose with the PARALLEL worker path, not only the
  // serial `run` loop — so a parallel frontier sweep is verify-grounded and honest-monotone too.
  if (verifyChecks) args.push('--verify-checks');
  if (continueOnFailure) args.push('--continue-on-failure');

  let runResult;
  let releaseStatus = 'failed';
  let errorSummary = null;
  let releaseErrorSummary = null;
  let report = null;
  const heartbeat = startLeaseHeartbeat(workDir, lease.id, { ttlSeconds });
  const worker = await runWorkerProcess(args, timeout == null ? null : Number(timeout) * 1000);
  heartbeat.stop();
  if (worker.status === 0 && worker.stdout) {
    try {
      runResult = JSON.parse(worker.stdout);
      releaseStatus = terminalStatusFromRun(runResult, target);
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
      partialCompletions: [],
      actions: [],
    };
  }

  const finishedAt = isoNow();
  updateRunnerAttempt(workDir, attemptId, {
    status: releaseSucceeded(releaseStatus) ? 'done' : 'failed',
    finishedAt,
    runId: runResult?.runId || null,
    stopReason: runResult?.stopReason || null,
    errorSummary,
  });
  try {
    releaseLease(workDir, lease.id, { status: leaseReleaseStatus(releaseStatus) });
  } catch (error) {
    releaseErrorSummary = error instanceof Error ? error.message : String(error);
    errorSummary = errorSummary || releaseErrorSummary;
    releaseStatus = 'failed';
    updateRunnerAttempt(workDir, attemptId, {
      status: 'failed',
      finishedAt,
      runId: runResult?.runId || null,
      stopReason: runResult?.stopReason || 'lease_release_failed',
      errorSummary: releaseErrorSummary,
    });
  }
  try {
    syncQueueProjection(workDir);
  } catch (error) {
    const syncError = error instanceof Error ? error.message : String(error);
    errorSummary = errorSummary || syncError;
    releaseStatus = 'failed';
    releaseErrorSummary = releaseErrorSummary || syncError;
  }

  if (reportSink !== 'none') {
    const message = errorSummary
      ? `TaskOps ${waveId} (${item.work_id || ''})\nqueueItem: ${item.id}\nstopReason: error\nreleaseStatus: failed\ntargetCompleted: false\nerror: ${errorSummary}`
      : buildProgressMessage({ workId: item.work_id || runResult.workId || '', waveId, item, target, runResult, releaseStatus });
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
    maxSteps,
    maxStepsExplicit,
    loopbackPolicy,
    maxLoopbacks,
    targetCompleted: targetCompleted(runResult, target),
    runResult,
    releaseStatus,
    errorSummary,
    report,
    releaseErrorSummary,
    heartbeatErrors: heartbeat.errors,
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
  const loopbackPolicy = normalizeLoopbackPolicy(options.loopback);
  const maxLoopbacks = normalizeMaxLoopbacks(options.maxLoopbacks, loopbackPolicy);
  const maxSteps = normalizeWorkerMaxSteps(options.maxSteps, { loopbackPolicy, maxLoopbacks });
  const maxStepsExplicit = normalizeWorkerMaxStepsExplicit(options);
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
      maxSteps,
      maxStepsExplicit,
      loopbackPolicy,
      maxLoopbacks,
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
    loopbackPolicy,
    maxLoopbacks,
    maxSteps,
    maxStepsExplicit,
    ttlSeconds,
    until: options.until || null,
    verifyChecks: options.verifyChecks === true,
    continueOnFailure: options.continueOnFailure === true,
  })));
  return {
    projectDir: claim.projectDir,
    workId: claim.workId,
    dbPath: claim.dbPath,
    claimed: true,
    waveId,
    runtimeAdapter,
    maxAttempts,
    maxParallel,
    maxSteps,
    maxStepsExplicit,
    loopbackPolicy,
    maxLoopbacks,
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
  const loopbackPolicy = normalizeLoopbackPolicy(options.loopback);
  const maxLoopbacks = normalizeMaxLoopbacks(options.maxLoopbacks, loopbackPolicy);
  const maxSteps = normalizeWorkerMaxSteps(options.maxSteps, { loopbackPolicy, maxLoopbacks });
  const maxStepsExplicit = normalizeWorkerMaxStepsExplicit(options);
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
      loopbackPolicy,
      maxLoopbacks,
      maxSteps,
      maxStepsExplicit,
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
      maxSteps,
      maxStepsExplicit,
      timeout: options.timeout || null,
      until: options.until || null,
      loopback: loopbackPolicy,
      maxLoopbacks,
      verifyChecks: options.verifyChecks === true,
      continueOnFailure: options.continueOnFailure === true,
      actor: options.actor || runnerId,
      targetTaskId: target.taskId,
      targetTaskGroupVersionId: target.taskGroupVersionId,
      allowConcurrentTarget: true,
    });
    releaseStatus = terminalStatusFromRun(runResult, target);
  } catch (error) {
    errorSummary = error instanceof Error ? error.message : String(error);
    runResult = {
      workId: claim.workId,
      runId: null,
      stopReason: 'error',
      stopDetail: errorSummary,
      stepsRun: 0,
      tasks: [],
      partialCompletions: [],
      actions: [],
    };
  } finally {
    const finishedAt = isoNow();
    updateRunnerAttempt(workDir, attemptId, {
      status: releaseSucceeded(releaseStatus) ? 'done' : 'failed',
      finishedAt,
      runId: runResult?.runId || null,
      stopReason: runResult?.stopReason || null,
      errorSummary,
    });
    try {
      releaseLease(workDir, lease.id, { status: leaseReleaseStatus(releaseStatus) });
    } finally {
      syncQueueProjection(workDir);
    }
  }

  if (reportSink !== 'none') {
    const message = errorSummary
        ? `TaskOps ${waveId} (${claim.workId})\nqueueItem: ${item.id}\nstopReason: error\nreleaseStatus: failed\ntargetCompleted: false\nerror: ${errorSummary}`
        : buildProgressMessage({ workId: claim.workId, waveId, item, target, runResult, releaseStatus });
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
    maxSteps,
    maxStepsExplicit,
    loopbackPolicy,
    maxLoopbacks,
    targetCompleted: targetCompleted(runResult, target),
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
  const loopbackPolicy = normalizeLoopbackPolicy(options.loopback);
  const maxLoopbacks = normalizeMaxLoopbacks(options.maxLoopbacks, loopbackPolicy);
  const maxSteps = normalizeWorkerMaxSteps(options.maxSteps, { loopbackPolicy, maxLoopbacks });
  const maxStepsExplicit = normalizeWorkerMaxStepsExplicit(options);
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
  const active = new Map();
  let workerSequence = 0;

  const startWorker = () => {
    if (maxWaves != null && claimedWaves + active.size >= maxWaves) return false;
    const claim = claimQueueItem(workDir, { runnerId, ttlSeconds, maxAttempts });
    if (!claim.claimed || !claim.item || !claim.lease) return false;
    workerSequence += 1;
    const waveId = `${watchId}-wave-${workerSequence}`;
    const promise = runClaimedQueueItemWorker(workDir, {
      claim,
      runtimeAdapter,
      runnerId: `${runnerId}-worker-${workerSequence}`,
      reportSink,
      masterSessionKey: options.masterSessionKey || null,
      agent: options.agent || null,
      runId: options.runId || null,
      timeout: options.timeout || null,
      actor: options.actor || runnerId,
      waveId,
      cliPath: options.cliPath || process.argv[1],
      nodePath: options.nodePath || process.execPath,
      loopbackPolicy,
      maxLoopbacks,
      maxSteps,
      maxStepsExplicit,
      ttlSeconds,
      until: options.until || null,
      verifyChecks: options.verifyChecks === true,
      continueOnFailure: options.continueOnFailure === true,
    }).then((result) => ({ waveId, result }));
    active.set(waveId, promise);
    return true;
  };

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
    if (maxWaves != null && claimedWaves + active.size >= maxWaves && active.size === 0) {
      stopReason = 'max_waves';
      stopDetail = `Reached max waves ${claimedWaves}/${maxWaves}.`;
      break;
    }

    let startedAny = false;
    while (active.size < maxParallel) {
      if (maxWaves != null && claimedWaves + active.size >= maxWaves) break;
      if (!startWorker()) break;
      startedAny = true;
    }

    if (active.size > 0) {
      const { waveId, result } = await Promise.race(active.values());
      active.delete(waveId);
      claimedWaves += 1;
      claimedItems += 1;
      idleCycles = 0;
      firstIdleAt = null;
      waves.push(result);
      if (result.releaseStatus === 'failed' && stopOnFailure) {
        stopReason = 'wave_failed';
        stopDetail = result.errorSummary || result.runResult?.stopDetail || result.runResult?.stopReason || 'Runner wave failed.';
        const remaining = await Promise.all(active.values());
        for (const settled of remaining) waves.push(settled.result);
        claimedWaves += remaining.length;
        claimedItems += remaining.length;
        active.clear();
        break;
      }
      continue;
    }

    if (startedAny) continue;

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

  // Honest terminal signal: `all_closed` / `finalExplain.complete` is only STRUCTURAL closure.
  // Run the claim-safety audit so a consumer never mistakes a structurally-complete but
  // unapproved (or manually-attested) graph for a policy-approved, inductively-sound one.
  let claimSafe = null;
  let strictSafe = null;
  let closureState = finalExplain?.closure?.closureState ?? null;
  try {
    const auditProjectDir = finalExplain?.projectDir || workDir;
    const audit = auditParsedWork(parseProject(auditProjectDir));
    claimSafe = audit.claimSafe;
    strictSafe = audit.strictSafe;
    closureState = audit.metrics?.closureState ?? closureState;
  } catch { /* leave the verdict null when the work cannot be re-parsed */ }

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
    maxSteps,
    maxStepsExplicit,
    loopbackPolicy,
    maxLoopbacks,
    idleExitAfterSeconds,
    pollIntervalMs,
    stopOnFailure,
    claimSafe,
    strictSafe,
    closureState,
    finalExplain,
    waves,
  };
}

export function listRunnerReports(workDir) {
  return listProgressReports(workDir);
}
