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

function findFunctionBody(name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const braceStart = source.indexOf('{', start);
  assert.notEqual(braceStart, -1, `missing body for ${name}`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function assertSequence(body, labels, context) {
  let cursor = -1;
  for (const label of labels) {
    const next = body.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `${context}: expected '${label}' after offset ${cursor}`);
    cursor = next;
  }
}

const executeBody = sectionBetween('function executeRunnableTask', '\nexport function extendActiveSnapshot');
const closureSection = executeBody.slice(executeBody.indexOf('const finishedAt = isoNow();'));
assert.ok(closureSection.includes('closeExecutePartial({'), 'execute closure must route partial closure through helper');
assert.ok(closureSection.includes('closeExecuteFailure({'), 'execute closure must route failure closure through helper');
assert.ok(closureSection.includes('closeExecuteSuccess({'), 'execute closure must route success closure through helper');

for (const forbidden of [
  'writeTaskPartialMarker(',
  'updateMarkdownFrontmatter(',
  'closeTaskWithEow(',
  'closeRunNodeWithEow(',
  'logEvent(',
  'appendRunLog(',
]) {
  assert.equal(closureSection.includes(forbidden), false, `execute closure bypasses helper via ${forbidden}`);
}

assertSequence(
  findFunctionSection('closeExecutePartial', '\nfunction closeExecuteFailure'),
  [
    'writeTaskPartialMarker({',
    'const partialCompletion = {',
    'updateMarkdownFrontmatter(task.path',
    'updateMarkdownFrontmatter(runNodePath',
    'logEvent(eventsPath',
    'appendRunLog(runDir',
    'return {',
  ],
  'closeExecutePartial write order',
);

assertSequence(
  findFunctionSection('closeExecuteFailure', '\nfunction closeExecuteSuccess'),
  [
    'updateMarkdownFrontmatter(task.path',
    'if (runNodeUpdater) updateMarkdownFrontmatter(runNodePath',
    'logEvent(eventsPath',
    'appendRunLog(runDir',
    'return actionResult',
  ],
  'closeExecuteFailure write order',
);

assertSequence(
  findFunctionSection('closeExecuteSuccess', '\nfunction executeRunnableTask'),
  [
    'appendSurpriseHistory({',
    'updateMarkdownFrontmatter(task.path',
    'updateMarkdownFrontmatter(runNodePath',
    'parseMarkdownFile(runNodePath)',
    'writeReviewForRunNode({',
    'closeTaskWithEow({',
    'closeRunNodeWithEow({',
    'logEvent(eventsPath',
    'appendRunLog(runDir',
    'return {',
  ],
  'closeExecuteSuccess write order',
);

console.log('OK execute closure writer facade');
