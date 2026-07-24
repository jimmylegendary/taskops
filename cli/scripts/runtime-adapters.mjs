import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectRuntimeAdapter,
  executorForRuntime,
  invokeRuntimeAdapter,
  normalizeExecutorSpec,
  normalizeRuntimeAdapter,
  parseExecutorSpec,
  runtimeAdapterForExecutor,
} from '../lib-runtime-adapters.js';

function makeBin(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, 'utf8');
  chmodSync(path, 0o755);
  return path;
}

const temp = mkdtempSync(join(tmpdir(), 'taskops-runtime-adapters-'));

try {
  makeBin(temp, 'claude', `
if [ "$1" = "--version" ]; then
  echo "claude test"
  exit 0
fi
echo "claude received: $*"
`);
  makeBin(temp, 'codex', `
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  echo "not logged in" >&2
  exit 1
fi
echo "codex should not execute while auth fails"
`);
  makeBin(temp, 'opencode', `
if [ "$1" = "--version" ]; then
  echo "opencode test"
  exit 0
fi
sleep 2
echo "late"
`);

  const env = { ...process.env, PATH: `${temp}:/usr/bin:/bin` };

  assert.equal(normalizeRuntimeAdapter('claude-code'), 'claude-code');
  assert.equal(executorForRuntime('codex-cli'), 'codex-cli');
  assert.deepEqual(normalizeExecutorSpec('openclaw-agent'), {
    adapterName: 'openclaw-cli',
    variant: null,
  });
  assert.deepEqual(normalizeExecutorSpec('codex-cli:high'), {
    adapterName: 'codex-cli',
    variant: 'high',
  });

  // Executor spec parsing: a `:variant` suffix (gpt-5.6 reasoning tier) selects a build-args variant; the base
  // still resolves the adapter, and a bare name parses to variant=null (existing callers unaffected).
  assert.deepEqual(parseExecutorSpec('codex-cli:high'), { base: 'codex-cli', variant: 'high' });
  assert.deepEqual(parseExecutorSpec('codex-cli'), { base: 'codex-cli', variant: null });
  assert.equal(runtimeAdapterForExecutor('codex-cli:high').name, 'codex-cli', 'a tier spec resolves the base adapter');

  const missing = detectRuntimeAdapter('openclaw-cli', { env });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'missing_binary');
  assert.match(missing.message, /not found/);

  const success = invokeRuntimeAdapter('claude-code', {
    prompt: 'hello',
    sessionKey: 'test-session',
    timeoutMs: 1000,
    env,
  });
  assert.equal(success.ok, true);
  assert.equal(success.status, 'success');
  assert.match(success.stdout, /claude received/);

  // TASKOPS_CLAUDE_MODEL routes to --model (env-gated; default args unchanged above).
  const priorModel = process.env.TASKOPS_CLAUDE_MODEL;
  process.env.TASKOPS_CLAUDE_MODEL = 'claude-test-model';
  const modelRouted = invokeRuntimeAdapter('claude-code', { prompt: 'hi', timeoutMs: 1000, env });
  assert.match(modelRouted.stdout, /--model claude-test-model/);
  if (priorModel == null) delete process.env.TASKOPS_CLAUDE_MODEL;
  else process.env.TASKOPS_CLAUDE_MODEL = priorModel;

  const auth = invokeRuntimeAdapter('codex-cli', {
    prompt: 'hello',
    sessionKey: 'test-session',
    timeoutMs: 1000,
    env,
  });
  assert.equal(auth.ok, false);
  assert.equal(auth.status, 'auth_failure');
  assert.match(auth.message, /not logged in/);

  makeBin(temp, 'codex', `
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  echo "Logged in with ChatGPT"
  exit 0
fi
if [ "$1" = "--ask-for-approval" ] && [ "$2" = "never" ] && [ "$3" = "exec" ]; then
  echo "codex received: $*"
  exit 0
fi
echo "bad codex args: $*" >&2
exit 2
`);
  const codexSuccess = invokeRuntimeAdapter('codex-cli', {
    prompt: 'hello',
    sessionKey: 'test-session',
    timeoutMs: 1000,
    env,
  });
  assert.equal(codexSuccess.ok, true);
  assert.equal(codexSuccess.status, 'success');
  assert.match(codexSuccess.stdout, /--ask-for-approval never exec/);

  // gpt-5.6 reasoning-effort tier: `codex-cli:<effort>` injects `-c model_reasoning_effort="<effort>"` so a
  // saturation-escalation ladder can re-attempt on a stronger tier of the same model (RUNG-1 capability-delegate).
  const codexTier = invokeRuntimeAdapter('codex-cli:high', { prompt: 'hi', timeoutMs: 1000, env });
  assert.equal(codexTier.ok, true, 'a codex-cli:<effort> spec resolves to the codex adapter');
  assert.match(codexTier.stdout, /model_reasoning_effort="high"/, 'the effort tier is injected as a -c config');
  // a bare codex-cli spec injects no effort (default behavior unchanged) — guards against a silent global shift
  const codexBare = invokeRuntimeAdapter('codex-cli', { prompt: 'hi', timeoutMs: 1000, env });
  assert.doesNotMatch(codexBare.stdout, /model_reasoning_effort/, 'bare codex-cli injects no effort override');

  const timeout = invokeRuntimeAdapter('opencode-cli', {
    prompt: 'hello',
    sessionKey: 'test-session',
    timeoutMs: 100,
    env,
  });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.status, 'timeout');
  assert.equal(timeout.timedOut, true);

  console.log('OK runtime adapter registry');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
