#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { informationGainConvergence, parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps, SURPRISE_REPORT_PREFIX } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-uncertainty-live-observability-'));

function run(args, options = {}) {
  const result = spawnSync('node', [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) {
    throw new Error(`taskops ${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function writeFakeClaude() {
  const fakePath = join(tempRoot, 'fake-claude-live-observability.mjs');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SURPRISE_REPORT_PREFIX = ${JSON.stringify(SURPRISE_REPORT_PREFIX)};

if (process.argv.includes('--version')) {
  console.log('claude fake live observability');
  process.exit(0);
}

const prompt = process.argv[process.argv.length - 1] || '';

function printReport(report) {
  console.log('fake claude completed the requested TaskOps step');
  console.log(SURPRISE_REPORT_PREFIX + ' ' + JSON.stringify(report));
}

function explorationArtifactPath() {
  const match = prompt.match(/Write the exploration artifact at: ([^\\n]+)/);
  if (!match) return null;
  const rel = match[1].trim();
  const workDir = process.env.TASKOPS_LIVE_OBSERVABILITY_WORK_DIR;
  return workDir ? join(workDir, rel) : rel;
}

function writeArtifact(text) {
  const artifactPath = explorationArtifactPath();
  if (!artifactPath) {
    console.error('missing exploration artifact path');
    process.exit(2);
  }
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, text, 'utf8');
  console.log('wrote ' + artifactPath);
}

if (prompt.includes('task-execute-malformed')) {
  console.log(SURPRISE_REPORT_PREFIX + ' {"contradictedKnown":');
  process.exit(0);
}

if (prompt.includes('task-explore-malformed')) {
  writeArtifact('# Malformed exploration\\n\\n' + SURPRISE_REPORT_PREFIX + ' {"contradictedKnown":\\n');
  process.exit(0);
}

if (prompt.includes('Task: task-execute-valid')) {
  printReport({
    summary: 'Live execute contradicted a stale known and discovered a blocking unknown.',
    contradictedKnown: [
      {
        knownId: 'k-stale-api',
        observedEvidence: 'The runtime adapter observed that the expected endpoint was missing.',
        correctedClaim: 'The task must discover the current endpoint before implementation.',
      },
    ],
    discoveredUnknowns: [
      {
        id: 'u-current-endpoint',
        question: 'Which endpoint replaced the stale API path?',
        whyDiscovered: 'The assumed endpoint failed during the live runner step.',
        blocksReadiness: true,
      },
    ],
    newKnownDeltas: [
      {
        id: 'k-runtime-report-recorded',
        claim: 'The non-dry-run runtime adapter path can append surprise report deltas to knownList.',
        evidence: 'Fake claude emitted TASKOPS_SURPRISE_REPORT through the claude-code adapter.',
      },
    ],
  });
  process.exit(0);
}

if (prompt.includes('Task under exploration: task-explore-valid')) {
  const report = {
    summary: 'Live exploration discovered one blocking unknown and one new known delta.',
    contradictedKnown: [
      {
        knownId: 'k-explore-assumption',
        observedEvidence: 'The exploration artifact found the assumption incomplete.',
        correctedClaim: 'Exploration must gather one more constraint before decomposition.',
      },
    ],
    discoveredUnknowns: [
      {
        id: 'u-explore-constraint',
        question: 'Which constraint determines the next decomposition boundary?',
        whyDiscovered: 'The minimal exploration pass found a missing boundary condition.',
        blocksReadiness: true,
      },
    ],
    newKnownDeltas: [
      {
        id: 'k-explore-artifact-recorded',
        claim: 'The exploration artifact path is parsed for TASKOPS_SURPRISE_REPORT.',
        evidence: 'Fake claude wrote the marker into the required exploration artifact.',
      },
    ],
  };
  writeArtifact([
    '# Live exploration artifact',
    '',
    'This artifact was written by the fake claude-code adapter.',
    '',
    SURPRISE_REPORT_PREFIX + ' ' + JSON.stringify(report),
    '',
  ].join('\\n'));
  process.exit(0);
}

printReport({
  summary: 'No fixture-specific surprise.',
  contradictedKnown: [],
  discoveredUnknowns: [],
  newKnownDeltas: [],
});
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function makeWork(id, task) {
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Verify live runner surprise observability', '--language', 'en']);
  const specPath = join(tempRoot, `${id}-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Live observability fixture',
    selected: true,
    tasks: [task],
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function taskPath(workDir, taskId) {
  return join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', `${taskId}.md`);
}

function runLive(workDir, taskId) {
  process.env.TASKOPS_LIVE_OBSERVABILITY_WORK_DIR = workDir;
  return runTaskOps(workDir, {
    executor: 'claude-code',
    maxSteps: 1,
    maxStepsExplicit: true,
    targetTaskId: taskId,
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
}

function baseTask(id, title, overrides = {}) {
  return {
    id,
    title,
    objective: `Exercise ${title}.`,
    responsibility: 'Run exactly one bounded runner observation.',
    completionCriteria: 'The runner records or blocks the surprise report outcome.',
    order: 1,
    status: 'pending',
    understandingLevel: 'known',
    ...overrides,
  };
}

try {
  const fakeClaude = writeFakeClaude();
  const previousClaudeBin = process.env.TASKOPS_CLAUDE_BIN;
  const previousWorkDir = process.env.TASKOPS_LIVE_OBSERVABILITY_WORK_DIR;
  process.env.TASKOPS_CLAUDE_BIN = fakeClaude;

  const executeWorkDir = makeWork('execute-valid-work', baseTask('task-execute-valid', 'valid execution report', {
    runReadiness: 'runnable',
    uncertaintyState: 'known',
    confidenceScore: 0.8,
    knownList: [
      {
        id: 'k-stale-api',
        claim: 'The implementation endpoint is /v1/stale.',
        verificationStatus: 'unverified',
      },
    ],
  }));
  const executeRun = runLive(executeWorkDir, 'task-execute-valid');
  assert.equal(executeRun.stepsRun, 1);
  assert.equal(executeRun.actions[0].kind, 'execute');
  assert.equal(executeRun.actions[0].status, 'completed');
  assert.equal(executeRun.stopReason, 'max_steps');
  const executeTask = parseMarkdownFile(taskPath(executeWorkDir, 'task-execute-valid'));
  assert.equal(executeTask.status, 'done');
  assert.equal(executeTask.surpriseHistory.length, 1);
  assert.equal(executeTask.surpriseHistory[0].actionKind, 'execute');
  assert.equal(executeTask.surpriseHistory[0].surpriseScore, 1);
  assert.deepEqual(executeTask.surpriseHistory[0].contradictedKnownIds, ['k-stale-api']);
  assert.deepEqual(executeTask.surpriseHistory[0].blockingNewUnknownIds, ['u-current-endpoint']);
  assert.deepEqual(executeTask.surpriseHistory[0].newKnownIds, ['k-runtime-report-recorded']);
  assert.equal(executeTask.knownList.some((item) => item.id === 'k-runtime-report-recorded'), true);
  assert.equal(informationGainConvergence(executeTask).observedCount, 1);
  assert.match(informationGainConvergence(executeTask).reason, /need 3 surprise observations; found 1/);
  const executeRunNode = parseMarkdownFile(join(executeWorkDir, 'runs', executeRun.runId, 'nodes', `${executeRun.actions[0].runNodeId}.md`));
  assert.equal(executeRunNode.result.surpriseReport.summary, 'Live execute contradicted a stale known and discovered a blocking unknown.');
  assert.equal(executeRunNode.result.surpriseHistoryEntry.actionKind, 'execute');
  const executeRerun = runLive(executeWorkDir, 'task-execute-valid');
  assert.equal(executeRerun.stepsRun, 0);
  assert.equal(parseMarkdownFile(taskPath(executeWorkDir, 'task-execute-valid')).surpriseHistory.length, 1, 'done execution task should not accumulate a second observation');

  const exploreWorkDir = makeWork('explore-valid-work', baseTask('task-explore-valid', 'valid exploration report', {
    runReadiness: 'needs_exploration',
    uncertaintyState: 'unknown_unknown',
    confidenceScore: 0.2,
    nextLearningGoal: 'Find whether the exploration artifact path can carry surprise evidence.',
    unknowns: ['Whether the live exploration artifact parser records surprise.'],
    knownList: [
      {
        id: 'k-explore-assumption',
        claim: 'The exploration boundary is already sufficient.',
        verificationStatus: 'unverified',
      },
    ],
  }));
  const exploreRun = runLive(exploreWorkDir, 'task-explore-valid');
  assert.equal(exploreRun.stepsRun, 1);
  assert.equal(exploreRun.actions[0].kind, 'explore');
  assert.equal(exploreRun.actions[0].status, 'completed');
  assert.equal(exploreRun.stopReason, 'max_steps');
  const exploreTask = parseMarkdownFile(taskPath(exploreWorkDir, 'task-explore-valid'));
  assert.equal(exploreTask.status, 'done');
  assert.equal(exploreTask.runReadiness, 'needs_decomposition');
  assert.equal(exploreTask.surpriseHistory.length, 1);
  assert.equal(exploreTask.surpriseHistory[0].actionKind, 'explore');
  assert.deepEqual(exploreTask.surpriseHistory[0].contradictedKnownIds, ['k-explore-assumption']);
  assert.deepEqual(exploreTask.surpriseHistory[0].blockingNewUnknownIds, ['u-explore-constraint']);
  assert.deepEqual(exploreTask.surpriseHistory[0].newKnownIds, ['k-explore-artifact-recorded']);
  assert.equal(exploreTask.knownList.some((item) => item.id === 'k-explore-artifact-recorded'), true);
  assert.equal(informationGainConvergence(exploreTask).observedCount, 1);
  const exploreRunNode = parseMarkdownFile(join(exploreWorkDir, 'runs', exploreRun.runId, 'nodes', `${exploreRun.actions[0].runNodeId}.md`));
  assert.equal(existsSync(exploreRunNode.result.artifactPath), true);
  assert.equal(exploreRunNode.result.surpriseReport.summary, 'Live exploration discovered one blocking unknown and one new known delta.');
  assert.equal(exploreRunNode.result.surpriseHistoryEntry.actionKind, 'explore');
  const exploreRerun = runLive(exploreWorkDir, 'task-explore-valid');
  assert.equal(exploreRerun.stepsRun, 0);
  assert.equal(parseMarkdownFile(taskPath(exploreWorkDir, 'task-explore-valid')).surpriseHistory.length, 1, 'done exploration task should not accumulate a second observation');

  const malformedExecuteWorkDir = makeWork('execute-malformed-work', baseTask('task-execute-malformed', 'malformed execution report', {
    runReadiness: 'runnable',
    uncertaintyState: 'known',
    confidenceScore: 0.7,
    knownList: [
      { id: 'k-exec-malformed', claim: 'Malformed surprise should block execution.', verificationStatus: 'unverified' },
    ],
  }));
  const malformedExecuteRun = runLive(malformedExecuteWorkDir, 'task-execute-malformed');
  assert.equal(malformedExecuteRun.stopReason, 'task_failed');
  assert.equal(malformedExecuteRun.actions[0].failureKind, 'malformed_surprise_report');
  const malformedExecuteTask = parseMarkdownFile(taskPath(malformedExecuteWorkDir, 'task-execute-malformed'));
  assert.equal(malformedExecuteTask.status, 'blocked');
  assert.equal(malformedExecuteTask.runReadiness, 'blocked');
  assert.equal(malformedExecuteTask.needsManualReview, true);
  assert.equal(malformedExecuteTask.malformedSurpriseReport, true);
  assert.equal(malformedExecuteTask.surpriseHistory, undefined);
  assert.equal(existsSync(join(malformedExecuteWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-execute-malformed.md')), false);

  const malformedExploreWorkDir = makeWork('explore-malformed-work', baseTask('task-explore-malformed', 'malformed exploration report', {
    runReadiness: 'needs_exploration',
    uncertaintyState: 'unknown_unknown',
    confidenceScore: 0.15,
    unknowns: ['Malformed exploration should block.'],
  }));
  const malformedExploreRun = runLive(malformedExploreWorkDir, 'task-explore-malformed');
  assert.equal(malformedExploreRun.stopReason, 'task_failed');
  assert.equal(malformedExploreRun.actions[0].failureKind, 'malformed_surprise_report');
  const malformedExploreTask = parseMarkdownFile(taskPath(malformedExploreWorkDir, 'task-explore-malformed'));
  assert.equal(malformedExploreTask.status, 'blocked');
  assert.equal(malformedExploreTask.runReadiness, 'blocked');
  assert.equal(malformedExploreTask.needsManualReview, true);
  assert.equal(malformedExploreTask.malformedSurpriseReport, true);
  assert.equal(malformedExploreTask.surpriseHistory, undefined);
  assert.equal(existsSync(join(malformedExploreWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-explore-malformed.md')), false);

  if (previousClaudeBin == null) delete process.env.TASKOPS_CLAUDE_BIN;
  else process.env.TASKOPS_CLAUDE_BIN = previousClaudeBin;
  if (previousWorkDir == null) delete process.env.TASKOPS_LIVE_OBSERVABILITY_WORK_DIR;
  else process.env.TASKOPS_LIVE_OBSERVABILITY_WORK_DIR = previousWorkDir;

  console.log('OK uncertainty live observability');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
