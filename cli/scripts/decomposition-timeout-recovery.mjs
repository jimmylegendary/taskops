#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-decomposition-timeout-recovery-'));

function run(args, options = {}) {
  const result = spawnSync('node', [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== (options.expectStatus ?? 0)) {
    throw new Error(`taskops ${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function makeWork(id) {
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Verify decomposition timeout recovery', '--language', 'en']);
  const specPath = join(tempRoot, `${id}-root-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Root recovery fixture',
    selected: true,
    tasks: [
      {
        id: 'task-open-depth',
        title: 'Open depth',
        objective: 'Decompose into one child group.',
        responsibility: 'Exercise timeout recovery for agent-authored decomposition.',
        completionCriteria: 'A child group is accepted only when complete.',
        order: 1,
        status: 'pending',
        runReadiness: 'needs_decomposition',
        uncertaintyState: 'known_unknown',
        confidenceScore: 0.5,
        decompositionConfidence: 0.8,
      },
    ],
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function makeFakeOpenClaw() {
  const fakePath = join(tempRoot, 'fake-openclaw-decomposition-timeout.mjs');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) {
  console.log('openclaw fake decomposition timeout recovery');
  process.exit(0);
}

const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const workDir = process.env.TASKOPS_DECOMPOSITION_RECOVERY_WORK_DIR;
const mode = process.env.TASKOPS_DECOMPOSITION_RECOVERY_MODE || 'complete';
if (!workDir) {
  console.error('missing TASKOPS_DECOMPOSITION_RECOVERY_WORK_DIR');
  process.exit(2);
}
const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
if (!childTaskGroupId || !versionId) {
  console.error('missing target ids in prompt');
  process.exit(2);
}
const now = '2026-06-28T00:00:00.000Z';
const groupDir = join(workDir, 'task-groups', childTaskGroupId);
const versionDir = join(groupDir, 'versions', versionId);
const tasksDir = join(versionDir, 'tasks');
mkdirSync(tasksDir, { recursive: true });
mkdirSync(join(versionDir, 'eow'), { recursive: true });
writeFileSync(join(groupDir, 'index.md'), [
  '---',
  'taskOpsVersion: v1',
  'entityType: taskGroup',
  'id: ' + childTaskGroupId,
  'objective: Timeout recovery child group',
  'createdAt: ' + now,
  'status: active',
  'activeVersionId: ' + versionId,
  '---',
  '# ' + childTaskGroupId,
  '',
].join('\\n'), 'utf8');
writeFileSync(join(versionDir, 'index.md'), [
  '---',
  'taskOpsVersion: v1',
  'entityType: taskGroupVersion',
  'id: ' + versionId,
  'taskGroupId: ' + childTaskGroupId,
  'version: v1',
  'summary: Timeout recovery child version',
  'createdAt: ' + now,
  'status: active',
  '---',
  '# Timeout recovery child version',
  '',
].join('\\n'), 'utf8');
writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- Authored by timeout fake.\\n', 'utf8');
if (mode === 'complete') {
  for (const [id, order] of [['task-child-a', 1], ['task-child-b', 2]]) {
    writeFileSync(join(tasksDir, id + '.md'), [
      '---',
      'taskOpsVersion: v1',
      'entityType: task',
      'id: ' + id,
      'taskGroupId: ' + childTaskGroupId,
      'taskGroupVersionId: ' + versionId,
      'title: Child ' + order,
      'objective: Complete child slice ' + order + '.',
      'responsibility: Own child slice ' + order + '.',
      'completionCriteria: Child slice ' + order + ' is ready for future work.',
      'order: ' + order,
      'createdAt: ' + now,
      'status: pending',
      'runReadiness: needs_exploration',
      'uncertaintyState: unknown_unknown',
      'confidenceScore: 0.2',
      '---',
      '# Child ' + order,
      '',
    ].join('\\n'), 'utf8');
  }
}
const view = new Int32Array(new SharedArrayBuffer(4));
Atomics.wait(view, 0, 0, 10000);
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function readEvents(workDir, runId) {
  return readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8')
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function taskPath(workDir) {
  return join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-open-depth.md');
}

try {
  const fakeOpenClaw = makeFakeOpenClaw();
  const previousOpenClawBin = process.env.TASKOPS_OPENCLAW_BIN;
  const previousMode = process.env.TASKOPS_DECOMPOSITION_RECOVERY_MODE;
  const previousWorkDir = process.env.TASKOPS_DECOMPOSITION_RECOVERY_WORK_DIR;
  process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClaw;

  const recoveryWorkDir = makeWork('decomposition-timeout-recovery-complete');
  process.env.TASKOPS_DECOMPOSITION_RECOVERY_WORK_DIR = recoveryWorkDir;
  process.env.TASKOPS_DECOMPOSITION_RECOVERY_MODE = 'complete';
  const recoveredRun = runTaskOps(recoveryWorkDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 1,
    targetTaskId: 'task-open-depth',
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
  assert.equal(recoveredRun.stepsRun, 1);
  assert.equal(recoveredRun.stopReason, 'max_steps');
  assert.equal(recoveredRun.actions[0].status, 'completed');
  assert.equal(recoveredRun.actions[0].recoveredAfterAdapterFailure, true);
  assert.match(recoveredRun.actions[0].adapterFailureReason, /timed out after 1000ms/);
  assert.equal(recoveredRun.actions[0].adapterStatus, 'timeout');
  assert.equal(recoveredRun.actions[0].recoveryStatus, 'recovered_after_timeout');
  assert.equal(recoveredRun.actions[0].childTaskGroupId, 'tg-open-depth');
  assert.equal(recoveredRun.actions[0].versionId, 'tgv-open-depth-v1');
  const recoveredTask = parseMarkdownFile(taskPath(recoveryWorkDir));
  assert.equal(recoveredTask.status, 'done');
  assert.equal(recoveredTask.childTaskGroupId, 'tg-open-depth');
  assert.equal(recoveredTask.lastRunFailureReason, undefined);
  assert.match(recoveredTask.runReadinessReason, /adapter timeout recovery/);
  assert.equal(existsSync(join(recoveryWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-open-depth-tgv-root-v2.md')), true);
  assert.equal(parseMarkdownFile(join(recoveryWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-open-depth-tgv-root-v2.md')).reason, 'decomposed_by_runner_after_adapter_timeout_recovery');
  assert.equal(parseMarkdownFile(join(recoveryWorkDir, 'runs', recoveredRun.runId, 'nodes', `eow-${recoveredRun.actions[0].runNodeId}-${recoveredRun.runId}.md`)).reason, 'decomposition_recorded_after_adapter_timeout_recovery');
  const recoveredEvents = readEvents(recoveryWorkDir, recoveredRun.runId);
  assert.equal(recoveredEvents.some((event) => event.type === 'decomposition_recovered_after_adapter_failure'), true);
  assert.equal(recoveredEvents.find((event) => event.type === 'decomposition_recovered_after_adapter_failure').adapterStatus, 'timeout');
  assert.equal(recoveredEvents.some((event) => event.type === 'decomposition_failed'), false);
  assert.equal(recoveredEvents.some((event) => event.type === 'decomposition_completed' && event.recoveredAfterAdapterFailure === true), true);
  assert.deepEqual(parseProject(recoveryWorkDir).errors, []);

  const rejectWorkDir = makeWork('decomposition-timeout-recovery-incomplete');
  process.env.TASKOPS_DECOMPOSITION_RECOVERY_WORK_DIR = rejectWorkDir;
  process.env.TASKOPS_DECOMPOSITION_RECOVERY_MODE = 'incomplete';
  const rejectedRun = runTaskOps(rejectWorkDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 1,
    targetTaskId: 'task-open-depth',
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
  assert.equal(rejectedRun.stepsRun, 1);
  assert.equal(rejectedRun.stopReason, 'task_failed');
  assert.equal(rejectedRun.actions[0].status, 'failed');
  assert.equal(rejectedRun.actions[0].recoveredAfterAdapterFailure, undefined);
  assert.match(rejectedRun.actions[0].message, /timeout recovery rejected/);
  assert.match(rejectedRun.actions[0].message, /no child task files/);
  const rejectedTask = parseMarkdownFile(taskPath(rejectWorkDir));
  assert.equal(rejectedTask.status, 'blocked');
  assert.equal(rejectedTask.childTaskGroupId, undefined);
  assert.match(rejectedTask.lastRunFailureReason, /timeout recovery rejected/);
  assert.equal(existsSync(join(rejectWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-open-depth-tgv-root-v2.md')), false);
  const rejectedEvents = readEvents(rejectWorkDir, rejectedRun.runId);
  assert.equal(rejectedEvents.some((event) => event.type === 'decomposition_recovered_after_adapter_failure'), false);
  assert.equal(rejectedEvents.some((event) => event.type === 'decomposition_completed'), false);
  assert.equal(rejectedEvents.some((event) => event.type === 'decomposition_failed'), true);

  if (previousOpenClawBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
  else process.env.TASKOPS_OPENCLAW_BIN = previousOpenClawBin;
  if (previousMode == null) delete process.env.TASKOPS_DECOMPOSITION_RECOVERY_MODE;
  else process.env.TASKOPS_DECOMPOSITION_RECOVERY_MODE = previousMode;
  if (previousWorkDir == null) delete process.env.TASKOPS_DECOMPOSITION_RECOVERY_WORK_DIR;
  else process.env.TASKOPS_DECOMPOSITION_RECOVERY_WORK_DIR = previousWorkDir;

  console.log('decomposition-timeout-recovery smoke passed');
} catch (err) {
  console.error(err);
  process.exit(1);
}
