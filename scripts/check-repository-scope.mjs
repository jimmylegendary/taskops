#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'));
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const rootPkg = readJson('package.json');
const cliPkg = readJson('cli/package.json');
const lock = readJson('package-lock.json');

assert.equal(rootPkg.private, true, 'root package must remain private');
assert.equal(cliPkg.private, true, 'CLI package must be non-publishable');
assert.deepEqual(rootPkg.workspaces, ['cli'], 'only the CLI is an active workspace');

for (const name of ['build:release', 'release:preflight', 'smoke:publish-artifact']) {
  assert.equal(rootPkg.scripts[name], undefined, `${name} must not be active`);
}
assert.equal(rootPkg.scripts.verify.startsWith('npm run test:repository-scope'), true);

assert.ok(lock.packages?.cli, 'lockfile must contain the CLI workspace');
assert.equal(lock.packages?.['obsidian-plugin'], undefined);
assert.equal(lock.packages?.['node_modules/taskops-obsidian'], undefined);

assert.equal(existsSync(join(repoRoot, 'obsidian-plugin')), true, 'preserved source must remain present');
assert.equal(existsSync(join(repoRoot, '.github/workflows/release.yml')), false);
assert.equal(existsSync(join(repoRoot, 'scripts/build-release-assets.mjs')), false);
assert.equal(existsSync(join(repoRoot, 'scripts/smoke-publish-artifact.mjs')), false);

const ci = read('.github/workflows/ci.yml');
assert.match(ci, /\bpush:/);
assert.match(ci, /\bpull_request:/);
assert.match(ci, /node-version:\s*['"]?22/);
assert.match(ci, /npm ci/);
assert.match(ci, /npm run verify/);
for (const forbidden of [/npm publish/i, /clawhub/i, /refs\/tags/i, /release asset/i, /obsidian-plugin/i]) {
  assert.equal(forbidden.test(ci), false, `CI contains inactive behavior: ${forbidden}`);
}

console.log('OK repository scope');
