#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildAgentDecompositionPrompt,
  buildAgentExecutionPrompt,
  computeStepBudget,
  parsePartialRequestFromExecutorResult,
  PARTIAL_REQUEST_PREFIX,
} from '../lib-runner.js';

const finishingBudget = computeStepBudget({ stepsRun: 0, maxSteps: 2, budgetEnabled: true });
const project = { id: 'partial-request-work', title: 'Partial request work', objective: 'Verify partial request protocol prompts.' };
const task = {
  id: 'task-partial-request',
  title: 'Partial request task',
  objective: 'Exercise the runner-owned partial request protocol.',
  responsibility: 'Return a deterministic partial request only when prompted.',
  completionCriteria: 'Prompt and parser behavior are deterministic.',
};

const executionPrompt = buildAgentExecutionPrompt({ project, task, budget: finishingBudget });
assert.match(executionPrompt, /Execution partial request protocol:/);
assert.match(executionPrompt, /Do not call closure or graph-control commands/);
assert.match(executionPrompt, new RegExp(PARTIAL_REQUEST_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(executionPrompt, /"partialRequested": true/);

const decompositionPrompt = buildAgentDecompositionPrompt({
  project,
  projectDir: '/tmp/taskops-partial-request-protocol-prompt',
  task,
  childTaskGroupId: 'tg-child',
  versionId: 'tgv-child-v1',
  budget: finishingBudget,
});
assert.doesNotMatch(decompositionPrompt, /Execution partial request protocol:/);
assert.doesNotMatch(decompositionPrompt, new RegExp(PARTIAL_REQUEST_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(decompositionPrompt, /Budget \/ finishing mode:/, 'non-execution prompts should still get the generic finishing signal');

const noMarker = parsePartialRequestFromExecutorResult({
  ok: true,
  message: 'I considered a partial approach, but I finished normally.',
});
assert.deepEqual(noMarker, { partialRequested: false, markerFound: false });

const directMarker = parsePartialRequestFromExecutorResult({
  ok: true,
  message: [
    'Completed the safe first slice.',
    `${PARTIAL_REQUEST_PREFIX} {"partialRequested": true, "completedSummary": "Created analysis.md", "incompleteSummary": "Need implementation-notes.md and final-brief.md"}`,
  ].join('\n'),
});
assert.equal(directMarker.partialRequested, true);
assert.equal(directMarker.completedSummary, 'Created analysis.md');
assert.equal(directMarker.incompleteSummary, 'Need implementation-notes.md and final-brief.md');
assert.equal(directMarker.followUpNeeded, true);

const openClawRaw = JSON.stringify({
  runId: 'openclaw-run',
  status: 'ok',
  result: {
    finalAssistantRawText: [
      'Created one artifact and stopped honestly.',
      `${PARTIAL_REQUEST_PREFIX} {"partialRequested": true, "completedSummary": "Created analysis.md", "incompleteSummary": "Need the remaining two artifacts", "followUpNeeded": true}`,
    ].join('\n'),
  },
});
const openClawMarker = parsePartialRequestFromExecutorResult({ ok: true, stdout: openClawRaw });
assert.equal(openClawMarker.partialRequested, true);
assert.equal(openClawMarker.completedSummary, 'Created analysis.md');
assert.equal(openClawMarker.incompleteSummary, 'Need the remaining two artifacts');

const payloadMarker = parsePartialRequestFromExecutorResult({
  ok: true,
  message: JSON.stringify({
    result: {
      payloads: [{
        text: `${PARTIAL_REQUEST_PREFIX} {"partialRequested": true, "completedSummary": "Finished data collection", "incompleteSummary": "Need synthesis", "followUpNeeded": false}`,
      }],
    },
  }),
});
assert.equal(payloadMarker.partialRequested, true);
assert.equal(payloadMarker.completedSummary, 'Finished data collection');
assert.equal(payloadMarker.incompleteSummary, 'Need synthesis');
assert.equal(payloadMarker.followUpNeeded, false);

const malformed = parsePartialRequestFromExecutorResult({
  ok: true,
  message: `${PARTIAL_REQUEST_PREFIX} {"partialRequested": true,`,
});
assert.equal(malformed.partialRequested, false);
assert.equal(malformed.markerFound, true);
assert.match(malformed.parseError, /JSON/);

const falseMarker = parsePartialRequestFromExecutorResult({
  ok: true,
  message: `${PARTIAL_REQUEST_PREFIX} {"partialRequested": false, "completedSummary": "x", "incompleteSummary": "y"}`,
});
assert.equal(falseMarker.partialRequested, false);
assert.equal(falseMarker.markerFound, true);
assert.equal(falseMarker.ignoredReason, 'partial_requested_not_true');

console.log('partial request protocol smoke passed');
