#!/usr/bin/env node
// Track A / L3 (light long-horizon): a DECOMPOSED depth-2 graph — a parent task group whose child task group holds
// several verifiable sub-tasks — run to completion via TaskOps + claude, checking honest-monotone across the whole
// trajectory: every leaf closure is runner-verified, the parent closes only by real child roll-up (no false
// roll-up), and the run ends all_closed OR with honest stalls. Records depth, steps, per-leaf verify + monotone.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmBlock, parseMarkdownFile, parseProject } from '/home/jimmy/repos/taskops/cli/lib-taskops.js';
import { runTaskOps } from '/home/jimmy/repos/taskops/cli/lib-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const wrapper = join('/home/jimmy/repos/personal-assets-vault/taskops-governance/experiments', 'claude-safe-wrapper.sh');
chmodSync(wrapper, 0o755); process.env.TASKOPS_CLAUDE_BIN = wrapper;
const now = '2026-07-06T00:00:00.000Z';

// three verifiable leaves under one child task group (a small "stringutils" module built across steps)
const LEAVES = [
  { id: 'slugify', file: 'slugify.js', fn: 'slugify', obj: 'slugify(s): lowercase, spaces/underscores -> single hyphen, drop non [a-z0-9-], trim leading/trailing hyphens.',
    check: `node -e "const {slugify}=require('./slugify.js');const T=[['Hello World','hello-world'],['a__b  c','a-b-c'],['  Trim! ','trim']];for(const[i,o]of T)if(slugify(i)!==o)process.exit(1)"` },
  { id: 'titlecase', file: 'titlecase.js', fn: 'titleCase', obj: 'titleCase(s): capitalize the first letter of each space-separated word, lowercase the rest.',
    check: `node -e "const {titleCase}=require('./titlecase.js');const T=[['hello world','Hello World'],['ABC def','Abc Def']];for(const[i,o]of T)if(titleCase(i)!==o)process.exit(1)"` },
  { id: 'truncate', file: 'truncate.js', fn: 'truncate', obj: "truncate(s, n): if s.length<=n return s; else return the first n characters with a trailing '…' (so total length n+1).",
    check: `node -e "const {truncate}=require('./truncate.js');const T=[['hello',10,'hello'],['hello world',5,'hello…']];for(const[s,n,o]of T)if(truncate(s,n)!==o)process.exit(1)"` },
];

const root = mkdtempSync(join(tmpdir(), 'taskops-l3-'));
const w = join(root, 'work');
const parentTv = 'task-groups/tg-root/versions/tgv-root-v1';
const childTg = 'tg-stringutils';
const childTv = `task-groups/${childTg}/versions/tgv-${childTg}-v1`;
const runId = 'r1';
for (const d of [`${parentTv}/tasks`, `${childTv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm, b) => writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8');
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'l3', title: 'L3', objective: 'build stringutils', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${parentTv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
// parent task decomposed into the child task group (depth-2)
md(`${parentTv}/tasks/build.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'build', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'Build stringutils', objective: 'Build the stringutils module (its sub-functions are decomposed into a child task group).', responsibility: 'own', completionCriteria: 'all sub-functions pass', order: 1, createdAt: now, status: 'pending', runReadiness: 'needs_decomposition', understandingLevel: 'known', childTaskGroupId: childTg });
md(`task-groups/${childTg}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroup', id: childTg, objective: 'stringutils fns', parentTaskId: 'build', activeVersionId: `tgv-${childTg}-v1`, createdAt: now, status: 'active' });
md(`${childTv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: `tgv-${childTg}-v1`, taskGroupId: childTg, version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }, { taskGroupId: childTg, versionId: `tgv-${childTg}-v1` }] });

// run scaffold + a shared workspace per leaf (each leaf writes its own file)
const runDir = join(w, 'runs', runId);
for (const d of ['nodes', 'edges']) mkdirSync(join(runDir, d), { recursive: true });
writeFileSync(join(runDir, 'index.md'), `${fmBlock({ taskOpsVersion: 'v1', entityType: 'run', id: runId, workId: 'l3', createdAt: now, status: 'active' })}# Run ${runId}\n`, 'utf8');
writeFileSync(join(runDir, 'run-log.md'), '# Run log\n', 'utf8');
writeFileSync(join(runDir, 'events.jsonl'), '', 'utf8');
LEAVES.forEach((leaf, i) => {
  const ws = join(runDir, 'artifacts', `run-node-${leaf.id}`, 'workspace');
  mkdirSync(ws, { recursive: true });
  md(`${childTv}/tasks/${leaf.id}.md`, {
    taskOpsVersion: 'v1', entityType: 'task', id: leaf.id, taskGroupId: childTg, taskGroupVersionId: `tgv-${childTg}-v1`,
    title: leaf.id, objective: `Create ${leaf.file} in your working directory doing module.exports = { ${leaf.fn} }. ${leaf.obj}`,
    responsibility: `Implement ${leaf.id}.`, completionCriteria: `${leaf.file} passes its test.`, order: i + 1, createdAt: now,
    status: 'pending', runReadiness: 'runnable', understandingLevel: 'known',
    acceptance: { mode: 'guarded', expectedOutcome: `${leaf.file} passes`, requiredArtifacts: [{ path: leaf.file }], requiredChecks: [{ command: leaf.check }] },
  });
});

const t0 = Date.now();
console.log('[L3] decomposed depth-2 stringutils build via claude + verify-checks ...');
const res = runTaskOps(w, { executor: 'claude-code', runId, verifyChecks: true, continueOnFailure: true, maxSteps: 12, timeout: 1200 });
const parsed = parseProject(w);
const leaves = LEAVES.map((l) => parseMarkdownFile(join(w, `${childTv}/tasks/${l.id}.md`)));
const parent = parseMarkdownFile(join(w, `${parentTv}/tasks/build.md`));
const leafVerified = (t) => {
  const rr = (t.runRefs || []).find((r) => /execution/.test(String(r.role || ''))) || (t.runRefs || [])[0] || {};
  const rev = rr.runNodeId && existsSync(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)) ? parseMarkdownFile(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)).reviewReport : {};
  return t.status === 'done' && rev.decision === 'approved' && rev.verified === true;
};
const leavesVerified = leaves.filter(leafVerified).length;
const leavesDone = leaves.filter((t) => t.status === 'done').length;
const rec = {
  level: 'L3', depth: 2, leaves: LEAVES.length, leaves_done: leavesDone, leaves_verify_grounded: leavesVerified,
  parent_status: parent.status,
  // honest-monotone: the parent may only be 'done' if every leaf is verify-grounded (no false roll-up)
  no_false_rollup: parent.status !== 'done' || leavesVerified === LEAVES.length,
  false_completions: leaves.filter((t) => t.status === 'done' && !leafVerified(t)).length,
  steps_run: res.stepsRun, stop_reason: res.stopReason, closure_complete: !!(parsed.closure && parsed.closure.complete),
  wallclock_s: Math.round((Date.now() - t0) / 1000),
};
writeFileSync(join(EVAL, 'results', 'l3-stringutils.json'), JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec, null, 2));
rmSync(root, { recursive: true, force: true });
