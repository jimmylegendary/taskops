#!/usr/bin/env node
// Regression: heartbeatLease must NOT expire its own lease. Before the fix it called
// expireStaleLeases(db, now) with no excludeLeaseIds, so a heartbeat arriving just after
// its own expires_at would mark its lease 'stale' and throw — letting a second worker
// re-claim and DOUBLE-EXECUTE a still-running task. A heartbeat renews its OWN lease.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fmBlock } from '../lib-taskops.js';
import { heartbeatLease } from '../lib-queue.js';

const now = '2026-06-26T00:00:00.000Z';
const past = '2020-01-01T00:00:00.000Z'; // lease already past its expires_at
const dir = mkdtempSync(join(tmpdir(), 'taskops-heartbeat-'));
const workDir = join(dir, 'work');
const md = (p, fm) => writeFileSync(join(workDir, p), `${fmBlock(fm)}# ${fm.id}\n`, 'utf8');

for (const d of ['task-groups/tg-root/versions/tgv-root-v1/tasks', 'snapshots', '.taskops']) {
  mkdirSync(join(workDir, d), { recursive: true });
}
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'hb-work', title: 'HB', objective: 'x', activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/versions/tgv-root-v1/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 'one task', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'Root', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });
md('task-groups/tg-root/versions/tgv-root-v1/tasks/task-01.md', { taskOpsVersion: 'v1', entityType: 'task', id: 'task-01', taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1', title: 'T1', objective: 'x', responsibility: 'own it', completionCriteria: 'done', order: 1, createdAt: now, status: 'pending', runReadiness: 'runnable', understandingLevel: 'known' });

// queue db with one ACTIVE lease that is already past its expires_at
const db = new DatabaseSync(join(workDir, '.taskops', 'queue.sqlite'));
db.exec(`
  CREATE TABLE queue_items (id TEXT PRIMARY KEY, work_root TEXT NOT NULL, task_id TEXT NOT NULL, run_id TEXT, readiness TEXT NOT NULL, status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, blocked_reason TEXT, md_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE leases (id TEXT PRIMARY KEY, queue_item_id TEXT NOT NULL, runner_id TEXT NOT NULL, status TEXT NOT NULL, leased_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, expires_at TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE runner_attempts (id TEXT PRIMARY KEY, queue_item_id TEXT NOT NULL, lease_id TEXT, runner_id TEXT NOT NULL, runtime_adapter TEXT NOT NULL, md_fingerprint TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, run_id TEXT, stop_reason TEXT, error_summary TEXT);
`);
db.prepare(`INSERT INTO queue_items VALUES ('tgv-root-v1:task-01', ?, 'task-01', NULL, 'runnable', 'active', 0, NULL, 'fp', ?, ?)`).run(workDir, now, now);
db.prepare(`INSERT INTO leases VALUES ('lease-task-01', 'tgv-root-v1:task-01', 'runner', 'active', ?, ?, ?, 1)`).run(now, now, past);
db.close();

// A heartbeat on a lease that just passed its own expiry must RENEW it, not self-expire+throw.
const { lease } = heartbeatLease(workDir, 'lease-task-01', { ttlSeconds: 300 });
assert.equal(lease.status, 'active', 'heartbeat must keep its own lease active, not mark it stale');
assert.ok(Date.parse(lease.expires_at) > Date.parse(past), 'heartbeat must extend its own expiry');

rmSync(dir, { recursive: true, force: true });
console.log('OK heartbeat self-lease');
