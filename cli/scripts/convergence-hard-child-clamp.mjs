#!/usr/bin/env node
// Round B — 실제 child frontmatter와 summary로 hard clamp 및 거짓 완료 방화벽을 검증한다.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeChildConvergenceContracts } from '../lib-runner.js';
import { fmBlock, parseMarkdownFile } from '../lib-taskops.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-convergence-hard-child-clamp-'));
const childTaskGroupId = 'tg-hard-child';
const versionId = 'tgv-hard-child-v1';
const unverifiableChildId = 'task-unverifiable-deep';
const parentTask = {
  id: 'task-hard-parent', uncertaintyState: 'unknown_unknown',
  expectedPlan: { expectedDepth: 3, expectedBreadth: 2, rationale: '기본 모드에서 자식 depth 2를 허용한다.' },
  acceptance: { mode: 'guarded', requiredChecks: ['npm run parent-only-check'] },
};

function writeTask(taskPath, task) {
  writeFileSync(taskPath, fmBlock(task) + '\n\n# ' + task.title + '\n', 'utf8');
}

function makeFixture(name) {
  const projectDir = join(tempRoot, name);
  const tasksDir = join(projectDir, 'task-groups', childTaskGroupId, 'versions', versionId, 'tasks');
  mkdirSync(tasksDir, { recursive: true });
  writeTask(join(tasksDir, unverifiableChildId + '.md'), {
    taskOpsVersion: '0.1', entityType: 'task', id: unverifiableChildId,
    taskGroupId: childTaskGroupId, taskGroupVersionId: versionId,
    title: '검증 불가 deep 자식', objective: 'hard clamp 방화벽 검증', responsibility: 'hard clamp 대상',
    completionCriteria: '검증 조건 없이 생성된 자식', order: 1, createdAt: '2026-07-30T00:00:00.000Z',
    status: 'pending', runReadiness: 'needs_decomposition', uncertaintyState: 'unknown_unknown', confidenceScore: 0.2,
    expectedPlan: { expectedDepth: 2, expectedBreadth: 2, rationale: '두 단계가 더 필요하다고 잘못 선언했다.' },
    acceptance: { mode: 'guarded', expectedOutcome: '검증 조건 없이 생성된 자식', requiredChecks: [], requiredArtifacts: [] },
  });
  writeTask(join(tasksDir, 'task-verifiable-leaf.md'), {
    taskOpsVersion: '0.1', entityType: 'task', id: 'task-verifiable-leaf',
    taskGroupId: childTaskGroupId, taskGroupVersionId: versionId,
    title: '검증 가능한 leaf', objective: 'acceptance union 검증', responsibility: '정규화 원소 제공',
    completionCriteria: '명령과 artifact 경로가 있다.', order: 2, createdAt: '2026-07-30T00:00:00.000Z',
    status: 'pending', runReadiness: 'runnable', uncertaintyState: 'known_unknown', confidenceScore: 0.8,
    expectedPlan: { expectedDepth: 0, expectedBreadth: 1, rationale: '이미 실행 가능한 leaf.' },
    acceptance: {
      mode: 'guarded', expectedOutcome: '명령과 artifact 경로가 있다.',
      requiredChecks: ['  NPM   TEST  '], requiredArtifacts: [{ path: ' Build/Result.TXT ' }],
    },
  });
  return { projectDir, unverifiablePath: join(tasksDir, unverifiableChildId + '.md') };
}

const defaultFixture = makeFixture('default-none');
const defaultSummary = normalizeChildConvergenceContracts({
  projectDir: defaultFixture.projectDir, childTaskGroupId, versionId, parentTask,
});
const defaultChild = parseMarkdownFile(defaultFixture.unverifiablePath);
assert.equal(defaultChild.expectedPlan.expectedDepth, 2, '기본 모드는 depthCap 이내 자식 depth를 유지해야 한다');
assert.equal(defaultChild.uncertaintyState, 'unknown_unknown', '기본 모드는 unknown_unknown 부모의 자식을 clamp하지 않아야 한다');
assert.equal(defaultChild.needsManualReview, undefined, '기본 모드의 비리프를 acceptance gap으로 만들면 안 된다');
assert.equal(defaultSummary.clampedDepthCount, 0, '기본 depth clamp 결과가 바뀌면 안 된다');
assert.equal(defaultSummary.clampedUncertaintyCount, 0, '기본 uncertainty clamp 결과가 바뀌면 안 된다');
assert.equal(defaultSummary.acceptanceGapCount, 0, '기본 acceptance gap 결과가 바뀌면 안 된다');

const hardFixture = makeFixture('hard');
const hardSummary = normalizeChildConvergenceContracts({
  projectDir: hardFixture.projectDir, childTaskGroupId, versionId, parentTask, convergenceLevel: 'hard',
});
const hardChild = parseMarkdownFile(hardFixture.unverifiablePath);
assert.equal(hardChild.expectedPlan.expectedDepth, 0, 'hard는 depth 2 자식을 leaf로 clamp해야 한다');
assert.equal(hardSummary.hardLeafClampCount, 1, 'hard leaf clamp 수를 정확히 집계해야 한다');
assert.equal(hardChild.uncertaintyState, 'known_unknown', 'hard는 unknown_unknown 부모의 자식도 한 단계 clamp해야 한다');
assert.notEqual(hardChild.uncertaintyState, 'known', '모르는 것을 known으로 올리면 안 된다');
assert.equal(hardSummary.hardUncertaintyClampCount, 1, 'hard uncertainty clamp 수를 정확히 집계해야 한다');
assert.equal(hardChild.needsManualReview, true, '검증 불가 hard 자식은 manual review 대상이어야 한다');
assert.equal(hardChild.convergenceAcceptanceGap, true, '검증 불가 hard 자식은 acceptance gap이어야 한다');
assert.deepEqual(hardSummary.hardUnverifiableChildIds, [unverifiableChildId], '검증 불가 hard 자식 id를 모아야 한다');
assert.deepEqual(hardChild.acceptance.requiredChecks, [], 'runner는 requiredChecks를 날조하면 안 된다');
assert.deepEqual(
  hardSummary.childAcceptanceUnion,
  { checks: ['npm test'], artifacts: ['build/result.txt'] },
  '자식 acceptance union은 command/ref 텍스트를 canonicalize해야 한다',
);

console.log('convergence-hard-child-clamp smoke passed');
