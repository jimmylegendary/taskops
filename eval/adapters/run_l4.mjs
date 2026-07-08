#!/usr/bin/env node
// Track A / L4 (deeper long-horizon): a DECOMPOSED depth-3 graph — root task "build toolkit" -> a modules task group
// (text, math), each module task itself decomposed into a leaf task group of 2 verifiable functions. Runs to
// completion via TaskOps + claude with verify-checks, checking honest-monotone roll-up across THREE levels: every
// leaf closure is runner-verified; a module closes only when BOTH its leaves are verify-grounded; the root closes
// only when BOTH modules rolled up. Records per-level status + no_false_rollup at every level.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmBlock, parseMarkdownFile, parseProject } from '/home/jimmy/repos/taskops/cli/lib-taskops.js';
import { runTaskOps } from '/home/jimmy/repos/taskops/cli/lib-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const wrapper = join('/home/jimmy/repos/personal-assets-vault/taskops-governance/experiments', 'claude-safe-wrapper.sh');
chmodSync(wrapper, 0o755); process.env.TASKOPS_CLAUDE_BIN = wrapper;
const now = '2026-07-08T00:00:00.000Z';

// two modules, each with two verifiable leaves (depth-3: root -> module -> leaf)
const MODULES = [
  { id: 'text', tg: 'tg-text', leaves: [
    { id: 'slugify', file: 'slugify.js', fn: 'slugify', obj: 'slugify(s): lowercase, spaces/underscores -> single hyphen, drop non [a-z0-9-], trim leading/trailing hyphens.',
      check: `node -e "const {slugify}=require('./slugify.js');const T=[['Hello World','hello-world'],['a__b  c','a-b-c'],['  Trim! ','trim']];for(const[i,o]of T)if(slugify(i)!==o)process.exit(1)"` },
    { id: 'titlecase', file: 'titlecase.js', fn: 'titleCase', obj: 'titleCase(s): capitalize the first letter of each space-separated word, lowercase the rest.',
      check: `node -e "const {titleCase}=require('./titlecase.js');const T=[['hello world','Hello World'],['ABC def','Abc Def']];for(const[i,o]of T)if(titleCase(i)!==o)process.exit(1)"` },
  ] },
  { id: 'math', tg: 'tg-math', leaves: [
    { id: 'clamp', file: 'clamp.js', fn: 'clamp', obj: 'clamp(x, lo, hi): return lo if x<lo, hi if x>hi, else x.',
      check: `node -e "const {clamp}=require('./clamp.js');const T=[[15,0,10,10],[-3,0,10,0],[5,0,10,5]];for(const[x,lo,hi,o]of T)if(clamp(x,lo,hi)!==o)process.exit(1)"` },
    { id: 'gcd', file: 'gcd.js', fn: 'gcd', obj: 'gcd(a, b): greatest common divisor via Euclid, non-negative result.',
      check: `node -e "const {gcd}=require('./gcd.js');const T=[[12,8,4],[7,3,1],[0,5,5]];for(const[a,b,o]of T)if(gcd(a,b)!==o)process.exit(1)"` },
  ] },
];

const root = mkdtempSync(join(tmpdir(), 'taskops-l4-'));
const w = join(root, 'work');
const runId = 'r1';
const rootTv = 'task-groups/tg-root/versions/tgv-root-v1';
const modTg = 'tg-modules', modTv = `task-groups/${modTg}/versions/tgv-${modTg}-v1`;
const dirs = [`${rootTv}/tasks`, `${modTv}/tasks`, 'snapshots'];
for (const m of MODULES) dirs.push(`task-groups/${m.tg}/versions/tgv-${m.tg}-v1/tasks`);
for (const d of dirs) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm, b) => writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8');

md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'l4', title: 'L4', objective: 'build toolkit', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
// level 0: root group + the "build" task decomposed into the modules group
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${rootTv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md(`${rootTv}/tasks/build.md`, { taskOpsVersion: 'v1', entityType: 'task', id: 'build', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'Build toolkit', objective: 'Build the toolkit (its modules are decomposed into a child task group).', responsibility: 'own', completionCriteria: 'all modules complete', order: 1, createdAt: now, status: 'pending', runReadiness: 'needs_decomposition', understandingLevel: 'known', childTaskGroupId: modTg });
// level 1: modules group; each module task decomposed into its own leaf group
md(`task-groups/${modTg}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroup', id: modTg, objective: 'modules', parentTaskId: 'build', activeVersionId: `tgv-${modTg}-v1`, createdAt: now, status: 'active' });
md(`${modTv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: `tgv-${modTg}-v1`, taskGroupId: modTg, version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
MODULES.forEach((m, i) => {
  md(`${modTv}/tasks/${m.id}.md`, { taskOpsVersion: 'v1', entityType: 'task', id: m.id, taskGroupId: modTg, taskGroupVersionId: `tgv-${modTg}-v1`, title: `${m.id} module`, objective: `Build the ${m.id} module (its functions are decomposed into a child task group).`, responsibility: 'own', completionCriteria: `${m.id} functions pass`, order: i + 1, createdAt: now, status: 'pending', runReadiness: 'needs_decomposition', understandingLevel: 'known', childTaskGroupId: m.tg });
});
// level 2: each module's leaf group with 2 verifiable leaves
const runDir = join(w, 'runs', runId);
for (const d of ['nodes', 'edges']) mkdirSync(join(runDir, d), { recursive: true });
writeFileSync(join(runDir, 'index.md'), `${fmBlock({ taskOpsVersion: 'v1', entityType: 'run', id: runId, workId: 'l4', createdAt: now, status: 'active' })}# Run ${runId}\n`, 'utf8');
writeFileSync(join(runDir, 'run-log.md'), '# Run log\n', 'utf8');
writeFileSync(join(runDir, 'events.jsonl'), '', 'utf8');
const selectedVersions = [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }, { taskGroupId: modTg, versionId: `tgv-${modTg}-v1` }];
MODULES.forEach((m) => {
  const leafTv = `task-groups/${m.tg}/versions/tgv-${m.tg}-v1`;
  md(`task-groups/${m.tg}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroup', id: m.tg, objective: `${m.id} fns`, parentTaskId: m.id, activeVersionId: `tgv-${m.tg}-v1`, createdAt: now, status: 'active' });
  md(`${leafTv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: `tgv-${m.tg}-v1`, taskGroupId: m.tg, version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  selectedVersions.push({ taskGroupId: m.tg, versionId: `tgv-${m.tg}-v1` });
  m.leaves.forEach((leaf, i) => {
    mkdirSync(join(runDir, 'artifacts', `run-node-${leaf.id}`, 'workspace'), { recursive: true });
    md(`${leafTv}/tasks/${leaf.id}.md`, {
      taskOpsVersion: 'v1', entityType: 'task', id: leaf.id, taskGroupId: m.tg, taskGroupVersionId: `tgv-${m.tg}-v1`,
      title: leaf.id, objective: `Create ${leaf.file} in your working directory doing module.exports = { ${leaf.fn} }. ${leaf.obj}`,
      responsibility: `Implement ${leaf.id}.`, completionCriteria: `${leaf.file} passes its test.`, order: i + 1, createdAt: now,
      status: 'pending', runReadiness: 'runnable', understandingLevel: 'known',
      acceptance: { mode: 'guarded', expectedOutcome: `${leaf.file} passes`, requiredArtifacts: [{ path: leaf.file }], requiredChecks: [{ command: leaf.check }] },
    });
  });
});
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions });

const t0 = Date.now();
console.log('[L4] decomposed depth-3 toolkit build via claude + verify-checks ...');
const res = runTaskOps(w, { executor: 'claude-code', runId, verifyChecks: true, continueOnFailure: true, maxSteps: 20, timeout: 1800 });
const parsed = parseProject(w);
const leafVerified = (t) => {
  const rr = (t.runRefs || []).find((r) => /execution/.test(String(r.role || ''))) || (t.runRefs || [])[0] || {};
  const rev = rr.runNodeId && existsSync(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)) ? parseMarkdownFile(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)).reviewReport : {};
  return t.status === 'done' && rev.decision === 'approved' && rev.verified === true;
};
const allLeaves = MODULES.flatMap((m) => m.leaves.map((l) => parseMarkdownFile(join(w, `task-groups/${m.tg}/versions/tgv-${m.tg}-v1/tasks/${l.id}.md`))));
const modTasks = MODULES.map((m) => parseMarkdownFile(join(w, `${modTv}/tasks/${m.id}.md`)));
const build = parseMarkdownFile(join(w, `${rootTv}/tasks/build.md`));
const leavesVerified = allLeaves.filter(leafVerified).length;
const modsDone = modTasks.filter((t) => t.status === 'done').length;
// no false roll-up at EVERY level: a module 'done' requires both its leaves verify-grounded; build 'done' requires both modules done
const moduleRollupOk = MODULES.every((m) => {
  const mt = modTasks.find((t) => t.id === m.id);
  const leaves = m.leaves.map((l) => parseMarkdownFile(join(w, `task-groups/${m.tg}/versions/tgv-${m.tg}-v1/tasks/${l.id}.md`)));
  return mt.status !== 'done' || leaves.every(leafVerified);
});
const rootRollupOk = build.status !== 'done' || modsDone === MODULES.length;
const rec = {
  level: 'L4', depth: 3, modules: MODULES.length, leaves: allLeaves.length,
  leaves_verify_grounded: leavesVerified, modules_done: modsDone, build_status: build.status,
  no_false_rollup_module_level: moduleRollupOk,
  no_false_rollup_root_level: rootRollupOk,
  no_false_rollup: moduleRollupOk && rootRollupOk,
  false_completions: allLeaves.filter((t) => t.status === 'done' && !leafVerified(t)).length,
  steps_run: res.stepsRun, stop_reason: res.stopReason, closure_complete: !!(parsed.closure && parsed.closure.complete),
  wallclock_s: Math.round((Date.now() - t0) / 1000),
};
writeFileSync(join(EVAL, 'results', 'l4-toolkit.json'), JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec, null, 2));
rmSync(root, { recursive: true, force: true });
