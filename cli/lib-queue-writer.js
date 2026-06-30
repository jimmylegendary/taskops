function requireFn(io, name) {
  const fn = io?.[name];
  if (typeof fn !== 'function') throw new Error(`Missing ${name} adapter`);
  return fn;
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
