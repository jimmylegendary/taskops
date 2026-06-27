#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile, promotePartialCompletions } from '../lib-taskops.js';
import { recheckBlockedTasks, runTaskOps } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-partial-request-runner-'));

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

function json(args, options = {}) {
  return JSON.parse(run([...args, '--json'], options));
}

function makeFakeOpenClaw() {
  const fakePath = join(tempRoot, 'fake-openclaw');
  const finalAssistantRawText = [
    'Completed the verified first slice only.',
    'TASKOPS_PARTIAL_REQUEST: {"partialRequested":true,"completedSummary":"Finished the verified first slice.","incompleteSummary":"Need the follow-up verification and final write-up.","followUpNeeded":true}',
  ].join('\n');
  writeFileSync(
    fakePath,
    `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({ result: { finalAssistantRawText } }))});\n`,
    'utf8',
  );
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function makeWork(id) {
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Verify runner-owned partial requests', '--language', 'en']);
  const specPath = join(tempRoot, `${id}-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Partial request runner fixture',
    selected: true,
    tasks: [
      {
        id: 'task-main',
        title: 'Main task',
        objective: 'Do a task large enough to leave a partial request.',
        responsibility: 'Emit a runner-owned partial request when the final slice is incomplete.',
        completionCriteria: 'A follow-up handles the unfinished work.',
        order: 1,
        status: 'pending',
        runReadiness: 'runnable',
        understandingLevel: 'known',
      },
    ],
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

try {
  const fakeOpenClaw = makeFakeOpenClaw();
  const previousOpenClawBin = process.env.TASKOPS_OPENCLAW_BIN;
  process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClaw;

  const workDir = makeWork('partial-request-runner-work');
  const runResult = runTaskOps(workDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 2,
    maxStepsExplicit: true,
    targetTaskId: 'task-main',
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });

  assert.equal(runResult.stepsRun, 1);
  assert.equal(runResult.stopReason, 'blocked_only');
  assert.equal(runResult.actions.length, 1);
  assert.equal(runResult.actions[0].status, 'partial');
  assert.equal(runResult.partialCompletions.length, 1);
  const [partialCompletion] = runResult.partialCompletions;
  assert.equal(partialCompletion.taskId, 'task-main');
  assert.equal(partialCompletion.taskGroupVersionId, 'tgv-root-v2');
  assert.equal(partialCompletion.awaitingPromotion, true);

  const taskPath = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-main.md');
  const task = parseMarkdownFile(taskPath);
  assert.equal(task.status, 'pending', 'runner partial must not mark the task done');
  assert.equal(task.runReadiness, 'blocked');
  assert.equal(task.awaitingPromotion, true);
  assert.equal(task.awaitingPromotionPartialId, partialCompletion.partialId);
  assert.match(task.runReadinessReason, /Awaiting partial-driven follow-up promotion/);
  assert.equal(existsSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-main.md')), false, 'runner partial must not create canonical task EoW');

  const runNodePath = join(workDir, 'runs', runResult.runId, 'nodes', runResult.actions[0].runNodeId + '.md');
  const runNode = parseMarkdownFile(runNodePath);
  assert.equal(runNode.status, 'done', 'worker turn should close successfully even when the task remains incomplete');
  assert.equal(runNode.result.partialCompletion.partialId, partialCompletion.partialId);
  const partialRunEowPath = join(workDir, 'runs', runResult.runId, 'nodes', `eow-${runResult.actions[0].runNodeId}.md`);
  assert.equal(existsSync(partialRunEowPath), false, 'runner partial must not create canonical run-node EoW before promotion');

  const prePromotionRecheck = recheckBlockedTasks(workDir, { allowConcurrentTarget: true, runId: runResult.runId });
  assert.equal(prePromotionRecheck.unblocked.length, 0, 'awaiting-promotion tasks must not be unblocked before promote-partials');
  assert.equal(prePromotionRecheck.stillBlocked.length, 1);
  assert.equal(prePromotionRecheck.stillBlocked[0].awaitingPromotion, true);
  assert.equal(parseMarkdownFile(taskPath).runReadiness, 'blocked');

  const plan = promotePartialCompletions(workDir, { partialId: partialCompletion.partialId, dryRun: true });
  assert.equal(plan.promotionCount, 1);
  assert.equal(plan.versionPlans[0].toVersionId, 'tgv-root-v3');

  const promoted = promotePartialCompletions(workDir, { partialId: partialCompletion.partialId, dryRun: false });
  assert.equal(promoted.applied, true);
  assert.equal(promoted.promotionCount, 1);
  assert.equal(promoted.appliedVersionPlans[0].toVersionId, 'tgv-root-v3');
  assert.equal(promoted.appliedVersionPlans[0].closedSourceRunNodes.length, 1);
  assert.equal(promoted.appliedVersionPlans[0].closedSourceRunNodes[0].runNodeId, runResult.actions[0].runNodeId);
  assert.equal(existsSync(partialRunEowPath), true, 'promotion should close the successful partial source run node');
  assert.equal(parseMarkdownFile(partialRunEowPath).reason, 'partial_follow_up_promoted');

  const promotedSourcePath = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-main.md');
  const promotedSource = parseMarkdownFile(promotedSourcePath);
  assert.equal(promotedSource.status, 'blocked');
  assert.equal(promotedSource.runReadiness, 'blocked');
  assert.equal(promotedSource.awaitingPromotion, undefined, 'promotion should replace awaiting-promotion state with follow-up dependency state');
  assert.equal(promotedSource.awaitingPromotionPartialId, undefined);
  assert.equal(promotedSource.blockedBy.length, 1);
  assert.equal(promotedSource.blockedBy[0].id, 'task-task-main-followup');
  assert.match(promotedSource.runReadinessReason, /Blocked by partial-driven follow-up task/);

  const followUpPath = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-task-main-followup.md');
  const followUp = parseMarkdownFile(followUpPath);
  assert.equal(followUp.status, 'pending');
  assert.equal(followUp.runReadiness, 'runnable');
  assert.equal(followUp.followUpFromPartialId, partialCompletion.partialId);

  const postPromotionRecheck = recheckBlockedTasks(workDir, { allowConcurrentTarget: true, runId: runResult.runId });
  assert.equal(postPromotionRecheck.unblocked.length, 0, 'follow-up dependency must keep source blocked until follow-up closes');
  assert.equal(parseMarkdownFile(promotedSourcePath).status, 'blocked');

  const queueWorkDir = makeWork('partial-request-queue-work');
  run(['queue', 'sync', queueWorkDir]);
  const queueRun = json([
    'runner', 'once', queueWorkDir,
    '--runtime', 'openclaw-cli',
    '--runner-id', 'partial-request-runner-smoke',
    '--max-steps', '2',
    '--report-sink', 'ledger',
  ], { env: { TASKOPS_OPENCLAW_BIN: fakeOpenClaw } });
  assert.equal(queueRun.claimed, true);
  assert.equal(queueRun.releaseStatus, 'partial');
  assert.equal(queueRun.targetCompleted, false);
  assert.equal(queueRun.errorSummary, null);
  assert.equal(queueRun.runResult.partialCompletions.length, 1);
  assert.equal(queueRun.report.status, 'delivered');
  assert.match(queueRun.report.message, /releaseStatus: partial/);
  assert.match(queueRun.report.message, /partial: execute:task-main/);
  assert.equal(parseMarkdownFile(join(queueWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-main.md')).awaitingPromotion, true);

  if (previousOpenClawBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
  else process.env.TASKOPS_OPENCLAW_BIN = previousOpenClawBin;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('partial request runner smoke passed');
