#!/usr/bin/env node
// Track B / D2 — REAL two-model handoff. A task escalates a design decision (resolverKind:'ai'); a REAL other AI
// (codex-cli, different from the claude-code executor) resolves it; the executor RESUMES with the surfaced
// decision. Proves the active delegation loop end-to-end with two real models. Records the handoff provenance.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmBlock, parseMarkdownFile, readBody } from '/home/jimmy/repos/taskops/cli/lib-taskops.js';
import { runTaskOps, EXTERNAL_RESOLUTION_TEMPLATE } from '/home/jimmy/repos/taskops/cli/lib-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const wrapper = join('/home/jimmy/repos/personal-assets-vault/taskops-governance/experiments', 'claude-safe-wrapper.sh');
chmodSync(wrapper, 0o755); process.env.TASKOPS_CLAUDE_BIN = wrapper;   // claude executor via MCP-safe wrapper; codex resolver uses the real codex CLI

const now = '2026-07-06T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'taskops-d2-'));
const w = join(root, 'work');
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
const taskId = 'greet', runId = 'r1';
for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm, b) => writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8');
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'd2', title: 'D2', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });

// valid run scaffold + seed the executor workspace
const runDir = join(w, 'runs', runId);
for (const d of ['nodes', 'edges']) mkdirSync(join(runDir, d), { recursive: true });
writeFileSync(join(runDir, 'index.md'), `${fmBlock({ taskOpsVersion: 'v1', entityType: 'run', id: runId, workId: 'd2', createdAt: now, status: 'active' })}# Run ${runId}\n`, 'utf8');
writeFileSync(join(runDir, 'run-log.md'), '# Run log\n', 'utf8');
writeFileSync(join(runDir, 'events.jsonl'), '', 'utf8');
const workspace = join(runDir, 'artifacts', `run-node-${taskId}`, 'workspace');
mkdirSync(workspace, { recursive: true });
writeFileSync(join(workspace, 'greeting.py'), 'def greeting(name):\n    pass\n', 'utf8');

const check = `python3 -c "import sys; sys.path.insert(0,'.'); from greeting import greeting; g=greeting('Sam'); assert isinstance(g,str) and 'Sam' in g, repr(g)"`;
const question = 'Should greeting(name) be FORMAL (e.g. "Good day, <name>.") or CASUAL (e.g. "Hey <name>!")? Answer with exactly the word formal or casual.';
const body = EXTERNAL_RESOLUTION_TEMPLATE
  .replace('<agent: the single decision that could not be settled — one decision unit, crisp>', question)
  .replace('<agent: candidate answers with trade-offs; if you cannot enumerate them, add an\nexplicit "open:" line naming what is unknown — do not leave this empty>', 'formal — professional tone; casual — friendly tone.');
md(`${tv}/tasks/${taskId}.md`, {
  taskOpsVersion: 'v1', entityType: 'task', id: taskId, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: 'greeting', objective: 'Implement greeting(name) in greeting.py in your working directory so it returns a greeting string that includes the name. HONOR the resolved external decision about tone.',
  responsibility: 'Implement greeting honoring the resolved tone.', completionCriteria: 'greeting.py passes its test.',
  order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', resolverKind: 'ai',
  acceptance: { mode: 'guarded', expectedOutcome: 'greeting works', requiredArtifacts: [{ path: 'greeting.py' }], requiredChecks: [{ command: check }] },
}, body);

const t0 = Date.now();
console.log('[D2] executor=claude-code, aiResolver=codex-cli — real two-model handoff ...');
runTaskOps(w, { executor: 'claude-code', aiResolver: 'codex-cli', runId, verifyChecks: true, continueOnFailure: true, maxSteps: 4, timeout: 600 });
const task = parseMarkdownFile(join(w, `${tv}/tasks/${taskId}.md`));
const taskBody = readBody(join(w, `${tv}/tasks/${taskId}.md`));
const evLog = readFileSync(join(runDir, 'events.jsonl'), 'utf8');
const resolvedEvent = evLog.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e && e.type === 'delegation_resolved');
const decisionText = (taskBody.split('## DECISION')[1] || '').split('##')[0].trim().slice(0, 80);
const rr = (task.runRefs || []).find((r) => /execution/.test(String(r.role || ''))) || (task.runRefs || [])[0] || {};
const review = rr.runNodeId && existsSync(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`))
  ? parseMarkdownFile(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)).reviewReport : {};
const rec = {
  handoff: 'claude-code(executor) <- codex-cli(resolver)',
  delegation_resolved_by: resolvedEvent ? resolvedEvent.resolvedBy : null,
  decision_recorded: decisionText, decision_present: !taskBody.includes('<resolver:'),
  resumed_and_executed: (task.runRefs || []).length > 0,
  taskops_status: task.status, review_decision: review.decision || null,
  verified_done: task.status === 'done' && review.decision === 'approved' && review.verified === true,
  wallclock_s: Math.round((Date.now() - t0) / 1000),
};
writeFileSync(join(EVAL, 'results', 'delegation-d2.json'), JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec, null, 2));
rmSync(root, { recursive: true, force: true });
