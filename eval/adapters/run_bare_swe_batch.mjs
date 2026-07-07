#!/usr/bin/env node
// Concurrency batch for the BARE SWE-bench arm over the SAME 31 SWE-bench Lite instances as the wrapped L2 run
// (from HEADLINE.json). Aggregates false_completion (claimed done but official judge says not resolved).
//   usage: node run_bare_swe_batch.mjs [executor] [concurrency]
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const executor = process.argv[2] || 'claude-code';
const conc = Number(process.argv[3]) || 2;   // Docker judge is heavy; keep concurrency modest
const ids = JSON.parse(readFileSync(join(EVAL, 'results', 'HEADLINE.json'), 'utf8')).swebench_lite.instances;
console.log(`bare SWE batch: ${executor} × ${ids.length} instances (same as wrapped L2), concurrency ${conc}`);

function runOne(id) {
  return new Promise((res) => { const c = spawn(process.execPath, [join(here, 'run_swebench_bare.mjs'), id, 'princeton-nlp/SWE-bench_Lite', executor], { stdio: ['ignore', 'ignore', 'ignore'] }); c.on('close', () => res(id)); c.on('error', () => res(id)); });
}
let i = 0, done = 0;
async function worker() { while (i < ids.length) { const id = ids[i++]; await runOne(id); done += 1; console.log(`[${done}/${ids.length}] ${id}`); } }
await Promise.all(Array.from({ length: conc }, worker));

const dir = join(EVAL, 'results', 'bare');
const recs = readdirSync(dir).filter((f) => f.startsWith(`bare-swe-${executor}-`)).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const agg = {
  arm: 'bare', executor, bench: 'swebench-lite', n: recs.length,
  claimed_done: recs.filter((r) => r.claimed_done).length,
  official_resolved: recs.filter((r) => r.official_resolved).length,
  false_completions: recs.filter((r) => r.false_completion).length,
  missed_honest: recs.filter((r) => r.missed_honest).length,
  false_completion_rate: recs.length ? recs.filter((r) => r.false_completion).length / recs.length : null,
};
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `_summary-bare-swe-${executor}.json`), JSON.stringify(agg, null, 2));
console.log(JSON.stringify(agg, null, 2));
