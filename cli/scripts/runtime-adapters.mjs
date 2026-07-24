import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTaskOps } from '../lib-runner.js';
import { fmBlock } from '../lib-taskops.js';
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

function makeRunnableWork(root, id) {
  const workDir = join(root, id);
  const versionDir = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1');
  const now = '2026-07-25T00:00:00.000Z';
  mkdirSync(join(versionDir, 'tasks'), { recursive: true });
  mkdirSync(join(workDir, 'snapshots'), { recursive: true });
  const writeMd = (path, fm) => writeFileSync(path, `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1', entityType: 'work', id, title: id,
    objective: 'Verify a variant reaches the canonical executor.',
    activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1',
    createdAt: now, status: 'active',
  });
  writeMd(join(workDir, 'task-groups', 'tg-root', 'index.md'), {
    taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root',
    objective: 'Execute one bounded task.', activeVersionId: 'tgv-root-v1',
    createdAt: now, status: 'active',
  });
  writeMd(join(versionDir, 'index.md'), {
    taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1',
    taskGroupId: 'tg-root', version: 'v1', summary: 'Executor variant fixture.',
    selected: true, createdAt: now, status: 'active',
  });
  writeMd(join(workDir, 'snapshots', 'snapshot-root-v1.md'), {
    taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1',
    rootTaskGroupId: 'tg-root', createdAt: now, label: 'Root', status: 'active',
    selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }],
  });
  writeMd(join(versionDir, 'tasks', 'task-variant.md'), {
    taskOpsVersion: 'v1', entityType: 'task', id: 'task-variant',
    taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
    title: 'Exercise the executor variant', objective: 'Invoke the configured runtime variant.',
    responsibility: 'Own the bounded invocation.', completionCriteria: 'The runtime invocation succeeds.',
    order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable',
    understandingLevel: 'known', acceptance: { mode: 'informational', expectedOutcome: 'Runtime invocation recorded.' },
  });
  return workDir;
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

  const codexBin = makeBin(temp, 'codex', `
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  echo "Logged in with ChatGPT"
  exit 0
fi
if [ "$1" = "--ask-for-approval" ] && [ "$2" = "never" ] && [ "$3" = "exec" ]; then
  if [ -n "$TASKOPS_VARIANT_CAPTURE_PATH" ]; then
    printf '%s\n' "$*" >> "$TASKOPS_VARIANT_CAPTURE_PATH"
  fi
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

  const priorCodexBin = process.env.TASKOPS_CODEX_BIN;
  const priorCapturePath = process.env.TASKOPS_VARIANT_CAPTURE_PATH;
  const capturePath = join(temp, 'runner-variant-args.txt');
  process.env.TASKOPS_CODEX_BIN = codexBin;
  process.env.TASKOPS_VARIANT_CAPTURE_PATH = capturePath;
  try {
    const runnerWork = makeRunnableWork(temp, 'runner-codex-high');
    const runnerResult = runTaskOps(runnerWork, {
      executor: 'codex-cli:high',
      maxSteps: 1,
      maxStepsExplicit: true,
    });
    assert.equal(runnerResult.actions[0].status, 'completed');
    assert.match(
      readFileSync(capturePath, 'utf8'),
      /model_reasoning_effort="high"/,
      'the real runner preserves the variant while invoking the canonical codex-cli adapter',
    );
    assert.throws(
      () => runTaskOps(runnerWork, { executor: 'unknown-adapter:high', maxSteps: 1 }),
      /Invalid --executor 'unknown-adapter:high'/,
      'an unknown adapter with a variant is rejected with the original executor spec',
    );
  } finally {
    if (priorCodexBin == null) delete process.env.TASKOPS_CODEX_BIN;
    else process.env.TASKOPS_CODEX_BIN = priorCodexBin;
    if (priorCapturePath == null) delete process.env.TASKOPS_VARIANT_CAPTURE_PATH;
    else process.env.TASKOPS_VARIANT_CAPTURE_PATH = priorCapturePath;
  }

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
