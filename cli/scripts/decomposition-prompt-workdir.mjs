#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildAgentDecompositionPrompt } from '../lib-runner.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-decomposition-prompt-workdir-'));
const projectDir = join(tempRoot, 'relative-work');
const resolvedProjectDir = resolve(projectDir);

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
assert.match(
  prompt,
  new RegExp(`taskops decompose ${resolvedProjectDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --task-group-id <child-tg-id> --spec <spec\\.json>`),
  'decomposition prompt must include the resolved absolute project dir in the taskops decompose command',
);
assert.equal(prompt.includes('Target child task group id: tg-open-child'), true);
assert.equal(prompt.includes('Target version id: tgv-open-child-v1'), true);

console.log('decomposition-prompt-workdir smoke passed');
