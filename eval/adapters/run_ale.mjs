#!/usr/bin/env node
// TaskOps × ALE (Agents' Last Exam, Berkeley RDI) 어댑터 — ranking_node 과제 1 인스턴스.
//
// ─────────────────────────────────────────────────────────────────────────────
// 이 어댑터가 SWE-bench 어댑터와 결정적으로 다른 점 (eval/ale/PREREGISTRATION.md §3, §4)
// ─────────────────────────────────────────────────────────────────────────────
// run_swebench_pro.mjs:90 은 task 를 이렇게 만들었다:
//     task: { id: "solve", runReadiness: "runnable", understandingLevel: "known" }
// task 1개 · runnable · known 하드코딩. 분해할 것도 모를 것도 없다고 미리 못박아
// taskops 를 execute→verify→retry 래퍼로 축소시켰고, 그 껍데기의 lift 를 쟀다.
// 실측 이벤트: task_selected 35 · verify_retry 22 · decomposition 0 · exploration 0 · surprise 0.
//
// 따라서 이 어댑터는:
//   (1) runReadiness / understandingLevel 을 **절대 쓰지 않는다**. classifyTaskReadiness 가 유도하게 둔다.
//   (2) uncertaintyState='unknown_unknown' 하나만 세팅한다 — 이것이 유일한 레버다.
//       (lib-taskops.js:1629 hasUncertaintyReadinessFields 가 uncertainty 스칼라 하나만 있어도 true 를
//        반환해 uncertainty 경로가 primary 가 되고 legacy depth_contract(1686)는 우회되므로,
//        expectedPlan.expectedDepth 로는 분해를 강제할 수 없다.)
//   (3) maxSteps=40. run_swebench_pro.mjs 의 maxSteps=verifyRetries+2 (=2~3) 는 explore 1스텝 +
//       decompose 1스텝으로 소진되어 자식 실행이 불가능했다 — decomposition=0 의 독립적 두 번째 원인.
//
// 결정론적 2스텝 보장:
//   step1: unknown_unknown → (lib-taskops.js:1709) needs_exploration → (lib-runner.js:1839) explore
//   step2: 탐색 성공 시 lib-runner.js:5153 이 runReadiness='needs_decomposition' 를 쓰고
//          5160 이 known_unknown 으로 승격 → isDecompositionReadyByUncertainty(1971) true → decompose
//
// ─────────────────────────────────────────────────────────────────────────────
// 오염 격리 (eval/ale/CONTAMINATION.md)
// ─────────────────────────────────────────────────────────────────────────────
// 이 파일은 ale_grade.py 를 **import 하지도 spawn 하지도 않는다.**
// ALE 공식 채점기(verify_safe_recover.py)는 requiredChecks 에 절대 연결되지 않는다.
// SWE-bench 에서 requiredCheck 에 공식 채점기를 걸었던 것(run_swebench_pro.mjs:94, oracle:true)이
// 정확히 "시험지 내고 채점 결과 본 뒤 답안 고쳐 재제출"하는 오염이었다. 반복 금지.
// 점수는 이 런의 어떤 경로에도 들어오지 않는다 — 채점은 에이전트 종료 후 사후 1회, 별도 진입점에서.
//
//   usage: node run_ale.mjs <containerName> [runTag]
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fmBlock, parseMarkdownFile } from '/home/jimmy/repos/taskops/cli/lib-taskops.js';
import { runTaskOps } from '/home/jimmy/repos/taskops/cli/lib-runner.js';
import { summarizeAleSteps } from './ale_step_accounting.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const SHIM = join(here, 'ale_codex_shim.sh');
const REPORT = join(here, 'ale_events_report.mjs');

const container = process.argv[2];
const runTag = process.argv[3] || 'smoke';
if (!container) { console.error('usage: run_ale.mjs <containerName> [runTag]'); process.exit(2); }
// 타 세션 컨테이너(hive-app-1 / hive-db-1 / n8n-* / sweb.eval.*) 보호.
if (!container.startsWith('taskops-ale-')) {
  console.error(`[ale] 오류: '${container}' 는 우리 컨테이너가 아니다(접두사 taskops-ale- 필요).`);
  process.exit(2);
}

const dx = (args, opts = {}) => execFileSync('docker', ['exec', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

// ── objective = /workspace/instruction.md 원문 ───────────────────────────────
// 요약·재작성·가공 금지. 과제가 에이전트에게 주는 문서 그 자체가 objective 다.
//
// ★ 알려진 충실도 한계 (설계 요구 "원문 그대로"를 완전히는 만족시킬 수 없다) ★
// fmScalar(lib-taskops.js:2320-2332)는 identity 계열이 아닌 모든 스칼라에 대해
//   text.replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim()
// 를 무조건 적용한다. block-scalar 경로가 없으므로 frontmatter 는 여러 줄 텍스트를
// 원문 그대로 담을 수 없다. 이것은 taskops 저장 포맷의 구조적 성질이지 이 어댑터의 선택이 아니며,
// 벤치를 위해 taskops 코어를 고치는 것은 범위 밖이다.
//
// 실측 확인: 3499B → 3437B (62B 감소). 토큰 477개가 순서까지 완전히 동일하므로
// **내용 손실은 없고 줄 구조만 붕괴**한다. 다만 그 붕괴가 무해하지는 않다 — 예:
//   "You may create or modify only: - a.py - b.json - c.md - The service test run may generate ..."
// 처럼 '수정 허용 목록'과 그 다음 규칙의 경계가 사라져 4번째 항목으로 오독될 수 있다.
// 이 구간이 바로 채점의 disallowed_modified 를 좌우하는 Strict rules 다.
//
// 완화책(objective 자체는 손대지 않는다): taskops 메타 필드인 responsibility 에
// "정본은 /workspace/instruction.md" 라는 지시를 넣어 에이전트가 바이트 단위 원문을 읽게 한다.
// 컨테이너 /workspace 에 원문이 그대로 있으므로 정본 접근 경로는 항상 열려 있다.
// 원문 sha256 을 결과 레코드에 남겨 어떤 문서를 objective 로 썼는지 사후 증명 가능하게 한다.
let instruction;
try {
  instruction = dx(['-u', '1000', container, 'cat', '/workspace/instruction.md']);
} catch (e) {
  console.error(`[ale] 오류: /workspace/instruction.md 를 읽지 못했다. 시드가 끝났는지 확인하라. ${e.message}`);
  process.exit(2);
}
if (!instruction.trim()) { console.error('[ale] 오류: instruction.md 가 비어 있다.'); process.exit(2); }
console.log(`[ale] instruction.md ${Buffer.byteLength(instruction)} bytes`);

// ── work 스캐폴딩 (run_swebench_pro.mjs 의 구조만 재사용) ────────────────────
const now = new Date().toISOString();
// work 디렉터리는 반드시 ALE_WORK_ROOT 아래에 만든다. 이 경로는 ale_container.sh 가 컨테이너에
// **동일 절대경로**로 bind-mount 한 곳이다.
// 이유: performAgentExploration(lib-runner.js:5017-5019)이 에이전트에게 호스트 경로를 아티팩트
// 목적지로 지시한 뒤 호스트에서 existsSync 로 검사한다. 실행기는 컨테이너 안에서 도므로 공유
// 마운트가 없으면 아티팩트가 호스트에 나타나지 않아 exploration 이 항상 실패하고,
// readiness 승격(5148-5163, 성공 경로 전용)이 돌지 않아 decomposition 이 0 이 된다.
// tmpdir() 로 되돌리지 마라 — SWE-bench 의 '껍데기 taskops' 실패가 그대로 재발한다.
const ALE_WORK_ROOT = process.env.ALE_WORK_ROOT || '/tmp/taskops-ale-work';
mkdirSync(ALE_WORK_ROOT, { recursive: true });
const root = mkdtempSync(join(ALE_WORK_ROOT, `${runTag}-`));
const w = join(root, 'work');
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
const taskId = 'recover';
const runId = 'r1';
for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'ale', title: 'ALE', objective: 'ale-ranking-node', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'ALE ranking node recovery', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });

const runDir = join(w, 'runs', runId);
for (const d of ['nodes', 'edges']) mkdirSync(join(runDir, d), { recursive: true });
writeFileSync(join(runDir, 'index.md'), `${fmBlock({ taskOpsVersion: 'v1', entityType: 'run', id: runId, workId: 'ale', createdAt: now, status: 'active' })}# Run ${runId}\n`, 'utf8');
writeFileSync(join(runDir, 'run-log.md'), '# Run log\n', 'utf8');
writeFileSync(join(runDir, 'events.jsonl'), '', 'utf8');
// 실행 workspace 는 컨테이너 안의 /workspace 다. 호스트 쪽은 런너가 cwd 로만 쓰므로 빈 디렉터리로 둔다.
mkdirSync(join(runDir, 'artifacts', `run-node-${taskId}`, 'workspace'), { recursive: true });

// ── requiredChecks: 정확히 2개, 전부 지시서 본문에 문자 그대로 적힌 것만 ──────
// 판별 기준(CONTAMINATION.md §1): 과제가 에이전트에게 명시적으로 준 도구인가 → ALLOW.
//                                 채점자가 사후에 쓰는 것인가 → DENY. 모호하면 DENY.
// executeRequiredChecks(lib-taskops.js:1231)는 호스트에서 cwd 기준 셸 실행이므로
// 컨테이너 안을 검사하려면 반드시 docker exec 래핑이 필요하다.
//
// (1) 근거: instruction.md 26행 '## Required behavior' 1번이 문자 그대로
//     `pytest -q /workspace/testsuite must exit with code 0` 을 요구한다.
//     oracle:true 를 주지 않는다 — oracle:true 는 '외부 오라클 소비'를 뜻하는데 이건 과제가 준 내부 도구다.
const CHECK_PYTEST = `docker exec -u 1000 ${container} /workspace/.venv/bin/pytest -q /workspace/testsuite`;
// (2) 근거: instruction.md 32-42행 '## Required behavior' 3번 + '## Deliverable requirements'.
//     값의 정합성·임계값 검사는 하지 않는다 — 그건 채점기 로직의 복제다.
const DELIVERABLE_PY = [
  'import json,sys,os',
  'p="/workspace"',
  'need=["cleanup_summary.json","incident_report.md","state/feature_manifest.json"]',
  'missing=[n for n in need if not os.path.isfile(os.path.join(p,n))]',
  'assert not missing, "missing: %s" % missing',
  'json.load(open(os.path.join(p,"cleanup_summary.json")))',
  'json.load(open(os.path.join(p,"state/feature_manifest.json")))',
  'print("DELIVERABLES_OK")',
].join('; ');
const CHECK_DELIVERABLES = `docker exec -u 1000 ${container} python3 -c '${DELIVERABLE_PY}'`;

// ── 루트 task 1개 ────────────────────────────────────────────────────────────
md(`${tv}/tasks/${taskId}.md`, {
  taskOpsVersion: 'v1', entityType: 'task', id: taskId, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: 'ALE ranking_node_feature_parity_recovery_instance_1',
  objective: instruction,   // 원문 (fmScalar 가 줄 구조만 평탄화 — 위 주석의 충실도 한계 참조)
  // responsibility 는 taskops 메타 필드다. objective 를 건드리지 않고 정본 접근을 보장하기 위해
  // 여기에만 정본 포인터를 둔다 — objective 평탄화로 Strict rules 의 목록 경계가 사라지는 문제 완화.
  responsibility: '먼저 /workspace/instruction.md 를 그대로 읽어라 — 그것이 이 과제의 정본이며, objective 에 실린 사본은 줄바꿈이 평탄화되어 목록 경계가 모호할 수 있다. 그 다음 /workspace/safe_recover.py 복구 도구를 구현하고 지시서가 요구하는 산출물 3종을 생성한다',
  completionCriteria: 'pytest -q /workspace/testsuite 가 exit 0 이고, cleanup_summary.json / incident_report.md / state/feature_manifest.json 3종이 존재하며 JSON이 파싱된다 (지시서 Required behavior 1·3의 문자 그대로)',
  order: 1, createdAt: now, status: 'pending',
  // ★ runReadiness / understandingLevel 을 여기에 쓰지 않는다. run_swebench_pro.mjs:90 의
  //   치명적 실수가 정확히 이 두 필드였다(runnable+known 하드코딩 → decomposition/exploration 0).
  //   classifyTaskReadiness(lib-taskops.js:1538)가 아래 uncertaintyState 로부터 유도하게 둔다.
  uncertaintyState: 'unknown_unknown',
  // 정직성: 게이밍이 아니라 사실 서술이다. 함정 문서가 심어져 있고(instruction.md 19행) 에이전트는
  // 시작 시점에 무엇이 함정인지는커녕 함정이 있다는 것조차 모른다 — 문자 그대로 unknown unknown.
  expectedPlan: { expectedDepth: 2 },   // readiness 판정엔 관여하지 않지만 coverage 평가/예산에 쓰인다
  acceptance: { mode: 'guarded', expectedOutcome: '지시서 Required behavior 1·3 충족',
    requiredChecks: [{ command: CHECK_PYTEST }, { command: CHECK_DELIVERABLES }] },
});

// ── 실행기 배선: 컨테이너 안의 codex ────────────────────────────────────────
// adapterCommand(lib-runtime-adapters.js:47-50)가 TASKOPS_CODEX_BIN 으로 바이너리를 override 한다.
process.env.TASKOPS_CODEX_BIN = SHIM;
process.env.ALE_CONTAINER = container;

// 스모크는 40~60분 상한 안에서 끝나야 하므로 예산을 env 로 조절할 수 있게 한다.
// 기본값은 설계값(본 실행용)을 그대로 유지한다 — 스모크에서만 낮춰 쓴다.
const MAX_STEPS = Number(process.env.ALE_MAX_STEPS || 40);
const STEP_TIMEOUT = Number(process.env.ALE_STEP_TIMEOUT || 7200);

const t0 = Date.now();
console.log(`[ale] taskops 런 시작 (container=${container}, maxSteps=${MAX_STEPS}, timeout=${STEP_TIMEOUT}s)`);
let runError = null;
try {
  runTaskOps(w, {
    executor: 'codex-cli', runId,
    maxSteps: MAX_STEPS,      // ← SWE-bench 의 verifyRetries+2 재발 방지
    // 이 한 줄이 빠져 있어 budgetEnabled=false → expectedPlanCoordinate 미생성 → committing guard 가
    // 통째로 죽어 있었다. 수렴 게이트는 budgetEnabled 와 분리돼 있지만, 관측 오염을 막으려면 필요하다.
    maxStepsExplicit: true,
    ...(process.env.ALE_MAX_WALL_MS ? { maxWallClockMs: Number(process.env.ALE_MAX_WALL_MS) } : {}),
    verifyChecks: true,
    continueOnFailure: true,  // exploration 실패가 런 전체를 죽이지 않게
    timeout: STEP_TIMEOUT,    // ALE 공식 task timeout 과 동급
  });
} catch (e) {
  runError = (e && (e.message || String(e))) || 'unknown';
  console.error(`[ale] 런너 예외: ${runError}`);
}
const wallclock_s = Math.round((Date.now() - t0) / 1000);

// ── 이벤트 집계 (성공 판정은 오직 여기서 — ALE 점수와 분리) ──────────────────
const eventsPath = join(runDir, 'events.jsonl');
const events = existsSync(eventsPath)
  ? readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];
const countType = (t) => events.filter((e) => e.type === t).length;
const eventsOfType = (t) => events.filter((e) => e.type === t);

// 측정 타당성 수정(3차): 기존 steps_used 는 countType('task_selected') 였다 — 그건 **execute 스텝 수**이지
// 실제 소비 스텝이 아니다. conv2 브리핑의 "예산 3/12" 는 이 혼동에서 나온 허상이다.
// 정상 종료는 runner_stopped.stepsRun 이 유일한 정본이다. 다만 예외 종료로 그 이벤트 자체가 없으면
// null 은 소비량을 숨기므로 실제 dispatch 시작 이벤트 합을 추정치로 명시해 남긴다.
const runnerStopped = eventsOfType('runner_stopped').slice(-1)[0] || null;
const stepsSummary = summarizeAleSteps(events);

// 3차 분해 품질 게이트 관측치. decomposition_quality_evaluated 는 level/mode 무관 항상 발화하므로
// 게이트 도입 전/후를 비교할 수 있는 유일한 공통 지표다.
const qualityEvents = eventsOfType('decomposition_quality_evaluated');
const executableChildrenSeries = qualityEvents.map((e) => ({
  taskId: e.taskId ?? null,
  attempt: Number.isFinite(Number(e.attempt)) ? Number(e.attempt) : null,
  level: e.level ?? null,
  childCount: Number.isFinite(Number(e.childCount)) ? Number(e.childCount) : null,
  executableChildrenCount: Number.isFinite(Number(e.executableChildrenCount)) ? Number(e.executableChildrenCount) : null,
  unresolvedBlockerCount: Number.isFinite(Number(e.unresolvedBlockerCount)) ? Number(e.unresolvedBlockerCount) : null,
}));

const nodesDir = join(runDir, 'nodes');
const nodeFiles = existsSync(nodesDir) ? readdirSync(nodesDir).filter((f) => f.endsWith('.md') && !f.startsWith('review-')) : [];
const nodes = nodeFiles.map((f) => { try { return parseMarkdownFile(join(nodesDir, f)); } catch { return null; } }).filter(Boolean);
const explorationNodes = nodes.filter((n) => n.type === 'exploration');
const decompositionNodes = nodes.filter((n) => n.type === 'decomposition');

// 루프 감시: 동일 task 에 대한 exploration 이 2회를 초과하면 이상.
// (lib-runner.js:5148 의 fm 갱신 블록은 성공 경로에만 있으므로, 탐색이 계속 실패하면
//  runReadiness 가 갱신되지 않아 재-explore 가 무한 반복될 수 있다 — PREREGISTRATION.md §8-3.)
const explorationPerTask = {};
for (const n of explorationNodes) {
  const k = n.taskId || n.sourceTaskId || 'unknown';
  explorationPerTask[k] = (explorationPerTask[k] || 0) + 1;
}
const maxExplorationPerTask = Object.values(explorationPerTask).reduce((a, b) => Math.max(a, b), 0);
const loopSuspected = maxExplorationPerTask > 2;
if (loopSuspected) console.error(`[ale] 경고: 동일 task exploration ${maxExplorationPerTask}회 — anti-loop(5159) 위반 의심`);

// 루트 task 의 전이 확인 (lib-runner.js:5153, 5160 의 실제 발화)
const rootTask = parseMarkdownFile(join(w, `${tv}/tasks/${taskId}.md`));
// ★ 자식 task 는 루트와 같은 그룹에 생기지 않는다.
// deriveDecompositionIds(lib-runner.js:3920-3926)가 분해 결과를 **새 task group** `tg-<taskId>` /
// 버전 `tgv-<taskId>-v1` 에 만든다. tgv-root-v1 만 세면 분해가 성공해도 자식 수가 항상 0 으로
// 읽혀 부기준3 과 '자식 전파' 확인이 통째로 측정 불가가 된다. 모든 그룹을 훑어야 한다.
const allTasks = [];
const groupsRoot = join(w, 'task-groups');
for (const g of (existsSync(groupsRoot) ? readdirSync(groupsRoot) : [])) {
  const versionsDir = join(groupsRoot, g, 'versions');
  if (!existsSync(versionsDir)) continue;
  for (const v of readdirSync(versionsDir)) {
    const dir = join(versionsDir, v, 'tasks');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      try { allTasks.push({ file: f, ...parseMarkdownFile(join(dir, f)) }); } catch { /* skip */ }
    }
  }
}
const childTasks = allTasks.filter((t) => t.file !== `${taskId}.md`);
const childDeclaringUncertainty = childTasks.filter(
  (t) => Boolean(t.uncertaintyState) || (Array.isArray(t.unknowns) && t.unknowns.length > 0),
).length;
// 자식에게 requiredChecks 가 전파됐는지 — PREREGISTRATION.md §8-1,4 의 최우선 확인 항목.
const childWithRequiredChecks = childTasks.filter(
  (t) => Array.isArray(t?.acceptance?.requiredChecks) && t.acceptance.requiredChecks.length > 0,
).length;

// ── 산출물 회수 (사후 채점보다 반드시 먼저) ─────────────────────────────────
// 채점기는 workspace 를 처음부터 다시 만들고 safe_recover.py 하나만 복사해 넣는다
// (verify_safe_recover.py:285, 279). 따라서 회수를 나중에 하면 에이전트 산출물이 사라진다.
const outDir = join(EVAL, 'results', 'ale', `${runTag}-${runId}`);
mkdirSync(outDir, { recursive: true });
// objective 로 실은 지시서의 바이트 단위 원문을 보존한다(평탄화 이전). 결과 해석 시 정본 대조용.
writeFileSync(join(outDir, 'instruction.verbatim.md'), instruction, 'utf8');
spawnSync(join(here, 'ale_container.sh'), ['collect', container, outDir], { stdio: 'inherit' });

// ── 우리 자체 게이트: 런 종료 후 독립 1회 실행 ──────────────────────────────
// 루트는 explore→decompose 경로를 타고 자식으로 위임되므로 스스로 execute 되지 않을 수 있다.
// 분해 LLM 이 자식 leaf 에 checks 를 전파하는지 미확인이므로(PREREGISTRATION.md §8-1,4)
// 여기서 독립적으로 1회 실행해 기록만 남긴다. **런타임 게이트가 아니다.**
const runCheck = (cmd) => { const r = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8' }); return { rc: r.status, out: (r.stdout || '').slice(-2000), err: (r.stderr || '').slice(-2000) }; };
const gatePytest = runCheck(CHECK_PYTEST);
const gateDeliverables = runCheck(CHECK_DELIVERABLES);

// ── 결과 레코드 ─────────────────────────────────────────────────────────────
// ALE 점수 필드는 여기에 **없다**. 채점은 사후 별도 진입점(ale_grade.py)에서만 이뤄지며
// 그 결과는 이 런의 어떤 경로에도 되먹임되지 않는다.
const rec = {
  benchmark: 'ALE', task_id: 'computing_math/ranking_node_feature_parity_recovery_instance_1',
  container, run_tag: runTag, run_id: runId, executor: 'codex-cli',
  claude_model: process.env.TASKOPS_CLAUDE_MODEL || null,
  work_dir: w, run_error: runError,
  taskops_status: rootTask.status || null,
  // objective 출처 증명: 어떤 문서를 실었는지 사후에 바이트 단위로 확인할 수 있게 한다.
  instruction_bytes: Buffer.byteLength(instruction),
  instruction_sha256: createHash('sha256').update(instruction).digest('hex'),
  objective_flattened: true,   // fmScalar 가 줄 구조를 평탄화함 (내용 손실 없음, 구조만 붕괴)

  // 주 성공 기준 (PREREGISTRATION.md §5)
  decomposition_started: countType('decomposition_started'),
  exploration_nodes: explorationNodes.length,
  primary_criterion_met: countType('decomposition_started') >= 1 && explorationNodes.length >= 1,

  // 부 기준
  decomposition_completed: countType('decomposition_completed'),
  decomposition_failed: countType('decomposition_failed'),
  decomposition_coverage_gap: countType('decomposition_coverage_gap'),
  decomposition_nodes: decompositionNodes.length,
  exploration_started: countType('exploration_started'),
  exploration_completed: countType('exploration_completed'),
  exploration_failed: countType('exploration_failed'),
  high_surprise: countType('high_surprise'),
  root_surprise_history: Array.isArray(rootTask.surpriseHistory) ? rootTask.surpriseHistory.length : 0,
  child_task_count: childTasks.length,
  child_declaring_uncertainty: childDeclaringUncertainty,
  child_with_required_checks: childWithRequiredChecks,
  root_uncertaintyState: rootTask.uncertaintyState || null,
  root_runReadiness: rootTask.runReadiness || null,
  root_runReadinessReason: rootTask.runReadinessReason || null,
  exploration_per_task: explorationPerTask,
  max_exploration_per_task: maxExplorationPerTask,
  loop_suspected: loopSuspected,

  // 우리 자체 게이트 (ALE 점수 아님)
  our_gate_pytest_rc: gatePytest.rc,
  our_gate_deliverables_ok: gateDeliverables.rc === 0,
  our_gate_deliverables_out: gateDeliverables.out,

  // 3차 분해 품질 게이트
  decomposition_quality_evaluated: countType('decomposition_quality_evaluated'),
  decomposition_quality_rejected: countType('decomposition_quality_rejected'),
  decomposition_fallback_parent_execute: countType('decomposition_fallback_parent_execute'),
  decomposition_quality_blocked_honest: countType('decomposition_quality_blocked_honest'),
  executable_children_series: executableChildrenSeries,
  last_executable_children_count: executableChildrenSeries.length
    ? executableChildrenSeries[executableChildrenSeries.length - 1].executableChildrenCount
    : null,
  convergence_forced_execute: countType('convergence_forced_execute'),
  convergence_deferred_acceptance_reverify: countType('convergence_deferred_acceptance_reverify'),
  convergence_blocked_no_candidate: countType('convergence_blocked_no_candidate'),
  // 4차 부채축: hard 승격이 실제로 일어났는가 / 그 hard 가 런을 죽이지 않고 계획을 계속시켰는가
  convergence_debt_hard_planning_continued: countType('convergence_debt_hard_planning_continued'),
  // 4차 분해 원자성: 롤백 후 진단 재시도 / 최종 시도의 스키마 부채 수용
  decomposition_retry_after_rollback: countType('decomposition_retry_after_rollback'),
  decomposition_schema_debt_accepted: countType('decomposition_schema_debt_accepted'),

  total_events: events.length,
  // 정상 종료는 runner_stopped.stepsRun 정본, 예외 종료만 시작 이벤트 합의 추정치다.
  steps_used: stepsSummary.stepsUsed,
  steps_used_estimated: stepsSummary.estimated,
  execute_steps: countType('task_selected'),
  stop_reason: runnerStopped?.stopReason ?? null,
  wallclock_s,
};
const recPath = join(outDir, 'result.json');
writeFileSync(recPath, JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec, null, 2));
console.log(`[ale] 결과 기록: ${recPath}`);

// ── 이벤트 집계기 자동 실행 ─────────────────────────────────────────────────
// SWE-bench 때 '사후에야' 이벤트 0 을 발견한 실수를 구조적으로 막기 위해 스모크 직후 자동 실행한다.
spawnSync('node', [REPORT, w, runId], { stdio: 'inherit' });

if (!rec.primary_criterion_met) {
  console.error('[ale] 주 성공 기준 미달: decomposition_started>=1 AND exploration nodes>=1 이 아니다.');
  process.exit(1);
}
