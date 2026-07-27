#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditParsedWork } from '../lib-audit.js';
import { inspectNonEmptyUtf8File } from '../lib-artifact-contract.js';
import { computeNextAction, runTaskOps } from '../lib-runner.js';
import { fmBlock, parseProject } from '../lib-taskops.js';

const artifactRoot = mkdtempSync(join(tmpdir(), 'taskops-artifact-contract-'));
const valid = join(artifactRoot, 'valid.md');
const empty = join(artifactRoot, 'empty.md');
const invalid = join(artifactRoot, 'invalid.md');
const directory = join(artifactRoot, 'directory.md');
writeFileSync(valid, '# Evidence\n', 'utf8');
writeFileSync(empty, ' \n\t', 'utf8');
writeFileSync(invalid, Buffer.from([0xff, 0xfe, 0xfd]));
mkdirSync(directory);
assert.equal(inspectNonEmptyUtf8File(valid, { label: 'evidence' }).ok, true);
assert.match(inspectNonEmptyUtf8File(empty, { label: 'evidence' }).message, /empty/);
assert.match(inspectNonEmptyUtf8File(invalid, { label: 'evidence' }).message, /UTF-8/);
assert.match(inspectNonEmptyUtf8File(directory, { label: 'evidence' }).message, /regular file/);

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-dynamic-closure-'));

function writeMd(path, fm, body = `# ${fm.id}\n`) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fmBlock(fm) + body, 'utf8');
}

function seedDynamicWork(tempRoot, id) {
  const workDir = join(tempRoot, id);
  const versionDir = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1');
  const now = '2026-07-25T00:00:00.000Z';
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id,
    title: id,
    objective: 'Complete one bounded verified result after learning and decomposition.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'task-groups', 'tg-root', 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Learn, decompose, and complete the bounded result.',
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
    summary: 'Root task needs learning.',
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
  writeMd(join(versionDir, 'tasks', 'task-main.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'task-main',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Deliver the bounded result',
    objective: 'Deliver one bounded result.',
    responsibility: 'Own learning, decomposition, and delivery.',
    completionCriteria: 'The selected child passes its runner check.',
    order: 1,
    createdAt: now,
    status: 'pending',
    runReadiness: 'needs_exploration',
    understandingLevel: 'partial',
    uncertaintyState: 'unknown_unknown',
    confidenceScore: 0.2,
    knownList: [],
    unknowns: ['Which bounded child should carry the result?'],
    nextLearningGoal: 'Identify a bounded child.',
  });
  return workDir;
}

function makeGeneratedChildRunnable(workDir, decomposeAction, { policyApproved = true } = {}) {
  const version = parseProject(workDir).versions.get(decomposeAction.versionId);
  assert.ok(version);
  assert.equal(version.tasks.length, 1);
  const child = version.tasks[0];
  writeMd(child.path, {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: child.id,
    taskGroupId: version.taskGroupId,
    taskGroupVersionId: version.id,
    title: 'Produce the checked child result',
    objective: 'Produce the bounded child result.',
    responsibility: 'Own the bounded child result.',
    completionCriteria: 'The runner check exits successfully.',
    order: 1,
    createdAt: child.createdAt,
    status: 'pending',
    runReadiness: 'runnable',
    understandingLevel: 'known',
    uncertaintyState: 'known',
    confidenceScore: 1,
    knownList: [{ id: 'k-check', claim: 'The check is deterministic.', verificationStatus: 'unverified' }],
    acceptance: policyApproved
      ? {
          mode: 'runner-managed',
          expectedOutcome: 'A bounded child result.',
          requiredChecks: [{ id: 'check-result', command: 'exit 0' }],
        }
      : {
          mode: 'informational',
          expectedOutcome: 'A bounded child result.',
        },
  });
}

try {
  const workDir = seedDynamicWork(tempRoot, 'verified-dynamic');
  const exploreRun = runTaskOps(workDir, {
    executor: 'dry-run',
    maxSteps: 1,
    maxStepsExplicit: true,
  });
  const decomposeRun = runTaskOps(workDir, {
    executor: 'dry-run',
    maxSteps: 1,
    maxStepsExplicit: true,
  });
  const decomposeAction = decomposeRun.actions[0];
  assert.equal(decomposeAction.kind, 'decompose');
  makeGeneratedChildRunnable(workDir, decomposeAction);
  const executeRun = runTaskOps(workDir, {
    executor: 'dry-run',
    maxSteps: 2,
    maxStepsExplicit: true,
    verifyChecks: true,
  });
  const result = {
    ...executeRun,
    actions: [...exploreRun.actions, ...decomposeRun.actions, ...executeRun.actions],
  };

  const parsed = parseProject(workDir);
  const audit = auditParsedWork(parsed);
  const next = computeNextAction(workDir);
  const rootActions = result.actions.map((action) => action.kind);
  assert.deepEqual(rootActions.slice(0, 3), ['explore', 'decompose', 'execute']);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.closure.supportingRunEowClosureCount, 3);
  assert.equal(parsed.closure.validSupportingRunEowClosureCount, 3);
  assert.equal(parsed.closure.invalidSupportingRunEowClosureCount, 0);
  assert.equal(parsed.closure.claimBearingRunEowClosureCount, 1);
  assert.equal(parsed.closure.policyApprovedClaimBearingRunEowClosureCount, 1);
  assert.equal(parsed.closure.policyApprovedComplete, true);
  assert.equal(result.stopReason, 'all_closed');
  assert.equal(next.action, 'done');
  assert.equal(audit.claimSafe, true);
  assert.equal(audit.assurance.externallySafe, true);

  const supportingEows = [...parsed.eowNodes.values()]
    .filter((eow) => eow.graphType === 'run' && eow.closureRole === 'supporting');
  assert.deepEqual(
    supportingEows.map((eow) => eow.reason).sort(),
    ['decomposition_recorded', 'exploration_recorded', 'review_recorded'],
  );
  const claimEow = [...parsed.eowNodes.values()]
    .find((eow) => eow.graphType === 'run' && eow.closureRole === 'claim-bearing');
  assert.equal(claimEow.reason, 'approved_result');

  const unapprovedDir = seedDynamicWork(tempRoot, 'unapproved-dynamic');
  runTaskOps(unapprovedDir, {
    executor: 'dry-run',
    maxSteps: 1,
    maxStepsExplicit: true,
  });
  const unapprovedDecompose = runTaskOps(unapprovedDir, {
    executor: 'dry-run',
    maxSteps: 1,
    maxStepsExplicit: true,
  });
  makeGeneratedChildRunnable(unapprovedDir, unapprovedDecompose.actions[0], {
    policyApproved: false,
  });
  runTaskOps(unapprovedDir, {
    executor: 'dry-run',
    maxSteps: 2,
    maxStepsExplicit: true,
  });
  const unapproved = parseProject(unapprovedDir);
  assert.equal(unapproved.closure.structuralComplete, true);
  assert.equal(unapproved.closure.claimBearingRunEowClosureCount, 1);
  assert.equal(unapproved.closure.policyApprovedClaimBearingRunEowClosureCount, 0);
  assert.equal(unapproved.closure.policyApprovedComplete, false);
  assert.equal(computeNextAction(unapprovedDir).action, 'graph_closed_unapproved');
  assert.equal(auditParsedWork(unapproved).claimSafe, false);

  const invalidSupportDir = join(tempRoot, 'invalid-support-dynamic');
  cpSync(workDir, invalidSupportDir, { recursive: true });
  const invalidBefore = parseProject(invalidSupportDir);
  const explorationNode = [...invalidBefore.runNodes.values()]
    .find((node) => node.actionKind === 'explore');
  assert.ok(explorationNode?.result?.artifactPath);
  const copiedArtifactPath = String(explorationNode.result.artifactPath)
    .replace(workDir, invalidSupportDir);
  rmSync(copiedArtifactPath);
  const copiedNodePath = explorationNode.path.replace(workDir, invalidSupportDir);
  writeFileSync(
    copiedNodePath,
    readFileSync(copiedNodePath, 'utf8').replace(
      explorationNode.result.artifactPath,
      copiedArtifactPath,
    ),
    'utf8',
  );
  const invalidSupport = parseProject(invalidSupportDir);
  assert.equal(invalidSupport.closure.invalidSupportingRunEowClosureCount, 1);
  assert.ok(invalidSupport.errors.some((error) => /missing exploration artifact/i.test(error)));
  assert.equal(auditParsedWork(invalidSupport).claimSafe, false);
  assert.notEqual(computeNextAction(invalidSupportDir).stopReason, 'all_closed');

  const missingActionKindDir = join(tempRoot, 'missing-action-kind-dynamic');
  cpSync(workDir, missingActionKindDir, { recursive: true });
  const missingActionBefore = parseProject(missingActionKindDir);
  const missingActionNode = [...missingActionBefore.runNodes.values()]
    .find((node) => node.actionKind === 'explore');
  assert.ok(missingActionNode);
  const missingActionNodePath = missingActionNode.path.replace(workDir, missingActionKindDir);
  writeFileSync(
    missingActionNodePath,
    readFileSync(missingActionNodePath, 'utf8').replace(/^actionKind: explore\n/m, ''),
    'utf8',
  );
  const missingAction = parseProject(missingActionKindDir);
  assert.equal(missingAction.closure.invalidSupportingRunEowClosureCount, 1);
  assert.ok(
    missingAction.errors.some((error) => /run-node actionKind is required/i.test(error)),
  );

  const unknownActionKindDir = join(tempRoot, 'unknown-action-kind-dynamic');
  cpSync(workDir, unknownActionKindDir, { recursive: true });
  const unknownActionBefore = parseProject(unknownActionKindDir);
  const unknownActionNode = [...unknownActionBefore.runNodes.values()]
    .find((node) => node.actionKind === 'explore');
  assert.ok(unknownActionNode);
  const unknownActionNodePath = unknownActionNode.path.replace(workDir, unknownActionKindDir);
  writeFileSync(
    unknownActionNodePath,
    readFileSync(unknownActionNodePath, 'utf8').replace('actionKind: explore', 'actionKind: unknown'),
    'utf8',
  );
  const unknownAction = parseProject(unknownActionKindDir);
  assert.equal(unknownAction.closure.invalidSupportingRunEowClosureCount, 1);
  assert.ok(unknownAction.errors.some((error) => /unknown run-node actionKind/i.test(error)));

  const mismatchedActionKindDir = join(tempRoot, 'mismatched-action-kind-dynamic');
  cpSync(workDir, mismatchedActionKindDir, { recursive: true });
  const mismatchedActionBefore = parseProject(mismatchedActionKindDir);
  const mismatchedActionNode = [...mismatchedActionBefore.runNodes.values()]
    .find((node) => node.actionKind === 'explore');
  assert.ok(mismatchedActionNode);
  const mismatchedActionNodePath = mismatchedActionNode.path.replace(workDir, mismatchedActionKindDir);
  writeFileSync(
    mismatchedActionNodePath,
    readFileSync(mismatchedActionNodePath, 'utf8').replace('actionKind: explore', 'actionKind: prototype'),
    'utf8',
  );
  const mismatchedAction = parseProject(mismatchedActionKindDir);
  assert.equal(mismatchedAction.closure.invalidSupportingRunEowClosureCount, 1);
  assert.ok(mismatchedAction.errors.some((error) => /actionKind.*type|type.*actionKind/i.test(error)));

  const legacyInferenceDir = join(tempRoot, 'legacy-action-inference-dynamic');
  cpSync(workDir, legacyInferenceDir, { recursive: true });
  const legacyBefore = parseProject(legacyInferenceDir);
  const legacyNode = [...legacyBefore.runNodes.values()]
    .find((node) => node.actionKind === 'explore');
  const legacyEow = [...legacyBefore.eowNodes.values()]
    .find((eow) => eow.runId === legacyNode?.runId && eow.attachedToId === legacyNode?.id);
  assert.ok(legacyNode && legacyEow);
  const legacyNodePath = legacyNode.path.replace(workDir, legacyInferenceDir);
  const legacyEowPath = legacyEow.path.replace(workDir, legacyInferenceDir);
  const legacyNodeBefore = readFileSync(legacyNodePath, 'utf8');
  const legacyNodeWithoutAction = legacyNodeBefore.replace(
    /^actionKind: explore\n/m,
    '',
  );
  assert.notEqual(
    legacyNodeWithoutAction,
    legacyNodeBefore,
    'legacy inference fixture must remove actionKind',
  );
  const legacyNodeAfter = legacyNodeWithoutAction.replace(/^attempt: 1\n/m, '');
  assert.notEqual(
    legacyNodeAfter,
    legacyNodeWithoutAction,
    'legacy inference fixture must remove attempt',
  );
  assert.doesNotMatch(legacyNodeAfter, /^predecessorRunNodeId:/m);
  writeFileSync(legacyNodePath, legacyNodeAfter, 'utf8');

  const legacyEowBefore = readFileSync(legacyEowPath, 'utf8');
  const legacyEowAfter = legacyEowBefore.replace(
    /^closureRole: supporting\n/m,
    '',
  );
  assert.notEqual(
    legacyEowAfter,
    legacyEowBefore,
    'legacy inference fixture must remove closureRole',
  );
  writeFileSync(legacyEowPath, legacyEowAfter, 'utf8');
  const legacyInference = parseProject(legacyInferenceDir);
  assert.equal(legacyInference.closure.invalidSupportingRunEowClosureCount, 0);
  assert.equal(legacyInference.closure.validSupportingRunEowClosureCount, 3);

  console.log('dynamic closure liveness smoke passed');
} finally {
  rmSync(artifactRoot, { recursive: true, force: true });
  rmSync(tempRoot, { recursive: true, force: true });
}
