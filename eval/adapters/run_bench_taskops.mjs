#!/usr/bin/env node
// Run ONE bench task THROUGH TaskOps: a real TaskOps work whose acceptance.requiredChecks = that bench's own
// out-of-workspace verifier. TaskOps' verify-resolver EXECUTES the checker and emits verified_done iff it passes =
// verify-grounding on the real external oracle (not a hand-rolled gate). The executor step invokes the bench harness
// (agent or oracle) to produce the artifact the verifier grades.
//   usage: node run_bench_taskops.mjs <deepswe|ale|edgebench> <task> [agentOrModel]
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmBlock, parseMarkdownFile } from '/home/jimmy/repos/taskops/cli/lib-taskops.js';
import { runTaskOps } from '/home/jimmy/repos/taskops/cli/lib-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const bench = process.argv[2];
const task = process.argv[3];
const agentArg = process.argv[4] || '';
if (!bench || !task) { console.error('usage: run_bench_taskops.mjs <deepswe|ale|edgebench> <task> [agentOrModel]'); process.exit(2); }

const HOME = '/home/jimmy';
const CHECK_DIR = join(EVAL, 'results', 'bench-taskops', `${bench}-${task}`.replace(/[^A-Za-z0-9_-]/g, '_'));
mkdirSync(CHECK_DIR, { recursive: true });

// Per-bench verifier wrapper: runs the bench harness (agent/oracle) + reads its real verdict; exit 0 iff pass.
// Written as a script so the TaskOps requiredCheck is a single out-of-workspace command.
function writeChecker() {
  const p = join(CHECK_DIR, 'check.sh');
  let body;
  if (bench === 'deepswe') {
    const agent = agentArg || 'oracle';  // 'oracle' (free gold patch) or 'mini-swe-agent'
    const modelFlags = agent === 'oracle' ? '' : `--model ${agentArg} --ae OPENROUTER_API_KEY=$OPENROUTER_API_KEY`;
    const realAgent = agent === 'oracle' ? 'oracle' : 'mini-swe-agent';
    body = `#!/bin/bash
set -a; . ~/API_KEYS; set +a
JOB="tk-${task}-$$"
${HOME}/.local/bin/pier run --path ${HOME}/.claude/workspace/deepswe/tasks -i ${task} \\
  --env docker --agent ${realAgent} ${modelFlags} \\
  --jobs-dir ${HOME}/.claude/workspace/deepswe-jobs --job-name "$JOB" -n 1 -k 1 -q >/dev/null 2>&1
R=$(find ${HOME}/.claude/workspace/deepswe-jobs/$JOB -name 'reward.txt' -o -name 'reward.json' 2>/dev/null | head -1)
[ -z "$R" ] && { echo '{"resolved":false,"reason":"no reward file"}'; exit 1; }
python3 -c "
import sys,json
r='$R'
v=float(open(r).read().strip()) if r.endswith('.txt') else float(json.load(open(r)).get('reward',0))
print(json.dumps({'bench':'deepswe','task':'${task}','reward':v,'resolved':v>=1.0}))
sys.exit(0 if v>=1.0 else 1)
"`;
  } else if (bench === 'ale') {
    const exp = agentArg || 'smoke_readfile.yaml';
    body = `#!/bin/bash
cd ${HOME}/repos/agents-last-exam
grep '^OPENROUTER_API_KEY=' ~/API_KEYS > secret/.env 2>/dev/null
./taskops_verify.sh ${exp} ${task} 1.0`;
  } else if (bench === 'edgebench') {
    const model = agentArg || 'deepseek/deepseek-v4-flash';
    body = `#!/bin/bash
set -a; . ~/API_KEYS; set +a
cd ${HOME}/repos/EdgeBench
pgrep -f 'sforge serve' >/dev/null || { sforge serve >/tmp/sforge-serve-tk.log 2>&1 & sleep 12; }
RID="tk-${task}-$$"
SFORGE_AGENT_API_KEY="$OPENROUTER_API_KEY" SFORGE_AGENT_API_BASE_URL="https://openrouter.ai/api/v1" \\
  timeout 1000 sforge run --task ${task} --agent codex --model "${model}" \\
  --backend docker --judge-url http://host.docker.internal:8080 \\
  --enable-internet --timeout 600 --max-submissions 2 --run-id "$RID" >/dev/null 2>&1
F=${HOME}/repos/EdgeBench/logs/runs/$RID/${task}/final_result.json
[ ! -f "$F" ] && { echo '{"resolved":false,"reason":"no final_result"}'; exit 1; }
python3 -c "
import json,sys
d=json.load(open('$F')); pr=d.get('best_pass_rate',0)
print(json.dumps({'bench':'edgebench','task':'${task}','pass_rate':pr,'resolved':pr is not None and float(pr)>=1.0}))
sys.exit(0 if pr is not None and float(pr)>=1.0 else 1)
"`;
  } else { console.error('unknown bench', bench); process.exit(2); }
  writeFileSync(p, body, 'utf8'); chmodSync(p, 0o755);
  return p;
}
const checker = writeChecker();

// minimal TaskOps work; the check IS the real out-of-workspace bench verifier
const now = '2026-07-09T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), `taskops-bench-${bench}-`));
const w = join(root, 'work');
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
const taskId = 'solve', runId = 'r1';
for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm) => writeFileSync(join(w, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'bench', title: bench, objective: `${bench}:${task}`, activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
const runDir = join(w, 'runs', runId);
for (const d of ['nodes', 'edges']) mkdirSync(join(runDir, d), { recursive: true });
writeFileSync(join(runDir, 'index.md'), `${fmBlock({ taskOpsVersion: 'v1', entityType: 'run', id: runId, workId: 'bench', createdAt: now, status: 'active' })}# Run ${runId}\n`, 'utf8');
writeFileSync(join(runDir, 'run-log.md'), '# Run log\n', 'utf8');
writeFileSync(join(runDir, 'events.jsonl'), '', 'utf8');
mkdirSync(join(runDir, 'artifacts', `run-node-${taskId}`, 'workspace'), { recursive: true });
md(`${tv}/tasks/${taskId}.md`, {
  taskOpsVersion: 'v1', entityType: 'task', id: taskId, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: `${bench}:${task}`, objective: `Solve the ${bench} task ${task}; the harness (${agentArg || 'oracle/default'}) produces the artifact and the bench's own out-of-workspace verifier grades it.`,
  responsibility: 'Complete the bench task.', completionCriteria: 'The bench verifier passes.',
  order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known',
  acceptance: { mode: 'guarded', expectedOutcome: `${bench} verifier passes`, requiredChecks: [{ command: `bash ${checker}` }] },
});

const t0 = Date.now();
console.log(`[bench-taskops] ${bench}:${task} agent=${agentArg || 'oracle/default'} — TaskOps verify-grounds the real bench verifier ...`);
runTaskOps(w, { executor: 'dry-run', runId, verifyChecks: true, continueOnFailure: true, maxSteps: 3, timeout: 1800 });
const t = parseMarkdownFile(join(w, `${tv}/tasks/${taskId}.md`));
const rr = (t.runRefs || []).find((r) => /execution/.test(String(r.role || ''))) || (t.runRefs || [])[0] || {};
const review = rr.runNodeId && existsSync(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`))
  ? parseMarkdownFile(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)).reviewReport : {};
const rec = {
  bench, task, agent: agentArg || 'oracle/default',
  taskops_status: t.status, review_decision: review.decision || null,
  verified_done: t.status === 'done' && review.decision === 'approved' && review.verified === true,
  wallclock_s: Math.round((Date.now() - t0) / 1000),
};
writeFileSync(join(CHECK_DIR, 'result.json'), JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec));
rmSync(root, { recursive: true, force: true });
