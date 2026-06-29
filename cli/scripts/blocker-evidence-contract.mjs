#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile, parseProject } from '../lib-taskops.js';
import {
  buildAgentDecompositionPrompt,
  computeNextAction,
  explainWork,
  recheckBlockedTasks,
  runTaskOps,
} from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-blocker-evidence-contract-'));

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== (options.expectStatus ?? 0)) {
    throw new Error(`taskops ${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function initWork(id, tasks) {
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', `Blocker evidence contract fixture ${id}`, '--language', 'en']);
  const specPath = join(tempRoot, `${id}-root-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: `${id} root fixture`,
    selected: true,
    tasks,
  }, null, 2), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function baseTask(id, overrides = {}) {
  return {
    id,
    title: id,
    objective: `Objective for ${id}.`,
    responsibility: `Responsibility for ${id}.`,
    completionCriteria: `Completion criteria for ${id}.`,
    order: 1,
    status: 'pending',
    runReadiness: 'runnable',
    expectedPlan: {
      expectedDepth: 0,
      expectedBreadth: 0,
      rationale: 'Terminal fixture task.',
    },
    ...overrides,
  };
}

function readEvents(workDir, runId = 'run-main') {
  const path = join(workDir, 'runs', runId, 'events.jsonl');
  const text = readFileSync(path, 'utf8').trim();
  return text ? text.split(/\n+/).map((line) => JSON.parse(line)) : [];
}

function childPath(workDir, fixtureId, childTaskId, versionId = `tgv-${fixtureId}-v1`) {
  return join(workDir, 'task-groups', `tg-${fixtureId}`, 'versions', versionId, 'tasks', `${childTaskId}.md`);
}

function makeFakeOpenClaw() {
  const fakePath = join(tempRoot, 'fake-openclaw-blocker-evidence.mjs');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.argv.includes('--version')) {
  console.log('openclaw fake blocker evidence');
  process.exit(0);
}

const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
if (!/Available blocker refs from the active snapshot/.test(prompt) || !/terminal descendant/.test(prompt)) {
  console.error('missing active blocker catalog guidance');
  process.exit(2);
}
const workDir = process.env.TASKOPS_BLOCKER_EVIDENCE_WORK_DIR;
const mode = process.env.TASKOPS_BLOCKER_EVIDENCE_MODE || 'scalar';
const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
if (!workDir || !childTaskGroupId || !versionId) {
  console.error('missing workDir or target ids');
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
  'objective: blocker evidence child group',
  'createdAt: ' + now,
  'status: active',
  'activeVersionId: ' + versionId,
  '---',
  '# ' + childTaskGroupId,
  '',
].join('\\n'), 'utf8');
const blockedBy = mode === 'unresolved-object'
  ? [{ type: 'task', id: 'task-missing', taskGroupVersionId: versionId }]
  : 'task-foundation';
const spec = {
  versionId,
  version: 'v1',
  summary: 'blocker evidence child version',
  tasks: [
    {
      id: 'task-foundation',
      title: 'Foundation task',
      objective: 'Complete prerequisite work.',
      responsibility: 'Provide dependency evidence.',
      completionCriteria: 'Foundation task is done.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      expectedPlan: { expectedDepth: 0, expectedBreadth: 0, rationale: 'Terminal prerequisite.' }
    },
    {
      id: 'task-dependent',
      title: 'Dependent task',
      objective: 'Wait for foundation.',
      responsibility: 'Exercise blockedBy contract.',
      completionCriteria: 'Dependent task unblocks only after foundation.',
      order: 2,
      status: 'pending',
      runReadiness: 'blocked',
      runReadinessReason: 'Worker-authored dependency.',
      blockedBy,
      expectedPlan: { expectedDepth: 0, expectedBreadth: 0, rationale: 'Terminal dependent.' }
    }
  ]
};
const specPath = join(workDir, 'blocker-evidence-child-' + mode + '.json');
writeFileSync(specPath, JSON.stringify(spec, null, 2), 'utf8');
const result = spawnSync(process.execPath, [${JSON.stringify(cli)}, 'decompose', workDir, '--task-group-id', childTaskGroupId, '--spec', specPath], { encoding: 'utf8' });
if (result.status !== 0) {
  console.error(result.stdout);
  console.error(result.stderr);
  process.exit(result.status || 1);
}
console.log(JSON.stringify({ result: { finalAssistantRawText: 'blocker evidence fixture authored' } }));
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

try {
  const missingWorkDir = initWork('missing-blocker', [
    baseTask('task-missing-blocker', {
      status: 'pending',
      runReadiness: 'blocked',
      runReadinessReason: 'Blocked on prose-only upstream dependency.',
    }),
  ]);
  const missingParsed = parseProject(missingWorkDir);
  assert.equal(missingParsed.closure.openBlockerCount, 1);
  assert.ok(missingParsed.warnings.some((warning) => /no blockedBy or explicit manual\/external blocker marker/.test(warning)));
  const missingRun = runTaskOps(missingWorkDir, { executor: 'dry-run', maxSteps: 1, maxStepsExplicit: true });
  assert.equal(missingRun.stopReason, 'blocked_only');
  const missingEvents = readEvents(missingWorkDir, missingRun.runId);
  assert.equal(missingEvents.some((event) => event.type === 'blockedby_missing_for_blocked_task'), true);
  const missingExplain = explainWork(missingWorkDir);
  assert.match(missingExplain.openReasons.join('\n'), /blocked task\(s\) or run node\(s\)/);

  const gateWorkDir = initWork('selection-gate', [
    baseTask('task-dependent', {
      order: 1,
      runReadiness: 'needs_decomposition',
      blockedBy: [{ type: 'task', id: 'task-prereq', taskGroupVersionId: 'tgv-root-v2' }],
    }),
    baseTask('task-prereq', {
      order: 2,
      runReadiness: 'runnable',
    }),
  ]);
  const beforeNext = computeNextAction(gateWorkDir);
  assert.equal(beforeNext.action, 'execute');
  assert.equal(beforeNext.target.id, 'task-prereq');
  const dryRecheck = recheckBlockedTasks(gateWorkDir, { dryRun: true });
  const gated = dryRecheck.stillBlocked.find((item) => item.taskId === 'task-dependent');
  assert.equal(gated.allResolved, false);
  assert.equal(gated.blockers[0].key, 'task:tgv-root-v2:task-prereq');

  runTaskOps(gateWorkDir, {
    executor: 'dry-run',
    maxSteps: 1,
    maxStepsExplicit: true,
    targetTaskId: 'task-prereq',
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
  const afterNext = computeNextAction(gateWorkDir);
  assert.equal(afterNext.action, 'decompose');
  assert.equal(afterNext.target.id, 'task-dependent');

  const prompt = buildAgentDecompositionPrompt({
    project: { id: 'prompt-work', title: 'Prompt work', objective: 'Prompt objective' },
    projectDir: tempRoot,
    task: baseTask('task-parent', { title: 'Parent task', runReadiness: 'needs_decomposition' }),
    childTaskGroupId: 'tg-child',
    versionId: 'tgv-child-v1',
    blockerCatalog: [{
      id: 'task-storage-terminal',
      taskGroupVersionId: 'tgv-storage-v1',
      status: 'done',
      runReadiness: 'runnable',
      terminal: true,
      decomposed: false,
    }],
  });
  assert.match(prompt, /Available blocker refs from the active snapshot/);
  assert.match(prompt, /task-storage-terminal/);
  assert.match(prompt, /terminal descendant/);

  const fakeOpenClaw = makeFakeOpenClaw();
  const previousOpenClawBin = process.env.TASKOPS_OPENCLAW_BIN;
  const previousWorkDir = process.env.TASKOPS_BLOCKER_EVIDENCE_WORK_DIR;
  const previousMode = process.env.TASKOPS_BLOCKER_EVIDENCE_MODE;
  process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClaw;

  const scalarFixtureId = 'scalar-blockedby';
  const scalarWorkDir = initWork(scalarFixtureId, [
    baseTask(`task-${scalarFixtureId}`, {
      runReadiness: 'needs_decomposition',
      expectedPlan: { expectedDepth: 1, expectedBreadth: 2, rationale: 'Open a child dependency fixture.' },
    }),
    baseTask('task-catalog-source', { order: 2, status: 'done', runReadiness: 'runnable' }),
  ]);
  process.env.TASKOPS_BLOCKER_EVIDENCE_WORK_DIR = scalarWorkDir;
  process.env.TASKOPS_BLOCKER_EVIDENCE_MODE = 'scalar';
  const scalarRun = runTaskOps(scalarWorkDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    targetTaskId: `task-${scalarFixtureId}`,
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
  assert.equal(scalarRun.actions[0].status, 'completed');
  const scalarDependent = parseMarkdownFile(childPath(scalarWorkDir, scalarFixtureId, 'task-dependent'));
  assert.deepEqual(scalarDependent.blockedBy, [{ type: 'task', id: 'task-foundation', taskGroupVersionId: `tgv-${scalarFixtureId}-v1` }]);
  runTaskOps(scalarWorkDir, {
    executor: 'dry-run',
    maxSteps: 1,
    maxStepsExplicit: true,
    targetTaskId: 'task-foundation',
    targetTaskGroupVersionId: `tgv-${scalarFixtureId}-v1`,
    allowConcurrentTarget: true,
  });
  const scalarUnblock = recheckBlockedTasks(scalarWorkDir);
  assert.equal(scalarUnblock.unblocked.some((item) => item.taskId === 'task-dependent'), true);

  const unresolvedFixtureId = 'object-unresolved';
  const unresolvedWorkDir = initWork(unresolvedFixtureId, [
    baseTask(`task-${unresolvedFixtureId}`, {
      runReadiness: 'needs_decomposition',
      expectedPlan: { expectedDepth: 1, expectedBreadth: 2, rationale: 'Open an unresolved blocker fixture.' },
    }),
    baseTask('task-catalog-source', { order: 2, status: 'done', runReadiness: 'runnable' }),
  ]);
  process.env.TASKOPS_BLOCKER_EVIDENCE_WORK_DIR = unresolvedWorkDir;
  process.env.TASKOPS_BLOCKER_EVIDENCE_MODE = 'unresolved-object';
  const unresolvedRun = runTaskOps(unresolvedWorkDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    targetTaskId: `task-${unresolvedFixtureId}`,
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
  assert.equal(unresolvedRun.actions[0].blockedByNormalization.unresolvedCount, 1);
  const unresolvedDependent = parseMarkdownFile(childPath(unresolvedWorkDir, unresolvedFixtureId, 'task-dependent'));
  assert.equal(unresolvedDependent.blockedBy[0].type, 'unresolved');
  const unresolvedEvents = readEvents(unresolvedWorkDir, unresolvedRun.runId);
  assert.equal(unresolvedEvents.some((event) => event.type === 'blockedby_normalization_unresolved'), true);
  assert.deepEqual(parseProject(unresolvedWorkDir).errors, []);

  if (previousOpenClawBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
  else process.env.TASKOPS_OPENCLAW_BIN = previousOpenClawBin;
  if (previousWorkDir == null) delete process.env.TASKOPS_BLOCKER_EVIDENCE_WORK_DIR;
  else process.env.TASKOPS_BLOCKER_EVIDENCE_WORK_DIR = previousWorkDir;
  if (previousMode == null) delete process.env.TASKOPS_BLOCKER_EVIDENCE_MODE;
  else process.env.TASKOPS_BLOCKER_EVIDENCE_MODE = previousMode;

  console.log('blocker evidence contract smoke passed');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
