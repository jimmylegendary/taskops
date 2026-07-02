#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildAgentExecutionPrompt,
  SELF_RESOLUTION_GUIDE,
} from '../lib-runner.js';

const BASE_OFF_PROMPT_SHA256 = '4b9e25767932f3f648dc12e173672f6e1d8bc9868987460aebbbdbc9530d58f8';

const project = {
  id: 'self-guide-work',
  title: 'Self Guide Work',
  objective: 'Validate self-resolution prompt injection.',
};

const task = {
  id: 'task-self-guide',
  title: 'Self guide task',
  objective: 'Check delegation-mode prompt behavior.',
  responsibility: 'Own the self-resolution guide fixture.',
  completionCriteria: 'Prompt output matches expected static contracts.',
};

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

const baselinePrompt = buildAgentExecutionPrompt({ project, task });
const explicitOffPrompt = buildAgentExecutionPrompt({ project, task, delegationMode: false });

assert.equal(explicitOffPrompt, baselinePrompt, 'delegationMode:false must be byte-identical to omitted delegationMode');
assert.equal(baselinePrompt.includes('self_resolution_mode'), false, 'default execute prompt must not include self-resolution mode');
assert.equal(explicitOffPrompt.includes('self_resolution_mode'), false, 'delegationMode:false prompt must not include self-resolution mode');

const enabledPrompt = buildAgentExecutionPrompt({ project, task, delegationMode: true });
assert.ok(enabledPrompt.includes(SELF_RESOLUTION_GUIDE), 'delegationMode:true prompt should contain the full self-resolution guide');
assert.ok(enabledPrompt.includes('<self_resolution_mode>'), 'delegationMode:true prompt should contain the XML guide tag');

const overridePrompt = buildAgentExecutionPrompt({
  project,
  task,
  delegationMode: true,
  selfResolutionGuide: '<x>OVERRIDE</x>',
});
assert.ok(overridePrompt.includes('<x>OVERRIDE</x>'), 'custom selfResolutionGuide should be injected when provided');
assert.equal(overridePrompt.includes(SELF_RESOLUTION_GUIDE), false, 'custom selfResolutionGuide should replace the default guide');

const selfResolverPrompt = buildAgentExecutionPrompt({
  project,
  task: { ...task, resolverKind: 'self' },
});
assert.ok(selfResolverPrompt.includes(SELF_RESOLUTION_GUIDE), "resolverKind:'self' should inject the default self-resolution guide without delegationMode");
assert.ok(selfResolverPrompt.includes('<self_resolution_mode>'), "resolverKind:'self' prompt should contain the XML guide tag");

const explicitOffSelfResolverPrompt = buildAgentExecutionPrompt({
  project,
  task: { ...task, resolverKind: 'self' },
  delegationMode: false,
});
assert.ok(explicitOffSelfResolverPrompt.includes(SELF_RESOLUTION_GUIDE), "resolverKind:'self' should inject the guide when delegationMode:false");

const humanResolverPrompt = buildAgentExecutionPrompt({
  project,
  task: { ...task, resolverKind: 'human' },
});
assert.equal(humanResolverPrompt.includes('self_resolution_mode'), false, "resolverKind:'human' should not inject self-resolution mode without delegationMode");

const selfResolverOverridePrompt = buildAgentExecutionPrompt({
  project,
  task: { ...task, resolverKind: 'self' },
  selfResolutionGuide: '<x>OVERRIDE</x>',
});
assert.ok(selfResolverOverridePrompt.includes('<x>OVERRIDE</x>'), "resolverKind:'self' should inject custom selfResolutionGuide when provided");
assert.equal(selfResolverOverridePrompt.includes(SELF_RESOLUTION_GUIDE), false, "resolverKind:'self' custom guide should replace the default guide");

assert.equal(
  sha256(explicitOffPrompt),
  BASE_OFF_PROMPT_SHA256,
  'no resolverKind and delegationMode:false prompt should remain byte-identical to base main 10de642 fixture prompt',
);

console.log('OK self-resolution guide');
