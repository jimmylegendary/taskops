#!/usr/bin/env node
// P0#2: acceptance(mode enforced/guarded/runner-managed)를 가진 task는 exploration path로 done/EoW/blocker-resolution
// 되면 안 된다 — acceptance 계약은 acceptance 검증 / policy-approved review로만 만족되며, exploration 통과로 종결되면
// acceptance를 우회한다(F1 '말한 완료=진짜 완료' 위반). #1이 exploration의 close 자체를 제거해 불변식을 만족하지만,
// 이 테스트는 acceptance-bearing task를 exploration path로 강제 진입시켜 회귀(향후 close 재도입)를 실패-우선 포착한다.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile } from '../lib-taskops.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-exploration-acceptance-guard-'));

function run(args) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8', env: process.env });
  if (result.status !== 0) {
    throw new Error(`taskops ${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

const workDir = join(tempRoot, 'acceptance-explore');
run(['init', workDir, '--id', 'acceptance-explore', '--title', 'acceptance-explore', '--objective', 'Guard acceptance tasks against exploration closure', '--language', 'en']);
const specPath = join(tempRoot, 'spec.json');
writeFileSync(specPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Acceptance task forced onto the exploration path',
  selected: true,
  tasks: [{
    id: 'task-accepted-explore',
    title: 'Acceptance-bearing task with unknown-unknowns',
    objective: 'Deliver an accepted deliverable whose scope is not yet known.',
    responsibility: 'Own the accepted deliverable end-to-end.',
    completionCriteria: 'The required checks pass and the required artifact exists.',
    order: 1,
    status: 'pending',
    // unknown_unknown → inferUncertaintyReadiness가 UNCONDITIONAL needs_exploration으로 강제 → explore로 라우팅.
    runReadiness: 'needs_exploration',
    uncertaintyState: 'unknown_unknown',
    confidenceScore: 0.2,
    understandingLevel: 'partial',
    unknowns: ['What exactly must the deliverable contain?'],
    nextLearningGoal: 'Discover the acceptance scope.',
    // policy-approving acceptance: exploration으로 절대 만족되면 안 되는 계약.
    acceptance: {
      mode: 'runner-managed',
      expectedOutcome: 'A verified deliverable that passes the required checks.',
      requiredArtifacts: [{ path: 'deliverable.md' }],
      requiredChecks: [{ id: 'chk-exists', kind: 'file_exists', path: 'deliverable.md' }],
    },
  }],
}), 'utf8');
run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');

// 강제로 exploration path 진입 — dry-run으로 1스텝. (guard가 발화하면 run이 non-zero로 실패한다.)
const runOut = JSON.parse(run(['run', workDir, '--executor', 'dry-run', '--max-steps', '1', '--json']));
const actions = runOut.actions || runOut.tasks || [];
assert.equal(actions.length, 1, 'exactly one exploration step ran');
assert.equal(actions[0].kind, 'explore', 'the acceptance task was routed onto the exploration path (unknown_unknown)');

const taskPath = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-accepted-explore.md');
const task = parseMarkdownFile(taskPath);
// (a) source task-EoW 없음
assert.equal(existsSync(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-accepted-explore-tgv-root-v2.md')), false, 'exploration must NOT attach a task-EoW to an acceptance-bearing task (acceptance bypass forbidden)');
// (b) fm.status !== 'done'
assert.notEqual(task.status, 'done', 'exploration must NOT flip an acceptance-bearing task to done');
assert.equal(task.status, 'pending', 'the acceptance task stays open (pending) after exploration');
// acceptance 계약이 온전히 보존됨
assert.equal(task.acceptance && task.acceptance.mode, 'runner-managed', 'acceptance metadata survives the exploration step');

// (c) audit claimSafe === false (미승인/미검증이므로 done 아님)
const audit = JSON.parse(run(['audit', workDir, '--json']));
assert.equal(audit.claimSafe, false, 'audit must refuse claimSafe for an acceptance task closed only by exploration');

rmSync(tempRoot, { recursive: true, force: true });
console.log('exploration-acceptance-guard: OK (P0#2 — acceptance never satisfied by an exploration pass)');
