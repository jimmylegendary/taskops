#!/usr/bin/env node
// Regression (Track B / D1 — the ACTIVE delegation loop): a resolverKind:'ai' delegation is resolved by invoking
// an INDEPENDENT AI resolver (a different runtime adapter than the executor) which answers the escalated QUESTION;
// the runner fills DECISION/BASIS and the task RESUMES. Gates: the delegation is resolved by the resolver (not the
// executor — provenance) and resumes to completion; INDEPENDENCE (resolver==executor -> no auto-resolve); a
// resolver that DECLINES leaves it PENDING (never fabricated).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmBlock, parseMarkdownFile, readBody } from '../lib-taskops.js';
import { runTaskOps, EXTERNAL_RESOLUTION_TEMPLATE } from '../lib-runner.js';

const now = '2026-07-05T00:00:00.000Z';
// a scripted AI resolver bin: ignore args/stdin, write the decision file to cwd, exit 0.
function resolverBin(decision) {
  const dir = mkdtempSync(join(tmpdir(), 'taskops-resolverbin-'));
  const p = join(dir, 'resolver.sh');
  writeFileSync(p, `#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\nprintf '%s' '{"decision":${JSON.stringify(decision)},"basis":"resolver picked"}' > delegation-decision.json\necho ok\n`, 'utf8');
  chmodSync(p, 0o755);
  return p;
}
function build() {
  const root = mkdtempSync(join(tmpdir(), 'taskops-aidel-'));
  const w = join(root, 'work');
  const tv = 'task-groups/tg-root/versions/tgv-root-v1';
  for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
  const md = (p, fm, b) => writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8');
  md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'ad', title: 'A', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
  md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
  md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
  md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
  md(`${tv}/tasks/t.md`, {
    taskOpsVersion: 'v1', entityType: 'task', id: 't', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
    title: 'Decide', objective: 'Pick the strategy.', responsibility: 'Own the choice.', completionCriteria: 'decision recorded',
    order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', resolverKind: 'ai',
    acceptance: { mode: 'guarded', expectedOutcome: 'decision recorded', requiredChecks: [{ command: 'exit 0' }] },
  }, EXTERNAL_RESOLUTION_TEMPLATE.replace('<agent: the single decision that could not be settled — one decision unit, crisp>', 'Which strategy: A or B?'));
  return w;
}
const task = (w) => parseMarkdownFile(join(w, 'task-groups/tg-root/versions/tgv-root-v1/tasks/t.md'));
const events = (w) => { try { return readFileSync(join(w, 'runs/r1/events.jsonl'), 'utf8'); } catch { return ''; } }; // best-effort

// 1) ACTIVE RESOLVE: an independent AI resolver (claude-code, scripted) answers the delegation; the executor is
// dry-run (independence). The delegation resumes and completes; the DECISION is recorded in the task body.
{
  process.env.TASKOPS_CLAUDE_BIN = resolverBin('Strategy A');
  const w = build();
  runTaskOps(w, { executor: 'dry-run', aiResolver: 'claude-code', verifyChecks: true, continueOnFailure: true, maxSteps: 4 });
  const body = readBody(join(w, 'task-groups/tg-root/versions/tgv-root-v1/tasks/t.md'));
  assert.ok(body.includes('Strategy A'), 'the independent AI resolver filled the DECISION');
  assert.equal(body.includes('<resolver:'), false, 'the resolution block is fully filled (no placeholders left)');
  assert.equal(task(w).status, 'done', 'the resolved delegation RESUMED and completed');
  rmSync(join(w, '..'), { recursive: true, force: true });
}

// 2) INDEPENDENCE: if the resolver equals the executor, the loop must NOT auto-resolve (no self-resolution of an
// external delegation). The task stays PENDING.
{
  process.env.TASKOPS_CLAUDE_BIN = resolverBin('Strategy A');
  const w = build();
  runTaskOps(w, { executor: 'claude-code', aiResolver: 'claude-code', verifyChecks: true, continueOnFailure: true, maxSteps: 3 });
  assert.notEqual(task(w).status, 'done', 'resolver==executor must not auto-resolve (independence); stays pending');
  rmSync(join(w, '..'), { recursive: true, force: true });
}

// 3) DECLINE: a resolver that returns an empty decision must leave the delegation PENDING — never fabricate.
{
  process.env.TASKOPS_CLAUDE_BIN = resolverBin('');
  const w = build();
  runTaskOps(w, { executor: 'dry-run', aiResolver: 'claude-code', verifyChecks: true, continueOnFailure: true, maxSteps: 4 });
  assert.notEqual(task(w).status, 'done', 'a declined delegation stays pending, not fabricated into a completion');
  const body = readBody(join(w, 'task-groups/tg-root/versions/tgv-root-v1/tasks/t.md'));
  assert.ok(body.includes('<resolver:'), 'the DECISION block is left unfilled when the resolver declines');
  rmSync(join(w, '..'), { recursive: true, force: true });
}

console.log('OK delegation-ai-resolver (active resolve + resume / independence / decline stays pending)');
