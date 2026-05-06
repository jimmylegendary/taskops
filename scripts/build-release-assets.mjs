#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const packageVersion = spawn('node', ['-p', "require('./package.json').version"], { capture: true }).stdout.trim();
const version = process.env.TASKOPS_RELEASE_VERSION || packageVersion;
if (!version) {
  console.error('Unable to determine release version');
  process.exit(1);
}
if (process.env.TASKOPS_RELEASE_VERSION && process.env.TASKOPS_RELEASE_VERSION !== packageVersion) {
  console.error(`Release version mismatch: package.json is ${packageVersion} but TASKOPS_RELEASE_VERSION is ${process.env.TASKOPS_RELEASE_VERSION}`);
  process.exit(1);
}
const distDir = join(repoRoot, 'dist', 'release', `v${version}`);

function spawn(cmd, args, options = {}) {
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

function outputPath(name) {
  return join(distDir, name);
}

function requireCommand(cmd) {
  const res = spawnSync('bash', ['-lc', `command -v ${cmd}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  if (res.status !== 0) {
    console.error(`Missing required command: ${cmd}`);
    process.exit(1);
  }
}

for (const cmd of ['node', 'npm', 'python3', 'zip']) {
  requireCommand(cmd);
}

const npmRoot = spawn('npm', ['root', '-g'], { capture: true }).stdout.trim();
const packager = join(npmRoot, 'openclaw', 'skills', 'skill-creator', 'scripts', 'package_skill.py');
if (!existsSync(packager)) {
  console.error(`Missing skill packager at ${packager}`);
  process.exit(1);
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

spawn('npm', ['run', 'verify']);
spawn('npm', ['pack', './cli', '--pack-destination', distDir]);
spawn('npm', ['run', 'build'], { cwd: join(repoRoot, 'obsidian-plugin') });
spawn('zip', ['-j', outputPath(`taskops-obsidian-v${version}.zip`), 'main.js', 'manifest.json', 'styles.css'], {
  cwd: join(repoRoot, 'obsidian-plugin')
});
spawn('python3', [packager, 'skill', distDir]);
const skillAsset = readdirSync(distDir).find((name) => name.endsWith('.skill'));
if (!skillAsset) {
  console.error('Skill packager did not produce a .skill artifact');
  process.exit(1);
}
const expectedAssets = [
  `taskops-${version}.tgz`,
  `taskops-obsidian-v${version}.zip`,
  `taskops-skill-v${version}.skill`
];
if (skillAsset !== expectedAssets[2]) {
  renameSync(outputPath(skillAsset), outputPath(expectedAssets[2]));
}
const actualAssets = readdirSync(distDir).filter((name) => !name.startsWith('.')).sort();
const missingAssets = expectedAssets.filter((name) => !actualAssets.includes(name));
if (missingAssets.length) {
  console.error(`Missing expected release assets in ${distDir}:`);
  for (const name of missingAssets) console.error(`- ${name}`);
  process.exit(1);
}
if (actualAssets.length !== expectedAssets.length) {
  console.error(`Unexpected release asset set in ${distDir}: ${actualAssets.join(', ')}`);
  process.exit(1);
}

console.log(`Built release assets in ${distDir}`);
