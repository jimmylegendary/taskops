#!/usr/bin/env node
// 층3 — 자식 실행가능성 계약(normalizeChildConvergenceContracts).
// ALE 스모크 실측 결함: 분해된 자식 17개 전부 requiredChecks 0개, depth가 expectedDepth=2를 넘어 3+로 성장.
// 자식 생성 시점에 (1) expectedDepth 단조감소 (2) uncertaintyState 한 단 아래 제한 (3) acceptance 계약 전파
// (4) 검증불가 리프 플래그 를 강제한다. 검증은 오직 생성된 자식 .md frontmatter + events.jsonl 로만 한다
// (구현 문자열/프롬프트 토큰을 읽지 않는다 — vacuous 테스트 방지).
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-convergence-child-contracts-'));

function run(args, options = {}) {
  const result = spawnSync('node', [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== (options.expectStatus ?? 0)) {
    throw new Error(`taskops ${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

// 부모: expectedDepth=2, uncertaintyState=known_unknown, acceptance.requiredChecks=['npm test'] (자식에 새면 안 됨).
function makeWork(id, { parentUncertainty = 'known_unknown', parentExpectedPlan = { expectedDepth: 2, expectedBreadth: 3, rationale: 'Two-level plan for the convergence child contract fixture.' } } = {}) {
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Verify child convergence contracts.', '--language', 'en']);
  const task = {
    id: 'task-parent',
    title: 'Convergence contract parent',
    objective: 'Decompose into children that must inherit convergence contracts.',
    responsibility: 'Exercise child contract normalization.',
    completionCriteria: 'Children are authored with clamped depth/uncertainty and flagged acceptance gaps.',
    order: 1,
    status: 'pending',
    runReadiness: 'needs_decomposition',
    uncertaintyState: parentUncertainty,
    confidenceScore: 0.55,
    decompositionConfidence: 0.85,
    acceptance: { mode: 'guarded', requiredChecks: ['npm run parent-only-check'] },
  };
  if (parentExpectedPlan) task.expectedPlan = parentExpectedPlan;
  const specPath = join(tempRoot, `${id}-root-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Convergence child contract fixture',
    selected: true,
    tasks: [task],
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

// 자식을 authoring 하는 fake executor. 자식은 일부러 "부모와 같은 깊이 / unknown_unknown / acceptance 없음"을
// 선언한다 — 정규화 pass 가 없으면 그대로 남는다(= RED).
function makeFakeOpenClaw(envVar) {
  const fakePath = join(tempRoot, `fake-openclaw-${envVar}.mjs`);
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) { console.log('openclaw fake child contracts'); process.exit(0); }

const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const workDir = process.env.${envVar};
if (!workDir) { console.error('missing ${envVar}'); process.exit(2); }

const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
if (!childTaskGroupId || !versionId) { console.error('missing target ids'); process.exit(2); }

const now = '2026-07-28T00:00:00.000Z';
const groupDir = join(workDir, 'task-groups', childTaskGroupId);
const versionDir = join(groupDir, 'versions', versionId);
const tasksDir = join(versionDir, 'tasks');
mkdirSync(tasksDir, { recursive: true });
mkdirSync(join(versionDir, 'eow'), { recursive: true });

writeFileSync(join(groupDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroup','id: ' + childTaskGroupId,'objective: Child group','createdAt: ' + now,'status: active','activeVersionId: ' + versionId,'---','# ' + childTaskGroupId,''].join('\\n'), 'utf8');
writeFileSync(join(versionDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroupVersion','id: ' + versionId,'taskGroupId: ' + childTaskGroupId,'version: v1','summary: Child version','createdAt: ' + now,'status: active','---','# Child version',''].join('\\n'), 'utf8');
writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- Authored by child-contract fake.\\n', 'utf8');

const writeTask = (task) => {
  const lines = ['---','taskOpsVersion: v1','entityType: task','id: ' + task.id,'taskGroupId: ' + childTaskGroupId,'taskGroupVersionId: ' + versionId,'title: ' + task.title,'objective: ' + task.objective,'responsibility: ' + task.responsibility,'completionCriteria: ' + task.completionCriteria,'order: ' + task.order,'createdAt: ' + now,'status: ' + task.status,'runReadiness: ' + task.runReadiness];
  if (task.uncertaintyState) lines.push('uncertaintyState: ' + task.uncertaintyState);
  if (task.blockedReason) lines.push('blockedReason: ' + task.blockedReason);
  if (task.expectedPlan) {
    lines.push('expectedPlan:');
    lines.push('  expectedDepth: ' + task.expectedPlan.expectedDepth);
    lines.push('  expectedBreadth: ' + task.expectedPlan.expectedBreadth);
    lines.push('  rationale: ' + task.expectedPlan.rationale);
  }
  if (task.acceptance) {
    lines.push('acceptance:');
    lines.push('  mode: ' + task.acceptance.mode);
    if (task.acceptance.requiredChecks) {
      lines.push('  requiredChecks:');
      for (const c of task.acceptance.requiredChecks) lines.push('    - ' + c);
    }
  }
  lines.push('---', '# ' + task.title, '');
  writeFileSync(join(tasksDir, task.id + '.md'), lines.join('\\n'), 'utf8');
};

// A: 부모와 같은 depth 2 를 다시 선언 + unknown_unknown (비-blocked) → 둘 다 clamp 되어야 한다.
writeTask({ id: 'task-child-deep', title: 'Deep child', objective: 'Re-declare the parent depth.', responsibility: 'Depth clamp probe.', completionCriteria: 'Depth is clamped.', order: 1, status: 'pending', runReadiness: 'needs_decomposition', uncertaintyState: 'unknown_unknown', expectedPlan: { expectedDepth: 2, expectedBreadth: 2, rationale: 'Child re-declares the same depth as its parent.' } });
// B: 리프(depth 0) + acceptance 없음 → acceptance gap 플래그.
writeTask({ id: 'task-child-gap', title: 'Gap child', objective: 'Leaf with no verifiable acceptance.', responsibility: 'Acceptance gap probe.', completionCriteria: 'Gap flag is stamped.', order: 2, status: 'pending', runReadiness: 'runnable', uncertaintyState: 'known', expectedPlan: { expectedDepth: 0, expectedBreadth: 0, rationale: 'Leaf child without acceptance.' } });
// C: 리프(depth 0) + requiredChecks 보유 → gap 없음. depth 0 은 올리지 않는다.
writeTask({ id: 'task-child-checked', title: 'Checked child', objective: 'Leaf with its own required check.', responsibility: 'Acceptance present probe.', completionCriteria: 'No gap flag.', order: 3, status: 'pending', runReadiness: 'runnable', uncertaintyState: 'known', expectedPlan: { expectedDepth: 0, expectedBreadth: 0, rationale: 'Leaf child with acceptance.' }, acceptance: { mode: 'guarded', requiredChecks: ['node -e "process.exit(0)"'] } });
// D: blocked + unknown_unknown → 무변경(author 의 의도적 종단 표식 보존).
writeTask({ id: 'task-child-blocked', title: 'Blocked child', objective: 'Stay blocked.', responsibility: 'Terminal guard.', completionCriteria: 'No execution.', order: 4, status: 'blocked', runReadiness: 'blocked', uncertaintyState: 'unknown_unknown', blockedReason: 'fixture_terminal_guard', expectedPlan: { expectedDepth: 0, expectedBreadth: 0, rationale: 'Blocked leaf.' } });
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function readEvents(workDir, runId) {
  return readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8')
    .trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

function childPath(workDir, childId) {
  return join(workDir, 'task-groups', 'tg-parent', 'versions', 'tgv-parent-v1', 'tasks', `${childId}.md`);
}

function runDecomposeStep(id, options = {}) {
  const envVar = `TASKOPS_CHILD_CONTRACTS_WORK_DIR_${id.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
  const workDir = makeWork(id, options.work || {});
  const fake = makeFakeOpenClaw(envVar);
  const prevBin = process.env.TASKOPS_OPENCLAW_BIN;
  process.env.TASKOPS_OPENCLAW_BIN = fake;
  process.env[envVar] = workDir;
  let runResult = null;
  let thrown = null;
  try {
    runResult = runTaskOps(workDir, {
      executor: 'openclaw-agent', agent: 'main',
      maxSteps: 1, maxStepsExplicit: true, timeout: 30,
      ...(options.runOptions || {}),
    });
  } catch (err) {
    thrown = err;
  }
  if (prevBin == null) delete process.env.TASKOPS_OPENCLAW_BIN; else process.env.TASKOPS_OPENCLAW_BIN = prevBin;
  delete process.env[envVar];
  return { workDir, runResult, thrown };
}

try {
  // ---- 기본(childAcceptancePropagation='mode') 통합 런 -------------------------------------------------
  const base = runDecomposeStep('mode-default');
  if (base.thrown) throw base.thrown;
  assert.equal(base.runResult.actions[0].kind, 'decompose');
  assert.equal(base.runResult.actions[0].status, 'completed');

  const deep = parseMarkdownFile(childPath(base.workDir, 'task-child-deep'));
  const gap = parseMarkdownFile(childPath(base.workDir, 'task-child-gap'));
  const checked = parseMarkdownFile(childPath(base.workDir, 'task-child-checked'));
  const blocked = parseMarkdownFile(childPath(base.workDir, 'task-child-blocked'));

  // T1 — expectedDepth 단조감소: 자식이 2를 선언해도 부모(2)-1 = 1 이하로 clamp.
  assert.equal(Number(deep.expectedPlan.expectedDepth) <= 1, true,
    `T1: child expectedDepth must be clamped to <=1, got ${deep.expectedPlan?.expectedDepth}`);
  // T2 — 상한 clamp 만; depth 0 을 올리지 않는다.
  assert.equal(Number(gap.expectedPlan.expectedDepth), 0, 'T2: depth 0 child must stay 0');
  assert.equal(Number(checked.expectedPlan.expectedDepth), 0, 'T2: depth 0 child must stay 0');

  // T4 — 부모가 unknown_unknown 이 아닌데 비-blocked 자식이 unknown_unknown → known_unknown 으로 clamp.
  assert.equal(deep.uncertaintyState, 'known_unknown', 'T4: non-blocked unknown_unknown child must clamp one notch down');
  assert.equal(typeof deep.uncertaintyClampReason === 'string' && deep.uncertaintyClampReason.length > 0, true,
    'T4: clamp must stamp a reason');

  // T5 — blocked 자식은 무변경.
  assert.equal(blocked.uncertaintyState, 'unknown_unknown', 'T5: blocked child uncertaintyState must be preserved');
  assert.equal(blocked.uncertaintyClampReason, undefined, 'T5: blocked child must not be stamped');

  // T7 — 어떤 자식도 unknown_known(human pick quadrant)으로 새지 않는다.
  for (const child of [deep, gap, checked, blocked]) {
    assert.notEqual(child.uncertaintyState, 'unknown_known', 'T7: clamp must never produce unknown_known');
  }

  // T8 — 검증 불가 리프에 gap 플래그.
  assert.equal(gap.convergenceAcceptanceGap, true, 'T8: unverifiable leaf must be flagged');
  assert.equal(gap.needsManualReview, true, 'T8: unverifiable leaf must need manual review');
  // T8b — 상태는 건드리지 않는다(blocked 로 만들지 않는다).
  assert.equal(gap.status, 'pending', 'T8b: the acceptance-gap flag must not mutate status');

  // T9 — requiredChecks 를 가진 리프는 gap 아님.
  assert.notEqual(checked.convergenceAcceptanceGap, true, 'T9: a leaf with requiredChecks must not be flagged');

  // T10 — 부모 requiredChecks 가 자식에 복사되지 않는다(거짓 실패 방지).
  for (const id of ['task-child-deep', 'task-child-gap', 'task-child-checked', 'task-child-blocked']) {
    const raw = readFileSync(childPath(base.workDir, id), 'utf8');
    assert.equal(raw.includes('parent-only-check'), false,
      `T10: parent requiredChecks must not be copied into ${id}`);
  }

  // T11 — 배선 검증: 이벤트가 실제로 events.jsonl 에 남는다(단위 호출만으로는 통과 불가).
  const events = readEvents(base.workDir, base.runResult.runId);
  const normalized = events.filter((e) => e.type === 'child_convergence_contract_normalized');
  assert.equal(normalized.length, 1, 'T11: exactly one child_convergence_contract_normalized event');
  assert.equal(normalized[0].summary.clampedDepthCount >= 1, true, 'T11: depth clamp must be counted');
  assert.equal(normalized[0].summary.clampedUncertaintyCount >= 1, true, 'T11: uncertainty clamp must be counted');
  assert.equal(normalized[0].summary.acceptanceGapCount >= 1, true, 'T11: acceptance gap must be counted');
  const gapEvents = events.filter((e) => e.type === 'child_acceptance_gap');
  assert.equal(gapEvents.length, 1, 'T11: exactly one child_acceptance_gap event');
  assert.deepEqual(gapEvents[0].taskIds, ['task-child-gap'], 'T11: gap event must name the gap child');

  // ---- T3 — 부모 expectedPlan 이 invalid 면 depth 축 비활성 ------------------------------------------
  const noPlan = runDecomposeStep('no-parent-plan', { work: { parentExpectedPlan: null } });
  if (noPlan.thrown) throw noPlan.thrown;
  const noPlanDeep = parseMarkdownFile(childPath(noPlan.workDir, 'task-child-deep'));
  assert.equal(Number(noPlanDeep.expectedPlan.expectedDepth), 2,
    'T3: with no valid parent expectedPlan the depth clamp must stay inactive');

  // ---- T6 — 부모가 unknown_unknown 이면 자식 unknown_unknown 무변경 -----------------------------------
  // (부모가 unknown_unknown 이면 runner 는 exploration 으로 분류하므로 분해 경로를 태울 수 없다 →
  //  pass 를 직접 호출해 격리 검증한다. 위 T4/T11 이 배선을 이미 증명한다.)
  const { normalizeChildConvergenceContracts } = await import('../lib-runner.js');
  const uuWork = makeWork('parent-uu', { parentUncertainty: 'unknown_unknown' });
  const uuFake = makeFakeOpenClaw('TASKOPS_CHILD_CONTRACTS_WORK_DIR_PARENT_UU');
  process.env.TASKOPS_CHILD_CONTRACTS_WORK_DIR_PARENT_UU = uuWork;
  spawnSync('node', [uuFake, '--message', 'Target child task group id: tg-parent\nTarget version id: tgv-parent-v1\n'], { encoding: 'utf8' });
  delete process.env.TASKOPS_CHILD_CONTRACTS_WORK_DIR_PARENT_UU;
  const uuParent = parseMarkdownFile(join(uuWork, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-parent.md'));
  normalizeChildConvergenceContracts({
    projectDir: uuWork, childTaskGroupId: 'tg-parent', versionId: 'tgv-parent-v1', parentTask: uuParent,
  });
  const uuChild = parseMarkdownFile(childPath(uuWork, 'task-child-deep'));
  assert.equal(uuChild.uncertaintyState, 'unknown_unknown',
    'T6: an unknown_unknown parent must not clamp its unknown_unknown child');

  // ---- T12 — childAcceptancePropagation='full' 이면 부모 requiredChecks 를 복사(하드코딩 아님 증명) -----
  const full = runDecomposeStep('full-propagation', { runOptions: { childAcceptancePropagation: 'full' } });
  if (full.thrown) throw full.thrown;
  const fullGap = parseMarkdownFile(childPath(full.workDir, 'task-child-gap'));
  assert.equal(
    (fullGap.acceptance?.requiredChecks || []).includes('npm run parent-only-check'), true,
    'T12: propagation=full must copy the parent requiredChecks',
  );

  // ---- T13 — 잘못된 propagation 값은 throw (lock 획득 전) ----------------------------------------------
  const bad = runDecomposeStep('bad-propagation', { runOptions: { childAcceptancePropagation: 'sideways' } });
  assert.ok(bad.thrown, 'T13: an invalid childAcceptancePropagation must throw');
  assert.match(String(bad.thrown.message), /childAcceptancePropagation/i, 'T13: the error must name the option');

  console.log('convergence-child-contracts smoke passed');
} catch (err) {
  console.error(err);
  process.exit(1);
}
