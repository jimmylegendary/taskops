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

function pickNextRunnable(parsed) {
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

  for (const { task } of candidates) {
    if (!['pending', 'active'].includes(task.status)) continue;
    const classification = classifyTaskReadiness(task);
    if (classification.runReadiness !== 'runnable') continue;
    return task;
  }
  return null;
}

function buildAgentPrompt({ project, task }) {
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

function invokeExecutor({ project, task, executor, agentId, stepTimeoutMs }) {
  if (executor === 'dry-run') {
    return {
      ok: true,
      message: `dry-run executor synthetically completed task ${task.id}`,
      executor: 'dry-run',
    };
  }
  if (executor === 'openclaw-agent') {
    const prompt = buildAgentPrompt({ project, task });
    const args = ['agent', '--agent', agentId, '--message', prompt, '--json'];
    if (stepTimeoutMs != null && Number.isFinite(stepTimeoutMs)) {
      args.push('--timeout', String(Math.max(1, Math.floor(stepTimeoutMs / 1000))));
    }
    const spawnOpts = { encoding: 'utf8' };
    if (stepTimeoutMs != null && Number.isFinite(stepTimeoutMs)) spawnOpts.timeout = stepTimeoutMs;
    const result = spawnSync('openclaw', args, spawnOpts);
    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();
    if (result.error) {
      return { ok: false, message: `openclaw agent invocation failed: ${result.error.message}`, executor: 'openclaw-agent', stdout, stderr };
    }
    if (result.signal === 'SIGTERM' || (result.status === null && stepTimeoutMs != null)) {
      return { ok: false, message: `openclaw agent timed out after ${stepTimeoutMs}ms`, executor: 'openclaw-agent', stdout, stderr };
    }
    if (result.status !== 0) {
      return { ok: false, message: stderr || stdout || `openclaw agent exited with status ${result.status}`, executor: 'openclaw-agent', stdout, stderr };
    }
    return { ok: true, message: stdout || `openclaw agent completed task ${task.id}`, executor: 'openclaw-agent', stdout, stderr };
  }
  return { ok: false, message: `Unknown executor '${executor}'`, executor };
}

function executeOneTask({ project, task, runDir, runId, eventsPath, executor, agentId, stepTimeoutMs }) {
  const startedAt = isoNow();
  const runNodeId = `run-node-${task.id}`;
  const runNodePath = join(runDir, 'nodes', `${runNodeId}.md`);

  if (!existsSync(runNodePath)) {
    const nodeFm = {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id: runNodeId,
      runId,
      type: 'implementation',
      title: task.title,
      status: 'active',
      sourceTaskId: task.id,
      sourceTaskGroupVersionId: task.taskGroupVersionId,
      createdAt: startedAt,
    };
    writeFileSync(runNodePath, fmBlock(nodeFm) + `# Run node: ${task.id}\n`, 'utf8');
  } else {
    rewriteFrontmatter(runNodePath, (fm) => {
      fm.status = 'active';
      return fm;
    });
  }

  rewriteFrontmatter(task.path, (fm) => {
    if (fm.status === 'pending') fm.status = 'active';
    const refs = Array.isArray(fm.runRefs) ? [...fm.runRefs] : [];
    const exists = refs.some((r) => r && r.runId === runId && r.runNodeId === runNodeId);
    if (!exists) refs.push({ runId, runNodeId, role: 'primary_execution' });
    fm.runRefs = refs;
    return fm;
  });

  logEvent(eventsPath, {
    timestamp: startedAt,
    type: 'task_selected',
    runId,
    taskId: task.id,
    taskGroupVersionId: task.taskGroupVersionId,
    runNodeId,
  });
  logEvent(eventsPath, {
    timestamp: startedAt,
    type: 'task_started',
    runId,
    taskId: task.id,
    taskGroupVersionId: task.taskGroupVersionId,
    runNodeId,
    executor,
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
    rewriteFrontmatter(task.path, (fm) => {
      fm.status = 'done';
      return fm;
    });
    rewriteFrontmatter(runNodePath, (fm) => {
      fm.status = 'done';
      return fm;
    });

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
        reason: 'no_further_decomposition',
        declaredBy: 'taskops-runner',
        declaredAt: finishedAt,
        createdAt: finishedAt,
        status: 'done',
      };
      writeFileSync(eowTaskPath, fmBlock(eowFm) + `# EoW: ${task.id}\n`, 'utf8');
    }

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
        reason: 'execution_path_closed',
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

    logEvent(eventsPath, {
      timestamp: finishedAt,
      type: 'task_completed',
      runId,
      taskId: task.id,
      taskGroupVersionId: task.taskGroupVersionId,
      runNodeId,
      executor,
      message: result.message || null,
    });
    appendRunLog(runDir, `${finishedAt} task_completed taskId=${task.id} runNodeId=${runNodeId}`);

    return { taskId: task.id, runNodeId, status: 'completed', executor, message: result.message || null };
  }

  rewriteFrontmatter(task.path, (fm) => {
    fm.status = 'blocked';
    fm.lastRunFailureReason = sanitizeFmScalar(result.message);
    return fm;
  });
  rewriteFrontmatter(runNodePath, (fm) => {
    fm.status = 'blocked';
    return fm;
  });
  logEvent(eventsPath, {
    timestamp: finishedAt,
    type: 'task_failed',
    runId,
    taskId: task.id,
    taskGroupVersionId: task.taskGroupVersionId,
    runNodeId,
    executor,
    message: result.message || null,
  });
  appendRunLog(runDir, `${finishedAt} task_failed taskId=${task.id} reason=${result.message || ''}`);

  return { taskId: task.id, runNodeId, status: 'failed', executor, message: result.message || null };
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
      timestamp: startedAt,
      type: 'runner_started',
      workId: parsed.project.id,
      runId,
      executor,
      agentId: executor === 'openclaw-agent' ? agentId : null,
      maxSteps,
      until: until != null ? new Date(until).toISOString() : null,
    });
    appendRunLog(runDir, `${startedAt} runner_started workId=${parsed.project.id} runId=${runId} executor=${executor}`);

    let stepsRun = 0;
    let stopReason = null;
    const executedTasks = [];

    while (true) {
      if (until != null && Date.now() >= until) { stopReason = STOP_REASONS.DEADLINE_REACHED; break; }
      if (maxSteps != null && stepsRun >= maxSteps) { stopReason = STOP_REASONS.MAX_STEPS; break; }

      parsed = parseProject(projectDir);
      if (parsed.errors.length > 0) {
        stopReason = STOP_REASONS.VALIDATION_FAILED;
        logEvent(eventsPath, {
          timestamp: isoNow(),
          type: 'validation_failed',
          runId,
          errors: parsed.errors,
        });
        break;
      }

      const task = pickNextRunnable(parsed);
      if (!task) { stopReason = STOP_REASONS.NO_RUNNABLE; break; }

      let stepTimeoutMs = taskTimeoutMs;
      if (until != null) {
        const remaining = until - Date.now();
        if (remaining <= 0) { stopReason = STOP_REASONS.DEADLINE_REACHED; break; }
        if (stepTimeoutMs == null || remaining < stepTimeoutMs) stepTimeoutMs = remaining;
      }

      const stepResult = executeOneTask({
        project: parsed.project,
        task,
        runDir,
        runId,
        eventsPath,
        executor,
        agentId,
        stepTimeoutMs,
      });
      executedTasks.push(stepResult);
      stepsRun += 1;

      if (stepResult.status === 'failed') { stopReason = STOP_REASONS.TASK_FAILED; break; }
    }

    if (!stopReason) stopReason = STOP_REASONS.NO_RUNNABLE;

    const stoppedAt = isoNow();
    logEvent(eventsPath, {
      timestamp: stoppedAt,
      type: 'runner_stopped',
      runId,
      workId: parsed.project.id,
      stopReason,
      stepsRun,
    });
    appendRunLog(runDir, `${stoppedAt} runner_stopped stopReason=${stopReason} stepsRun=${stepsRun}`);

    return {
      workId: parsed.project.id,
      runId,
      stopReason,
      stepsRun,
      maxSteps,
      until: until != null ? new Date(until).toISOString() : null,
      executor,
      eventsPath,
      tasks: executedTasks,
    };
  } finally {
    cleanup();
  }
}
