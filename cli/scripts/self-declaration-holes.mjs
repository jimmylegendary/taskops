#!/usr/bin/env node
// Regression (ultrareview B2/B3): close two self-declaration holes in the uncertainty machinery.
//  B2 — an inherited known reference is revalidated only by a locally VERIFIED known (or an
//       execution-discovered known), not by a single self-declared UNVERIFIED knownList entry.
//  B3 — informationGainConvergence must not report convergence from unscored (missing surpriseScore)
//       observations; silence is not evidence of low surprise.
import assert from 'node:assert/strict';
import { classifyTaskReadiness, informationGainConvergence } from '../lib-taskops.js';

// ---- B2 ----
const inherited = { inheritedFrom: { inheritedKnownRefs: [{ sourceKnownId: 'k-parent', trust: 'inherited_unverified' }] } };
const base = {
  id: 'task-b2', objective: 'Do the thing.', responsibility: 'Own it.', completionCriteria: 'Asserted done.',
  status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', uncertaintyState: 'known',
};

const unverified = classifyTaskReadiness({ ...base, ...inherited, knownList: [{ id: 'k', claim: 'x', verificationStatus: 'unverified' }] });
assert.equal(unverified.runReadiness, 'needs_exploration', 'B2: an unverified local known must not satisfy the inherited-known revalidation gate');
assert.ok((unverified.consistencyIssues || []).some((i) => i.code === 'inherited_only_known_not_runnable'), 'B2: must record the inherited-only-known issue');

const verified = classifyTaskReadiness({ ...base, ...inherited, knownList: [{ id: 'k', claim: 'x', verificationStatus: 'verified' }] });
assert.equal(verified.runReadiness, 'runnable', 'B2: a locally VERIFIED known revalidates the inherited reference → runnable');

// ---- B3 ----
const unscored = informationGainConvergence({ surpriseHistory: [{ observedAt: 'a' }, { observedAt: 'b' }, { observedAt: 'c' }] });
assert.equal(unscored.converged, false, 'B3: three unscored observations must NOT converge');
assert.equal(unscored.unscoredCount, 3, 'B3: unscored observations are counted');

const scored = informationGainConvergence({ surpriseHistory: [{ surpriseScore: 0.05 }, { surpriseScore: 0.1 }, { surpriseScore: 0 }] });
assert.equal(scored.converged, true, 'B3: three finite low-surprise observations converge');

const mixed = informationGainConvergence({ surpriseHistory: [{ surpriseScore: 0.05 }, { observedAt: 'no-score' }, { surpriseScore: 0 }] });
assert.equal(mixed.converged, false, 'B3: even one unscored observation blocks convergence');

console.log('OK self-declaration holes (B2/B3)');
