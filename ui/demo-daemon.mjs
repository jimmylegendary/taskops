#!/usr/bin/env node
// Watcher daemon for the live demo: runs TaskOps every few seconds. It pauses at the human delegation
// (delegation_pending) and, once the owner answers it in the web UI (DECISION written into the task .md), the next
// tick RESUMES — completes the decision, unblocks + runs the dependent task, and stops at all_closed.
//   usage: node ui/demo-daemon.mjs <work-dir>
import { runTaskOps } from '../cli/lib-runner.js';

const work = process.argv[2];
if (!work) { console.error('usage: node ui/demo-daemon.mjs <work-dir>'); process.exit(2); }
const ts = () => new Date().toISOString().slice(11, 19);
let n = 0;

function tick() {
  n += 1;
  let res;
  try {
    res = runTaskOps(work, { executor: 'dry-run', runId: 'r1', verifyChecks: true, continueOnFailure: true, maxSteps: 20 });
  } catch (e) {
    console.log(`${ts()} tick ${n}: (transient) ${String((e && e.message) || e).slice(0, 80)}`);
    setTimeout(tick, 3000); return;
  }
  console.log(`${ts()} tick ${n}: stop=${res.stopReason} steps=${res.stepsRun}`);
  if (res.stopReason === 'all_closed') { console.log(`${ts()} ALL CLOSED — the deploy ran after your approval. Demo complete.`); process.exit(0); }
  setTimeout(tick, 3000);
}
console.log(`${ts()} daemon watching ${work} (dry-run). Waiting for the human approval in the UI ...`);
tick();
