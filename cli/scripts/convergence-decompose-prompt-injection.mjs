#!/usr/bin/env node
// Round B — 실제 prompt 반환값으로 수렴 압력 주입과 연장 protocol 조건을 검증한다.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildAgentDecompositionPrompt,
  buildAgentExecutionPrompt,
  buildAgentExplorationPrompt,
} from '../lib-runner.js';

const project = { id: 'round-b-prompt', title: 'Round B prompt', objective: '수렴 prompt 계약 검증' };
const task = {
  id: 'task-round-b', title: 'Round B task', objective: '검증 가능한 자식으로 분해한다.',
  responsibility: 'prompt 계약 검증', completionCriteria: '단계별 지시를 반환한다.',
  uncertaintyState: 'known_unknown', confidenceScore: 0.5,
  expectedPlan: { expectedDepth: 2, expectedBreadth: 3, rationale: '두 단계 fixture.' },
};
const extensionPrefix = 'TASKOPS_BUDGET_EXTENSION_REQUEST:';

function decompositionPrompt(convergence) {
  return buildAgentDecompositionPrompt({
    project, projectDir: process.cwd(), task,
    childTaskGroupId: 'tg-round-b-child', versionId: 'tgv-round-b-child-v1',
    budget: null, convergence,
  });
}

function executionPrompt(convergence) {
  return buildAgentExecutionPrompt({ project, task, projectDir: process.cwd(), budget: null, convergence });
}

function explorationPrompt(convergence) {
  return buildAgentExplorationPrompt({
    project, task, runId: 'run-round-b', runNodeId: 'rn-round-b',
    artifactPath: join(tmpdir(), 'taskops-round-b-exploration.md'), budget: null, convergence,
  });
}

const nullPrompt = decompositionPrompt(null);
const nonePrompt = decompositionPrompt({ level: 'none', firedAxes: ['budget'], extensionWindowOpen: true, grantsRemaining: 2 });
assert.equal(nonePrompt, nullPrompt, 'level=none은 convergence=null과 바이트 단위로 같아야 한다');
assert.equal(nullPrompt.includes('수렴 압력'), false, '미발화 prompt에는 수렴 압력 문구가 없어야 한다');
assert.equal(nonePrompt.includes(extensionPrefix), false, '미발화 prompt에는 연장 protocol이 없어야 한다');

const softPrompt = decompositionPrompt({ level: 'soft', firedAxes: ['budget', 'depth'], extensionWindowOpen: false, grantsRemaining: 2 });
assert.equal(softPrompt.includes('즉시 실행 가능한 단위'), true, 'soft는 실행 가능한 자식 단위를 요구해야 한다');
assert.equal(softPrompt.includes('requiredChecks'), true, 'soft는 requiredChecks 계약을 명시해야 한다');
assert.equal(softPrompt.includes('needs_decomposition / needs_exploration 자식을 만들지 마라'), false, 'soft에 hard 전용 문구가 있으면 안 된다');
assert.equal(softPrompt.includes('수렴 압력: SOFT (발화 축: budget, depth)'), true, 'soft는 발화 축을 보여줘야 한다');

const hardPrompt = decompositionPrompt({ level: 'hard', firedAxes: ['openPlanDebt'], extensionWindowOpen: true, grantsRemaining: 2 });
assert.equal(hardPrompt.includes('needs_decomposition / needs_exploration 자식을 만들지 마라'), true, 'hard는 계획 자식 생성을 차단해야 한다');
assert.equal(hardPrompt.includes('검증 가능한 완료조건'), true, 'hard는 검증 가능한 완료조건을 요구해야 한다');
assert.equal(hardPrompt.includes('expectedDepth 는 0'), true, 'hard는 모든 자식을 리프로 제한해야 한다');
assert.equal(hardPrompt.includes(extensionPrefix), false, 'hard에는 연장 protocol이 없어야 한다');

const softExtension = { level: 'soft', firedAxes: ['budget'], extensionWindowOpen: true, grantsRemaining: 2 };
assert.equal(decompositionPrompt(softExtension).includes(extensionPrefix), true, 'budget=null이어도 soft 열린 창에는 protocol이 있어야 한다');
assert.equal(decompositionPrompt({ ...softExtension, extensionWindowOpen: false }).includes(extensionPrefix), false, '닫힌 창에는 protocol이 없어야 한다');
assert.equal(decompositionPrompt({ ...softExtension, grantsRemaining: 0 }).includes(extensionPrefix), false, 'grant가 없으면 protocol이 없어야 한다');

for (const [name, buildPrompt] of [['execute', executionPrompt], ['explore', explorationPrompt]]) {
  assert.equal(buildPrompt(softExtension).includes(extensionPrefix), true, name + '도 soft 열린 창에서 protocol을 포함해야 한다');
  assert.equal(buildPrompt({ ...softExtension, level: 'hard' }).includes(extensionPrefix), false, name + '는 hard에서 protocol을 포함하면 안 된다');
  assert.equal(buildPrompt({ ...softExtension, level: 'none' }).includes(extensionPrefix), false, name + '는 미발화 때 protocol을 포함하면 안 된다');
}

console.log('convergence-decompose-prompt-injection smoke passed');
