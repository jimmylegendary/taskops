#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyTaskReadiness, parseMarkdownFile, parseProject } from '../lib-taskops.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-uncertainty-readiness-'));

const baseTask = {
  id: 'task-uncertainty-fixture',
  title: 'Uncertainty fixture',
  objective: 'Verify uncertainty readiness classification.',
  responsibility: 'Own one executable unit.',
  completionCriteria: 'The expected behavior is asserted.',
  status: 'pending',
  runReadiness: 'runnable',
  understandingLevel: 'known',
};

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

function classify(overrides) {
  return classifyTaskReadiness({ ...baseTask, ...overrides });
}

function assertKnownListPreserved(task, message) {
  assert.equal(task.uncertaintyState, 'known_unknown', message);
  assert.equal(Number(task.confidenceScore), 0.42, message);
  assert.deepEqual(task.knownList, [
    {
      id: 'k1',
      claim: 'Input and output are known, but the decomposition boundary is still uncertain.',
      verificationStatus: 'unverified',
    },
  ], message);
}

const unknownUnknown = classify({
  uncertaintyState: 'unknown_unknown',
  confidenceScore: 0.2,
  knownList: [],
});
assert.equal(unknownUnknown.runReadiness, 'needs_exploration');
assert.equal(unknownUnknown.source, 'uncertainty');
assert.equal(unknownUnknown.legacyComparison.runReadiness, 'runnable');
assert.ok(unknownUnknown.consistencyIssues.some((issue) => issue.code === 'explicit_readiness_differs_from_uncertainty'));

const knownUnknownExplore = classify({
  uncertaintyState: 'known_unknown',
  confidenceScore: 0.45,
  knownList: [{ id: 'k1', claim: 'We know the boundary is not executable yet.', verificationStatus: 'unverified' }],
});
assert.equal(knownUnknownExplore.runReadiness, 'needs_exploration');

const knownUnknownDecompose = classify({
  uncertaintyState: 'known_unknown',
  confidenceScore: 0.6,
  knownList: [{ id: 'k1', claim: 'The child responsibility split is understood.', verificationStatus: 'unverified' }],
  runReadiness: 'needs_decomposition',
});
assert.equal(knownUnknownDecompose.runReadiness, 'needs_decomposition');
assert.equal(knownUnknownDecompose.nextAction, 'decompose_task_group');

const knownRunnable = classify({
  uncertaintyState: 'known',
  confidenceScore: 0.8,
  knownList: [{ id: 'k1', claim: 'The task contract is executable.', verificationStatus: 'unverified' }],
});
assert.equal(knownRunnable.runReadiness, 'runnable');

const knownMissingContract = classify({
  uncertaintyState: 'known',
  confidenceScore: 0.8,
  knownList: [{ id: 'k1', claim: 'The task is understood but still lacks a completion contract.', verificationStatus: 'unverified' }],
  completionCriteria: '',
});
assert.equal(knownMissingContract.runReadiness, 'needs_decomposition');
assert.ok(knownMissingContract.consistencyIssues.some((issue) => issue.code === 'known_uncertainty_missing_runnable_contract'));

const blockedStillBlocked = classify({
  status: 'blocked',
  runReadiness: 'blocked',
  uncertaintyState: 'known',
  confidenceScore: 0.9,
  knownList: [{ id: 'k1', claim: 'The task is understood but externally blocked.', verificationStatus: 'unverified' }],
});
assert.equal(blockedStillBlocked.runReadiness, 'blocked');

const workDir = join(tempRoot, 'work');
run(['init', workDir, '--id', 'uncertainty-phase1', '--title', 'Uncertainty phase 1', '--objective', 'Verify uncertainty metadata preservation', '--language', 'en']);

const specPath = join(tempRoot, 'spec.json');
writeFileSync(specPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Uncertainty fixture root',
  selected: true,
  tasks: [
    {
      id: 'task-known',
      title: 'Known unknown task',
      objective: 'Preserve uncertainty metadata across graph rewrites.',
      responsibility: 'Carry the knownList through version roll, restart, and promotion.',
      completionCriteria: 'Uncertainty fields remain in the selected task after each rewrite.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      understandingLevel: 'known',
      uncertaintyState: 'known_unknown',
      confidenceScore: 0.42,
      knownList: [
        {
          id: 'k1',
          claim: 'Input and output are known, but the decomposition boundary is still uncertain.',
          verificationStatus: 'unverified',
        },
      ],
    },
  ],
}), 'utf8');

run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');

const v2Task = parseMarkdownFile(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-known.md'));
assertKnownListPreserved(v2Task, 'writeVersionFromSpec should preserve uncertainty metadata');
assert.deepEqual(parseProject(workDir).errors, []);

run(['restart', workDir, '--from', 'task-known', '--instruction', 'Re-run after uncertainty metadata smoke.', '--reason', 'uncertainty_phase1']);
const v3Task = parseMarkdownFile(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-known.md'));
assertKnownListPreserved(v3Task, 'restartFromTask should preserve uncertainty metadata');

const partialDir = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'partials');
mkdirSync(partialDir, { recursive: true });
writeFileSync(
  join(partialDir, 'partial-task-known.md'),
  `---\ntaskOpsVersion: v1\nentityType: partial\nid: partial-task-known\ngraphType: task\nattachedToType: task\nattachedToId: task-known\ntaskGroupVersionId: tgv-root-v3\nreason: partial_complete\ndeclaredBy: smoke\ndeclaredAt: 2026-06-28T00:00:00Z\ncreatedAt: 2026-06-28T00:00:00Z\nstatus: active\ncompletedSummary: Preserved uncertainty through restart.\nincompleteSummary: Promote the partial and keep uncertainty metadata on the source task.\nfollowUpNeeded: true\nsupersededBy: null\nbudget:\n  enabled: false\n---\n# Partial: task-known\n`,
  'utf8',
);

const promoted = json(['promote-partials', workDir, '--apply', '--partial-id', 'partial-task-known']);
assert.equal(promoted.applied, true);
assert.equal(promoted.appliedVersionPlans[0].toVersionId, 'tgv-root-v4');
assert.equal(existsSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v4', 'tasks', 'task-task-known-followup.md')), true);

const v4Task = parseMarkdownFile(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v4', 'tasks', 'task-known.md'));
assertKnownListPreserved(v4Task, 'partial promotion should preserve uncertainty metadata on cloned source task');
assert.deepEqual(parseProject(workDir).errors, []);

const invalidSpecPath = join(tempRoot, 'invalid-spec.json');
writeFileSync(invalidSpecPath, JSON.stringify({
  versionId: 'tgv-root-invalid',
  version: 'invalid',
  summary: 'Invalid uncertainty metadata',
  selected: false,
  tasks: [
    {
      id: 'task-invalid',
      title: 'Invalid task',
      objective: 'Expose invalid uncertainty metadata.',
      responsibility: 'Fail validation.',
      completionCriteria: 'Validation reports malformed uncertainty metadata.',
      order: 1,
      status: 'pending',
      uncertaintyState: 'maybe_known',
      confidenceScore: 1.5,
      knownList: [{ id: 'k1', claim: '', verificationStatus: 'verified' }],
    },
  ],
}), 'utf8');
run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', invalidSpecPath]);
const invalidParsed = parseProject(workDir);
assert.ok(invalidParsed.errors.some((error) => error.includes("invalid uncertaintyState 'maybe_known'")));
assert.ok(invalidParsed.errors.some((error) => error.includes("invalid confidenceScore '1.5'")));
assert.ok(invalidParsed.errors.some((error) => error.includes('missing non-empty claim')));
assert.ok(invalidParsed.errors.some((error) => error.includes("invalid verificationStatus 'verified'")));

console.log('uncertainty-readiness smoke passed');
