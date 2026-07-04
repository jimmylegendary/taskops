#!/usr/bin/env node
// Regression (#1 verify-resolver isolation): under --verify-checks the runner executes requiredChecks with a
// DENYLIST-sanitized env — the dangerous ENV-injection vars are dropped (NODE_OPTIONS / NODE_PATH / npm_config_* /
// LD_*/DYLD_* preload / TASKOPS_* leak) so an agent cannot game a check through them, while the REST of the env
// (PATH, HOME, proxies, tokens, tool dirs) and ordinary vars are KEPT so a legitimate check is never spuriously
// failed. It runs in the real cwd so a check that WRITES an artifact stays provenance-verifiable. (A ./.npmrc the
// agent plants in cwd is NOT stripped, and full process sandboxing = containers = documented future work.)
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeRequiredChecks } from '../lib-runner.js';

const ws = mkdtempSync(join(tmpdir(), 'taskops-iso-'));
writeFileSync(join(ws, 'add.js'), 'module.exports = { add: (a, b) => a + b };\n', 'utf8'); // the real change artifact
const st = (cmd, opts) => executeRequiredChecks({ cwd: ws, requiredChecks: [{ command: cmd }], ...opts })[0];

// 1) DANGEROUS env-injection vars are DROPPED under isolation (NODE_OPTIONS / LD_PRELOAD / npm_config_*).
process.env.NODE_OPTIONS = '--title=pwned';
process.env.LD_PRELOAD = '/tmp/evil.so';
process.env.npm_config_registry = 'http://evil';
const danger = 'test -z "$NODE_OPTIONS" && test -z "$LD_PRELOAD" && test -z "$npm_config_registry"';
assert.equal(st(danger).status, 'failed', 'un-isolated: the dangerous vars are present');
const isoDanger = st(danger, { isolate: true });
assert.equal(isoDanger.status, 'passed', 'isolated: NODE_OPTIONS/LD_PRELOAD/npm_config_* are all dropped');
assert.equal(isoDanger.isolated, true, 'isolated results are stamped isolated:true');
delete process.env.NODE_OPTIONS; delete process.env.LD_PRELOAD; delete process.env.npm_config_registry;

// 2) NO FALSE NEGATIVE: an ordinary inherited var (and PATH) is KEPT, so a legitimate check still passes isolated.
process.env.MY_LEGIT_VAR = 'ok';
assert.equal(st('test "$MY_LEGIT_VAR" = "ok"', { isolate: true }).status, 'passed', 'ordinary inherited vars are preserved (no spurious failure)');
delete process.env.MY_LEGIT_VAR;

// 3) a genuine check on the real change still passes isolated (the real PATH reaches node/tools).
assert.equal(st('node -e "if(require(\'./add.js\').add(2,3)!==5)process.exit(1)"', { isolate: true }).status, 'passed', 'PATH is preserved so a genuine node check passes');

// 4) side-effect preservation: isolation runs in the REAL cwd, so a check that WRITES an artifact stays
// provenance-verifiable (this is why isolation sanitizes the env rather than running in a throwaway copy).
assert.equal(st('echo hi > produced.txt', { isolate: true }).status, 'passed');
assert.ok(existsSync(join(ws, 'produced.txt')), 'an isolated check that writes an artifact writes it into the real workspace (provenance intact)');

rmSync(ws, { recursive: true, force: true });
console.log('OK verify-isolation (denylist env: dangerous dropped, legit kept, real-cwd side-effects preserved)');
