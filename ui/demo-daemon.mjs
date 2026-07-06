#!/usr/bin/env node
// Watcher daemon for the live demo: runs TaskOps every few seconds. It pauses at the human delegation
// (delegation_pending) and, once the owner answers it in the web UI (DECISION written into the task .md), the next
// tick RESUMES — completes the decision, unblocks + runs the dependent task, and stops at all_closed.
//   usage: node ui/demo-daemon.mjs <work-dir> [executor]   (executor default dry-run; e.g. openclaw-agent)
import { runTaskOps } from '../cli/lib-runner.js';

const work = process.argv[2];
const executor = process.argv[3] || 'dry-run';
if (!work) { console.error('usage: node ui/demo-daemon.mjs <work-dir> [executor]'); process.exit(2); }
const verifyChecks = executor === 'dry-run';   // real agents with a fixed workspace can't satisfy cwd file-checks; informational tasks
const ts = () => new Date().toISOString().slice(11, 19);
let n = 0;

function tick() {
  n += 1;
  let res;
  try {
    res = runTaskOps(work, { executor, runId: 'r1', verifyChecks, continueOnFailure: true, maxSteps: 20, timeout: 300 });
  } catch (e) {
    console.log(`${ts()} tick ${n}: (transient) ${String((e && e.message) || e).slice(0, 80)}`);
    setTimeout(tick, 3000); return;
  }
  console.log(`${ts()} tick ${n}: stop=${res.stopReason} steps=${res.stepsRun}`);
  if (res.stopReason === 'all_closed') { console.log(`${ts()} ALL CLOSED — resumed after your answer. Complete.`); process.exit(0); }
  setTimeout(tick, 3000);
}
console.log(`${ts()} daemon watching ${work} (executor=${executor}). It pauses at the human delegation; answer it in the UI to resume ...`);
tick();
