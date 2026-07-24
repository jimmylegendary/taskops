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
  const args = [
    '--print',
    '--output-format', 'text',
    '--permission-mode', 'bypassPermissions',
  ];
  // Optional per-task model routing via env (mirrors TASKOPS_CODEX_MODEL) — lets an orchestrator
  // distribute work across Claude tiers. Inactive unless set, so default claude behavior is unchanged.
  const model = trim(process.env.TASKOPS_CLAUDE_MODEL);
  if (model) args.push('--model', model);
  const extra = trim(process.env.TASKOPS_CLAUDE_EXTRA_ARGS);
  if (extra) args.push(...extra.split(/\s+/).filter(Boolean));
  args.push(prompt);
  return args;
}

export function codexArgs({ prompt, variant = null }) {
  const args = [
    '--ask-for-approval', 'never',
    'exec',
    '--skip-git-repo-check',
    '--sandbox', 'danger-full-access',
  ];
  // gpt-5.6 reasoning-effort tier: from a `codex-cli:<effort>` executor spec (an escalation-ladder step) or the
  // TASKOPS_CODEX_EFFORT env. Lets a SATURATED task re-attempt on a STRONGER reasoning tier of the SAME model
  // (RUNG-1 capability-delegate) — the honest "try a better model" without switching providers. Quote the value so
  // an unexpected token can't inject extra -c config.
  const effort = trim(variant) || trim(process.env.TASKOPS_CODEX_EFFORT);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  // Native (subscription) model override — e.g. gpt-5.5 at per-token $0 vs the credit-metered default. Unlike
  // TASKOPS_CODEX_MODEL (OpenRouter routing: swaps provider+key), this injects ONLY `-m` and keeps the native
  // provider/auth, so a 500-instance bench can run on the flat subscription without burning credits.
  const nativeModel = trim(process.env.TASKOPS_CODEX_NATIVE_MODEL);
  if (nativeModel && !trim(process.env.TASKOPS_CODEX_MODEL)) args.push('-m', nativeModel);
  // Optional OpenAI-compatible routing (e.g. OpenRouter open models) via env — no global ~/.codex/config.toml or
  // openclaw edit. Inactive unless TASKOPS_CODEX_MODEL is set, so default codex behavior is unchanged.
  const orModel = trim(process.env.TASKOPS_CODEX_MODEL);
  if (orModel) {
    const baseUrl = trim(process.env.TASKOPS_CODEX_BASE_URL) || 'https://openrouter.ai/api/v1';
    const envKey = trim(process.env.TASKOPS_CODEX_ENV_KEY) || 'OPENROUTER_API_KEY';
    const provider = trim(process.env.TASKOPS_CODEX_PROVIDER) || 'openrouter';
    args.push('-c', `model_providers.${provider}={name="${provider}",base_url="${baseUrl}",env_key="${envKey}"}`);
    args.push('-c', `model_provider="${provider}"`);
    args.push('-m', orModel);
  }
  args.push(prompt);
  return args;
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

// An executor spec may carry a `:variant` suffix (e.g. `codex-cli:high`) selecting a build-args variant such as a
// reasoning-effort tier. The base (before the first `:`) selects the adapter; the variant is threaded to buildArgs.
// A bare name (no `:`) parses to variant=null, so every existing caller is unaffected.
export function parseExecutorSpec(executor) {
  const raw = executor == null ? '' : String(executor).trim();
  const idx = raw.indexOf(':');
  if (idx === -1) return { base: raw, variant: null };
  return { base: raw.slice(0, idx), variant: raw.slice(idx + 1).trim() || null };
}

const EXECUTOR_ALIASES = Object.freeze({
  'openclaw-agent': 'openclaw-cli',
});

export function normalizeExecutorSpec(value) {
  const { base, variant } = parseExecutorSpec(value);
  const adapterName = normalizeRuntimeAdapter(EXECUTOR_ALIASES[base] || base);
  return { adapterName, variant };
}

export function runtimeAdapterForExecutor(executor) {
  const { adapterName } = normalizeExecutorSpec(executor);
  return ADAPTERS[adapterName];
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
  const { adapterName, variant } = normalizeExecutorSpec(runtimeAdapter);
  const adapter = ADAPTERS[adapterName];
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
  const args = adapter.buildArgs({ prompt, agentId, sessionKey, timeoutMs, variant });
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs == null ? undefined : timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env,
    cwd,
    // Close stdin with an immediate EOF: `codex exec` (and others) otherwise print "Reading additional input from
    // stdin..." and BLOCK on a pipe that never closes — the prompt is passed as an arg, so stdin is never needed.
    // (claude-code went through a wrapper that redirected </dev/null; this makes every adapter stdin-safe.)
    input: '',
  });
  return normalizeSpawnResult(adapter.name, command, args, result, timeoutMs);
}
