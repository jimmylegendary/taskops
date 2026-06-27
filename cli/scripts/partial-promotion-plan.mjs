#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isPartialUnresolved, parseMarkdownFile } from '../lib-taskops.js';

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

function writeTaskPartial(workDir, versionId, taskId, partialId, { completedSummary = 'Completed slice.', incompleteSummary = 'Remaining slice.' } = {}) {
  const partialDir = join(workDir, 'task-groups', 'tg-root', 'versions', versionId, 'partials');
  mkdirSync(partialDir, { recursive: true });
  writeFileSync(
    join(partialDir, `${partialId}.md`),
    `---\ntaskOpsVersion: v1\nentityType: partial\nid: ${partialId}\ngraphType: task\nattachedToType: task\nattachedToId: ${taskId}\ntaskGroupVersionId: ${versionId}\nreason: partial_complete\ndeclaredBy: smoke\ndeclaredAt: 2026-06-27T00:00:00Z\ncreatedAt: 2026-06-27T00:00:00Z\nstatus: active\ncompletedSummary: ${completedSummary}\nincompleteSummary: ${incompleteSummary}\nfollowUpNeeded: true\nsupersededBy: null\nbudget:\n  enabled: true\n---\n# Partial: ${taskId}\n`,
    'utf8',
  );
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
assert.deepEqual(
  {
    budget: plan.waveBudget.budget,
    count: plan.waveBudget.count,
    nextCount: plan.waveBudget.nextCount,
    remainingAfterApply: plan.waveBudget.remainingAfterApply,
    wouldExceed: plan.waveBudget.wouldExceed,
  },
  { budget: 10, count: 0, nextCount: 1, remainingAfterApply: 9, wouldExceed: false },
);
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
assert.equal(applied.waveBudget.nextCount, 1);
assert.equal(applied.appliedVersionPlans[0].toVersionId, 'tgv-root-v3');
assert.equal(existsSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3')), true, 'apply must create the planned version directory');
const workIndexAfterApply = readFileSync(join(workDir, 'index.md'), 'utf8');
assert.match(workIndexAfterApply, /partialPromotionWaveBudget: 10/);
assert.match(workIndexAfterApply, /partialPromotionWaveCount: 1/);

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

const rerunApply = json(['promote-partials', workDir, '--apply', '--partial-id', primaryClose.partialId]);
assert.equal(rerunApply.dryRun, false);
assert.equal(rerunApply.applied, false);
assert.equal(rerunApply.promotionCount, 0);
assert.equal(rerunApply.skippedCount, 1);
assert.equal(rerunApply.skipped[0].reason, 'already_superseded');
assert.equal(existsSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v4')), false, 'idempotent rerun must not create a duplicate follow-up version');

const followUpTaskPath = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-task-main-followup.md');
writeFileSync(
  followUpTaskPath,
  readFileSync(followUpTaskPath, 'utf8').replace('status: pending', 'status: done'),
  'utf8',
);
const followUpClose = json(['close', workDir, 'task-task-main-followup', '--reason', 'approved_result']);
assert.equal(followUpClose.closed, true);
assert.equal(followUpClose.eowId, 'eow-task-task-main-followup');

const recheck = json(['unblock-check', workDir]);
assert.equal(recheck.unblocked.length, 1);
assert.equal(recheck.unblocked[0].taskId, 'task-main');
assert.equal(recheck.unblocked[0].taskGroupVersionId, 'tgv-root-v3');

const reopenedSourceText = readFileSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-main.md'), 'utf8');
assert.match(reopenedSourceText, /status: pending/);
assert.match(reopenedSourceText, /runReadiness: runnable/);
assert.match(reopenedSourceText, /Blockers resolved by taskops blocker recheck/);

writeFileSync(
  join(workDir, 'index.md'),
  readFileSync(join(workDir, 'index.md'), 'utf8').replace('partialPromotionWaveBudget: 10', 'partialPromotionWaveBudget: 1'),
  'utf8',
);
const repeatPartialId = 'partial-task-main-repeat';
const repeatPartialDir = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'partials');
mkdirSync(repeatPartialDir, { recursive: true });
writeFileSync(
  join(repeatPartialDir, `${repeatPartialId}.md`),
  `---\ntaskOpsVersion: v1\nentityType: partial\nid: ${repeatPartialId}\ngraphType: task\nattachedToType: task\nattachedToId: task-main\ntaskGroupVersionId: tgv-root-v3\nreason: partial_complete\ndeclaredBy: smoke\ndeclaredAt: 2026-06-27T00:00:00Z\ncreatedAt: 2026-06-27T00:00:00Z\nstatus: active\ncompletedSummary: Reopened source made more progress.\nincompleteSummary: A second wave would be needed, but the work-level budget is exhausted.\nfollowUpNeeded: true\nsupersededBy: null\nbudget:\n  enabled: true\n---\n# Partial: task-main repeat\n`,
  'utf8',
);
const exhaustedPlan = json(['promote-partials', workDir, '--dry-run', '--partial-id', repeatPartialId]);
assert.equal(exhaustedPlan.promotionCount, 1);
assert.deepEqual(
  {
    budget: exhaustedPlan.waveBudget.budget,
    count: exhaustedPlan.waveBudget.count,
    nextCount: exhaustedPlan.waveBudget.nextCount,
    remainingAfterApply: exhaustedPlan.waveBudget.remainingAfterApply,
    wouldExceed: exhaustedPlan.waveBudget.wouldExceed,
  },
  { budget: 1, count: 1, nextCount: 2, remainingAfterApply: 0, wouldExceed: true },
);
assert.equal(existsSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v4')), false, 'exhausted dry-run must not create a new version');

const exhaustedApply = json(['promote-partials', workDir, '--apply', '--partial-id', repeatPartialId]);
assert.equal(exhaustedApply.dryRun, false);
assert.equal(exhaustedApply.applied, false);
assert.equal(exhaustedApply.reason, 'wave_budget_exhausted');
assert.equal(exhaustedApply.waveBudget.wouldExceed, true);
assert.equal(existsSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v4')), false, 'exhausted apply must not create a new version');
assert.match(readFileSync(join(workDir, 'work-log.md'), 'utf8'), /wave budget exhausted work=partial-promotion-plan count=1 budget=1/);

const exhaustedAudit = json(['audit', workDir]);
assert.equal(
  exhaustedAudit.issues.some((issue) => issue.code === 'wave_budget_exhausted_with_unresolved_partials'),
  true,
  'audit must surface budget exhaustion when unresolved partials remain',
);

const belowThresholdWorkDir = join(tempRoot, 'below-threshold-work');
run(['init', belowThresholdWorkDir, '--id', 'below-threshold', '--title', 'Below threshold', '--objective', 'Verify repeat threshold off by one', '--language', 'en']);
const belowThresholdSpecPath = join(tempRoot, 'below-threshold-spec.json');
writeFileSync(belowThresholdSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Below threshold fixture',
  selected: true,
  tasks: [
    {
      id: 'task-repeat',
      title: 'Repeat below threshold',
      objective: 'A task that has been partial-promoted twice already.',
      responsibility: 'Verify the third promotion is still allowed.',
      completionCriteria: 'A third partial promotion can be planned.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      understandingLevel: 'known',
      followUpBlockedByPartialIds: ['partial-old-1', 'partial-old-2'],
    },
  ],
}), 'utf8');
run(['decompose', belowThresholdWorkDir, '--task-group-id', 'tg-root', '--spec', belowThresholdSpecPath]);
writeFileSync(
  join(belowThresholdWorkDir, 'snapshots', 'snapshot-root-v1.md'),
  readFileSync(join(belowThresholdWorkDir, 'snapshots', 'snapshot-root-v1.md'), 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'),
  'utf8',
);
writeTaskPartial(belowThresholdWorkDir, 'tgv-root-v2', 'task-repeat', 'partial-repeat-third', {
  completedSummary: 'Third slice completed.',
  incompleteSummary: 'Third follow-up needed.',
});
const belowThresholdPlan = json(['promote-partials', belowThresholdWorkDir, '--dry-run', '--partial-id', 'partial-repeat-third']);
assert.equal(belowThresholdPlan.partialRepeatThreshold, 3);
assert.equal(belowThresholdPlan.promotionCount, 1, 'count=2 should allow the third promote when threshold=3');
assert.equal(belowThresholdPlan.skippedCount, 0);

const repeatWorkDir = join(tempRoot, 'repeat-review-work');
run(['init', repeatWorkDir, '--id', 'repeat-review', '--title', 'Repeat review', '--objective', 'Verify repeated partial review isolation', '--language', 'en']);
const repeatSpecPath = join(tempRoot, 'repeat-review-spec.json');
writeFileSync(repeatSpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Repeat review fixture',
  selected: true,
  tasks: [
    {
      id: 'task-repeat',
      title: 'Repeat needs review',
      objective: 'A task that has already been partial-promoted three times.',
      responsibility: 'Should be isolated for human review on the next partial.',
      completionCriteria: 'Does not block unrelated task promotion.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      understandingLevel: 'known',
      followUpBlockedByPartialIds: ['partial-old-1', 'partial-old-2', 'partial-old-3'],
    },
    {
      id: 'task-normal',
      title: 'Normal partial task',
      objective: 'A different task that should still promote.',
      responsibility: 'Verify repeated task isolation.',
      completionCriteria: 'Follow-up task is created normally.',
      order: 2,
      status: 'pending',
      runReadiness: 'runnable',
      understandingLevel: 'known',
    },
  ],
}), 'utf8');
run(['decompose', repeatWorkDir, '--task-group-id', 'tg-root', '--spec', repeatSpecPath]);
writeFileSync(
  join(repeatWorkDir, 'snapshots', 'snapshot-root-v1.md'),
  readFileSync(join(repeatWorkDir, 'snapshots', 'snapshot-root-v1.md'), 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'),
  'utf8',
);
writeTaskPartial(repeatWorkDir, 'tgv-root-v2', 'task-repeat', 'partial-repeat-fourth', {
  completedSummary: 'Fourth repeated slice.',
  incompleteSummary: 'This should require human review before another follow-up.',
});
writeTaskPartial(repeatWorkDir, 'tgv-root-v2', 'task-normal', 'partial-normal-first', {
  completedSummary: 'Normal task first slice.',
  incompleteSummary: 'Normal task follow-up remains.',
});

const repeatAllowedByOverride = json(['promote-partials', repeatWorkDir, '--dry-run', '--partial-id', 'partial-repeat-fourth', '--repeat-threshold', '4']);
assert.equal(repeatAllowedByOverride.partialRepeatThreshold, 4);
assert.equal(repeatAllowedByOverride.promotionCount, 1, 'count=3 should be allowed when threshold is raised to 4');
assert.equal(repeatAllowedByOverride.skippedCount, 0);

const repeatPlan = json(['promote-partials', repeatWorkDir, '--dry-run']);
assert.equal(repeatPlan.partialRepeatThreshold, 3);
assert.equal(repeatPlan.promotionCount, 1, 'normal task should still promote');
assert.equal(repeatPlan.skippedCount, 1, 'repeated task should be skipped only');
assert.equal(repeatPlan.skipped[0].reason, 'repeated_partial_needs_review');
assert.equal(repeatPlan.skipped[0].sourceTaskId, 'task-repeat');
assert.equal(repeatPlan.skipped[0].repeatCount, 3);
assert.equal(repeatPlan.skipped[0].repeatThreshold, 3);
assert.equal(repeatPlan.versionPlans[0].promotions[0].sourceTaskId, 'task-normal');
const repeatPreviewTask = repeatPlan.versionPlans[0].specPreview.tasks.find((task) => task.id === 'task-repeat');
assert.equal(repeatPreviewTask.needsManualReview, true);
assert.equal(repeatPreviewTask.repeatedPartialNeedsReview, true);
assert.equal(repeatPreviewTask.repeatedPartialCount, 3);
assert.deepEqual(repeatPreviewTask.repeatedPartialReviewPartialIds, ['partial-repeat-fourth']);

const repeatApplied = json(['promote-partials', repeatWorkDir, '--apply']);
assert.equal(repeatApplied.applied, true);
assert.equal(repeatApplied.promotionCount, 1);
assert.equal(repeatApplied.repeatedReviewApplied.length, 1);
assert.equal(repeatApplied.repeatedReviewApplied[0].taskId, 'task-repeat');
assert.equal(existsSync(join(repeatWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3')), true);
const repeatedTaskV3 = parseMarkdownFile(join(repeatWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-repeat.md'));
assert.equal(repeatedTaskV3.status, 'blocked');
assert.equal(repeatedTaskV3.runReadiness, 'blocked');
assert.equal(repeatedTaskV3.needsManualReview, true);
assert.equal(repeatedTaskV3.repeatedPartialNeedsReview, true);
assert.equal(repeatedTaskV3.repeatedPartialCount, 3);
assert.equal(repeatedTaskV3.partialRepeatThreshold, 3);
assert.deepEqual(repeatedTaskV3.repeatedPartialReviewPartialIds, ['partial-repeat-fourth']);
assert.equal(existsSync(join(repeatWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'tasks', 'task-task-normal-followup.md')), true, 'normal task follow-up should still be promoted');
assert.match(readFileSync(join(repeatWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'partials', 'partial-normal-first.md'), 'utf8'), /supersededBy: task:tgv-root-v3\/task-task-normal-followup/);
assert.match(readFileSync(join(repeatWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'partials', 'partial-repeat-fourth.md'), 'utf8'), /supersededBy: null/);
const repeatAudit = json(['audit', repeatWorkDir]);
assert.equal(repeatAudit.claimSafe, false);
assert.equal(
  repeatAudit.issues.some((issue) => issue.code === 'task_repeated_partial_needs_review' && issue.evidence.examples.some((task) => task.id === 'task-repeat')),
  true,
  'audit must surface repeated partial review tasks',
);

const reviewOnlyWorkDir = join(tempRoot, 'repeat-review-only-work');
run(['init', reviewOnlyWorkDir, '--id', 'repeat-review-only', '--title', 'Repeat review only', '--objective', 'Verify skip-only manual review apply', '--language', 'en']);
const reviewOnlySpecPath = join(tempRoot, 'repeat-review-only-spec.json');
writeFileSync(reviewOnlySpecPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Repeat review only fixture',
  selected: true,
  tasks: [
    {
      id: 'task-repeat',
      title: 'Repeat only task',
      objective: 'A task that should be marked for review without rolling a version.',
      responsibility: 'Verify skip-only apply behavior.',
      completionCriteria: 'Task is blocked for human review.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      understandingLevel: 'known',
      followUpBlockedByPartialIds: ['partial-old-1', 'partial-old-2', 'partial-old-3'],
    },
  ],
}), 'utf8');
run(['decompose', reviewOnlyWorkDir, '--task-group-id', 'tg-root', '--spec', reviewOnlySpecPath]);
writeFileSync(
  join(reviewOnlyWorkDir, 'snapshots', 'snapshot-root-v1.md'),
  readFileSync(join(reviewOnlyWorkDir, 'snapshots', 'snapshot-root-v1.md'), 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'),
  'utf8',
);
writeTaskPartial(reviewOnlyWorkDir, 'tgv-root-v2', 'task-repeat', 'partial-repeat-only-fourth');
const reviewOnlyApply = json(['promote-partials', reviewOnlyWorkDir, '--apply', '--partial-id', 'partial-repeat-only-fourth']);
assert.equal(reviewOnlyApply.applied, false);
assert.equal(reviewOnlyApply.reason, 'repeated_partial_needs_review');
assert.equal(reviewOnlyApply.promotionCount, 0);
assert.equal(reviewOnlyApply.skippedCount, 1);
assert.equal(reviewOnlyApply.repeatedReviewApplied.length, 1);
assert.equal(existsSync(join(reviewOnlyWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3')), false, 'skip-only repeated review must not roll a version');
const reviewOnlyTask = parseMarkdownFile(join(reviewOnlyWorkDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-repeat.md'));
assert.equal(reviewOnlyTask.needsManualReview, true);
assert.equal(reviewOnlyTask.repeatedPartialNeedsReview, true);
assert.equal(reviewOnlyTask.repeatedPartialCount, 3);

console.log('partial promotion plan smoke passed');
