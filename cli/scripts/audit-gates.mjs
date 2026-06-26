#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { auditParsedWork } from '../lib-audit.js';
import { fmBlock, parseProject } from '../lib-taskops.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-audit-gates-'));
const now = '2026-06-26T00:00:00.000Z';

function writeMd(path, fm, body = '') {
  writeFileSync(path, fmBlock(fm) + (body || `# ${fm.id}\n`), 'utf8');
}

function ensureDirs(workDir) {
  for (const dir of [
    'task-groups/tg-root/versions/tgv-root-v1/tasks',
    'task-groups/tg-root/versions/tgv-root-v1/eow',
    'snapshots',
    'runs/run-main/nodes',
    'runs/run-main/edges',
    '.taskops',
  ]) {
    mkdirSync(join(workDir, dir), { recursive: true });
  }
}

function writeTask(workDir, order) {
  const id = `task-0${order}`;
  writeMd(join(workDir, 'task-groups/tg-root/versions/tgv-root-v1/tasks', `${id}.md`), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id,
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: `Task ${order}`,
    objective: `Complete part ${order} of the MVP.`,
    responsibility: `Own part ${order}.`,
    completionCriteria: 'Artifact and EoW exist.',
    order,
    createdAt: now,
    status: 'done',
    runReadiness: 'runnable',
    understandingLevel: 'known',
    runRefs: order === 1 ? [{ runId: 'run-main', runNodeId: 'run-node-task-01', role: 'primary_execution' }] : [],
  });
  writeMd(join(workDir, 'task-groups/tg-root/versions/tgv-root-v1/eow', `eow-${id}.md`), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: `eow-${id}`,
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: id,
    taskGroupVersionId: 'tgv-root-v1',
    reason: order === 1 ? 'manual_verified' : 'execution_path_closed',
    declaredBy: order === 1 ? 'taskops-close' : 'test',
    declaredAt: now,
    createdAt: now,
    status: 'done',
  });
}

function writeQueueDb(workDir) {
  const db = new DatabaseSync(join(workDir, '.taskops', 'queue.sqlite'));
  db.exec(`
    CREATE TABLE queue_items (
      id TEXT PRIMARY KEY,
      work_root TEXT NOT NULL,
      task_id TEXT NOT NULL,
      run_id TEXT,
      readiness TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      blocked_reason TEXT,
      md_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE leases (
      id TEXT PRIMARY KEY,
      queue_item_id TEXT NOT NULL,
      runner_id TEXT NOT NULL,
      status TEXT NOT NULL,
      leased_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE runner_attempts (
      id TEXT PRIMARY KEY,
      queue_item_id TEXT NOT NULL,
      lease_id TEXT,
      runner_id TEXT NOT NULL,
      runtime_adapter TEXT NOT NULL,
      md_fingerprint TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      run_id TEXT,
      stop_reason TEXT,
      error_summary TEXT
    );
  `);
  db.prepare(`
    INSERT INTO queue_items (id, work_root, task_id, run_id, readiness, status, priority, blocked_reason, md_fingerprint, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 'runnable', 'active', 0, NULL, 'fingerprint', ?, ?)
  `).run('tgv-root-v1:task-01', workDir, 'task-01', now, now);
  db.prepare(`
    INSERT INTO leases (id, queue_item_id, runner_id, status, leased_at, heartbeat_at, expires_at, attempt)
    VALUES ('lease-task-01', 'tgv-root-v1:task-01', 'runner', 'active', ?, ?, ?, 1)
  `).run(now, now, '2026-06-27T00:00:00.000Z');
  db.prepare(`
    INSERT INTO runner_attempts (id, queue_item_id, lease_id, runner_id, runtime_adapter, md_fingerprint, status, started_at)
    VALUES ('attempt-task-01', 'tgv-root-v1:task-01', 'lease-task-01', 'runner', 'codex-cli', 'fingerprint', 'running', ?)
  `).run(now);
  db.close();
}

function makeProblemWork() {
  const workDir = join(tempRoot, 'audit-problem-work');
  ensureDirs(workDir);
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id: 'audit-problem-work',
    title: 'Paper Control Plane MVP',
    objective: 'Build a modular Next.js paper control-plane MVP with adapters, verifier, dashboard, and docs.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v1',
    createdAt: now,
    status: 'done',
  });
  writeMd(join(workDir, 'task-groups/tg-root/index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Depth-1 implementation checklist.',
    activeVersionId: 'tgv-root-v1',
    createdAt: now,
    status: 'done',
  });
  writeMd(join(workDir, 'task-groups/tg-root/versions/tgv-root-v1/index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    version: 'v1',
    summary: 'Seven flat MVP tasks.',
    selected: true,
    createdAt: now,
    status: 'done',
  });
  writeMd(join(workDir, 'snapshots/snapshot-root-v1.md'), {
    taskOpsVersion: 'v1',
    entityType: 'versionSnapshot',
    id: 'snapshot-root-v1',
    rootTaskGroupId: 'tg-root',
    createdAt: now,
    label: 'Root',
    status: 'active',
    selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }],
  });
  for (let i = 1; i <= 7; i += 1) writeTask(workDir, i);
  writeMd(join(workDir, 'runs/run-main/index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'run',
    id: 'run-main',
    workId: 'audit-problem-work',
    createdAt: now,
    status: 'done',
  });
  writeMd(join(workDir, 'runs/run-main/nodes/run-node-task-01.md'), {
    taskOpsVersion: 'v1',
    entityType: 'runNode',
    id: 'run-node-task-01',
    runId: 'run-main',
    type: 'implementation',
    title: 'Manual-verified task node',
    sourceTaskId: 'task-01',
    sourceTaskGroupVersionId: 'tgv-root-v1',
    status: 'done',
    createdAt: now,
  });
  writeMd(join(workDir, 'runs/run-main/nodes/eow-run-node-task-01.md'), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: 'eow-run-node-task-01',
    runId: 'run-main',
    graphType: 'run',
    attachedToType: 'runNode',
    attachedToId: 'run-node-task-01',
    reason: 'manual_verified',
    declaredBy: 'taskops-close',
    declaredAt: now,
    createdAt: now,
    status: 'done',
  });
  writeQueueDb(workDir);
  return workDir;
}

try {
  const workDir = makeProblemWork();
  const parsed = parseProject(workDir);
  assert.deepEqual(parsed.errors, []);

  const audit = auditParsedWork(parsed);
  assert.equal(audit.claimSafe, false);
  assert.ok(audit.issues.some((item) => item.code === 'complex_objective_flat_decomposition' && item.severity === 'error'));
  assert.ok(audit.issues.some((item) => item.code === 'manual_attestation_present' && item.severity === 'error'));
  assert.ok(audit.issues.some((item) => item.code === 'closed_markdown_active_lease_or_attempt' && item.severity === 'error'));

  const strict = spawnSync(process.execPath, [new URL('../bin/taskops.js', import.meta.url).pathname, 'audit', workDir, '--strict', '--json'], { encoding: 'utf8' });
  assert.notEqual(strict.status, 0);
  const strictJson = JSON.parse(strict.stdout);
  assert.equal(strictJson.claimSafe, false);

  const loose = spawnSync(process.execPath, [new URL('../bin/taskops.js', import.meta.url).pathname, 'audit', workDir, '--json'], { encoding: 'utf8' });
  assert.equal(loose.status, 0);
  assert.equal(JSON.parse(loose.stdout).claimSafe, false);

  console.log('audit-gates smoke passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
