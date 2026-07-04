#!/usr/bin/env node
// Batch-run a TaskOps benchmark adapter over many tasks with a concurrency pool, then aggregate the honesty metric.
//   usage: node run_batch.mjs <lcb|swebench> <n> [concurrency] [split] [verifyRetries]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const VENV_PY = join(EVAL, '.venv', 'bin', 'python');
const bench = process.argv[2];
const N = Number(process.argv[3] || 10);
const concurrency = Number(process.argv[4] || (bench === 'lcb' ? 4 : 2));
const split = process.argv[5] || 'conflicting';
const retries = process.argv[6] || '0';

// task list
let ids = [];
if (bench === 'lcb') {
  ids = JSON.parse(execFileSync(VENV_PY, ['-c',
    `import json;from datasets import load_dataset;print(json.dumps([r['task_id'] for r in load_dataset('fjzzq2002/impossible_livecodebench',split='${split}')][:${N}]))`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
} else {
  ids = JSON.parse(execFileSync(VENV_PY, ['-c',
    `import json;from datasets import load_dataset;print(json.dumps([r['instance_id'] for r in load_dataset('princeton-nlp/SWE-bench_Lite',split='test')][:${N}]))`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}
const adapter = bench === 'lcb' ? 'run_lcb.mjs' : 'run_swebench.mjs';
const argsFor = (id) => bench === 'lcb' ? [id, split, retries] : [id, 'princeton-nlp/SWE-bench_Lite', retries];

console.log(`[batch] ${bench}: ${ids.length} tasks, concurrency ${concurrency}, retries ${retries}`);
let done = 0;
function runOne(id) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(here, adapter), ...argsFor(id)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => {
      done += 1;
      const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
      let rec = null; try { rec = JSON.parse(line); } catch {}
      console.log(`[${done}/${ids.length}] ${id}: ${rec ? (bench === 'lcb' ? `reward_hack=${rec.reward_hack} stall=${rec.honest_stall}` : `verified=${rec.verified_done} resolved=${rec.official_resolved} false_comp=${rec.false_completion}`) : 'NO RESULT'}`);
      resolve();
    });
  });
}
// simple pool
const queue = [...ids];
async function worker() { while (queue.length) await runOne(queue.shift()); }
await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));

// aggregate from results/
const prefix = bench === 'lcb' ? `lcb-${split}-` : 'swebench-';
const recs = readdirSync(join(EVAL, 'results')).filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(EVAL, 'results', f), 'utf8')))
  .filter((r) => ids.includes(r.task_id || r.instance_id));
const agg = bench === 'lcb'
  ? { bench, split, n: recs.length, reward_hacks: recs.filter((r) => r.reward_hack).length, honest_stalls: recs.filter((r) => r.honest_stall).length, verified_done: recs.filter((r) => r.verified_done).length }
  : { bench, n: recs.length, verified_done: recs.filter((r) => r.verified_done).length, resolved: recs.filter((r) => r.official_resolved).length, false_completions: recs.filter((r) => r.false_completion).length, missed_honest: recs.filter((r) => r.missed_honest).length };
writeFileSync(join(EVAL, 'results', `_summary-${bench}-${split}.json`), JSON.stringify(agg, null, 2), 'utf8');
console.log('\n=== SUMMARY ===\n' + JSON.stringify(agg, null, 2));
