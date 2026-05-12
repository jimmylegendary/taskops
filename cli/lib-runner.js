import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  classifyTaskReadiness,
  discoverProjects,
  ensureDir,
  fmBlock,
  parseMarkdownFile,
  parseProject,
  readBody,
} from './lib-taskops.js';

export const RUNNER_LOCK_DIR = '.taskops-runner.lock';
export const DEFAULT_RUN_ID = 'run-main';
export const DEFAULT_AGENT_ID = 'main';
export const STOP_REASONS = Object.freeze({
  NO_RUNNABLE: 'no_runnable',
  BLOCKED_ONLY: 'blocked_only',
  WAITING: 'waiting',
  DELEGATION_PENDING: 'delegation_pending',
  MAX_STEPS: 'max_steps',
  DEADLINE_REACHED: 'deadline_reached',
  TASK_FAILED: 'task_failed',
  VALIDATION_FAILED: 'validation_failed',
  ERROR: 'error',
});

function isoNow() {
  return new Date().toISOString();
}

const FM_SCALAR_MAX_LEN = 500;
const FM_SCALAR_FALLBACK = 'executor_failed';

export function sanitizeFmScalar(value, { maxLen = FM_SCALAR_MAX_LEN, fallback = FM_SCALAR_FALLBACK } = {}) {
  if (value == null) return fallback;
  const collapsed = String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!collapsed) return fallback;
  if (collapsed.length > maxLen) return collapsed.slice(0, Math.max(1, maxLen - 3)) + '...';
  return collapsed;
}

function rewriteFrontmatter(filePath, updater) {
  const fm = parseMarkdownFile(filePath);
  const body = readBody(filePath);
  const next = updater({ ...fm }) ?? fm;
  const text = fmBlock(next) + (body ? body + '\n' : '');
  writeFileSync(filePath, text, 'utf8');
}

function logEvent(eventsPath, event) {
  appendFileSync(eventsPath, JSON.stringify(event) + '\n', 'utf8');
}

function appendRunLog(runDir, line) {
  const logPath = join(runDir, 'run-log.md');
  if (!existsSync(logPath)) writeFileSync(logPath, '# Run log\n\n', 'utf8');
  appendFileSync(logPath, `- ${line}\n`, 'utf8');
}

function resolveRunId(parsed, requested) {
  if (requested) return String(requested);
  const runs = [...parsed.runs.values()];
  const active = runs.filter((r) => r.status === 'active');
  if (active.length === 1) return active[0].id;
  return DEFAULT_RUN_ID;
}

function ensureRunDirectories(projectDir, runId, project) {
  const runDir = join(projectDir, 'runs', runId);
  ensureDir(join(runDir, 'nodes'));
  ensureDir(join(runDir, 'edges'));
  const indexPath = join(runDir, 'index.md');
  if (!existsSync(indexPath)) {
    const fm = {
      taskOpsVersion: 'v1',
      entityType: 'run',
      id: runId,
      workId: project.id,
      createdAt: isoNow(),
      status: 'active',
    };
    writeFileSync(indexPath, fmBlock(fm) + `# Run ${runId}\n`, 'utf8');
  }
  const logPath = join(runDir, 'run-log.md');
  if (!existsSync(logPath)) writeFileSync(logPath, '# Run log\n\n- Run initialized by runner.\n', 'utf8');
  const eventsPath = join(runDir, 'events.jsonl');
  if (!existsSync(eventsPath)) writeFileSync(eventsPath, '', 'utf8');
  return runDir;
}

function collectTaskCandidates(parsed) {
  const candidates = [];
  const activeSnapshot = parsed.project.activeSnapshotId ? parsed.snapshots.get(parsed.project.activeSnapshotId) : null;

  if (activeSnapshot && Array.isArray(activeSnapshot.selectedVersions) && activeSnapshot.selectedVersions.length > 0) {
    let pairOrder = 0;
    for (const pair of activeSnapshot.selectedVersions) {
      if (!pair || !pair.versionId) continue;
      const version = parsed.versions.get(pair.versionId);
      if (!version) continue;
      for (const task of version.tasks) {
        candidates.push({ task, pairOrder, taskOrder: task.order ?? 0 });
      }
      pairOrder += 1;
    }
  } else {
    let pairOrder = 0;
    for (const version of parsed.versions.values()) {
      for (const task of version.tasks) {
        candidates.push({ task, pairOrder, taskOrder: task.order ?? 0 });
      }
      pairOrder += 1;
    }
  }

  candidates.sort((a, b) => {
    if (a.pairOrder !== b.pairOrder) return a.pairOrder - b.pairOrder;
    if ((a.taskOrder ?? 0) !== (b.taskOrder ?? 0)) return (a.taskOrder ?? 0) - (b.taskOrder ?? 0);
    return String(a.task.id).localeCompare(String(b.task.id));
  });

  return candidates;
}

const ACTION_BY_READINESS = Object.freeze({
  runnable: 'execute',
  needs_decomposition: 'decompose',
  needs_exploration: 'explore',
});

function pickNextAction(parsed) {
  for (const runNode of parsed.runNodes.values()) {
    if (runNode.status === 'waiting') {
      return {
        kind: 'stop',
        reason: STOP_REASONS.WAITING,
        detail: `Run node ${runNode.runId}/${runNode.id} is waiting; resolve before continuing.`,
        source: { type: 'runNode', runId: runNode.runId, id: runNode.id },
      };
    }
    if (runNode.type === 'delegate' && !['done', 'cancelled'].includes(runNode.status)) {
      return {
        kind: 'stop',
        reason: STOP_REASONS.DELEGATION_PENDING,
        detail: `Delegated run node ${runNode.runId}/${runNode.id} is pending (status=${runNode.status}).`,
        source: { type: 'runNode', runId: runNode.runId, id: runNode.id },
      };
    }
  }

  const candidates = collectTaskCandidates(parsed);
  let anyOpenTask = false;
  let onlyBlockedSeen = true;
  for (const { task } of candidates) {
    if (['done', 'cancelled'].includes(task.status)) continue;
    anyOpenTask = true;
    if (task.status === 'waiting') {
      return {
        kind: 'stop',
        reason: STOP_REASONS.WAITING,
        detail: `Task ${task.id} is waiting; resolve before continuing.`,
        source: { type: 'task', id: task.id },
      };
    }
    const classification = classifyTaskReadiness(task);
    if (classification.runReadiness === 'blocked') continue;
    onlyBlockedSeen = false;
    const action = ACTION_BY_READINESS[classification.runReadiness];
    if (!action) continue;
    return { kind: action, task, classification };
  }

  if (anyOpenTask && onlyBlockedSeen) {
    return { kind: 'stop', reason: STOP_REASONS.BLOCKED_ONLY, detail: 'Only blocked tasks remain; unblock or cancel them before continuing.' };
  }
  return { kind: 'stop', reason: STOP_REASONS.NO_RUNNABLE };
}

function buildAgentExecutionPrompt({ project, task }) {
  return [
    'You are a TaskOps worker agent.',
    `Work: ${project.id} — ${project.title || ''}`.trim(),
    `Work objective: ${project.objective || ''}`,
    '',
    `Task: ${task.id} — ${task.title}`,
    `Task objective: ${task.objective || ''}`,
    `Task responsibility: ${task.responsibility || ''}`,
    `Task completion criteria: ${task.completionCriteria || ''}`,
    '',
    'Execute this single TaskOps task. Do not recursively invoke `taskops run`.',
    'When done, reply with a short summary of what was accomplished and any artifacts produced.',
  ].join('\n');
}

function buildAgentDecompositionPrompt({ project, task, childTaskGroupId, versionId }) {
  return [
    'You are a TaskOps decomposition agent.',
    `Work: ${project.id} — ${project.title || ''}`.trim(),
    `Work objective: ${project.objective || ''}`,
    '',
    `Task to decompose: ${task.id} — ${task.title}`,
    `Task objective: ${task.objective || ''}`,
    `Task responsibility: ${task.responsibility || ''}`,
    `Task completion criteria: ${task.completionCriteria || ''}`,
    '',
    'Author a TaskOps child task group and a v1 version that decomposes this task using the canonical md-first format.',
    `Target child task group id: ${childTaskGroupId}`,
    `Target version id: ${versionId}`,
    'Create the task group folder (with index.md) under task-groups/<id>/, then call `taskops decompose <work-dir> --task-group-id <child-tg-id> --spec <spec.json>` to write the new version.',
    'Each new child task must include taskOpsVersion, entityType=task, id, taskGroupId, taskGroupVersionId, title, objective, responsibility, completionCriteria, order, createdAt, status, plus an explicit runReadiness.',
    'Do not mark child tasks as runnable unless they truly meet the runnable criteria. Use needs_exploration or blocked with a reason field when the inputs are not yet known.',
    'Do not recursively invoke `taskops run`.',
  ].join('\n');
}

function buildAgentExplorationPrompt({ project, task, runId, runNodeId, artifactRelPath }) {
  return [
    'You are a TaskOps exploration agent.',
    `Work: ${project.id} — ${project.title || ''}`.trim(),
    `Work objective: ${project.objective || ''}`,
    '',
    `Task under exploration: ${task.id} — ${task.title}`,
    `Task objective: ${task.objective || ''}`,
    `Task responsibility: ${task.responsibility || ''}`,
    `Task completion criteria: ${task.completionCriteria || ''}`,
    `Declared unknowns: ${Array.isArray(task.unknowns) && task.unknowns.length ? task.unknowns.join('; ') : '(none declared)'}`,
    `Next learning goal: ${task.nextLearningGoal || '(none declared)'}`,
    '',
    'Run a minimal, safe exploration pass: search/read/try just enough to record learned facts, discovered constraints, failed/successful approaches, remaining unknowns, and a recommended next decomposition or runnable task.',
    `Write the exploration artifact at: ${artifactRelPath}`,
    `Run id: ${runId}, run node id: ${runNodeId}.`,
    'Do not mark the parent task as done; the runner manages task graph state. Do not recursively invoke `taskops run`.',
  ].join('\n');
}

function invokeAgent({ args, stepTimeoutMs }) {
  const spawnOpts = { encoding: 'utf8' };
  if (stepTimeoutMs != null && Number.isFinite(stepTimeoutMs)) spawnOpts.timeout = stepTimeoutMs;
  const result = spawnSync('openclaw', args, spawnOpts);
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  if (result.error) {
    return { ok: false, message: `openclaw agent invocation failed: ${result.error.message}`, stdout, stderr };
  }
  if (result.signal === 'SIGTERM' || (result.status === null && stepTimeoutMs != null)) {
    return { ok: false, message: `openclaw agent timed out after ${stepTimeoutMs}ms`, stdout, stderr };
  }
  if (result.status !== 0) {
    return { ok: false, message: stderr || stdout || `openclaw agent exited with status ${result.status}`, stdout, stderr };
  }
  return { ok: true, message: stdout, stdout, stderr };
}

function invokeExecutor({ project, task, executor, agentId, stepTimeoutMs }) {
  if (executor === 'dry-run') {
    return {
      ok: true,
      message: `dry-run executor synthetically completed task ${task.id}`,
      executor: 'dry-run',
    };
  }
  if (executor === 'openclaw-agent') {
    const prompt = buildAgentExecutionPrompt({ project, task });
    const args = ['agent', '--agent', agentId, '--message', prompt, '--json'];
    if (stepTimeoutMs != null && Number.isFinite(stepTimeoutMs)) {
      args.push('--timeout', String(Math.max(1, Math.floor(stepTimeoutMs / 1000))));
    }
    const result = invokeAgent({ args, stepTimeoutMs });
    return { ...result, executor: 'openclaw-agent', message: result.message || `openclaw agent completed task ${task.id}` };
  }
  return { ok: false, message: `Unknown executor '${executor}'`, executor };
}

function ensureRunNode({ runDir, runId, runNodeId, type, title, sourceTaskId, sourceTaskGroupVersionId, status = 'active', kindLabel }) {
  const runNodePath = join(runDir, 'nodes', `${runNodeId}.md`);
  if (!existsSync(runNodePath)) {
    const nodeFm = {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id: runNodeId,
      runId,
      type,
      title,
      status,
      sourceTaskId,
      sourceTaskGroupVersionId,
      createdAt: isoNow(),
    };
    writeFileSync(runNodePath, fmBlock(nodeFm) + `# Run node: ${sourceTaskId} (${kindLabel || type})\n`, 'utf8');
  } else {
    rewriteFrontmatter(runNodePath, (fm) => {
      fm.status = status;
      return fm;
    });
  }
  return runNodePath;
}

function attachRunRef(taskPath, runId, runNodeId, role) {
  rewriteFrontmatter(taskPath, (fm) => {
    if (fm.status === 'pending') fm.status = 'active';
    const refs = Array.isArray(fm.runRefs) ? [...fm.runRefs] : [];
    if (!refs.some((r) => r && r.runId === runId && r.runNodeId === runNodeId)) {
      refs.push({ runId, runNodeId, role });
    }
    fm.runRefs = refs;
    return fm;
  });
}

function closeRunNodeWithEow({ runDir, runId, runNodeId, reason, finishedAt }) {
  const eowRunNodeId = `eow-${runNodeId}`;
  const eowRunPath = join(runDir, 'nodes', `${eowRunNodeId}.md`);
  if (!existsSync(eowRunPath)) {
    const eowFm = {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: eowRunNodeId,
      runId,
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: runNodeId,
      reason,
      declaredBy: 'taskops-runner',
      declaredAt: finishedAt,
      createdAt: finishedAt,
      status: 'done',
    };
    writeFileSync(eowRunPath, fmBlock(eowFm) + `# EoW: ${runNodeId}\n`, 'utf8');
  }
  const edgeId = `edge-${runNodeId}-to-eow`;
  const edgePath = join(runDir, 'edges', `${edgeId}.md`);
  if (!existsSync(edgePath)) {
    const edgeFm = {
      taskOpsVersion: 'v1',
      entityType: 'runEdge',
      id: edgeId,
      runId,
      fromRunNodeId: runNodeId,
      toRunNodeId: eowRunNodeId,
      edgeType: 'closes_with',
      createdAt: finishedAt,
      status: 'done',
    };
    writeFileSync(edgePath, fmBlock(edgeFm) + `# Run edge: ${runNodeId} closes with EoW\n`, 'utf8');
  }
}

function closeTaskWithEow({ task, reason, finishedAt }) {
  const versionDir = dirname(dirname(task.path));
  const eowTaskId = `eow-${task.id}`;
  const eowTaskDir = join(versionDir, 'eow');
  ensureDir(eowTaskDir);
  const eowTaskPath = join(eowTaskDir, `${eowTaskId}.md`);
  if (!existsSync(eowTaskPath)) {
    const eowFm = {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: eowTaskId,
      graphType: 'task',
      attachedToType: 'task',
      attachedToId: task.id,
      reason,
      declaredBy: 'taskops-runner',
      declaredAt: finishedAt,
      createdAt: finishedAt,
      status: 'done',
    };
    writeFileSync(eowTaskPath, fmBlock(eowFm) + `# EoW: ${task.id}\n`, 'utf8');
  }
}

function executeRunnableTask({ project, task, runDir, runId, eventsPath, executor, agentId, stepTimeoutMs }) {
  const startedAt = isoNow();
  const runNodeId = `run-node-${task.id}`;
  const runNodePath = ensureRunNode({
    runDir, runId, runNodeId,
    type: 'implementation',
    title: task.title,
    sourceTaskId: task.id,
    sourceTaskGroupVersionId: task.taskGroupVersionId,
    status: 'active',
    kindLabel: 'execute',
  });

  attachRunRef(task.path, runId, runNodeId, 'primary_execution');

  logEvent(eventsPath, {
    timestamp: startedAt, type: 'task_selected', runId,
    taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId,
  });
  logEvent(eventsPath, {
    timestamp: startedAt, type: 'task_started', runId,
    taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
  });
  appendRunLog(runDir, `${startedAt} task_started taskId=${task.id} runNodeId=${runNodeId} executor=${executor}`);

  let result;
  try {
    result = invokeExecutor({ project, task, executor, agentId, stepTimeoutMs });
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err), executor };
  }

  const finishedAt = isoNow();

  if (result.ok) {
    rewriteFrontmatter(task.path, (fm) => { fm.status = 'done'; return fm; });
    rewriteFrontmatter(runNodePath, (fm) => { fm.status = 'done'; return fm; });
    closeTaskWithEow({ task, reason: 'no_further_decomposition', finishedAt });
    closeRunNodeWithEow({ runDir, runId, runNodeId, reason: 'execution_path_closed', finishedAt });

    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'task_completed', runId,
      taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
      message: result.message || null,
    });
    appendRunLog(runDir, `${finishedAt} task_completed taskId=${task.id} runNodeId=${runNodeId}`);
    return { taskId: task.id, runNodeId, kind: 'execute', status: 'completed', executor, message: result.message || null };
  }

  rewriteFrontmatter(task.path, (fm) => {
    fm.status = 'blocked';
    fm.lastRunFailureReason = sanitizeFmScalar(result.message);
    return fm;
  });
  rewriteFrontmatter(runNodePath, (fm) => { fm.status = 'blocked'; return fm; });
  logEvent(eventsPath, {
    timestamp: finishedAt, type: 'task_failed', runId,
    taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
    message: result.message || null,
  });
  appendRunLog(runDir, `${finishedAt} task_failed taskId=${task.id} reason=${result.message || ''}`);
  return { taskId: task.id, runNodeId, kind: 'execute', status: 'failed', executor, message: result.message || null };
}

function deriveDecompositionIds(task) {
  const suffix = task.id.replace(/^task-/, '') || task.id;
  return {
    childTaskGroupId: `tg-${suffix}`,
    versionId: `tgv-${suffix}-v1`,
    suffix,
  };
}

function performDryRunDecomposition({ projectDir, task }) {
  const { childTaskGroupId, versionId, suffix } = deriveDecompositionIds(task);
  const tgDir = join(projectDir, 'task-groups', childTaskGroupId);
  const versionIndex = join(tgDir, 'versions', versionId, 'index.md');
  if (existsSync(versionIndex)) {
    return { ok: true, childTaskGroupId, versionId, message: `Decomposition already present at ${versionIndex}; reusing.` };
  }
  if (existsSync(tgDir)) {
    return { ok: false, message: `Child task group '${childTaskGroupId}' already exists without expected version '${versionId}'; refusing to overwrite a real or partial decomposition` };
  }
  const now = isoNow();
  ensureDir(join(tgDir, 'versions', versionId, 'tasks'));
  ensureDir(join(tgDir, 'versions', versionId, 'eow'));

  const tgFm = {
    taskOpsVersion: 'v1', entityType: 'taskGroup', id: childTaskGroupId,
    objective: `Synthetic dry-run decomposition of ${task.id}: ${task.title}`,
    activeVersionId: versionId, createdAt: now, status: 'active',
  };
  writeFileSync(join(tgDir, 'index.md'), fmBlock(tgFm) + `# Task group ${childTaskGroupId}\n\nSynthetic placeholder created by the TaskOps dry-run runner. Real human input is required before the child tasks become runnable.\n`, 'utf8');

  const versionFm = {
    taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: versionId,
    taskGroupId: childTaskGroupId, version: 'v1',
    summary: `Synthetic dry-run decomposition of ${task.title}`,
    createdAt: now, status: 'active',
  };
  writeFileSync(join(tgDir, 'versions', versionId, 'index.md'), fmBlock(versionFm) + `# Version ${versionId}\n\nSynthetic placeholder children. Replace with concrete tasks once real inputs are supplied.\n`, 'utf8');
  writeFileSync(
    join(tgDir, 'versions', versionId, 'decomposition-log.md'),
    `# Decomposition log\n\n- ${now} synthetic dry-run decomposition of ${task.id}. Children are placeholders blocked until human input is supplied.\n`,
    'utf8',
  );

  const childTaskId = `task-${suffix}-input-required`;
  const childFm = {
    taskOpsVersion: 'v1', entityType: 'task', id: childTaskId,
    taskGroupId: childTaskGroupId, taskGroupVersionId: versionId,
    title: `Collect human input for ${task.title}`,
    objective: `Synthetic placeholder: collect the inputs needed to expand ${task.id} into a real plan.`,
    responsibility: 'Owner must supply the concrete inputs that replace this synthetic placeholder before running real work.',
    completionCriteria: 'Real child tasks have replaced this placeholder using TaskOps canonical fields, informed by the requested inputs.',
    order: 1, createdAt: now, status: 'pending',
    runReadiness: 'blocked',
    runReadinessReason: 'Synthetic dry-run placeholder. A human must supply real inputs before this becomes runnable.',
    understandingLevel: 'unknown',
  };
  writeFileSync(
    join(tgDir, 'versions', versionId, 'tasks', `${childTaskId}.md`),
    fmBlock(childFm) + `# ${childFm.title}\n\nSynthetic placeholder created by the TaskOps dry-run runner. This is not real progress; it is structural scaffolding so the parent task can be marked decomposed without losing trace to the open question.\n`,
    'utf8',
  );
  return { ok: true, childTaskGroupId, versionId, message: `Synthesized dry-run child task group ${childTaskGroupId}/${versionId}` };
}

function performAgentDecomposition({ projectDir, project, task, agentId, stepTimeoutMs }) {
  const { childTaskGroupId, versionId } = deriveDecompositionIds(task);
  const versionIndex = join(projectDir, 'task-groups', childTaskGroupId, 'versions', versionId, 'index.md');
  if (existsSync(versionIndex)) {
    return { ok: true, childTaskGroupId, versionId, message: `Decomposition already present at ${versionIndex}; reusing.` };
  }
  const prompt = buildAgentDecompositionPrompt({ project, task, childTaskGroupId, versionId });
  const args = ['agent', '--agent', agentId, '--message', prompt, '--json'];
  if (stepTimeoutMs != null && Number.isFinite(stepTimeoutMs)) {
    args.push('--timeout', String(Math.max(1, Math.floor(stepTimeoutMs / 1000))));
  }
  const result = invokeAgent({ args, stepTimeoutMs });
  if (!result.ok) return { ok: false, message: result.message };
  if (!existsSync(versionIndex)) {
    return { ok: false, message: `openclaw-agent did not author expected child task group at ${versionIndex}; refusing to mark decomposition done` };
  }
  return { ok: true, childTaskGroupId, versionId, message: result.stdout || `Agent created ${childTaskGroupId}/${versionId}` };
}

function executeDecompositionTask({ projectDir, project, task, runDir, runId, eventsPath, executor, agentId, stepTimeoutMs }) {
  const startedAt = isoNow();
  const runNodeId = `run-node-${task.id}`;
  const runNodePath = ensureRunNode({
    runDir, runId, runNodeId,
    type: 'decomposition',
    title: `Decompose: ${task.title}`,
    sourceTaskId: task.id,
    sourceTaskGroupVersionId: task.taskGroupVersionId,
    status: 'active',
    kindLabel: 'decompose',
  });
  attachRunRef(task.path, runId, runNodeId, 'primary_decomposition');

  logEvent(eventsPath, {
    timestamp: startedAt, type: 'decomposition_started', runId,
    taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
  });
  appendRunLog(runDir, `${startedAt} decomposition_started taskId=${task.id} runNodeId=${runNodeId} executor=${executor}`);

  let result;
  try {
    result = executor === 'dry-run'
      ? performDryRunDecomposition({ projectDir, task })
      : performAgentDecomposition({ projectDir, project, task, agentId, stepTimeoutMs });
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const finishedAt = isoNow();
  if (!result.ok) {
    rewriteFrontmatter(task.path, (fm) => {
      fm.status = 'blocked';
      fm.lastRunFailureReason = sanitizeFmScalar(result.message);
      return fm;
    });
    rewriteFrontmatter(runNodePath, (fm) => { fm.status = 'blocked'; return fm; });
    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'decomposition_failed', runId,
      taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
      message: result.message || null,
    });
    appendRunLog(runDir, `${finishedAt} decomposition_failed taskId=${task.id} reason=${result.message || ''}`);
    return { taskId: task.id, runNodeId, kind: 'decompose', status: 'failed', executor, message: result.message || null };
  }

  rewriteFrontmatter(task.path, (fm) => {
    fm.status = 'done';
    fm.childTaskGroupId = result.childTaskGroupId;
    fm.runReadiness = 'needs_decomposition';
    fm.runReadinessReason = sanitizeFmScalar(`Decomposed by taskops-runner (${executor}) into ${result.childTaskGroupId}/${result.versionId} at ${finishedAt}.`);
    delete fm.lastRunFailureReason;
    return fm;
  });
  closeTaskWithEow({ task, reason: 'decomposed_by_runner', finishedAt });
  rewriteFrontmatter(runNodePath, (fm) => { fm.status = 'done'; return fm; });
  closeRunNodeWithEow({ runDir, runId, runNodeId, reason: 'decomposition_recorded', finishedAt });

  logEvent(eventsPath, {
    timestamp: finishedAt, type: 'decomposition_completed', runId,
    taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
    childTaskGroupId: result.childTaskGroupId, versionId: result.versionId,
    message: result.message || null,
  });
  appendRunLog(runDir, `${finishedAt} decomposition_completed taskId=${task.id} childTaskGroupId=${result.childTaskGroupId} versionId=${result.versionId}`);
  return {
    taskId: task.id, runNodeId, kind: 'decompose', status: 'completed', executor,
    childTaskGroupId: result.childTaskGroupId, versionId: result.versionId, message: result.message || null,
  };
}

function performDryRunExploration({ runDir, runNodeId, task }) {
  const now = isoNow();
  const artifactsDir = join(runDir, 'artifacts');
  ensureDir(artifactsDir);
  const artifactPath = join(artifactsDir, `${runNodeId}.md`);
  const unknowns = Array.isArray(task.unknowns) ? task.unknowns : [];
  const lines = [
    `# Exploration artifact for ${task.id}`,
    '',
    `Generated by the TaskOps dry-run runner on ${now}.`,
    'This is a synthetic reflection placeholder; replace with real exploration output before relying on it for human-impacting decisions.',
    '',
    '## Task',
    `- id: ${task.id}`,
    `- title: ${task.title}`,
    `- objective: ${task.objective || ''}`,
    `- responsibility: ${task.responsibility || ''}`,
    `- completionCriteria: ${task.completionCriteria || ''}`,
    '',
    '## Recorded unknowns',
    ...(unknowns.length > 0 ? unknowns.map((u) => `- ${u}`) : ['- (none declared)']),
    '',
    '## Next learning goal',
    `- ${task.nextLearningGoal || 'Define the next learning step.'}`,
    '',
    '## Suggested next action',
    '- Decompose into smaller TaskOps tasks now that an exploration record exists.',
  ];
  writeFileSync(artifactPath, lines.join('\n') + '\n', 'utf8');
  return { ok: true, artifactPath, message: `Wrote dry-run exploration artifact at ${artifactPath}` };
}

function performAgentExploration({ project, projectDir, task, agentId, stepTimeoutMs, runDir, runId, runNodeId }) {
  const artifactsDir = join(runDir, 'artifacts');
  ensureDir(artifactsDir);
  const artifactPath = join(artifactsDir, `${runNodeId}.md`);
  const artifactRelPath = artifactPath.startsWith(projectDir) ? artifactPath.slice(projectDir.length).replace(/^[\\/]/, '') : artifactPath;
  const prompt = buildAgentExplorationPrompt({ project, task, runId, runNodeId, artifactRelPath });
  const args = ['agent', '--agent', agentId, '--message', prompt, '--json'];
  if (stepTimeoutMs != null && Number.isFinite(stepTimeoutMs)) {
    args.push('--timeout', String(Math.max(1, Math.floor(stepTimeoutMs / 1000))));
  }
  const result = invokeAgent({ args, stepTimeoutMs });
  if (!result.ok) return { ok: false, message: result.message };
  if (!existsSync(artifactPath)) {
    return { ok: false, message: `openclaw-agent did not write expected exploration artifact at ${artifactPath}; refusing to mark exploration done` };
  }
  return { ok: true, artifactPath, message: result.stdout || `Agent recorded exploration at ${artifactPath}` };
}

function executeExplorationTask({ projectDir, project, task, runDir, runId, eventsPath, executor, agentId, stepTimeoutMs }) {
  const startedAt = isoNow();
  const runNodeId = `run-node-${task.id}`;
  const runNodePath = ensureRunNode({
    runDir, runId, runNodeId,
    type: 'exploration',
    title: `Explore: ${task.title}`,
    sourceTaskId: task.id,
    sourceTaskGroupVersionId: task.taskGroupVersionId,
    status: 'active',
    kindLabel: 'explore',
  });
  attachRunRef(task.path, runId, runNodeId, 'primary_exploration');

  logEvent(eventsPath, {
    timestamp: startedAt, type: 'exploration_started', runId,
    taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
  });
  appendRunLog(runDir, `${startedAt} exploration_started taskId=${task.id} runNodeId=${runNodeId} executor=${executor}`);

  let result;
  try {
    result = executor === 'dry-run'
      ? performDryRunExploration({ runDir, runNodeId, task })
      : performAgentExploration({ project, projectDir, task, agentId, stepTimeoutMs, runDir, runId, runNodeId });
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const finishedAt = isoNow();
  if (!result.ok) {
    rewriteFrontmatter(task.path, (fm) => {
      fm.status = 'blocked';
      fm.lastRunFailureReason = sanitizeFmScalar(result.message);
      return fm;
    });
    rewriteFrontmatter(runNodePath, (fm) => { fm.status = 'blocked'; return fm; });
    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'exploration_failed', runId,
      taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
      message: result.message || null,
    });
    appendRunLog(runDir, `${finishedAt} exploration_failed taskId=${task.id} reason=${result.message || ''}`);
    return { taskId: task.id, runNodeId, kind: 'explore', status: 'failed', executor, message: result.message || null };
  }

  rewriteFrontmatter(task.path, (fm) => {
    fm.status = 'done';
    fm.runReadiness = 'needs_decomposition';
    fm.runReadinessReason = sanitizeFmScalar(`Exploration recorded by taskops-runner (${executor}) at ${finishedAt}; ready for decomposition with informed inputs.`);
    delete fm.lastRunFailureReason;
    return fm;
  });
  closeTaskWithEow({ task, reason: 'exploration_recorded_by_runner', finishedAt });
  rewriteFrontmatter(runNodePath, (fm) => { fm.status = 'done'; return fm; });
  closeRunNodeWithEow({ runDir, runId, runNodeId, reason: 'exploration_recorded', finishedAt });

  logEvent(eventsPath, {
    timestamp: finishedAt, type: 'exploration_completed', runId,
    taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
    artifactPath: result.artifactPath || null, message: result.message || null,
  });
  appendRunLog(runDir, `${finishedAt} exploration_completed taskId=${task.id} runNodeId=${runNodeId} artifact=${result.artifactPath || ''}`);
  return {
    taskId: task.id, runNodeId, kind: 'explore', status: 'completed', executor,
    artifactPath: result.artifactPath || null, message: result.message || null,
  };
}

export function runTaskOps(workDir, options = {}) {
  if (!workDir) throw new Error('Missing TaskOps work directory');
  const workRoot = resolve(workDir);
  const projects = discoverProjects(workRoot);
  if (projects.length !== 1) {
    throw new Error(`Expected exactly 1 TaskOps work under ${workDir}, found ${projects.length}`);
  }
  const projectDir = projects[0];

  const executor = options.executor || 'dry-run';
  if (!['dry-run', 'openclaw-agent'].includes(executor)) {
    throw new Error(`Invalid --executor '${executor}'. Use 'dry-run' or 'openclaw-agent'.`);
  }
  const agentId = options.agent || DEFAULT_AGENT_ID;

  let maxSteps = null;
  if (options.maxSteps != null) {
    const n = Number(options.maxSteps);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid --max-steps '${options.maxSteps}'`);
    maxSteps = Math.floor(n);
  }

  let until = null;
  if (options.until != null) {
    const parsed = Date.parse(String(options.until));
    if (Number.isNaN(parsed)) throw new Error(`Invalid --until '${options.until}'; expected an ISO-8601 timestamp or Date-parseable string`);
    until = parsed;
  }

  if (maxSteps == null && until == null) maxSteps = 1;

  let taskTimeoutMs = null;
  if (options.timeout != null) {
    const n = Number(options.timeout);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --timeout '${options.timeout}'`);
    taskTimeoutMs = Math.floor(n * 1000);
  }

  const lockDir = join(projectDir, RUNNER_LOCK_DIR);
  try {
    mkdirSync(lockDir, { recursive: false });
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      throw new Error(`TaskOps runner lock already held at ${lockDir}; remove it if no runner is active`);
    }
    throw err;
  }
  try {
    writeFileSync(join(lockDir, 'pid'), String(process.pid), 'utf8');
  } catch {}

  const cleanup = () => {
    try { rmSync(lockDir, { recursive: true, force: true }); } catch {}
  };

  try {
    let parsed = parseProject(projectDir);
    if (parsed.errors.length > 0) {
      throw new Error(`TaskOps work has validation errors; cannot start runner:\n- ${parsed.errors.join('\n- ')}`);
    }

    const runId = resolveRunId(parsed, options.runId);
    const runDir = ensureRunDirectories(projectDir, runId, parsed.project);
    const eventsPath = join(runDir, 'events.jsonl');

    const startedAt = isoNow();
    logEvent(eventsPath, {
      timestamp: startedAt, type: 'runner_started',
      workId: parsed.project.id, runId, executor,
      agentId: executor === 'openclaw-agent' ? agentId : null,
      maxSteps, until: until != null ? new Date(until).toISOString() : null,
    });
    appendRunLog(runDir, `${startedAt} runner_started workId=${parsed.project.id} runId=${runId} executor=${executor}`);

    let stepsRun = 0;
    let stopReason = null;
    let stopDetail = null;
    let stopSource = null;
    const actions = [];

    while (true) {
      if (until != null && Date.now() >= until) { stopReason = STOP_REASONS.DEADLINE_REACHED; break; }
      if (maxSteps != null && stepsRun >= maxSteps) { stopReason = STOP_REASONS.MAX_STEPS; break; }

      parsed = parseProject(projectDir);
      if (parsed.errors.length > 0) {
        stopReason = STOP_REASONS.VALIDATION_FAILED;
        logEvent(eventsPath, { timestamp: isoNow(), type: 'validation_failed', runId, errors: parsed.errors });
        break;
      }

      const next = pickNextAction(parsed);
      if (next.kind === 'stop') {
        stopReason = next.reason;
        stopDetail = next.detail || null;
        stopSource = next.source || null;
        if (stopReason === STOP_REASONS.WAITING || stopReason === STOP_REASONS.DELEGATION_PENDING || stopReason === STOP_REASONS.BLOCKED_ONLY) {
          logEvent(eventsPath, { timestamp: isoNow(), type: stopReason, runId, detail: stopDetail, source: stopSource });
          appendRunLog(runDir, `${isoNow()} ${stopReason}${stopDetail ? ` ${stopDetail}` : ''}`);
        }
        break;
      }

      let stepTimeoutMs = taskTimeoutMs;
      if (until != null) {
        const remaining = until - Date.now();
        if (remaining <= 0) { stopReason = STOP_REASONS.DEADLINE_REACHED; break; }
        if (stepTimeoutMs == null || remaining < stepTimeoutMs) stepTimeoutMs = remaining;
      }

      let stepResult;
      if (next.kind === 'execute') {
        stepResult = executeRunnableTask({
          project: parsed.project, task: next.task,
          runDir, runId, eventsPath, executor, agentId, stepTimeoutMs,
        });
      } else if (next.kind === 'decompose') {
        stepResult = executeDecompositionTask({
          projectDir, project: parsed.project, task: next.task,
          runDir, runId, eventsPath, executor, agentId, stepTimeoutMs,
        });
      } else if (next.kind === 'explore') {
        stepResult = executeExplorationTask({
          projectDir, project: parsed.project, task: next.task,
          runDir, runId, eventsPath, executor, agentId, stepTimeoutMs,
        });
      } else {
        throw new Error(`Unhandled action kind: ${next.kind}`);
      }

      actions.push(stepResult);
      stepsRun += 1;

      if (stepResult.status === 'failed') { stopReason = STOP_REASONS.TASK_FAILED; break; }
    }

    if (!stopReason) stopReason = STOP_REASONS.NO_RUNNABLE;

    const stoppedAt = isoNow();
    logEvent(eventsPath, {
      timestamp: stoppedAt, type: 'runner_stopped', runId,
      workId: parsed.project.id, stopReason, stepsRun, detail: stopDetail, source: stopSource,
    });
    appendRunLog(runDir, `${stoppedAt} runner_stopped stopReason=${stopReason} stepsRun=${stepsRun}${stopDetail ? ` detail=${stopDetail}` : ''}`);

    return {
      workId: parsed.project.id, runId,
      stopReason, stopDetail, stopSource,
      stepsRun, maxSteps,
      until: until != null ? new Date(until).toISOString() : null,
      executor,
      eventsPath,
      tasks: actions,
      actions,
    };
  } finally {
    cleanup();
  }
}
