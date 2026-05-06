#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...options
  });
  if (res.status !== 0) {
    if (options.capture) {
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
    }
    process.exit(res.status ?? 1);
  }
  return res;
}

const version = run('node', ['-p', "require('./package.json').version"], { capture: true }).stdout.trim();
if (!version) {
  console.error('Unable to determine package version');
  process.exit(1);
}

const artifactPath = join(repoRoot, 'dist', 'release', `v${version}`, `taskops-${version}.tgz`);
if (!existsSync(artifactPath)) {
  console.error(`Missing built CLI artifact: ${artifactPath}`);
  console.error('Run `npm run build:release` first, or use `npm run release:preflight` for the full local release rehearsal.');
  process.exit(1);
}

run('npm', ['publish', '--dry-run', artifactPath, '--access', 'public']);
console.log(`OK: artifact publish dry-run passed for taskops-${version}.tgz`);
