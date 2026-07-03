#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  deriveExternalResolutionStatus,
} from '../lib-taskops.js';
import {
  EXTERNAL_RESOLUTION_TEMPLATE,
} from '../lib-runner.js';

const waitingBody = EXTERNAL_RESOLUTION_TEMPLATE;
const resolvedBody = waitingBody
  .replace('<resolver: the concrete, downstream-consumable choice — a value, not prose>', 'OAuth 2.0 with PKCE')
  .replace('<resolver: the grounds for this decision>', 'Partner delegation is on the roadmap.');
const decisionOnlyBody = waitingBody
  .replace('<resolver: the concrete, downstream-consumable choice — a value, not prose>', 'OAuth 2.0 with PKCE');
const basisOnlyBody = waitingBody
  .replace('<resolver: the grounds for this decision>', 'Partner delegation is on the roadmap.');
const missingBasisBody = resolvedBody.split('\n').filter((line) => line.trim() !== '## BASIS').join('\n');

assert.equal(resolvedBody.includes('<resolver:'), false, 'resolved body should replace every resolver placeholder');
assert.equal(deriveExternalResolutionStatus({ resolverKind: 'self', body: resolvedBody }), 'none');
assert.equal(deriveExternalResolutionStatus({ resolverKind: undefined, body: waitingBody }), 'none');
assert.equal(deriveExternalResolutionStatus({ resolverKind: 'human', body: waitingBody }), 'waiting');
assert.equal(deriveExternalResolutionStatus({ resolverKind: 'human', body: resolvedBody }), 'resolved');
assert.equal(deriveExternalResolutionStatus({ resolverKind: 'human', body: decisionOnlyBody }), 'invalid');
assert.equal(deriveExternalResolutionStatus({ resolverKind: 'human', body: basisOnlyBody }), 'invalid');
assert.equal(deriveExternalResolutionStatus({ resolverKind: 'human', body: missingBasisBody }), 'invalid');
assert.equal(deriveExternalResolutionStatus({ resolverKind: 'ai', body: resolvedBody }), 'resolved');
assert.equal(deriveExternalResolutionStatus({ resolverKind: 'human', body: '' }), 'invalid');

console.log('OK external resolution status');
