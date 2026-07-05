#!/usr/bin/env node
// Regression (Track B / D3 — the SUSTAINED delegation loop, the unbounded-time property in miniature): a run with
// MANY resolverKind:'ai' tasks the executor cannot settle alone progresses PURELY via repeated honest handoffs —
// each delegation is actively resolved by an independent resolver, the task resumes and completes verify-grounded,
// and the whole graph closes honest-monotone (every closure runner-verified; no orphaned/lost delegation; no fake).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { runTaskOps, EXTERNAL_RESOLUTION_TEMPLATE } from '../lib-runner.js';

const now = '2026-07-06T00:00:00.000Z';
const N = 5;

// scripted independent resolver: writes a decision to cwd, exit 0
const bindir = mkdtempSync(join(tmpdir(), 'taskops-loopbin-'));
const bin = join(bindir, 'resolver.sh');
writeFileSync(bin, `#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\nprintf '%s' '{"decision":"proceed with option A","basis":"resolver picked A"}' > delegation-decision.json\necho ok\n`, 'utf8');
chmodSync(bin, 0o755);
process.env.TASKOPS_CLAUDE_BIN = bin;

const root = mkdtempSync(join(tmpdir(), 'taskops-d3-'));
const w = join(root, 'work');
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm, b) => writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8');
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'd3', title: 'D3', objective: 'sustained delegation', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
const body = EXTERNAL_RESOLUTION_TEMPLATE.replace('<agent: the single decision that could not be settled — one decision unit, crisp>', 'Which option to proceed with?');
for (let i = 0; i < N; i++) {
  md(`${tv}/tasks/t${i}.md`, {
    taskOpsVersion: 'v1', entityType: 'task', id: `t${i}`, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
    title: `Decide ${i}`, objective: `Settle decision ${i}.`, responsibility: 'own', completionCriteria: 'decided',
    order: i + 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', resolverKind: 'ai',
    acceptance: { mode: 'guarded', expectedOutcome: 'decided', requiredChecks: [{ command: 'exit 0' }] },
  }, body);
}

// executor=dry-run (settles each resolved task), aiResolver=claude-code (the scripted independent resolver != executor)
const res = runTaskOps(w, { executor: 'dry-run', aiResolver: 'claude-code', verifyChecks: true, continueOnFailure: true, maxSteps: 40 });

const tasks = [...Array(N)].map((_, i) => parseMarkdownFile(join(w, `${tv}/tasks/t${i}.md`)));
const evLog = readFileSync(join(w, 'runs', res.runId, 'events.jsonl'), 'utf8');
const resolvedEvents = evLog.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.type === 'delegation_resolved');

// the loop SUSTAINED: every delegation was actively resolved and every task resumed to a verified completion.
assert.equal(resolvedEvents.length, N, `all ${N} delegations were actively resolved (repeated handoffs), got ${resolvedEvents.length}`);
assert.ok(resolvedEvents.every((e) => e.resolvedBy === 'ai:claude-code'), 'every resolution carries the independent-resolver provenance');
assert.ok(tasks.every((t) => t.status === 'done'), `all ${N} tasks resumed and completed`);
// honest-monotone: the graph closed complete, no fakes (each done via a real resolved+verified path)
const closure = parseProject(w).closure;
assert.equal(closure && closure.complete, true, 'the whole graph closed honest-monotone (all_closed)');
assert.equal(res.stopReason, 'all_closed', 'the run ends all_closed — the loop drove every delegation to closure');

rmSync(root, { recursive: true, force: true });
rmSync(bindir, { recursive: true, force: true });
console.log(`OK delegation-loop (D3: ${N} delegations sustained via repeated honest handoffs -> all verified-done, honest-monotone)`);
