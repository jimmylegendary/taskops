#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ancestorChainForTask, fmBlock, parseMarkdownFile, parseProject, readBody } from '../lib-taskops.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-uncertainty-lineage-'));

function run(args, { expectStatus = 0 } = {}) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  if (result.status !== expectStatus) {
    throw new Error(`taskops ${args.join(' ')} expected status ${expectStatus}, got ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function json(args) {
  return JSON.parse(run([...args, '--json']));
}

function rewriteFrontmatter(filePath, updater) {
  const fm = parseMarkdownFile(filePath);
  const body = readBody(filePath);
  const next = updater({ ...fm }) ?? fm;
  writeFileSync(filePath, fmBlock(next) + (body ? `${body}\n` : ''), 'utf8');
}

function selectVersion(workDir, taskGroupId, versionId) {
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  rewriteFrontmatter(snapshotPath, (fm) => {
    fm.selectedVersions = (Array.isArray(fm.selectedVersions) ? fm.selectedVersions : []).map((pair) => (
      pair.taskGroupId === taskGroupId ? { ...pair, versionId } : pair
    ));
    return fm;
  });
}

const workDir = join(tempRoot, 'work');
run(['init', workDir, '--id', 'uncertainty-lineage', '--title', 'Uncertainty lineage', '--objective', 'Verify canonical decomposition lineage', '--language', 'en']);

const specPath = join(tempRoot, 'root-spec.json');
writeFileSync(specPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Root with decomposable task',
  selected: true,
  tasks: [
    {
      id: 'task-parent',
      title: 'Parent task',
      objective: 'Decompose into a child task group.',
      responsibility: 'Own the first decomposition boundary.',
      completionCriteria: 'A child task group exists with canonical lineage.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      uncertaintyState: 'known_unknown',
      confidenceScore: 0.45,
      knownList: [
        { id: 'k-parent', claim: 'The parent needs child tasks before execution.', verificationStatus: 'unverified' },
      ],
    },
  ],
}), 'utf8');
run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
selectVersion(workDir, 'tg-root', 'tgv-root-v2');

const first = json(['run', workDir, '--executor', 'dry-run', '--max-steps', '1']);
assert.equal(first.stopReason, 'max_steps');
assert.equal(first.stepsRun, 1);
assert.equal(first.actions[0].kind, 'decompose');
assert.equal(first.actions[0].childTaskGroupId, 'tg-parent');
assert.equal(first.actions[0].versionId, 'tgv-parent-v1');

let parsed = parseProject(workDir);
assert.deepEqual(parsed.errors, []);
const childVersion = parsed.versions.get('tgv-parent-v1');
assert.equal(childVersion.decomposedFromTaskId, 'task-parent');
assert.equal(childVersion.decomposedFromTaskGroupId, 'tg-root');
assert.equal(childVersion.decomposedFromTaskGroupVersionId, 'tgv-root-v2');
assert.equal(childVersion.decomposedByRunId, 'run-main');
assert.equal(childVersion.decomposedByRunNodeId, 'run-node-task-parent');

const childTaskPath = join(workDir, 'task-groups', 'tg-parent', 'versions', 'tgv-parent-v1', 'tasks', 'task-parent-input-required.md');
rewriteFrontmatter(childTaskPath, (fm) => {
  fm.status = 'pending';
  fm.runReadiness = 'needs_decomposition';
  fm.runReadinessReason = 'Lineage smoke asks this child to decompose once more.';
  delete fm.lastRunFailureReason;
  return fm;
});

const second = json(['run', workDir, '--executor', 'dry-run', '--max-steps', '1']);
assert.equal(second.stopReason, 'max_steps');
assert.equal(second.stepsRun, 1);
assert.equal(second.actions[0].kind, 'decompose');
assert.equal(second.actions[0].childTaskGroupId, 'tg-parent-input-required');
assert.equal(second.actions[0].versionId, 'tgv-parent-input-required-v1');

parsed = parseProject(workDir);
assert.deepEqual(parsed.errors, []);
const grandchildVersion = parsed.versions.get('tgv-parent-input-required-v1');
assert.equal(grandchildVersion.decomposedFromTaskId, 'task-parent-input-required');
assert.equal(grandchildVersion.decomposedFromTaskGroupId, 'tg-parent');
assert.equal(grandchildVersion.decomposedFromTaskGroupVersionId, 'tgv-parent-v1');
assert.equal(grandchildVersion.decomposedByRunId, 'run-main');
assert.equal(grandchildVersion.decomposedByRunNodeId, 'run-node-task-parent-input-required');

const grandchildTask = parsed.versions.get('tgv-parent-input-required-v1').tasks[0];
let chain = ancestorChainForTask(parsed, grandchildTask);
assert.equal(chain.length, 2);
assert.deepEqual(chain.map((entry) => entry.taskId), ['task-parent-input-required', 'task-parent']);
assert.deepEqual(chain.map((entry) => entry.taskGroupVersionId), ['tgv-parent-v1', 'tgv-root-v2']);

run(['restart', workDir, '--from', 'task-parent-input-required', '--instruction', 'Restart child after lineage smoke.', '--reason', 'lineage_restart']);
parsed = parseProject(workDir);
assert.deepEqual(parsed.errors, []);
assert.ok(parsed.warnings.some((warning) => warning.includes("selected child task group 'tg-parent-input-required' parent is selected from version 'tgv-parent-v2'")));
const restartedChildVersion = parsed.versions.get('tgv-parent-v2');
assert.equal(restartedChildVersion.decomposedFromTaskId, 'task-parent');
assert.equal(restartedChildVersion.decomposedFromTaskGroupVersionId, 'tgv-root-v2');

const restartedChildTask = restartedChildVersion.tasks.find((task) => task.id === 'task-parent-input-required');
chain = ancestorChainForTask(parsed, restartedChildTask);
assert.equal(chain.length, 1);
assert.equal(chain[0].taskId, 'task-parent');
assert.equal(chain[0].taskGroupVersionId, 'tgv-root-v2');

const grandchildIndex = join(workDir, 'task-groups', 'tg-parent-input-required', 'versions', 'tgv-parent-input-required-v1', 'index.md');
rewriteFrontmatter(grandchildIndex, (fm) => {
  fm.decomposedFromTaskId = 'task-missing-parent';
  return fm;
});
parsed = parseProject(workDir);
assert.ok(parsed.errors.some((error) => error.includes("decomposition backlink source task 'task-missing-parent' not found in version 'tgv-parent-v1'")));

console.log('uncertainty-lineage smoke passed');
