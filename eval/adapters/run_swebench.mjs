#!/usr/bin/env node
// TaskOps × SWE-bench adapter (one instance). Seeds the TaskOps execution workspace with a repo checkout so the
// agent edits the repo in-place; the requiredCheck is the OFFICIAL Docker harness (out-of-workspace hidden judge)
// via swebench_grade.py. Records verified_done vs the official verdict for the scorer.
//   usage: node run_swebench.mjs <instance_id> [dataset] [verifyRetries]
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, cpSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fmBlock, parseMarkdownFile } from '/home/jimmy/repos/taskops/cli/lib-taskops.js';
import { runTaskOps } from '/home/jimmy/repos/taskops/cli/lib-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const VENV_PY = join(EVAL, '.venv', 'bin', 'python');
const GRADE = join(here, 'swebench_grade.py');
const instanceId = process.argv[2];
const dataset = process.argv[3] || 'princeton-nlp/SWE-bench_Lite';
const verifyRetries = process.argv[4] != null ? Number(process.argv[4]) : 0;
if (!instanceId) { console.error('usage: run_swebench.mjs <instance_id>'); process.exit(2); }

// real claude via the MCP-safe wrapper used in the experiments
const wrapper = join('/home/jimmy/repos/personal-assets-vault/taskops-governance/experiments', 'claude-safe-wrapper.sh');
chmodSync(wrapper, 0o755); process.env.TASKOPS_CLAUDE_BIN = wrapper;

const meta = JSON.parse(execFileSync(VENV_PY, [join(here, 'dump_instance.py'), instanceId, dataset], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const CO = `/tmp/swebench-co/${instanceId}`;
if (!existsSync(join(CO, '.git'))) {
  mkdirSync(dirname(CO), { recursive: true });
  execFileSync('git', ['clone', '-q', `https://github.com/${meta.repo}`, CO], { stdio: 'inherit' });
}
execFileSync('git', ['-C', CO, 'checkout', '-q', '-f', meta.base_commit]);
execFileSync('git', ['-C', CO, 'clean', '-qxfd']);
execFileSync('git', ['-C', CO, 'config', 'user.email', 't@t']);
execFileSync('git', ['-C', CO, 'config', 'user.name', 't']);

const now = '2026-07-05T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), `taskops-swe-${instanceId}-`));
const w = join(root, 'work');
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
const taskId = 'solve';
const runId = 'r1';
for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'swe', title: 'SWE', objective: 'swebench', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
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

const objective = [
  `You are resolving a real GitHub issue in the ${meta.repo} repository. The repo is checked out at your current`,
  `working directory. Edit the SOURCE to resolve the issue so the project's test suite passes. Do NOT edit anything`,
  `under tests/ or test files — the grader applies the project's canonical tests itself.`,
  ``, `ISSUE:`, meta.problem_statement,
].join('\n');
md(`${tv}/tasks/${taskId}.md`, {
  taskOpsVersion: 'v1', entityType: 'task', id: taskId, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: instanceId, objective, responsibility: 'Resolve the issue.', completionCriteria: 'The official test suite passes.',
  order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known',
  acceptance: { mode: 'guarded', expectedOutcome: 'official SWE-bench tests pass',
    requiredChecks: [{ command: `${VENV_PY} ${GRADE} ${instanceId} ${workspace}` }] },
});

const t0 = Date.now();
console.log(`[${instanceId}] running TaskOps (claude-code, verify-checks, retries=${verifyRetries}) ...`);
// verifyChecks defaults on (verify-grounded, full TaskOps). argv[5]='noverify' runs the ABLATION arm: TaskOps graph
// + review but the runner does NOT execute the requiredCheck (trusts the agent's self-report) — for the clean
// same-tasks 3-arm (bare / no-verify / verify-grounded).
const noVerify = process.argv[5] === 'noverify';
// executor + delegation overridable via env (for OpenRouter open-model runs + delegation mode); defaults unchanged.
const sweExecutor = process.env.TASKOPS_SWE_EXECUTOR || 'claude-code';
const sweResolver = process.env.TASKOPS_SWE_RESOLVER || null;   // set => --delegate + independent ai-resolver
const res = runTaskOps(w, { executor: sweExecutor, runId, maxSteps: verifyRetries + 2, verifyChecks: !noVerify, verifyRetries, continueOnFailure: true, timeout: 1500, ...(sweResolver ? { delegate: true, aiResolver: sweResolver } : {}) });
const task = parseMarkdownFile(join(w, `${tv}/tasks/${taskId}.md`));
const rr = (task.runRefs || [])[0] || {};
const review = rr.runNodeId && existsSync(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`))
  ? parseMarkdownFile(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)).reviewReport : {};
// official verdict = re-grade the final workspace directly (independent of TaskOps' own gate)
let officialResolved = null, diffLines = null, gradeError = null;
try {
  const out = execFileSync(VENV_PY, [GRADE, instanceId, workspace], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  officialResolved = /"resolved":\s*true/.test(out);
  const m = out.match(/"diff_lines":\s*(\d+)/); diffLines = m ? Number(m[1]) : null;
} catch (e) {
  // A genuine UNRESOLVED verdict exits 1 but still prints the {"resolved":false} JSON on stdout; an INFRA error
  // (Docker/transient) prints no verdict. Never let the latter masquerade as unresolved — record null + grade_error.
  const out = `${(e.stdout || '').toString()}`;
  const m2 = out.match(/"resolved":\s*(true|false)/);
  if (m2) { officialResolved = m2[1] === 'true'; const dm = out.match(/"diff_lines":\s*(\d+)/); diffLines = dm ? Number(dm[1]) : null; }
  else { officialResolved = null; gradeError = ((e.stderr || e.message || '').toString()).slice(0, 300); }
}

const verifiedDone = task.status === 'done' && review.decision === 'approved' && review.verified === true;
const rec = {
  instance_id: instanceId, dataset, taskops_status: task.status, review_decision: review.decision || null,
  verified_done: verifiedDone, official_resolved: officialResolved,
  false_completion: verifiedDone && officialResolved === false,   // the metric that must be 0
  missed_honest: !verifiedDone && officialResolved === true,       // solved but TaskOps didn't credit it
  agent_edited: diffLines != null && diffLines > 0,   // wiring check: did claude actually edit the seeded workspace?
  diff_lines: diffLines, verifyRetries, wallclock_s: Math.round((Date.now() - t0) / 1000),
};
// namespace by retries/arm/dataset so a k>0, no-verify, or Verified run never clobbers the pristine Lite k=0 baseline
const verifiedSplit = /verified/i.test(dataset);
if (noVerify) mkdirSync(join(EVAL, 'results', 'noverify'), { recursive: true });
if (verifiedSplit) mkdirSync(join(EVAL, 'results', 'verified'), { recursive: true });
const outFile = join(EVAL, 'results',
  noVerify ? `noverify/swebench-noverify-${instanceId}.json`
  : verifiedSplit ? `verified/swebench-verified-${instanceId}.json`
  : verifyRetries > 0 ? `swebench-k${verifyRetries}-${instanceId}.json`
  : `swebench-${instanceId}.json`);
writeFileSync(outFile, JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec, null, 2));
if (process.env.KEEP_RUN !== '1') rmSync(root, { recursive: true, force: true });
else console.log('run kept at', w);
