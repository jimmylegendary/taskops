#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = join(new URL('..', import.meta.url).pathname, 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-smoke-'));
const projectDir = join(tempRoot, 'demo-project');
const vaultDir = join(tempRoot, 'vault');
const remoteBareDir = join(tempRoot, 'vault-remote.git');

function run(args, expected = 0) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  if (res.status !== expected) {
    console.error('CMD FAILED', args.join(' '));
    console.error(res.stdout);
    console.error(res.stderr);
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(1);
  }
  return res;
}

run(['init', projectDir, '--id', 'demo-project', '--title', 'Demo Project', '--objective', 'Smoke test the TaskOps CLI', '--language', 'ko']);
const rootVersionIndex = readFileSync(join(projectDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'index.md'), 'utf8');
if (!rootVersionIndex.includes('summary: 초기 루트 분해')) {
  console.error('init did not write the expected localized version summary');
  console.error(rootVersionIndex);
  process.exit(1);
}
const specPath = join(tempRoot, 'spec.json');
writeFileSync(specPath, JSON.stringify({
  versionId: 'tgv-root-v2',
  version: 'v2',
  summary: 'Second decomposition',
  selected: true,
  tasks: [
    {
      id: 'task-alpha',
      title: 'Alpha task',
      objective: 'Do alpha',
      responsibility: 'Own alpha',
      completionCriteria: 'Alpha done',
      status: 'active'
    }
  ]
}, null, 2));
run(['decompose', projectDir, '--task-group-id', 'tg-root', '--spec', specPath]);
run(['validate', projectDir]);
const summary = run(['summary', projectDir]).stdout;
if (!summary.includes('Demo Project') || !summary.includes('task-alpha') || !summary.includes('- Project objective: Smoke test the TaskOps CLI') || !summary.includes('## Selected version') || !summary.includes('초기 루트 분해')) {
  console.error('Unexpected summary output');
  console.error(summary);
  process.exit(1);
}
run(['show', projectDir, '--json']);
run(['summary', projectDir, '--write']);
const summaryFile = readFileSync(join(projectDir, 'summary.md'), 'utf8');
if (!summaryFile.includes('## Task groups')) {
  console.error('summary.md missing expected content');
  process.exit(1);
}

run(['vault-init', vaultDir, '--branch', 'main', '--language', 'ko']);
const initialSyncConfig = JSON.parse(readFileSync(join(vaultDir, '.taskops', 'taskops-sync.json'), 'utf8'));
if (initialSyncConfig.language !== 'ko') {
  console.error('taskops-sync.json missing expected language setting');
  console.error(initialSyncConfig);
  process.exit(1);
}
spawnSync('git', ['config', 'user.name', 'TaskOps Smoke'], { cwd: vaultDir, encoding: 'utf8' });
spawnSync('git', ['config', 'user.email', 'smoke@example.com'], { cwd: vaultDir, encoding: 'utf8' });
spawnSync('git', ['init', '--bare', remoteBareDir], { encoding: 'utf8' });
run(['vault-init', vaultDir, '--repo-url', remoteBareDir, '--branch', 'main', '--auto-sync', 'true', '--language', 'ko']);
writeFileSync(join(vaultDir, 'README.md'), '# Vault smoke\n');
run(['git-sync', vaultDir, '--message', 'Initial vault sync']);
const gitStatus = JSON.parse(run(['git-status', vaultDir]).stdout);
if (!gitStatus.remoteUrl || gitStatus.sync !== 'in-sync') {
  console.error('Vault git sync did not reach in-sync state');
  console.error(gitStatus);
  process.exit(1);
}

rmSync(tempRoot, { recursive: true, force: true });
console.log('OK: taskops CLI smoke passed');
