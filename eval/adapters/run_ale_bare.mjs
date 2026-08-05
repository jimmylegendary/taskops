#!/usr/bin/env node
// ALE bare 대조 아암 — taskops 없이 동일 프롬프트를 동일 위생 컨테이너에서 단일 에이전트로 실행.
//
// 비교가 성립하려면 오염 규칙·위생 절차·프롬프트가 run_ale.mjs 와 **완전히 동일**해야 한다:
//   - 같은 ale_container.sh up/seed/scrub/verify 를 거친 컨테이너를 받는다
//   - 프롬프트 = /workspace/instruction.md 원문 그대로 (훼손·요약·가공 금지)
//   - 실행기 = 컨테이너 안의 codex (ale_codex_shim.sh 와 동일한 docker exec 경로)
//   - 산출물 회수 방식 동일, 자체 게이트 2개 동일
// 다른 것은 오직 하나: taskops 의 분해/탐색/readiness 루프가 없다는 것.
//
// **N=1 에서는 lift 를 주장하지 않는다.** 이 아암은 궤적 대조용이며, 사전등록
// (eval/ale/PREREGISTRATION.md §5, §8-7)이 lift 주장을 명시적으로 금지한다.
//
// 이 파일도 ale_grade.py 를 import 하지도 spawn 하지도 않는다 (CONTAMINATION.md §6).
//
//   usage: node run_ale_bare.mjs <containerName> [runTag]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);

const container = process.argv[2];
const runTag = process.argv[3] || 'bare';
if (!container) { console.error('usage: run_ale_bare.mjs <containerName> [runTag]'); process.exit(2); }
if (!container.startsWith('taskops-ale-')) {
  console.error(`[ale-bare] 오류: '${container}' 는 우리 컨테이너가 아니다(접두사 taskops-ale- 필요).`);
  process.exit(2);
}

const dx = (args, opts = {}) => execFileSync('docker', ['exec', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

let instruction;
try {
  instruction = dx(['-u', '1000', container, 'cat', '/workspace/instruction.md']);
} catch (e) {
  console.error(`[ale-bare] 오류: instruction.md 를 읽지 못했다. 시드가 끝났는지 확인하라. ${e.message}`);
  process.exit(2);
}
if (!instruction.trim()) { console.error('[ale-bare] 오류: instruction.md 가 비어 있다.'); process.exit(2); }
console.log(`[ale-bare] instruction.md ${Buffer.byteLength(instruction)} bytes`);

// run_ale.mjs 와 동일한 자체 게이트 정의 (문자 그대로 같아야 비교가 성립한다).
const CHECK_PYTEST = `docker exec -u 1000 ${container} /workspace/.venv/bin/pytest -q /workspace/testsuite`;
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

// 단일 에이전트 실행: taskops 루프 없이 프롬프트 1회.
// codex 인자 벡터는 lib-runtime-adapters.js:211 codexArgs 와 동일하게 맞춘다 (실행기 조건 동일화).
const t0 = Date.now();
console.log(`[ale-bare] 단일 에이전트 실행 시작 (container=${container})`);
const args = [
  'exec', '-u', '1000', '-w', '/workspace', '-i', container,
  'env', 'HOME=/home/user', '/usr/local/bin/codex',
  '--ask-for-approval', 'never', 'exec', '--skip-git-repo-check',
  '--sandbox', 'danger-full-access',
];
const effort = (process.env.TASKOPS_CODEX_EFFORT || '').trim();
if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
args.push(instruction);

const proc = spawnSync('docker', args, {
  encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  input: '',                 // stdin 즉시 EOF — codex 의 "Reading additional input from stdin..." 블록 방지
  timeout: 7200 * 1000,      // ALE 공식 task timeout 과 동급 (taskops 아암과 동일)
});
const wallclock_s = Math.round((Date.now() - t0) / 1000);
if (proc.error) console.error(`[ale-bare] 실행 오류: ${proc.error.message}`);

// 산출물 회수는 사후 채점보다 반드시 먼저 (채점기가 workspace 를 재생성한다).
const outDir = join(EVAL, 'results', 'ale', `${runTag}-bare`);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'agent-stdout.txt'), (proc.stdout || '').slice(-500000), 'utf8');
writeFileSync(join(outDir, 'agent-stderr.txt'), (proc.stderr || '').slice(-500000), 'utf8');
spawnSync(join(here, 'ale_container.sh'), ['collect', container, outDir], { stdio: 'inherit' });

const runCheck = (cmd) => { const r = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8' }); return { rc: r.status, out: (r.stdout || '').slice(-2000) }; };
const gatePytest = runCheck(CHECK_PYTEST);
const gateDeliverables = runCheck(CHECK_DELIVERABLES);

const rec = {
  benchmark: 'ALE', arm: 'bare',
  task_id: 'computing_math/ranking_node_feature_parity_recovery_instance_1',
  container, run_tag: runTag, executor: 'codex-cli-direct',
  agent_exit_code: proc.status, agent_timed_out: proc.error ? String(proc.error.code || proc.error.message) : null,
  // taskops 아암과 동일한 자체 게이트 (ALE 점수 아님)
  our_gate_pytest_rc: gatePytest.rc,
  our_gate_deliverables_ok: gateDeliverables.rc === 0,
  our_gate_deliverables_out: gateDeliverables.out,
  // bare 아암에는 분해/탐색 개념이 없다 — 그것이 이 대조의 요점이다.
  decomposition_started: null, exploration_nodes: null,
  wallclock_s,
  note: 'N=1 대조. lift 를 주장하지 않는다 (PREREGISTRATION.md §5, §8-7).',
};
writeFileSync(join(outDir, 'result.json'), JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec, null, 2));
console.log(`[ale-bare] 결과 기록: ${join(outDir, 'result.json')}`);
