#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initProject,
  parseMarkdownFile,
  parseProject,
  writeVersionFromSpec,
} from '../lib-taskops.js';
import {
  runTaskOps,
} from '../lib-runner.js';

const FIXED_TIME = '2026-07-02T00:00:00.000Z';
const ASSUMPTION_SUMMARY = 'ASSUMPTION: <x> -> DECISION: <y> -> BASIS: <z>';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(scriptDir, '..');
const binPath = resolve(cliDir, 'bin', 'taskops.js');

function withFrozenTime(iso, fn) {
  const RealDate = globalThis.Date;
  const fixedMs = new RealDate(iso).getTime();
  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [iso] : args));
    }

    static now() {
      return fixedMs;
    }
  }
  globalThis.Date = FrozenDate;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

function pointRootSnapshotAt(root, versionId) {
  const snapshotPath = join(root, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', `versionId: ${versionId}`), 'utf8');
}

function createWorkWithTask({ tempPrefix, id, title, objective, task }) {
  const root = mkdtempSync(join(tmpdir(), tempPrefix));
  initProject(root, { id, title, objective });
  writeVersionFromSpec(root, 'tg-root', {
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: `${title} v2 fixture`,
    selected: true,
    tasks: [task],
  });
  pointRootSnapshotAt(root, 'tgv-root-v2');
  return root;
}

function createDecomposeWork() {
  return createWorkWithTask({
    tempPrefix: 'taskops-e2e-self-decompose-',
    id: 'work-e2e-self-decompose',
    title: 'E2E Self Decompose',
    objective: 'Validate delegation-mode self-resolution child stamping.',
    task: {
      id: 'task-self-decompose',
      title: 'Self decompose task',
      objective: 'Create deterministic runnable children.',
      responsibility: 'Own the decomposition pipeline proof.',
      completionCriteria: 'The generated child version carries the expected self-resolution metadata.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_decomposition',
    },
  });
}

function createExecuteWork() {
  return createWorkWithTask({
    tempPrefix: 'taskops-e2e-self-execute-',
    id: 'work-e2e-self-execute',
    title: 'E2E Self Execute',
    objective: 'Validate delegation-mode self-resolution execution products.',
    task: {
      id: 'task-self-execute',
      title: 'Self execute task',
      objective: 'Complete with an explicit assumption-bearing decision summary.',
      responsibility: 'Own the deterministic fake executor proof.',
      completionCriteria: 'The persisted run summary contains the assumption, decision, and basis.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
    },
  });
}

function taskPath(root, versionId, taskId) {
  return join(root, 'task-groups', 'tg-root', 'versions', versionId, 'tasks', `${taskId}.md`);
}

function childTaskPaths(root, childTaskGroupId, versionId) {
  const tasksDir = join(root, 'task-groups', childTaskGroupId, 'versions', versionId, 'tasks');
  assert.ok(existsSync(tasksDir), `child tasks dir should exist: ${tasksDir}`);
  return readdirSync(tasksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md')
    .map((entry) => join(tasksDir, entry.name))
    .sort();
}

function assertParseClean(root, label) {
  assert.deepEqual(parseProject(root).errors, [], label);
}

function runDecomposePipeline({ delegate }) {
  const root = withFrozenTime(FIXED_TIME, () => createDecomposeWork());
  const priorClaudeBin = process.env.TASKOPS_CLAUDE_BIN;
  process.env.TASKOPS_CLAUDE_BIN = fakeClaudeDecompose();
  let runResult;
  try {
    runResult = withFrozenTime(FIXED_TIME, () => runTaskOps(root, {
      executor: 'claude-code',
      delegate,
      maxSteps: 1,
      maxStepsExplicit: true,
    }));
  } finally {
    if (priorClaudeBin == null) delete process.env.TASKOPS_CLAUDE_BIN;
    else process.env.TASKOPS_CLAUDE_BIN = priorClaudeBin;
  }
  assert.equal(runResult.stepsRun, 1, 'decompose pipeline should run exactly one step');
  assert.equal(runResult.actions[0]?.kind, 'decompose', 'decompose pipeline should select the decomposition action');
  assert.equal(runResult.actions[0]?.status, 'completed', 'decompose pipeline should complete');
  return { root, runResult, action: runResult.actions[0] };
}

function fakeClaudeCode({ logPath }) {
  const fakePath = join(mkdtempSync(join(tmpdir(), 'taskops-e2e-fake-claude-')), 'claude');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

if (process.argv.includes('--version')) {
  console.log('claude fake e2e-self-resolution-pipeline');
  process.exit(0);
}

const prompt = process.argv[process.argv.length - 1] || '';
appendFileSync(${JSON.stringify(logPath)}, prompt + '\\n---TASKOPS-PROMPT-END---\\n', 'utf8');
console.log(${JSON.stringify(ASSUMPTION_SUMMARY)});
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function fakeClaudeDecompose() {
  const fakePath = join(mkdtempSync(join(tmpdir(), 'taskops-e2e-fake-decompose-')), 'claude');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.argv.includes('--version')) {
  console.log('claude fake e2e-self-resolution-decompose');
  process.exit(0);
}

const prompt = process.argv[process.argv.length - 1] || '';
const childTaskGroupId = /Target child task group id: ([^\\n]+)/.exec(prompt)?.[1]?.trim();
const versionId = /Target version id: ([^\\n]+)/.exec(prompt)?.[1]?.trim();
if (!childTaskGroupId || !versionId) {
  console.error('missing target child task group or version id in prompt');
  process.exit(2);
}

const now = ${JSON.stringify(FIXED_TIME)};
const suffix = childTaskGroupId.replace(/^tg-/, '') || 'child';
const taskGroupDir = join(process.cwd(), 'task-groups', childTaskGroupId);
mkdirSync(taskGroupDir, { recursive: true });
writeFileSync(join(taskGroupDir, 'index.md'), [
  '---',
  'taskOpsVersion: v1',
  'entityType: taskGroup',
  \`id: \${childTaskGroupId}\`,
  'objective: Deterministic fake decomposition for self-resolution e2e.',
  \`activeVersionId: \${versionId}\`,
  \`createdAt: \${now}\`,
  'status: active',
  '---',
  '# Fake child task group',
  '',
].join('\\n'), 'utf8');

const spec = {
  versionId,
  version: 'v1',
  summary: 'Deterministic runnable child tasks for self-resolution e2e',
  tasks: [
    {
      id: \`task-\${suffix}-child-a\`,
      title: 'Runnable self child A',
      objective: 'Complete deterministic child responsibility A.',
      responsibility: 'Own deterministic child responsibility A.',
      completionCriteria: 'Child A is available for self-resolution execution.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
    },
    {
      id: \`task-\${suffix}-child-b\`,
      title: 'Runnable self child B',
      objective: 'Complete deterministic child responsibility B.',
      responsibility: 'Own deterministic child responsibility B.',
      completionCriteria: 'Child B is available for self-resolution execution.',
      order: 2,
      status: 'pending',
      runReadiness: 'runnable',
    },
  ],
};
const specPath = join(mkdtempSync(join(tmpdir(), 'taskops-e2e-decompose-spec-')), 'spec.json');
writeFileSync(specPath, JSON.stringify(spec, null, 2), 'utf8');
const result = spawnSync(process.execPath, [
  ${JSON.stringify(binPath)},
  'decompose',
  process.cwd(),
  '--task-group-id',
  childTaskGroupId,
  '--spec',
  specPath,
], { encoding: 'utf8' });
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'taskops decompose failed');
  process.exit(result.status || 1);
}
process.stdout.write(result.stdout || \`fake decompose authored \${childTaskGroupId}/\${versionId}\`);
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function markdownFiles(root) {
  const files = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
    }
  }
  visit(root);
  return files.sort();
}

function assertNoBlockedOrWaitingTasks(root) {
  const parsed = parseProject(root);
  for (const task of parsed.tasks.values()) {
    assert.notEqual(task.status, 'blocked', `task ${task.id} should not end status:blocked`);
    assert.notEqual(task.status, 'waiting', `task ${task.id} should not end status:waiting`);
    assert.notEqual(task.runReadiness, 'blocked', `task ${task.id} should not end runReadiness:blocked`);
  }
  for (const runNode of parsed.runNodes.values()) {
    assert.notEqual(runNode.status, 'blocked', `run node ${runNode.id} should not end status:blocked`);
    assert.notEqual(runNode.status, 'waiting', `run node ${runNode.id} should not be parked waiting`);
    assert.notEqual(runNode.type, 'delegate', `run node ${runNode.id} should not be a delegation node`);
  }
}

{
  const delegated = runDecomposePipeline({ delegate: true });
  const { childTaskGroupId, versionId } = delegated.action;
  const delegatedChildPaths = childTaskPaths(delegated.root, childTaskGroupId, versionId);
  assert.ok(delegatedChildPaths.length > 0, 'fake decompose should create at least one child task');
  assert.deepEqual(
    delegated.action.selfResolverStamp,
    { taskCount: delegatedChildPaths.length, stampedCount: delegatedChildPaths.length },
    'delegation-mode decompose should report a self resolver stamp for every child',
  );
  for (const childPath of delegatedChildPaths) {
    const child = parseMarkdownFile(childPath);
    assert.equal(child.resolverKind, 'self', `${childPath} should be stamped resolverKind:self`);
    assert.notEqual(child.status, 'blocked', `${childPath} should not be status:blocked`);
    assert.notEqual(child.status, 'waiting', `${childPath} should not be status:waiting`);
    assert.notEqual(child.runReadiness, 'blocked', `${childPath} should not be runReadiness:blocked`);
    assert.equal(child.runReadiness, 'runnable', `${childPath} should remain a normal runnable child`);
  }
  const parent = parseMarkdownFile(taskPath(delegated.root, 'tgv-root-v2', 'task-self-decompose'));
  assert.notEqual(parent.status, 'blocked', 'decomposed parent must not be status:blocked');
  assert.notEqual(parent.runReadiness, 'blocked', 'decomposed parent must not be runReadiness:blocked');
  assertNoBlockedOrWaitingTasks(delegated.root);
  assertParseClean(delegated.root, 'delegation-mode decompose output should validate');

  const off = runDecomposePipeline({ delegate: false });
  assert.equal(off.action.selfResolverStamp, undefined, 'delegate:false decompose should not report a self resolver stamp');
  const offChildPaths = childTaskPaths(off.root, off.action.childTaskGroupId, off.action.versionId);
  assert.equal(offChildPaths.length, delegatedChildPaths.length, 'delegate:false fake decompose should create the same child task count');
  for (const childPath of offChildPaths) {
    const child = parseMarkdownFile(childPath);
    assert.equal(child.resolverKind, undefined, `${childPath} should not gain resolverKind without delegation`);
    assert.equal(child.runReadiness, 'runnable', `${childPath} should remain runnable without delegation`);
  }
  assertNoBlockedOrWaitingTasks(off.root);
  assertParseClean(off.root, 'delegate:false decompose output should validate');
}

{
  const root = withFrozenTime(FIXED_TIME, () => createExecuteWork());
  const promptLogPath = join(root, 'captured-prompts.log');
  const priorClaudeBin = process.env.TASKOPS_CLAUDE_BIN;
  process.env.TASKOPS_CLAUDE_BIN = fakeClaudeCode({ logPath: promptLogPath });
  let runResult;
  try {
    runResult = withFrozenTime(FIXED_TIME, () => runTaskOps(root, {
      executor: 'claude-code',
      delegate: true,
      maxSteps: 1,
      maxStepsExplicit: true,
    }));
  } finally {
    if (priorClaudeBin == null) delete process.env.TASKOPS_CLAUDE_BIN;
    else process.env.TASKOPS_CLAUDE_BIN = priorClaudeBin;
  }

  assert.equal(runResult.stepsRun, 1, 'execute pipeline should run exactly one step');
  assert.equal(runResult.actions[0]?.kind, 'execute', 'execute pipeline should select the execute action');
  assert.equal(runResult.actions[0]?.status, 'completed', 'fake executor task should complete');
  const task = parseMarkdownFile(taskPath(root, 'tgv-root-v2', 'task-self-execute'));
  assert.equal(task.status, 'done', 'execute task should advance to done');
  assertNoBlockedOrWaitingTasks(root);
  assertParseClean(root, 'execute output should validate');

  const runNodePath = join(root, 'runs', 'run-main', 'nodes', `${runResult.actions[0].runNodeId}.md`);
  assert.ok(readFileSync(runNodePath, 'utf8').includes(ASSUMPTION_SUMMARY), 'persisted run node summary should contain the assumption decision basis string');
  assert.ok(
    markdownFiles(root).some((path) => readFileSync(path, 'utf8').includes(ASSUMPTION_SUMMARY)),
    'committed markdown products should contain the assumption decision basis string',
  );

  const capturedPrompt = readFileSync(promptLogPath, 'utf8');
  assert.ok(capturedPrompt.includes('<self_resolution_mode>'), 'delegation execute prompt should carry the self-resolution guide');
}

console.log('OK e2e self-resolution pipeline');
