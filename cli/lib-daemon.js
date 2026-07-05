import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runQueueWatch } from './lib-orchestrator.js';
import { QUEUE_DB_RELATIVE_PATH, syncQueueProjection } from './lib-queue.js';
import { DEFAULT_MAX_LOOPBACKS } from './lib-runner.js';
import { normalizeRuntimeAdapter } from './lib-runtime-adapters.js';

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

function optionalPositiveInteger(value, name, fallback = null) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${value}`);
  return Math.floor(n);
}

function optionalPositiveNumber(value, name, fallback = null) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${value}`);
  return n;
}

function normalizeBool(value, fallback) {
  if (value == null || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function normalizeMaxStepsExplicit(options = {}) {
  if (options.maxStepsExplicit === true || options.maxStepsExplicit === 'true') return true;
  if (options.maxStepsExplicit === false || options.maxStepsExplicit === 'false') return false;
  return options.maxSteps != null && options.maxSteps !== '';
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

function sanitizeName(value) {
  const raw = String(value || '').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'default';
}

function defaultDaemonName(workDir) {
  const base = basename(resolve(workDir)).toLowerCase();
  return sanitizeName(base || 'work');
}

function systemdQuoteArg(value) {
  const raw = String(value);
  if (/^[A-Za-z0-9_/:=.,+@%~ -]+$/.test(raw) && !raw.includes(' ')) return raw;
  return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function keyValueLine(key, value) {
  return `${key}=${String(value).replace(/\n/g, ' ')}`;
}

export function normalizeDaemonOptions(workDir, options = {}) {
  const name = sanitizeName(options.name || options.daemonName || defaultDaemonName(workDir));
  const runnerId = options.runnerId || `taskopsd-${name}`;
  const loopbackPolicy = normalizeLoopbackPolicy(options.loopback || options.loopbackPolicy);
  return {
    workDir: resolve(workDir),
    name,
    runnerId,
    runId: options.runId || null,
    runtimeAdapter: normalizeRuntimeAdapter(options.runtimeAdapter || options.runtime || 'openclaw-cli'),
    ttlSeconds: optionalPositiveInteger(options.ttlSeconds, 'ttl seconds', 300),
    maxAttempts: optionalPositiveInteger(options.maxAttempts, 'max attempts', 3),
    maxParallel: optionalPositiveInteger(options.maxParallel, 'max parallel', 8),
    maxSteps: optionalPositiveInteger(options.maxSteps, 'max steps'),
    maxStepsExplicit: normalizeMaxStepsExplicit(options),
    loopbackPolicy,
    maxLoopbacks: normalizeMaxLoopbacks(options.maxLoopbacks, loopbackPolicy),
    verifyChecks: normalizeBool(options.verifyChecks, false),
    verifyRetries: optionalPositiveInteger(options.verifyRetries, 'verify retries', 0),
    timeout: options.timeout == null || options.timeout === '' ? 300 : Number(options.timeout),
    reportSink: options.reportSink || 'ledger',
    masterSessionKey: options.masterSessionKey || null,
    agent: options.agent || null,
    actor: options.actor || null,
    pollIntervalMs: optionalPositiveInteger(options.pollIntervalMs, 'poll interval ms', 5000),
    daemonPollIntervalMs: optionalPositiveInteger(options.daemonPollIntervalMs, 'daemon poll interval ms', 30000),
    failureBackoffMs: optionalPositiveInteger(options.failureBackoffMs, 'failure backoff ms', 60000),
    maxDaemonCycles: optionalPositiveInteger(options.maxDaemonCycles, 'max daemon cycles'),
    maxWaves: optionalPositiveInteger(options.maxWaves, 'max waves'),
    maxIdleCycles: optionalPositiveInteger(options.maxIdleCycles, 'max idle cycles'),
    idleExitAfterSeconds: optionalPositiveNumber(options.idleExitAfterSeconds, 'idle exit after seconds'),
    until: options.until || null,
    continueOnFailure: normalizeBool(options.continueOnFailure, false),
    cliPath: options.cliPath || process.argv[1],
    nodePath: options.nodePath || process.execPath,
    pathEnv: options.pathEnv || process.env.PATH || '',
  };
}

export function serviceName(name) {
  return `taskopsd-${sanitizeName(name)}.service`;
}

export function userUnitDir() {
  return join(homedir(), '.config', 'systemd', 'user');
}

export function unitPathForName(name) {
  return join(userUnitDir(), serviceName(name));
}

function runnerArgs(opts) {
  const args = [
    opts.nodePath,
    opts.cliPath,
    'daemon',
    'run',
    opts.workDir,
    '--name',
    opts.name,
    '--runtime',
    opts.runtimeAdapter,
    '--runner-id',
    opts.runnerId,
    '--ttl-seconds',
    String(opts.ttlSeconds),
    '--max-attempts',
    String(opts.maxAttempts),
    '--timeout',
    String(opts.timeout),
    '--report-sink',
    opts.reportSink,
    '--poll-interval-ms',
    String(opts.pollIntervalMs),
    '--daemon-poll-interval-ms',
    String(opts.daemonPollIntervalMs),
    '--failure-backoff-ms',
    String(opts.failureBackoffMs),
  ];
  if (opts.masterSessionKey) args.push('--master-session-key', opts.masterSessionKey);
  if (opts.agent) args.push('--agent', opts.agent);
  if (opts.actor) args.push('--actor', opts.actor);
  if (opts.runId) args.push('--run-id', opts.runId);
  if (opts.maxDaemonCycles != null) args.push('--max-daemon-cycles', String(opts.maxDaemonCycles));
  if (opts.maxWaves != null) args.push('--max-waves', String(opts.maxWaves));
  if (opts.maxParallel != null) args.push('--max-parallel', String(opts.maxParallel));
  if (opts.maxSteps != null) args.push('--max-steps', String(opts.maxSteps));
  if (opts.maxStepsExplicit) args.push('--max-steps-explicit');
  if (opts.loopbackPolicy !== 'none') args.push('--loopback', opts.loopbackPolicy, '--max-loopbacks', String(opts.maxLoopbacks));
  if (opts.verifyChecks) args.push('--verify-checks');
  if (opts.verifyRetries) args.push('--verify-retries', String(opts.verifyRetries));
  if (opts.maxIdleCycles != null) args.push('--max-idle-cycles', String(opts.maxIdleCycles));
  if (opts.idleExitAfterSeconds != null) args.push('--idle-exit-after-seconds', String(opts.idleExitAfterSeconds));
  if (opts.until) args.push('--until', opts.until);
  if (opts.continueOnFailure) args.push('--continue-on-failure');
  return args;
}

export function renderSystemdUnit(workDir, options = {}) {
  const opts = normalizeDaemonOptions(workDir, options);
  const execStart = runnerArgs(opts).map(systemdQuoteArg).join(' ');
  const unit = [
    '[Unit]',
    `Description=TaskOps daemon ${opts.name}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    keyValueLine('WorkingDirectory', opts.workDir),
    keyValueLine('Environment', `PATH=${opts.pathEnv}`),
    keyValueLine('ExecStart', execStart),
    'Restart=always',
    'RestartSec=10',
    'KillSignal=SIGTERM',
    'TimeoutStopSec=30',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
  return {
    name: opts.name,
    serviceName: serviceName(opts.name),
    unitPath: unitPathForName(opts.name),
    unit,
    options: opts,
  };
}

function systemctl(args, { allowFailure = false } = {}) {
  const result = spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(stderr || stdout || `systemctl --user ${args.join(' ')} failed with status ${result.status}`);
  }
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ok: result.status === 0,
  };
}

export function installDaemon(workDir, options = {}) {
  const rendered = renderSystemdUnit(workDir, options);
  if (options.dryRun) return { ...rendered, installed: false, dryRun: true };
  mkdirSync(dirname(rendered.unitPath), { recursive: true });
  writeFileSync(rendered.unitPath, rendered.unit, 'utf8');
  const reload = systemctl(['daemon-reload']);
  let enable = null;
  let start = null;
  if (options.enable !== false) enable = systemctl(['enable', rendered.serviceName]);
  if (options.start === true) start = systemctl(['start', rendered.serviceName]);
  return {
    ...rendered,
    installed: true,
    dryRun: false,
    systemd: { reload, enable, start },
  };
}

function runnerActivationConfig(rendered, queue, { started, dryRun }) {
  return {
    schemaVersion: 1,
    mode: 'runner-managed',
    supervisor: 'user-systemd',
    enabledAt: dryRun ? null : isoNow(),
    workDir: rendered.options.workDir,
    daemonName: rendered.name,
    serviceName: rendered.serviceName,
    unitPath: rendered.unitPath,
    runtimeAdapter: rendered.options.runtimeAdapter,
    runnerId: rendered.options.runnerId,
    runId: rendered.options.runId,
    reportSink: rendered.options.reportSink,
    actor: rendered.options.actor,
    masterSessionKeyConfigured: Boolean(rendered.options.masterSessionKey),
    queueDbPath: queue?.dbPath || join(rendered.options.workDir, QUEUE_DB_RELATIVE_PATH),
    syncedQueueItems: queue?.synced ?? null,
    maxParallel: rendered.options.maxParallel,
    maxSteps: rendered.options.maxSteps,
    maxStepsExplicit: rendered.options.maxStepsExplicit,
    loopbackPolicy: rendered.options.loopbackPolicy,
    maxLoopbacks: rendered.options.maxLoopbacks,
    verifyChecks: rendered.options.verifyChecks,
    verifyRetries: rendered.options.verifyRetries,
    started: Boolean(started),
  };
}

export function runnerConfigPathForWorkDir(workDir) {
  return join(resolve(workDir), '.taskops', 'runner.json');
}

export function enableDaemon(workDir, options = {}) {
  const rendered = renderSystemdUnit(workDir, options);
  const start = options.start !== false;
  if (options.dryRun) {
    return {
      ...rendered,
      enabled: false,
      installed: false,
      dryRun: true,
      activationPath: runnerConfigPathForWorkDir(workDir),
      activation: runnerActivationConfig(rendered, null, { started: start, dryRun: true }),
      queueSynced: null,
      startRequested: start,
    };
  }

  const queue = syncQueueProjection(workDir);
  const installed = installDaemon(workDir, { ...options, start });
  const activation = runnerActivationConfig(installed, queue, { started: start, dryRun: false });
  const activationPath = runnerConfigPathForWorkDir(workDir);
  mkdirSync(dirname(activationPath), { recursive: true });
  writeFileSync(activationPath, `${JSON.stringify(activation, null, 2)}\n`, 'utf8');
  return {
    ...installed,
    enabled: true,
    activationPath,
    activation,
    queueSynced: queue,
    startRequested: start,
  };
}

export function uninstallDaemon(name, options = {}) {
  const safeName = sanitizeName(name);
  const unitPath = unitPathForName(safeName);
  const svc = serviceName(safeName);
  if (options.dryRun) return { name: safeName, serviceName: svc, unitPath, removed: false, dryRun: true };
  const stop = systemctl(['stop', svc], { allowFailure: true });
  const disable = systemctl(['disable', svc], { allowFailure: true });
  if (existsSync(unitPath)) rmSync(unitPath, { force: true });
  const reload = systemctl(['daemon-reload'], { allowFailure: true });
  const resetFailed = systemctl(['reset-failed', svc], { allowFailure: true });
  return { name: safeName, serviceName: svc, unitPath, removed: true, systemd: { stop, disable, reload, resetFailed }, dryRun: Boolean(options.dryRun) };
}

export function controlDaemon(name, action) {
  const safeName = sanitizeName(name);
  const svc = serviceName(safeName);
  const allowed = new Set(['start', 'stop', 'restart', 'status']);
  if (!allowed.has(action)) throw new Error(`Invalid daemon action '${action}'`);
  const args = action === 'status'
    ? ['status', '--no-pager', svc]
    : [action, svc];
  const result = systemctl(args, { allowFailure: action === 'status' });
  return { name: safeName, serviceName: svc, action, ...result };
}

export function readDaemonUnit(name) {
  const safeName = sanitizeName(name);
  const unitPath = unitPathForName(safeName);
  return {
    name: safeName,
    serviceName: serviceName(safeName),
    unitPath,
    exists: existsSync(unitPath),
    unit: existsSync(unitPath) ? readFileSync(unitPath, 'utf8') : null,
  };
}

export function daemonLogs(name, options = {}) {
  const safeName = sanitizeName(name);
  const lines = optionalPositiveInteger(options.lines, 'lines', 100);
  const svc = serviceName(safeName);
  const result = spawnSync('journalctl', ['--user', '-u', svc, '-n', String(lines), '--no-pager'], { encoding: 'utf8' });
  return { name: safeName, serviceName: svc, status: result.status, ok: result.status === 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

export async function runDaemon(workDir, options = {}) {
  const opts = normalizeDaemonOptions(workDir, options);
  const cycles = [];
  let stopRequested = false;
  const stop = () => {
    stopRequested = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  let cycle = 0;
  while (!stopRequested) {
    cycle += 1;
    const watchId = `${opts.runnerId}-cycle-${cycle}`;
    const startedAt = isoNow();
    let result = null;
    let error = null;
    try {
      result = await runQueueWatch(opts.workDir, {
        runtimeAdapter: opts.runtimeAdapter,
        runnerId: opts.runnerId,
        runId: opts.runId,
        ttlSeconds: opts.ttlSeconds,
        maxAttempts: opts.maxAttempts,
        maxParallel: opts.maxParallel,
        maxSteps: opts.maxSteps,
        maxStepsExplicit: opts.maxStepsExplicit,
        loopback: opts.loopbackPolicy,
        maxLoopbacks: opts.maxLoopbacks,
        verifyChecks: opts.verifyChecks,
        verifyRetries: opts.verifyRetries,
        timeout: opts.timeout,
        reportSink: opts.reportSink,
        masterSessionKey: opts.masterSessionKey,
        agent: opts.agent,
        actor: opts.actor,
        pollIntervalMs: opts.pollIntervalMs,
        maxWaves: opts.maxWaves,
        maxIdleCycles: opts.maxIdleCycles,
        idleExitAfterSeconds: opts.idleExitAfterSeconds,
        until: opts.until,
        watchId,
        shouldStop: () => stopRequested,
        stopOnFailure: !opts.continueOnFailure,
      });
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }
    const stoppedAt = isoNow();
    const entry = {
      cycle,
      watchId,
      startedAt,
      stoppedAt,
      stopReason: result?.stopReason || 'daemon_error',
      stopDetail: result?.stopDetail || error?.message || null,
      claimedWaves: result?.claimedWaves || 0,
      claimedItems: result?.claimedItems || 0,
      idleCycles: result?.idleCycles || 0,
      waveDetails: Array.isArray(result?.waves) ? result.waves.map((wave) => ({
        waveId: wave.waveId,
        claimed: Boolean(wave.claimed),
        claimedCount: wave.claimedCount || (wave.claimed ? 1 : 0),
        queueItemId: wave.queueItem?.id || null,
        releaseStatus: wave.releaseStatus || null,
        stopReason: wave.runResult?.stopReason || null,
        targetCompleted: wave.targetCompleted ?? null,
        workerStatuses: Array.isArray(wave.workers)
          ? wave.workers.map((worker) => ({
              queueItemId: worker.queueItem?.id || null,
              releaseStatus: worker.releaseStatus || null,
              stopReason: worker.runResult?.stopReason || null,
            }))
          : [],
      })) : [],
    };
    cycles.push(entry);
    if (options.onCycle) options.onCycle(entry, result);
    if (opts.maxDaemonCycles != null && cycle >= opts.maxDaemonCycles) break;
    if (stopRequested) break;
    const delay = ['wave_failed', 'daemon_error'].includes(entry.stopReason) ? opts.failureBackoffMs : opts.daemonPollIntervalMs;
    await sleepMs(delay, () => stopRequested);
  }

  return {
    name: opts.name,
    runnerId: opts.runnerId,
    workDir: opts.workDir,
    stoppedAt: isoNow(),
    stopRequested,
    cycles,
  };
}
