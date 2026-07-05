#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const rootPkg = readJson(join(repoRoot, 'package.json'));
const cliPkg = readJson(join(repoRoot, 'cli', 'package.json'));
const pluginPkg = readJson(join(repoRoot, 'obsidian-plugin', 'package.json'));
const pluginManifest = readJson(join(repoRoot, 'obsidian-plugin', 'manifest.json'));
const packageLock = readJson(join(repoRoot, 'package-lock.json'));

const expected = rootPkg.version;
const checks = [
  ['root package', rootPkg.version],
  ['cli package', cliPkg.version],
  ['plugin package', pluginPkg.version],
  ['plugin manifest', pluginManifest.version],
  ['package-lock root', packageLock.version],
  ['package-lock package root', packageLock.packages?.['']?.version],
  ['package-lock cli workspace', packageLock.packages?.cli?.version],
  ['package-lock plugin workspace', packageLock.packages?.['obsidian-plugin']?.version]
];

const mismatches = checks.filter(([, version]) => version !== expected);

if (mismatches.length) {
  console.error(`Version mismatch: expected ${expected}`);
  for (const [label, version] of mismatches) {
    console.error(`- ${label}: ${version}`);
  }
  process.exit(1);
}

console.log(`OK: version sync ${expected}`);
