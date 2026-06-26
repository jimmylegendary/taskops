import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isPartialUnresolved } from './lib-taskops.js';

const DEFAULT_MAX_FLAT_TASKS = 12;

const COMPLEX_OBJECTIVE_PATTERNS = [
  /\bbuild\b/i,
  /\bimplement\b/i,
  /\bplatform\b/i,
  /\bpipeline\b/i,
  /\bresearch\b/i,
  /\bbenchmark\b/i,
  /\bablation\b/i,
  /\bMVP\b/,
  /\bNext\.?js\b/i,
  /\bcontrol[- ]plane\b/i,
  /\bpaper\b/i,
  /\bcompare\b/i,
  /\bcomparison\b/i,
  /구현/,
  /제작/,
  /리서치/,
  /방대한/,
  /논문/,
  /벤치/,
  /비교/,
  /플랫폼/,
];

function issue({ code, severity, message, evidence = {} }) {
  return { code, severity, message, evidence };
}

function activeSnapshot(parsed) {
  return parsed.project?.activeSnapshotId ? parsed.snapshots.get(parsed.project.activeSnapshotId) : null;
}

function selectedPairs(parsed) {
  const snapshot = activeSnapshot(parsed);
  return Array.isArray(snapshot?.selectedVersions) ? snapshot.selectedVersions.filter(Boolean) : [];
}

function selectedVersionIds(parsed) {
  return new Set(selectedPairs(parsed).map((pair) => pair.versionId).filter(Boolean));
}

function selectedTaskGroupIds(parsed) {
  return new Set(selectedPairs(parsed).map((pair) => pair.taskGroupId).filter(Boolean));
}

function selectedTasks(parsed) {
  const selected = selectedVersionIds(parsed);
  const tasks = [...parsed.tasks.values()];
  if (selected.size === 0) return tasks;
  return tasks.filter((task) => selected.has(task.taskGroupVersionId));
}

function terminalSelectedTasks(parsed) {
  const selectedGroups = selectedTaskGroupIds(parsed);
  return selectedTasks(parsed).filter((task) => !(task.childTaskGroupId && selectedGroups.has(task.childTaskGroupId)));
}

function selectedChildTaskGroupCount(parsed) {
  const rootId = parsed.project?.activeRootTaskGroupId;
  return selectedPairs(parsed).filter((pair) => pair.taskGroupId && pair.taskGroupId !== rootId).length;
}

function taskEows(parsed, task) {
  return [...parsed.eowNodes.values()].filter((eow) => (
    eow.graphType === 'task'
    && eow.attachedToType === 'task'
    && eow.attachedToId === task.id
    && (!eow.taskGroupVersionId || eow.taskGroupVersionId === task.taskGroupVersionId)
  ));
}

function manualEows(parsed) {
  return [...parsed.eowNodes.values()].filter((eow) => ['manual_verified', 'manual_close'].includes(eow.reason));
}

function partialMarkers(parsed) {
  return [...(parsed.partialNodes?.values() || [])];
}

function unresolvedPartialMarkers(parsed) {
  return partialMarkers(parsed).filter((partial) => isPartialUnresolved(partial));
}

function objectiveLooksComplex(parsed) {
  const text = [
    parsed.project?.title,
    parsed.project?.objective,
    ...[...parsed.taskGroups.values()].map((group) => group.objective),
  ].filter(Boolean).join('\n');
  if (COMPLEX_OBJECTIVE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return text.split(/\s+/).filter(Boolean).length >= 28;
}

function auditDecompositionAdequacy(parsed, options) {
  const issues = [];
  const selectedTaskCount = selectedTasks(parsed).length;
  const terminalTaskCount = terminalSelectedTasks(parsed).length;
  const childTaskGroupCount = selectedChildTaskGroupCount(parsed);
  const complex = objectiveLooksComplex(parsed);
  const maxFlatTasks = options.maxFlatTasks ?? DEFAULT_MAX_FLAT_TASKS;

  if (!complex) {
    issues.push(issue({
      code: 'objective_not_marked_complex',
      severity: 'info',
      message: 'Objective does not match the complex-work heuristic; decomposition adequacy is informational only.',
      evidence: { selectedTaskCount, terminalTaskCount, childTaskGroupCount, maxFlatTasks },
    }));
    return issues;
  }

  if (childTaskGroupCount === 0 && selectedTaskCount <= maxFlatTasks) {
    issues.push(issue({
      code: 'complex_objective_flat_decomposition',
      severity: 'error',
      message: `Complex objective has only ${selectedTaskCount} selected depth-1 task(s) and no selected child task groups.`,
      evidence: { selectedTaskCount, terminalTaskCount, childTaskGroupCount, maxFlatTasks },
    }));
  } else if (childTaskGroupCount === 0) {
    issues.push(issue({
      code: 'complex_objective_no_child_groups',
      severity: 'warning',
      message: 'Complex objective has no selected child task groups; verify the root tasks are not overloaded.',
      evidence: { selectedTaskCount, terminalTaskCount, childTaskGroupCount, maxFlatTasks },
    }));
  }
  return issues;
}

function auditClosureIntegrity(parsed) {
  const issues = [];
  const closure = parsed.closure || {};
  const manuals = manualEows(parsed);
  const partials = unresolvedPartialMarkers(parsed);

  if (partials.length > 0) {
    issues.push(issue({
      code: 'work_has_partial_completions',
      severity: 'warning',
      message: `${partials.length} partial completion marker(s) are present; this is honest unfinished work and cannot support a completion claim until superseded by follow-up or approved closure.`,
      evidence: {
        partialCount: partials.length,
        examples: partials.slice(0, 5).map((partial) => ({
          id: partial.id,
          graphType: partial.graphType,
          attachedToId: partial.attachedToId,
          supersededBy: partial.supersededBy ?? null,
          path: partial.path,
        })),
      },
    }));
  }

  if (manuals.length > 0) {
    issues.push(issue({
      code: 'manual_attestation_present',
      severity: 'error',
      message: `${manuals.length} manual_verified/manual_close EoW node(s) are present; this cannot support a strong completion claim.`,
      evidence: {
        manualEowCount: manuals.length,
        closureState: closure.closureState || 'open',
        examples: manuals.slice(0, 5).map((eow) => ({ id: eow.id, reason: eow.reason, path: eow.path })),
      },
    }));
  }

  if (closure.structuralComplete === true && closure.policyApprovedComplete !== true) {
    issues.push(issue({
      code: 'structural_complete_unapproved',
      severity: manuals.length > 0 ? 'warning' : 'error',
      message: `Work is structurally complete but not policy-approved (${closure.closureState || 'unknown'}).`,
      evidence: {
        closureState: closure.closureState || 'open',
        terminalTaskEow: `${closure.terminalTaskEowCount ?? 0}/${closure.terminalTaskCount ?? 0}`,
        runTerminalEow: `${closure.runTerminalEowCount ?? 0}/${closure.runTerminalNodeCount ?? 0}`,
      },
    }));
  }

  return issues;
}

function readQueueProjection(projectDir) {
  const dbPath = join(projectDir, '.taskops', 'queue.sqlite');
  if (!existsSync(dbPath)) return { dbPath, present: false, rows: [], activeLeases: [], runningAttempts: [] };
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare('SELECT id, task_id, status, readiness, blocked_reason, md_fingerprint FROM queue_items').all();
    const activeLeases = db.prepare("SELECT id, queue_item_id, runner_id, status, expires_at FROM leases WHERE status = 'active'").all();
    const runningAttempts = db.prepare("SELECT id, queue_item_id, lease_id, runner_id, status, stop_reason, error_summary FROM runner_attempts WHERE status = 'running'").all();
    return { dbPath, present: true, rows, activeLeases, runningAttempts };
  } finally {
    db.close();
  }
}

function auditProjectionConsistency(parsed) {
  const projection = readQueueProjection(parsed.projectDir);
  if (!projection.present) {
    return [issue({
      code: 'queue_projection_missing',
      severity: 'info',
      message: 'No .taskops/queue.sqlite projection exists; projection consistency was not checked.',
      evidence: { dbPath: projection.dbPath },
    })];
  }

  const issues = [];
  const rowsById = new Map(projection.rows.map((row) => [row.id, row]));
  const selected = selectedTasks(parsed);
  const closedTaskIds = new Set();
  for (const task of selected) {
    if (task.status === 'done' || taskEows(parsed, task).length > 0) closedTaskIds.add(`${task.taskGroupVersionId}:${task.id}`);
  }

  const staleRows = projection.rows.filter((row) => row.status === 'stale_projection');
  if (staleRows.length > 0) {
    issues.push(issue({
      code: 'stale_projection_rows_present',
      severity: 'warning',
      message: `${staleRows.length} stale_projection queue row(s) remain in SQLite projection.`,
      evidence: { count: staleRows.length, examples: staleRows.slice(0, 5).map((row) => row.id) },
    }));
  }

  const activeClosedRows = [...closedTaskIds]
    .map((id) => rowsById.get(id))
    .filter((row) => row && ['active', 'running', 'pending'].includes(row.status));
  if (activeClosedRows.length > 0) {
    issues.push(issue({
      code: 'closed_markdown_active_queue_row',
      severity: 'error',
      message: `${activeClosedRows.length} closed markdown task(s) still have active/pending queue rows.`,
      evidence: { examples: activeClosedRows.slice(0, 5).map((row) => ({ id: row.id, status: row.status, readiness: row.readiness })) },
    }));
  }

  const activeLeaseOnClosed = projection.activeLeases.filter((lease) => closedTaskIds.has(lease.queue_item_id));
  const runningAttemptOnClosed = projection.runningAttempts.filter((attempt) => closedTaskIds.has(attempt.queue_item_id));
  if (activeLeaseOnClosed.length > 0 || runningAttemptOnClosed.length > 0) {
    issues.push(issue({
      code: 'closed_markdown_active_lease_or_attempt',
      severity: 'error',
      message: 'SQLite projection still has active lease/running attempt for task(s) closed in markdown.',
      evidence: {
        activeLeases: activeLeaseOnClosed.slice(0, 5).map((lease) => lease.id),
        runningAttempts: runningAttemptOnClosed.slice(0, 5).map((attempt) => attempt.id),
      },
    }));
  }

  return issues;
}

function severityCounts(issues) {
  return issues.reduce((acc, item) => {
    acc[item.severity] = (acc[item.severity] || 0) + 1;
    return acc;
  }, {});
}

export function auditParsedWork(parsed, options = {}) {
  const issues = [
    ...auditDecompositionAdequacy(parsed, options),
    ...auditClosureIntegrity(parsed, options),
    ...auditProjectionConsistency(parsed, options),
  ];
  const counts = severityCounts(issues);
  const partialCount = partialMarkers(parsed).length;
  const unresolvedPartialCount = unresolvedPartialMarkers(parsed).length;
  const claimSafe = (counts.error || 0) === 0
    && parsed.errors.length === 0
    && parsed.closure?.policyApprovedComplete === true
    && unresolvedPartialCount === 0;
  return {
    workId: parsed.project?.id || null,
    projectDir: parsed.projectDir,
    claimSafe,
    strictSafe: claimSafe && (counts.warning || 0) === 0,
    counts,
    metrics: {
      selectedTaskCount: selectedTasks(parsed).length,
      terminalSelectedTaskCount: terminalSelectedTasks(parsed).length,
      selectedTaskGroupCount: selectedTaskGroupIds(parsed).size,
      selectedChildTaskGroupCount: selectedChildTaskGroupCount(parsed),
      taskGroupVersionCount: parsed.versions.size,
      manualEowCount: manualEows(parsed).length,
      partialCount,
      unresolvedPartialCount,
      closureState: parsed.closure?.closureState || 'open',
      policyApprovedComplete: parsed.closure?.policyApprovedComplete === true,
      structuralComplete: parsed.closure?.structuralComplete === true,
    },
    validationErrors: parsed.errors,
    validationWarnings: parsed.warnings,
    issues,
  };
}

export function renderAuditText(audit) {
  const lines = [
    `work=${audit.workId || 'unknown'} claimSafe=${audit.claimSafe}`,
    `counts error=${audit.counts.error || 0} warning=${audit.counts.warning || 0} info=${audit.counts.info || 0}`,
    `metrics selectedTasks=${audit.metrics.selectedTaskCount} terminalTasks=${audit.metrics.terminalSelectedTaskCount} selectedGroups=${audit.metrics.selectedTaskGroupCount} childGroups=${audit.metrics.selectedChildTaskGroupCount} versions=${audit.metrics.taskGroupVersionCount}`,
    `closure state=${audit.metrics.closureState} structural=${audit.metrics.structuralComplete} policyApproved=${audit.metrics.policyApprovedComplete} manualEow=${audit.metrics.manualEowCount} partial=${audit.metrics.unresolvedPartialCount}/${audit.metrics.partialCount}`,
  ];
  if (audit.validationErrors.length > 0) {
    lines.push('validation errors:');
    for (const err of audit.validationErrors) lines.push(`- ${err}`);
  }
  if (audit.issues.length > 0) {
    lines.push('audit issues:');
    for (const item of audit.issues) {
      lines.push(`- ${item.severity.toUpperCase()} ${item.code}: ${item.message}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
