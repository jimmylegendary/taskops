import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectRuntimeAdapter,
  executorForRuntime,
  invokeRuntimeAdapter,
  normalizeRuntimeAdapter,
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
