#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  const root = mkdtempSync(join(tmpdir(), 'taskops-eow-resolver-decompose-'));
  initProject(root, {
    id: 'work-eow-resolver-decompose',
    title: 'EoW resolver decompose wiring',
    objective: 'Validate decomposition task EoWs link to the child resolver task group.',
  });
  writeVersionFromSpec(root, 'tg-root', {
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Decompose wiring fixture',
    selected: true,
    tasks: [
      {
        id: 'task-parent',
        title: 'Parent task',
        objective: 'Decompose into a child task group.',
        responsibility: 'Own the parent decomposition closure.',
        completionCriteria: 'The parent EoW points at the child task group resolver.',
        order: 1,
        status: 'pending',
        runReadiness: 'needs_decomposition',
      },
    ],
  });
  pointRootSnapshotAt(root, 'tgv-root-v2');
  return root;
}

const root = withFrozenTime(FIXED_TIME, () => createDecomposeWork());
const runResult = withFrozenTime(FIXED_TIME, () => runTaskOps(root, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
}));

assert.equal(runResult.stepsRun, 1, 'decompose wiring run should execute exactly one step');
const action = runResult.actions[0];
assert.equal(action?.kind, 'decompose', 'runner action should be decompose');
assert.equal(action?.status, 'completed', 'decompose action should complete');
assert.ok(action.childTaskGroupId, 'decompose action should report childTaskGroupId');

const taskEow = parseMarkdownFile(join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-parent.md'));
assert.equal(
  taskEow.resolvedByTaskGroupId,
  action.childTaskGroupId,
  'parent task EoW should resolve via the generated child task group',
);

const parsed = parseProject(root);
assert.deepEqual(parsed.errors, [], 'decompose wiring output should validate without errors');
assert.equal(
  parsed.warnings.some((warning) => warning.includes('resolvedByTaskGroupId')),
  false,
  'decompose wiring output should not emit resolver backlink warnings',
);

const runEow = parseMarkdownFile(join(root, 'runs', runResult.runId, 'nodes', `eow-${action.runNodeId}.md`));
assert.equal(
  runEow.resolvedByTaskGroupId,
  undefined,
  'run-node EoW must not receive resolvedByTaskGroupId in D1',
);

console.log('OK eow resolver decompose wiring');
