#!/usr/bin/env node
// Regression (#1 verify-resolver isolation): under --verify-checks the runner executes requiredChecks with a
// SANITIZED environment, so an agent cannot make a check pass via env/preload/path subversion (NODE_OPTIONS,
// NODE_PATH, npm_config_*, LD_PRELOAD, a PATH shim, or a TASKOPS_* leak). It still runs in the real cwd so a
// check that legitimately WRITES an artifact stays provenance-verifiable. (Full process sandboxing / cwd-config
// stripping = documented future work; weak-check gaming is the comprehension-quiz/differential-probe axis.)
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeRequiredChecks } from '../lib-runner.js';

const ws = mkdtempSync(join(tmpdir(), 'taskops-iso-'));
writeFileSync(join(ws, 'add.js'), 'module.exports = { add: (a, b) => a + b };\n', 'utf8'); // the real change artifact

// 1) ENV sanitization: a check keyed on an inherited env var passes UN-isolated, FAILS isolated (env stripped).
process.env.SNEAKY_PASS = '1';
const envCheck = [{ command: 'test "$SNEAKY_PASS" = "1"' }];
assert.equal(executeRequiredChecks({ cwd: ws, requiredChecks: envCheck })[0].status, 'passed', 'un-isolated inherits the env var');
const isoEnv = executeRequiredChecks({ cwd: ws, requiredChecks: envCheck, isolate: true })[0];
assert.equal(isoEnv.status, 'failed', 'isolated run strips the inherited env var — the sneaky check no longer passes');
assert.equal(isoEnv.isolated, true, 'isolated results are stamped isolated:true');
delete process.env.SNEAKY_PASS;

// 2) NODE_OPTIONS injection (a potent preload vector) is neutralized: it is dropped from the sanitized env.
process.env.NODE_OPTIONS = '--title=pwned';
const noCheck = [{ command: 'node -e "process.exit(process.env.NODE_OPTIONS?1:0)"' }];
assert.equal(executeRequiredChecks({ cwd: ws, requiredChecks: noCheck, isolate: true })[0].status, 'passed', 'NODE_OPTIONS is dropped from the isolated env');
delete process.env.NODE_OPTIONS;

// 3) a genuine check on the real change still passes isolated (the artifact is right there in the real cwd).
const realCheck = [{ command: 'node -e "if(require(\'./add.js\').add(2,3)!==5)process.exit(1)"' }];
assert.equal(executeRequiredChecks({ cwd: ws, requiredChecks: realCheck, isolate: true })[0].status, 'passed', 'a genuine check on the change passes under the sanitized env');

// 4) side-effect preservation: isolation runs in the REAL cwd, so a check that WRITES an artifact is still
// provenance-verifiable (this is why isolation sanitizes the env rather than running in a throwaway copy).
assert.equal(executeRequiredChecks({ cwd: ws, requiredChecks: [{ command: 'echo hi > produced.txt' }], isolate: true })[0].status, 'passed');
assert.ok(existsSync(join(ws, 'produced.txt')), 'an isolated check that writes an artifact writes it into the real workspace (provenance intact)');

rmSync(ws, { recursive: true, force: true });
console.log('OK verify-isolation (sanitized env; real-cwd side-effects preserved)');
