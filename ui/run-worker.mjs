#!/usr/bin/env node
// One parallel worker: run a SINGLE target task to completion, then exit. The daemon spawns several of these as
// separate OS processes so their (synchronous, spawnSync-based) executor calls run truly concurrently.
//   usage: node ui/run-worker.mjs <work-dir> <executor> <taskId> <runId>
import { runTaskOps } from '../cli/lib-runner.js';
const [work, executor, taskId, runId] = process.argv.slice(2);
if (!work || !executor || !taskId || !runId) { console.error('usage: run-worker <work> <executor> <taskId> <runId>'); process.exit(2); }
try {
  const res = runTaskOps(work, { executor, runId, targetTaskId: taskId, allowConcurrentTarget: true, verifyChecks: executor === 'dry-run', continueOnFailure: true, maxSteps: 3, timeout: 300 });
  process.stdout.write(`${taskId}:${res.stopReason}\n`);
} catch (e) { process.stdout.write(`${taskId}:error:${String((e && e.message) || e).slice(0, 60)}\n`); process.exit(1); }
