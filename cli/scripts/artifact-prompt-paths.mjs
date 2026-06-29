#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildAgentExplorationPrompt,
  buildAgentLoopbackPrompt,
} from '../lib-runner.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-artifact-prompt-paths-'));

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

try {
  const project = {
    id: 'artifact-prompt-paths',
    title: 'Artifact Prompt Paths',
    objective: 'Verify worker artifact prompts carry absolute target paths.',
  };
  const task = {
    id: 'task-explore',
    title: 'Explore absolute artifact path',
    objective: 'Exercise exploration artifact path prompt.',
    responsibility: 'Own the exploration artifact path contract.',
    completionCriteria: 'Prompt includes an absolute artifact path.',
  };
  const explorationArtifactPath = resolve(tempRoot, 'work', 'runs', 'run-main', 'artifacts', 'run-node-explore.md');
  const explorationPrompt = buildAgentExplorationPrompt({
    project,
    task,
    runId: 'run-main',
    runNodeId: 'run-node-explore',
    artifactPath: explorationArtifactPath,
  });
  assert.match(
    explorationPrompt,
    new RegExp(`Write the exploration artifact at: ${escapeRegExp(explorationArtifactPath)}`),
    'exploration prompt must include the absolute artifact path the runner validates',
  );
  assert.doesNotMatch(
    explorationPrompt,
    /Write the exploration artifact at: runs\/run-main\/artifacts\//,
    'exploration prompt must not give a project-relative artifact path',
  );

  const loopbackArtifactPath = resolve(tempRoot, 'work', 'runs', 'run-main', 'artifacts', 'run-node-loopback.md');
  const loopbackPrompt = buildAgentLoopbackPrompt({
    project,
    delegate: {
      runId: 'run-main',
      id: 'run-node-delegate',
      status: 'waiting',
      type: 'delegate',
      request: 'Resolve the waiting work.',
      expectedOutput: 'A concrete resolution artifact.',
      sourceTaskId: task.id,
      sourceTaskGroupVersionId: 'tgv-root-v1',
    },
    runId: 'run-main',
    loopbackNodeId: 'run-node-loopback',
    artifactPath: loopbackArtifactPath,
    actorName: 'self',
  });
  assert.match(
    loopbackPrompt,
    new RegExp(`Write the loopback resolution artifact at: ${escapeRegExp(loopbackArtifactPath)}`),
    'loopback prompt must include the absolute artifact path the runner validates',
  );
  assert.doesNotMatch(
    loopbackPrompt,
    /Write the loopback resolution artifact at: runs\/run-main\/artifacts\//,
    'loopback prompt must not give a project-relative artifact path',
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('artifact prompt paths smoke passed');
