#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentDecompositionPrompt } from '../lib-runner.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-decomposition-prompt-workdir-'));
const projectDir = join(tempRoot, 'relative-work');
const resolvedProjectDir = resolve(projectDir);
const taskopsCliPath = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'taskops.js'));

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_/:=.,+%-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

const prompt = buildAgentDecompositionPrompt({
  project: {
    id: 'prompt-workdir-smoke',
    title: 'Prompt workdir smoke',
    objective: 'Verify decomposition prompts carry an absolute target work dir.',
  },
  projectDir,
  task: {
    id: 'task-open-child',
    title: 'Open child',
    objective: 'Decompose this task.',
    responsibility: 'Exercise prompt path contract.',
    completionCriteria: 'Prompt includes an absolute work dir.',
    uncertaintyState: 'known_unknown',
    confidenceScore: 0.5,
  },
  childTaskGroupId: 'tg-open-child',
  versionId: 'tgv-open-child-v1',
});

assert.equal(prompt.includes('<work-dir>'), false, 'decomposition prompt must not leak literal <work-dir>');
assert.doesNotMatch(prompt, /`taskops decompose /, 'decomposition prompt must not rely on PATH-resolved bare taskops');
const expectedCommand = `${shellQuote(process.execPath)} ${shellQuote(taskopsCliPath)} decompose ${shellQuote(resolvedProjectDir)} --task-group-id <child-tg-id> --spec <spec.json>`;
assert.match(prompt, new RegExp(escapeRegExp(expectedCommand)), 'decomposition prompt must pin the repo CLI and resolved absolute project dir');
assert.equal(prompt.includes('Target child task group id: tg-open-child'), true);
assert.equal(prompt.includes('Target version id: tgv-open-child-v1'), true);

console.log('decomposition-prompt-workdir smoke passed');
