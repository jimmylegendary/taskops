import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  classifyTaskReadiness,
  discoverProjects,
  parseProject,
} from './lib-taskops.js';
import {
  queueItemStaleMarkerSql,
  queueItemUpsertSql,
  writeLeaseHeartbeatRow,
  writeLeaseInsertRow,
  writeProgressReportRow,
} from './lib-queue-writer.js';

export const QUEUE_DB_RELATIVE_PATH = join('.taskops', 'queue.sqlite');

const queueWriterIo = {
  runPreparedStatement(db, sql, params) {
    db.prepare(sql).run(...params);
  },
};

function isoNow() {
  return new Date().toISOString();
}

function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, Math.floor(ms));
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function taskFingerprint(task) {
  const body = existsSync(task.path) ? readFileSync(task.path, 'utf8') : '';
  return sha256(JSON.stringify({
    path: task.path,
    taskGroupVersionId: task.taskGroupVersionId,
    id: task.id,
    body,
  }));
}

export function openQueueDb(projectDir) {
  const dbPath = join(projectDir, QUEUE_DB_RELATIVE_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS queue_items (
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

    CREATE TABLE IF NOT EXISTS leases (
      id TEXT PRIMARY KEY,
      queue_item_id TEXT NOT NULL,
      runner_id TEXT NOT NULL,
      status TEXT NOT NULL,
      leased_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(queue_item_id) REFERENCES queue_items(id)
    );

    CREATE TABLE IF NOT EXISTS runner_attempts (
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
      error_summary TEXT,
      FOREIGN KEY(queue_item_id) REFERENCES queue_items(id)
    );

    CREATE TABLE IF NOT EXISTS progress_reports (
      id TEXT PRIMARY KEY,
      work_root TEXT NOT NULL,
      work_id TEXT NOT NULL,
      queue_item_id TEXT,
      task_id TEXT,
      wave_id TEXT NOT NULL,
      master_session_key TEXT,
      report_sink TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      error_summary TEXT
    );
  `);
  ensureColumn(db, 'runner_attempts', 'md_fingerprint', 'TEXT');
  return { db, dbPath };
}

function ensureColumn(db, table, column, ddl) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all()
    .some((row) => row.name === column);
  if (!existing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

function isTransientRunGraphError(error) {
  const message = String(error || '');
  return message.includes('/runs/') && (
    message.includes('not found')
    || message.includes('missing index.md')
    || message.includes('duplicate run')
    || message.includes('duplicate EoW')
  );
}

function parseSingleProject(workDir) {
  const workRoot = resolve(workDir);
  const projects = discoverProjects(workRoot);
  if (projects.length !== 1) throw new Error(`Expected exactly 1 TaskOps work under ${workDir}, found ${projects.length}`);
  const projectDir = projects[0];
  let parsed = parseProject(projectDir);
  for (let attempt = 0; parsed.errors.length > 0 && attempt < 5; attempt += 1) {
    if (!parsed.errors.every(isTransientRunGraphError)) break;
    sleepMs(25 * (attempt + 1));
    parsed = parseProject(projectDir);
  }
  if (parsed.errors.length > 0) throw new Error(`TaskOps work has validation errors; cannot sync queue:\n- ${parsed.errors.join('\n- ')}`);
  return { projectDir, parsed };
}

function selectedTasks(parsed) {
  const activeSnapshot = parsed.project.activeSnapshotId ? parsed.snapshots.get(parsed.project.activeSnapshotId) : null;
  const selectedVersionIds = new Set();
  if (activeSnapshot && Array.isArray(activeSnapshot.selectedVersions)) {
    for (const entry of activeSnapshot.selectedVersions) {
      if (entry?.versionId) selectedVersionIds.add(entry.versionId);
    }
  }
  const tasks = [...parsed.tasks.values()];
  if (selectedVersionIds.size === 0) return tasks;
  return tasks.filter((task) => selectedVersionIds.has(task.taskGroupVersionId));
}

function queueRowFromTask(projectDir, parsed, task, now) {
  const classification = classifyTaskReadiness(task);
  let status = task.status || 'pending';
  let readiness = classification.runReadiness || task.runReadiness || 'blocked';
  let dependencyBlockReason = null;
  if (!['done', 'cancelled'].includes(status)) {
    const unresolved = unresolvedBlockers(parsed, task);
    if (unresolved.length > 0) {
      status = 'blocked';
      readiness = 'blocked';
      dependencyBlockReason = unresolved.join('; ');
    }
  }
  const priority = Number.isFinite(Number(task.priority)) ? Number(task.priority) : 0;
  return {
    id: `${task.taskGroupVersionId}:${task.id}`,
    work_root: projectDir,
    task_id: task.id,
    run_id: null,
    readiness,
    status,
    priority,
    blocked_reason: status === 'blocked' || readiness === 'blocked'
      ? (dependencyBlockReason || classification.reason || task.runReadinessReason || null)
      : null,
    md_fingerprint: taskFingerprint(task),
    created_at: now,
    updated_at: now,
    work_id: parsed.project.id,
    task_group_version_id: task.taskGroupVersionId,
    title: task.title || task.id,
  };
}

function normalizeBlockedBy(task) {
  if (!task.blockedBy) return [];
  return Array.isArray(task.blockedBy) ? task.blockedBy : [task.blockedBy];
}

function unresolvedBlockers(parsed, task) {
  const blockers = normalizeBlockedBy(task);
  if (blockers.length === 0) return [];
  const unresolved = [];
  for (const ref of blockers) {
    if (!ref || typeof ref !== 'object') {
      unresolved.push('Invalid blocker reference.');
      continue;
    }
    if (ref.type === 'task') {
      const id = ref.id || ref.taskId;
      const matches = [...parsed.tasks.values()].filter((candidate) => (
        candidate.id === id
        && (!ref.taskGroupVersionId || candidate.taskGroupVersionId === ref.taskGroupVersionId)
      ));
      if (matches.length === 0) unresolved.push(`Task blocker '${id}' not found.`);
      else {
        const open = matches.filter((candidate) => !['done', 'cancelled'].includes(candidate.status));
        if (open.length > 0) unresolved.push(`Task blocker '${id}' is ${open.map((candidate) => candidate.status).join('/')}.`);
      }
      continue;
    }
    if (ref.type === 'runNode') {
      const id = ref.id || ref.runNodeId;
      const key = `${ref.runId}:${id}`;
      const node = parsed.runNodes.get(key);
      if (!node) unresolved.push(`Run node blocker '${key}' not found.`);
      else if (!['done', 'cancelled'].includes(node.status)) unresolved.push(`Run node blocker '${key}' is ${node.status}.`);
      continue;
    }
    unresolved.push(`Unsupported blocker type '${ref.type || 'unknown'}'.`);
  }
  return unresolved;
}

function readQueueRows(db) {
  return db.prepare(`
    SELECT id, work_root, task_id, run_id, readiness, status, priority, blocked_reason,
           md_fingerprint, created_at, updated_at,
           (
             SELECT COUNT(*)
             FROM runner_attempts ra
             WHERE ra.queue_item_id = queue_items.id
               AND ra.status = 'failed'
               AND COALESCE(ra.md_fingerprint, queue_items.md_fingerprint) = queue_items.md_fingerprint
           ) AS failed_attempts
    FROM queue_items
    WHERE status != 'stale_projection'
    ORDER BY priority DESC, id ASC
  `).all();
}

function readLease(db, leaseId) {
  return db.prepare(`
    SELECT id, queue_item_id, runner_id, status, leased_at, heartbeat_at, expires_at, attempt
    FROM leases
    WHERE id = ?
  `).get(leaseId) || null;
}

function expireStaleLeases(db, now, { excludeLeaseIds = [] } = {}) {
  const excluded = new Set((excludeLeaseIds || []).filter(Boolean).map(String));
  const staleLeases = db.prepare(`
    SELECT id, queue_item_id, runner_id, expires_at
    FROM leases
    WHERE status = 'active'
      AND expires_at <= ?
  `).all(now);
  const expirableLeases = staleLeases.filter((lease) => !excluded.has(String(lease.id)));
  if (expirableLeases.length === 0) return [];

  const markLeaseStale = db.prepare(`
    UPDATE leases
    SET status = 'stale',
        heartbeat_at = ?
    WHERE id = ?
  `);
  const markAttemptFailed = db.prepare(`
    UPDATE runner_attempts
    SET status = 'failed',
        finished_at = COALESCE(finished_at, ?),
        stop_reason = COALESCE(stop_reason, 'stale_lease'),
        error_summary = COALESCE(error_summary, ?)
    WHERE lease_id = ?
      AND status = 'running'
  `);

  for (const lease of expirableLeases) {
    markLeaseStale.run(now, lease.id);
    markAttemptFailed.run(
      now,
      `Lease ${lease.id} expired at ${lease.expires_at} before runner completion.`,
      lease.id,
    );
  }
  return expirableLeases;
}

function leaseTtlSeconds(value) {
  if (value == null) return 300;
  const ttl = Number(value);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error(`Invalid lease TTL seconds: ${value}`);
  return ttl;
}

function maxAttemptsValue(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid max attempts: ${value}`);
  if (n === 0) return null;
  return Math.floor(n);
}

function isoPlusSeconds(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export function syncQueueProjection(workDir) {
  const { projectDir, parsed } = parseSingleProject(workDir);
  const { db, dbPath } = openQueueDb(projectDir);
  const now = isoNow();
  const rows = selectedTasks(parsed).map((task) => queueRowFromTask(projectDir, parsed, task, now));

  const upsert = db.prepare(queueItemUpsertSql());
  const markMissing = db.prepare(queueItemStaleMarkerSql(rows.length));

  db.exec('BEGIN IMMEDIATE');
  try {
    expireStaleLeases(db, now);
    for (const row of rows) {
      upsert.run(
        row.id,
        row.work_root,
        row.task_id,
        row.run_id,
        row.readiness,
        row.status,
        row.priority,
        row.blocked_reason,
        row.md_fingerprint,
        row.created_at,
        row.updated_at,
      );
    }
    if (rows.length > 0) markMissing.run(now, ...rows.map((row) => row.id));
    else markMissing.run(now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const syncedRows = readQueueRows(db);
  db.close();
  return {
    projectDir,
    workId: parsed.project.id,
    dbPath,
    synced: syncedRows.length,
    rows: syncedRows,
  };
}

export function listQueueProjection(workDir) {
  const { projectDir, parsed } = parseSingleProject(workDir);
  const { db, dbPath } = openQueueDb(projectDir);
  const now = isoNow();
  db.exec('BEGIN IMMEDIATE');
  try {
    expireStaleLeases(db, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const rows = readQueueRows(db);
  db.close();
  return {
    projectDir,
    workId: parsed.project.id,
    dbPath,
    rows,
  };
}

export function claimQueueItem(workDir, { runnerId = 'local-runner', ttlSeconds = 300, maxAttempts = null } = {}) {
  const synced = syncQueueProjection(workDir);
  const { db, dbPath } = openQueueDb(synced.projectDir);
  const now = isoNow();
  const ttl = leaseTtlSeconds(ttlSeconds);
  const maxAttemptsLimit = maxAttemptsValue(maxAttempts);
  let lease = null;
  let item = null;

  db.exec('BEGIN IMMEDIATE');
  try {
    expireStaleLeases(db, now);
    item = db.prepare(`
      SELECT qi.*
      FROM queue_items qi
      WHERE qi.status IN ('pending', 'active')
        AND qi.readiness IN ('runnable', 'needs_decomposition', 'needs_exploration')
        AND NOT EXISTS (
          SELECT 1
          FROM leases l
          WHERE l.queue_item_id = qi.id
            AND l.status = 'active'
            AND l.expires_at > ?
        )
        AND (
          ? IS NULL
          OR (
            SELECT COUNT(*)
            FROM runner_attempts ra
            WHERE ra.queue_item_id = qi.id
              AND ra.status = 'failed'
              AND COALESCE(ra.md_fingerprint, qi.md_fingerprint) = qi.md_fingerprint
          ) < ?
        )
      ORDER BY qi.priority DESC, qi.id ASC
      LIMIT 1
    `).get(now, maxAttemptsLimit, maxAttemptsLimit) || null;
    if (item) {
      const priorAttempt = db.prepare(`
        SELECT COALESCE(MAX(attempt), 0) AS max_attempt
        FROM leases
        WHERE queue_item_id = ?
      `).get(item.id)?.max_attempt || 0;
      lease = {
        id: `lease-${randomUUID()}`,
        queue_item_id: item.id,
        runner_id: String(runnerId || 'local-runner'),
        status: 'active',
        leased_at: now,
        heartbeat_at: now,
        expires_at: isoPlusSeconds(now, ttl),
        attempt: Number(priorAttempt) + 1,
      };
      writeLeaseInsertRow({ db, lease }, queueWriterIo);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  db.close();
  return {
    projectDir: synced.projectDir,
    workId: synced.workId,
    dbPath,
    item,
    lease,
    claimed: Boolean(lease),
    maxAttempts: maxAttemptsLimit,
  };
}

export function claimQueueItems(workDir, { runnerId = 'local-runner', ttlSeconds = 300, maxAttempts = null, limit = null } = {}) {
  const synced = syncQueueProjection(workDir);
  const { db, dbPath } = openQueueDb(synced.projectDir);
  const now = isoNow();
  const ttl = leaseTtlSeconds(ttlSeconds);
  const maxAttemptsLimit = maxAttemptsValue(maxAttempts);
  const batchLimit = limit == null ? null : Math.max(0, Math.floor(Number(limit)));
  const claims = [];

  db.exec('BEGIN IMMEDIATE');
  try {
    expireStaleLeases(db, now);
    const rows = db.prepare(`
      SELECT qi.*
      FROM queue_items qi
      WHERE qi.status IN ('pending', 'active')
        AND qi.readiness IN ('runnable', 'needs_decomposition', 'needs_exploration')
        AND NOT EXISTS (
          SELECT 1
          FROM leases l
          WHERE l.queue_item_id = qi.id
            AND l.status = 'active'
            AND l.expires_at > ?
        )
        AND (
          ? IS NULL
          OR (
            SELECT COUNT(*)
            FROM runner_attempts ra
            WHERE ra.queue_item_id = qi.id
              AND ra.status = 'failed'
              AND COALESCE(ra.md_fingerprint, qi.md_fingerprint) = qi.md_fingerprint
          ) < ?
        )
      ORDER BY qi.priority DESC, qi.id ASC
      ${batchLimit == null ? '' : 'LIMIT ?'}
    `).all(...(batchLimit == null ? [now, maxAttemptsLimit, maxAttemptsLimit] : [now, maxAttemptsLimit, maxAttemptsLimit, batchLimit]));

    for (const item of rows) {
      const priorAttempt = db.prepare(`
        SELECT COALESCE(MAX(attempt), 0) AS max_attempt
        FROM leases
        WHERE queue_item_id = ?
      `).get(item.id)?.max_attempt || 0;
      const lease = {
        id: `lease-${randomUUID()}`,
        queue_item_id: item.id,
        runner_id: String(runnerId || 'local-runner'),
        status: 'active',
        leased_at: now,
        heartbeat_at: now,
        expires_at: isoPlusSeconds(now, ttl),
        attempt: Number(priorAttempt) + 1,
      };
      writeLeaseInsertRow({ db, lease }, queueWriterIo);
      claims.push({ item, lease });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  db.close();
  return {
    projectDir: synced.projectDir,
    workId: synced.workId,
    dbPath,
    claims,
    claimed: claims.length > 0,
    maxAttempts: maxAttemptsLimit,
  };
}

export function heartbeatLease(workDir, leaseId, { ttlSeconds = 300 } = {}) {
  const { projectDir, parsed } = parseSingleProject(workDir);
  const { db, dbPath } = openQueueDb(projectDir);
  const now = isoNow();
  const ttl = leaseTtlSeconds(ttlSeconds);
  db.exec('BEGIN IMMEDIATE');
  try {
    expireStaleLeases(db, now);
    const current = readLease(db, leaseId);
    if (!current) throw new Error(`Lease not found: ${leaseId}`);
    if (current.status !== 'active') throw new Error(`Lease is not active: ${leaseId} (${current.status})`);
    writeLeaseHeartbeatRow({
      db,
      leaseId,
      heartbeatAt: now,
      expiresAt: isoPlusSeconds(now, ttl),
    }, queueWriterIo);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const lease = readLease(db, leaseId);
  db.close();
  return { projectDir, workId: parsed.project.id, dbPath, lease };
}

export function releaseLease(workDir, leaseId, { status = 'done' } = {}) {
  const allowed = new Set(['done', 'failed', 'cancelled']);
  if (!allowed.has(status)) throw new Error(`Invalid release status '${status}'; expected done, failed, or cancelled`);
  const { projectDir, parsed } = parseSingleProject(workDir);
  const { db, dbPath } = openQueueDb(projectDir);
  const now = isoNow();
  db.exec('BEGIN IMMEDIATE');
  try {
    expireStaleLeases(db, now, { excludeLeaseIds: [leaseId] });
    const current = readLease(db, leaseId);
    if (!current) throw new Error(`Lease not found: ${leaseId}`);
    if (current.status !== 'active') throw new Error(`Lease is not active: ${leaseId} (${current.status})`);
    db.prepare(`
      UPDATE leases
      SET status = ?, heartbeat_at = ?
      WHERE id = ?
    `).run(status, now, leaseId);
    const attemptStatus = status === 'done' ? 'done' : 'failed';
    const stopReason = status === 'done' ? 'lease_released' : `lease_${status}`;
    const errorSummary = status === 'done' ? null : `Lease ${leaseId} released with status ${status}.`;
    db.prepare(`
      UPDATE runner_attempts
      SET status = ?,
          finished_at = COALESCE(finished_at, ?),
          stop_reason = COALESCE(stop_reason, ?),
          error_summary = COALESCE(error_summary, ?)
      WHERE lease_id = ?
        AND status = 'running'
    `).run(attemptStatus, now, stopReason, errorSummary, leaseId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const lease = readLease(db, leaseId);
  db.close();
  return { projectDir, workId: parsed.project.id, dbPath, lease };
}

export function insertRunnerAttempt(workDir, attempt) {
  const { projectDir, parsed } = parseSingleProject(workDir);
  const { db, dbPath } = openQueueDb(projectDir);
  const now = isoNow();
  const queueItem = attempt.queueItemId
    ? db.prepare('SELECT md_fingerprint FROM queue_items WHERE id = ?').get(attempt.queueItemId)
    : null;
  const row = {
    id: attempt.id || `attempt-${randomUUID()}`,
    queue_item_id: attempt.queueItemId,
    lease_id: attempt.leaseId || null,
    runner_id: attempt.runnerId || 'taskops-runner',
    runtime_adapter: attempt.runtimeAdapter || 'dry-run',
    md_fingerprint: attempt.mdFingerprint || queueItem?.md_fingerprint || null,
    status: attempt.status || 'running',
    started_at: attempt.startedAt || now,
    finished_at: attempt.finishedAt || null,
    run_id: attempt.runId || null,
    stop_reason: attempt.stopReason || null,
    error_summary: attempt.errorSummary || null,
  };
  db.prepare(`
    INSERT INTO runner_attempts (
      id, queue_item_id, lease_id, runner_id, runtime_adapter, md_fingerprint,
      status, started_at, finished_at, run_id, stop_reason, error_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.queue_item_id,
    row.lease_id,
    row.runner_id,
    row.runtime_adapter,
    row.md_fingerprint,
    row.status,
    row.started_at,
    row.finished_at,
    row.run_id,
    row.stop_reason,
    row.error_summary,
  );
  db.close();
  return { projectDir, workId: parsed.project.id, dbPath, attempt: row };
}

export function updateRunnerAttempt(workDir, attemptId, patch = {}) {
  const { projectDir, parsed } = parseSingleProject(workDir);
  const { db, dbPath } = openQueueDb(projectDir);
  const current = db.prepare(`
    SELECT id, queue_item_id, lease_id, runner_id, runtime_adapter, md_fingerprint, status,
           started_at, finished_at, run_id, stop_reason, error_summary
    FROM runner_attempts
    WHERE id = ?
  `).get(attemptId);
  if (!current) {
    db.close();
    throw new Error(`Runner attempt not found: ${attemptId}`);
  }
  const row = {
    status: patch.status || current.status,
    finished_at: patch.finishedAt === undefined ? current.finished_at : patch.finishedAt,
    run_id: patch.runId === undefined ? current.run_id : patch.runId,
    stop_reason: patch.stopReason === undefined ? current.stop_reason : patch.stopReason,
    error_summary: patch.errorSummary === undefined ? current.error_summary : patch.errorSummary,
  };
  db.prepare(`
    UPDATE runner_attempts
    SET status = ?, finished_at = ?, run_id = ?, stop_reason = ?, error_summary = ?
    WHERE id = ?
  `).run(row.status, row.finished_at, row.run_id, row.stop_reason, row.error_summary, attemptId);
  const updated = db.prepare(`
    SELECT id, queue_item_id, lease_id, runner_id, runtime_adapter, md_fingerprint, status,
           started_at, finished_at, run_id, stop_reason, error_summary
    FROM runner_attempts
    WHERE id = ?
  `).get(attemptId);
  db.close();
  return { projectDir, workId: parsed.project.id, dbPath, attempt: updated };
}

export function insertProgressReport(workDir, report) {
  const { projectDir, parsed } = parseSingleProject(workDir);
  const { db, dbPath } = openQueueDb(projectDir);
  const now = isoNow();
  const row = {
    id: report.id || `report-${randomUUID()}`,
    work_root: projectDir,
    work_id: parsed.project.id,
    queue_item_id: report.queueItemId || null,
    task_id: report.taskId || null,
    wave_id: report.waveId || 'wave-unknown',
    master_session_key: report.masterSessionKey || null,
    report_sink: report.reportSink || 'ledger',
    status: report.status || 'delivered',
    message: String(report.message || ''),
    created_at: report.createdAt || now,
    delivered_at: report.deliveredAt || (report.status === 'failed' ? null : now),
    error_summary: report.errorSummary || null,
  };
  writeProgressReportRow({ db, row }, queueWriterIo);
  db.close();
  return { projectDir, workId: parsed.project.id, dbPath, report: row };
}

export function listProgressReports(workDir) {
  const { projectDir, parsed } = parseSingleProject(workDir);
  const { db, dbPath } = openQueueDb(projectDir);
  const reports = db.prepare(`
    SELECT id, work_root, work_id, queue_item_id, task_id, wave_id,
           master_session_key, report_sink, status, message, created_at, delivered_at, error_summary
    FROM progress_reports
    ORDER BY created_at ASC, id ASC
  `).all();
  db.close();
  return { projectDir, workId: parsed.project.id, dbPath, reports };
}
