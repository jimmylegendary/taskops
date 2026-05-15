#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyTaskReadiness,
  discoverProjects,
  findTaskById,
  gitStatus,
  initProject,
  initVaultRepo,
  parseProject,
  restartFromTask,
  summarizeProject,
  syncVaultRepo,
  watchAndSyncVault,
  writeSummary,
  writeVersionFromSpec,
} from '../lib-taskops.js';
import { closeTarget, computeNextAction, explainWork, recheckBlockedTasks, runTaskOps } from '../lib-runner.js';

function usage() {
  console.log(`TaskOps CLI

Usage:
  taskops init <dir> --id <work-id> --title <title> --objective <objective> [--language <code>]
  taskops vault-init <vault-dir> [--repo-url <url>] [--branch <branch>] [--auto-sync true|false] [--language <code>] [--debounce-ms <ms>] [--commit-message <msg>]
  taskops validate <path>
  taskops summary <path> [--write]
  taskops show <path> [--json]
  taskops classify-runnable <work-dir> <task-id> [--json]
  taskops next <work-dir> [--json]
  taskops explain <work-dir> [--json]
  taskops close <work-dir> <run-node-id|task-id> [--reason <reason>] [--json]
  taskops unblock-check <work-dir> [--dry-run] [--json]
  taskops run <work-dir> [--run-id <id>] [--agent <agent-id>] [--executor dry-run|openclaw-agent] [--max-steps <n>] [--until <timestamp>] [--timeout <seconds>] [--loopback none|self] [--max-loopbacks <n>] [--actor <name>] [--json]
  taskops restart <work-dir> --from <task-id> [--instruction <text>] [--instruction-file <path>] [--reason <text>] [--json]
  taskops decompose <work-dir> --task-group-id <id> --spec <spec.json>
  taskops refactor <work-dir> --task-group-id <id> --spec <spec.json> --supersedes <version-id>
  taskops git-status <vault-dir>
  taskops git-sync <vault-dir> [--message <msg>] [--branch <branch>]
  taskops watch-sync <vault-dir> [--message <msg>] [--debounce-ms <ms>] [--branch <branch>]
`);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) flags[key] = true;
      else {
        flags[key] = next;
        i += 1;
      }
    } else positional.push(arg);
  }
  return { positional, flags };
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function requireFlag(flags, key) {
  if (!flags[key] || flags[key] === true) fail(`Missing required --${key}`);
  return String(flags[key]);
}

function parseOne(pathArg) {
  const projects = discoverProjects(pathArg);
  if (projects.length !== 1) fail(`Expected exactly 1 TaskOps work under ${pathArg}, found ${projects.length}`);
  return parseProject(projects[0]);
}

function parseBool(value, fallback = true) {
  if (value == null || value === true) return fallback;
  if (String(value) === 'true') return true;
  if (String(value) === 'false') return false;
  fail(`Expected boolean value, got: ${value}`);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const cmd = positional[0];

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  usage();
  process.exit(0);
}

try {
  if (cmd === 'init') {
    const dir = positional[1];
    if (!dir) fail('Missing init target directory');
    const root = initProject(dir, {
      id: requireFlag(flags, 'id'),
      title: requireFlag(flags, 'title'),
      objective: requireFlag(flags, 'objective'),
      language: flags.language && flags.language !== true ? String(flags.language) : null,
    });
    console.log(root);
    process.exit(0);
  }

  if (cmd === 'vault-init') {
    const dir = positional[1];
    if (!dir) fail('Missing vault-init target directory');
    const result = initVaultRepo(dir, {
      repoUrl: flags['repo-url'] && flags['repo-url'] !== true ? String(flags['repo-url']) : null,
      branch: flags.branch && flags.branch !== true ? String(flags.branch) : 'main',
      autoSync: parseBool(flags['auto-sync'], true),
      language: flags.language && flags.language !== true ? String(flags.language) : 'en',
      debounceMs: flags['debounce-ms'] ? Number(flags['debounce-ms']) : 5000,
      commitMessage: flags['commit-message'] && flags['commit-message'] !== true ? String(flags['commit-message']) : 'TaskOps auto-sync',
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (cmd === 'validate') {
    const pathArg = positional[1];
    if (!pathArg) fail('Missing validate path');
    const projects = discoverProjects(pathArg);
    let errorCount = 0;
    for (const projectDir of projects) {
      const parsed = parseProject(projectDir);
      if (parsed.errors.length === 0) {
        console.log(`OK ${parsed.project.id} (${projectDir})`);
      } else {
        console.error(`FAIL ${parsed.project.id} (${projectDir})`);
        for (const error of parsed.errors) console.error(`- ${error}`);
        errorCount += parsed.errors.length;
      }
      for (const warning of parsed.warnings) console.error(`WARN ${warning}`);
    }
    process.exit(errorCount === 0 ? 0 : 1);
  }

  if (cmd === 'summary') {
    const pathArg = positional[1];
    if (!pathArg) fail('Missing summary path');
    const parsed = parseOne(pathArg);
    const summary = summarizeProject(parsed);
    if (flags.write) {
      const out = writeSummary(parsed);
      console.log(out);
    } else {
      process.stdout.write(summary);
    }
    process.exit(parsed.errors.length === 0 ? 0 : 1);
  }

  if (cmd === 'show') {
    const pathArg = positional[1];
    if (!pathArg) fail('Missing show path');
    const parsed = parseOne(pathArg);
    const plain = {
      projectDir: parsed.projectDir,
      project: parsed.project,
      taskGroups: [...parsed.taskGroups.values()].map((tg) => ({
        id: tg.id,
        objective: tg.objective,
        activeVersionId: tg.activeVersionId ?? null,
        versions: tg.versions.map((v) => ({ id: v.id, summary: v.summary, selected: v.selected === true, taskCount: v.tasks.length })),
      })),
      snapshots: [...parsed.snapshots.values()],
      runs: [...parsed.runs.values()],
      runNodes: [...parsed.runNodes.values()],
      runEdges: [...parsed.runEdges.values()],
      eowNodes: [...parsed.eowNodes.values()],
      closure: parsed.closure,
      errors: parsed.errors,
      warnings: parsed.warnings,
    };
    if (flags.json) console.log(JSON.stringify(plain, null, 2));
    else process.stdout.write(summarizeProject(parsed));
    process.exit(parsed.errors.length === 0 ? 0 : 1);
  }

  if (cmd === 'classify-runnable') {
    const pathArg = positional[1];
    const taskId = positional[2];
    if (!pathArg) fail('Missing classify-runnable project dir');
    if (!taskId) fail('Missing classify-runnable task id');
    const parsed = parseOne(pathArg);
    const task = findTaskById(parsed, taskId);
    const classification = classifyTaskReadiness(task);
    const payload = { projectId: parsed.project.id, task, classification };
    if (flags.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`${task.id}: ${classification.runReadiness}`);
      console.log(`reason: ${classification.reason}`);
      console.log(`next_action: ${classification.nextAction}`);
    }
    process.exit(parsed.errors.length === 0 ? 0 : 1);
  }

  if (cmd === 'next') {
    const workDir = positional[1];
    if (!workDir) fail('Missing next work-dir');
    const result = computeNextAction(workDir);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`work=${result.workId} action=${result.action}`);
      if (result.target) {
        const t = result.target;
        const targetStr = t.type === 'runNode' ? `runNode:${t.runId || '?'}/${t.id}` : `${t.type}:${t.id}`;
        console.log(`target=${targetStr}`);
      }
      if (result.reason) console.log(`reason=${result.reason}`);
      if (result.stopReason) console.log(`stopReason=${result.stopReason}`);
      console.log(`command=${result.command}`);
    }
    process.exit(0);
  }

  if (cmd === 'explain') {
    const workDir = positional[1];
    if (!workDir) fail('Missing explain work-dir');
    const result = explainWork(workDir);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      const c = result.closure || {};
      console.log(`work=${result.workId} status=${result.status} complete=${result.complete}`);
      console.log(`closure: terminalTaskEow=${c.terminalTaskEowCount ?? 0}/${c.terminalTaskCount ?? 0} runTerminalEow=${c.runTerminalEowCount ?? 0}/${c.runTerminalNodeCount ?? 0} blockers=${c.openBlockerCount ?? 0} waiting=${c.waitingDelegationCount ?? 0}`);
      if (result.complete) {
        console.log('All branches closed by EoW. Work is complete.');
      } else {
        const n = result.next;
        console.log(`next: action=${n.action}${n.stopReason ? ` stopReason=${n.stopReason}` : ''}${n.target ? ` target=${n.target.type}:${n.target.runId ? n.target.runId + '/' : ''}${n.target.id}` : ''}`);
        if (n.reason) console.log(`reason: ${n.reason}`);
        console.log(`command: ${n.command}`);
        if (result.openReasons.length > 0) {
          console.log('open reasons:');
          for (const r of result.openReasons) console.log(`- ${r}`);
        }
      }
      if (result.validationErrors.length > 0) {
        console.log('validation errors:');
        for (const e of result.validationErrors) console.log(`- ${e}`);
      }
    }
    process.exit(0);
  }

  if (cmd === 'close') {
    const workDir = positional[1];
    const targetId = positional[2];
    if (!workDir) fail('Missing close work-dir');
    if (!targetId) fail('Missing close target id');
    const reason = flags.reason && flags.reason !== true ? String(flags.reason) : null;
    const result = closeTarget(workDir, targetId, { reason });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      const t = result.target;
      const targetStr = t.type === 'runNode' ? `runNode ${t.runId}/${t.id}` : `task ${t.id} (version ${t.taskGroupVersionId})`;
      console.log(`closed ${targetStr} via EoW '${result.eowId}' (reason=${result.reason})`);
      console.log(result.eowPath);
    }
    process.exit(0);
  }

  if (cmd === 'unblock-check') {
    const workDir = positional[1];
    if (!workDir) fail('Missing unblock-check work-dir');
    const result = recheckBlockedTasks(workDir, { dryRun: flags['dry-run'] === true });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`checked=${result.checked.length} unblocked=${result.unblocked.length} stillBlocked=${result.stillBlocked.length} dryRun=${result.dryRun}`);
      for (const item of result.unblocked) console.log(`- unblocked ${item.taskId}`);
      for (const item of result.stillBlocked) console.log(`- still_blocked ${item.taskId}: ${item.blockers.filter((b) => !b.resolved).map((b) => b.detail).join('; ')}`);
    }
    process.exit(0);
  }

  if (cmd === 'run') {
    const workDir = positional[1];
    if (!workDir) fail('Missing run work-dir');
    const result = runTaskOps(workDir, {
      runId: flags['run-id'] && flags['run-id'] !== true ? String(flags['run-id']) : null,
      agent: flags.agent && flags.agent !== true ? String(flags.agent) : null,
      executor: flags.executor && flags.executor !== true ? String(flags.executor) : null,
      maxSteps: flags['max-steps'] != null && flags['max-steps'] !== true ? flags['max-steps'] : null,
      until: flags.until && flags.until !== true ? String(flags.until) : null,
      timeout: flags.timeout != null && flags.timeout !== true ? flags.timeout : null,
      loopback: flags.loopback && flags.loopback !== true ? String(flags.loopback) : null,
      maxLoopbacks: flags['max-loopbacks'] != null && flags['max-loopbacks'] !== true ? flags['max-loopbacks'] : null,
      actor: flags.actor && flags.actor !== true ? String(flags.actor) : null,
    });
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`workId=${result.workId} runId=${result.runId} executor=${result.executor} stopReason=${result.stopReason} stepsRun=${result.stepsRun}`);
      if (result.maxSteps != null) console.log(`maxSteps=${result.maxSteps}`);
      if (result.until) console.log(`until=${result.until}`);
      if (result.loopbackPolicy && result.loopbackPolicy !== 'none') {
        console.log(`loopbackPolicy=${result.loopbackPolicy} loopbacksUsed=${result.loopbacksUsed}/${result.maxLoopbacks}`);
      }
      if (result.stopDetail) console.log(`stopDetail=${result.stopDetail}`);
      console.log(`events=${result.eventsPath}`);
      for (const t of result.actions || result.tasks || []) {
        const kind = t.kind ? `[${t.kind}] ` : '';
        const extra = t.childTaskGroupId ? ` childTaskGroup=${t.childTaskGroupId}` : (t.artifactPath ? ` artifact=${t.artifactPath}` : '');
        console.log(`- ${kind}task ${t.taskId} -> ${t.status} (runNode=${t.runNodeId})${extra}${t.message ? `: ${t.message}` : ''}`);
      }
    }
    process.exit(result.stopReason === 'task_failed' || result.stopReason === 'validation_failed' ? 1 : 0);
  }

  if (cmd === 'restart') {
    const workDir = positional[1];
    if (!workDir) fail('Missing restart work-dir');
    const fromTaskId = requireFlag(flags, 'from');
    const instruction = flags.instruction && flags.instruction !== true ? String(flags.instruction) : null;
    const instructionFile = flags['instruction-file'] && flags['instruction-file'] !== true ? String(flags['instruction-file']) : null;
    if (!instruction && !instructionFile) fail('Missing --instruction or --instruction-file');
    const reason = flags.reason && flags.reason !== true ? String(flags.reason) : null;
    const result = restartFromTask(workDir, { fromTaskId, instruction, instructionFile, reason });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`workId=${result.workId} taskGroup=${result.taskGroupId} from=${result.fromVersionId} to=${result.toVersionId} fromTask=${result.fromTaskId}`);
      console.log(`preservedTasks=${result.preservedTaskCount} resetTasks=${result.resetTaskCount} snapshot=${result.snapshotId}`);
      if (result.reason) console.log(`reason=${result.reason}`);
      console.log(`newVersionDir=${result.newVersionDir}`);
    }
    process.exit(0);
  }

  if (cmd === 'decompose' || cmd === 'refactor') {
    const projectDir = resolve(positional[1] || '');
    if (!projectDir) fail(`Missing ${cmd} project dir`);
    const taskGroupId = requireFlag(flags, 'task-group-id');
    const specPath = resolve(requireFlag(flags, 'spec'));
    const spec = JSON.parse(readFileSync(specPath, 'utf8'));
    const supersedes = cmd === 'refactor' ? requireFlag(flags, 'supersedes') : null;
    const out = writeVersionFromSpec(projectDir, taskGroupId, spec, { supersedesVersionId: supersedes });
    console.log(out);
    process.exit(0);
  }

  if (cmd === 'git-status') {
    const dir = positional[1];
    if (!dir) fail('Missing git-status vault dir');
    console.log(JSON.stringify(gitStatus(dir, { branch: flags.branch ? String(flags.branch) : null }), null, 2));
    process.exit(0);
  }

  if (cmd === 'git-sync') {
    const dir = positional[1];
    if (!dir) fail('Missing git-sync vault dir');
    const result = syncVaultRepo(dir, {
      message: flags.message && flags.message !== true ? String(flags.message) : 'TaskOps sync',
      branch: flags.branch ? String(flags.branch) : null,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (cmd === 'watch-sync') {
    const dir = positional[1];
    if (!dir) fail('Missing watch-sync vault dir');
    watchAndSyncVault(dir, {
      message: flags.message && flags.message !== true ? String(flags.message) : 'TaskOps watch-sync',
      debounceMs: flags['debounce-ms'] ? Number(flags['debounce-ms']) : 5000,
      branch: flags.branch ? String(flags.branch) : null,
    });
    console.log(`Watching ${resolve(dir)} for TaskOps git auto-sync changes...`);
    process.stdin.resume();
    await new Promise(() => {});
  }

  fail(`Unknown command: ${cmd}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
