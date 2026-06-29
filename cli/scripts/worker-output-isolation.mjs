#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAgentExecutionPrompt, runTaskOps } from '../lib-runner.js';
import { parseMarkdownFile, parseProject } from '../lib-taskops.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const repoRoot = resolve(__dirname, '..', '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-worker-output-isolation-'));

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
  run(['init', workDir, '--id', 'worker-output-isolation', '--title', 'Worker output isolation', '--objective', 'Verify worker output cwd isolation.', '--language', 'en']);
  const specPath = join(tempRoot, 'root-spec.json');
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'worker output isolation root',
    selected: true,
    tasks: [
      {
        id: 'task-execute',
        title: 'Execute with relative artifact write',
        objective: 'Write a relative task artifact.',
        responsibility: 'Exercise execute worker cwd isolation.',
        completionCriteria: 'The relative artifact lands inside the task workspace.',
        order: 1,
        status: 'pending',
        runReadiness: 'runnable',
        uncertaintyState: 'known',
        confidenceScore: 0.8,
        knownList: [{ id: 'k-execute', claim: 'The execute task is terminal.', verificationStatus: 'unverified' }],
      },
      {
        id: 'task-decompose',
        title: 'Decompose with safe cwd',
        objective: 'Create a child decomposition.',
        responsibility: 'Exercise decomposition worker cwd isolation.',
        completionCriteria: 'A child task group is authored.',
        order: 2,
        status: 'pending',
        runReadiness: 'needs_decomposition',
        uncertaintyState: 'known_unknown',
        confidenceScore: 0.7,
        knownList: [{ id: 'k-decompose', claim: 'A child task group is needed.', verificationStatus: 'unverified' }],
        expectedPlan: { expectedDepth: 1, expectedBreadth: 1, rationale: 'Fixture decomposition task.' },
      },
      {
        id: 'task-explore',
        title: 'Explore with absolute artifact path',
        objective: 'Write an exploration artifact.',
        responsibility: 'Exercise exploration worker cwd isolation.',
        completionCriteria: 'Exploration artifact is recorded.',
        order: 3,
        status: 'pending',
        runReadiness: 'needs_exploration',
        runReadinessReason: 'Exploration fixture.',
        uncertaintyState: 'unknown_unknown',
        confidenceScore: 0.2,
        unknowns: ['where an exploration relative file lands'],
        nextLearningGoal: 'Confirm artifact cwd isolation.',
        expectedPlan: { expectedDepth: 1, expectedBreadth: 1, rationale: 'Fixture exploration task.' },
      },
    ],
  }, null, 2), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function fakeOpenClawPath(logPath) {
  const fakePath = join(tempRoot, 'fake-openclaw-worker-output.mjs');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.argv.includes('--version')) {
  console.log('openclaw fake worker output isolation');
  process.exit(0);
}

const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const cwd = process.cwd();
let kind = 'unknown';
if (/TaskOps decomposition agent/.test(prompt)) kind = 'decompose';
else if (/TaskOps exploration agent/.test(prompt)) kind = 'explore';
else if (/TaskOps loopback resolution agent/.test(prompt)) kind = 'loopback';
else if (/TaskOps worker agent/.test(prompt)) kind = 'execute';
writeFileSync(join(cwd, kind + '-relative.txt'), 'relative artifact from ' + kind + '\\n', 'utf8');
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ kind, cwd, hasWorkspaceLine: /Task artifact workspace: /.test(prompt) }) + '\\n', 'utf8');

if (kind === 'execute') {
  const workspace = (prompt.match(/Task artifact workspace: ([^\\n]+)/) || [])[1]?.trim();
  if (!workspace || workspace !== cwd) {
    console.error('execute workspace prompt/cwd mismatch: ' + workspace + ' !== ' + cwd);
    process.exit(2);
  }
  console.log(JSON.stringify({ result: { finalAssistantRawText: 'execute wrote relative artifact in workspace' } }));
  process.exit(0);
}

if (kind === 'explore') {
  const artifactPath = (prompt.match(/Write the exploration artifact at: ([^\\n]+)/) || [])[1]?.trim();
  if (!artifactPath) {
    console.error('missing exploration artifact path');
    process.exit(2);
  }
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, '# Exploration artifact\\n\\n- cwd: ' + cwd + '\\n', 'utf8');
  console.log(JSON.stringify({ result: { finalAssistantRawText: 'exploration artifact written' } }));
  process.exit(0);
}

if (kind === 'loopback') {
  const artifactPath = (prompt.match(/Write the loopback resolution artifact at: ([^\\n]+)/) || [])[1]?.trim();
  if (!artifactPath) {
    console.error('missing loopback artifact path');
    process.exit(2);
  }
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, '# Loopback artifact\\n\\n- cwd: ' + cwd + '\\n', 'utf8');
  console.log(JSON.stringify({ result: { finalAssistantRawText: 'loopback artifact written' } }));
  process.exit(0);
}

if (kind === 'decompose') {
  const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
  const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
  if (!childTaskGroupId || !versionId) {
    console.error('missing child ids');
    process.exit(2);
  }
  const now = '2026-06-29T00:00:00.000Z';
  const groupDir = join(cwd, 'task-groups', childTaskGroupId);
  mkdirSync(groupDir, { recursive: true });
  writeFileSync(join(groupDir, 'index.md'), [
    '---',
    'taskOpsVersion: v1',
    'entityType: taskGroup',
    'id: ' + childTaskGroupId,
    'objective: worker output isolation child group',
    'createdAt: ' + now,
    'status: active',
    'activeVersionId: ' + versionId,
    '---',
    '# ' + childTaskGroupId,
    '',
  ].join('\\n'), 'utf8');
  const spec = {
    versionId,
    version: 'v1',
    summary: 'worker output isolation child version',
    tasks: [{
      id: 'task-child-terminal',
      title: 'Child terminal',
      objective: 'Remain blocked so this fixture does not need to execute.',
      responsibility: 'Exercise decomposition output only.',
      completionCriteria: 'Child task is present.',
      order: 1,
      status: 'pending',
      runReadiness: 'blocked',
      runReadinessReason: 'Fixture child intentionally blocked.',
      expectedPlan: {
        expectedDepth: 0,
        expectedBreadth: 0,
        rationale: 'Terminal fixture child.'
      }
    }]
  };
  const specPath = join(cwd, 'worker-output-child-spec.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2), 'utf8');
  const result = spawnSync(process.execPath, [${JSON.stringify(cli)}, 'decompose', cwd, '--task-group-id', childTaskGroupId, '--spec', specPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(result.status || 1);
  }
  console.log(JSON.stringify({ result: { finalAssistantRawText: 'decomposition authored from safe cwd' } }));
  process.exit(0);
}

console.error('unknown prompt kind');
process.exit(2);
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function readLog(logPath) {
  return readFileSync(logPath, 'utf8').trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

function addSelfDelegate(workDir) {
  const nodesDir = join(workDir, 'runs', 'run-main', 'nodes');
  mkdirSync(nodesDir, { recursive: true });
  writeFileSync(join(nodesDir, 'run-node-self-delegate.md'), `---
taskOpsVersion: v1
entityType: runNode
id: run-node-self-delegate
runId: run-main
type: delegate
title: Self delegate
status: waiting
delegateeType: self
delegateeRef: self
request: Resolve a self delegation.
expectedOutput: Loopback artifact.
sourceTaskId: task-execute
sourceTaskGroupVersionId: tgv-root-v2
createdAt: 2026-06-29T00:00:00.000Z
---
# Self delegate
`, 'utf8');
}

try {
  const workDir = makeWork();
  const logPath = join(tempRoot, 'cwd-log.jsonl');
  const fakeOpenClaw = fakeOpenClawPath(logPath);
  const previousOpenClawBin = process.env.TASKOPS_OPENCLAW_BIN;
  process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClaw;

  const prompt = buildAgentExecutionPrompt({
    project: { id: 'prompt-work', title: 'Prompt work', objective: 'Prompt contract' },
    projectDir: workDir,
    task: {
      id: 'task-execute',
      title: 'Execute',
      objective: 'Execute objective',
      responsibility: 'Execute responsibility',
      completionCriteria: 'Execute completion.',
    },
    artifactWorkspacePath: join(workDir, 'runs', 'run-main', 'artifacts', 'run-node-task-execute', 'workspace'),
  });
  assert.match(prompt, /Task artifact workspace: /);
  assert.match(prompt, /Relative paths for new files must stay inside that workspace/);

  const executeRun = runTaskOps(workDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 10,
    targetTaskId: 'task-execute',
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
  assert.equal(executeRun.actions[0].status, 'completed');
  const executeWorkspace = join(workDir, 'runs', 'run-main', 'artifacts', 'run-node-task-execute', 'workspace');
  assert.equal(existsSync(join(executeWorkspace, 'execute-relative.txt')), true, 'execute relative write must land in task workspace');
  assert.equal(existsSync(join(repoRoot, 'execute-relative.txt')), false, 'execute relative write must not land in source repo cwd');
  assert.equal(executeRun.actions[0].executionWorkspacePath, executeWorkspace);
  const executeNode = parseMarkdownFile(join(workDir, 'runs', 'run-main', 'nodes', 'run-node-task-execute.md'));
  assert.equal(executeNode.result.executionWorkspacePath, executeWorkspace);
  assert.equal(executeNode.result.observed.artifactRefs.includes(executeWorkspace), true);
  assert.equal(executeNode.result.observed.evidenceRefs.includes(executeWorkspace), true);

  const decomposeRun = runTaskOps(workDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 10,
    targetTaskId: 'task-decompose',
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
  assert.equal(decomposeRun.actions[0].status, 'completed');
  assert.equal(existsSync(join(workDir, 'decompose-relative.txt')), true, 'decompose relative scratch must land in TaskOps work dir');
  assert.equal(existsSync(join(repoRoot, 'decompose-relative.txt')), false, 'decompose relative scratch must not land in source repo cwd');

  const exploreRun = runTaskOps(workDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 10,
    targetTaskId: 'task-explore',
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
  assert.equal(exploreRun.actions[0].status, 'completed');
  const artifactsDir = join(workDir, 'runs', 'run-main', 'artifacts');
  assert.equal(existsSync(join(artifactsDir, 'explore-relative.txt')), true, 'explore relative scratch must land in run artifacts dir');
  assert.equal(existsSync(join(repoRoot, 'explore-relative.txt')), false, 'explore relative scratch must not land in source repo cwd');

  addSelfDelegate(workDir);
  const loopbackRun = runTaskOps(workDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 10,
    loopback: 'self',
    maxLoopbacks: 1,
  });
  assert.equal(loopbackRun.actions[0].status, 'completed');
  assert.equal(existsSync(join(artifactsDir, 'loopback-relative.txt')), true, 'loopback relative scratch must land in run artifacts dir');
  assert.equal(existsSync(join(repoRoot, 'loopback-relative.txt')), false, 'loopback relative scratch must not land in source repo cwd');

  const log = readLog(logPath);
  const byKind = Object.fromEntries(log.map((entry) => [entry.kind, entry.cwd]));
  assert.equal(byKind.execute, executeWorkspace);
  assert.equal(byKind.decompose, workDir);
  assert.equal(byKind.explore, artifactsDir);
  assert.equal(byKind.loopback, artifactsDir);
  assert.equal(log.find((entry) => entry.kind === 'execute')?.hasWorkspaceLine, true);
  assert.deepEqual(parseProject(workDir).errors, []);

  if (previousOpenClawBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
  else process.env.TASKOPS_OPENCLAW_BIN = previousOpenClawBin;

  console.log('worker output isolation smoke passed');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
