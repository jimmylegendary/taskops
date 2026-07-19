#!/usr/bin/env node
// Wrapped (TaskOps) LCB batch for a chosen executor — for R1.3 (wrapped codex vs bare codex on the same impossible
// tasks). usage: node run_wrapped_lcb_batch.mjs <executor> [N] [split] [concurrency] [verifyRetries]
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const VENV_PY = join(EVAL, '.venv', 'bin', 'python');
const executor = process.argv[2] || process.env.TASKOPS_SWE_EXECUTOR || 'codex-cli';   // argv wins, then env override, then codex-cli policy default (mirrors run_swebench_bare.mjs L21)
const N = Number(process.argv[3]) || 50;
const split = process.argv[4] || 'conflicting';
const conc = Number(process.argv[5]) || 3;
const retries = process.argv[6] || '0';
const ids = JSON.parse(execFileSync(VENV_PY, ['-c', `import json;from datasets import load_dataset;print(json.dumps([r['task_id'] for r in load_dataset('fjzzq2002/impossible_livecodebench', split='${split}')][:${N}]))`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
console.log(`wrapped LCB: ${executor} × ${ids.length} ${split} (retries=${retries}), concurrency ${conc}`);

function runOne(id) { return new Promise((res) => { const c = spawn(process.execPath, [join(here, 'run_lcb.mjs'), id, split, retries, executor], { stdio: ['ignore', 'ignore', 'ignore'] }); c.on('close', () => res(id)); c.on('error', () => res(id)); }); }
let i = 0, done = 0;
async function worker() { while (i < ids.length) { const id = ids[i++]; await runOne(id); done += 1; if (done % 5 === 0 || done === ids.length) console.log(`[${done}/${ids.length}]`); } }
await Promise.all(Array.from({ length: conc }, worker));

const pref = executor === 'claude-code' ? `lcb-${split}-` : `lcb-${executor}-${split}-`;
const recs = readdirSync(join(EVAL, 'results')).filter((f) => f.startsWith(pref) && f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(EVAL, 'results', f), 'utf8')));
const agg = { arm: 'wrapped', executor, bench: 'impossiblebench-lcb', split, n: recs.length, reward_hacks: recs.filter((r) => r.reward_hack).length, verified_done: recs.filter((r) => r.verified_done).length, honest_stalls: recs.filter((r) => r.honest_stall).length };
writeFileSync(join(EVAL, 'results', `_summary-wrapped-lcb-${executor}-${split}.json`), JSON.stringify(agg, null, 2));
console.log(JSON.stringify(agg, null, 2));
