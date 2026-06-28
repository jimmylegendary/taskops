#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile, parseProject } from '../lib-taskops.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-expected-plan-'));

const expectedPlan = {
  expectedDepth: 2,
  expectedBreadth: 3,
  rationale: 'The child should open at most two further decomposition levels for the evidence package.',
  declaredAt: '2026-06-29T00:00:00Z',
};

function run(args, { expectStatus = 0 } = {}) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  if (result.status !== expectStatus) {
    throw new Error(`taskops ${args.join(' ')} expected status ${expectStatus}, got ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function json(args) {
  return JSON.parse(run([...args, '--json']));
}

function taskPath(workDir, versionId, taskId) {
  return join(workDir, 'task-groups', 'tg-root', 'versions', versionId, 'tasks', `${taskId}.md`);
}

function assertExpectedPlan(task, message) {
  assert.deepEqual(task.expectedPlan, expectedPlan, message);
}

const workDir = join(tempRoot, 'work');
run(['init', workDir, '--id', 'expected-plan-preservation', '--title', 'Expected plan preservation', '--objective', 'Verify expectedPlan survives version rewrites.', '--language', 'en']);

const specPath = join(tempRoot, 'spec.json');
writeFileSync(specPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Expected plan fixture root',
  selected: true,
  tasks: [
    {
      id: 'task-plan',
      title: 'Planned child task',
      objective: 'Carry expectedPlan through graph rewrites.',
      responsibility: 'Hold the expected plan metadata as canonical task frontmatter.',
      completionCriteria: 'expectedPlan remains present after write, restart, and promotion.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      understandingLevel: 'known',
      expectedPlan,
    },
  ],
}), 'utf8');

run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');

const v2Task = parseMarkdownFile(taskPath(workDir, 'tgv-root-v2', 'task-plan'));
assertExpectedPlan(v2Task, 'writeVersionFromSpec should accept and preserve expectedPlan from spec tasks');
assert.deepEqual(parseProject(workDir).errors, []);

run(['restart', workDir, '--from', 'task-plan', '--instruction', 'Restart while preserving expectedPlan.', '--reason', 'expected_plan_preservation']);
const v3Task = parseMarkdownFile(taskPath(workDir, 'tgv-root-v3', 'task-plan'));
assertExpectedPlan(v3Task, 'restartFromTask should preserve expectedPlan');
assert.deepEqual(parseProject(workDir).errors, []);

const partialDir = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v3', 'partials');
mkdirSync(partialDir, { recursive: true });
writeFileSync(
  join(partialDir, 'partial-task-plan.md'),
  `---\ntaskOpsVersion: v1\nentityType: partial\nid: partial-task-plan\ngraphType: task\nattachedToType: task\nattachedToId: task-plan\ntaskGroupVersionId: tgv-root-v3\nreason: partial_complete\ndeclaredBy: expected-plan-preservation\ndeclaredAt: 2026-06-29T00:00:00Z\ncreatedAt: 2026-06-29T00:00:00Z\nstatus: active\ncompletedSummary: Preserved expected plan through restart.\nincompleteSummary: Promote the partial and keep expected plan metadata on the source task.\nfollowUpNeeded: true\nsupersededBy: null\nbudget:\n  enabled: false\n---\n# Partial: task-plan\n`,
  'utf8',
);

const promoted = json(['promote-partials', workDir, '--apply', '--partial-id', 'partial-task-plan']);
assert.equal(promoted.applied, true);
assert.equal(promoted.appliedVersionPlans[0].toVersionId, 'tgv-root-v4');
assert.equal(existsSync(taskPath(workDir, 'tgv-root-v4', 'task-plan')), true);

const v4Task = parseMarkdownFile(taskPath(workDir, 'tgv-root-v4', 'task-plan'));
assertExpectedPlan(v4Task, 'cloneTaskForPromotion should preserve expectedPlan on the cloned source task');
assert.deepEqual(parseProject(workDir).errors, []);

console.log('expected plan preservation smoke passed');
