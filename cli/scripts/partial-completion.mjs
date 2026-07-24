#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditParsedWork } from '../lib-audit.js';
import { parseMarkdownFile, parseProject } from '../lib-taskops.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-partial-'));

function run(args, expected = 0) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  if (res.status !== expected) {
    console.error('CMD FAILED', args.join(' '));
    console.error(res.stdout);
    console.error(res.stderr);
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(1);
  }
  return res;
}

function replaceInFile(path, from, to) {
  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes(from), `${path} should include ${from}`);
  writeFileSync(path, text.replace(from, to), 'utf8');
}

function makePartialWork(name) {
  const workDir = join(tempRoot, name);
  run(['init', workDir, '--id', name, '--title', name, '--objective', 'Partial completion smoke work', '--language', 'en']);
  const specPath = join(tempRoot, `${name}-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Partial completion task',
    selected: true,
    tasks: [{
      id: 'task-partial',
      title: 'Partial task',
      objective: 'Record honest unfinished progress without claiming completion.',
      responsibility: 'Own the partial marker smoke.',
      completionCriteria: 'The task can later receive canonical EoW closure.',
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'The fixture is runnable but intentionally left pending for partial close.',
      understandingLevel: 'known',
      order: 1,
    }],
  }, null, 2));
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  replaceInFile(snapshotPath, 'versionId: tgv-root-v1', 'versionId: tgv-root-v2');
  return workDir;
}

try {
  const workDir = makePartialWork('partial-work');
  const taskPath = join(workDir, 'task-groups/tg-root/versions/tgv-root-v2/tasks/task-partial.md');
  const canonicalEowPath = join(workDir, 'task-groups/tg-root/versions/tgv-root-v2/eow/eow-task-partial-tgv-root-v2.md');
  const beforeStatus = parseMarkdownFile(taskPath).status;

  const partial = JSON.parse(run([
    'close', workDir, 'task-partial',
    '--reason', 'partial_complete',
    '--completed-summary', 'Implemented the first half of the smoke fixture.',
    '--incomplete-summary', 'Need follow-up work to finish and approve the canonical task result.',
    '--budget-json', JSON.stringify({ enabled: true, stepsRun: 8, maxSteps: 10, remaining: 2, finishingMode: true }),
    '--json',
  ]).stdout);

  assert.equal(partial.partial, true, 'partial close should return partial=true');
  assert.equal(partial.closed, false, 'partial close must not claim terminal closure');
  assert.equal(partial.statusFlipped, false, 'partial close must not flip task status');
  assert.equal(parseMarkdownFile(taskPath).status, beforeStatus, 'partial close must preserve task status');
  assert.equal(existsSync(canonicalEowPath), false, 'partial close must not create a version-qualified canonical task EoW');

  let parsed = parseProject(workDir);
  assert.equal(parsed.errors.length, 0, parsed.errors.join('\n'));
  assert.equal(parsed.partialNodes.has(partial.partialId), true, 'partial marker should be parsed as a partial node');
  assert.equal(parsed.eowNodes.has(partial.partialId), false, 'partial marker must not enter eowNodes');
  assert.equal(parsed.closure.partialTaskCount, 1);
  assert.equal(parsed.closure.partialRunCount, 0);
  assert.equal(parsed.closure.partialCount, 1);
  assert.equal(parsed.closure.structuralComplete, false, 'partial marker must not count as terminal coverage');
  assert.equal(parsed.closure.openTerminalTaskCount, 1);

  const markerRaw = readFileSync(partial.partialPath, 'utf8');
  assert.match(markerRaw, /^supersededBy: null$/m, 'partial marker should reserve supersededBy: null');
  const marker = parseMarkdownFile(partial.partialPath);
  assert.equal(marker.entityType, 'partial');
  assert.equal(marker.incompleteSummary, 'Need follow-up work to finish and approve the canonical task result.');
  assert.equal(marker.followUpNeeded, true);
  assert.deepEqual(marker.budget, { enabled: true, stepsRun: 8, maxSteps: 10, remaining: 2, finishingMode: true });

  const audit = auditParsedWork(parsed);
  const partialIssue = audit.issues.find((issue) => issue.code === 'work_has_partial_completions');
  assert.ok(partialIssue, 'audit should report partial markers');
  assert.equal(partialIssue.severity, 'warning', 'partial markers are honest unfinished work, not an error');
  assert.equal(audit.claimSafe, false, 'partial work cannot be claim-safe');

  replaceInFile(taskPath, 'status: pending', 'status: done');
  const approved = JSON.parse(run(['close', workDir, 'task-partial', '--reason', 'approved_result', '--json']).stdout);
  assert.equal(approved.closed, true, 'canonical approved_result close should still work after partial marker');
  assert.equal(existsSync(canonicalEowPath), true, 'canonical EoW should be created after partial marker');

  parsed = parseProject(workDir);
  assert.equal(parsed.errors.length, 0, parsed.errors.join('\n'));
  assert.equal(parsed.eowNodes.has('eow-task-partial-tgv-root-v2'), true, 'canonical EoW should be parsed as an EoW node');
  assert.equal(parsed.partialNodes.has(partial.partialId), true, 'partial marker should remain separate evidence');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('partial completion smoke passed');
