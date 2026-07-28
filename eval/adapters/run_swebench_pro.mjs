#!/usr/bin/env node
// TaskOps × SWE-bench *Pro* adapter (one instance). Mirrors run_swebench.mjs (Arm C, verify-grounded): seed the
// TaskOps execution workspace with a repo checkout so the agent edits the repo in-place; the requiredCheck is the
// OFFICIAL Scale AI Pro Docker harness (out-of-workspace hidden judge) via swebench_pro_grade.py. Records
// verified_done vs the official verdict for the scorer — SAME record shape as the classic adapter.
//
// Why a Pro-specific adapter (not run_swebench.mjs with a different dataset): Pro's dataset schema is incompatible —
// lowercase ast-encoded fail_to_pass/pass_to_pass, multi-language repos, prebuilt jefzda/sweap-images per instance,
// and extra requirements/interface fields. So it needs dump_instance_pro.py (ast parse) + swebench_pro_grade.py
// (wraps swe_bench_pro_eval.py against the prebuilt image), NOT dump_instance.py + swebench_grade.py.
//   usage: node run_swebench_pro.mjs <instance_id> [dataset] [verifyRetries]
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, cpSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fmBlock, parseMarkdownFile } from '/home/jimmy/repos/taskops/cli/lib-taskops.js';
import { runTaskOps } from '/home/jimmy/repos/taskops/cli/lib-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const VENV_PY = join(EVAL, '.venv', 'bin', 'python');
const GRADE = join(here, 'swebench_pro_grade.py');
const instanceId = process.argv[2];
const dataset = process.argv[3] || 'ScaleAI/SWE-bench_Pro';
const verifyRetries = process.argv[4] != null ? Number(process.argv[4]) : 0;
if (!instanceId) { console.error('usage: run_swebench_pro.mjs <instance_id>'); process.exit(2); }

// executor default = codex-cli (its quota is separate from the interactive claude session, so bench runs are not
// starved by concurrent chat activity). Override via TASKOPS_SWE_EXECUTOR. Unchanged from the classic adapter.
const sweExecutor = process.env.TASKOPS_SWE_EXECUTOR || 'codex-cli';
// claude-code goes through the MCP-safe wrapper (nested-agent hang + 3s stdin wait); codex needs no wrapper.
if (sweExecutor === 'claude-code') {
  const wrapper = join('/home/jimmy/repos/personal-assets-vault/taskops-governance/experiments', 'claude-safe-wrapper.sh');
  chmodSync(wrapper, 0o755); process.env.TASKOPS_CLAUDE_BIN = wrapper;
}

const meta = JSON.parse(execFileSync(VENV_PY, [join(here, 'dump_instance_pro.py'), instanceId, dataset], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
// Pro repos are the public GPL/copyleft set (NodeBB, ansible, ...). Same clone+checkout pattern as run_swebench.mjs;
// the agent edits SOURCE here and the sealed image re-runs the canonical tests, so the checkout need not run tests.
const CO = `/tmp/swebench-pro-co/${instanceId}`;
if (!existsSync(join(CO, '.git'))) {
  mkdirSync(dirname(CO), { recursive: true });
  execFileSync('git', ['clone', '-q', `https://github.com/${meta.repo}`, CO], { stdio: 'inherit' });
}
execFileSync('git', ['-C', CO, 'checkout', '-q', '-f', meta.base_commit]);
execFileSync('git', ['-C', CO, 'clean', '-qxfd']);
execFileSync('git', ['-C', CO, 'config', 'user.email', 't@t']);
execFileSync('git', ['-C', CO, 'config', 'user.name', 't']);

const now = '2026-07-05T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), `taskops-swepro-${instanceId}-`));
const w = join(root, 'work');
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
const taskId = 'solve';
const runId = 'r1';
for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'swe', title: 'SWE', objective: 'swebench-pro', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });

// pre-create a VALID run scaffold (parseProject validates runs/<id> before the runner fills it) + seed the
// execution workspace with the checkout (deterministic runNodeId = run-node-<taskId>)
const runDir = join(w, 'runs', runId);
for (const d of ['nodes', 'edges']) mkdirSync(join(runDir, d), { recursive: true });
writeFileSync(join(runDir, 'index.md'), `${fmBlock({ taskOpsVersion: 'v1', entityType: 'run', id: runId, workId: 'swe', createdAt: now, status: 'active' })}# Run ${runId}\n`, 'utf8');
writeFileSync(join(runDir, 'run-log.md'), '# Run log\n', 'utf8');
writeFileSync(join(runDir, 'events.jsonl'), '', 'utf8');
const workspace = join(runDir, 'artifacts', `run-node-${taskId}`, 'workspace');
mkdirSync(dirname(workspace), { recursive: true });
cpSync(CO, workspace, { recursive: true });

// Pro objective carries problem_statement + requirements + interface: Pro issues are deliberately underspecified,
// and the requirements/interface are the contract the hidden tests grade against. (fmScalar flattens the block to a
// single frontmatter line, exactly as the classic adapter does with problem_statement.)
const objective = [
  `You are resolving a real GitHub issue in the ${meta.repo} repository (language: ${meta.repo_language}). The repo`,
  `is checked out at your current working directory. Edit the SOURCE to resolve the issue so the project's test suite`,
  `passes. Do NOT edit anything under tests/ or test files — the grader re-applies the project's canonical tests`,
  `itself inside a sealed image, so any test edits you make are discarded.`,
  ``, `ISSUE:`, meta.problem_statement,
  ``, `REQUIREMENTS (the behaviour the hidden tests check):`, meta.requirements,
  ``, `INTERFACE (signatures/paths you must implement or preserve):`, meta.interface,
].join('\n');
md(`${tv}/tasks/${taskId}.md`, {
  taskOpsVersion: 'v1', entityType: 'task', id: taskId, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: instanceId, objective, responsibility: 'Resolve the issue.', completionCriteria: 'The official Pro test suite passes.',
  order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known',
  acceptance: { mode: 'guarded', expectedOutcome: 'official SWE-bench Pro tests pass',
    // oracle:true (P0-3): the official Pro grader IS the external oracle — stratifies C-arm closes by oracle
    // consumption. Pass the dataset so the grader loads the right split even though DS defaults to Pro.
    requiredChecks: [{ command: `${VENV_PY} ${GRADE} ${instanceId} ${workspace} ${dataset}`, oracle: true }] },
});

const t0 = Date.now();
console.log(`[${instanceId}] running TaskOps Pro (${sweExecutor}, verify-checks, retries=${verifyRetries}) ...`);
// verifyChecks defaults on (verify-grounded, full TaskOps). argv[5]='noverify' runs the ABLATION arm: TaskOps graph
// + review but the runner does NOT execute the requiredCheck (trusts the agent's self-report).
const noVerify = process.argv[5] === 'noverify';
const sweResolver = process.env.TASKOPS_SWE_RESOLVER || null;   // set => --delegate + independent ai-resolver
const escalationResolvers = (process.env.TASKOPS_SWE_ESCALATION || '').split(',').map((s) => s.trim()).filter(Boolean);
const res = runTaskOps(w, { executor: sweExecutor, runId, maxSteps: verifyRetries + 2, verifyChecks: !noVerify, verifyRetries, continueOnFailure: true, timeout: 1500, ...(escalationResolvers.length ? { escalationResolvers, escalateOnSaturation: true } : {}), ...(sweResolver ? { delegate: true, aiResolver: sweResolver } : {}) });
const task = parseMarkdownFile(join(w, `${tv}/tasks/${taskId}.md`));
const rr = (task.runRefs || [])[0] || {};
const review = rr.runNodeId && existsSync(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`))
  ? parseMarkdownFile(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)).reviewReport : {};
// official verdict = re-grade the final workspace directly (independent of TaskOps' own gate)
let officialResolved = null, diffLines = null, gradeError = null;
try {
  const out = execFileSync(VENV_PY, [GRADE, instanceId, workspace, dataset], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  officialResolved = /"resolved":\s*true/.test(out);
  const m = out.match(/"diff_lines":\s*(\d+)/); diffLines = m ? Number(m[1]) : null;
} catch (e) {
  // A genuine UNRESOLVED verdict exits 1 but still prints {"resolved":false} on stdout; an INFRA error (Docker /
  // image pull / entryscript) prints NO verdict and exits 2. Never let the latter masquerade as unresolved — record
  // null + grade_error instead. (Same infra-vs-verdict split as run_swebench.mjs.)
  const out = `${(e.stdout || '').toString()}`;
  const m2 = out.match(/"resolved":\s*(true|false)/);
  if (m2) { officialResolved = m2[1] === 'true'; const dm = out.match(/"diff_lines":\s*(\d+)/); diffLines = dm ? Number(dm[1]) : null; }
  else { officialResolved = null; gradeError = ((e.stderr || e.message || '').toString()).slice(0, 300); }
}

const verifiedDone = task.status === 'done' && review.decision === 'approved' && review.verified === true;
// 결과 격리 태그(A arm과 동일 규약): 같은 인스턴스를 다른 모델로 채점한 결과는 다른 측정이므로 경로를 나눈다.
// claude_model을 함께 박아 결과 파일이 스스로 출처를 증언하게 한다 — 모델 주입 누락을 파일만으로 검출하기 위함.
const resultTag = (process.env.TASKOPS_SWE_RESULT_TAG || '').trim().replace(/[^A-Za-z0-9._-]/g, '');
const tagDir = resultTag ? `-${resultTag}` : '';
const rec = {
  instance_id: instanceId, dataset, executor: sweExecutor,
  claude_model: process.env.TASKOPS_CLAUDE_MODEL || null, result_tag: resultTag || null,
  taskops_status: task.status, review_decision: review.decision || null,
  verified_done: verifiedDone, official_resolved: officialResolved, grade_error: gradeError,
  false_completion: verifiedDone && officialResolved === false,   // the metric that must be 0
  missed_honest: !verifiedDone && officialResolved === true,       // solved but TaskOps didn't credit it
  agent_edited: diffLines != null && diffLines > 0,   // wiring check: did the agent actually edit the seeded workspace?
  diff_lines: diffLines, verifyRetries, wallclock_s: Math.round((Date.now() - t0) / 1000),
};
// namespace under results/pro so Pro runs never collide with the classic Lite/Verified baselines; the model tag
// further splits per-model runs so the existing codex-cli Pro results (6건) are never clobbered.
const proDir = noVerify ? join(EVAL, 'results', `pro${tagDir}`, 'noverify') : join(EVAL, 'results', `pro${tagDir}`);
mkdirSync(proDir, { recursive: true });
const outFile = join(proDir,
  noVerify ? `swebench-pro-noverify-${instanceId}.json`
  : verifyRetries > 0 ? `swebench-pro-k${verifyRetries}-${instanceId}.json`
  : `swebench-pro-${instanceId}.json`);
writeFileSync(outFile, JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec, null, 2));
if (process.env.KEEP_RUN !== '1') rmSync(root, { recursive: true, force: true });
else console.log('run kept at', w);
