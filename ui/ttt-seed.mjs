#!/usr/bin/env node
// A COARSE outer-shell seed: one high-level task at expectedPlan.expectedDepth>=2 so TaskOps' depth contract forces
// coarse-first RECURSIVE decomposition (a deepening tree of major phases -> sub-goals -> atomic steps), not a flat
// leaf fan. Run with the native runner (runner watch); openclaw decomposes level by level.
//   usage: node ui/ttt-seed.mjs [work-dir] [language]
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fmBlock } from '../cli/lib-taskops.js';

const now = '2026-07-07T00:00:00.000Z';
const w = process.argv[2] || '/home/jimmy/taskops-runs/ttt-memory-2030';
const language = process.argv[3] || '한국어';
if (existsSync(w)) rmSync(w, { recursive: true, force: true });
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
const md = (p, fm, b) => { mkdirSync(join(w, p, '..'), { recursive: true }); writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8'); };
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'ttt2030', title: 'TTT → 2030 예측', objective: 'test-time training으로 AI의 일관성·continual learning 문제를 어떻게 풀지, 그리고 2030년 신규 메모리 소자·AI 워크로드·시장을 시뮬레이션+DSE로 종합 예측한다.', language, activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
md(`${tv}/tasks/plan.md`, {
  taskOpsVersion: 'v1', entityType: 'task', id: 'plan', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: '연구 전체 (outer shell)',
  objective: '이 연구 목표를 달성하라. 먼저 큰 관점의 major phase(굵직한 단위)로만 나누고, 각 phase는 이후에 다시 하위 목표로 분해되며, 최종적으로 atomic 실행 단위까지 재귀적으로 쪼개진다. 지금은 절대 세부 실행 태스크를 한꺼번에 나열하지 말고, 몇 개의 큰 단위로만 분해하라. 인간의 결정이 꼭 필요한 지점은 resolverKind: human 태스크로 둔다. 모든 산출물은 한국어.',
  responsibility: '연구 전체를 큰 단위부터 재귀적으로 분해·수행', completionCriteria: '모든 하위 목표가 검증된 산출물로 닫힘',
  order: 1, createdAt: now, status: 'pending', runReadiness: 'needs_decomposition', understandingLevel: 'known',
  expectedPlan: { expectedDepth: 3, expectedBreadth: 4, rationale: 'coarse outer shell — decompose into a few major phases, then sub-goals, then atomic steps (recursive, deepening tree).' },
});
console.log(w);
