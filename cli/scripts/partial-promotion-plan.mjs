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
    {
      id: 'task-depth',
      title: 'Depth capped task',
      objective: 'Already a follow-up task.',
      responsibility: 'Verify depth cap skip.',
      completionCriteria: 'Would exceed the default follow-up cap.',
      order: 4,
      status: 'pending',
      runReadiness: 'runnable',
      understandingLevel: 'known',
      followUpDepth: 1,
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

const primaryClose = json([
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
assert.ok(primaryClose.partialId, 'primary close should return a partial id');

const resolvedClose = json([
  'close',
  workDir,
  'task-downstream',
  '--reason',
  'partial_complete',
  '--completed-summary',
  'Downstream work was partly started.',
  '--incomplete-summary',
  'This should be skipped because it is already superseded.',
]);
writeFileSync(
  resolvedClose.partialPath,
  readFileSync(resolvedClose.partialPath, 'utf8').replace('supersededBy: null', 'supersededBy: task:tgv-root-v3/task-downstream-followup'),
  'utf8',
);

const depthClose = json([
  'close',
  workDir,
  'task-depth',
  '--reason',
  'partial_complete',
  '--completed-summary',
  'Depth-capped task started.',
  '--incomplete-summary',
  'This would require a second follow-up level.',
]);

const oldSpecPath = join(tempRoot, 'old-spec.json');
writeFileSync(oldSpecPath, JSON.stringify({
  versionId: 'tgv-root-old',
  version: 'old',
  summary: 'Non selected historical version',
  selected: false,
  tasks: [
    {
      id: 'task-old',
      title: 'Old version task',
      objective: 'Historical non-selected work.',
      responsibility: 'Verify selected-only skip.',
      completionCriteria: 'Should not be promoted.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      understandingLevel: 'known',
    },
  ],
}), 'utf8');
run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', oldSpecPath]);
const oldClose = json([
  'close',
  workDir,
  'task-old',
  '--reason',
  'partial_complete',
  '--completed-summary',
  'Old version partial.',
  '--incomplete-summary',
  'This should not be promoted because the version is not selected.',
]);

const resolvedPlan = json(['promote-partials', workDir, '--dry-run', '--partial-id', resolvedClose.partialId]);
assert.equal(resolvedPlan.promotionCount, 0);
assert.equal(resolvedPlan.skippedCount, 1);
assert.equal(resolvedPlan.skipped[0].reason, 'already_superseded');

const depthPlan = json(['promote-partials', workDir, '--dry-run', '--partial-id', depthClose.partialId, '--max-follow-up-depth', '1']);
assert.equal(depthPlan.promotionCount, 0);
assert.equal(depthPlan.skippedCount, 1);
assert.equal(depthPlan.skipped[0].reason, 'exceeded_follow_up_depth');

const nonSelectedPlan = json(['promote-partials', workDir, '--dry-run', '--partial-id', oldClose.partialId]);
assert.equal(nonSelectedPlan.promotionCount, 0);
assert.equal(nonSelectedPlan.skippedCount, 1);
assert.equal(nonSelectedPlan.skipped[0].reason, 'not_in_selected_version');

const plan = json(['promote-partials', workDir, '--dry-run', '--partial-id', primaryClose.partialId]);
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
assert.deepEqual(specTaskIds, ['task-upstream', 'task-main', 'task-task-main-followup', 'task-downstream', 'task-depth']);
assert.equal(versionPlan.specPreview.tasks.find((task) => task.id === 'task-main').status, 'blocked');
assert.equal(versionPlan.specPreview.tasks.find((task) => task.id === 'task-task-main-followup').order, 3);
assert.equal(versionPlan.specPreview.tasks.find((task) => task.id === 'task-downstream').order, 4);
assert.equal(versionPlan.specPreview.tasks.find((task) => task.id === 'task-depth').order, 5);
assert.equal(versionPlan.specPreview.eows.length, 1);
assert.equal(versionPlan.specPreview.eows[0].preservedFromEowId, 'eow-task-upstream');
assert.equal(existsSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3')), false, 'dry-run must not create the planned version directory');

const applied = json(['promote-partials', workDir, '--apply', '--partial-id', primaryClose.partialId]);
assert.equal(applied.dryRun, false);
assert.equal(applied.applied, true);
assert.equal(applied.promotionCount, 1);
assert.equal(applied.appliedVersionPlans[0].toVersionId, 'tgv-root-v3');
assert.equal(existsSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3')), true, 'apply must create the planned version directory');

const oldVersionIndex = readFileSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'index.md'), 'utf8');
assert.match(oldVersionIndex, /selected: false/);
assert.match(oldVersionIndex, /supersededByVersionId: tgv-root-v3/);
assert.match(readFileSync(join(workDir, 'task-groups', 'tg-root', 'index.md'), 'utf8'), /activeVersionId: tgv-root-v3/);
assert.match(readFileSync(snapshotPath, 'utf8'), /versionId: tgv-root-v3/);

const promotedPartial = readFileSync(primaryClose.partialPath, 'utf8');
assert.match(promotedPartial, /supersededBy: task:tgv-root-v3\/task-task-main-followup/);
assert.match(promotedPartial, /followUpTaskId: task-task-main-followup/);

const followUpTaskText = readFileSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-task-main-followup.md'), 'utf8');
assert.match(followUpTaskText, /followUpFromPartialId:/);
assert.match(followUpTaskText, /followUpForTaskId: task-main/);
assert.match(followUpTaskText, /followUpDepth: 1/);

const blockedSourceText = readFileSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-main.md'), 'utf8');
assert.match(blockedSourceText, /status: blocked/);
assert.match(blockedSourceText, /runReadiness: blocked/);
assert.match(blockedSourceText, /id: task-task-main-followup/);

const audit = json(['audit', workDir]);
assert.equal(audit.issues.some((issue) => issue.code === 'work_has_partial_completions' && issue.evidence.examples.some((partial) => partial.id === primaryClose.partialId)), false);
assert.equal(audit.issues.some((issue) => issue.code === 'work_has_partial_completions'), true, 'other unresolved partials should still warn');

console.log('partial promotion plan smoke passed');
