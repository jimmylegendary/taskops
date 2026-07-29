#!/usr/bin/env node
// Staged soak/bench driver (6h → 12h → 24h ladder; spec: eval/soak/STAGE-PLAN.md).
// Instance-major job order keeps per-instance 4-arm completeness when the global wall cap bites; every stop
// is typed (done/failed/timeout/not_run) and infra never counts as a task verdict. The ledger is append-only
// JSONL and the driver is RESUMABLE: exit-0 jobs are skipped, non-zero jobs retry up to maxAttemptsPerJob.
//   usage: node run-stage.mjs --config <stage.json> [--dry]
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const argv = process.argv.slice(2);
const cfgPath = argv[argv.indexOf('--config') + 1];
const DRY = argv.includes('--dry');
if (!cfgPath) { console.error('usage: run-stage.mjs --config <stage.json> [--dry]'); process.exit(2); }
const cfg = JSON.parse(readFileSync(join(here, cfgPath.includes('/') ? '' : '.', cfgPath), 'utf8'));

const outDir = join(here, cfg.stage);
mkdirSync(join(outDir, 'prior-backup'), { recursive: true });
const ledgerPath = join(outDir, 'ledger.jsonl');
const t0 = Date.now();
const wallMs = cfg.globalWallMin * 60000;
const perRunMs = cfg.perRunTimeoutMin * 60000;
const resultPath = (arm, id) => join(EVAL, arm.resultPattern.replace('{id}', id));

// pre-existing per-instance results are EVIDENCE — back them up once before any re-run can overwrite them
for (const arm of cfg.arms) for (const id of cfg.instances) {
  const p = resultPath(arm, id);
  if (existsSync(p)) { const b = join(outDir, 'prior-backup', `${arm.key}-${id}.json`); if (!existsSync(b)) copyFileSync(p, b); }
}

const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const attempts = new Map();
const doneOk = new Set();
for (const row of ledger) {
  // DRY rows are wiring checks, not evidence: the stub always exits 0, so counting them would mark every job
  // 'done' and make the NEXT REAL run skip the entire stage while reporting success. Never let a dry run
  // consume the resume budget.
  if (row.dry) continue;
  const k = `${row.arm}:${row.id}`;
  if (row.status === 'done') doneOk.add(k);
  if (['done', 'failed', 'timeout'].includes(row.status)) attempts.set(k, (attempts.get(k) || 0) + 1);
}

const jobs = [];
for (const id of cfg.instances) for (const arm of cfg.arms) {
  const k = `${arm.key}:${id}`;
  if (doneOk.has(k)) continue;
  if ((attempts.get(k) || 0) >= (cfg.maxAttemptsPerJob || 2)) continue;
  jobs.push({ id, arm });
}
const log = (row) => appendFileSync(ledgerPath, JSON.stringify(row) + '\n');
console.log(`[${cfg.stage}] jobs=${jobs.length} (skip=${cfg.instances.length * cfg.arms.length - jobs.length}) wallCap=${cfg.globalWallMin}min conc=${cfg.concurrency}${DRY ? ' DRY' : ''}`);

let consecFail = 0;
let halted = null;
function runJob(job) {
  return new Promise((resolveP) => {
    const started = new Date().toISOString();
    const jt0 = Date.now();
    const cmd = DRY
      ? [process.execPath, ['-e', 'setTimeout(() => { console.log("dry") }, 200)']]
      : [process.execPath, [join(EVAL, 'adapters', job.arm.adapter), job.id, cfg.dataset, ...(job.arm.extraArgs || [])]];
    const p = spawn(cmd[0], cmd[1], { cwd: EVAL, env: { ...process.env, ...(cfg.env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out = (out + d).slice(-4000); });
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    let killed = false;
    const killer = setTimeout(() => { killed = true; try { p.kill('SIGTERM'); } catch {} setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 30000); }, perRunMs);
    p.on('close', (code) => {
      clearTimeout(killer);
      const status = killed ? 'timeout' : (code === 0 ? 'done' : 'failed');
      consecFail = status === 'done' ? 0 : consecFail + 1;
      let resultSummary = null;
      if (!DRY) {
        const rp = resultPath(job.arm, job.id);
        if (existsSync(rp)) { try { const r = JSON.parse(readFileSync(rp, 'utf8')); resultSummary = { official_resolved: r.official_resolved ?? null, wallclock_s: r.wallclock_s ?? null }; } catch {} }
      }
      log({ ts: new Date().toISOString(), stage: cfg.stage, arm: job.arm.key, id: job.id, status, exitCode: code, startedAt: started, elapsedS: Math.round((Date.now() - jt0) / 1000), resultSummary, stdoutTail: out.slice(-1000), stderrTail: err.slice(-500), ...(DRY ? { dry: true } : {}) });
      // Disk hygiene for long runs: after the instance is fully done (verify + final grade all used the same
      // instance-level image), remove that image. Done here — never mid-grade — so the removal cannot race the
      // harness the way env-level cleanup did (the 35-forged-FAIL incident). {id1776} = swebench image tag form.
      if (cfg.postJobCleanup && !DRY) {
        // replaceAll (not replace): String#replace with a string pattern substitutes only the FIRST occurrence, so a
        // cleanup template that mentions {id} twice (e.g. a result-file guard + a docker rmi) would silently emit a
        // literal "{id}" into the shell. Existing configs use each token once, so this is a no-op for them.
        const cmd = cfg.postJobCleanup.replaceAll('{id1776}', job.id.replace('__', '_1776_')).replaceAll('{id}', job.id);
        try { execFileSync('/bin/sh', ['-c', cmd], { stdio: 'ignore', timeout: 60000 }); } catch {}
      }
      console.log(`[${cfg.stage}] ${job.arm.key}:${job.id} → ${status} (${Math.round((Date.now() - jt0) / 60000)}min, elapsed ${(Math.round((Date.now() - t0) / 60000))}min)`);
      resolveP(status);
    });
  });
}

let i = 0;
async function worker() {
  while (!halted) {
    if (Date.now() - t0 > wallMs) return;
    const job = jobs[i++];
    if (!job) return;
    await runJob(job);
    if (consecFail >= (cfg.haltOnConsecutiveFailures || 4)) {
      halted = `consecutive_failures>=${cfg.haltOnConsecutiveFailures || 4}`;
      writeFileSync(join(outDir, 'HALT'), `${new Date().toISOString()} ${halted}\n`);
      return;
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, cfg.concurrency || 1) }, worker));

// leftovers are typed honestly — never silently dropped
for (let j = i; j < jobs.length; j++) {
  log({ ts: new Date().toISOString(), stage: cfg.stage, arm: jobs[j].arm.key, id: jobs[j].id, status: 'not_run', reason: halted || 'wall_cap' });
}
const elapsedMin = Math.round((Date.now() - t0) / 60000);
console.log(`[${cfg.stage}] finished in ${elapsedMin}min${halted ? ` HALTED(${halted}) — resume: re-run the same command` : ''}`);
if (!DRY) {
  try { execFileSync(process.execPath, [join(here, 'report-stage.mjs'), '--config', cfgPath], { stdio: 'inherit' }); } catch (e) { console.error('report generation failed:', e.message); }
}
process.exit(halted ? 3 : 0);
