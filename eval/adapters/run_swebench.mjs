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

// executor default = codex-cli (its quota is separate from the interactive claude session, so bench runs are not
// starved by concurrent chat activity — the rate-limit contamination seen in stage-6h). Override via env.
const sweExecutor = process.env.TASKOPS_SWE_EXECUTOR || 'codex-cli';
// claude-code goes through the MCP-safe wrapper (nested-agent hang + 3s stdin wait); codex needs no wrapper.
if (sweExecutor === 'claude-code') {
  const wrapper = join('/home/jimmy/repos/personal-assets-vault/taskops-governance/experiments', 'claude-safe-wrapper.sh');
  chmodSync(wrapper, 0o755); process.env.TASKOPS_CLAUDE_BIN = wrapper;
}

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
    // oracle:true (P0-3): the official grader IS the external oracle — stratifies C-arm closes by oracle consumption.
    // dataset must ride the requiredCheck too — without it the verify grade falls back to Lite and a Verified
    // instance dies as an infra error before the agent's work is ever judged.
    requiredChecks: [{ command: `${VENV_PY} ${GRADE} ${instanceId} ${workspace} ${dataset}`, oracle: true }] },
});

const t0 = Date.now();
console.log(`[${instanceId}] running TaskOps (${process.env.TASKOPS_SWE_EXECUTOR || 'codex-cli'}, verify-checks, retries=${verifyRetries}) ...`);
// verifyChecks defaults on (verify-grounded, full TaskOps). argv[5]='noverify' runs the ABLATION arm: TaskOps graph
// + review but the runner does NOT execute the requiredCheck (trusts the agent's self-report) — for the clean
// same-tasks 3-arm (bare / no-verify / verify-grounded).
const noVerify = process.argv[5] === 'noverify';
// executor + delegation overridable via env (for OpenRouter open-model runs + delegation mode); defaults unchanged.
const sweResolver = process.env.TASKOPS_SWE_RESOLVER || null;   // set => --delegate + independent ai-resolver
// gpt-5.6 reasoning-tier escalation ladder (weak→strong): TASKOPS_SWE_ESCALATION="codex-cli:medium,codex-cli:high".
// On saturation the runner re-attempts on the next stronger tier of the same model (RUNG-1 capability-delegate).
const escalationResolvers = (process.env.TASKOPS_SWE_ESCALATION || '').split(',').map((s) => s.trim()).filter(Boolean);
const res = runTaskOps(w, { executor: sweExecutor, runId, maxSteps: verifyRetries + 2, verifyChecks: !noVerify, verifyRetries, continueOnFailure: true, timeout: 1500, ...(escalationResolvers.length ? { escalationResolvers, escalateOnSaturation: true } : {}), ...(sweResolver ? { delegate: true, aiResolver: sweResolver } : {}) });
const task = parseMarkdownFile(join(w, `${tv}/tasks/${taskId}.md`));
const rr = (task.runRefs || [])[0] || {};
const review = rr.runNodeId && existsSync(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`))
  ? parseMarkdownFile(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)).reviewReport : {};
// official verdict = re-grade the final workspace directly (independent of TaskOps' own gate)
let officialResolved = null, diffLines = null, gradeError = null;
try {
  // dataset MUST ride the final re-grade too. Without it swebench_grade.py falls back to its Lite default and any
  // Verified instance outside the Lite∩Verified intersection (93/500) dies as GRADE_INFRA_ERROR → official_resolved
  // =null → undetermined. The requiredCheck (line ~81) already passed dataset, so before this fix only the FINAL
  // verdict was broken — which is why 35/45 of the gpt-5.5 Verified results had to be rescued post-hoc by
  // eval/soak/regrade-from-preds.py. No regression on Lite: the argument equals the grader's own default there.
  const out = execFileSync(VENV_PY, [GRADE, instanceId, workspace, dataset], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  officialResolved = /"resolved":\s*true/.test(out);
  const m = out.match(/"diff_lines":\s*(\d+)/); diffLines = m ? Number(m[1]) : null;
} catch (e) {
  // A genuine UNRESOLVED verdict exits 1 but still prints the {"resolved":false} JSON on stdout; an INFRA error
  // (Docker/transient) prints no verdict. Never let the latter masquerade as unresolved — record null + grade_error.
  const out = `${(e.stdout || '').toString()}`;
  const m2 = out.match(/"resolved":\s*(true|false)/);
  if (m2) { officialResolved = m2[1] === 'true'; const dm = out.match(/"diff_lines":\s*(\d+)/); diffLines = dm ? Number(dm[1]) : null; }
  // 슬라이스 600자: swebench_grade.py의 `GRADE_INFRA_ERROR ...` 헤드라인 뒤에 오는 `--- harness stderr tail ---`
  // 첫 줄들(진짜 원인)까지 살아남게 한다. bare arm과 동일 규칙 — 두 arm의 진단 정보 보존이 비대칭이면 안 된다.
  else { officialResolved = null; gradeError = ((e.stderr || e.message || '').toString()).slice(0, 600); }
}

const verifiedDone = task.status === 'done' && review.decision === 'approved' && review.verified === true;
// MECHANISM INSTRUMENTATION: `verifyRetries` below is the CONFIGURED ceiling, not what actually fired — every one of
// the 45 gpt-5.5 Verified records carries verifyRetries=1 and therefore cannot answer "did the retry gate ever
// engage?". Without this counter a measured lift cannot be attributed to the gate at all. Event types are emitted by
// cli/lib-runner.js (verify_retry @3448, verify_pass_flaky @3405). Must run BEFORE the rmSync(root) below.
let verifyRetryCount = 0, verifyFlakyCount = 0;
try {
  for (const line of readFileSync(join(w, 'runs', runId, 'events.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const ev = JSON.parse(line);
    if (ev.type === 'verify_retry') verifyRetryCount++;
    else if (ev.type === 'verify_pass_flaky') verifyFlakyCount++;
  }
} catch {}
// namespace by retries/arm/dataset so a k>0, no-verify, or Verified run never clobbers the pristine Lite k=0 baseline.
// TASKOPS_SWE_RESULT_TAG additionally namespaces by MODEL (e.g. "gpt54"): the same instance graded under a different
// native model is a different measurement, and the Verified path is already occupied by the gpt-5.5 run (45 results).
// 태그 계산을 rec보다 먼저 한다 — rec에 태그·모델·executor를 함께 박아 결과 파일이 스스로 출처를 증언하게 만든다.
const verifiedSplit = /verified/i.test(dataset);
const resultTag = (process.env.TASKOPS_SWE_RESULT_TAG || '').trim().replace(/[^A-Za-z0-9._-]/g, '');
const tagDir = resultTag ? `-${resultTag}` : '';

const rec = {
  instance_id: instanceId, dataset, taskops_status: task.status, review_decision: review.decision || null,
  // 이 실험의 유일한 독립변수(모델)와 그 라벨링 근거를 산출물에 박는다. 디렉터리 태그는 config가 준 자유 문자열이라
  // 스스로 오라벨링을 검출하지 못하고, 이전에는 C arm rec에 executor조차 없어 "이 결과가 Haiku로 나왔다"를 결과
  // 파일만으로 증명할 수 없었다. report-stage.mjs가 스테이지 내 단일값 여부를 대조한다.
  executor: sweExecutor, claude_model: process.env.TASKOPS_CLAUDE_MODEL || null, result_tag: resultTag || null,
  verified_done: verifiedDone, official_resolved: officialResolved,
  false_completion: verifiedDone && officialResolved === false,   // the metric that must be 0
  missed_honest: !verifiedDone && officialResolved === true,       // solved but TaskOps didn't credit it
  agent_edited: diffLines != null && diffLines > 0,   // wiring check: did claude actually edit the seeded workspace?
  diff_lines: diffLines, verifyRetries, wallclock_s: Math.round((Date.now() - t0) / 1000),
  grade_error: gradeError,                                        // null = a real verdict was rendered
  verify_retry_count: verifyRetryCount,                           // times the verify gate actually re-dispatched
  verify_pass_flaky_count: verifyFlakyCount,                      // times a PASS was quarantined as flaky
};
if (noVerify) mkdirSync(join(EVAL, 'results', 'noverify'), { recursive: true });
if (verifiedSplit) mkdirSync(join(EVAL, 'results', `verified${tagDir}`), { recursive: true });
const outFile = join(EVAL, 'results',
  noVerify ? `noverify/swebench-noverify-${instanceId}.json`
  : verifiedSplit ? `verified${tagDir}/swebench-verified-${instanceId}.json`
  : verifyRetries > 0 ? `swebench-k${verifyRetries}${tagDir}-${instanceId}.json`
  : `swebench${tagDir}-${instanceId}.json`);
writeFileSync(outFile, JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec, null, 2));
if (process.env.KEEP_RUN !== '1') rmSync(root, { recursive: true, force: true });
else console.log('run kept at', w);
