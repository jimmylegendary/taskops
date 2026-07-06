import { spawnSync } from 'node:child_process';

export const RUNTIME_ADAPTER_NAMES = Object.freeze([
  'dry-run',
  'openclaw-cli',
  'claude-code',
  'codex-cli',
  'opencode-cli',
]);

const AUTH_FAILURE_PATTERNS = [
  /not authenticated/i,
  /not logged in/i,
  /login required/i,
  /please log in/i,
  /authentication required/i,
  /authentication_error/i,
  /failed to authenticate/i,
  /invalid authentication credentials/i,
  /unauthorized/i,
  /invalid api key/i,
  /missing api key/i,
  /api key.*required/i,
];

function trim(value) {
  return String(value || '').trim();
}

function secondsFromMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.max(1, Math.ceil(ms / 1000));
}

function commandExists(command, env = process.env) {
  const result = spawnSync('sh', ['-c', `command -v "$1"`, 'sh', command], {
    encoding: 'utf8',
    env,
  });
  return result.status === 0;
}

function looksLikeAuthFailure(text) {
  return AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(text || ''));
}

function adapterCommand(adapter, env = process.env) {
  const override = adapter.envBin && env[adapter.envBin];
  return trim(override) || adapter.command;
}

function detectCli(command, { env = process.env, probeArgs = ['--version'] } = {}) {
  if (!commandExists(command, env)) {
    return {
      ok: false,
      status: 'missing_binary',
      command,
      message: `Runtime binary '${command}' was not found on PATH.`,
    };
  }
  const probe = spawnSync(command, probeArgs, { encoding: 'utf8', env, timeout: 10000 });
  const stdout = trim(probe.stdout);
  const stderr = trim(probe.stderr);
  if (probe.error) {
    return {
      ok: false,
      status: probe.error.code === 'ENOENT' ? 'missing_binary' : 'runtime_failure',
      command,
      message: probe.error.message,
      stdout,
      stderr,
    };
  }
  if (probe.status !== 0 && looksLikeAuthFailure(`${stdout}\n${stderr}`)) {
    return {
      ok: false,
      status: 'auth_failure',
      command,
      message: stderr || stdout || `${command} authentication probe failed.`,
      stdout,
      stderr,
    };
  }
  return {
    ok: true,
    status: 'available',
    command,
    version: stdout || stderr || null,
    stdout,
    stderr,
  };
}

function normalizeSpawnResult(adapter, command, args, result, timeoutMs) {
  const stdout = trim(result.stdout);
  const stderr = trim(result.stderr);
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      return {
        ok: false,
        adapter,
        status: 'timeout',
        command,
        args,
        exitCode: result.status,
        signal: result.signal || null,
        timedOut: true,
        stdout,
        stderr,
        message: `${adapter} timed out after ${timeoutMs}ms.`,
      };
    }
    const status = result.error.code === 'ENOENT' ? 'missing_binary' : 'runtime_failure';
    return {
      ok: false,
      adapter,
      status,
      command,
      args,
      exitCode: null,
      signal: null,
      timedOut: false,
      stdout,
      stderr,
      message: status === 'missing_binary'
        ? `Runtime binary '${command}' was not found on PATH.`
        : result.error.message,
    };
  }
  const timedOut = result.signal === 'SIGTERM' && timeoutMs != null;
  if (timedOut) {
    return {
      ok: false,
      adapter,
      status: 'timeout',
      command,
      args,
      exitCode: result.status,
      signal: result.signal || null,
      timedOut: true,
      stdout,
      stderr,
      message: `${adapter} timed out after ${timeoutMs}ms.`,
    };
  }
  if (result.status !== 0) {
    const combined = `${stdout}\n${stderr}`;
    const status = looksLikeAuthFailure(combined) ? 'auth_failure' : 'runtime_failure';
    return {
      ok: false,
      adapter,
      status,
      command,
      args,
      exitCode: result.status,
      signal: result.signal || null,
      timedOut: false,
      stdout,
      stderr,
      message: stderr || stdout || `${adapter} exited with status ${result.status}.`,
    };
  }
  return {
    ok: true,
    adapter,
    status: 'success',
    command,
    args,
    exitCode: result.status,
    signal: result.signal || null,
    timedOut: false,
    stdout,
    stderr,
    message: stdout || `${adapter} completed successfully.`,
  };
}

function openClawArgs({ agentId, sessionKey, prompt, timeoutMs }) {
  // openclaw routes on a CONFIGURED agent id (default 'main'), so use that for --agent (overridable via
  // TASKOPS_OPENCLAW_AGENT); carry TaskOps's per-node id as the --session-key for session isolation.
  const agent = process.env.TASKOPS_OPENCLAW_AGENT || 'main';
  const key = sessionKey || agentId || 'taskops';
  const args = [
    'agent',
    '--agent', agent,
    '--session-key', key,
    '--message', prompt,
    '--json',
  ];
  const seconds = secondsFromMs(timeoutMs);
  if (seconds != null) args.push('--timeout', String(seconds));
  return args;
}

function claudeArgs({ prompt }) {
  return [
    '--print',
    '--output-format', 'text',
    '--permission-mode', 'bypassPermissions',
    prompt,
  ];
}

function codexArgs({ prompt }) {
  return [
    '--ask-for-approval', 'never',
    'exec',
    '--skip-git-repo-check',
    '--sandbox', 'danger-full-access',
    prompt,
  ];
}

function opencodeArgs({ prompt }) {
  return ['run', prompt];
}

const ADAPTERS = Object.freeze({
  'dry-run': {
    name: 'dry-run',
    executor: 'dry-run',
    command: null,
    detect: () => ({ ok: true, status: 'available', command: null, message: 'dry-run is built in.' }),
  },
  'openclaw-cli': {
    name: 'openclaw-cli',
    executor: 'openclaw-agent',
    command: 'openclaw',
    envBin: 'TASKOPS_OPENCLAW_BIN',
    detect: (options = {}) => detectCli(adapterCommand(ADAPTERS['openclaw-cli'], options.env), options),
    buildArgs: openClawArgs,
  },
  'claude-code': {
    name: 'claude-code',
    executor: 'claude-code',
    command: 'claude',
    envBin: 'TASKOPS_CLAUDE_BIN',
    detect: (options = {}) => detectCli(adapterCommand(ADAPTERS['claude-code'], options.env), options),
    buildArgs: claudeArgs,
  },
  'codex-cli': {
    name: 'codex-cli',
    executor: 'codex-cli',
    command: 'codex',
    envBin: 'TASKOPS_CODEX_BIN',
    detect: (options = {}) => detectCli(adapterCommand(ADAPTERS['codex-cli'], options.env), { ...options, probeArgs: ['login', 'status'] }),
    buildArgs: codexArgs,
  },
  'opencode-cli': {
    name: 'opencode-cli',
    executor: 'opencode-cli',
    command: 'opencode',
    envBin: 'TASKOPS_OPENCODE_BIN',
    detect: (options = {}) => detectCli(adapterCommand(ADAPTERS['opencode-cli'], options.env), options),
    buildArgs: opencodeArgs,
  },
});

export function normalizeRuntimeAdapter(value) {
  const runtime = value == null || value === '' ? 'dry-run' : String(value).trim();
  if (!Object.prototype.hasOwnProperty.call(ADAPTERS, runtime)) {
    throw new Error(`Invalid runtime adapter '${value}'. Use ${RUNTIME_ADAPTER_NAMES.join(', ')}.`);
  }
  return runtime;
}

export function runtimeAdapterForExecutor(executor) {
  const runtime = normalizeRuntimeAdapter(executor);
  return ADAPTERS[runtime];
}

export function executorForRuntime(runtimeAdapter) {
  return runtimeAdapterForExecutor(runtimeAdapter).executor;
}

export function detectRuntimeAdapter(runtimeAdapter, options = {}) {
  const adapter = runtimeAdapterForExecutor(runtimeAdapter);
  return { adapter: adapter.name, ...adapter.detect(options) };
}

export function invokeRuntimeAdapter(runtimeAdapter, {
  prompt,
  agentId = 'main',
  sessionKey,
  timeoutMs = null,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const adapter = runtimeAdapterForExecutor(runtimeAdapter);
  if (adapter.name === 'dry-run') {
    return { ok: true, adapter: adapter.name, status: 'success', message: 'dry-run completed successfully.', stdout: '', stderr: '' };
  }
  const capability = adapter.detect({ env });
  if (!capability.ok) {
    return {
      ok: false,
      adapter: adapter.name,
      status: capability.status,
      command: capability.command,
      args: [],
      exitCode: null,
      signal: null,
      timedOut: false,
      stdout: capability.stdout || '',
      stderr: capability.stderr || '',
      message: capability.message,
    };
  }
  const command = adapterCommand(adapter, env);
  const args = adapter.buildArgs({ prompt, agentId, sessionKey, timeoutMs });
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs == null ? undefined : timeoutMs,
    env,
    cwd,
  });
  return normalizeSpawnResult(adapter.name, command, args, result, timeoutMs);
}
