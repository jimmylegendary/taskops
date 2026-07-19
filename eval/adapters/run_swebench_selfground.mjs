#!/usr/bin/env node
// ARM D — TaskOps SELF-GROUNDED, NO external verifier. Unlike Arm C (requiredCheck = the official hidden judge),
// Arm D gives TaskOps NO answer key. It must certify "done" using ONLY its own machinery:
//   (1) a requiredCheck the AGENT authors from the ISSUE text — `taskops_verify.sh` (a repro/behaviour test it
//       derives itself, NOT the project's hidden FAIL_TO_PASS), executed by the runner; and
//   (2) the independent comprehension quiz (a fresh reviewer agent writes differential probes the runner executes).
// The official grader is run ONCE, POST-HOC, for SCORING ONLY — never as a stop signal. This is the honest
// real-world question: can TaskOps reach a genuinely-resolved state when it cannot see the test it's graded on?
//   self_ground_gap = self-certified done but the (unseen) official judge says UNRESOLVED  ← the failure mode.
//   usage: node run_swebench_selfground.mjs <instance_id> [dataset] [k]
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
const GRADE = join(here, 'swebench_grade.py');
const instanceId = process.argv[2];
const dataset = process.argv[3] || 'princeton-nlp/SWE-bench_Lite';
const verifyRetries = process.argv[4] != null ? Number(process.argv[4]) : 4;
if (!instanceId) { console.error('usage: run_swebench_selfground.mjs <instance_id> [dataset] [k]'); process.exit(2); }

const sgExecutor = process.env.TASKOPS_SWE_EXECUTOR || 'codex-cli';   // default codex: quota separate from the chat session
if (sgExecutor === 'claude-code') {
  const wrapper = join('/home/jimmy/repos/personal-assets-vault/taskops-governance/experiments', 'claude-safe-wrapper.sh');
  chmodSync(wrapper, 0o755); process.env.TASKOPS_CLAUDE_BIN = wrapper;
}

const meta = JSON.parse(execFileSync(VENV_PY, [join(here, 'dump_instance.py'), instanceId, dataset], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const CO = `/tmp/swebench-co-selfground/${instanceId}`;
if (!existsSync(join(CO, '.git'))) { mkdirSync(dirname(CO), { recursive: true }); execFileSync('git', ['clone', '-q', `https://github.com/${meta.repo}`, CO], { stdio: 'inherit' }); }
execFileSync('git', ['-C', CO, 'checkout', '-q', '-f', meta.base_commit]);
execFileSync('git', ['-C', CO, 'clean', '-qxfd']);
execFileSync('git', ['-C', CO, 'config', 'user.email', 't@t']);
execFileSync('git', ['-C', CO, 'config', 'user.name', 't']);

const now = '2026-07-05T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), `taskops-sg-${instanceId}-`));
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
  `working directory. Edit the SOURCE to resolve the issue. Do NOT edit anything under tests/ or existing test files.`,
  ``,
  `You are NOT given the project's hidden acceptance test. To let this be verified, you MUST also AUTHOR your own`,
  `verification, derived ONLY from the issue's described behaviour:`,
  `  - Create an executable script ./taskops_verify.sh at the repo root (do NOT 'git add' it — leave it untracked).`,
  `  - It must reproduce the issue's WRONG behaviour as a concrete, runnable check and assert the CORRECT behaviour`,
  `    the issue asks for, using the project's own tooling (e.g. python -c / pytest on a test file YOU write outside`,
  `    the repo's tests/ dir, e.g. /tmp). It must 'exit 0' ONLY when the fix is actually correct, non-zero otherwise.`,
  `  - It must be DISCRIMINATING: it should FAIL on the un-fixed code and PASS on your fix. A trivial always-pass`,
  `    script (exit 0 / true / echo) is worthless and will be rejected.`,
  `  - Also make sure existing, related tests still pass (no regression).`,
  ``, `ISSUE:`, meta.problem_statement,
].join('\n');
md(`${tv}/tasks/${taskId}.md`, {
  taskOpsVersion: 'v1', entityType: 'task', id: taskId, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: instanceId, objective, responsibility: 'Resolve the issue and author your own discriminating verification.',
  completionCriteria: 'Your self-authored taskops_verify.sh passes and demonstrates the fix.',
  order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known',
  acceptance: { mode: 'guarded', expectedOutcome: 'self-authored verification demonstrates the fix', comprehensionQuiz: true,
    selfAuthoredCheck: true,   // P1: the check is authored by the executor → close earns only the self_verified tier
    requiredChecks: [{ command: `cd ${workspace} && test -f taskops_verify.sh && bash taskops_verify.sh` }] },
});

const t0 = Date.now();
console.log(`[${instanceId}] ARM D — TaskOps self-grounded (NO oracle in the loop), retries=${verifyRetries} ...`);
const res = runTaskOps(w, { executor: sgExecutor, runId, maxSteps: verifyRetries + 2, verifyChecks: true, verifyRetries, continueOnFailure: true, timeout: 1500 });
const task = parseMarkdownFile(join(w, `${tv}/tasks/${taskId}.md`));
const rr = (task.runRefs || [])[0] || {};
const review = rr.runNodeId && existsSync(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`))
  ? parseMarkdownFile(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)).reviewReport : {};
const verifiedDone = task.status === 'done' && review.decision === 'approved' && review.verified === true;
const selfCertified = task.status === 'done' && review.decision === 'approved';   // closed (at whatever assurance tier)
const assuranceTier = review.assuranceTier || null;                                // 'self_verified' expected (P1)
const externallyVerified = review.externallyVerified === true;                     // false expected (no oracle)

// POST-HOC oracle scoring ONLY: strip the self-authored verifier + any quiz file + unstage them so the official
// grader (git diff HEAD) sees ONLY the source edits, never the agent's own scaffolding.
for (const f of ['taskops_verify.sh', 'comprehension-quiz.json']) {
  try { execFileSync('git', ['-C', workspace, 'rm', '--cached', '-f', f], { stdio: 'ignore' }); } catch {}
  try { rmSync(join(workspace, f), { force: true }); } catch {}
}
let officialResolved = null, diffLines = null, gradeError = null;
try {
  const out = execFileSync(VENV_PY, [GRADE, instanceId, workspace], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  officialResolved = /"resolved":\s*true/.test(out);
  const m = out.match(/"diff_lines":\s*(\d+)/); diffLines = m ? Number(m[1]) : null;
} catch (e) {
  // A genuine UNRESOLVED verdict exits 1 but still prints {"resolved":false} on stdout; an INFRA error prints no
  // verdict. Never let a transient Docker error masquerade as unresolved (it manufactures a fake self_ground_gap).
  const out = `${(e.stdout || '').toString()}`;
  const m2 = out.match(/"resolved":\s*(true|false)/);
  if (m2) { officialResolved = m2[1] === 'true'; const dm = out.match(/"diff_lines":\s*(\d+)/); diffLines = dm ? Number(dm[1]) : null; }
  else { officialResolved = null; gradeError = ((e.stderr || e.message || '').toString()).slice(0, 300); }
}

// quiz introspection for meta-analysis: how many probes, how many discriminating (differential), what the review said
const quiz = (review.observed && review.observed.quizResults) || review.quizResults || [];
const quizSummary = {
  probes: quiz.length,
  differential_true: quiz.filter((q) => q && q.differential === true).length,
  differential_false: quiz.filter((q) => q && q.differential === false).length,
  differential_null: quiz.filter((q) => q && (q.differential === null || q.differential === undefined)).length,
};

const rec = {
  instance_id: instanceId, dataset, arm: 'selfground', taskops_status: task.status, review_decision: review.decision || null,
  assurance_tier: assuranceTier, externally_verified: externallyVerified,   // P1: expect 'self_verified' / false (no oracle)
  self_certified: selfCertified,         // taskops closed it (approved) on its OWN check+quiz (no oracle in the loop)
  verified_done: verifiedDone,           // legacy field (= runner-verify mode was on)
  official_resolved: officialResolved,   // the unseen judge, post-hoc scoring only
  self_ground_gap: selfCertified && officialResolved === false,  // self-certified but actually unresolved (P2/P3 must shrink this)
  honest_block: !selfCertified && officialResolved === false,    // did NOT certify AND unresolved (safe — quiz/gate caught the under-scope)
  missed_solve: !selfCertified && officialResolved === true,     // actually fixed it but wouldn't self-certify
  agent_edited: diffLines != null && diffLines > 0, diff_lines: diffLines, grade_error: gradeError,
  quiz: quizSummary,
  review_missingExpected: review.missingExpected || null, review_failedChecks: review.failedChecks || null,
  review_followUpNeeded: review.followUpNeeded || null,
  verifyRetries, wallclock_s: Math.round((Date.now() - t0) / 1000),
};
mkdirSync(join(EVAL, 'results', 'selfground'), { recursive: true });
writeFileSync(join(EVAL, 'results', 'selfground', `selfground-k${verifyRetries}-${instanceId}.json`), JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec, null, 2));
if (process.env.KEEP_RUN !== '1') rmSync(root, { recursive: true, force: true });
else console.log('run kept at', w);
