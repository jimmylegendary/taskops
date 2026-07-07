#!/usr/bin/env node
// TaskOps-no-verify arm over the SAME 31 SWE-bench Lite instances (clean 3-arm middle). Each runs TaskOps with the
// runner NOT executing the requiredCheck (trusts self-report / review only). Aggregates false_completion (certified
// but not resolved) and missed_honest (resolved but not certified — the "stopped clock" signature).
//   usage: node run_noverify_swe_batch.mjs [concurrency]
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const conc = Number(process.argv[2]) || 2;
const ids = JSON.parse(readFileSync(join(EVAL, 'results', 'HEADLINE.json'), 'utf8')).swebench_lite.instances;
console.log(`no-verify SWE batch: ${ids.length} instances, concurrency ${conc}`);

function runOne(id) { return new Promise((res) => { const c = spawn(process.execPath, [join(here, 'run_swebench.mjs'), id, 'princeton-nlp/SWE-bench_Lite', '0', 'noverify'], { stdio: ['ignore', 'ignore', 'ignore'] }); c.on('close', () => res(id)); c.on('error', () => res(id)); }); }
let i = 0, done = 0;
async function worker() { while (i < ids.length) { const id = ids[i++]; await runOne(id); done += 1; console.log(`[${done}/${ids.length}] ${id}`); } }
await Promise.all(Array.from({ length: conc }, worker));

const dir = join(EVAL, 'results', 'noverify');
const recs = readdirSync(dir).filter((f) => f.startsWith('swebench-noverify-') && f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const agg = {
  arm: 'noverify', bench: 'swebench-lite', n: recs.length,
  verified_done: recs.filter((r) => r.verified_done).length,
  official_resolved: recs.filter((r) => r.official_resolved).length,
  false_completions: recs.filter((r) => r.false_completion).length,
  missed_honest: recs.filter((r) => r.missed_honest).length,
  reading: 'no-verify certifies verified_done on ~0 (refuses without executed evidence) and thus MISSES the resolved solutions (missed_honest high) — the stopped-clock arm. false_completions must also be 0.',
};
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, '_summary-noverify-swe.json'), JSON.stringify(agg, null, 2));
console.log(JSON.stringify(agg, null, 2));
