#!/usr/bin/env node
// PARALLEL TaskOps watcher daemon. Each tick it finds every task that is runnable RIGHT NOW (pending + runnable +
// not blocked + not an unresolved human/ai delegation) and runs them CONCURRENTLY as concurrent-target runs on a
// shared run (run-main). Independent tasks execute in parallel (visible with a real executor like openclaw). It
// pauses at human delegations (they surface in the UI queue); answering one lets its dependents become runnable.
//   usage: node ui/run-daemon.mjs <work-dir> [executor] [maxConcurrent]
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseProject, deriveExternalResolutionStatus, readBody, fmBlock } from '../cli/lib-taskops.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const work = process.argv[2];
const executor = process.argv[3] || 'dry-run';
const maxConc = Math.max(1, Number(process.argv[4]) || 4);
const maxSteps = Number(process.argv[5]) || Infinity;      // global cap on total task-executions
const untilHours = Number(process.argv[6]) || Infinity;     // wall-clock deadline in hours
if (!work) { console.error('usage: node ui/run-daemon.mjs <work-dir> [executor] [maxConcurrent] [maxSteps] [untilHours]'); process.exit(2); }
const RUN = 'run-main';
const verifyChecks = executor === 'dry-run';
const deadline = untilHours === Infinity ? Infinity : Date.now() + untilHours * 3600 * 1000;
let totalSteps = 0;
const ts = () => new Date().toISOString().slice(11, 19);

// pre-create the shared run scaffold so concurrent workers don't race on creating it
function ensureRun() {
  const rd = join(work, 'runs', RUN);
  if (existsSync(join(rd, 'index.md'))) return;
  for (const d of ['nodes', 'edges']) mkdirSync(join(rd, d), { recursive: true });
  let workId = 'work';
  try { workId = parseProject(work).project.id || 'work'; } catch {}
  writeFileSync(join(rd, 'index.md'), `${fmBlock({ taskOpsVersion: 'v1', entityType: 'run', id: RUN, workId, createdAt: '2026-07-07T00:00:00.000Z', status: 'active' })}# Run ${RUN}\n`, 'utf8');
  writeFileSync(join(rd, 'run-log.md'), '# Run log\n', 'utf8');
  writeFileSync(join(rd, 'events.jsonl'), '', 'utf8');
}

function runnableNow() {
  let p;
  try { p = parseProject(work); } catch { return []; }
  return [...p.tasks.values()].filter((t) => {
    if (t.status !== 'pending' || t.runReadiness !== 'runnable') return false;
    if (t.childTaskGroupId) return false;   // decompose-parents handled by a normal (untargeted) pass
    if (['human', 'ai'].includes(t.resolverKind)) {
      let body = ''; try { body = readBody(t.path); } catch {}
      const st = deriveExternalResolutionStatus({ resolverKind: t.resolverKind, body });
      if (st === 'waiting' || st === 'invalid') return false;   // delegation still pending -> skip
    }
    return true;
  }).map((t) => t.id);
}

// spawn a worker as a SEPARATE OS process so its synchronous executor call runs truly concurrently with the others
function runOne(taskId) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [join(HERE, 'run-worker.mjs'), work, executor, taskId, RUN], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => resolve({ taskId, out: out.trim() }));
    c.on('error', (e) => resolve({ taskId, error: String(e.message || e).slice(0, 60) }));
  });
}

let tick = 0;
async function loop() {
  tick += 1;
  if (Date.now() > deadline) { console.log(`${ts()} DEADLINE reached (${untilHours}h) — stopping. ${totalSteps} steps done.`); process.exit(0); }
  if (totalSteps >= maxSteps) { console.log(`${ts()} MAX STEPS reached (${maxSteps}) — stopping.`); process.exit(0); }
  ensureRun();
  const ids = runnableNow();
  if (ids.length === 0) {
    // nothing runnable: either all closed, or waiting on a human delegation
    let closed = false; try { closed = !!(parseProject(work).closure || {}).complete; } catch {}
    if (closed) { console.log(`${ts()} ALL CLOSED — complete. ${totalSteps} steps.`); process.exit(0); }
    console.log(`${ts()} tick ${tick}: idle — waiting on a human delegation in the UI (${totalSteps}/${maxSteps === Infinity ? '∞' : maxSteps} steps) ...`);
    setTimeout(loop, 3000); return;
  }
  const budget = maxSteps === Infinity ? maxConc : Math.max(1, Math.min(maxConc, maxSteps - totalSteps));
  const batch = ids.slice(0, budget);
  console.log(`${ts()} tick ${tick}: running ${batch.length} task(s) in parallel -> ${batch.join(', ')}`);
  const results = await Promise.all(batch.map(runOne));
  totalSteps += results.length;
  console.log(`${ts()} tick ${tick}: done (${totalSteps} total) -> ${results.map((r) => r.taskId + (r.error ? '!' + r.error : '')).join(', ')}`);
  setTimeout(loop, 500);
}
console.log(`${ts()} PARALLEL daemon watching ${work} (executor=${executor}, up to ${maxConc} concurrent). Answer human delegations in the UI to unblock dependents.`);
loop();
