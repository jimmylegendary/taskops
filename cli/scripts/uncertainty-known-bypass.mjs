#!/usr/bin/env node
// Regression (ultrareview B1): declaring uncertaintyState:'known' must NOT be a single-field bypass
// of the override-resistant readiness downgrade. A 'known' task with a full runnable contract that
// ALSO carries contradicting metadata (explorationNeeded / declared unknowns / understandingLevel
// unknown / low confidence / blocked) must be downgraded, not classified runnable.
import assert from 'node:assert/strict';
import { classifyTaskReadiness } from '../lib-taskops.js';

const contract = {
  id: 'task-b1',
  objective: 'Do the thing.',
  responsibility: 'Own the thing.',
  completionCriteria: 'The thing is done and asserted.',
  status: 'pending',
  runReadiness: 'runnable',
  understandingLevel: 'known',
  uncertaintyState: 'known',
};

function classify(overrides) {
  return classifyTaskReadiness({ ...contract, ...overrides });
}

// Each contradiction must override 'known' and downgrade away from runnable.
const cases = [
  { name: 'explorationNeeded', overrides: { explorationNeeded: true }, code: 'uncertainty_runnable_exploration_flag', to: 'needs_exploration' },
  { name: 'declared unknowns', overrides: { unknowns: ['which database?'] }, code: 'uncertainty_runnable_declared_unknowns', to: 'needs_exploration' },
  { name: 'understandingLevel unknown', overrides: { understandingLevel: 'unknown' }, code: 'uncertainty_runnable_unknown_understanding', to: 'needs_exploration' },
  { name: 'low executionConfidence', overrides: { executionConfidence: 0.1 }, code: 'uncertainty_runnable_low_executionConfidence', to: 'needs_exploration' },
];

for (const c of cases) {
  const r = classify(c.overrides);
  assert.notEqual(r.runReadiness, 'runnable', `B1[${c.name}]: 'known' + contradiction must not stay runnable`);
  assert.equal(r.runReadiness, c.to, `B1[${c.name}]: must downgrade to ${c.to}`);
  assert.equal(r.originalRunReadiness, 'runnable', `B1[${c.name}]: original uncertainty verdict was runnable`);
  assert.ok((r.consistencyIssues || []).some((i) => i.code === c.code), `B1[${c.name}]: must record issue ${c.code}`);
}

// Positive control: a clean 'known' task with a full contract and no contradictions stays runnable.
const clean = classify({ confidenceScore: 0.9, knownList: [{ id: 'k1', claim: 'contract is executable', verificationStatus: 'unverified' }] });
assert.equal(clean.runReadiness, 'runnable', 'a clean known task must remain runnable');

console.log('OK uncertainty known-bypass');
