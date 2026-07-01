#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const runnerPath = resolve(repoRoot, 'cli/lib-runner.js');
const source = readFileSync(runnerPath, 'utf8');

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

function assertSequence(body, labels, context) {
  let cursor = -1;
  for (const label of labels) {
    const next = body.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `${context}: expected '${label}' after offset ${cursor}`);
    cursor = next;
  }
}

const decomposeBody = sectionBetween('function executeDecompositionTask', '\nfunction performDryRunExploration');
const successClosure = decomposeBody.slice(decomposeBody.indexOf('if (!result.ok) {', decomposeBody.indexOf('const finishedAt = isoNow();')));
assert.ok(successClosure.includes('return closeDecomposeSuccess({'), 'decompose success must route through closeDecomposeSuccess');

for (const forbidden of [
  'ensureDecompositionBacklink({',
  'normalizeExpectedPlansForChildVersion({',
  'normalizeBlockedByForChildVersion({',
  'deferCommittingScopeChildrenForChildVersion({',
  'closeTaskWithEow({',
  'closeRunNodeWithEow({',
  'extendActiveSnapshot(parsed',
]) {
  assert.equal(successClosure.includes(forbidden), false, `decompose success closure bypasses helper via ${forbidden}`);
}

const helper = findFunctionSection('closeDecomposeSuccess', '\nfunction executeDecompositionTask');
assertSequence(
  helper,
  [
    'ensureDecompositionBacklink({',
    'if (!backlinkResult.ok) {',
    'updateMarkdownFrontmatter(task.path',
    'updateMarkdownFrontmatter(runNodePath',
    "type: 'decomposition_failed'",
    'appendRunLog(runDir',
    'return {',
    'const expectedPlanNormalization = normalizeExpectedPlansForChildVersion({',
    "type: 'expected_plan_fallback_applied'",
    'const blockedByNormalization = normalizeBlockedByForChildVersion({',
    "type: 'blockedby_normalization_unresolved'",
    'const committingScopeDeferral = deferCommittingScopeChildrenForChildVersion({',
    "type: 'committing_scope_deferred'",
    'updateMarkdownFrontmatter(task.path',
    'closeTaskWithEow({',
    'updateMarkdownFrontmatter(runNodePath',
    'closeRunNodeWithEow({',
    'const inheritedBirthSnapshot = applyInheritedBirthSnapshotToChildVersion({',
    "type: 'decomposition_completed'",
    'appendRunLog(runDir',
    'const extended = extendActiveSnapshot(parsed, {',
    "type: 'snapshot_extended'",
    'appendRunLog(runDir',
    'return {',
  ],
  'closeDecomposeSuccess write order',
);

const runLoopDecomposeSection = sectionBetween("} else if (next.kind === 'decompose') {", "} else if (next.kind === 'explore') {");
assert.ok(runLoopDecomposeSection.includes('executeDecompositionTask({'), 'run loop must still dispatch decompose tasks');
assert.ok(runLoopDecomposeSection.includes('parsed,'), 'run loop must pass parsed snapshot context into decompose closure helper');
assert.equal(runLoopDecomposeSection.includes('extendActiveSnapshot('), false, 'snapshot extension must not remain in the run loop decompose branch');
assert.equal(runLoopDecomposeSection.includes("type: 'snapshot_extended'"), false, 'snapshot_extended event must be emitted inside closeDecomposeSuccess');

console.log('OK decompose closure writer facade');
