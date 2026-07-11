#!/usr/bin/env node
// Distribution experiment: does P2/P3 (diff-seeded, inverse-aware quiz) RELIABLY produce a gap-catching quiz vs the
// OLD narrative-only prompt? Isolates the variable P2/P3 changes (quiz generation) from the confound (whether the
// agent under-scopes): the fix is FIXED to the known write-only-incomplete astropy-14182 fix, and we generate N real
// quizzes per arm and measure the DISCRIMINATING-CATCH rate. A quiz "catches" iff it has >=1 probe that FAILS on the
// incomplete fix AND PASSES on the complete fix (so env-broken probes, which fail on both, never count as a catch).
// Hardened: 600s gen timeout + retry-on-empty (gen failures were TIMEOUTS, not prompt/parse), tolerant JSON parse,
// and the empty-after-retries generations are reported SEPARATELY (never scored as a prompt "miss").
//   usage: node p2p3_gaprate.mjs <N> [outfile]
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildComprehensionQuizPrompt } from '/home/jimmy/repos/taskops/cli/lib-runner.js';
import { invokeRuntimeAdapter } from '/home/jimmy/repos/taskops/cli/lib-runtime-adapters.js';

const INCOMPLETE = '/tmp/taskops-sg-astropy__astropy-14182-vj6WKd/work/runs/r1/artifacts/run-node-solve/workspace';
const COMPLETE   = '/tmp/taskops-sg-astropy__astropy-14182-9aHtmP/work/runs/r1/artifacts/run-node-solve/workspace';
const PY = '/tmp/apyenv/bin/python';
const N = Number(process.argv[2] || 8);
const OUT = process.argv[3] || '/tmp/armd3/gaprate2.json';
const GEN_TIMEOUT = 500000, GEN_RETRIES = 2;
const wrapper = '/home/jimmy/repos/personal-assets-vault/taskops-governance/experiments/claude-safe-wrapper.sh';
chmodSync(wrapper, 0o755); process.env.TASKOPS_CLAUDE_BIN = wrapper;

const task = { id: 'solve', title: 'astropy__astropy-14182', objective: 'Support header_rows in RestructuredText (ascii.rst) output, like ascii.fixed_width.' };
const acceptance = { requiredChecks: [{ command: 'bash taskops_verify.sh' }] };

function score(cmd, checkout) {
  let body = cmd.replace(/^\s*cd\s+\S+\s*&&\s*/, '');                 // drop the probe's own leading cd
  body = body.replaceAll('/tmp/apv/bin/python', PY).replaceAll('/tmp/apyenv/bin/python', PY);
  body = body.replace(/(^|&&\s*|;\s*|\|\s*)python3?(?:\.\d+)?(\s+-|\s+<|\s+\/)/g, `$1${PY}$2`);
  const r = spawnSync('bash', ['-c', `cd ${checkout} && ${body}`], { encoding: 'utf8', timeout: 180000 });
  return r.status === 0;
}
function isRead(c) { return /\.read\(|ascii\.read|QTable\.read|Table\.read/.test(c); }
// tolerant parse: strip ```json fences / extract the first {...} block before JSON.parse
function parseProbes(cwd) {
  const p = join(cwd, 'comprehension-quiz.json');
  if (!existsSync(p)) return [];
  let raw = readFileSync(p, 'utf8').trim();
  raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  const tryParse = (s) => { try { const d = JSON.parse(s); return d.probes || (Array.isArray(d) ? d : []); } catch { return null; } };
  let probes = tryParse(raw);
  if (!probes) { const m = raw.match(/\{[\s\S]*\}/); if (m) probes = tryParse(m[0]); }
  return probes || [];
}

// one quiz generation (with retry-on-empty) against a fresh copy of the incomplete checkout, in the chosen prompt mode
function genQuiz(mode, rep) {
  let probes = [], attempts = 0;
  for (attempts = 1; attempts <= GEN_RETRIES; attempts++) {
    const cwd = mkdtempSync(join(tmpdir(), `gaprate-${mode}-${rep}-`));
    cpSync(INCOMPLETE, cwd, { recursive: true });
    try { rmSync(join(cwd, 'comprehension-quiz.json'), { force: true }); } catch {}
    let diffText = '', touchedFiles = '';
    if (mode === 'new') {
      const names = spawnSync('git', ['-C', cwd, 'diff', '--name-only', 'HEAD'], { encoding: 'utf8', timeout: 20000 });
      if (names.status === 0) touchedFiles = String(names.stdout || '').split('\n').filter(Boolean).slice(0, 40).join(', ');
      const diff = spawnSync('git', ['-C', cwd, 'diff', 'HEAD'], { encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
      if (diff.status === 0) diffText = String(diff.stdout || '').split('\n').slice(0, 200).join('\n');
      delete process.env.TASKOPS_QUIZ_LEGACY;
    } else {
      process.env.TASKOPS_QUIZ_LEGACY = '1';
    }
    const prompt = buildComprehensionQuizPrompt({ task, acceptance, cwd, diffText, touchedFiles });
    try { invokeRuntimeAdapter('claude-code', { prompt, agentId: `gaprate-${mode}-${rep}-a${attempts}`, timeoutMs: GEN_TIMEOUT, cwd }); } catch {}
    probes = parseProbes(cwd);
    rmSync(cwd, { recursive: true, force: true });
    if (probes.length > 0) break;
  }
  const nprobes = probes.length;
  if (nprobes === 0) return { mode, rep, nprobes: 0, gen_failed: true, discriminating: 0, anyReadDiscriminating: 0, falseAlarm: 0, caught: null, attempts };
  let discriminating = 0, anyReadDiscriminating = 0, falseAlarm = 0;
  for (const p of probes) {
    const cmd = (p && p.command) || '';
    if (!cmd) continue;
    const failInc = !score(cmd, INCOMPLETE);
    const passComp = score(cmd, COMPLETE);
    if (failInc && passComp) { discriminating += 1; if (isRead(cmd)) anyReadDiscriminating += 1; }
    if (!passComp) falseAlarm += 1;
  }
  return { mode, rep, nprobes, gen_failed: false, discriminating, anyReadDiscriminating, falseAlarm, caught: discriminating > 0, attempts };
}

const results = [];
for (let rep = 1; rep <= N; rep++) {
  for (const mode of ['old', 'new']) {
    const r = genQuiz(mode, rep);
    results.push(r);
    console.log(`rep ${rep} ${mode}: probes=${r.nprobes} attempts=${r.attempts} gen_failed=${r.gen_failed} discriminating=${r.discriminating} read-disc=${r.anyReadDiscriminating} falseAlarm=${r.falseAlarm} CAUGHT=${r.caught}`);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf8');
  }
}
// rate conditioned on SUCCESSFUL generations only (gen failures are infra, not a prompt miss)
const rate = (m) => {
  const ok = results.filter((r) => r.mode === m && !r.gen_failed);
  const failed = results.filter((r) => r.mode === m && r.gen_failed).length;
  return `${ok.filter((r) => r.caught).length}/${ok.length} caught (+${failed} gen-failed excluded)`;
};
console.log(`\n=== GAP-CATCH RATE (fixed incomplete fix, N=${N} reps, conditioned on successful generation) ===`);
console.log(`OLD (narrative-only):      ${rate('old')}`);
console.log(`NEW (diff-seeded+inverse): ${rate('new')}`);
