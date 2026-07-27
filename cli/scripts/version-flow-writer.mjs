#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const taskopsPath = resolve(repoRoot, 'cli/lib-taskops.js');
const source = readFileSync(taskopsPath, 'utf8');

function sectionBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker ${endMarker}`);
  return source.slice(start, end);
}

function findFunctionSection(name, nextMarker) {
  const marker = `function ${name}`;
  return sectionBetween(marker, nextMarker);
}

function findExportedFunctionSection(name, nextMarker) {
  const marker = `export function ${name}`;
  return sectionBetween(marker, nextMarker);
}

function assertSequence(body, labels, context) {
  let cursor = -1;
  for (const label of labels) {
    const next = body.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `${context}: expected '${label}' after offset ${cursor}`);
    cursor = next;
  }
}

const writeVersionCalls = source.match(/\bwriteVersionFromSpec\(/g) || [];
assert.equal(
  writeVersionCalls.length,
  3,
  'writeVersionFromSpec should remain the shared primitive: declaration + promotion helper + restart helper',
);

const promotionHelper = findFunctionSection('applyPartialPromotion', '\nexport function promotePartialCompletions');
assertSequence(
  promotionHelper,
  [
    'const preparedSourceRunNodes = new Map()',
    'preparePromotedPartialSourceRunNode(parsed, partial)',
    'applyRepeatedPartialReviewPatches(parsed, plan.repeatedReviewPatches)',
    'for (const versionPlan of plan.versionPlans)',
    'const sourceVersion = parsed.versions.get(versionPlan.fromVersionId)',
    'const taskGroup = parsed.taskGroups.get(versionPlan.taskGroupId)',
    'const newVersionDir = writeVersionFromSpec(',
    "supersedesVersionId: versionPlan.fromVersionId",
    "updateMarkdownFrontmatter(join(sourceVersion.path, 'index.md')",
    'fm.selected = false',
    'fm.supersededByVersionId = versionPlan.toVersionId',
    "updateMarkdownFrontmatter(join(taskGroup.path, 'index.md')",
    'fm.activeVersionId = versionPlan.toVersionId',
    'updateMarkdownFrontmatter(activeSnapshot.path',
    'fm.selectedVersions = list.map',
    'appendTextFile(',
    'partial-driven follow-up promotion from=',
    'for (const promotion of versionPlan.promotions)',
    'updateMarkdownFrontmatter(partial.path',
    'fm.supersededBy = promotion.supersededBy',
    'const closedSourceRunNode = closePromotedPartialSourceRunNode(',
    'preparedSourceRunNodes.get(partial.path)',
    'appliedVersionPlans.push({',
    'appendWorkLog(plan.projectDir, logLine)',
    "updateMarkdownFrontmatter(join(plan.projectDir, 'index.md')",
    'fm.partialPromotionWaveBudget = plan.waveBudget.budget',
    'return { appliedVersionPlans, repeatedReviewApplied }',
  ],
  'applyPartialPromotion write order',
);

const promotionBody = findExportedFunctionSection('promotePartialCompletions', '\nfunction applyRestart');
const appliedPromotionSection = promotionBody.slice(promotionBody.indexOf('const parsed = parseProject(plan.projectDir);'));
assert.ok(appliedPromotionSection.includes('applyPartialPromotion({ plan, parsed, activeSnapshot, now })'), 'promotion apply path must route through applyPartialPromotion');
for (const forbidden of [
  'writeVersionFromSpec(',
  "updateMarkdownFrontmatter(join(sourceVersion.path, 'index.md')",
  "updateMarkdownFrontmatter(join(taskGroup.path, 'index.md')",
  'updateMarkdownFrontmatter(activeSnapshot.path',
  'closePromotedPartialSourceRunNode(',
  "updateMarkdownFrontmatter(join(plan.projectDir, 'index.md')",
]) {
  assert.equal(appliedPromotionSection.includes(forbidden), false, `promotion apply path bypasses helper via ${forbidden}`);
}

const restartHelper = findFunctionSection('applyRestart', '\nexport function restartFromTask');
assertSequence(
  restartHelper,
  [
    'const newVersionDir = writeVersionFromSpec(',
    'supersedesVersionId: sourceVersion.id',
    "updateMarkdownFrontmatter(join(sourceVersion.path, 'index.md')",
    'fm.selected = false',
    'fm.supersededByVersionId = newVersionId',
    "updateMarkdownFrontmatter(join(taskGroup.path, 'index.md')",
    'if (fm.activeVersionId === sourceVersion.id) fm.activeVersionId = newVersionId',
    'updateMarkdownFrontmatter(activeSnapshot.path',
    'fm.selectedVersions = list.map',
    'const workLogPath = join(projectDir,',
    'restart from task=',
    'return { newVersionDir }',
  ],
  'applyRestart write order',
);

const restartBody = findExportedFunctionSection('restartFromTask', '\nexport function watchAndSyncVault');
const restartApplySection = restartBody.slice(restartBody.indexOf('copyDecompositionBacklinkFields(sourceVersion, spec);'));
assert.ok(restartApplySection.includes('const { newVersionDir } = applyRestart({'), 'restart apply path must route through applyRestart');
for (const forbidden of [
  'writeVersionFromSpec(',
  "updateMarkdownFrontmatter(join(sourceVersion.path, 'index.md')",
  "updateMarkdownFrontmatter(join(taskGroup.path, 'index.md')",
  'updateMarkdownFrontmatter(activeSnapshot.path',
  'const workLogPath = join(projectDir',
]) {
  assert.equal(restartApplySection.includes(forbidden), false, `restart apply path bypasses helper via ${forbidden}`);
}

console.log('OK version flow writer facade');
