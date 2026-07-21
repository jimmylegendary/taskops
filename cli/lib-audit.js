import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isPartialUnresolved, partialPromotionWaveBudgetState } from './lib-taskops.js';
import { progressLedger, renderProgressLedgerText } from './lib-progress-ledger.js';

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

function repeatedPartialReviewTasks(parsed) {
  return selectedTasks(parsed).filter((task) => task.needsManualReview === true && task.repeatedPartialNeedsReview === true);
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

    const waveBudget = partialPromotionWaveBudgetState(parsed.project, { promotionCount: 0 });
    if (waveBudget.exhausted) {
      issues.push(issue({
        code: 'wave_budget_exhausted_with_unresolved_partials',
        severity: 'warning',
        message: `Partial-promotion wave budget is exhausted (${waveBudget.count}/${waveBudget.budget}) while unresolved partial completion marker(s) remain; human review is required before further promotion.`,
        evidence: {
          count: waveBudget.count,
          budget: waveBudget.budget,
          unresolvedPartialCount: partials.length,
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

  const repeatedReviewTasks = repeatedPartialReviewTasks(parsed);
  if (repeatedReviewTasks.length > 0) {
    issues.push(issue({
      code: 'task_repeated_partial_needs_review',
      severity: 'warning',
      message: `${repeatedReviewTasks.length} task(s) require human review after repeated partial-promotion waves.`,
      evidence: {
        taskCount: repeatedReviewTasks.length,
        examples: repeatedReviewTasks.slice(0, 5).map((task) => ({
          id: task.id,
          taskGroupVersionId: task.taskGroupVersionId,
          repeatCount: task.repeatedPartialCount ?? null,
          repeatThreshold: task.partialRepeatThreshold ?? null,
          partialIds: Array.isArray(task.repeatedPartialReviewPartialIds) ? task.repeatedPartialReviewPartialIds : [],
          path: task.path,
        })),
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

// ---- Assurance ledger (P0-1 + failure certificates; spec: docs/specs/failure-certificate.md) --------------
// DONE side: the P1 assuranceTier stamped on task EoWs (verified > self_verified > self_reported). FAIL side:
// the failureCertificate stamped on blocked/failed closes (content vs infra/protocol; undetermined = F1's
// third class). Both sides feed claimSafe through ISSUES (the single source of truth) rather than ad-hoc
// formula edits: a self_verified closure is an ERROR (a completion claim on top of it would overclaim — the
// Arm-D self_ground_gap hole), an uncertified blocked close is a WARNING (legacy), undetermined is INFO.
const DONE_TIER_RANK = { verified: 3, self_verified: 2, self_reported: 1, unverified: 0 };

function doneTierForTask(parsed, task) {
  const tiers = taskEows(parsed, task).map((eow) => eow.assuranceTier).filter(Boolean);
  if (tiers.length === 0) return null; // legacy close — tier never stamped
  return tiers.slice().sort((a, b) => (DONE_TIER_RANK[a] ?? -1) - (DONE_TIER_RANK[b] ?? -1))[0]; // weakest wins
}

// Oracle access (P0-3; spec docs/specs/oracle-access.md): stratify terminal closes by external-oracle
// CONSUMPTION. Measurement only — no issue, no gate, claimSafe math untouched (issues stay the single source
// of truth). DONE side reads the EoW stamp (unlike the tier's weakest-wins, HIGHEST consumption wins when
// multiple EoWs disagree — a re-review may re-stamp, and consumption already happened cannot be un-consumed);
// FAIL side reads failureCertificate.oracleAccess. A close that never reached the judge verdict
// (infra/protocol certificate, legacy close, unrecognized value) is 'unknown', never coerced into a tier.
const ORACLE_ACCESS_RANK = { interactive: 2, judge_once: 1, none: 0 };

function oracleAccessForTask(parsed, task) {
  if (task.status === 'done') {
    const stamped = taskEows(parsed, task).map((eow) => eow.oracleAccess).filter((v) => ORACLE_ACCESS_RANK[v] != null);
    if (stamped.length === 0) return null;
    return stamped.slice().sort((a, b) => (ORACLE_ACCESS_RANK[b] ?? -1) - (ORACLE_ACCESS_RANK[a] ?? -1))[0];
  }
  const certValue = task.failureCertificate?.oracleAccess;
  return ORACLE_ACCESS_RANK[certValue] != null ? certValue : null;
}

function assuranceSummary(parsed) {
  const terminals = terminalSelectedTasks(parsed);
  const doneTasks = terminals.filter((task) => task.status === 'done');
  const blockedTasks = terminals.filter((task) => ['blocked', 'failed'].includes(task.status));
  const tiers = doneTasks.map((task) => doneTierForTask(parsed, task));
  const floor = doneTasks.length === 0
    ? 'none'
    : (tiers.some((tier) => tier == null)
      ? 'unknown'
      : tiers.slice().sort((a, b) => (DONE_TIER_RANK[a] ?? -1) - (DONE_TIER_RANK[b] ?? -1))[0]);
  const certificates = blockedTasks.map((task) => task.failureCertificate).filter(Boolean);
  const oracleAccess = { none: 0, judge_once: 0, interactive: 0, unknown: 0 };
  for (const task of [...doneTasks, ...blockedTasks]) {
    const value = oracleAccessForTask(parsed, task);
    oracleAccess[value == null ? 'unknown' : value] += 1;
  }
  return {
    floor,
    // The pure assurance dimension, orthogonal to structural claimSafe: every closed terminal task earned the
    // full runner-verified, non-self-authored tier.
    externallySafe: doneTasks.length > 0 && tiers.every((tier) => tier === 'verified'),
    failureLedger: {
      // A content-kind certificate DEMOTED to undetermined (F-2 verifier-flake quarantine) is not a true
      // content failure: the verifier, not the work, is the suspect. Tier filter added with the F-2/F-3
      // stage — a no-op for every pre-existing certificate (kind=content and tier=undetermined were
      // mutually exclusive before probes could demote).
      content: certificates.filter((cert) => cert.kind === 'content' && cert.failureTier !== 'undetermined').length,
      verifiedFailure: certificates.filter((cert) => cert.failureTier === 'verified_failure').length,
      undetermined: certificates.filter((cert) => cert.failureTier === 'undetermined').length,
      uncertified: blockedTasks.filter((task) => !task.failureCertificate).length,
    },
    // P0-3: oracle-consumption tally over the same terminal set (done + blocked/failed) — bench stratification.
    oracleAccess,
  };
}

function auditAssuranceLedger(parsed) {
  const issues = [];
  const terminals = terminalSelectedTasks(parsed);
  const selfVerified = terminals.filter((task) => task.status === 'done' && doneTierForTask(parsed, task) === 'self_verified');
  if (selfVerified.length > 0) {
    issues.push(issue({
      code: 'self_verified_closure_present',
      severity: 'error',
      message: `${selfVerified.length} closed task(s) are only self_verified (executor-authored acceptance, not independently confirmed); a completion claim on top of them would overclaim. Add an external check and re-verify to earn the verified tier.`,
      evidence: { taskIds: selfVerified.slice(0, 5).map((task) => task.id) },
    }));
  }
  const blockedTasks = terminals.filter((task) => ['blocked', 'failed'].includes(task.status));
  const uncertified = blockedTasks.filter((task) => !task.failureCertificate);
  if (uncertified.length > 0) {
    issues.push(issue({
      code: 'blocked_without_failure_certificate',
      severity: 'warning',
      message: `${uncertified.length} blocked/failed task(s) carry no failure certificate; the failure claim is untyped (content vs infra indistinguishable) and must not be counted as a true failure.`,
      evidence: { taskIds: uncertified.slice(0, 5).map((task) => task.id) },
    }));
  }
  const undetermined = blockedTasks.filter((task) => task.failureCertificate && task.failureCertificate.failureTier === 'undetermined');
  if (undetermined.length > 0) {
    issues.push(issue({
      code: 'undetermined_failures_present',
      severity: 'info',
      message: `${undetermined.length} blocked task(s) closed undetermined (infra/protocol failure, or a verifier-flake quarantine that demoted a content rejection): excluded from the failure ledger (F1's third class); re-queue once the harness/check issue is resolved.`,
      evidence: { taskIds: undetermined.slice(0, 5).map((task) => task.id) },
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
    ...auditAssuranceLedger(parsed),
    ...auditProjectionConsistency(parsed, options),
  ];
  const counts = severityCounts(issues);
  const partialCount = partialMarkers(parsed).length;
  const unresolvedPartialCount = unresolvedPartialMarkers(parsed).length;
  const repeatedReviewTaskCount = repeatedPartialReviewTasks(parsed).length;
  const assurance = assuranceSummary(parsed);
  const claimSafe = (counts.error || 0) === 0
    && parsed.errors.length === 0
    && parsed.closure?.policyApprovedComplete === true
    && unresolvedPartialCount === 0
    && repeatedReviewTaskCount === 0;
  return {
    workId: parsed.project?.id || null,
    projectDir: parsed.projectDir,
    claimSafe,
    strictSafe: claimSafe && (counts.warning || 0) === 0,
    // Assurance ledger (P0-1): DONE-side tier floor + pure-assurance externallySafe + FAIL-side ledger.
    // claimSafe itself is flipped by the self_verified ERROR issue — issues stay the single source of truth.
    assurance,
    // Progress ledger (divergence/convergence axis; spec docs/theory/divergence-convergence-v0.md): a sibling to
    // `assurance`, ORTHOGONAL to claimSafe — measurement only, contributes ZERO issues and never touches the
    // claimSafe/strictSafe/counts expressions. The only coupling is numeric (transport borrows DONE_TIER_RANK).
    progress: progressLedger(parsed),
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
      repeatedReviewTaskCount,
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
    `assurance floor=${audit.assurance?.floor ?? 'unknown'} externallySafe=${audit.assurance?.externallySafe === true} failures content=${audit.assurance?.failureLedger?.content ?? 0} verifiedFailure=${audit.assurance?.failureLedger?.verifiedFailure ?? 0} undetermined=${audit.assurance?.failureLedger?.undetermined ?? 0} uncertified=${audit.assurance?.failureLedger?.uncertified ?? 0} oracleAccess none=${audit.assurance?.oracleAccess?.none ?? 0} judge_once=${audit.assurance?.oracleAccess?.judge_once ?? 0} interactive=${audit.assurance?.oracleAccess?.interactive ?? 0} unknown=${audit.assurance?.oracleAccess?.unknown ?? 0}`,
  ];
  // Progress axis (measurement-only sibling): one appended line, orthogonal to claimSafe (never routed into issues).
  lines.push(renderProgressLedgerText(audit.progress));
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
