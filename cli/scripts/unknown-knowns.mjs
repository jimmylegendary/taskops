#!/usr/bin/env node
// Regression (Unknown Knowns — the 4th uncertainty quadrant): a task whose uncertaintyState is 'unknown_known'
// (recognize-when-seen requirements) must NOT go straight to execute. It is classified needs_prototype -> the
// prototype action produces cheap alternatives and sets up a HUMAN pick (reusing external-resolution); the task
// is then HELD (delegation_pending) until the pick is filled, which surfaces the implicit requirement -> only
// THEN does it execute. Dry-run drives the whole flow deterministically.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile, parseProject, classifyTaskReadiness } from '../lib-taskops.js';
import { runTaskOps, pickNextAction, buildAgentExecutionPrompt } from '../lib-runner.js';

const now = '2026-07-04T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-uk-'));
const w = join(root, 'work');
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
const taskRel = `${tv}/tasks/uk.md`;
const taskAbs = join(w, taskRel);
for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'uk', title: 'UK', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
md(taskRel, {
  taskOpsVersion: 'v1', entityType: 'task', id: 'uk', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: 'Design the dashboard layout', objective: 'Build a metrics dashboard the team will like.',
  responsibility: 'Own the dashboard.', completionCriteria: 'Dashboard matches the intended style.',
  order: 1, createdAt: now, status: 'pending', understandingLevel: 'known',
  uncertaintyState: 'unknown_known', confidenceScore: 0.5, knownList: [], unknownKnowns: ['visual style', 'which metrics'],
  acceptance: { mode: 'informational', expectedOutcome: 'dashboard' },
});

// classification: unknown_known -> needs_prototype (NOT runnable/execute).
assert.equal(classifyTaskReadiness(parseMarkdownFile(taskAbs)).runReadiness, 'needs_prototype', 'unknown_known is classified needs_prototype');

// STEP 1: run the prototype action. It sets resolverKind=human + appends the pick question; the task stays OPEN.
runTaskOps(w, { executor: 'dry-run', maxSteps: 1 });
let task = parseMarkdownFile(taskAbs);
assert.equal(task.resolverKind, 'human', 'prototype sets up a human pick (resolverKind=human)');
assert.equal(task.status, 'waiting', 'the prototype persists a literal human wait without closing the task');
let body = readFileSync(taskAbs, 'utf8');
assert.ok(body.includes('## QUESTION') && body.includes('which prototype option'), 'the pick question (external-resolution block) is written into the task');

// STEP 2: before the pick is filled, the task is HELD (delegation_pending), never auto-executed.
const held = pickNextAction(parseProject(w));
assert.equal(held.kind, 'stop', 'an unresolved unknown_known pick must not be handed to execute');
assert.equal(held.reason, 'delegation_pending', 'it surfaces delegation_pending until the human picks');

// STEP 3: the human fills the pick (DECISION/BASIS) — surfacing the recognize-when-seen requirement.
const resolved = body
  .replace('<resolver: the concrete, downstream-consumable choice — a value, not prose>', 'Option 2: compact KPI grid, dark theme')
  .replace('<resolver: the grounds for this decision>', 'Matches the team dashboard the owner recognized on sight.');
assert.equal(resolved.includes('<resolver:'), false, 'the pick is fully filled');
writeFileSync(taskAbs, resolved, 'utf8');

// now runnable, and the external-resolution pause is cleared -> executes to done.
assert.equal(classifyTaskReadiness(parseMarkdownFile(taskAbs)).runReadiness, 'runnable', 'once the pick is set up + filled the task is runnable');

// the human PICK must actually reach the executor — recorded-but-ignored would defeat the feature.
const withPath = { ...parseMarkdownFile(taskAbs), path: taskAbs };
const prompt = buildAgentExecutionPrompt({ project: { id: 'uk', title: 'UK', objective: 'x' }, task: withPath });
const promptText = Array.isArray(prompt) ? prompt.join('\n') : String(prompt);
assert.ok(promptText.includes('Option 2: compact KPI grid'), 'the resolved human pick (surfaced requirement) is fed into the execution prompt, not ignored');
runTaskOps(w, { executor: 'dry-run', maxSteps: 2 });
assert.equal(parseMarkdownFile(taskAbs).status, 'done', 'after the human pick surfaces the requirement, the task executes to done');

// NOTE (documented limitation): a WELL-FORMED unknown_known task carries a full run-contract, so after the pick
// is set up it is 'runnable' and held by the execute-path external-resolution pause (the main path above). An
// unknown_known task with an INCOMPLETE contract classifies needs_decomposition instead; decomposition is a
// legitimate way to add structure and is NOT held (the same external-resolution mechanism is used by synthetic
// input-required placeholders that are MEANT to be decomposed), so that narrow edge is left to decompose.

rmSync(root, { recursive: true, force: true });
console.log('OK unknown-knowns (prototype -> hold -> pick fed to executor -> execute)');
