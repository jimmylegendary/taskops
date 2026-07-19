#!/usr/bin/env node
// ARM B — naive k-retry ablation (NO TaskOps). The same claude executor gets the same repo checkout + issue, and a
// DUMB shell loop retries up to k rounds: each round it re-invokes the agent; after each round the OFFICIAL grader
// (swebench_grade.py, the same oracle Arm C's requiredCheck uses) decides pass/fail and its failure message is fed
// back verbatim as the next round's context. NO work-graph, NO review, NO friction-reclassify, NO escalation — just
// "retry against the oracle until it passes or k is exhausted." This isolates what TaskOps' epistemic loop adds OVER
// dumb-retry-with-the-same-oracle (Arm B vs Arm C), and shares the oracle-as-stop-signal with Arm C so neither can
// false-complete. official_resolved after <=k rounds is the capability number.
//   usage: node run_swebench_naive.mjs <instance_id> [dataset] [k]
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, cpSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { invokeRuntimeAdapter } from '/home/jimmy/repos/taskops/cli/lib-runtime-adapters.js';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const VENV_PY = join(EVAL, '.venv', 'bin', 'python');
const GRADE = join(here, 'swebench_grade.py');
const instanceId = process.argv[2];
const dataset = process.argv[3] || 'princeton-nlp/SWE-bench_Lite';
const k = process.argv[4] != null ? Number(process.argv[4]) : 4;   // total rounds (matches Arm C verifyRetries)
const executor = process.env.TASKOPS_SWE_EXECUTOR || 'codex-cli';   // default codex: quota separate from the chat session
if (!instanceId) { console.error('usage: run_swebench_naive.mjs <instance_id> [dataset] [k]'); process.exit(2); }

if (executor === 'claude-code') { const wrapper = '/home/jimmy/repos/personal-assets-vault/taskops-governance/experiments/claude-safe-wrapper.sh'; chmodSync(wrapper, 0o755); process.env.TASKOPS_CLAUDE_BIN = wrapper; }

const meta = JSON.parse(execFileSync(VENV_PY, [join(here, 'dump_instance.py'), instanceId, dataset], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const CO = `/tmp/swebench-co-naive/${instanceId}`;
if (!existsSync(join(CO, '.git'))) { mkdirSync(dirname(CO), { recursive: true }); execFileSync('git', ['clone', '-q', `https://github.com/${meta.repo}`, CO], { stdio: 'inherit' }); }
execFileSync('git', ['-C', CO, 'checkout', '-q', '-f', meta.base_commit]);
execFileSync('git', ['-C', CO, 'clean', '-qxfd']);

const ws = mkdtempSync(join(tmpdir(), `naive-swe-${instanceId}-`));
cpSync(CO, join(ws, 'repo'), { recursive: true });
const repoDir = join(ws, 'repo');

const grade = () => {
  try {
    const out = execFileSync(VENV_PY, [GRADE, instanceId, repoDir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1200000 });
    return { resolved: /"resolved":\s*true/.test(out), verdict: /"resolved":\s*(true|false)/.test(out), msg: out.trim() };
  } catch (e) {
    // A genuine UNRESOLVED verdict exits 1 but still prints {"resolved":false} on stdout; an INFRA error prints no
    // verdict. verdict=false => don't trust resolved as a real judgment (record null official_resolved downstream).
    const so = `${(e.stdout || '').toString()}`;
    const msg = `${so}\n${(e.stderr || '').toString()}`.trim();
    return { resolved: /"resolved":\s*true/.test(so), verdict: /"resolved":\s*(true|false)/.test(so), msg };
  }
};

const basePrompt = [
  `You are resolving a real GitHub issue in the ${meta.repo} repository, checked out at ${repoDir}.`,
  `Edit the SOURCE to resolve the issue so the project's test suite passes. Do NOT edit anything under tests/ or`,
  `test files — the grader applies the project's canonical tests itself.`,
  ``, `ISSUE:`, meta.problem_statement,
].join('\n');

const t0 = Date.now();
let resolved = false, roundsUsed = 0, lastMsg = null, adapterOk = false, lastVerdict = false;
for (let round = 1; round <= k; round++) {
  roundsUsed = round;
  const prompt = round === 1 ? basePrompt : [
    basePrompt, ``,
    `PREVIOUS ATTEMPT DID NOT RESOLVE THE ISSUE. The project's test suite still fails on your change. Re-examine your`,
    `edit, find what you missed, and fix it. Grader feedback from the last attempt:`, lastMsg || '(no detail)',
  ].join('\n');
  try { const r = invokeRuntimeAdapter(executor, { prompt, agentId: `naive-swe-${instanceId}-r${round}`, timeoutMs: 900000, cwd: repoDir }); adapterOk = r.ok !== false; } catch { adapterOk = false; }
  const g = grade();
  lastMsg = g.msg; lastVerdict = g.verdict;
  if (g.resolved) { resolved = true; break; }
}

let diffLines = 0;
try { diffLines = execFileSync('git', ['-C', repoDir, 'diff', '--numstat'], { encoding: 'utf8' }).split('\n').filter(Boolean).length; } catch {}

const rec = {
  instance_id: instanceId, dataset, executor, arm: 'naive-retry', k,
  adapter_ok: adapterOk,
  official_resolved: resolved ? true : (lastVerdict ? false : null),   // null = last grade was an infra error, not a real verdict
  grade_error: (!resolved && !lastVerdict) ? (lastMsg || '').slice(0, 300) : null,
  rounds_used: roundsUsed, diff_files: diffLines,
  wallclock_s: Math.round((Date.now() - t0) / 1000),
};
const outDir = /verified/i.test(dataset) ? join(EVAL, 'results', 'naive', 'verified') : join(EVAL, 'results', 'naive');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `naive-k${k}-${executor}-${instanceId}.json`), JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec));
rmSync(ws, { recursive: true, force: true });
