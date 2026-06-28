#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ancestorChainForTask, parseProject } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-decomposition-depth-chain-recovery-'));

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

function makeWork() {
  const workDir = join(tempRoot, 'work');
  run(['init', workDir, '--id', 'decomposition-depth-chain-recovery', '--title', 'Decomposition depth chain recovery', '--objective', 'Verify recovered decompositions can open the next lineage depth.', '--language', 'en']);
  const specPath = join(tempRoot, 'root-spec.json');
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Root depth-chain recovery fixture',
    selected: true,
    tasks: [
      {
        id: 'task-root-open-depth',
        title: 'Open root depth',
        objective: 'Decompose into a child group that can itself decompose once.',
        responsibility: 'Exercise timeout recovery followed by active snapshot extension.',
        completionCriteria: 'A recovered child group is selected and its child task is picked next.',
        order: 1,
        status: 'pending',
        runReadiness: 'needs_decomposition',
        uncertaintyState: 'known_unknown',
        confidenceScore: 0.55,
        decompositionConfidence: 0.85,
      },
    ],
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function makeFakeOpenClaw() {
  const fakePath = join(tempRoot, 'fake-openclaw-depth-chain-timeout.mjs');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) {
  console.log('openclaw fake depth-chain timeout recovery');
  process.exit(0);
}

const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const workDir = process.env.TASKOPS_DEPTH_CHAIN_RECOVERY_WORK_DIR;
if (!workDir) {
  console.error('missing TASKOPS_DEPTH_CHAIN_RECOVERY_WORK_DIR');
  process.exit(2);
}

const sourceTaskId = (prompt.match(/Task to decompose: ([^ ]+) /) || [])[1]?.trim();
const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
if (!sourceTaskId || !childTaskGroupId || !versionId) {
  console.error('missing source or target ids in prompt');
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
  'objective: Recovered depth-chain child group',
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
  'summary: Recovered depth-chain child version',
  'createdAt: ' + now,
  'status: active',
  '---',
  '# Recovered depth-chain child version',
  '',
].join('\\n'), 'utf8');

writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- Authored by depth-chain timeout fake.\\n', 'utf8');

const writeTask = (task) => {
  const lines = [
    '---',
    'taskOpsVersion: v1',
    'entityType: task',
    'id: ' + task.id,
    'taskGroupId: ' + childTaskGroupId,
    'taskGroupVersionId: ' + versionId,
    'title: ' + task.title,
    'objective: ' + task.objective,
    'responsibility: ' + task.responsibility,
    'completionCriteria: ' + task.completionCriteria,
    'order: ' + task.order,
    'createdAt: ' + now,
    'status: ' + task.status,
    'runReadiness: ' + task.runReadiness,
  ];
  if (task.runReadinessReason) lines.push('runReadinessReason: ' + task.runReadinessReason);
  if (task.uncertaintyState) lines.push('uncertaintyState: ' + task.uncertaintyState);
  if (task.confidenceScore != null) lines.push('confidenceScore: ' + task.confidenceScore);
  if (task.decompositionConfidence != null) lines.push('decompositionConfidence: ' + task.decompositionConfidence);
  if (task.blockedReason) lines.push('blockedReason: ' + task.blockedReason);
  lines.push('---', '# ' + task.title, '');
  writeFileSync(join(tasksDir, task.id + '.md'), lines.join('\\n'), 'utf8');
};

if (sourceTaskId === 'task-root-open-depth') {
  writeTask({
    id: 'task-open-grandchild-depth',
    title: 'Open grandchild depth',
    objective: 'Decompose once more to prove recovered children are selected for later steps.',
    responsibility: 'Exercise next-depth selection after timeout recovery.',
    completionCriteria: 'A grandchild task group is authored and selected.',
    order: 1,
    status: 'pending',
    runReadiness: 'needs_decomposition',
    runReadinessReason: 'Depth-chain recovery smoke asks this child to decompose once more.',
    uncertaintyState: 'known_unknown',
    confidenceScore: 0.5,
    decompositionConfidence: 0.85,
  });
  writeTask({
    id: 'task-child-terminal-blocked',
    title: 'Child terminal blocked',
    objective: 'Remain blocked so the runner prefers the decomposable child first.',
    responsibility: 'Keep the fixture bounded.',
    completionCriteria: 'No execution is expected.',
    order: 2,
    status: 'blocked',
    runReadiness: 'blocked',
    runReadinessReason: 'Fixture terminal guard.',
    uncertaintyState: 'unknown_unknown',
    confidenceScore: 0.1,
    blockedReason: 'fixture_terminal_guard',
  });
} else if (sourceTaskId === 'task-open-grandchild-depth') {
  writeTask({
    id: 'task-grandchild-terminal-blocked',
    title: 'Grandchild terminal blocked',
    objective: 'Terminate the depth-chain recovery smoke after maxDepth=2 is observable.',
    responsibility: 'Stop the runner without adding another decomposable depth.',
    completionCriteria: 'The runner stops with blocked-only work after two recovered decompositions.',
    order: 1,
    status: 'blocked',
    runReadiness: 'blocked',
    runReadinessReason: 'Fixture terminal guard.',
    uncertaintyState: 'unknown_unknown',
    confidenceScore: 0.1,
    blockedReason: 'fixture_terminal_guard',
  });
} else {
  console.error('unexpected source task id: ' + sourceTaskId);
  process.exit(2);
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

function countEvents(events, type) {
  return events.filter((event) => event.type === type).length;
}

try {
  const workDir = makeWork();
  const fakeOpenClaw = makeFakeOpenClaw();
  const previousOpenClawBin = process.env.TASKOPS_OPENCLAW_BIN;
  const previousWorkDir = process.env.TASKOPS_DEPTH_CHAIN_RECOVERY_WORK_DIR;
  process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClaw;
  process.env.TASKOPS_DEPTH_CHAIN_RECOVERY_WORK_DIR = workDir;

  const runResult = runTaskOps(workDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 5,
    maxStepsExplicit: true,
    timeout: 1,
  });

  assert.equal(runResult.stepsRun, 2);
  assert.equal(runResult.stopReason, 'blocked_only');
  assert.deepEqual(runResult.actions.map((action) => action.kind), ['decompose', 'decompose']);
  assert.deepEqual(runResult.actions.map((action) => action.status), ['completed', 'completed']);
  assert.equal(runResult.actions.every((action) => action.recoveredAfterAdapterFailure === true), true);
  assert.deepEqual(runResult.actions.map((action) => action.adapterStatus), ['timeout', 'timeout']);
  assert.deepEqual(runResult.actions.map((action) => action.recoveryStatus), ['recovered_after_timeout', 'recovered_after_timeout']);

  const events = readEvents(workDir, runResult.runId);
  assert.equal(countEvents(events, 'decomposition_recovered_after_adapter_failure'), 2);
  assert.equal(countEvents(events, 'snapshot_extended'), 2);
  assert.equal(countEvents(events, 'decomposition_failed'), 0);

  const parsed = parseProject(workDir);
  assert.deepEqual(parsed.errors, []);
  const activeSnapshot = parsed.snapshots.get(parsed.project.activeSnapshotId);
  const selected = new Map((activeSnapshot.selectedVersions || []).map((pair) => [pair.taskGroupId, pair.versionId]));
  assert.equal(selected.get('tg-root'), 'tgv-root-v2');
  assert.equal(selected.get('tg-root-open-depth'), 'tgv-root-open-depth-v1');
  assert.equal(selected.get('tg-open-grandchild-depth'), 'tgv-open-grandchild-depth-v1');

  const grandchildVersion = parsed.versions.get('tgv-open-grandchild-depth-v1');
  assert.ok(grandchildVersion);
  const grandchildTask = grandchildVersion.tasks.find((task) => task.id === 'task-grandchild-terminal-blocked');
  assert.ok(grandchildTask);
  const chain = ancestorChainForTask(parsed, grandchildTask, activeSnapshot);
  assert.equal(chain.length, 2);
  assert.deepEqual(chain.map((entry) => entry.taskId), ['task-open-grandchild-depth', 'task-root-open-depth']);
  assert.deepEqual(chain.map((entry) => entry.taskGroupVersionId), ['tgv-root-open-depth-v1', 'tgv-root-v2']);

  run(['validate', workDir]);
  run(['summary', workDir]);

  if (previousOpenClawBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
  else process.env.TASKOPS_OPENCLAW_BIN = previousOpenClawBin;
  if (previousWorkDir == null) delete process.env.TASKOPS_DEPTH_CHAIN_RECOVERY_WORK_DIR;
  else process.env.TASKOPS_DEPTH_CHAIN_RECOVERY_WORK_DIR = previousWorkDir;

  console.log('decomposition-depth-chain-recovery smoke passed');
} catch (err) {
  console.error(err);
  process.exit(1);
}
