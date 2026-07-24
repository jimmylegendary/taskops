#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { pickNextAction, runTaskOps } from '../lib-runner.js';
import { normalizeExecutorSpec } from '../lib-runtime-adapters.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-prototype-state-'));
const fakeOpenClawSource = `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('--version')) {
  console.log('fake-openclaw 1.0');
  process.exit(0);
}
const mode = process.env.TASKOPS_PROTOTYPE_FIXTURE_MODE || 'valid';
const target = join(process.cwd(), 'options.md');
if (mode === 'valid') writeFileSync(target, '# Options\\n\\n- Option A\\n- Option B\\n', 'utf8');
if (mode === 'empty') writeFileSync(target, ' \\n', 'utf8');
if (mode === 'invalid-utf8') writeFileSync(target, Buffer.from([0xff, 0xfe]));
if (mode === 'directory') mkdirSync(target, { recursive: true });
console.log('prototype fixture complete');
`;
const fakeOpenClawPath = join(tempRoot, 'fake-openclaw.mjs');
writeFileSync(fakeOpenClawPath, fakeOpenClawSource, 'utf8');
chmodSync(fakeOpenClawPath, 0o755);

assert.deepEqual(normalizeExecutorSpec('openclaw-agent'), {
  adapterName: 'openclaw-cli',
  variant: null,
});
assert.deepEqual(normalizeExecutorSpec('codex-cli:high'), {
  adapterName: 'codex-cli',
  variant: 'high',
});

function writeMd(path, fm) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fmBlock(fm) + `# ${fm.id}\n`, 'utf8');
}

function seedPrototypeWork(tempRoot, id) {
  const workDir = join(tempRoot, id);
  const now = '2026-07-25T00:00:00.000Z';
  const versionDir = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1');
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id,
    title: id,
    objective: 'Choose a prototype before bounded execution.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'task-groups', 'tg-root', 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Choose and execute one option.',
    activeVersionId: 'tgv-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(versionDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    version: 'v1',
    summary: 'Unknown-known prototype fixture.',
    selected: true,
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'snapshots', 'snapshot-root-v1.md'), {
    taskOpsVersion: 'v1',
    entityType: 'versionSnapshot',
    id: 'snapshot-root-v1',
    rootTaskGroupId: 'tg-root',
    createdAt: now,
    label: 'Root',
    status: 'active',
    selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }],
  });
  const taskPath = join(versionDir, 'tasks', 'prototype.md');
  writeMd(taskPath, {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'prototype',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Choose the dashboard form',
    objective: 'Deliver the selected dashboard form.',
    responsibility: 'Own option generation and the selected result.',
    completionCriteria: 'The selected option passes its deterministic check.',
    order: 1,
    createdAt: now,
    status: 'pending',
    runReadiness: 'runnable',
    understandingLevel: 'known',
    uncertaintyState: 'unknown_known',
    confidenceScore: 0.5,
    knownList: [{
      id: 'k-local',
      claim: 'A local unverified assumption.',
      verificationStatus: 'unverified',
    }],
    unknownKnowns: ['visual form', 'metric density'],
    inheritedFrom: {
      schemaVersion: 'v1',
      inheritedKnownRefs: [{
        id: 'ik-1',
        sourceTaskId: 'parent',
        sourceTaskGroupVersionId: 'tgv-parent-v1',
        sourceKnownId: 'k-parent',
        trust: 'inherited_unverified',
      }],
    },
    expectedPlan: {
      expectedDepth: 0,
      expectedBreadth: 1,
      rationale: 'The post-selection result is atomic.',
    },
    acceptance: {
      mode: 'runner-managed',
      expectedOutcome: 'The selected dashboard form is delivered.',
      requiredChecks: [{ id: 'check-dashboard', command: 'exit 0' }],
    },
  });
  return { workDir, taskPath, versionDir };
}

function readEvents(workDir, runId) {
  return readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function fillDecision(path, { decision, basis }) {
  const raw = readFileSync(path, 'utf8');
  writeFileSync(
    path,
    raw
      .replace(
        '<resolver: the concrete, downstream-consumable choice — a value, not prose>',
        decision,
      )
      .replace('<resolver: the grounds for this decision>', basis),
    'utf8',
  );
}

try {
  process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClawPath;
  process.env.TASKOPS_PROTOTYPE_FIXTURE_MODE = 'valid';
  const validCase = seedPrototypeWork(tempRoot, 'prototype-valid');
  const workDir = validCase.workDir;
  const validRun = runTaskOps(validCase.workDir, {
    executor: 'openclaw-agent',
    maxSteps: 1,
    maxStepsExplicit: true,
  });
  const action = validRun.actions[0];
  const taskPath = validCase.taskPath;
  const taskEowPath = join(validCase.versionDir, 'eow', 'eow-prototype.md');
  const runEowPath = join(
    validCase.workDir,
    'runs',
    validRun.runId,
    'nodes',
    `eow-${action.runNodeId}.md`,
  );
  assert.equal(action.kind, 'prototype');
  assert.equal(action.status, 'completed');
  const task = parseMarkdownFile(taskPath);
  assert.equal(existsSync(taskEowPath), false);
  const prototypeEow = parseMarkdownFile(runEowPath);
  assert.equal(prototypeEow.reason, 'prototype_recorded');
  assert.equal(prototypeEow.closureRole, 'supporting');
  assert.equal(pickNextAction(parseProject(workDir)).reason, 'delegation_pending');

  for (const mode of ['missing', 'empty', 'invalid-utf8', 'directory']) {
    process.env.TASKOPS_PROTOTYPE_FIXTURE_MODE = mode;
    const failedCase = seedPrototypeWork(tempRoot, `prototype-${mode}`);
    const failedRun = runTaskOps(failedCase.workDir, {
      executor: 'openclaw-agent',
      maxSteps: 1,
      maxStepsExplicit: true,
    });
    const failedAction = failedRun.actions[0];
    const failedTaskPath = failedCase.taskPath;
    const failedRunEowPath = join(
      failedCase.workDir,
      'runs',
      failedRun.runId,
      'nodes',
      `eow-${failedAction.runNodeId}.md`,
    );
    assert.equal(failedAction.status, 'failed');
    assert.equal(parseMarkdownFile(failedTaskPath).status, 'blocked');
    assert.equal(parseMarkdownFile(failedTaskPath).resolverKind, undefined);
    assert.equal(existsSync(failedRunEowPath), false);
    assert.equal(
      readEvents(failedCase.workDir, failedRun.runId)
        .some((event) => event.type === 'prototype_failed'),
      true,
    );
  }

  assert.equal(task.status, 'waiting');
  assert.equal(task.resolverKind, 'human');
  const pending = pickNextAction(parseProject(workDir));
  assert.equal(pending.kind, 'stop');
  assert.equal(pending.reason, 'delegation_pending');

  fillDecision(taskPath, {
    decision: 'Option B',
    basis: 'The owner selected the bounded alternate.',
  });
  const resumed = pickNextAction(parseProject(workDir));
  assert.equal(resumed.kind, 'execute');
  runTaskOps(workDir, {
    executor: 'dry-run',
    maxSteps: 1,
    verifyChecks: true,
  });
  assert.equal(parseMarkdownFile(taskPath).status, 'done');
  console.log('OK prototype state machine');
} finally {
  delete process.env.TASKOPS_OPENCLAW_BIN;
  delete process.env.TASKOPS_PROTOTYPE_FIXTURE_MODE;
  rmSync(tempRoot, { recursive: true, force: true });
}
