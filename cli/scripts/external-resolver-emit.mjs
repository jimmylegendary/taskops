#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initProject,
  parseMarkdownFile,
  parseProject,
  writeVersionFromSpec,
} from '../lib-taskops.js';
import {
  runTaskOps,
} from '../lib-runner.js';

const FIXED_TIME = '2026-07-03T00:00:00.000Z';
const PARENT_TITLE = 'Parent dry-run task';
const ESCALATION_QUESTION = `${PARENT_TITLE}: which concrete decision or input is required before this task can be expanded into a runnable plan?`;
const REQUIRED_HEADINGS = ['## QUESTION', '## OPTIONS', '## ESCALATION_BASIS', '## DECISION', '## BASIS'];

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

function createDecomposeWork() {
  const root = mkdtempSync(join(tmpdir(), 'taskops-external-resolver-emit-'));
  initProject(root, {
    id: 'work-external-resolver-emit',
    title: 'External resolver emit fixture',
    objective: 'Validate dry-run input-required children are external resolver tasks.',
  });
  writeVersionFromSpec(root, 'tg-root', {
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'External resolver emit fixture',
    selected: true,
    tasks: [
      {
        id: 'task-parent',
        title: PARENT_TITLE,
        objective: 'Decompose into a deterministic dry-run child.',
        responsibility: 'Own the external resolver emission proof.',
        completionCriteria: 'The dry-run child is typed and scaffolded as an external resolver task.',
        order: 1,
        status: 'pending',
        runReadiness: 'needs_decomposition',
      },
    ],
  });
  pointRootSnapshotAt(root, 'tgv-root-v2');
  return root;
}

function runDryRunDecompose({ delegate = false } = {}) {
  const root = withFrozenTime(FIXED_TIME, () => createDecomposeWork());
  const runResult = withFrozenTime(FIXED_TIME, () => runTaskOps(root, {
    executor: 'dry-run',
    delegate,
    maxSteps: 1,
    maxStepsExplicit: true,
  }));
  assert.equal(runResult.stepsRun, 1, 'dry-run decompose should execute exactly one step');
  const action = runResult.actions[0];
  assert.equal(action?.kind, 'decompose', 'runner action should be decompose');
  assert.equal(action?.status, 'completed', 'decompose action should complete');
  assert.ok(action.childTaskGroupId, 'decompose action should report childTaskGroupId');
  return { root, runResult, action };
}

function inputRequiredChildPath(root, childTaskGroupId, versionId) {
  const tasksDir = join(root, 'task-groups', childTaskGroupId, 'versions', versionId, 'tasks');
  const matches = readdirSync(tasksDir)
    .filter((name) => name.endsWith('-input-required.md'))
    .sort();
  assert.equal(matches.length, 1, 'dry-run decompose should emit exactly one *-input-required.md child');
  return join(tasksDir, matches[0]);
}

{
  const { root, action } = runDryRunDecompose();
  const childPath = inputRequiredChildPath(root, action.childTaskGroupId, action.versionId);
  const child = parseMarkdownFile(childPath);
  const raw = readFileSync(childPath, 'utf8');

  assert.equal(child.resolverKind, 'human', 'non-delegation dry-run child should be typed resolverKind:human');
  for (const heading of REQUIRED_HEADINGS) {
    assert.ok(raw.includes(heading), `external resolver child must contain ${heading}`);
  }
  assert.ok(raw.includes(ESCALATION_QUESTION), 'external resolver QUESTION should be filled from the parent title');
  assert.ok(raw.includes('<resolver:'), 'external resolver resolution half should remain unresolved');
  assert.equal(
    raw.includes('<agent: the single decision that could not be settled'),
    false,
    'agent QUESTION placeholder should be replaced in the emitted child body',
  );

  const parsed = parseProject(root);
  assert.deepEqual(parsed.errors, [], 'external resolver dry-run output should validate without errors');
  const taskEow = parseMarkdownFile(join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-parent.md'));
  assert.equal(
    taskEow.resolvedByTaskGroupId,
    action.childTaskGroupId,
    'parent task EoW should continue to point at the generated child task group',
  );
}

{
  const { root, action } = runDryRunDecompose({ delegate: true });
  const childPath = inputRequiredChildPath(root, action.childTaskGroupId, action.versionId);
  const child = parseMarkdownFile(childPath);
  assert.equal(child.resolverKind, 'self', 'delegation dry-run child stamp should overwrite resolverKind:human with self');
}

console.log('OK external resolver emit');
