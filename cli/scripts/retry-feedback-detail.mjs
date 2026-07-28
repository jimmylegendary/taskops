#!/usr/bin/env node
// Regression: a verify RETRY must tell the agent WHY the check failed, not just WHICH command failed.
//
// The runner already captures each required check's output (executeRequiredChecks → `detail`, 500 chars) and
// already injects `task.lastCheckFailure` into the retry prompt ("RETRY — the previous attempt failed the required
// check. …"). But the feedback string was built from `failedChecks`, which carried only `<command>: <status>`.
// So the retry prompt named the command and withheld the diagnosis — a blind retry. Observed live on the
// gpt-5.4/low SWE-bench Pro run: attempt 1 `novel:true` → attempt 2 `novel:false` (the agent repeated itself)
// and the paired lift against the bare arm was 0.
//
// Contract asserted here: when a required check fails with output, that OUTPUT reaches `lastCheckFailure`
// (and therefore the retry prompt). The command stays in the message too — losing it would break the operator's
// ability to re-run the check by hand.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps, buildAgentExecutionPrompt } from '../lib-runner.js';

const now = '2026-07-28T00:00:00.000Z';
const TV = 'task-groups/tg-root/versions/tgv-root-v1';
const readTask = (w) => parseMarkdownFile(join(w, `${TV}/tasks/t.md`));

function build(root, cmd) {
  const w = join(root, 'work');
  for (const d of [`${TV}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'rfd', title: 'R', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${TV}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${TV}/tasks/t.md`, {
    taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
    title: 'T', objective: 'do the thing', responsibility: 'own it', completionCriteria: 'the check passes',
    order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known',
    acceptance: { mode: 'guarded', expectedOutcome: 'check passes', requiredChecks: [{ command: cmd }] },
  });
  return w;
}

// The check tokens must live ONLY in the script's OUTPUT, never in the command string: a command like
// `echo FAIL_TOKEN` makes `lastCheckFailure.includes('FAIL_TOKEN')` pass on the command echo alone, so the
// assertion would hold even when the diagnosis is thrown away. (That vacuous form is exactly how this
// regression first hid itself.) A script file keeps the command opaque — `bash <path>` carries no token.
function failingScript(root, stdoutLine, stderrLine, code = 1) {
  const p = join(root, `fail-${Math.abs(stdoutLine.length * 31 + stderrLine.length)}.sh`);
  writeFileSync(p, `#!/usr/bin/env bash\n${stdoutLine ? `echo ${JSON.stringify(stdoutLine)}\n` : ''}${stderrLine ? `echo ${JSON.stringify(stderrLine)} >&2\n` : ''}exit ${code}\n`, 'utf8');
  return `bash ${p}`;
}

const cleanups = [];
try {
  // ── T1: a failing check's OUTPUT reaches lastCheckFailure (the diagnosis, not just the command name) ──
  {
    const root = mkdtempSync(join(tmpdir(), 'taskops-rfd-1-')); cleanups.push(root);
    // stdout AND stderr both carry a distinctive token; a real grader prints its diagnosis on either stream.
    const cmd = failingScript(root, 'FAIL_ON_STDOUT: expected 42 got 7', 'FAIL_ON_STDERR: assert_total mismatch');
    const w = build(root, cmd);
    runTaskOps(w, { executor: 'dry-run', runId: 'r1', maxSteps: 1, verifyChecks: true, verifyRetries: 1 });
    const task = readTask(w);
    const lcf = String(task.lastCheckFailure || '');
    assert.ok(lcf, 'T1: lastCheckFailure must be set after a failed required check');
    assert.ok(lcf.includes('FAIL_ON_STDOUT: expected 42 got 7'),
      `T1: the check's stdout diagnosis must reach the retry feedback — got: ${lcf.slice(0, 300)}`);
    assert.ok(lcf.includes('FAIL_ON_STDERR: assert_total mismatch'),
      `T1: the check's stderr diagnosis must reach the retry feedback — got: ${lcf.slice(0, 300)}`);
    // the command must survive too: an operator has to be able to re-run it by hand
    assert.ok(lcf.includes(cmd), 'T1: the failing command must stay in the message');
    console.log('  OK T1 failing check output reaches lastCheckFailure (stdout + stderr + command)');
  }

  // ── T2: that feedback actually lands in the RETRY PROMPT the agent sees ──
  {
    const root = mkdtempSync(join(tmpdir(), 'taskops-rfd-2-')); cleanups.push(root);
    const cmd = failingScript(root, '', 'DIAGNOSIS_TOKEN_XYZ: null pointer in parse()', 3);
    const w = build(root, cmd);
    runTaskOps(w, { executor: 'dry-run', runId: 'r1', maxSteps: 1, verifyChecks: true, verifyRetries: 1 });
    const task = readTask(w);
    const prompt = buildAgentExecutionPrompt({ project: { id: 'rfd', objective: 'x' }, task, projectDir: w });
    assert.ok(prompt.includes('RETRY'), 'T2: retry prompt must announce the retry');
    assert.ok(prompt.includes('DIAGNOSIS_TOKEN_XYZ: null pointer in parse()'),
      'T2: the agent-facing retry prompt must carry the check diagnosis, not only the command');
    console.log('  OK T2 diagnosis reaches the agent-facing retry prompt');
  }

  // ── T3: no-output failure degrades gracefully (no "undefined"/"null" leaking into the prompt) ──
  {
    const root = mkdtempSync(join(tmpdir(), 'taskops-rfd-3-')); cleanups.push(root);
    const w = build(root, 'exit 1');   // fails silently: no stdout, no stderr
    runTaskOps(w, { executor: 'dry-run', runId: 'r1', maxSteps: 1, verifyChecks: true, verifyRetries: 1 });
    const task = readTask(w);
    const lcf = String(task.lastCheckFailure || '');
    assert.ok(lcf.includes('exit 1'), 'T3: silent failure still names the command');
    assert.ok(!/undefined|null|\[object Object\]/.test(lcf),
      `T3: a silent failure must not leak undefined/null into the feedback — got: ${lcf.slice(0, 200)}`);
    console.log('  OK T3 silent failure degrades gracefully (command kept, no undefined/null leak)');
  }

  console.log('retry-feedback-detail: OK (T1-T3)');
} finally {
  for (const r of cleanups) rmSync(r, { recursive: true, force: true });
}
