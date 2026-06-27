#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyTaskReadiness, informationGainConvergence, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import {
  SURPRISE_REPORT_PREFIX,
  buildAgentDecompositionPrompt,
  buildAgentExecutionPrompt,
  buildAgentExplorationPrompt,
  computeSurpriseHistoryEntry,
  parseSurpriseReportFromExecutorResult,
} from '../lib-runner.js';

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
  assert.equal(task.surpriseHistory?.[0]?.id, 'surprise-seed', message);
  assert.equal(task.surpriseHistory?.[0]?.actionKind, 'explore', message);
  assert.equal(task.surpriseHistory?.[0]?.observedAt, '2026-06-28T00:00:00Z', message);
  assert.equal(Number(task.surpriseHistory?.[0]?.surpriseScore), 0.333, message);
  assert.equal(task.surpriseHistory?.[0]?.surpriseLevel, 'medium', message);
  assert.deepEqual(task.surpriseHistory?.[0]?.contradictedKnownIds, [], message);
  assert.deepEqual(task.surpriseHistory?.[0]?.newUnknownIds, ['u1'], message);
  assert.deepEqual(task.surpriseHistory?.[0]?.newKnownIds, ['k1'], message);
}

function inheritedFromFixture() {
  return {
    schemaVersion: 'phase3b-v1',
    capturedAt: '2026-06-28T02:00:00Z',
    parentChain: [
      {
        taskId: 'task-parent',
        taskGroupId: 'tg-parent',
        taskGroupVersionId: 'tgv-parent-v1',
        childTaskGroupId: 'tg-child',
        childTaskGroupVersionId: 'tgv-child-v1',
        decomposedByRunId: 'run-parent',
        decomposedByRunNodeId: 'rn-decompose-parent',
      },
    ],
    inheritedKnownRefs: [
      {
        id: 'inh-k1',
        sourceTaskId: 'task-parent',
        sourceTaskGroupVersionId: 'tgv-parent-v1',
        sourceKnownId: 'k-parent-wrong',
        claimHash: 'hash-parent-wrong',
        trust: 'inherited_unverified',
        observedAt: '2026-06-28T02:00:00Z',
      },
    ],
    inheritedFailurePatterns: [
      {
        id: 'fp1',
        type: 'contradicted_known',
        sourceTaskId: 'task-parent',
        sourceSurpriseHistoryId: 'surprise-parent-1',
        sourceKnownId: 'k-parent-wrong',
        severity: 'warning',
      },
    ],
    inheritedSurpriseRefs: [
      {
        sourceTaskId: 'task-parent',
        surpriseHistoryId: 'surprise-parent-1',
      },
    ],
  };
}

function assertInheritedFromPreserved(task, message) {
  assert.equal(task.inheritedFrom?.schemaVersion, 'phase3b-v1', message);
  assert.equal(task.inheritedFrom?.parentChain?.[0]?.taskId, 'task-parent', message);
  assert.equal(task.inheritedFrom?.inheritedKnownRefs?.[0]?.sourceKnownId, 'k-parent-wrong', message);
  assert.equal(task.inheritedFrom?.inheritedKnownRefs?.[0]?.trust, 'inherited_unverified', message);
  assert.equal(task.inheritedFrom?.inheritedFailurePatterns?.[0]?.type, 'contradicted_known', message);
  assert.equal(task.inheritedFrom?.inheritedSurpriseRefs?.[0]?.surpriseHistoryId, 'surprise-parent-1', message);
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

const inheritedOnlyKnown = classify({
  uncertaintyState: 'known',
  confidenceScore: 0.9,
  knownList: [],
  inheritedFrom: inheritedFromFixture(),
});
assert.equal(inheritedOnlyKnown.runReadiness, 'needs_exploration');
assert.equal(inheritedOnlyKnown.originalRunReadiness, 'runnable');
assert.ok(inheritedOnlyKnown.consistencyIssues.some((issue) => issue.code === 'inherited_only_known_not_runnable'));

const inheritedWithoutUncertainty = classify({
  inheritedFrom: inheritedFromFixture(),
});
assert.equal(inheritedWithoutUncertainty.runReadiness, 'needs_exploration');
assert.equal(inheritedWithoutUncertainty.legacyComparison.runReadiness, 'runnable');

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

const decompositionPrompt = buildAgentDecompositionPrompt({
  project: { id: 'work-uncertainty', title: 'Uncertainty work', objective: 'Verify worker uncertainty declaration.' },
  task: {
    ...baseTask,
    uncertaintyState: 'known_unknown',
    confidenceScore: 0.42,
    knownList: [{ id: 'k1', claim: 'The decomposition boundary is uncertain.', verificationStatus: 'unverified' }],
  },
  childTaskGroupId: 'tg-child',
  versionId: 'tgv-child-v1',
});
assert.match(decompositionPrompt, /Phase 1 uncertainty metadata is required on each child task/);
assert.match(decompositionPrompt, /Do not copy inherited context into knownList unless the child task locally revalidates it/);
assert.match(decompositionPrompt, /uncertaintyState: unknown_unknown \| known_unknown \| known/);
assert.match(decompositionPrompt, /confidenceScore: number from 0\.0 to 1\.0/);
assert.match(decompositionPrompt, /verificationStatus: unverified/);
assert.match(decompositionPrompt, /Task uncertaintyState: known_unknown/);
assert.match(decompositionPrompt, /k1: The decomposition boundary is uncertain\. \[unverified\]/);

const executionPrompt = buildAgentExecutionPrompt({
  project: { id: 'work-uncertainty', title: 'Uncertainty work', objective: 'Verify worker surprise reporting.' },
  task: {
    ...baseTask,
    uncertaintyState: 'known',
    confidenceScore: 0.8,
    knownList: [{ id: 'k1', claim: 'The task contract is executable.', verificationStatus: 'unverified' }],
  },
  inheritedContext: {
    parentChain: [{ taskId: 'task-parent', taskGroupVersionId: 'tgv-parent-v1' }],
    inheritedKnownRefs: [{ id: 'inh-k1', sourceTaskId: 'task-parent', sourceKnownId: 'k-parent-wrong', trust: 'inherited_unverified', claimPreview: 'Parent claim to revalidate.' }],
    inheritedFailurePatterns: [{ id: 'fp1', type: 'contradicted_known', sourceTaskId: 'task-parent', sourceKnownId: 'k-parent-wrong', summary: 'Parent claim was contradicted upstream.' }],
    inheritedSurpriseRefs: [{ sourceTaskId: 'task-parent', surpriseHistoryId: 'surprise-parent-1' }],
  },
});
assert.match(executionPrompt, /Phase 2 surprise report protocol/);
assert.match(executionPrompt, new RegExp(SURPRISE_REPORT_PREFIX));
assert.match(executionPrompt, /The worker reports facts only; the runner computes surprise\/penalty/);
assert.match(executionPrompt, /Inherited context \(not ground truth\)/);
assert.match(executionPrompt, /Do not copy inherited claims into knownList unless this task locally revalidates them/);
assert.match(executionPrompt, /Inherited known refs: inh-k1: source task-parent:k-parent-wrong trust=inherited_unverified/);

const explorationPrompt = buildAgentExplorationPrompt({
  project: { id: 'work-uncertainty', title: 'Uncertainty work', objective: 'Verify exploration surprise reporting.' },
  task: {
    ...baseTask,
    uncertaintyState: 'known_unknown',
    confidenceScore: 0.4,
    knownList: [{ id: 'k1', claim: 'The exploration target is meaningful.', verificationStatus: 'unverified' }],
  },
  runId: 'run-main',
  runNodeId: 'run-node-explore',
  artifactRelPath: 'runs/run-main/artifacts/run-node-explore.md',
});
assert.match(explorationPrompt, /Include this report inside the exploration artifact/);

const surpriseLine = `${SURPRISE_REPORT_PREFIX} ${JSON.stringify({
  summary: 'One prior claim was contradicted and one blocking unknown emerged.',
  contradictedKnown: [{ knownId: 'k1', observedEvidence: 'The API does not expose the assumed method.', correctedClaim: 'The integration needs schema discovery first.' }],
  discoveredUnknowns: [{ id: 'u1', question: 'Which API mutation replaces the missing method?', whyDiscovered: 'Method call failed.', blocksReadiness: true }],
  newKnownDeltas: [{ id: 'k2', claim: 'The API requires schema discovery before implementation.', evidence: 'Observed missing method.' }],
})}`;
const parsedSurprise = parseSurpriseReportFromExecutorResult({ stdout: `done\n${surpriseLine}` });
assert.equal(parsedSurprise.surpriseReported, true);
assert.equal(parsedSurprise.report.contradictedKnown[0].knownId, 'k1');
assert.equal(parsedSurprise.report.discoveredUnknowns[0].blocksReadiness, true);
assert.equal(parsedSurprise.report.newKnownDeltas[0].verificationStatus, 'unverified');

const historyEntry = computeSurpriseHistoryEntry({
  task: {
    ...baseTask,
    confidenceScore: 0.8,
    knownList: [{ id: 'k1', claim: 'The API exposes the assumed method.', verificationStatus: 'unverified' }],
  },
  report: parsedSurprise.report,
  runId: 'run-main',
  runNodeId: 'run-node-task',
  actionKind: 'execute',
  observedAt: '2026-06-28T01:00:00Z',
  evidenceRefs: ['run:run-main/node:run-node-task'],
});
assert.equal(historyEntry.surpriseLevel, 'high');
assert.equal(historyEntry.surpriseScore, 1);
assert.equal(historyEntry.penaltyModel.wrongKnown, 3);
assert.equal(historyEntry.penaltyModel.discoveredUnknown, 1);
assert.deepEqual(historyEntry.contradictedKnownIds, ['k1']);
assert.deepEqual(historyEntry.newUnknownIds, ['u1']);
assert.deepEqual(historyEntry.blockingNewUnknownIds, ['u1']);
assert.deepEqual(historyEntry.newKnownIds, ['k2']);
assert.equal(historyEntry.confidenceAfter, 0.4);

const converged = informationGainConvergence({
  surpriseHistory: [
    { id: 's1', actionKind: 'explore', observedAt: '2026-06-28T00:00:00Z', surpriseScore: 0.05, contradictedKnownIds: [], blockingNewUnknownIds: [] },
    { id: 's2', actionKind: 'explore', observedAt: '2026-06-28T00:01:00Z', surpriseScore: 0.1, contradictedKnownIds: [], blockingNewUnknownIds: [] },
    { id: 's3', actionKind: 'execute', observedAt: '2026-06-28T00:02:00Z', surpriseScore: 0.0, contradictedKnownIds: [], blockingNewUnknownIds: [] },
  ],
});
assert.equal(converged.converged, true);
assert.equal(converged.reason, '3 consecutive low-surprise observations');

const notConverged = informationGainConvergence({
  surpriseHistory: [
    { id: 's1', actionKind: 'explore', observedAt: '2026-06-28T00:00:00Z', surpriseScore: 0.05, contradictedKnownIds: [], blockingNewUnknownIds: [] },
    { id: 's2', actionKind: 'execute', observedAt: '2026-06-28T00:01:00Z', surpriseScore: 0.1, contradictedKnownIds: ['k1'], blockingNewUnknownIds: [] },
    { id: 's3', actionKind: 'explore', observedAt: '2026-06-28T00:02:00Z', surpriseScore: 0.0, contradictedKnownIds: [], blockingNewUnknownIds: [] },
  ],
});
assert.equal(notConverged.converged, false);
assert.deepEqual(notConverged.contradictedKnownIds, ['k1']);

const malformedSurprise = parseSurpriseReportFromExecutorResult({ stdout: `${SURPRISE_REPORT_PREFIX} {"contradictedKnown":` });
assert.equal(malformedSurprise.markerFound, true);
assert.match(malformedSurprise.parseError, /Unexpected|JSON/);

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
      surpriseHistory: [
        {
          id: 'surprise-seed',
          actionKind: 'explore',
          observedAt: '2026-06-28T00:00:00Z',
          surpriseScore: 0.333,
          surpriseLevel: 'medium',
          contradictedKnownIds: [],
          newUnknownIds: ['u1'],
          newKnownIds: ['k1'],
        },
      ],
      inheritedFrom: inheritedFromFixture(),
    },
  ],
}), 'utf8');

run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');

const v2Task = parseMarkdownFile(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-known.md'));
assertKnownListPreserved(v2Task, 'writeVersionFromSpec should preserve uncertainty metadata');
assertInheritedFromPreserved(v2Task, 'writeVersionFromSpec should preserve inherited context separately');
assert.deepEqual(parseProject(workDir).errors, []);

run(['restart', workDir, '--from', 'task-known', '--instruction', 'Re-run after uncertainty metadata smoke.', '--reason', 'uncertainty_phase1']);
const v3Task = parseMarkdownFile(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-known.md'));
assertKnownListPreserved(v3Task, 'restartFromTask should preserve uncertainty metadata');
assertInheritedFromPreserved(v3Task, 'restartFromTask should preserve inherited context separately');

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
assertInheritedFromPreserved(v4Task, 'partial promotion should preserve inherited context separately');
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
      surpriseHistory: [{ id: '', actionKind: '', observedAt: '', surpriseScore: 2, contradictedKnownIds: 'k1' }],
      inheritedFrom: {
        schemaVersion: '',
        parentChain: [{ taskId: '', taskGroupId: 'tg-parent' }],
        inheritedKnownRefs: [{ id: 'inh-bad', sourceTaskId: 'task-parent', sourceKnownId: 'k-parent', trust: 'trusted_truth' }],
        inheritedFailurePatterns: [{ id: 'fp-bad', type: 'ground_truth', sourceTaskId: 'task-parent' }],
        inheritedSurpriseRefs: [{ sourceTaskId: '', surpriseHistoryId: 'surprise-parent-1' }],
      },
    },
  ],
}), 'utf8');
run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', invalidSpecPath]);
const invalidParsed = parseProject(workDir);
assert.ok(invalidParsed.errors.some((error) => error.includes("invalid uncertaintyState 'maybe_known'")));
assert.ok(invalidParsed.errors.some((error) => error.includes("invalid confidenceScore '1.5'")));
assert.ok(invalidParsed.errors.some((error) => error.includes('missing non-empty claim')));
assert.ok(invalidParsed.errors.some((error) => error.includes("invalid verificationStatus 'verified'")));
assert.ok(invalidParsed.errors.some((error) => error.includes('invalid surpriseHistory: entry 1 missing non-empty id')));
assert.ok(invalidParsed.errors.some((error) => error.includes("invalid surpriseHistory: entry 1 has invalid surpriseScore '2'")));
assert.ok(invalidParsed.errors.some((error) => error.includes('invalid surpriseHistory: entry 1 field contradictedKnownIds must be a list')));
assert.ok(invalidParsed.errors.some((error) => error.includes('invalid inheritedFrom: schemaVersion must be a non-empty string')));
assert.ok(invalidParsed.errors.some((error) => error.includes('invalid inheritedFrom: parentChain entry 1 missing non-empty taskId')));
assert.ok(invalidParsed.errors.some((error) => error.includes("invalid inheritedFrom: inheritedKnownRefs entry 1 has invalid trust 'trusted_truth'")));
assert.ok(invalidParsed.errors.some((error) => error.includes("invalid inheritedFrom: inheritedFailurePatterns entry 1 has invalid type 'ground_truth'")));
assert.ok(invalidParsed.errors.some((error) => error.includes('invalid inheritedFrom: inheritedSurpriseRefs entry 1 missing non-empty sourceTaskId')));

console.log('uncertainty-readiness smoke passed');
