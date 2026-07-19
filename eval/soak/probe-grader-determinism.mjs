#!/usr/bin/env node
// Grader determinism probe (verify-resolver 정합성 조사 도구; F-2 positive-control의 bench측 버전).
// 가설: astropy-14365의 C-arm FN(official=resolved, taskops verify=rejected)은 taskops 로직이 아니라
// swebench_grade.py가 자원에 민감한 FLAKY oracle이라서다. GOLD patch를 적용한 workspace는 정의상 항상
// resolved여야 하므로, 같은 workspace를 N회 grade해서 resolved가 흔들리면 grader 비결정성이 확정된다.
//   usage: node probe-grader-determinism.mjs <instance_id> [N=5] [dataset]
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const VENV_PY = join(EVAL, '.venv', 'bin', 'python');
const GRADE = join(EVAL, 'adapters', 'swebench_grade.py');
const instanceId = process.argv[2];
const N = Number(process.argv[3] || 5);
const dataset = process.argv[4] || 'princeton-nlp/SWE-bench_Lite';
if (!instanceId) { console.error('usage: probe-grader-determinism.mjs <instance_id> [N] [dataset]'); process.exit(2); }

// pull base_commit + repo + GOLD patch straight from the dataset (gold = the reference fix; a graded gold workspace
// MUST resolve — any non-resolve is grader flakiness, never a real verdict).
const meta = JSON.parse(execFileSync(VENV_PY, ['-c',
  `import json,sys;from datasets import load_dataset;` +
  `ex=[r for r in load_dataset('${dataset}',split='test') if r['instance_id']=='${instanceId}'][0];` +
  `print(json.dumps({'repo':ex['repo'],'base_commit':ex['base_commit'],'patch':ex['patch']}))`],
  { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));

const CO = `/tmp/swebench-co/${instanceId}`;
if (!existsSync(join(CO, '.git'))) { mkdirSync(dirname(CO), { recursive: true }); execFileSync('git', ['clone', '-q', `https://github.com/${meta.repo}`, CO], { stdio: 'inherit' }); }
execFileSync('git', ['-C', CO, 'checkout', '-q', '-f', meta.base_commit]);
execFileSync('git', ['-C', CO, 'clean', '-qxfd']);

const root = mkdtempSync(join(tmpdir(), `grader-probe-${instanceId}-`));
const workspace = join(root, 'repo');
cpSync(CO, workspace, { recursive: true });
// apply the GOLD patch so the workspace is, by construction, a correct fix
const patchFile = join(root, 'gold.patch');
writeFileSync(patchFile, meta.patch, 'utf8');
try { execFileSync('git', ['-C', workspace, 'apply', patchFile], { stdio: 'pipe' }); }
catch { execFileSync('patch', ['-p1', '-i', patchFile], { cwd: workspace, stdio: 'pipe' }); }

console.log(`[probe] ${instanceId} gold-patched workspace, grading ${N}×...`);
const outcomes = [];
for (let i = 0; i < N; i++) {
  const t0 = Date.now();
  let verdict = null;
  let err = null;
  try {
    const out = execFileSync(VENV_PY, [GRADE, instanceId, workspace], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1800000 });
    verdict = /"resolved":\s*true/.test(out);
  } catch (e) {
    const so = String(e?.stdout || '');
    const m = so.match(/"resolved":\s*(true|false)/);
    if (m) verdict = m[1] === 'true';
    else { verdict = null; err = String(e?.stderr || e?.message || '').slice(0, 200); }
  }
  const s = Math.round((Date.now() - t0) / 1000);
  outcomes.push({ run: i + 1, resolved: verdict, elapsedS: s, err });
  console.log(`  run ${i + 1}/${N}: resolved=${verdict} (${s}s)${err ? ' ERR:' + err : ''}`);
}

const resolvedCount = outcomes.filter((o) => o.resolved === true).length;
const infra = outcomes.filter((o) => o.resolved === null).length;
const flaky = resolvedCount !== N; // a gold workspace that ever fails to resolve = grader nondeterminism
const verdict = infra === N ? 'ALL_INFRA (Docker/자원 문제 — 판정 불가)'
  : flaky ? 'FLAKY (gold workspace가 항상 resolved가 아님 → grader 비결정성 확정)'
  : 'STABLE (gold workspace가 N회 모두 resolved → grader는 이 인스턴스에서 결정적)';
const report = { instance_id: instanceId, N, resolvedCount, infra, flaky, verdict, outcomes };
mkdirSync(join(here, 'grader-probe'), { recursive: true });
writeFileSync(join(here, 'grader-probe', `${instanceId}.json`), JSON.stringify(report, null, 2), 'utf8');
console.log(`\n[probe] ${instanceId}: ${resolvedCount}/${N} resolved, ${infra} infra → ${verdict}`);
rmSync(root, { recursive: true, force: true });
