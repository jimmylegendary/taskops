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
export const DEFAULT_MAX_LOOPBACKS = 3;
export const LOOPBACK_POLICIES = Object.freeze(['none', 'self']);
export const STOP_REASONS = Object.freeze({
  NO_RUNNABLE: 'no_runnable',
  ALL_CLOSED: 'all_closed',
  BLOCKED_ONLY: 'blocked_only',
  WAITING: 'waiting',
  DELEGATION_PENDING: 'delegation_pending',
  MAX_STEPS: 'max_steps',
  MAX_LOOPBACKS: 'max_loopbacks',
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

function runNodePause(runNode) {
  switch (runNode.type) {
    case 'delegate':
      switch (runNode.status) {
        case 'done':
        case 'cancelled':
          return null;
        default:
          return {
            reason: STOP_REASONS.DELEGATION_PENDING,
            detail: `Delegated run node ${runNode.runId}/${runNode.id} is pending (status=${runNode.status}).`,
          };
      }
    default:
      switch (runNode.status) {
        case 'waiting':
          return {
            reason: STOP_REASONS.WAITING,
            detail: `Run node ${runNode.runId}/${runNode.id} is waiting; resolve before continuing.`,
          };
        default:
          return null;
      }
  }
}

function taskPause(task) {
  switch (task.status) {
    case 'waiting':
      return {
        reason: STOP_REASONS.WAITING,
        detail: `Task ${task.id} is waiting; resolve before continuing.`,
      };
    default:
      return null;
  }
}

function blockerKey(ref) {
  if (!ref || typeof ref !== 'object') return 'invalid:blocker';
  switch (ref.type) {
    case 'task': return `task:${ref.taskGroupVersionId || '*'}:${ref.id || ref.taskId || ''}`;
    case 'runNode': return `runNode:${ref.runId || ''}:${ref.id || ref.runNodeId || ''}`;
    default: return `${ref.type || 'unknown'}:${ref.id || ''}`;
  }
}

function resolveBlocker(parsed, ref) {
  if (!ref || typeof ref !== 'object') return { resolved: false, detail: 'Invalid blocker reference.' };
  switch (ref.type) {
    case 'task': {
      const id = ref.id || ref.taskId;
      const matches = [...parsed.tasks.values()].filter((task) => task.id === id && (!ref.taskGroupVersionId || task.taskGroupVersionId === ref.taskGroupVersionId));
      if (matches.length === 0) return { resolved: false, detail: `Task blocker '${id}' not found.` };
      const unresolved = matches.filter((task) => !['done', 'cancelled'].includes(task.status));
      if (unresolved.length > 0) return { resolved: false, detail: `Task blocker '${id}' is ${unresolved.map((task) => task.status).join('/')}.` };
      return { resolved: true, detail: `Task blocker '${id}' resolved.` };
    }
    case 'runNode': {
      const id = ref.id || ref.runNodeId;
      const key = `${ref.runId}:${id}`;
      const node = parsed.runNodes.get(key);
      if (!node) return { resolved: false, detail: `Run node blocker '${key}' not found.` };
      if (!['done', 'cancelled'].includes(node.status)) return { resolved: false, detail: `Run node blocker '${key}' is ${node.status}.` };
      return { resolved: true, detail: `Run node blocker '${key}' resolved.` };
    }
    default:
      return { resolved: false, detail: `Unsupported blocker type '${ref.type || 'unknown'}'.` };
  }
}

function normalizeBlockedBy(task) {
  if (!task.blockedBy) return [];
  return Array.isArray(task.blockedBy) ? task.blockedBy : [task.blockedBy];
}

export function recheckBlockedTasks(workDir, { dryRun = false } = {}) {
  const workRoot = resolve(workDir);
  const projects = discoverProjects(workRoot);
  if (projects.length !== 1) throw new Error(`Expected exactly 1 TaskOps work under ${workDir}, found ${projects.length}`);
  const projectDir = projects[0];
  const parsed = parseProject(projectDir);
  if (parsed.errors.length > 0) {
    throw new Error(`TaskOps work has validation errors; cannot recheck blockers:\n- ${parsed.errors.join('\n- ')}`);
  }

  const checked = [];
  const unblocked = [];
  const stillBlocked = [];
  const now = isoNow();

  for (const task of parsed.tasks.values()) {
    const blockers = normalizeBlockedBy(task);
    if (blockers.length === 0) continue;
    const isBlocked = task.status === 'blocked' || task.runReadiness === 'blocked';
    if (!isBlocked) continue;
    const results = blockers.map((ref) => ({ ref, key: blockerKey(ref), ...resolveBlocker(parsed, ref) }));
    const allResolved = results.every((result) => result.resolved);
    const item = { taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, path: task.path, allResolved, blockers: results };
    checked.push(item);
    if (!allResolved) {
      stillBlocked.push(item);
      continue;
    }
    unblocked.push(item);
    if (dryRun) continue;
    rewriteFrontmatter(task.path, (fm) => {
      if (fm.status === 'blocked') fm.status = 'pending';
      if (fm.runReadiness === 'blocked') {
        if (fm.unblockRunReadiness) fm.runReadiness = fm.unblockRunReadiness;
        else delete fm.runReadiness;
      }
      fm.runReadinessReason = sanitizeFmScalar(`Blockers resolved by taskops blocker recheck at ${now}.`);
      delete fm.lastRunFailureReason;
      return fm;
    });
  }

  return { projectDir, checked, unblocked, stillBlocked, dryRun };
}

function findTargetTask(parsed, target = {}) {
  const taskId = target?.taskId;
  if (!taskId) return null;
  const matches = [...parsed.tasks.values()].filter((task) => (
    task.id === taskId
    && (!target.taskGroupVersionId || task.taskGroupVersionId === target.taskGroupVersionId)
  ));
  if (matches.length !== 1) {
    return {
      error: matches.length === 0
        ? `Target task '${target.taskGroupVersionId ? `${target.taskGroupVersionId}:` : ''}${taskId}' not found.`
        : `Target task '${taskId}' is ambiguous; provide taskGroupVersionId.`,
    };
  }
  return { task: matches[0] };
}

export function pickNextAction(parsed, target = {}) {
  for (const runNode of parsed.runNodes.values()) {
    const pause = runNodePause(runNode);
    switch (pause?.reason) {
      case STOP_REASONS.WAITING:
      return {
        kind: 'stop',
        reason: STOP_REASONS.WAITING,
        detail: pause.detail,
        source: { type: 'runNode', runId: runNode.runId, id: runNode.id },
      };
      case STOP_REASONS.DELEGATION_PENDING:
      return {
        kind: 'stop',
        reason: STOP_REASONS.DELEGATION_PENDING,
        detail: pause.detail,
        source: { type: 'runNode', runId: runNode.runId, id: runNode.id },
      };
      default:
        break;
    }
  }

  if (target?.taskId) {
    const found = findTargetTask(parsed, target);
    if (found?.error) {
      return { kind: 'stop', reason: STOP_REASONS.NO_RUNNABLE, detail: found.error };
    }
    const task = found.task;
    if (['done', 'cancelled'].includes(task.status)) {
      return {
        kind: 'stop',
        reason: STOP_REASONS.NO_RUNNABLE,
        detail: `Target task ${task.taskGroupVersionId}:${task.id} is already ${task.status}.`,
        source: { type: 'task', id: task.id },
      };
    }
    const pause = taskPause(task);
    if (pause?.reason) {
      return {
        kind: 'stop',
        reason: pause.reason,
        detail: pause.detail,
        source: { type: 'task', id: task.id },
      };
    }
    const classification = classifyTaskReadiness(task);
    if (classification.runReadiness === 'blocked') {
      return {
        kind: 'stop',
        reason: STOP_REASONS.BLOCKED_ONLY,
        detail: classification.reason || `Target task ${task.taskGroupVersionId}:${task.id} is blocked.`,
        source: { type: 'task', id: task.id },
      };
    }
    const action = ACTION_BY_READINESS[classification.runReadiness];
    if (!action) {
      return {
        kind: 'stop',
        reason: STOP_REASONS.NO_RUNNABLE,
        detail: `Target task ${task.taskGroupVersionId}:${task.id} has unsupported readiness ${classification.runReadiness}.`,
        source: { type: 'task', id: task.id },
      };
    }
    return { kind: action, task, classification };
  }

  const candidates = collectTaskCandidates(parsed);
  let anyOpenTask = false;
  let onlyBlockedSeen = true;
  for (const { task } of candidates) {
    if (['done', 'cancelled'].includes(task.status)) continue;
    anyOpenTask = true;
    const pause = taskPause(task);
    switch (pause?.reason) {
      case STOP_REASONS.WAITING:
      return {
        kind: 'stop',
        reason: STOP_REASONS.WAITING,
        detail: pause.detail,
        source: { type: 'task', id: task.id },
      };
      default:
        break;
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
  if (!anyOpenTask && parsed.closure && parsed.closure.complete === true) {
    return {
      kind: 'stop',
      reason: STOP_REASONS.ALL_CLOSED,
      detail: 'All selected terminal tasks are closed by task EoW, run terminal nodes are closed by run EoW, and no waiting/delegated/blocked work remains.',
    };
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

function buildAgentLoopbackPrompt({ project, delegate, runId, loopbackNodeId, artifactRelPath, actorName }) {
  return [
    'You are a TaskOps loopback resolution agent.',
    `Work: ${project.id} — ${project.title || ''}`.trim(),
    `Work objective: ${project.objective || ''}`,
    '',
    `Delegate run node: ${delegate.runId}/${delegate.id} (status=${delegate.status}, type=${delegate.type})`,
    `Delegate request: ${delegate.request || '(none)'} `,
    `Delegate expected output: ${delegate.expectedOutput || '(none)'} `,
    `Delegate source task: ${delegate.sourceTaskId || '(none)'} (version ${delegate.sourceTaskGroupVersionId || 'unknown'})`,
    '',
    `Loopback actor: ${actorName || 'self'}`,
    'Loopback mode is enabled: take this waiting delegation back into the runner and produce a concrete resolution that lets downstream execution continue.',
    'Record that the actual executor handled this delegation under loopback mode. Do not pretend the original delegatee executed it.',
    `Run id: ${runId}, loopback resolution run node id: ${loopbackNodeId}.`,
    `Write the loopback resolution artifact at: ${artifactRelPath}`,
    'Record the work taken, any decisions made, and what should happen next. Do not recursively invoke `taskops run`.',
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

export function isSelfDelegate(node, project) {
  if (!node || typeof node !== 'object') return false;
  if (node.type !== 'delegate') return false;
  if (node.selfDelegate === true) return true;
  const delegateeType = typeof node.delegateeType === 'string' ? node.delegateeType.trim().toLowerCase() : '';
  if (delegateeType === 'self') return true;
  const delegateeRef = node.delegateeRef == null ? '' : String(node.delegateeRef).trim().toLowerCase();
  if (delegateeRef === 'self') return true;
  if (project?.id && delegateeRef === String(project.id).toLowerCase()) return true;
  return false;
}

function performDryRunLoopback({ runDir, loopbackNodeId, delegate, actorName }) {
  const now = isoNow();
  const artifactsDir = join(runDir, 'artifacts');
  ensureDir(artifactsDir);
  const artifactPath = join(artifactsDir, `${loopbackNodeId}.md`);
  const lines = [
    `# Loopback resolution artifact for ${delegate.id}`,
    '',
    `Generated by the TaskOps dry-run runner on ${now}.`,
    'This is a synthetic loopback placeholder; replace with real loopback output before relying on it for human-impacting decisions.',
    '',
    '## Delegate',
    `- id: ${delegate.id}`,
    `- actualExecutor: ${actorName || 'taskops-runner'}`,
    '- executionMode: loopback',
    `- runId: ${delegate.runId}`,
    `- delegateeType: ${delegate.delegateeType || ''}`,
    `- delegateeRef: ${delegate.delegateeRef || ''}`,
    `- request: ${delegate.request || ''}`,
    `- expectedOutput: ${delegate.expectedOutput || ''}`,
    `- sourceTaskId: ${delegate.sourceTaskId || ''}`,
    '',
    '## Loopback outcome',
    `- ${actorName || 'taskops-runner'} took the waiting delegation back under loopback mode and closed it.`,
    '- Downstream execution may continue on the next runner pass.',
  ];
  writeFileSync(artifactPath, lines.join('\n') + '\n', 'utf8');
  return { ok: true, artifactPath, message: `Wrote dry-run loopback artifact at ${artifactPath}` };
}

function performAgentLoopback({ project, projectDir, delegate, agentId, stepTimeoutMs, runDir, runId, loopbackNodeId, actorName }) {
  const artifactsDir = join(runDir, 'artifacts');
  ensureDir(artifactsDir);
  const artifactPath = join(artifactsDir, `${loopbackNodeId}.md`);
  const artifactRelPath = artifactPath.startsWith(projectDir) ? artifactPath.slice(projectDir.length).replace(/^[\\/]/, '') : artifactPath;
  const prompt = buildAgentLoopbackPrompt({ project, delegate, runId, loopbackNodeId, artifactRelPath, actorName });
  const args = ['agent', '--agent', agentId, '--message', prompt, '--json'];
  if (stepTimeoutMs != null && Number.isFinite(stepTimeoutMs)) {
    args.push('--timeout', String(Math.max(1, Math.floor(stepTimeoutMs / 1000))));
  }
  const result = invokeAgent({ args, stepTimeoutMs });
  if (!result.ok) return { ok: false, message: result.message };
  if (!existsSync(artifactPath)) {
    return { ok: false, message: `openclaw-agent did not write expected loopback artifact at ${artifactPath}; refusing to mark loopback done` };
  }
  return { ok: true, artifactPath, message: result.stdout || `Agent recorded loopback at ${artifactPath}` };
}

function writeRunEdge({ runDir, runId, edgeId, fromRunNodeId, toRunNodeId, edgeType, createdAt, note }) {
  const edgePath = join(runDir, 'edges', `${edgeId}.md`);
  if (existsSync(edgePath)) return edgePath;
  const fm = {
    taskOpsVersion: 'v1',
    entityType: 'runEdge',
    id: edgeId,
    runId,
    fromRunNodeId,
    toRunNodeId,
    edgeType,
    createdAt,
    status: 'done',
  };
  if (note) fm.note = sanitizeFmScalar(note);
  writeFileSync(edgePath, fmBlock(fm) + `# Run edge: ${fromRunNodeId} -${edgeType}-> ${toRunNodeId}\n`, 'utf8');
  return edgePath;
}

function executeSelfLoopback({ projectDir, project, delegate, runDir, runId, eventsPath, executor, agentId, stepTimeoutMs, loopbackIndex, actorName }) {
  const startedAt = isoNow();
  const safeDelegateId = String(delegate.id).replace(/[^a-zA-Z0-9._-]/g, '-');
  const loopbackNodeId = `run-node-loopback-${safeDelegateId}${loopbackIndex > 1 ? `-${loopbackIndex}` : ''}`;
  const loopbackPath = ensureRunNode({
    runDir, runId, runNodeId: loopbackNodeId,
    type: 'loopback',
    title: `Loopback resolution for ${delegate.id}`,
    sourceTaskId: delegate.sourceTaskId || null,
    sourceTaskGroupVersionId: delegate.sourceTaskGroupVersionId || null,
    status: 'active',
    kindLabel: 'loopback',
  });
  rewriteFrontmatter(loopbackPath, (fm) => {
    fm.loopbackOfRunNodeId = delegate.id;
    fm.loopbackPolicy = 'self';
    fm.loopbackIndex = loopbackIndex;
    fm.executionMode = 'loopback';
    fm.executedBy = actorName;
    return fm;
  });

  writeRunEdge({
    runDir, runId,
    edgeId: `edge-${delegate.id}-loopback-${loopbackIndex}`,
    fromRunNodeId: delegate.id,
    toRunNodeId: loopbackNodeId,
    edgeType: 'loopback',
    createdAt: startedAt,
    note: 'Loopback resolution opened by runner',
  });

  logEvent(eventsPath, {
    timestamp: startedAt, type: 'loopback_started', runId,
    delegateRunNodeId: delegate.id, loopbackRunNodeId: loopbackNodeId,
    sourceTaskId: delegate.sourceTaskId || null,
    sourceTaskGroupVersionId: delegate.sourceTaskGroupVersionId || null,
    executor, executedBy: actorName, executionMode: 'loopback', loopbackIndex,
  });
  appendRunLog(runDir, `${startedAt} loopback_started delegateRunNodeId=${delegate.id} loopbackRunNodeId=${loopbackNodeId} executor=${executor} executedBy=${actorName}`);

  let result;
  try {
    result = executor === 'dry-run'
      ? performDryRunLoopback({ runDir, loopbackNodeId, delegate, actorName })
      : performAgentLoopback({ project, projectDir, delegate, agentId, stepTimeoutMs, runDir, runId, loopbackNodeId, actorName });
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const finishedAt = isoNow();
  if (!result.ok) {
    rewriteFrontmatter(loopbackPath, (fm) => {
      fm.status = 'blocked';
      fm.lastRunFailureReason = sanitizeFmScalar(result.message);
      return fm;
    });
    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'loopback_failed', runId,
      delegateRunNodeId: delegate.id, loopbackRunNodeId: loopbackNodeId,
      executor, executedBy: actorName, executionMode: 'loopback', loopbackIndex,
      message: result.message || null,
    });
    appendRunLog(runDir, `${finishedAt} loopback_failed delegateRunNodeId=${delegate.id} reason=${result.message || ''}`);
    return {
      kind: 'loopback', status: 'failed', executor, executedBy: actorName, executionMode: 'loopback',
      delegateRunNodeId: delegate.id, runNodeId: loopbackNodeId,
      message: result.message || null, loopbackIndex,
    };
  }

  rewriteFrontmatter(loopbackPath, (fm) => { fm.status = 'done'; return fm; });
  closeRunNodeWithEow({ runDir, runId, runNodeId: loopbackNodeId, reason: 'loopback_recorded', finishedAt });

  const delegatePath = delegate.path;
  if (delegatePath && existsSync(delegatePath)) {
    rewriteFrontmatter(delegatePath, (fm) => {
      fm.status = 'done';
      fm.resolvedBy = 'loopback';
      fm.resolvedAt = finishedAt;
      fm.resolvedByRunNodeId = loopbackNodeId;
      fm.executionMode = 'loopback';
      fm.executedBy = actorName;
      fm.executedAt = finishedAt;
      return fm;
    });
  }
  closeRunNodeWithEow({ runDir, runId, runNodeId: delegate.id, reason: 'loopback_resolved', finishedAt });

  logEvent(eventsPath, {
    timestamp: finishedAt, type: 'loopback_completed', runId,
    delegateRunNodeId: delegate.id, loopbackRunNodeId: loopbackNodeId,
    executor, executedBy: actorName, executionMode: 'loopback', loopbackIndex,
    artifactPath: result.artifactPath || null,
    message: result.message || null,
  });
  appendRunLog(runDir, `${finishedAt} loopback_completed delegateRunNodeId=${delegate.id} loopbackRunNodeId=${loopbackNodeId} executedBy=${actorName} artifact=${result.artifactPath || ''}`);

  return {
    kind: 'loopback', status: 'completed', executor, executedBy: actorName, executionMode: 'loopback',
    delegateRunNodeId: delegate.id, runNodeId: loopbackNodeId,
    artifactPath: result.artifactPath || null,
    message: result.message || null,
    loopbackIndex,
  };
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
      createdAt: isoNow(),
    };
    if (sourceTaskId != null && sourceTaskId !== '') nodeFm.sourceTaskId = sourceTaskId;
    if (sourceTaskGroupVersionId != null && sourceTaskGroupVersionId !== '') nodeFm.sourceTaskGroupVersionId = sourceTaskGroupVersionId;
    const heading = sourceTaskId ? `Run node: ${sourceTaskId} (${kindLabel || type})` : `Run node: ${runNodeId} (${kindLabel || type})`;
    writeFileSync(runNodePath, fmBlock(nodeFm) + `# ${heading}\n`, 'utf8');
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

export function extendActiveSnapshot(parsed, addition) {
  if (!addition || !addition.taskGroupId || !addition.versionId) return false;
  const snapshotId = parsed?.project?.activeSnapshotId;
  if (!snapshotId) return false;
  const snapshot = parsed.snapshots?.get(snapshotId);
  if (!snapshot || !snapshot.path) return false;
  const existing = Array.isArray(snapshot.selectedVersions) ? snapshot.selectedVersions : [];
  if (existing.some((pair) => pair && pair.taskGroupId === addition.taskGroupId && pair.versionId === addition.versionId)) {
    return false;
  }
  rewriteFrontmatter(snapshot.path, (fm) => {
    const list = Array.isArray(fm.selectedVersions) ? [...fm.selectedVersions] : [];
    if (list.some((pair) => pair && pair.taskGroupId === addition.taskGroupId && pair.versionId === addition.versionId)) {
      return fm;
    }
    list.push({ taskGroupId: addition.taskGroupId, versionId: addition.versionId });
    fm.selectedVersions = list;
    return fm;
  });
  return true;
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

const ACTION_BY_STOP_REASON = Object.freeze({
  [STOP_REASONS.ALL_CLOSED]: 'done',
  [STOP_REASONS.NO_RUNNABLE]: 'no_runnable',
  [STOP_REASONS.BLOCKED_ONLY]: 'blocked',
  [STOP_REASONS.WAITING]: 'wait',
  [STOP_REASONS.DELEGATION_PENDING]: 'delegation_pending',
});

function commandForAction(action, workDir) {
  switch (action) {
    case 'execute':
    case 'decompose':
    case 'explore':
      return `taskops run ${workDir} --executor openclaw-agent --max-steps 1`;
    case 'blocked':
      return `taskops unblock-check ${workDir} --json  # resolve blockers or supply input`;
    case 'wait':
      return `# resolve the waiting task/run node, then re-run taskops next`;
    case 'delegation_pending':
      return `# resolve the pending delegation in the run graph, then re-run taskops next`;
    case 'done':
      return `# all branches closed by EoW; no further action required`;
    default:
      return `taskops explain ${workDir}  # inspect why no action is available`;
  }
}

function shapeNextAction(next, workDir, parsed = null) {
  if (parsed?.closure?.complete === true) {
    return {
      action: 'done',
      target: null,
      reason: 'All terminal task/run EoW coverage is met and no waiting/blocked work remains.',
      stopReason: STOP_REASONS.ALL_CLOSED,
      command: commandForAction('done', workDir),
    };
  }
  if (next.kind === 'execute' || next.kind === 'decompose' || next.kind === 'explore') {
    const task = next.task;
    const action = next.kind;
    return {
      action,
      target: {
        type: 'task',
        id: task.id,
        taskGroupId: task.taskGroupId,
        taskGroupVersionId: task.taskGroupVersionId,
        path: task.path,
      },
      reason: next.classification?.reason || null,
      stopReason: null,
      command: commandForAction(action, workDir),
    };
  }
  const action = ACTION_BY_STOP_REASON[next.reason] || 'no_runnable';
  return {
    action,
    target: next.source
      ? { type: next.source.type, runId: next.source.runId || null, id: next.source.id }
      : null,
    reason: next.detail || null,
    stopReason: next.reason || null,
    command: commandForAction(action, workDir),
  };
}

function resolveSingleProject(workDir) {
  if (!workDir) throw new Error('Missing TaskOps work directory');
  const workRoot = resolve(workDir);
  const projects = discoverProjects(workRoot);
  if (projects.length !== 1) {
    throw new Error(`Expected exactly 1 TaskOps work under ${workDir}, found ${projects.length}`);
  }
  return projects[0];
}

export function computeNextAction(workDir) {
  const projectDir = resolveSingleProject(workDir);
  const parsed = parseProject(projectDir);
  const next = pickNextAction(parsed);
  const shaped = shapeNextAction(next, workDir, parsed);
  return {
    workId: parsed.project.id,
    projectDir,
    ...shaped,
    closure: parsed.closure,
    validationErrors: parsed.errors,
  };
}

function countOpenTasksByReadiness(parsed) {
  const counts = { runnable: 0, needs_decomposition: 0, needs_exploration: 0, blocked: 0, waiting: 0 };
  for (const task of parsed.tasks.values()) {
    if (['done', 'cancelled'].includes(task.status)) continue;
    if (task.status === 'waiting') {
      counts.waiting += 1;
      continue;
    }
    const c = classifyTaskReadiness(task);
    if (counts[c.runReadiness] != null) counts[c.runReadiness] += 1;
  }
  return counts;
}

export function explainWork(workDir) {
  const projectDir = resolveSingleProject(workDir);
  const parsed = parseProject(projectDir);
  const next = pickNextAction(parsed);
  const shaped = shapeNextAction(next, workDir, parsed);
  const closure = parsed.closure || {};
  const complete = closure.complete === true;
  const reasons = [];
  const readinessCounts = complete
    ? { runnable: 0, needs_decomposition: 0, needs_exploration: 0, blocked: 0, waiting: 0 }
    : countOpenTasksByReadiness(parsed);
  if (!complete) {
    if (parsed.errors.length > 0) reasons.push(`work has ${parsed.errors.length} validation error(s); cannot trust closure`);
    if ((closure.openTerminalTaskCount || 0) > 0) reasons.push(`${closure.openTerminalTaskCount} terminal task(s) missing EoW`);
    if ((closure.openRunTerminalNodeCount || 0) > 0) reasons.push(`${closure.openRunTerminalNodeCount} run terminal node(s) missing EoW`);
    if ((closure.openBlockerCount || 0) > 0) reasons.push(`${closure.openBlockerCount} blocked task(s) or run node(s)`);
    if ((closure.waitingDelegationCount || 0) > 0) reasons.push(`${closure.waitingDelegationCount} waiting/delegated run node(s)`);
    if (readinessCounts.waiting > 0) reasons.push(`${readinessCounts.waiting} task(s) waiting for external input`);
    if (readinessCounts.runnable > 0) reasons.push(`${readinessCounts.runnable} runnable task(s) remain`);
    if (readinessCounts.needs_decomposition > 0) reasons.push(`${readinessCounts.needs_decomposition} task(s) need decomposition`);
    if (readinessCounts.needs_exploration > 0) reasons.push(`${readinessCounts.needs_exploration} task(s) need exploration`);
  }
  return {
    workId: parsed.project.id,
    projectDir,
    status: complete ? 'complete' : parsed.project.status,
    complete,
    closure,
    next: shaped,
    openReasons: reasons,
    readinessCounts,
    validationErrors: parsed.errors,
    warnings: parsed.warnings,
  };
}

function findCloseTarget(parsed, targetId) {
  const taskMatches = [...parsed.tasks.values()].filter((t) => t.id === targetId);
  const runNodeMatches = [...parsed.runNodes.values()].filter((n) => n.id === targetId);
  const totalMatches = taskMatches.length + runNodeMatches.length;
  if (totalMatches === 0) {
    throw new Error(`No task or run node found with id '${targetId}' in work ${parsed.project.id}`);
  }
  if (totalMatches > 1) {
    const taskIds = taskMatches.map((t) => `${t.taskGroupVersionId}:${t.id}`).join(', ');
    const nodeIds = runNodeMatches.map((n) => `${n.runId}:${n.id}`).join(', ');
    throw new Error(`Id '${targetId}' is ambiguous; tasks=[${taskIds}] runNodes=[${nodeIds}]`);
  }
  if (taskMatches.length === 1) return { type: 'task', task: taskMatches[0] };
  return { type: 'runNode', runNode: runNodeMatches[0] };
}

const RUN_NODE_OVERRIDE_REASONS = new Set(['manual_verified', 'manual_close', 'failure', 'superseded', 'cancelled']);
const DELEGATION_OVERRIDE_REASONS = new Set(['manual_verified', 'cancelled', 'superseded']);

export function closeTarget(workDir, targetId, { reason = null } = {}) {
  if (!targetId) throw new Error('Missing close target id');
  const projectDir = resolveSingleProject(workDir);
  const parsed = parseProject(projectDir);
  if (parsed.errors.length > 0) {
    throw new Error(`TaskOps work has validation errors; refuse to close until resolved:\n- ${parsed.errors.join('\n- ')}`);
  }
  const target = findCloseTarget(parsed, targetId);
  const declaredAt = isoNow();
  const declaredReason = reason && String(reason).trim().length > 0 ? String(reason).trim() : 'manual_close';

  if (target.type === 'task') {
    const task = target.task;
    const existing = [...parsed.eowNodes.values()].find((e) => e.graphType === 'task' && e.attachedToId === task.id && e.taskGroupVersionId === task.taskGroupVersionId);
    if (existing) throw new Error(`Task '${task.id}' (version ${task.taskGroupVersionId}) already closed by EoW '${existing.id}'`);

    if (task.childTaskGroupId) {
      const activeSnapshot = parsed.project.activeSnapshotId ? parsed.snapshots.get(parsed.project.activeSnapshotId) : null;
      const selectedPair = (activeSnapshot?.selectedVersions || []).find((p) => p && p.taskGroupId === task.childTaskGroupId);
      if (selectedPair) {
        const childVersion = parsed.versions.get(selectedPair.versionId);
        if (childVersion) {
          const openChildren = childVersion.tasks.filter((t) => !['done', 'cancelled'].includes(t.status));
          if (openChildren.length > 0) {
            throw new Error(`Task '${task.id}' has ${openChildren.length} open child task(s) in selected version '${selectedPair.versionId}'; close children before closing parent`);
          }
          const selectedTgIds = new Set((activeSnapshot.selectedVersions || []).map((p) => p && p.taskGroupId));
          const unclosedTerminals = childVersion.tasks.filter((t) => {
            const branchContinues = t.childTaskGroupId && selectedTgIds.has(t.childTaskGroupId);
            if (branchContinues) return false;
            return !parsed.eowNodes ? true : ![...parsed.eowNodes.values()].some((e) => e.graphType === 'task' && e.attachedToId === t.id && e.taskGroupVersionId === childVersion.id);
          });
          if (unclosedTerminals.length > 0) {
            throw new Error(`Task '${task.id}' has ${unclosedTerminals.length} child terminal task(s) without EoW (e.g. '${unclosedTerminals[0].id}'); close children first`);
          }
        }
      }
    }

    if (task.status !== 'done' && declaredReason !== 'manual_verified') {
      throw new Error(`Task '${task.id}' status is '${task.status}'; refuse to close. Mark the task done first, or pass --reason manual_verified to attest closure.`);
    }

    const statusFlipped = task.status !== 'done' && declaredReason === 'manual_verified';
    if (statusFlipped) {
      rewriteFrontmatter(task.path, (fm) => {
        fm.status = 'done';
        fm.runReadinessReason = sanitizeFmScalar(`Closed by taskops close --reason manual_verified at ${declaredAt}.`);
        return fm;
      });
    }

    const eowId = `eow-${task.id}`;
    const versionDir = dirname(dirname(task.path));
    const eowDir = join(versionDir, 'eow');
    ensureDir(eowDir);
    const eowPath = join(eowDir, `${eowId}.md`);
    if (existsSync(eowPath)) throw new Error(`Refusing to overwrite existing EoW file at ${eowPath}`);
    const eowFm = {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: eowId,
      graphType: 'task',
      attachedToType: 'task',
      attachedToId: task.id,
      taskGroupVersionId: task.taskGroupVersionId,
      reason: sanitizeFmScalar(declaredReason),
      declaredBy: 'taskops-close',
      declaredAt,
      createdAt: declaredAt,
      status: 'done',
    };
    writeFileSync(eowPath, fmBlock(eowFm) + `# EoW: ${task.id}\n`, 'utf8');
    return {
      workId: parsed.project.id,
      projectDir,
      target: { type: 'task', id: task.id, taskGroupId: task.taskGroupId, taskGroupVersionId: task.taskGroupVersionId },
      eowId,
      eowPath,
      reason: declaredReason,
      statusFlipped,
      closed: true,
    };
  }

  const node = target.runNode;
  const existing = [...parsed.eowNodes.values()].find((e) => e.graphType === 'run' && e.runId === node.runId && e.attachedToId === node.id);
  if (existing) throw new Error(`Run node '${node.runId}/${node.id}' already closed by EoW '${existing.id}'`);

  const statusOk = ['done', 'cancelled'].includes(node.status);
  if (!statusOk && !RUN_NODE_OVERRIDE_REASONS.has(declaredReason)) {
    throw new Error(`Run node '${node.runId}/${node.id}' status is '${node.status}'; refuse to close. Use --reason failure|superseded|cancelled|manual_verified to attest closure.`);
  }
  if (node.type === 'delegate' && node.status === 'waiting' && !DELEGATION_OVERRIDE_REASONS.has(declaredReason)) {
    throw new Error(`Run node '${node.runId}/${node.id}' is a pending delegation (status=waiting); use --reason manual_verified|cancelled|superseded to attest closure.`);
  }

  const runDir = join(projectDir, 'runs', node.runId);
  const eowId = `eow-${node.id}`;
  const eowPath = join(runDir, 'nodes', `${eowId}.md`);
  if (existsSync(eowPath)) throw new Error(`Refusing to overwrite existing EoW file at ${eowPath}`);
  const eowFm = {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: eowId,
    runId: node.runId,
    graphType: 'run',
    attachedToType: 'runNode',
    attachedToId: node.id,
    reason: sanitizeFmScalar(declaredReason),
    declaredBy: 'taskops-close',
    declaredAt,
    createdAt: declaredAt,
    status: 'done',
  };
  writeFileSync(eowPath, fmBlock(eowFm) + `# EoW: ${node.id}\n`, 'utf8');
  const edgeId = `edge-${node.id}-to-eow`;
  const edgePath = join(runDir, 'edges', `${edgeId}.md`);
  if (!existsSync(edgePath)) {
    const edgeFm = {
      taskOpsVersion: 'v1',
      entityType: 'runEdge',
      id: edgeId,
      runId: node.runId,
      fromRunNodeId: node.id,
      toRunNodeId: eowId,
      edgeType: 'closes_with',
      createdAt: declaredAt,
      status: 'done',
    };
    writeFileSync(edgePath, fmBlock(edgeFm) + `# Run edge: ${node.id} closes with EoW\n`, 'utf8');
  }
  return {
    workId: parsed.project.id,
    projectDir,
    target: { type: 'runNode', runId: node.runId, id: node.id },
    eowId,
    eowPath,
    edgePath,
    reason: declaredReason,
    closed: true,
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

  const loopbackPolicy = options.loopback == null || options.loopback === '' ? 'none' : String(options.loopback).trim().toLowerCase();
  if (!LOOPBACK_POLICIES.includes(loopbackPolicy)) {
    throw new Error(`Invalid --loopback '${options.loopback}'. Allowed: ${LOOPBACK_POLICIES.join(', ')}`);
  }
  let maxLoopbacks = DEFAULT_MAX_LOOPBACKS;
  if (options.maxLoopbacks != null) {
    const n = Number(options.maxLoopbacks);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid --max-loopbacks '${options.maxLoopbacks}'`);
    maxLoopbacks = Math.floor(n);
  }
  if (loopbackPolicy === 'none') maxLoopbacks = 0;
  const actorName = options.actor && String(options.actor).trim()
    ? String(options.actor).trim()
    : (executor === 'openclaw-agent' ? agentId : 'taskops-runner');
  const targetTaskId = options.targetTaskId || null;
  const targetTaskGroupVersionId = options.targetTaskGroupVersionId || null;

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
      loopbackPolicy, maxLoopbacks, actorName,
    });
    appendRunLog(runDir, `${startedAt} runner_started workId=${parsed.project.id} runId=${runId} executor=${executor}${loopbackPolicy !== 'none' ? ` loopbackPolicy=${loopbackPolicy} maxLoopbacks=${maxLoopbacks}` : ''}`);

    let stepsRun = 0;
    let loopbacksUsed = 0;
    let stopReason = null;
    let stopDetail = null;
    let stopSource = null;
    const actions = [];

    while (true) {
      if (until != null && Date.now() >= until) { stopReason = STOP_REASONS.DEADLINE_REACHED; break; }
      if (maxSteps != null && stepsRun >= maxSteps) { stopReason = STOP_REASONS.MAX_STEPS; break; }

      recheckBlockedTasks(projectDir);
      parsed = parseProject(projectDir);
      if (parsed.errors.length > 0) {
        stopReason = STOP_REASONS.VALIDATION_FAILED;
        logEvent(eventsPath, { timestamp: isoNow(), type: 'validation_failed', runId, errors: parsed.errors });
        break;
      }

      const next = pickNextAction(parsed, {
        taskId: targetTaskId,
        taskGroupVersionId: targetTaskGroupVersionId,
      });
      if (next.kind === 'stop') {
        if (
          next.reason === STOP_REASONS.DELEGATION_PENDING
          && loopbackPolicy === 'self'
          && next.source?.type === 'runNode'
          && next.source?.runId
          && next.source?.id
        ) {
          const delegateKey = `${next.source.runId}:${next.source.id}`;
          const delegate = parsed.runNodes.get(delegateKey);
          if (delegate && delegate.type === 'delegate') {
            if (loopbacksUsed >= maxLoopbacks) {
              stopReason = STOP_REASONS.MAX_LOOPBACKS;
              stopDetail = `Loopback budget exhausted at ${loopbacksUsed}/${maxLoopbacks}; pending delegate ${delegate.runId}/${delegate.id} still open.`;
              stopSource = { type: 'runNode', runId: delegate.runId, id: delegate.id };
              logEvent(eventsPath, { timestamp: isoNow(), type: stopReason, runId, detail: stopDetail, source: stopSource });
              appendRunLog(runDir, `${isoNow()} ${stopReason} ${stopDetail}`);
              break;
            }
            let stepTimeoutMs = taskTimeoutMs;
            if (until != null) {
              const remaining = until - Date.now();
              if (remaining <= 0) { stopReason = STOP_REASONS.DEADLINE_REACHED; break; }
              if (stepTimeoutMs == null || remaining < stepTimeoutMs) stepTimeoutMs = remaining;
            }
            loopbacksUsed += 1;
            const loopbackResult = executeSelfLoopback({
              projectDir, project: parsed.project, delegate,
              runDir, runId, eventsPath, executor, agentId, stepTimeoutMs,
              loopbackIndex: loopbacksUsed, actorName,
            });
            actions.push(loopbackResult);
            stepsRun += 1;
            if (loopbackResult.status === 'failed') { stopReason = STOP_REASONS.TASK_FAILED; break; }
            continue;
          }
        }
        stopReason = next.reason;
        stopDetail = next.detail || null;
        stopSource = next.source || null;
        if (
          stopReason === STOP_REASONS.WAITING
          || stopReason === STOP_REASONS.DELEGATION_PENDING
          || stopReason === STOP_REASONS.BLOCKED_ONLY
          || stopReason === STOP_REASONS.ALL_CLOSED
        ) {
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
        if (
          stepResult.status === 'completed'
          && stepResult.childTaskGroupId
          && stepResult.versionId
        ) {
          const extended = extendActiveSnapshot(parsed, {
            taskGroupId: stepResult.childTaskGroupId,
            versionId: stepResult.versionId,
          });
          if (extended) {
            logEvent(eventsPath, {
              timestamp: isoNow(), type: 'snapshot_extended', runId,
              snapshotId: parsed.project.activeSnapshotId,
              taskGroupId: stepResult.childTaskGroupId,
              versionId: stepResult.versionId,
              source: { taskId: stepResult.taskId, runNodeId: stepResult.runNodeId },
            });
            appendRunLog(runDir, `${isoNow()} snapshot_extended snapshotId=${parsed.project.activeSnapshotId} taskGroupId=${stepResult.childTaskGroupId} versionId=${stepResult.versionId}`);
          }
        }
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
      loopbackPolicy, maxLoopbacks, loopbacksUsed, actorName,
      eventsPath,
      tasks: actions,
      actions,
    };
  } finally {
    cleanup();
  }
}
