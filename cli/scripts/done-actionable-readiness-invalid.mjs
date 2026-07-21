#!/usr/bin/env node
// P0#3: validator는 status==='done' + actionable runReadiness(needs_exploration/needs_decomposition/needs_prototype)
// + child 없음 조합을 ERROR로 금지한다. 이 모순 상태는 P0#1 버그의 fingerprint(done+needs_decomposition, no child)였고
// canonical 검증이 못 잡아 오염 상태가 활성 graph에 남았다. '완료된 leaf는 actionable readiness를 갖지 않는다'.
//
// 네 케이스:
//   (a) done + needs_decomposition + no child           → ERROR (실패-우선: 검증부 추가 전엔 error 없음)
//   (b) done + runnable (executed)                       → NO error (executed-done은 정합)
//   (c) done + needs_decomposition + childTaskGroupId    → NO error (decomposed parent는 정당)
//   (d) needs_decomposition leaf를 manual_verified로 close → statusFlipped가 runReadiness를 'runnable'로 정규화 → NO error
//        (R2B4: close-path 정규화 전엔 done+needs_decomposition+no-child 지문이 되어 false-error)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fmBlock, parseProject } from '../lib-taskops.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const now = '2026-06-26T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-done-actionable-'));

const ACTIONABLE_SUBSTR = 'is still actionable';

// 단일 task를 가진 최소 valid work tree를 만든다.
function buildWork(id, taskOverrides) {
  const w = join(root, id);
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, `${tv}/eow`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id, title: 'A', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/task-01.md`, {
    taskOpsVersion: 'v1', entityType: 'task', id: 'task-01', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
    title: 'T', objective: 'x', responsibility: 'own', completionCriteria: 'done', order: 1, createdAt: now,
    ...taskOverrides,
  });
  // done leaf는 EoW가 있어야 terminal warning이 안 뜨지만, 여기서는 errors만 본다.
  if (taskOverrides.status === 'done') {
    md(`${tv}/eow/eow-task-01.md`, { taskOpsVersion: 'v1', entityType: 'eow', id: 'eow-task-01', graphType: 'task', attachedToType: 'task', attachedToId: 'task-01', taskGroupVersionId: 'tgv-root-v1', reason: 'execution_path_closed', declaredBy: 'system', declaredAt: now, createdAt: now, status: 'done' });
  }
  return w;
}

function errorsOf(w) {
  return parseProject(w).errors;
}
function hasActionableError(w) {
  return errorsOf(w).some((e) => String(e).includes(ACTIONABLE_SUBSTR));
}

// (a) done + needs_decomposition + no child → ERROR
{
  const w = buildWork('case-a', { status: 'done', runReadiness: 'needs_decomposition', understandingLevel: 'known' });
  assert.equal(hasActionableError(w), true, '(a) done + needs_decomposition + no child must be a validation error');
}
// (b) done + runnable (executed) → NO error
{
  const w = buildWork('case-b', { status: 'done', runReadiness: 'runnable', understandingLevel: 'known' });
  assert.equal(hasActionableError(w), false, '(b) done + runnable (executed-done) must NOT be an error');
}
// (c) done + needs_decomposition + childTaskGroupId → NO error
{
  const w = buildWork('case-c', { status: 'done', runReadiness: 'needs_decomposition', childTaskGroupId: 'tg-child', understandingLevel: 'known' });
  assert.equal(hasActionableError(w), false, '(c) decomposed parent (done + needs_decomposition + childTaskGroupId) must NOT be an error');
}
// (c2) done + needs_exploration + no child → ERROR (set 전체 확인)
{
  const w = buildWork('case-c2', { status: 'done', runReadiness: 'needs_exploration', understandingLevel: 'known' });
  assert.equal(hasActionableError(w), true, '(c2) done + needs_exploration + no child must be a validation error');
}

// (d) manual_verified close-path 정규화: needs_decomposition leaf를 close → runReadiness 'runnable'로 정규화 → NO error
{
  function run(args) {
    const r = spawnSync('node', [cli, ...args], { encoding: 'utf8', env: process.env });
    if (r.status !== 0) throw new Error(`taskops ${args.join(' ')} failed\n${r.stdout}\n${r.stderr}`);
    return r.stdout;
  }
  // pending + needs_decomposition leaf(닫히지 않음)로 시작.
  const w = buildWork('case-d', { status: 'pending', runReadiness: 'needs_decomposition', understandingLevel: 'known' });
  // 정규화 전(=버그) 상태를 확인하기 위해 먼저 검증: 아직 error 없음(pending이라).
  assert.equal(hasActionableError(w), false, '(d) precondition: pending needs_decomposition leaf has no actionable error yet');
  run(['close', w, 'task-01', '--reason', 'manual_verified']);
  const closed = parseProject(w);
  const task = [...closed.tasks.values()].find((t) => t.id === 'task-01');
  assert.equal(task.status, 'done', '(d) manual_verified flips the leaf to done');
  assert.equal(task.runReadiness, 'runnable', "(d) close-path normalizes a completed leaf's runReadiness to 'runnable' (non-actionable terminal)");
  assert.equal(hasActionableError(w), false, '(d) a legitimate manual attestation must NOT trip the done+actionable-readiness validator (no false positive)');
}

rmSync(root, { recursive: true, force: true });
console.log('done-actionable-readiness-invalid: OK (P0#3 — completed leaves carry no actionable readiness)');
