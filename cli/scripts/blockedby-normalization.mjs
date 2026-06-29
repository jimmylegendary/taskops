#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { buildAgentDecompositionPrompt, recheckBlockedTasks, runTaskOps } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-blockedby-normalization-'));

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

function taskIdFor(id) {
  return `task-${id}`;
}

function childGroupIdFor(id) {
  return `tg-${id}`;
}

function childVersionIdFor(id) {
  return `tgv-${id}-v1`;
}

function childTaskPath(workDir, id, childTaskId, versionId = childVersionIdFor(id)) {
  return join(workDir, 'task-groups', childGroupIdFor(id), 'versions', versionId, 'tasks', `${childTaskId}.md`);
}

function makeWork(id) {
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Verify blockedBy normalization.', '--language', 'en']);
  const specPath = join(tempRoot, `${id}-root-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'blockedBy normalization root',
    selected: true,
    tasks: [{
      id: taskIdFor(id),
      title: 'blockedBy parent',
      objective: 'Decompose into blocked dependency fixture children.',
      responsibility: 'Exercise runner-owned blockedBy normalization.',
      completionCriteria: 'Child blockedBy refs are canonical and unblock correctly.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      expectedPlan: {
        expectedDepth: 2,
        expectedBreadth: 2,
        rationale: 'This fixture opens one child version with dependency-shaped children.',
      },
    }],
  }, null, 2), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function makeFakeOpenClaw() {
  const fakePath = join(tempRoot, 'fake-openclaw-blockedby.mjs');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.argv.includes('--version')) {
  console.log('openclaw fake blockedBy normalization');
  process.exit(0);
}

const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const workDir = process.env.TASKOPS_BLOCKEDBY_WORK_DIR;
const mode = process.env.TASKOPS_BLOCKEDBY_MODE || 'normal';
const cli = ${JSON.stringify(cli)};
if (!workDir) {
  console.error('missing TASKOPS_BLOCKEDBY_WORK_DIR');
  process.exit(2);
}
if (!/blockedBy as a list of structured refs/.test(prompt) || !/type: 'task'/.test(prompt)) {
  console.error('blockedBy prompt contract missing');
  process.exit(2);
}
const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
if (!childTaskGroupId || !versionId) {
  console.error('missing target ids in prompt');
  process.exit(2);
}

const now = '2026-06-29T00:00:00.000Z';
const groupDir = join(workDir, 'task-groups', childTaskGroupId);
mkdirSync(groupDir, { recursive: true });
writeFileSync(join(groupDir, 'index.md'), [
  '---',
  'taskOpsVersion: v1',
  'entityType: taskGroup',
  'id: ' + childTaskGroupId,
  'objective: blockedBy normalization child group',
  'createdAt: ' + now,
  'status: active',
  'activeVersionId: ' + versionId,
  '---',
  '# ' + childTaskGroupId,
  '',
].join('\\n'), 'utf8');

const blockedBy = mode === 'missing'
  ? ['task-missing-foundation']
  : ['task-foundation'];
const spec = {
  versionId,
  version: 'v1',
  summary: 'blockedBy normalization child version',
  tasks: [
    {
      id: 'task-foundation',
      title: 'Foundation task',
      objective: 'Complete prerequisite foundation work.',
      responsibility: 'Provide the dependency that blocked siblings wait for.',
      completionCriteria: 'Foundation work is complete.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      expectedPlan: {
        expectedDepth: 0,
        expectedBreadth: 0,
        rationale: 'Terminal prerequisite fixture task.'
      }
    },
    {
      id: 'task-api',
      title: 'Blocked API task',
      objective: 'Run after foundation is complete.',
      responsibility: 'Verify array-of-string blockedBy refs are canonicalized.',
      completionCriteria: 'Task unblocks after foundation finishes.',
      order: 2,
      status: 'pending',
      runReadiness: 'blocked',
      runReadinessReason: 'Worker-authored dependency uses the natural task id string form.',
      blockedBy,
      expectedPlan: {
        expectedDepth: 0,
        expectedBreadth: 0,
        rationale: 'Terminal blocked fixture task.'
      }
    }
  ]
};
const specPath = join(workDir, 'blockedby-child-spec-' + mode + '.json');
writeFileSync(specPath, JSON.stringify(spec, null, 2), 'utf8');
const result = spawnSync(process.execPath, [cli, 'decompose', workDir, '--task-group-id', childTaskGroupId, '--spec', specPath], { encoding: 'utf8' });
if (result.status !== 0) {
  console.error(result.stdout);
  console.error(result.stderr);
  process.exit(result.status || 1);
}
console.log(JSON.stringify({ result: { finalAssistantRawText: 'blockedBy fixture authored in mode ' + mode } }));
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function readEvents(workDir, runId) {
  const text = readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8').trim();
  if (!text) return [];
  return text.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

function runDecompose(workDir, id, mode) {
  process.env.TASKOPS_BLOCKEDBY_WORK_DIR = workDir;
  process.env.TASKOPS_BLOCKEDBY_MODE = mode;
  return runTaskOps(workDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 10,
    targetTaskId: taskIdFor(id),
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
}

try {
  const prompt = buildAgentDecompositionPrompt({
    project: { id: 'prompt-work', title: 'Prompt work', objective: 'Prompt contract' },
    projectDir: tempRoot,
    task: {
      id: 'task-parent',
      title: 'Parent',
      objective: 'Parent objective',
      responsibility: 'Parent responsibility',
      completionCriteria: 'Parent completion',
    },
    childTaskGroupId: 'tg-child',
    versionId: 'tgv-child-v1',
  });
  assert.match(prompt, /blockedBy as a list of structured refs/);
  assert.match(prompt, /type: 'task'/);
  assert.match(prompt, /taskGroupVersionId: 'tgv-child-v1'/);
  assert.match(prompt, /type: 'runNode'/);

  const fakeOpenClaw = makeFakeOpenClaw();
  const previousOpenClawBin = process.env.TASKOPS_OPENCLAW_BIN;
  const previousWorkDir = process.env.TASKOPS_BLOCKEDBY_WORK_DIR;
  const previousMode = process.env.TASKOPS_BLOCKEDBY_MODE;
  process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClaw;

  const normalId = 'blockedby-normal';
  const normalWorkDir = makeWork(normalId);
  const normalRun = runDecompose(normalWorkDir, normalId, 'normal');
  const normalAction = normalRun.actions[0];
  assert.equal(normalAction.status, 'completed');
  assert.equal(normalAction.blockedByNormalization.normalizedRefCount, 1);
  assert.equal(normalAction.blockedByNormalization.unresolvedCount, 0);

  const apiTask = parseMarkdownFile(childTaskPath(normalWorkDir, normalId, 'task-api'));
  assert.deepEqual(apiTask.blockedBy, [{
    type: 'task',
    id: 'task-foundation',
    taskGroupVersionId: childVersionIdFor(normalId),
  }]);
  assert.deepEqual(parseProject(normalWorkDir).errors, []);

  const foundationRun = runTaskOps(normalWorkDir, {
    executor: 'dry-run',
    maxSteps: 1,
    maxStepsExplicit: true,
    targetTaskId: 'task-foundation',
    targetTaskGroupVersionId: childVersionIdFor(normalId),
    allowConcurrentTarget: true,
  });
  assert.equal(foundationRun.actions[0].status, 'completed');

  const dryRecheck = recheckBlockedTasks(normalWorkDir, { dryRun: true });
  const checkedApi = dryRecheck.checked.find((item) => item.taskId === 'task-api');
  assert.equal(checkedApi.allResolved, true);
  assert.equal(checkedApi.blockers[0].key, `task:${childVersionIdFor(normalId)}:task-foundation`);
  assert.equal(checkedApi.blockers[0].resolved, true);
  assert.notEqual(checkedApi.blockers[0].key, 'invalid:blocker');

  const recheck = recheckBlockedTasks(normalWorkDir);
  assert.equal(recheck.unblocked.some((item) => item.taskId === 'task-api'), true);
  const unblockedApiTask = parseMarkdownFile(childTaskPath(normalWorkDir, normalId, 'task-api'));
  assert.equal(unblockedApiTask.status, 'pending');
  assert.equal(unblockedApiTask.runReadiness, 'runnable');
  assert.deepEqual(unblockedApiTask.blockedBy, apiTask.blockedBy);

  run(['restart', normalWorkDir, '--from', 'task-api', '--instruction', 'Verify canonical blockedBy survives restart.', '--reason', 'blockedby_preservation']);
  const restartedApiTask = parseMarkdownFile(childTaskPath(normalWorkDir, normalId, 'task-api', 'tgv-blockedby-normal-v2'));
  assert.deepEqual(restartedApiTask.blockedBy, apiTask.blockedBy);
  assert.deepEqual(parseProject(normalWorkDir).errors, []);

  const missingId = 'blockedby-missing';
  const missingWorkDir = makeWork(missingId);
  const missingRun = runDecompose(missingWorkDir, missingId, 'missing');
  const missingAction = missingRun.actions[0];
  assert.equal(missingAction.status, 'completed');
  assert.equal(missingAction.blockedByNormalization.normalizedRefCount, 0);
  assert.equal(missingAction.blockedByNormalization.unresolvedCount, 1);
  const missingApiTask = parseMarkdownFile(childTaskPath(missingWorkDir, missingId, 'task-api'));
  assert.equal(missingApiTask.blockedBy[0].type, 'unresolved');
  assert.equal(missingApiTask.blockedBy[0].id, 'task-missing-foundation');
  assert.match(missingApiTask.blockedBy[0].reason, /does not match any task id/);
  const missingEvents = readEvents(missingWorkDir, missingRun.runId);
  const unresolvedEvents = missingEvents.filter((event) => event.type === 'blockedby_normalization_unresolved');
  assert.equal(unresolvedEvents.length, 1);
  assert.equal(unresolvedEvents[0].summary.unresolvedCount, 1);
  assert.equal(unresolvedEvents[0].unresolvedRefs[0].taskId, 'task-api');
  assert.deepEqual(parseProject(missingWorkDir).errors, []);

  if (previousOpenClawBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
  else process.env.TASKOPS_OPENCLAW_BIN = previousOpenClawBin;
  if (previousWorkDir == null) delete process.env.TASKOPS_BLOCKEDBY_WORK_DIR;
  else process.env.TASKOPS_BLOCKEDBY_WORK_DIR = previousWorkDir;
  if (previousMode == null) delete process.env.TASKOPS_BLOCKEDBY_MODE;
  else process.env.TASKOPS_BLOCKEDBY_MODE = previousMode;

  console.log('blockedBy normalization smoke passed');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
