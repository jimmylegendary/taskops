#!/usr/bin/env node
import assert from 'node:assert/strict';
import { classifyTaskReadiness } from '../lib-taskops.js';

const baseTask = {
  id: 'task-readiness-fixture',
  title: 'Readiness fixture',
  objective: 'Verify readiness classification.',
  responsibility: 'Own one executable unit.',
  completionCriteria: 'The expected behavior is asserted.',
  status: 'pending',
  runReadiness: 'runnable',
  understandingLevel: 'known',
};

function classify(overrides) {
  return classifyTaskReadiness({ ...baseTask, ...overrides });
}

function expectDowngrade(name, overrides, expectedReadiness, expectedIssueCode) {
  const result = classify(overrides);
  assert.equal(result.runReadiness, expectedReadiness, name);
  assert.equal(result.originalRunReadiness, 'runnable', name);
  assert.equal(result.source, 'explicit_with_consistency_downgrade', name);
  assert.ok(
    result.consistencyIssues.some((issue) => issue.code === expectedIssueCode),
    `${name}: missing consistency issue ${expectedIssueCode}`,
  );
}

expectDowngrade(
  'explicit runnable with declared unknowns must become exploratory',
  { unknowns: ['API behavior is not understood'] },
  'needs_exploration',
  'explicit_runnable_declared_unknowns',
);

expectDowngrade(
  'explicit runnable with exploration flag must become exploratory',
  { explorationNeeded: true },
  'needs_exploration',
  'explicit_runnable_exploration_flag',
);

const partialReady = classify({ understandingLevel: 'partial' });
assert.equal(partialReady.runReadiness, 'runnable');
assert.equal(partialReady.source, 'explicit');
assert.ok(
  partialReady.consistencyIssues.some((issue) => issue.code === 'explicit_runnable_partial_understanding' && issue.severity === 'warning'),
  'explicit runnable with partial understanding should remain runnable but warn',
);

expectDowngrade(
  'explicit runnable with low execution confidence must become exploratory',
  { executionConfidence: 0.4 },
  'needs_exploration',
  'explicit_runnable_low_executionConfidence',
);

expectDowngrade(
  'explicit runnable with incomplete runner-managed acceptance must block',
  {
    acceptance: {
      mode: 'runner-managed',
      expectedOutcome: '',
      requiredArtifacts: [],
      requiredChecks: [],
    },
  },
  'blocked',
  'explicit_runnable_incomplete_guarded_acceptance',
);

const guardedReady = classify({
  acceptance: {
    mode: 'guarded',
    expectedOutcome: 'A concrete result is produced.',
    requiredChecks: ['node ./scripts/readiness-gate.mjs'],
  },
});
assert.equal(guardedReady.runReadiness, 'runnable');
assert.equal(guardedReady.consistencyIssues.length, 0);

const legacyManual = classify({});
assert.equal(legacyManual.runReadiness, 'runnable');
assert.equal(legacyManual.consistencyIssues.length, 0);

console.log('readiness-gate smoke passed');
