#!/usr/bin/env node
// ALE 스모크 이벤트 집계기 — **성공 기준 판정은 오직 이 출력으로 한다** (ALE 점수와 분리).
//
// 존재 이유: SWE-bench 실험에서 decomposition/exploration/surprise 가 전부 0 이었다는 사실을
// '사후에야' 발견했다. 그때 집계기가 있었다면 첫 런에서 바로 드러났을 것이다.
// 그래서 run_ale.mjs 끝에서 이 스크립트를 자동 실행한다.
//
// 이벤트 명은 cli/lib-runner.js 에서 실측 확인한 것이다:
//   decomposition_started / decomposition_completed / decomposition_coverage_gap / decomposition_failed
//   exploration_started / exploration_completed / exploration_failed
//   high_surprise / task_selected
//   런노드 type: 'exploration' (5034), 'decomposition' (4888)
//
//   usage: node ale_events_report.mjs <workDir> [runId]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarkdownFile } from '/home/jimmy/repos/taskops/cli/lib-taskops.js';

const workDir = process.argv[2];
const runId = process.argv[3] || 'r1';
if (!workDir) { console.error('usage: ale_events_report.mjs <workDir> [runId]'); process.exit(2); }

const runDir = join(workDir, 'runs', runId);
if (!existsSync(runDir)) { console.error(`[report] 런 디렉터리가 없다: ${runDir}`); process.exit(2); }

const events = existsSync(join(runDir, 'events.jsonl'))
  ? readFileSync(join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];
const n = (t) => events.filter((e) => e.type === t).length;

const nodesDir = join(runDir, 'nodes');
const nodes = existsSync(nodesDir)
  ? readdirSync(nodesDir).filter((f) => f.endsWith('.md') && !f.startsWith('review-'))
      .map((f) => { try { return parseMarkdownFile(join(nodesDir, f)); } catch { return null; } }).filter(Boolean)
  : [];
const explorationNodes = nodes.filter((x) => x.type === 'exploration');
const decompositionNodes = nodes.filter((x) => x.type === 'decomposition');

// task 파일들
// ★ task 열거는 반드시 **모든** task group 을 훑어야 한다.
// deriveDecompositionIds(lib-runner.js:3920-3926)는 분해 결과를 루트와 같은 그룹이 아니라
// **새 자식 task group** `tg-<taskId>` / 버전 `tgv-<taskId>-v1` 에 만든다.
// 따라서 tg-root/versions/tgv-root-v1 만 보면 분해가 성공해도 자식 수가 항상 0 으로 읽혀
// 부기준3(자식≥2)과 최우선 확인 항목(자식 uncertainty/requiredChecks 전파)이 통째로
// 측정 불가가 된다 — 스모크에서 실제로 이 버그를 밟았다.
const groupsRoot = join(workDir, 'task-groups');
const tasks = [];
const groupDirs = existsSync(groupsRoot) ? readdirSync(groupsRoot) : [];
for (const g of groupDirs) {
  const versionsDir = join(groupsRoot, g, 'versions');
  if (!existsSync(versionsDir)) continue;
  for (const v of readdirSync(versionsDir)) {
    const dir = join(versionsDir, v, 'tasks');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      try { tasks.push({ file: f, group: g, version: v, ...parseMarkdownFile(join(dir, f)) }); } catch { /* skip */ }
    }
  }
}
const rootTask = tasks.find((t) => t.file === 'recover.md') || tasks[0] || {};
const childTasks = tasks.filter((t) => t !== rootTask);

// task 별 exploration 반복 횟수 (anti-loop 검증: lib-runner.js:5159)
const perTask = {};
for (const x of explorationNodes) {
  const k = x.taskId || x.sourceTaskId || 'unknown';
  perTask[k] = (perTask[k] || 0) + 1;
}
const maxPerTask = Object.values(perTask).reduce((a, b) => Math.max(a, b), 0);

const coverageGaps = events.filter((e) => e.type === 'decomposition_coverage_gap');

const row = (k, v) => `  ${String(k).padEnd(34)} ${v}`;
const yn = (b) => (b ? 'YES' : 'no');

console.log('');
console.log('═══ ALE 스모크 이벤트 집계 ═══════════════════════════════════════════');
console.log(`  work=${workDir}`);
console.log(`  run=${runId}   총 이벤트=${events.length}`);
console.log('');
console.log('── 주 성공 기준 (PREREGISTRATION.md §5) ──────────────────────────────');
const decompStarted = n('decomposition_started');
const explorationCount = explorationNodes.length;
const primaryMet = decompStarted >= 1 && explorationCount >= 1;
console.log(row('decomposition_started', decompStarted));
console.log(row("런노드 type:'exploration'", explorationCount));
console.log(row('▶ 주 기준 충족', primaryMet ? 'PASS' : 'FAIL'));
console.log('     (ALE score=0.0 이어도 이 둘이 ≥1 이면 스모크는 성공이다)');
console.log('');
console.log('── 분해 상세 ─────────────────────────────────────────────────────────');
console.log(row('decomposition_completed', n('decomposition_completed')));
console.log(row('decomposition_failed', n('decomposition_failed')));
console.log(row('decomposition_coverage_gap', coverageGaps.length));
for (const g of coverageGaps) {
  console.log(`     coverageRatio=${g.coverageRatio ?? g.ratio ?? '?'} taskId=${g.taskId ?? '?'}`);
}
console.log(row("런노드 type:'decomposition'", decompositionNodes.length));
console.log(row('자식 task 수', childTasks.length));
console.log(row('▶ 부기준3 실질적 분해(자식≥2)', childTasks.length >= 2 ? 'PASS' : 'FAIL (형식적 분해는 실패)'));
console.log('');
console.log('── 탐색 상세 ─────────────────────────────────────────────────────────');
console.log(row('exploration_started', n('exploration_started')));
console.log(row('exploration_completed', n('exploration_completed')));
console.log(row('exploration_failed', n('exploration_failed')));
console.log(row('task별 exploration 횟수', JSON.stringify(perTask)));
console.log(row('최대 반복', maxPerTask));
console.log(row('▶ 부기준5 무한루프 없음(≤2)', maxPerTask <= 2 ? 'PASS' : 'FAIL (anti-loop 5159 위반 의심)'));
console.log('');
console.log('── 계획이 바뀌었다는 증거 (부기준4) ──────────────────────────────────');
const highSurprise = n('high_surprise');
const rootSurprise = Array.isArray(rootTask.surpriseHistory) ? rootTask.surpriseHistory.length : 0;
const childWithUnknowns = childTasks.filter((t) => Boolean(t.uncertaintyState) || (Array.isArray(t.unknowns) && t.unknowns.length > 0)).length;
console.log(row('high_surprise 이벤트', highSurprise));
console.log(row('루트 surpriseHistory 길이', rootSurprise));
console.log(row('unknowns/uncertainty 선언 자식', childWithUnknowns));
const plannedChanged = highSurprise >= 1 || rootSurprise >= 1 || childWithUnknowns >= 1;
console.log(row('▶ 부기준4 충족', plannedChanged ? 'PASS' : 'FAIL'));
console.log('     (탐색이 아무것도 바꾸지 못했다면 구조화 CoT 가 작동하지 않은 것이다)');
console.log('');
console.log('── 루트 task 전이 (부기준2 / lib-runner.js:5153,5160) ────────────────');
console.log(row('uncertaintyState', rootTask.uncertaintyState ?? '(없음)'));
console.log(row('runReadiness', rootTask.runReadiness ?? '(없음)'));
console.log(row('status', rootTask.status ?? '(없음)'));
console.log(row('runReadinessReason', String(rootTask.runReadinessReason ?? '(없음)').slice(0, 90)));
const transitioned = rootTask.uncertaintyState === 'known_unknown' && rootTask.runReadiness === 'needs_decomposition';
console.log(row('▶ 부기준2 전이 확인', transitioned ? 'PASS' : `FAIL (기대: known_unknown + needs_decomposition)`));
console.log('');
console.log('── 자식 task 목록 ────────────────────────────────────────────────────');
if (!childTasks.length) console.log('  (없음)');
for (const t of childTasks) {
  console.log(`  ${t.file.padEnd(24)} status=${String(t.status).padEnd(9)} readiness=${String(t.runReadiness ?? '-').padEnd(20)} uncertainty=${t.uncertaintyState ?? '-'}`);
  const checks = t?.acceptance?.requiredChecks;
  console.log(`     requiredChecks 전파: ${yn(Array.isArray(checks) && checks.length > 0)}${Array.isArray(checks) ? ` (${checks.length}개)` : ''}`);
}
console.log('     ↑ 최우선 확인 항목 (PREREGISTRATION.md §8-1,4): 분해 LLM 이 자식에');
console.log('       uncertainty 필드와 requiredChecks 를 전파하는가?');
console.log('');
console.log('── 스텝 예산 (§8-2) ──────────────────────────────────────────────────');
// maxSteps 는 하드코딩하지 말고 runner_started 이벤트에 실제로 기록된 값을 읽는다.
// (하드코딩 40 은 ALE_MAX_STEPS 로 낮춰 돌린 스모크에서 거짓 'ok' 를 찍는다.)
const runnerStarted = events.find((e) => e.type === 'runner_started') || {};
const maxSteps = Number(runnerStarted.maxSteps ?? 40);
// ★ task_selected 는 execute 액션에서만 발화한다. explore/decompose 만으로 끝난 런에서는 0 이므로
//   이것만으로 예산 소진을 판단하면 안 된다. 실제 소비된 액션 수를 함께 센다.
const actionCount = n('exploration_started') + n('decomposition_started') + n('task_selected');
console.log(row('task_selected (execute 스텝)', n('task_selected')));
console.log(row('실제 소비 액션(explore+decompose+exec)', actionCount));
console.log(row('maxSteps (runner_started 실측)', maxSteps));
console.log(row('예산 소진 여부', actionCount >= maxSteps ? 'EXHAUSTED — 예산 부족 의심' : 'ok'));
console.log('');
console.log('── 이벤트 type 분포 ──────────────────────────────────────────────────');
const dist = {};
for (const e of events) dist[e.type] = (dist[e.type] || 0) + 1;
for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(row(k, v));
console.log('');
console.log('═══ 판정 ════════════════════════════════════════════════════════════');
console.log(`  주 기준: ${primaryMet ? 'PASS' : 'FAIL'}`);
console.log(`  부기준2 전이: ${transitioned ? 'PASS' : 'FAIL'} | 부기준3 분해: ${childTasks.length >= 2 ? 'PASS' : 'FAIL'} | 부기준4 계획변경: ${plannedChanged ? 'PASS' : 'FAIL'} | 부기준5 루프: ${maxPerTask <= 2 ? 'PASS' : 'FAIL'}`);
console.log('  ※ ALE 공식 점수는 이 판정에 들어가지 않는다 (CONTAMINATION.md §6).');
console.log('');

process.exit(primaryMet ? 0 : 1);
