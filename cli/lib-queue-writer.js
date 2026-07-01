function requireFn(io, name) {
  const fn = io?.[name];
  if (typeof fn !== 'function') throw new Error(`Missing ${name} adapter`);
  return fn;
}

export function queueItemUpsertSql() {
  // Bind order: id, work_root, task_id, run_id, readiness, status, priority, blocked_reason,
  // md_fingerprint, created_at, updated_at.
  return `
    INSERT INTO queue_items (
      id, work_root, task_id, run_id, readiness, status, priority, blocked_reason,
      md_fingerprint, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      work_root = excluded.work_root,
      task_id = excluded.task_id,
      run_id = excluded.run_id,
      readiness = excluded.readiness,
      status = excluded.status,
      priority = excluded.priority,
      blocked_reason = excluded.blocked_reason,
      md_fingerprint = excluded.md_fingerprint,
      updated_at = excluded.updated_at
  `;
}

export function queueItemStaleMarkerSql(rowCount) {
  // Bind order: updated_at, then each queue item id when rowCount > 0.
  const count = Math.max(0, Math.floor(Number(rowCount) || 0));
  return count > 0
    ? `
        UPDATE queue_items
        SET status = 'stale_projection',
            readiness = 'blocked',
            blocked_reason = 'No longer present in the selected TaskOps projection.',
            updated_at = ?
        WHERE id NOT IN (${Array.from({ length: count }, () => '?').join(',')})
      `
    : `
        UPDATE queue_items
        SET status = 'stale_projection',
            readiness = 'blocked',
            blocked_reason = 'No longer present in the selected TaskOps projection.',
            updated_at = ?
      `;
}

export function writeProgressReportRow({ db, row }, io) {
  if (!io || typeof io !== 'object') throw new Error('Missing queue writer I/O adapter');
  const runPreparedStatement = requireFn(io, 'runPreparedStatement');
  runPreparedStatement(db, `
    INSERT INTO progress_reports (
      id, work_root, work_id, queue_item_id, task_id, wave_id,
      master_session_key, report_sink, status, message, created_at, delivered_at, error_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    row.id,
    row.work_root,
    row.work_id,
    row.queue_item_id,
    row.task_id,
    row.wave_id,
    row.master_session_key,
    row.report_sink,
    row.status,
    row.message,
    row.created_at,
    row.delivered_at,
    row.error_summary,
  ]);
  return row;
}

export function writeLeaseHeartbeatRow({ db, leaseId, heartbeatAt, expiresAt }, io) {
  if (!io || typeof io !== 'object') throw new Error('Missing queue writer I/O adapter');
  const runPreparedStatement = requireFn(io, 'runPreparedStatement');
  runPreparedStatement(db, `
      UPDATE leases
      SET heartbeat_at = ?, expires_at = ?
      WHERE id = ?
    `, [heartbeatAt, expiresAt, leaseId]);
}

export function writeLeaseInsertRow({ db, lease }, io) {
  if (!io || typeof io !== 'object') throw new Error('Missing queue writer I/O adapter');
  const runPreparedStatement = requireFn(io, 'runPreparedStatement');
  runPreparedStatement(db, `
        INSERT INTO leases (
          id, queue_item_id, runner_id, status, leased_at, heartbeat_at, expires_at, attempt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
    lease.id,
    lease.queue_item_id,
    lease.runner_id,
    lease.status,
    lease.leased_at,
    lease.heartbeat_at,
    lease.expires_at,
    lease.attempt,
  ]);
}

export function writeRunnerAttemptRow({ db, row }, io) {
  if (!io || typeof io !== 'object') throw new Error('Missing queue writer I/O adapter');
  const runPreparedStatement = requireFn(io, 'runPreparedStatement');
  runPreparedStatement(db, `
    INSERT INTO runner_attempts (
      id, queue_item_id, lease_id, runner_id, runtime_adapter, md_fingerprint,
      status, started_at, finished_at, run_id, stop_reason, error_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
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
  ]);
}

export function updateRunnerAttemptRow({ db, attemptId, row }, io) {
  if (!io || typeof io !== 'object') throw new Error('Missing queue writer I/O adapter');
  const runPreparedStatement = requireFn(io, 'runPreparedStatement');
  runPreparedStatement(db, `
    UPDATE runner_attempts
    SET status = ?, finished_at = ?, run_id = ?, stop_reason = ?, error_summary = ?
    WHERE id = ?
  `, [row.status, row.finished_at, row.run_id, row.stop_reason, row.error_summary, attemptId]);
}
