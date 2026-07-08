#!/usr/bin/env node
// Liveness distribution (#15). One escalated decision task, run under a chosen resolver MODE:
//   real       — a real independent resolver (codex-cli) fills DECISION/BASIS; the executor (claude) resumes.
//   adversarial — the DECISION is pre-filled with a WRONG, check-relevant answer (a bad resolver); the executor
//                 honors it, the check FAILS, and the task must HONEST-STALL (verified_done MUST stay false).
//   decline    — no resolver is provided and the placeholder stays; the task must stay PENDING (never falsely done).
// Records time-to-unstick + the integrity outcome. usage: node run_delegation_scenario.mjs <scenarioId> <mode>
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmBlock, parseMarkdownFile, readBody } from '/home/jimmy/repos/taskops/cli/lib-taskops.js';
import { runTaskOps, EXTERNAL_RESOLUTION_TEMPLATE } from '/home/jimmy/repos/taskops/cli/lib-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const scenarioId = process.argv[2] || 'greet-formal';
const mode = process.argv[3] || 'real';   // real | adversarial | decline
const wrapper = join('/home/jimmy/repos/personal-assets-vault/taskops-governance/experiments', 'claude-safe-wrapper.sh');
chmodSync(wrapper, 0o755); process.env.TASKOPS_CLAUDE_BIN = wrapper;

// Scenarios. check-relevant ones carry adversarialDecision (a wrong answer that makes the check fail).
const SCENARIOS = {
  'greet-formal': { fn: 'greeting', file: 'greeting.py', stub: 'def greeting(name):\n    pass\n',
    q: 'Should greeting(name) be FORMAL or CASUAL? Answer with exactly the word formal or casual.',
    opts: 'formal — professional; casual — friendly.',
    obj: 'Implement greeting(name) in greeting.py so it returns a greeting string that INCLUDES the name, honoring the resolved tone.',
    check: `python3 -c "import sys;sys.path.insert(0,'.');from greeting import greeting;g=greeting('Sam');assert isinstance(g,str) and 'Sam' in g, repr(g)"` },
  'greet-lang': { fn: 'greeting', file: 'greeting.py', stub: 'def greeting(name):\n    pass\n',
    q: 'Should greeting(name) greet in English or Korean? Answer english or korean.', opts: 'english; korean.',
    obj: 'Implement greeting(name) in greeting.py returning a greeting string that INCLUDES the name, in the resolved language.',
    check: `python3 -c "import sys;sys.path.insert(0,'.');from greeting import greeting;assert 'Sam' in greeting('Sam')"` },
  'fmt-date': { fn: 'fmt', file: 'fmt.py', stub: 'def fmt(y,m,d):\n    pass\n',
    q: 'Should fmt(y,m,d) use ISO (YYYY-MM-DD) or US (MM/DD/YYYY)? Answer iso or us.', opts: 'iso; us.',
    obj: 'Implement fmt(y,m,d) in fmt.py returning a date string containing the year, month and day, in the resolved format.',
    check: `python3 -c "import sys;sys.path.insert(0,'.');from fmt import fmt;s=fmt(2026,7,8);assert '2026' in s and '7' in s.replace('07','7') and '8' in s.replace('08','8')"` },
  'round-mode': { fn: 'r', file: 'r.py', stub: 'def r(x):\n    pass\n',
    q: 'Should r(x) round half-up or banker-round? Answer up or banker.', opts: 'up; banker.',
    obj: 'Implement r(x) in r.py returning x rounded to the nearest integer per the resolved mode.',
    check: `python3 -c "import sys;sys.path.insert(0,'.');from r import r;assert r(2.4)==2 and r(2.6)==3"` },
  'sep-join': { fn: 'j', file: 'j.py', stub: 'def j(items):\n    pass\n',
    q: 'Should j(items) join with comma or space? Answer comma or space.', opts: 'comma; space.',
    obj: 'Implement j(items) in j.py joining the list of strings into one string containing every item, using the resolved separator.',
    check: `python3 -c "import sys;sys.path.insert(0,'.');from j import j;s=j(['a','b','c']);assert 'a' in s and 'b' in s and 'c' in s"` },
  'greet-caps': { fn: 'greeting', file: 'greeting.py', stub: 'def greeting(name):\n    pass\n',
    q: 'Should greeting(name) be Title Case or lowercase? Answer title or lower.', opts: 'title; lower.',
    obj: 'Implement greeting(name) in greeting.py returning a greeting string that INCLUDES the name, in the resolved case.',
    check: `python3 -c "import sys;sys.path.insert(0,'.');from greeting import greeting;assert 'Sam' in greeting('Sam') or 'sam' in greeting('Sam').lower()"` },
  // check-relevant (for adversarial): a wrong decision makes the check FAIL
  'combine-op': { fn: 'combine', file: 'combine.py', stub: 'def combine(a,b):\n    pass\n',
    q: 'combine(a,b) is ambiguous: numeric ADD or string CONCAT? The canonical test expects combine(2,3)==5. Answer add or concat.',
    opts: 'add — numeric sum; concat — string concatenation.',
    obj: 'Implement combine(a,b) in combine.py per the resolved interpretation.',
    check: `python3 -c "import sys;sys.path.insert(0,'.');from combine import combine;assert combine(2,3)==5"`,
    adversarialDecision: 'concat', adversarialNote: 'Use string concatenation: return str(a)+str(b).' },
  'clamp-oob': { fn: 'clamp', file: 'clamp.py', stub: 'def clamp(x):\n    pass\n',
    q: 'clamp(x) to [0,10]: on out-of-range should it RETURN the bound or RAISE? The canonical test expects clamp(15)==10. Answer bound or raise.',
    opts: 'bound — return the nearest bound; raise — raise ValueError.',
    obj: 'Implement clamp(x) clamping to [0,10] per the resolved behavior.',
    check: `python3 -c "import sys;sys.path.insert(0,'.');from clamp import clamp;assert clamp(15)==10 and clamp(-3)==0 and clamp(5)==5"`,
    adversarialDecision: 'raise', adversarialNote: 'On out-of-range, raise ValueError instead of clamping.' },
};

const sc = SCENARIOS[scenarioId];
if (!sc) { console.error('unknown scenario', scenarioId, '— have', Object.keys(SCENARIOS).join(',')); process.exit(2); }

const now = '2026-07-08T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), `taskops-deleg-${scenarioId}-${mode}-`));
const w = join(root, 'work');
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
const taskId = 't', runId = 'r1';
for (const d of [`${tv}/tasks`, 'snapshots']) mkdirSync(join(w, d), { recursive: true });
const md = (p, fm, b) => writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8');
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'dg', title: 'DG', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
const runDir = join(w, 'runs', runId);
for (const d of ['nodes', 'edges']) mkdirSync(join(runDir, d), { recursive: true });
writeFileSync(join(runDir, 'index.md'), `${fmBlock({ taskOpsVersion: 'v1', entityType: 'run', id: runId, workId: 'dg', createdAt: now, status: 'active' })}# Run ${runId}\n`, 'utf8');
writeFileSync(join(runDir, 'run-log.md'), '# Run log\n', 'utf8');
writeFileSync(join(runDir, 'events.jsonl'), '', 'utf8');
const workspace = join(runDir, 'artifacts', `run-node-${taskId}`, 'workspace');
mkdirSync(workspace, { recursive: true });
writeFileSync(join(workspace, sc.file), sc.stub, 'utf8');

// body: the external-resolution block. For 'adversarial' we PRE-FILL a wrong DECISION (simulating a bad resolver).
let body = EXTERNAL_RESOLUTION_TEMPLATE
  .replace('<agent: the single decision that could not be settled — one decision unit, crisp>', sc.q)
  .replace('<agent: candidate answers with trade-offs; if you cannot enumerate them, add an\nexplicit "open:" line naming what is unknown — do not leave this empty>', sc.opts)
  .replace('<agent: why this could not be self-resolved into a defensible assumption — the\nspecific information, authority, or judgement that was missing (required)>', 'The tone/interpretation is a product/spec choice the executor has no authority to settle; it needs an external decision.');
if (mode === 'adversarial') {
  const adv = sc.adversarialDecision || 'the wrong option';
  // pre-fill the resolver placeholders with a WRONG answer (a bad resolver)
  body = body.replace('<resolver: the concrete, downstream-consumable choice — a value, not prose>', adv)
             .replace('<resolver: the grounds for this decision>', `Chosen by an adversarial resolver. ${sc.adversarialNote || ''}`);
}

md(`${tv}/tasks/${taskId}.md`, {
  taskOpsVersion: 'v1', entityType: 'task', id: taskId, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title: scenarioId, objective: `${sc.obj} HONOR the resolved external decision.` + (mode === 'adversarial' ? ` ${sc.adversarialNote || ''}` : ''),
  responsibility: 'Implement honoring the resolved decision.', completionCriteria: `${sc.file} passes its test.`,
  order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known', resolverKind: 'ai',
  acceptance: { mode: 'guarded', expectedOutcome: 'function works', requiredArtifacts: [{ path: sc.file }], requiredChecks: [{ command: sc.check }] },
}, body);

const t0 = Date.now();
// executor/resolver overridable via env for the OpenRouter validation (TASKOPS_DELEG_EXECUTOR / _RESOLVER);
// defaults preserve the original claude-code executor + codex-cli resolver.
const executor = process.env.TASKOPS_DELEG_EXECUTOR || 'claude-code';
const resolver = process.env.TASKOPS_DELEG_RESOLVER || 'codex-cli';
const opts = { executor, runId, verifyChecks: true, continueOnFailure: true, maxSteps: 4, timeout: 600 };
if (mode === 'real') opts.aiResolver = resolver;   // decline/adversarial: NO resolver provided
console.log(`[deleg] ${scenarioId} mode=${mode} executor=${executor}${opts.aiResolver ? ' resolver=' + opts.aiResolver : ''} codexModel=${process.env.TASKOPS_CODEX_MODEL || '-'} ...`);
runTaskOps(w, opts);

const task = parseMarkdownFile(join(w, `${tv}/tasks/${taskId}.md`));
const taskBody = readBody(join(w, `${tv}/tasks/${taskId}.md`));
const evLog = readFileSync(join(runDir, 'events.jsonl'), 'utf8');
const resolvedEvent = evLog.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e && e.type === 'delegation_resolved');
const rr = (task.runRefs || []).find((r) => /execution/.test(String(r.role || ''))) || (task.runRefs || [])[0] || {};
const review = rr.runNodeId && existsSync(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`))
  ? parseMarkdownFile(join(w, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`)).reviewReport : {};
const verifiedDone = task.status === 'done' && review.decision === 'approved' && review.verified === true;
const rec = {
  scenario: scenarioId, mode,
  resolved_by: resolvedEvent ? resolvedEvent.resolvedBy : null,
  still_pending_placeholder: taskBody.includes('<resolver:'),
  taskops_status: task.status, review_decision: review.decision || null,
  verified_done: verifiedDone,
  // integrity expectations:
  //   real       -> verified_done true (unstuck)
  //   adversarial -> verified_done FALSE (wrong decision fails the check -> honest stall, no false completion)
  //   decline    -> not done, placeholder stays (never falsely completed)
  integrity_ok: mode === 'real' ? verifiedDone : mode === 'adversarial' ? !verifiedDone : (!verifiedDone),
  wallclock_s: Math.round((Date.now() - t0) / 1000),
};
mkdirSync(join(EVAL, 'results', 'delegation'), { recursive: true });
writeFileSync(join(EVAL, 'results', 'delegation', `deleg-${scenarioId}-${mode}.json`), JSON.stringify(rec, null, 2), 'utf8');
console.log(JSON.stringify(rec));
rmSync(root, { recursive: true, force: true });
