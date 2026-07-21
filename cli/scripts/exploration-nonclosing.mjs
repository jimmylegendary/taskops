#!/usr/bin/env node
// P0#1 [뿌리]: exploration은 source objective task를 닫으면 안 된다(run graph ⟂ task graph).
// exploration RUN node만 done + run-EoW로 닫히고, source task는 status=pending / runReadiness=needs_decomposition /
// uncertaintyState 한 단 승격(unknown_unknown→known_unknown)으로 남아 다음 스텝이 decompose로 전진해야 한다.
//
// 두 변형 필수:
//   변형A (surprise-reporting): 마커를 내는 executor → surpriseHistory 1개 축적.
//   변형B (no-marker success — R1B1/R2B1 anti-loop 봉쇄): 마커 없이 result.ok로 완료하는 executor(dry-run) →
//     surpriseHistory 0개이되 uncertaintyState는 여전히 known_unknown으로 승격(승격은 surpriseReported가 아니라
//     EXPLORATION 성공에 gate). 승격을 surpriseReported에 gate한 순진한 수정은 변형B에서 매 스텝 재-explore
//     무한루프(보고서 8.3)로 실패해야 한다.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps, computeNextAction, SURPRISE_REPORT_PREFIX } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-exploration-nonclosing-'));

function run(args, options = {}) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...(options.env || {}) } });
  if (result.status !== 0) {
    throw new Error(`taskops ${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

// 변형A용 fake claude: exploration 프롬프트를 받으면 artifact를 쓰고 surprise 마커를 방출한다.
function writeMarkerClaude() {
  const fakePath = join(tempRoot, 'fake-claude-marker.mjs');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
const SURPRISE_REPORT_PREFIX = ${JSON.stringify(SURPRISE_REPORT_PREFIX)};
if (process.argv.includes('--version')) { console.log('claude fake marker'); process.exit(0); }
const prompt = process.argv[process.argv.length - 1] || '';
const match = prompt.match(/Write the exploration artifact at: ([^\\n]+)/);
if (match) {
  const rel = match[1].trim();
  const workDir = process.env.TASKOPS_EXPLORATION_NONCLOSING_WORK_DIR;
  const artifactPath = isAbsolute(rel) ? rel : (workDir ? join(workDir, rel) : rel);
  mkdirSync(dirname(artifactPath), { recursive: true });
  const report = {
    summary: 'Exploration surfaced one blocking unknown and one new known delta.',
    contradictedKnown: [],
    discoveredUnknowns: [{ id: 'u-boundary', question: 'Which boundary constrains the next decomposition?', whyDiscovered: 'exploration probe', blocksReadiness: true }],
    newKnownDeltas: [{ id: 'k-explored', claim: 'The exploration artifact path is parsed for surprise.', evidence: 'marker written' }],
  };
  writeFileSync(artifactPath, ['# Exploration artifact', '', SURPRISE_REPORT_PREFIX + ' ' + JSON.stringify(report), ''].join('\\n'), 'utf8');
  process.exit(0);
}
console.log('fake claude completed the requested TaskOps step');
console.log(SURPRISE_REPORT_PREFIX + ' ' + JSON.stringify({ summary: 'no fixture surprise', contradictedKnown: [], discoveredUnknowns: [], newKnownDeltas: [] }));
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function seedExplorationWork(id) {
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Broad objective requiring exploration', '--language', 'en']);
  const specPath = join(tempRoot, `${id}-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Broad objective requiring exploration before decomposition',
    selected: true,
    tasks: [{
      id: 'task-root-explore',
      title: 'Achieve the broad objective',
      objective: 'Deliver a dependable end-to-end system for the broad objective.',
      responsibility: 'Own the end-to-end outcome.',
      completionCriteria: 'A working pilot exists, its verifier passes, and a retrospective confirms the decision.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_exploration',
      runReadinessReason: 'User, decision, source boundary and evidence standard are not yet known.',
      understandingLevel: 'partial',
      uncertaintyState: 'unknown_unknown',
      confidenceScore: 0.22,
      unknowns: ['Who is the primary user?', 'Which sources are allowed?'],
      nextLearningGoal: 'Identify the smallest defensible pilot boundary.',
      knownList: [{ id: 'k1', claim: 'Provenance will be necessary.', verificationStatus: 'unverified' }],
      expectedPlan: { expectedDepth: 2, expectedBreadth: 4, rationale: 'multi-layer objective' },
    }],
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

function taskPath(workDir) {
  return join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-root-explore.md');
}
function sourceEowPath(workDir) {
  return join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'eow', 'eow-task-root-explore.md');
}

// ---- 공통 non-closing 불변식 (양 변형이 공유) ----
function assertNonClosing(workDir, { expectSurprise }) {
  const task = parseMarkdownFile(taskPath(workDir));
  assert.equal(task.status, 'pending', 'exploration must NOT close the source objective task (status stays pending, never done)');
  assert.equal(task.runReadiness, 'needs_decomposition', 'exploration leaves the source task ready for decomposition');
  assert.equal(String(task.uncertaintyState || '').trim(), 'known_unknown', 'exploration success promotes uncertaintyState exactly one rung unknown_unknown→known_unknown (gated on SUCCESS, not on surprise)');
  assert.equal(existsSync(sourceEowPath(workDir)), false, 'exploration must NOT attach a task-EoW to the source objective task');
  const history = Array.isArray(task.surpriseHistory) ? task.surpriseHistory : [];
  assert.equal(history.length, expectSurprise ? 1 : 0, `surpriseHistory entry is gated on the marker (expect ${expectSurprise ? 1 : 0})`);
  // run node closed by run-EoW (run graph terminal DOES close).
  const runsDir = join(workDir, 'runs');
  assert.equal(existsSync(runsDir), true, 'a run directory exists');
  // navigation must point at decompose, never done, never explore.
  const next = computeNextAction(workDir);
  assert.equal(next.action, 'decompose', 'next points at decompose (NOT done, NOT a second explore)');
  assert.notEqual(next.action, 'done');
  assert.notEqual(next.action, 'explore');
}

let failures = 0;
try {
  // ===== 변형A: surprise-reporting exploration =====
  {
    const workDir = seedExplorationWork('variantA-marker');
    const fakeClaude = writeMarkerClaude();
    const prevClaudeBin = process.env.TASKOPS_CLAUDE_BIN;
    process.env.TASKOPS_CLAUDE_BIN = fakeClaude;
    process.env.TASKOPS_EXPLORATION_NONCLOSING_WORK_DIR = workDir;
    try {
      runTaskOps(workDir, { executor: 'claude-code', maxSteps: 1, maxStepsExplicit: true });
    } finally {
      if (prevClaudeBin === undefined) delete process.env.TASKOPS_CLAUDE_BIN;
      else process.env.TASKOPS_CLAUDE_BIN = prevClaudeBin;
    }
    assertNonClosing(workDir, { expectSurprise: true });
    console.log('OK exploration-nonclosing variantA (surprise-reporting): source task non-closing, run node closed, next=decompose');
  }
} catch (err) {
  failures += 1;
  console.error('FAIL variantA:', err.message);
}

try {
  // ===== 변형B: no-marker success (dry-run) — anti-loop 봉쇄 =====
  {
    const workDir = seedExplorationWork('variantB-nomarker');
    runTaskOps(workDir, { executor: 'dry-run', maxSteps: 1, maxStepsExplicit: true });
    assertNonClosing(workDir, { expectSurprise: false });

    // 두 번째 스텝을 강제해도 재-exploration이 아니라 decompose로 전진해야 한다(anti-loop).
    const before = parseMarkdownFile(taskPath(workDir));
    assert.equal(String(before.uncertaintyState || '').trim(), 'known_unknown');
    const step2 = runTaskOps(workDir, { executor: 'dry-run', maxSteps: 1, maxStepsExplicit: true });
    const step2Actions = step2.actions || step2.tasks || [];
    assert.equal(step2Actions.length, 1, 'a second step runs (decompose), not a no-op');
    assert.equal(step2Actions[0].kind, 'decompose', 'the second step is decompose, NEVER a second explore (anti-loop)');
    const after = parseMarkdownFile(taskPath(workDir));
    assert.equal(String(after.uncertaintyState || '').trim(), 'known_unknown', 'uncertaintyState is not re-promoted on the second step (exactly one rung)');
    const history2 = Array.isArray(after.surpriseHistory) ? after.surpriseHistory : [];
    assert.equal(history2.length, 0, 'no-marker path never fabricates a surprise observation across steps');
    console.log('OK exploration-nonclosing variantB (no-marker success): promoted known_unknown, next=decompose, no re-exploration');
  }
} catch (err) {
  failures += 1;
  console.error('FAIL variantB:', err.message);
}

rmSync(tempRoot, { recursive: true, force: true });
if (failures > 0) process.exit(1);
console.log('exploration-nonclosing: OK (P0#1 root — run graph ⟂ task graph)');
