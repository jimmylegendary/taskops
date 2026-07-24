#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { fmBlock } from '../lib-taskops.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-json-lifecycle-'));

function writeMd(path, fm) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fmBlock(fm) + `# ${fm.id}\n`, 'utf8');
}

function seedLargeShowWork() {
  const workDir = join(tempRoot, 'large-work');
  const now = '2026-07-25T00:00:00.000Z';
  const versionDir = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1');
  const runRefs = Array.from({ length: 500 }, (_, index) => ({
    runId: 'run-main',
    runNodeId: `run-node-large-${String(index).padStart(3, '0')}`,
    role: 'execution_observation',
  }));
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id: 'large-work',
    title: 'Large JSON work',
    objective: 'Exercise complete machine output.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'task-groups', 'tg-root', 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Exercise output.',
    activeVersionId: 'tgv-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(versionDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    version: 'v1',
    summary: 'Large output fixture.',
    selected: true,
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'snapshots', 'snapshot-root-v1.md'), {
    taskOpsVersion: 'v1',
    entityType: 'versionSnapshot',
    id: 'snapshot-root-v1',
    rootTaskGroupId: 'tg-root',
    createdAt: now,
    label: 'Root',
    status: 'active',
    selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }],
  });
  writeMd(join(versionDir, 'tasks', 'large.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'large',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Large task',
    objective: 'Keep 500 observations visible.',
    responsibility: 'Own the output fixture.',
    completionCriteria: 'Every run node is serialized.',
    order: 1,
    createdAt: now,
    status: 'pending',
    runReadiness: 'runnable',
    understandingLevel: 'known',
    runRefs,
  });
  writeMd(join(workDir, 'runs', 'run-main', 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'run',
    id: 'run-main',
    workId: 'large-work',
    createdAt: now,
    status: 'active',
  });
  for (let index = 0; index < 500; index += 1) {
    const id = `run-node-large-${String(index).padStart(3, '0')}`;
    writeMd(join(workDir, 'runs', 'run-main', 'nodes', `${id}.md`), {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id,
      runId: 'run-main',
      type: 'implementation',
      actionKind: 'execute',
      attempt: index + 1,
      title: `${id}-${'x'.repeat(256)}`,
      sourceTaskId: 'large',
      sourceTaskGroupVersionId: 'tgv-root-v1',
      status: 'active',
      createdAt: now,
    });
  }
  return workDir;
}

function collectChild(child) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    }));
  });
}

const workDir = seedLargeShowWork();

const direct = spawnSync(process.execPath, [cli, 'show', workDir, '--json'], {
  encoding: null,
  maxBuffer: 16 * 1024 * 1024,
});
assert.equal(direct.status, 0);
assert.ok(direct.stdout.length > 64 * 1024);
assert.equal(direct.stdout.at(-1), 0x0a);
const directJson = JSON.parse(direct.stdout.toString('utf8'));
assert.equal(directJson.runNodes.length, 500);

const outputPath = join(tempRoot, 'redirected.json');
const fd = openSync(outputPath, 'w');
const redirected = spawnSync(process.execPath, [cli, 'show', workDir, '--json'], {
  stdio: ['ignore', fd, 'pipe'],
});
closeSync(fd);
assert.equal(redirected.status, 0);
assert.deepEqual(readFileSync(outputPath), direct.stdout);

const producer = spawn(process.execPath, [cli, 'show', workDir, '--json'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const consumer = spawn(process.execPath, ['-e', `
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => process.stdout.write(Buffer.concat(chunks)));
`], { stdio: ['pipe', 'pipe', 'pipe'] });
const producerDone = collectChild(producer);
const consumerDone = collectChild(consumer);
producer.stdout.pipe(consumer.stdin);
const [produced, piped] = await Promise.all([producerDone, consumerDone]);
assert.equal(produced.code, 0);
assert.equal(piped.code, 0);
assert.deepEqual(piped.stdout, direct.stdout);
assert.equal(JSON.parse(piped.stdout.toString('utf8')).runNodes.length, 500);

const cliSource = readFileSync(cli, 'utf8');
assert.equal(cliSource.includes('process.exit('), false);

const { writeJson } = await import('../bin/taskops.js');
const stream = new PassThrough();
const serialized = [];
stream.on('data', (chunk) => serialized.push(chunk));
await writeJson({ count: 500 }, stream);
stream.end();
assert.equal(Buffer.concat(serialized).toString('utf8'), '{\n  "count": 500\n}\n');

const failure = spawnSync(process.execPath, [cli, 'show', join(tempRoot, 'missing'), '--json'], {
  encoding: 'utf8',
});
assert.notEqual(failure.status, 0);
assert.equal(failure.stdout, '');
assert.match(failure.stderr, /Path not found/);
rmSync(tempRoot, { recursive: true, force: true });
console.log('OK JSON stdout lifecycle');
