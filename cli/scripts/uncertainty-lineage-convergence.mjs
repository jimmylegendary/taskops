#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fmBlock, lineageInformationGainConvergence, parseMarkdownFile, parseProject, readBody } from '../lib-taskops.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-uncertainty-lineage-convergence-'));

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

function surprise({ id, observedAt, surpriseScore, contradictedKnownIds = [], blockingNewUnknownIds = [] }) {
  return {
    id,
    actionKind: 'explore',
    observedAt,
    surpriseScore,
    surpriseLevel: surpriseScore > 0.2 ? 'high' : 'low',
    contradictedKnownIds,
    newUnknownIds: blockingNewUnknownIds,
    blockingNewUnknownIds,
    newKnownIds: [],
    runId: 'run-main',
    runNodeId: `run-node-${id}`,
  };
}

const workDir = join(tempRoot, 'work');
run(['init', workDir, '--id', 'uncertainty-lineage-convergence', '--title', 'Uncertainty lineage convergence', '--objective', 'Verify lineage information gain diagnostics', '--language', 'en']);

const specPath = join(tempRoot, 'root-spec.json');
writeFileSync(specPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Root with parent task',
  selected: true,
  tasks: [
    {
      id: 'task-parent',
      title: 'Parent task',
      objective: 'Decompose into a child task group.',
      responsibility: 'Own the first lineage convergence boundary.',
      completionCriteria: 'A child task group exists with canonical lineage.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      uncertaintyState: 'known_unknown',
      confidenceScore: 0.45,
      knownList: [{ id: 'k-root', claim: 'The parent boundary is stable.', verificationStatus: 'unverified' }],
    },
  ],
}), 'utf8');
run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
selectVersion(workDir, 'tg-root', 'tgv-root-v2');

const parentTaskPath = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-parent.md');
rewriteFrontmatter(parentTaskPath, (fm) => {
  fm.surpriseHistory = [surprise({ id: 's-root-v2', observedAt: '2026-06-28T00:00:00Z', surpriseScore: 0.05 })];
  return fm;
});

const first = json(['run', workDir, '--executor', 'dry-run', '--max-steps', '1']);
assert.equal(first.actions[0].kind, 'decompose');

const childTaskPath = join(workDir, 'task-groups', 'tg-parent', 'versions', 'tgv-parent-v1', 'tasks', 'task-parent-input-required.md');
rewriteFrontmatter(childTaskPath, (fm) => {
  fm.status = 'pending';
  fm.uncertaintyState = 'known_unknown';
  fm.confidenceScore = 0.5;
  fm.decompositionConfidence = 0.85;
  fm.runReadiness = 'needs_decomposition';
  fm.runReadinessReason = 'Lineage convergence smoke asks this child to decompose once more.';
  fm.surpriseHistory = [surprise({ id: 's-child-v1', observedAt: '2026-06-28T00:01:00Z', surpriseScore: 0.1 })];
  return fm;
});
writeFileSync(
  childTaskPath,
  readFileSync(childTaskPath, 'utf8')
    .replace(
      '<resolver: the concrete, downstream-consumable choice — a value, not prose>',
      'Decompose the child once more to measure lineage convergence.',
    )
    .replace(
      '<resolver: the grounds for this decision>',
      'The convergence smoke requires a resolved human input before further decomposition.',
    ),
  'utf8',
);

const second = json(['run', workDir, '--executor', 'dry-run', '--max-steps', '1']);
assert.equal(second.actions[0].kind, 'decompose');

let parsed = parseProject(workDir);
assert.deepEqual(parsed.errors, []);
let activeSnapshot = parsed.snapshots.get(parsed.project.activeSnapshotId);
const grandchildTask = parsed.versions.get('tgv-parent-input-required-v1').tasks[0];
rewriteFrontmatter(grandchildTask.path, (fm) => {
  fm.surpriseHistory = [surprise({ id: 's-grandchild-v1', observedAt: '2026-06-28T00:02:00Z', surpriseScore: 0 })];
  return fm;
});

parsed = parseProject(workDir);
activeSnapshot = parsed.snapshots.get(parsed.project.activeSnapshotId);
let currentGrandchild = parsed.versions.get('tgv-parent-input-required-v1').tasks[0];
let lineage = lineageInformationGainConvergence(parsed, currentGrandchild, activeSnapshot, { window: 3, maxSurpriseScore: 0.2 });
assert.equal(lineage.converged, true);
assert.equal(lineage.observedCount, 3);
assert.equal(lineage.lineageDepth, 2);
assert.deepEqual(lineage.recentScores, [0.05, 0.1, 0]);
assert.deepEqual(lineage.entries.map((entry) => entry.id), ['s-root-v2', 's-child-v1', 's-grandchild-v1']);
assert.deepEqual(lineage.entries.map((entry) => entry.lineageDistance), [2, 1, 0]);
assert.equal(lineage.entriesBySource.length, 3);

const insufficient = lineageInformationGainConvergence(parsed, currentGrandchild, activeSnapshot, { window: 4, maxSurpriseScore: 0.2 });
assert.equal(insufficient.converged, false);
assert.equal(insufficient.insufficientEvidence.required, 4);
assert.equal(insufficient.insufficientEvidence.observed, 3);
assert.match(insufficient.reason, /^insufficient_evidence:/);

run(['restart', workDir, '--from', 'task-parent', '--instruction', 'Restart parent after lineage convergence smoke.', '--reason', 'lineage_convergence_restart']);
const parentV3TaskPath = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-parent.md');
rewriteFrontmatter(parentV3TaskPath, (fm) => {
  fm.surpriseHistory = [surprise({
    id: 's-root-v3-high',
    observedAt: '2026-06-28T00:03:00Z',
    surpriseScore: 1,
    contradictedKnownIds: ['k-root'],
    blockingNewUnknownIds: ['u-root-boundary'],
  })];
  return fm;
});

parsed = parseProject(workDir);
activeSnapshot = parsed.snapshots.get(parsed.project.activeSnapshotId);
currentGrandchild = parsed.versions.get('tgv-parent-input-required-v1').tasks[0];
lineage = lineageInformationGainConvergence(parsed, currentGrandchild, activeSnapshot, { window: 3, maxSurpriseScore: 0.2 });
const activeParentEntry = lineage.entries.find((entry) => entry.id === 's-root-v3-high');
assert.ok(activeParentEntry);
assert.equal(activeParentEntry.sourceTaskGroupVersionId, 'tgv-root-v3');
assert.equal(activeParentEntry.hydrationSource, 'active_selected_parent');
assert.equal(lineage.converged, false);
assert.deepEqual(lineage.contradictedKnownIds, ['k-root']);
assert.deepEqual(lineage.blockingNewUnknownIds, ['u-root-boundary']);

console.log('uncertainty-lineage-convergence smoke passed');
