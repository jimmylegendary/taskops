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
const expectedScripts = {
  build: 'npm run build --workspace cli',
  typecheck: 'npm run typecheck --workspace cli',
  test: 'npm run test --workspace cli',
  'test:repository-scope': 'node ./scripts/check-repository-scope.mjs',
  'test:version-sync': 'node ./scripts/check-version-sync.mjs',
  'test:contract': 'node ./scripts/check-contract-docs.mjs',
  verify: 'npm run test:repository-scope && npm run test:version-sync && npm run test:contract && npm run typecheck && npm run build && npm run test',
};

assert.equal(rootPkg.private, true, 'root package must remain private');
assert.equal(cliPkg.private, true, 'CLI package must be non-publishable');
assert.deepEqual(rootPkg.workspaces, ['cli'], 'only the CLI is an active workspace');
assert.deepEqual(rootPkg.scripts, expectedScripts, 'root scripts must expose only the active core surface');

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
