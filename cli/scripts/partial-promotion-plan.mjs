#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isPartialUnresolved } from '../lib-taskops.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-partial-promotion-'));

function run(args) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`taskops ${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function json(args) {
  return JSON.parse(run([...args, '--json']));
}

assert.equal(isPartialUnresolved({}), true);
assert.equal(isPartialUnresolved({ supersededBy: null }), true);
assert.equal(isPartialUnresolved({ supersededBy: '' }), true);
assert.equal(isPartialUnresolved({ supersededBy: 'null' }), true);
assert.equal(isPartialUnresolved({ supersededBy: 'task:tgv-root-v3/task-main-followup' }), false);

const workDir = join(tempRoot, 'work');
run(['init', workDir, '--id', 'partial-promotion-plan', '--title', 'Partial promotion plan', '--objective', 'Verify dry-run follow-up promotion planning', '--language', 'en']);

const specPath = join(tempRoot, 'spec.json');
writeFileSync(specPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Promotion fixture root',
  selected: true,
  tasks: [
    {
      id: 'task-upstream',
      title: 'Upstream complete',
      objective: 'Already completed upstream work.',
      responsibility: 'Remain preserved.',
      completionCriteria: 'Has EoW.',
      order: 1,
      status: 'done',
      runReadiness: 'runnable',
      understandingLevel: 'known',
    },
    {
      id: 'task-main',
      title: 'Main incomplete task',
      objective: 'Do the main task.',
      responsibility: 'Leave a partial marker.',
      completionCriteria: 'Requires follow-up.',
      order: 2,
      status: 'pending',
      runReadiness: 'runnable',
      understandingLevel: 'known',
    },
    {
      id: 'task-downstream',
      title: 'Downstream task',
      objective: 'Should stay after follow-up.',
      responsibility: 'Run later.',
      completionCriteria: 'Runs after follow-up.',
      order: 3,
      status: 'pending',
      runReadiness: 'runnable',
      understandingLevel: 'known',
    },
  ],
}), 'utf8');

run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');

writeFileSync(
  join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-upstream.md'),
  `---\ntaskOpsVersion: v1\nentityType: eow\nid: eow-task-upstream\ngraphType: task\nattachedToType: task\nattachedToId: task-upstream\nreason: smoke_seed\ndeclaredBy: smoke\ndeclaredAt: 2026-06-26T00:00:00Z\ncreatedAt: 2026-06-26T00:00:00Z\nstatus: done\ntaskGroupVersionId: tgv-root-v2\n---\n# EoW: task-upstream\n`,
  'utf8',
);

json([
  'close',
  workDir,
  'task-main',
  '--reason',
  'partial_complete',
  '--completed-summary',
  'Implemented the first half.',
  '--incomplete-summary',
  'Finish the verification gates and final review.',
  '--budget-json',
  '{"enabled":true,"stepsRun":8,"maxSteps":10,"remaining":2,"finishingMode":true}',
]);

const plan = json(['promote-partials', workDir, '--dry-run']);
assert.equal(plan.dryRun, true);
assert.equal(plan.promotionCount, 1);
assert.equal(plan.skippedCount, 0);
assert.equal(plan.versionPlans.length, 1);

const [versionPlan] = plan.versionPlans;
assert.equal(versionPlan.taskGroupId, 'tg-root');
assert.equal(versionPlan.fromVersionId, 'tgv-root-v2');
assert.equal(versionPlan.toVersionId, 'tgv-root-v3');
assert.equal(versionPlan.promotions.length, 1);
assert.equal(versionPlan.promotions[0].sourceTaskId, 'task-main');
assert.equal(versionPlan.promotions[0].followUpTaskId, 'task-task-main-followup');
assert.equal(versionPlan.promotions[0].followUpDepth, 1);
assert.equal(versionPlan.promotions[0].supersededBy, 'task:tgv-root-v3/task-task-main-followup');

const sourcePatch = versionPlan.sourceTaskPatches.find((patch) => patch.taskId === 'task-main');
assert.ok(sourcePatch, 'source task should be blocked by the planned follow-up');
assert.equal(sourcePatch.status, 'blocked');
assert.equal(sourcePatch.blockedByAppend[0].id, 'task-task-main-followup');
assert.equal(sourcePatch.blockedByAppend[0].taskGroupVersionId, 'tgv-root-v3');

const followUp = versionPlan.followUpTasks[0];
assert.equal(followUp.followUpFromPartialId, versionPlan.promotions[0].partialId);
assert.equal(followUp.followUpForTaskId, 'task-main');
assert.equal(followUp.followUpForTaskGroupVersionId, 'tgv-root-v2');
assert.equal(followUp.followUpDepth, 1);
assert.equal(followUp.followUpBudget.finishingMode, true);
assert.match(followUp.objective, /verification gates/);

const specTaskIds = versionPlan.specPreview.tasks.map((task) => task.id);
assert.deepEqual(specTaskIds, ['task-upstream', 'task-main', 'task-task-main-followup', 'task-downstream']);
assert.equal(versionPlan.specPreview.tasks.find((task) => task.id === 'task-main').status, 'blocked');
assert.equal(versionPlan.specPreview.tasks.find((task) => task.id === 'task-task-main-followup').order, 3);
assert.equal(versionPlan.specPreview.tasks.find((task) => task.id === 'task-downstream').order, 4);
assert.equal(versionPlan.specPreview.eows.length, 1);
assert.equal(versionPlan.specPreview.eows[0].preservedFromEowId, 'eow-task-upstream');
assert.equal(existsSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3')), false, 'dry-run must not create the planned version directory');

console.log('partial promotion plan smoke passed');
