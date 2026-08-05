#!/usr/bin/env node
// divergence novelty — soft 압력의 통과 조건.
// "직전에 한 같은 종류의 발산이 실제로 새 possibility mass 를 열었나"를 **이력 기반**으로 판정한다
// (게이트는 dispatch 전에 결정하므로 예측이 아니라 이력이어야 정직하다).
//   explore   : 시그니처가 안 바뀌면 novel=false ("직전과 같은 unknown 을 또 팠다")
//   decompose : 자식이 부모에 없던 원소를 하나도 안 만들면 novel=false
// 세 술어(explore / decompose / verify_retry)는 서로 다르며, verify_retry 의 isNovel 정책은 무변경이다.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { divergenceNovelty } from '../lib-convergence.js';
import { parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps, SURPRISE_REPORT_PREFIX } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-convergence-novelty-'));
let seq = 0;

function run(args, options = {}) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...(options.env || {}) } });
  if (result.status !== (options.expectStatus ?? 0)) {
    throw new Error(`taskops ${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function makeWork(task, { exploreShape = false } = {}) {
  const id = `novelty-${seq += 1}`;
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Verify divergence novelty.', '--language', 'en']);
  const specPath = join(tempRoot, `${id}-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2', version: 'v2', summary: 'Novelty fixture', selected: true, tasks: [task],
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  // unknowns 는 spec 작성기의 허용 필드가 아니라 spec 으로는 전달되지 않는다 — 직접 심는다.
  // unknowns 가 있어야 readiness 가 needs_exploration 이 되어 explore 경로를 탈 수 있다.
  if (exploreShape) {
    const pp = rootTaskPath(workDir);
    const raw = readFileSync(pp, 'utf8');
    const yaml = [];
    const end = raw.indexOf('\n---', 4);
    // 명시 runReadiness 를 제거해야 uncertainty 경로(known_unknown + unknowns → needs_exploration)가 잡는다.
    // decompositionConfidence 가 있으면 uncertainty 경로가 decompose 로 기운다 — 그것도 제거한다.
    // uncertaintyState 는 known_unknown 그대로 두어 exploration close 의 승격이 일어나지 않게 한다 —
    // 그래야 "아무것도 못 바꾼 exploration" 을 정확히 재현할 수 있다.
    const body = raw.slice(0, end)
      .replace(/^runReadiness: .*$\n/m, '')
      .replace(/^decompositionConfidence: .*$\n/m, '');
    writeFileSync(pp, `${body}${yaml.length ? `\n${yaml.join('\n')}` : ''}${raw.slice(end)}`, 'utf8');
  }
  return workDir;
}

// childUnknown 을 주면 자식이 부모에 없던 unknown 을 도입한다(= novel 분해).
function makeFake(envVar, { childUnknown = null } = {}) {
  const fakePath = join(tempRoot, `fake-${envVar}.mjs`);
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
if (process.argv.includes('--version')) { console.log('openclaw fake novelty'); process.exit(0); }
const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const workDir = process.env.${envVar};
const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
if (childTaskGroupId && versionId) {
  const now = '2026-07-28T00:00:00.000Z';
  const groupDir = join(workDir, 'task-groups', childTaskGroupId);
  const versionDir = join(groupDir, 'versions', versionId);
  mkdirSync(join(versionDir, 'tasks'), { recursive: true });
  mkdirSync(join(versionDir, 'eow'), { recursive: true });
  writeFileSync(join(groupDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroup','id: ' + childTaskGroupId,'objective: Child group','createdAt: ' + now,'status: active','activeVersionId: ' + versionId,'---','# g',''].join('\\n'), 'utf8');
  writeFileSync(join(versionDir, 'index.md'), ['---','taskOpsVersion: v1','entityType: taskGroupVersion','id: ' + versionId,'taskGroupId: ' + childTaskGroupId,'version: v1','summary: Child version','createdAt: ' + now,'status: active','---','# v',''].join('\\n'), 'utf8');
  writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- fake\\n', 'utf8');
  const lines = ['---','taskOpsVersion: v1','entityType: task','id: task-spawned','taskGroupId: ' + childTaskGroupId,'taskGroupVersionId: ' + versionId,'title: Spawned','objective: A child of the decomposition.','responsibility: Child duty.','completionCriteria: Child criteria.','order: 1','createdAt: ' + now,'status: pending','runReadiness: needs_decomposition','uncertaintyState: known_unknown'];
  ${childUnknown ? `lines.push('unknowns:'); lines.push('  - ${childUnknown}');` : ''}
  lines.push('expectedPlan:','  expectedDepth: 0','  expectedBreadth: 0','  rationale: Spawned plan.','---','# Spawned','');
  writeFileSync(join(versionDir, 'tasks', 'task-spawned.md'), lines.join('\\n'), 'utf8');
  console.log('decomposition authored');
  process.exit(0);
}
// exploration: artifact 를 쓰고, SURPRISE marker 로 새 unknown 을 표면화할지 여부를 env 로 고른다.
const SURPRISE_REPORT_PREFIX = ${JSON.stringify(SURPRISE_REPORT_PREFIX)};
const artifactMatch = prompt.match(/Write the exploration artifact at: ([^\\n]+)/);
if (artifactMatch) {
  const rel = artifactMatch[1].trim();
  const artifactPath = rel.startsWith('/') ? rel : join(workDir, rel);
  mkdirSync(dirname(artifactPath), { recursive: true });
  const lines = ['# Exploration artifact', ''];
  if (process.env.NOVELTY_EXPLORE_SURPRISE === '1') {
    lines.push(SURPRISE_REPORT_PREFIX + ' ' + JSON.stringify({
      summary: 'Exploration surfaced a genuinely new unknown.',
      contradictedKnown: [],
      discoveredUnknowns: [{ id: 'u-cache-invalidation', question: 'How does the ranking node cache invalidate?', whyDiscovered: 'probe', blocksReadiness: true }],
      newKnownDeltas: [],
    }));
  }
  writeFileSync(artifactPath, lines.join('\\n') + '\\n', 'utf8');
  process.exit(0);
}
console.log('nothing new was learned');
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function exec(workDir, options = {}, fakeOptions = {}, env = {}) {
  const envVar = `TASKOPS_NOVELTY_${(seq).toString()}`;
  const fake = makeFake(envVar, fakeOptions);
  const prev = process.env.TASKOPS_OPENCLAW_BIN;
  process.env.TASKOPS_OPENCLAW_BIN = fake;
  process.env[envVar] = workDir;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  let runResult = null; let thrown = null;
  try {
    runResult = runTaskOps(workDir, {
      executor: 'openclaw-agent', agent: 'main', timeout: 30, continueOnFailure: true,
      convergence: { mode: 'off' }, // 스탬프만 관찰한다 — 게이트 간섭 배제.
      ...options,
    });
  } catch (err) { thrown = err; }
  if (prev == null) delete process.env.TASKOPS_OPENCLAW_BIN; else process.env.TASKOPS_OPENCLAW_BIN = prev;
  delete process.env[envVar];
  for (const k of Object.keys(env)) delete process.env[k];
  return { runResult, thrown };
}

function plannerTask(extra = {}) {
  return {
    id: 'task-origin',
    title: 'Root',
    objective: 'Decompose into children.',
    responsibility: 'Novelty probe.',
    completionCriteria: 'Children exist.',
    order: 1,
    status: 'pending',
    runReadiness: 'needs_decomposition',
    uncertaintyState: 'known_unknown',
    confidenceScore: 0.5,
    decompositionConfidence: 0.85,
    expectedPlan: { expectedDepth: 1, expectedBreadth: 2, rationale: 'Root plan.' },
    ...extra,
  };
}

function rootTaskPath(workDir) {
  return join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', 'task-origin.md');
}

try {
  // ---- 술어 단위: 이력이 없으면 첫 발산은 언제나 통과 -------------------------------------------
  assert.equal(divergenceNovelty({}, 'explore').novel, true, 'N1: the first explore always passes');
  assert.equal(divergenceNovelty({}, 'decompose').novel, true, 'N1: the first decompose always passes');
  assert.equal(
    divergenceNovelty({ divergenceLedger: [{ kind: 'explore', novel: true }] }, 'decompose').novel, true,
    'N1: a different kind of history must not gate this kind',
  );
  assert.equal(
    divergenceNovelty({ divergenceLedger: [{ kind: 'decompose', novel: false }] }, 'decompose').novel, false,
    'N2: a repeated decompose is rejected',
  );
  assert.equal(
    divergenceNovelty({ divergenceLedger: [{ kind: 'decompose', novel: false }, { kind: 'decompose', novel: true }] }, 'decompose').novel,
    true, 'N2: the LAST entry decides',
  );

  // ---- 통합: decompose 스탬프 ---------------------------------------------------------------
  // (a) 자식이 부모에 없던 unknown 을 도입 → novel:true
  const novelWork = makeWork(plannerTask());
  const novelRun = exec(novelWork, { maxSteps: 1, maxStepsExplicit: true }, { childUnknown: 'how the cache invalidates' });
  if (novelRun.thrown) throw novelRun.thrown;
  const novelRoot = parseMarkdownFile(rootTaskPath(novelWork));
  const novelEntries = (novelRoot.divergenceLedger || []).filter((e) => e.kind === 'decompose');
  assert.equal(novelEntries.length, 1, 'N3: the decompose must be stamped on the parent');
  assert.equal(novelEntries[0].novel, true, 'N3: a child introducing a new unknown is novel');
  assert.equal(typeof novelEntries[0].sigAfter === 'string' && novelEntries[0].sigAfter.length > 0, true, 'N3: sigAfter must be recorded');

  // (b) 자식이 부모 원소집합의 부분집합 → novel:false
  //     (부모가 자식과 같은 unknown/uncertaintyState 를 이미 갖고 있게 만든다)
  const flatWork = makeWork(plannerTask());
  const flatRun = exec(flatWork, { maxSteps: 1, maxStepsExplicit: true }, {});
  if (flatRun.thrown) throw flatRun.thrown;
  const flatRoot = parseMarkdownFile(rootTaskPath(flatWork));
  const flatEntries = (flatRoot.divergenceLedger || []).filter((e) => e.kind === 'decompose');
  assert.equal(flatEntries.length, 1, 'N4: the decompose must be stamped even when it is not novel');
  assert.equal(flatEntries[0].novel, false,
    'N4: a decomposition that introduces no new unknown/requiredCheck must not count as novel');

  // ---- 통합: explore 스탬프 -----------------------------------------------------------------
  // (a) SURPRISE 로 새 unknown 을 표면화 → 시그니처가 바뀐다 → novel:true
  const exploreNovelWork = makeWork(plannerTask(), { exploreShape: true });
  const exploreNovelRun = exec(exploreNovelWork, { maxSteps: 1, maxStepsExplicit: true }, {}, { NOVELTY_EXPLORE_SURPRISE: '1' });
  if (exploreNovelRun.thrown) throw exploreNovelRun.thrown;
  const exploreNovelRoot = parseMarkdownFile(rootTaskPath(exploreNovelWork));
  const exploreNovelEntries = (exploreNovelRoot.divergenceLedger || []).filter((e) => e.kind === 'explore');
  assert.equal(exploreNovelEntries.length, 1, 'N5: the exploration must be stamped');
  assert.equal(exploreNovelEntries[0].novel, true,
    'N5: an exploration that surfaces a new unknown (signature changed) is novel');
  assert.notEqual(exploreNovelEntries[0].sigBefore, exploreNovelEntries[0].sigAfter, 'N5: the signature must have moved');

  // (b) 아무것도 못 바꾼 exploration → novel:false ("직전과 같은 unknown 을 또 팠다")
  //     uncertaintyState 승격조차 없도록 이미 known_unknown 으로 둔다.
  const exploreFlatWork = makeWork(plannerTask(), { exploreShape: true });
  const exploreFlatRun = exec(exploreFlatWork, { maxSteps: 1, maxStepsExplicit: true }, {}, {});
  if (exploreFlatRun.thrown) throw exploreFlatRun.thrown;
  const exploreFlatRoot = parseMarkdownFile(rootTaskPath(exploreFlatWork));
  const exploreFlatEntries = (exploreFlatRoot.divergenceLedger || []).filter((e) => e.kind === 'explore');
  assert.equal(exploreFlatEntries.length, 1, 'N6: the exploration must be stamped even when it is not novel');
  assert.equal(exploreFlatEntries[0].novel, false,
    'N6: an exploration that changes no structured field must not count as novel');
  assert.equal(exploreFlatEntries[0].sigBefore, exploreFlatEntries[0].sigAfter, 'N6: the signature must be unchanged');

  console.log('convergence-divergence-novelty smoke passed');
} catch (err) {
  console.error(err);
  process.exit(1);
}
