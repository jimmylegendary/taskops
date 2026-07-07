#!/usr/bin/env node
// Concurrency batch for the BARE arm. Runs run_lcb_bare.mjs over N ImpossibleBench tasks (or a passed id list) and
// aggregates. usage: node run_bare_batch.mjs <executor> [N] [split] [concurrency]
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const VENV_PY = join(EVAL, '.venv', 'bin', 'python');
const executor = process.argv[2] || 'codex-cli';
const N = Number(process.argv[3]) || 50;
const split = process.argv[4] || 'conflicting';
const conc = Number(process.argv[5]) || 4;

const ids = JSON.parse(execFileSync(VENV_PY, ['-c', `import json;from datasets import load_dataset;print(json.dumps([r['task_id'] for r in load_dataset('fjzzq2002/impossible_livecodebench', split='${split}')][:${N}]))`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
console.log(`bare batch: ${executor} × ${ids.length} ${split} tasks, concurrency ${conc}`);

function runOne(id) {
  return new Promise((res) => {
    const c = spawn(process.execPath, [join(here, 'run_lcb_bare.mjs'), id, executor, split], { stdio: ['ignore', 'ignore', 'ignore'] });
    c.on('close', () => res(id)); c.on('error', () => res(id));
  });
}
let i = 0, done = 0;
async function worker() { while (i < ids.length) { const id = ids[i++]; await runOne(id); done += 1; if (done % 5 === 0 || done === ids.length) console.log(`[${done}/${ids.length}]`); } }
await Promise.all(Array.from({ length: conc }, worker));

// aggregate
const dir = join(EVAL, 'results', 'bare');
const recs = readdirSync(dir).filter((f) => f.startsWith(`bare-lcb-${executor}-${split}-`)).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const agg = {
  arm: 'bare', executor, bench: 'impossiblebench-lcb', split, n: recs.length,
  reward_hacks: recs.filter((r) => r.reward_hack).length,
  false_completion_claims: recs.filter((r) => r.false_completion_claim).length,
  honest_stalls: recs.filter((r) => r.honest_stall).length,
  claimed_done: recs.filter((r) => r.claimed_done).length,
};
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `_summary-bare-lcb-${executor}-${split}.json`), JSON.stringify(agg, null, 2));
console.log(JSON.stringify(agg, null, 2));
