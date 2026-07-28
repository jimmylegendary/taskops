#!/usr/bin/env node
// BARE-agent arm for SWE-bench **Pro** (NO TaskOps) — the A arm of the paired lift experiment.
// The same executor/model gets the same checkout and the SAME task text as the TaskOps arm (problem_statement +
// requirements + interface: Pro issues are deliberately underspecified, so withholding requirements/interface from
// this arm would make the contrast "taskops vs a worse prompt" instead of "taskops vs no taskops"). It self-reports
// via DONE.txt with NO acceptance gate, NO requiredCheck, NO verify/retry. The resulting repo state is then graded by
// the OFFICIAL Scale AI Pro Docker harness (swebench_pro_grade.py) — the identical judge the C arm uses.
//   usage: node run_swebench_pro_bare.mjs <instance_id> [dataset]
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, cpSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { invokeRuntimeAdapter } from '/home/jimmy/repos/taskops/cli/lib-runtime-adapters.js';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const VENV_PY = join(EVAL, '.venv', 'bin', 'python');
const GRADE = join(here, 'swebench_pro_grade.py');
const instanceId = process.argv[2];
const dataset = process.argv[3] || 'ScaleAI/SWE-bench_Pro';
const executor = process.env.TASKOPS_SWE_EXECUTOR || 'codex-cli';
if (!instanceId) { console.error('usage: run_swebench_pro_bare.mjs <instance_id> [dataset]'); process.exit(2); }

// claude-code goes through the MCP-safe wrapper (nested-agent hang + 3s stdin wait) — same rule as the other arms,
// so both arms of the pair invoke the model through an identical path.
if (executor === 'claude-code') {
  const wrapper = '/home/jimmy/repos/personal-assets-vault/taskops-governance/experiments/claude-safe-wrapper.sh';
  chmodSync(wrapper, 0o755); process.env.TASKOPS_CLAUDE_BIN = wrapper;
}

const meta = JSON.parse(execFileSync(VENV_PY, [join(here, 'dump_instance_pro.py'), instanceId, dataset], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const CO = `/tmp/swebench-pro-co-bare/${instanceId}`;
if (!existsSync(join(CO, '.git'))) {
  mkdirSync(dirname(CO), { recursive: true });
  execFileSync('git', ['clone', '-q', `https://github.com/${meta.repo}`, CO], { stdio: 'inherit' });
}
execFileSync('git', ['-C', CO, 'checkout', '-q', '-f', meta.base_commit]);
execFileSync('git', ['-C', CO, 'clean', '-qxfd']);

const ws = mkdtempSync(join(tmpdir(), `bare-swepro-${instanceId}-`));
cpSync(CO, join(ws, 'repo'), { recursive: true });
const repoDir = join(ws, 'repo');

// Task text mirrors run_swebench_pro.mjs's objective verbatim in content (issue + requirements + interface); only the
// completion protocol differs (DONE.txt self-report instead of a runner-owned acceptance gate).
const prompt = [
  `You are resolving a real GitHub issue in the ${meta.repo} repository (language: ${meta.repo_language}), checked out`,
  `at ${repoDir}. Edit the SOURCE to resolve the issue so the project's test suite passes. Do NOT edit anything under`,
  `tests/ or test files — the grader re-applies the project's canonical tests itself inside a sealed image, so any`,
  `test edits you make are discarded.`,
  `When you are finished and believe the issue is resolved, write a one-line file DONE.txt in ${repoDir} containing exactly: DONE`,
  ``, `ISSUE:`, meta.problem_statement,
  ``, `REQUIREMENTS (the behaviour the hidden tests check):`, meta.requirements,
  ``, `INTERFACE (signatures/paths you must implement or preserve):`, meta.interface,
].join('\n');

const t0 = Date.now();
let adapterOk = false;
try {
  const r = invokeRuntimeAdapter(executor, { prompt, agentId: `bare-swepro-${instanceId}`, timeoutMs: 900000, cwd: repoDir });
  adapterOk = r.ok !== false;
} catch { adapterOk = false; }

const claimedDone = existsSync(join(repoDir, 'DONE.txt'));
let diffFiles = 0;
try { diffFiles = execFileSync('git', ['-C', repoDir, 'diff', '--numstat'], { encoding: 'utf8' }).split('\n').filter(Boolean).length; } catch {}

// infra-vs-verdict split (same contract as the Verified arms): the grader prints {"resolved":false} and exits 1 for a
// genuine UNRESOLVED verdict, but exits 2 with NO verdict token for infra death (docker pull / entryscript). Only the
// latter is undetermined. stderr is preferred and sliced at 600 so swebench_pro_grade.py's diagnostic tail survives.
let officialResolved = null, gradeError = null;
try {
  officialResolved = /"resolved":\s*true/.test(
    execFileSync(VENV_PY, [GRADE, instanceId, repoDir, dataset], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1800000 }));
} catch (e) {
  const so = String(e?.stdout || '');
  if (/"resolved":\s*(true|false)/.test(so)) officialResolved = /"resolved":\s*true/.test(so);
  else { officialResolved = null; gradeError = ((e?.stderr || e?.message || e || '').toString()).slice(0, 600); }
}

const resultTag = (process.env.TASKOPS_SWE_RESULT_TAG || '').trim().replace(/[^A-Za-z0-9._-]/g, '');
const tagDir = resultTag ? `-${resultTag}` : '';
const rec = {
  instance_id: instanceId, dataset, executor, arm: 'bare',
  // the experiment's only independent variable, recorded so a result file proves its own provenance
  claude_model: process.env.TASKOPS_CLAUDE_MODEL || null, result_tag: resultTag || null,
  adapter_ok: adapterOk, claimed_done: claimedDone, official_resolved: officialResolved, grade_error: gradeError,
  agent_edited: diffFiles > 0, diff_files: diffFiles,
  false_completion: claimedDone && officialResolved === false,
  missed_honest: !claimedDone && officialResolved === true,
  wallclock_s: Math.round((Date.now() - t0) / 1000),
};
const bareDir = join(EVAL, 'results', 'bare', `pro${tagDir}`);
mkdirSync(bareDir, { recursive: true });
writeFileSync(join(bareDir, `bare-swepro-${executor}${tagDir}-${instanceId}.json`), JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec));
rmSync(ws, { recursive: true, force: true });
