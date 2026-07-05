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
  planPartialPromotions,
  promotePartialCompletions,
  restartFromTask,
  summarizeProject,
  syncVaultRepo,
  watchAndSyncVault,
  writeSummary,
  writeVersionFromSpec,
} from '../lib-taskops.js';
import { auditParsedWork, renderAuditText } from '../lib-audit.js';
import { extractTrainingData, summarizeTrainingData } from '../lib-trainingdata.js';
import { closeTarget, computeNextAction, explainWork, recheckBlockedTasks, reviewTarget, runTaskOps } from '../lib-runner.js';

function usage() {
  console.log(`TaskOps CLI

Usage:
  taskops init <dir> --id <work-id> --title <title> --objective <objective> [--language <code>]
  taskops vault-init <vault-dir> [--repo-url <url>] [--branch <branch>] [--auto-sync true|false] [--language <code>] [--debounce-ms <ms>] [--commit-message <msg>]
  taskops validate <path>
  taskops audit <work-dir> [--strict] [--max-tasks-flat <n>] [--json]
  taskops trainingdata <work-dir> [--summary]
  taskops summary <path> [--write]
  taskops show <path> [--json]
  taskops classify-runnable <work-dir> <task-id> [--json]
  taskops next <work-dir> [--json]
  taskops explain <work-dir> [--json]
  taskops review <work-dir> <run-node-id|task-id> [--json]
  taskops close <work-dir> <run-node-id|task-id> [--reason <reason>] [--completed-summary <text>] [--incomplete-summary <text>] [--json]
  taskops promote-partials <work-dir> [--dry-run|--apply] [--partial-id <id>] [--max-follow-up-depth <n>] [--repeat-threshold <n>] [--json]
  taskops unblock-check <work-dir> [--dry-run] [--json]
  taskops run <work-dir> [--run-id <id>] [--agent <agent-id>] [--executor dry-run|openclaw-agent] [--max-steps <n>] [--until <timestamp>] [--timeout <seconds>] [--delegate] [--verify-checks] [--verify-retries <n>] [--continue-on-failure] [--self-guide-file <path>] [--loopback none|self] [--max-loopbacks <n>] [--max-parallel <n>] [--actor <name>] [--json]
  taskops delegate <work-dir> [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--runner-id <id>] [--run-id <id>] [--loopback self] [--max-parallel <n>] [--max-steps <n>] [--max-loopbacks <n>] [--timeout <seconds>] [--verify-checks] [--verify-retries <n>] [--foreground] [--unattended] [--no-start] [--dry-run] [--json]
  taskops queue sync <work-dir> [--json]
  taskops queue list <work-dir> [--json]
  taskops queue claim <work-dir> [--runner-id <id>] [--ttl-seconds <n>] [--max-attempts <n>] [--json]
  taskops queue heartbeat <work-dir> <lease-id> [--ttl-seconds <n>] [--json]
  taskops queue release <work-dir> <lease-id> [--status done|failed|cancelled] [--json]
  taskops queue reports <work-dir> [--json]
  taskops runner once <work-dir> [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--runner-id <id>] [--ttl-seconds <n>] [--max-attempts <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--timeout <seconds>] [--report-sink none|ledger|openclaw-chat-inject] [--master-session-key <key>] [--json]
  taskops runner watch <work-dir> [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--runner-id <id>] [--ttl-seconds <n>] [--max-attempts <n>] [--max-parallel <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--timeout <seconds>] [--report-sink none|ledger|openclaw-chat-inject] [--master-session-key <key>] [--poll-interval-ms <n>] [--max-waves <n>] [--max-idle-cycles <n>] [--idle-exit-after-seconds <n>] [--until <timestamp>] [--verify-checks] [--continue-on-failure] [--json]
  taskops daemon run <work-dir> [--name <name>] [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--runner-id <id>] [--run-id <id>] [--ttl-seconds <n>] [--max-attempts <n>] [--max-parallel <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--timeout <seconds>] [--report-sink none|ledger|openclaw-chat-inject] [--master-session-key <key>] [--poll-interval-ms <n>] [--daemon-poll-interval-ms <n>] [--failure-backoff-ms <n>] [--max-daemon-cycles <n>] [--verify-checks] [--verify-retries <n>] [--continue-on-failure] [--json]
  taskops daemon unit <work-dir> [--name <name>] [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--max-parallel <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--verify-checks] [--verify-retries <n>] [--json]
  taskops daemon enable <work-dir> [--name <name>] [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--max-parallel <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--verify-checks] [--verify-retries <n>] [--no-start] [--dry-run] [--json]
  taskops daemon install <work-dir> [--name <name>] [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--max-parallel <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--verify-checks] [--verify-retries <n>] [--start] [--dry-run] [--json]
  taskops daemon start|stop|restart|status|logs|uninstall <name> [--json]
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

function flagHasValue(flags, key) {
  return flags[key] != null && flags[key] !== true;
}

function maxStepsExplicitFlag(flags) {
  const internalTargetRun = flagHasValue(flags, 'target-task-id') && flags['allow-concurrent-target'] === true;
  if (internalTargetRun) return flags['max-steps-explicit'] === true || flags['max-steps-explicit'] === 'true';
  return flagHasValue(flags, 'max-steps') || flags['max-steps-explicit'] === true || flags['max-steps-explicit'] === 'true';
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

function daemonExitCode(result) {
  const failureReasons = new Set(['wave_failed', 'daemon_error']);
  return Array.isArray(result?.cycles) && result.cycles.some((cycle) => failureReasons.has(cycle.stopReason)) ? 1 : 0;
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

  if (cmd === 'audit') {
    const pathArg = positional[1];
    if (!pathArg) fail('Missing audit work-dir');
    const parsed = parseOne(pathArg);
    const maxFlatTasks = flags['max-tasks-flat'] && flags['max-tasks-flat'] !== true
      ? Number(flags['max-tasks-flat'])
      : undefined;
    if (maxFlatTasks != null && (!Number.isFinite(maxFlatTasks) || maxFlatTasks < 1)) {
      fail(`Invalid --max-tasks-flat value: ${flags['max-tasks-flat']}`);
    }
    const audit = auditParsedWork(parsed, { maxFlatTasks });
    if (flags.json) console.log(JSON.stringify(audit, null, 2));
    else process.stdout.write(renderAuditText(audit));
    const strict = flags.strict === true;
    process.exit(strict && !audit.claimSafe ? 1 : 0);
  }

  if (cmd === 'trainingdata') {
    const pathArg = positional[1];
    if (!pathArg) fail('Missing trainingdata work-dir');
    const trajectories = extractTrainingData(resolve(pathArg));
    if (flags.summary) {
      console.log(JSON.stringify(summarizeTrainingData(trajectories), null, 2));
    } else {
      // JSONL: one labeled trajectory per line — a drop-in dataset shard.
      for (const t of trajectories) console.log(JSON.stringify(t));
    }
    process.exit(0);
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
      partialNodes: [...(parsed.partialNodes?.values() || [])],
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
      if (classification.originalRunReadiness) console.log(`original_runReadiness: ${classification.originalRunReadiness}`);
      console.log(`reason: ${classification.reason}`);
      console.log(`next_action: ${classification.nextAction}`);
      for (const issue of classification.consistencyIssues || []) {
        console.log(`${issue.severity || 'warning'}: ${issue.message}`);
      }
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
      console.log(`closureState=${c.closureState || (c.complete === true ? 'structurally_complete' : 'open')} structural=${c.structuralComplete === true} policyApproved=${c.policyApprovedComplete === true} manualAttested=${c.manualAttestedComplete === true}`);
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
    const followUpNeeded = flags['follow-up-needed'] == null
      ? true
      : !(flags['follow-up-needed'] === false || flags['follow-up-needed'] === 'false');
    const budget = flags['budget-json'] && flags['budget-json'] !== true
      ? JSON.parse(String(flags['budget-json']))
      : null;
    const result = closeTarget(workDir, targetId, {
      reason,
      completedSummary: flags['completed-summary'] && flags['completed-summary'] !== true ? String(flags['completed-summary']) : null,
      incompleteSummary: flags['incomplete-summary'] && flags['incomplete-summary'] !== true ? String(flags['incomplete-summary']) : null,
      followUpNeeded,
      budget,
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      const t = result.target;
      const targetStr = t.type === 'runNode' ? `runNode ${t.runId}/${t.id}` : `task ${t.id} (version ${t.taskGroupVersionId})`;
      if (result.partial) {
        console.log(`recorded partial ${targetStr} via marker '${result.partialId}' (reason=${result.reason})`);
        console.log(result.partialPath);
      } else {
        console.log(`closed ${targetStr} via EoW '${result.eowId}' (reason=${result.reason})`);
        console.log(result.eowPath);
      }
    }
    process.exit(0);
  }

  if (cmd === 'review') {
    const workDir = positional[1];
    const targetId = positional[2];
    if (!workDir) fail('Missing review work-dir');
    if (!targetId) fail('Missing review target id');
    const result = reviewTarget(workDir, targetId);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Reviewed ${result.target.runId}/${result.target.runNodeId} with ${result.reviewNodeId}`);
      console.log(`decision: ${result.reviewReport.decision}`);
      if (result.reviewReport.missingExpected.length > 0) {
        console.log('missing expected:');
        for (const item of result.reviewReport.missingExpected) console.log(`- ${item}`);
      }
      if (result.reviewReport.unsupportedObserved.length > 0) {
        console.log('unsupported observed:');
        for (const item of result.reviewReport.unsupportedObserved) console.log(`- ${item}`);
      }
      if (result.reviewReport.failedChecks.length > 0) {
        console.log('failed checks:');
        for (const item of result.reviewReport.failedChecks) console.log(`- ${item}`);
      }
    }
    process.exit(0);
  }

  if (cmd === 'promote-partials') {
    const workDir = positional[1];
    if (!workDir) fail('Missing promote-partials work-dir');
    const partialId = flags['partial-id'] && flags['partial-id'] !== true ? String(flags['partial-id']) : null;
    const maxFollowUpDepth = flags['max-follow-up-depth'] && flags['max-follow-up-depth'] !== true
      ? Number(flags['max-follow-up-depth'])
      : undefined;
    if (maxFollowUpDepth !== undefined && (!Number.isFinite(maxFollowUpDepth) || maxFollowUpDepth < 0)) {
      fail(`Invalid --max-follow-up-depth '${flags['max-follow-up-depth']}'`);
    }
    const partialRepeatThreshold = flags['repeat-threshold'] && flags['repeat-threshold'] !== true
      ? Number(flags['repeat-threshold'])
      : undefined;
    if (partialRepeatThreshold !== undefined && (!Number.isFinite(partialRepeatThreshold) || partialRepeatThreshold < 1)) {
      fail(`Invalid --repeat-threshold '${flags['repeat-threshold']}'`);
    }
    if (flags.apply === true && flags['dry-run'] === true) fail('Use only one of --apply or --dry-run');
    const apply = flags.apply === true;
    const result = apply
      ? promotePartialCompletions(workDir, { partialId, maxFollowUpDepth, partialRepeatThreshold, dryRun: false })
      : planPartialPromotions(workDir, { partialId, maxFollowUpDepth, partialRepeatThreshold });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`workId=${result.workId} dryRun=${result.dryRun === true} promotionCount=${result.promotionCount} skippedCount=${result.skippedCount}`);
      if (result.waveBudget) {
        console.log(`waveBudget count=${result.waveBudget.count} budget=${result.waveBudget.budget} next=${result.waveBudget.nextCount} remainingAfterApply=${result.waveBudget.remainingAfterApply} wouldExceed=${result.waveBudget.wouldExceed}`);
      }
      if (result.reason) {
        console.log(`reason=${result.reason}`);
      }
      if (result.partialRepeatThreshold != null) {
        console.log(`partialRepeatThreshold=${result.partialRepeatThreshold}`);
      }
      if (!apply) {
        console.log('note=default is dry-run; pass --apply to write a new selected version and mark promoted partials superseded.');
      }
      for (const plan of result.versionPlans) {
        console.log(`versionPlan taskGroup=${plan.taskGroupId} from=${plan.fromVersionId} to=${plan.toVersionId} promotions=${plan.promotions.length}`);
        for (const promotion of plan.promotions) {
          console.log(`- partial=${promotion.partialId} sourceTask=${promotion.sourceTaskId} followUp=${promotion.followUpTaskId} depth=${promotion.followUpDepth}`);
        }
      }
      if (result.skipped.length > 0) {
        console.log('skipped:');
        for (const skipped of result.skipped) {
          console.log(`- partial=${skipped.partialId || '(unknown)'} reason=${skipped.reason}${skipped.detail ? ` detail=${skipped.detail}` : ''}`);
        }
      }
      if (result.appliedVersionPlans?.length > 0) {
        console.log('applied:');
        for (const applied of result.appliedVersionPlans) {
          console.log(`- taskGroup=${applied.taskGroupId} from=${applied.fromVersionId} to=${applied.toVersionId} promotions=${applied.promotionCount}`);
        }
      }
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
    const loopback = flags.loopback && flags.loopback !== true ? String(flags.loopback) : null;
    const hasTarget = Boolean(flags['target-task-id'] && flags['target-task-id'] !== true);
    const runMaxStepsExplicit = maxStepsExplicitFlag(flags);
    if (loopback === 'self' && !hasTarget) {
      const { runDaemon } = await import('../lib-daemon.js');
      const executor = flags.executor && flags.executor !== true ? String(flags.executor) : 'dry-run';
      const runtimeAdapter = flags.runtime && flags.runtime !== true
        ? String(flags.runtime)
        : (executor === 'openclaw-agent' ? 'openclaw-cli' : 'dry-run');
      const result = await runDaemon(workDir, {
        name: flags.name && flags.name !== true ? String(flags.name) : null,
        runtimeAdapter,
        runnerId: flags['runner-id'] && flags['runner-id'] !== true ? String(flags['runner-id']) : null,
        runId: flags['run-id'] && flags['run-id'] !== true ? String(flags['run-id']) : null,
        maxAttempts: flags['max-attempts'] != null && flags['max-attempts'] !== true ? flags['max-attempts'] : null,
        maxParallel: flags['max-parallel'] != null && flags['max-parallel'] !== true ? flags['max-parallel'] : null,
        maxSteps: flags['max-steps'] != null && flags['max-steps'] !== true ? flags['max-steps'] : null,
        maxStepsExplicit: runMaxStepsExplicit,
        loopback: 'self',
        maxLoopbacks: flags['max-loopbacks'] != null && flags['max-loopbacks'] !== true ? flags['max-loopbacks'] : null,
        timeout: flags.timeout != null && flags.timeout !== true ? flags.timeout : null,
        reportSink: flags['report-sink'] && flags['report-sink'] !== true ? String(flags['report-sink']) : null,
        masterSessionKey: flags['master-session-key'] && flags['master-session-key'] !== true ? String(flags['master-session-key']) : null,
        agent: flags.agent && flags.agent !== true ? String(flags.agent) : null,
        actor: flags.actor && flags.actor !== true ? String(flags.actor) : null,
        pollIntervalMs: flags['poll-interval-ms'] != null && flags['poll-interval-ms'] !== true ? flags['poll-interval-ms'] : null,
        daemonPollIntervalMs: flags['daemon-poll-interval-ms'] != null && flags['daemon-poll-interval-ms'] !== true ? flags['daemon-poll-interval-ms'] : null,
        maxDaemonCycles: flags['max-daemon-cycles'] != null && flags['max-daemon-cycles'] !== true ? flags['max-daemon-cycles'] : 1,
        maxWaves: flags['max-waves'] != null && flags['max-waves'] !== true ? flags['max-waves'] : null,
        maxIdleCycles: flags['max-idle-cycles'] != null && flags['max-idle-cycles'] !== true ? flags['max-idle-cycles'] : null,
        idleExitAfterSeconds: flags['idle-exit-after-seconds'] != null && flags['idle-exit-after-seconds'] !== true ? flags['idle-exit-after-seconds'] : null,
        until: flags.until && flags.until !== true ? String(flags.until) : null,
        continueOnFailure: flags['continue-on-failure'] === true,
        onCycle: flags.json ? null : (entry) => {
          console.log(`cycle=${entry.cycle} watchId=${entry.watchId} stopReason=${entry.stopReason} waves=${entry.claimedWaves} items=${entry.claimedItems}`);
          if (entry.stopDetail) console.log(`stopDetail=${entry.stopDetail}`);
        },
      });
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`daemon=${result.name} runnerId=${result.runnerId} cycles=${result.cycles.length} stopped=${result.stopRequested ? 'signal' : 'bounded'}`);
      process.exit(daemonExitCode(result));
    }
    const selfGuideFile = flags['self-guide-file'] && flags['self-guide-file'] !== true
      ? String(flags['self-guide-file'])
      : null;
    const selfResolutionGuide = selfGuideFile != null ? readFileSync(resolve(selfGuideFile), 'utf8') : null;
    const result = runTaskOps(workDir, {
      runId: flags['run-id'] && flags['run-id'] !== true ? String(flags['run-id']) : null,
      agent: flags.agent && flags.agent !== true ? String(flags.agent) : null,
      executor: flags.executor && flags.executor !== true ? String(flags.executor) : null,
      maxSteps: flags['max-steps'] != null && flags['max-steps'] !== true ? flags['max-steps'] : null,
      maxStepsExplicit: runMaxStepsExplicit,
      until: flags.until && flags.until !== true ? String(flags.until) : null,
      timeout: flags.timeout != null && flags.timeout !== true ? flags.timeout : null,
      delegate: flags.delegate,
      selfResolutionGuide,
      loopback,
      maxLoopbacks: flags['max-loopbacks'] != null && flags['max-loopbacks'] !== true ? flags['max-loopbacks'] : null,
      actor: flags.actor && flags.actor !== true ? String(flags.actor) : null,
      targetTaskId: flags['target-task-id'] && flags['target-task-id'] !== true ? String(flags['target-task-id']) : null,
      targetTaskGroupVersionId: flags['target-task-group-version-id'] && flags['target-task-group-version-id'] !== true ? String(flags['target-task-group-version-id']) : null,
      allowConcurrentTarget: flags['allow-concurrent-target'] === true,
      verifyChecks: flags['verify-checks'] === true,
      continueOnFailure: flags['continue-on-failure'] === true,
      verifyRetries: flags['verify-retries'] != null && flags['verify-retries'] !== true ? flags['verify-retries'] : null,
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

  if (cmd === 'queue') {
    const { claimQueueItem, heartbeatLease, listProgressReports, listQueueProjection, releaseLease, syncQueueProjection } = await import('../lib-queue.js');
    const subcmd = positional[1];
    const workDir = positional[2];
    if (!subcmd) fail('Missing queue subcommand: sync, list, claim, heartbeat, release, or reports');
    if (!workDir) fail(`Missing queue ${subcmd} work-dir`);
    let result;
    if (subcmd === 'sync') result = syncQueueProjection(workDir);
    else if (subcmd === 'list') result = listQueueProjection(workDir);
    else if (subcmd === 'reports') result = listProgressReports(workDir);
    else if (subcmd === 'claim') {
      result = claimQueueItem(workDir, {
        runnerId: flags['runner-id'] && flags['runner-id'] !== true ? String(flags['runner-id']) : null,
        ttlSeconds: flags['ttl-seconds'] && flags['ttl-seconds'] !== true ? Number(flags['ttl-seconds']) : null,
        maxAttempts: flags['max-attempts'] != null && flags['max-attempts'] !== true ? flags['max-attempts'] : null,
      });
    } else if (subcmd === 'heartbeat') {
      const leaseId = positional[3];
      if (!leaseId) fail('Missing queue heartbeat lease-id');
      result = heartbeatLease(workDir, leaseId, {
        ttlSeconds: flags['ttl-seconds'] && flags['ttl-seconds'] !== true ? Number(flags['ttl-seconds']) : null,
      });
    } else if (subcmd === 'release') {
      const leaseId = positional[3];
      if (!leaseId) fail('Missing queue release lease-id');
      result = releaseLease(workDir, leaseId, {
        status: flags.status && flags.status !== true ? String(flags.status) : 'done',
      });
    }
    else fail(`Unknown queue subcommand: ${subcmd}`);

    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (Array.isArray(result.rows)) {
      console.log(`workId=${result.workId} db=${result.dbPath} rows=${result.rows.length}`);
      for (const row of result.rows) {
        const blocked = row.blocked_reason ? ` blockedReason=${row.blocked_reason}` : '';
        const failedAttempts = row.failed_attempts != null ? ` failedAttempts=${row.failed_attempts}` : '';
        console.log(`- ${row.id} task=${row.task_id} status=${row.status} readiness=${row.readiness} priority=${row.priority}${failedAttempts}${blocked}`);
      }
    } else if (Array.isArray(result.reports)) {
      console.log(`workId=${result.workId} db=${result.dbPath} reports=${result.reports.length}`);
      for (const report of result.reports) {
        console.log(`- ${report.id} wave=${report.wave_id} task=${report.task_id || '-'} status=${report.status} sink=${report.report_sink}`);
      }
    } else if (result.lease) {
      console.log(`workId=${result.workId} db=${result.dbPath} lease=${result.lease.id} status=${result.lease.status} queueItem=${result.lease.queue_item_id}`);
    } else {
      console.log(`workId=${result.workId} db=${result.dbPath} claimed=false`);
    }
    process.exit(0);
  }

  if (cmd === 'runner') {
    const { runQueueOnce, runQueueWatch } = await import('../lib-orchestrator.js');
    const subcmd = positional[1];
    const workDir = positional[2];
    if (!['once', 'watch'].includes(subcmd)) fail('Missing or unknown runner subcommand: once or watch');
    if (!workDir) fail(`Missing runner ${subcmd} work-dir`);
    const commonOptions = {
      runtimeAdapter: flags.runtime && flags.runtime !== true ? String(flags.runtime) : null,
      runnerId: flags['runner-id'] && flags['runner-id'] !== true ? String(flags['runner-id']) : null,
      ttlSeconds: flags['ttl-seconds'] && flags['ttl-seconds'] !== true ? Number(flags['ttl-seconds']) : null,
      reportSink: flags['report-sink'] && flags['report-sink'] !== true ? String(flags['report-sink']) : null,
      masterSessionKey: flags['master-session-key'] && flags['master-session-key'] !== true ? String(flags['master-session-key']) : null,
      agent: flags.agent && flags.agent !== true ? String(flags.agent) : null,
      actor: flags.actor && flags.actor !== true ? String(flags.actor) : null,
      runId: flags['run-id'] && flags['run-id'] !== true ? String(flags['run-id']) : null,
      timeout: flags.timeout != null && flags.timeout !== true ? flags.timeout : null,
      maxAttempts: flags['max-attempts'] != null && flags['max-attempts'] !== true ? flags['max-attempts'] : null,
      maxParallel: flags['max-parallel'] != null && flags['max-parallel'] !== true ? flags['max-parallel'] : null,
      maxSteps: flags['max-steps'] != null && flags['max-steps'] !== true ? flags['max-steps'] : null,
      maxStepsExplicit: maxStepsExplicitFlag(flags),
      loopback: flags.loopback && flags.loopback !== true ? String(flags.loopback) : null,
      maxLoopbacks: flags['max-loopbacks'] != null && flags['max-loopbacks'] !== true ? flags['max-loopbacks'] : null,
      verifyChecks: flags['verify-checks'] === true,
      continueOnFailure: flags['continue-on-failure'] === true,
      verifyRetries: flags['verify-retries'] != null && flags['verify-retries'] !== true ? flags['verify-retries'] : null,
    };
    if (subcmd === 'once') {
      const result = runQueueOnce(workDir, {
        ...commonOptions,
        waveId: flags['wave-id'] && flags['wave-id'] !== true ? String(flags['wave-id']) : null,
      });
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else if (!result.claimed) {
        console.log(`workId=${result.workId} claimed=false stopReason=${result.stopReason}`);
      } else {
        console.log(`workId=${result.workId} wave=${result.waveId} queueItem=${result.queueItem.id} runtime=${result.runtimeAdapter} release=${result.releaseStatus}`);
        console.log(`stopReason=${result.runResult.stopReason} stepsRun=${result.runResult.stepsRun}`);
        if (result.report) console.log(`report=${result.report.id} sink=${result.report.report_sink}`);
      }
      process.exit(result.releaseStatus === 'failed' ? 1 : 0);
    }
    const result = await runQueueWatch(workDir, {
      ...commonOptions,
      watchId: flags['watch-id'] && flags['watch-id'] !== true ? String(flags['watch-id']) : null,
      pollIntervalMs: flags['poll-interval-ms'] != null && flags['poll-interval-ms'] !== true ? flags['poll-interval-ms'] : null,
      maxWaves: flags['max-waves'] != null && flags['max-waves'] !== true ? flags['max-waves'] : null,
      maxIdleCycles: flags['max-idle-cycles'] != null && flags['max-idle-cycles'] !== true ? flags['max-idle-cycles'] : null,
      idleExitAfterSeconds: flags['idle-exit-after-seconds'] != null && flags['idle-exit-after-seconds'] !== true ? flags['idle-exit-after-seconds'] : null,
      until: flags.until && flags.until !== true ? String(flags.until) : null,
      stopOnFailure: flags['continue-on-failure'] === true ? false : true,
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`workId=${result.workId} watchId=${result.watchId} runtime=${result.runtimeAdapter} stopReason=${result.stopReason} waves=${result.claimedWaves} items=${result.claimedItems}`);
      if (result.stopDetail) console.log(`stopDetail=${result.stopDetail}`);
      for (const wave of result.waves) {
        const queueItem = wave.queueItem?.id || '-';
        const stopReason = wave.runResult?.stopReason || (Array.isArray(wave.workers) ? wave.workers.map((worker) => worker.runResult?.stopReason || '-').join(',') : '-');
        const release = wave.releaseStatus || '-';
        console.log(`- ${wave.waveId} queueItem=${queueItem} release=${release} stopReason=${stopReason}`);
      }
    }
    process.exit(result.stopReason === 'wave_failed' ? 1 : 0);
  }

  if (cmd === 'delegate') {
    const {
      enableDaemon,
      runDaemon,
    } = await import('../lib-daemon.js');
    const workDir = positional[1];
    if (!workDir) fail('Missing delegate work-dir');
    if (flags.loopback && flags.loopback !== true && String(flags.loopback) !== 'self') {
      fail('taskops delegate only supports --loopback self');
    }
    const delegateOptions = {
      name: flags.name && flags.name !== true ? String(flags.name) : null,
      runtimeAdapter: flags.runtime && flags.runtime !== true ? String(flags.runtime) : 'openclaw-cli',
      runnerId: flags['runner-id'] && flags['runner-id'] !== true ? String(flags['runner-id']) : null,
      runId: flags['run-id'] && flags['run-id'] !== true ? String(flags['run-id']) : null,
      ttlSeconds: flags['ttl-seconds'] && flags['ttl-seconds'] !== true ? flags['ttl-seconds'] : null,
      maxAttempts: flags['max-attempts'] != null && flags['max-attempts'] !== true ? flags['max-attempts'] : null,
      maxParallel: flags['max-parallel'] != null && flags['max-parallel'] !== true ? flags['max-parallel'] : null,
      maxSteps: flags['max-steps'] != null && flags['max-steps'] !== true ? flags['max-steps'] : null,
      maxStepsExplicit: maxStepsExplicitFlag(flags),
      loopback: 'self',
      maxLoopbacks: flags['max-loopbacks'] != null && flags['max-loopbacks'] !== true ? flags['max-loopbacks'] : null,
      timeout: flags.timeout != null && flags.timeout !== true ? flags.timeout : null,
      reportSink: flags['report-sink'] && flags['report-sink'] !== true ? String(flags['report-sink']) : null,
      masterSessionKey: flags['master-session-key'] && flags['master-session-key'] !== true ? String(flags['master-session-key']) : null,
      agent: flags.agent && flags.agent !== true ? String(flags.agent) : null,
      actor: flags.actor && flags.actor !== true ? String(flags.actor) : null,
      pollIntervalMs: flags['poll-interval-ms'] != null && flags['poll-interval-ms'] !== true ? flags['poll-interval-ms'] : null,
      daemonPollIntervalMs: flags['daemon-poll-interval-ms'] != null && flags['daemon-poll-interval-ms'] !== true ? flags['daemon-poll-interval-ms'] : null,
      failureBackoffMs: flags['failure-backoff-ms'] != null && flags['failure-backoff-ms'] !== true ? flags['failure-backoff-ms'] : null,
      maxDaemonCycles: flags['max-daemon-cycles'] != null && flags['max-daemon-cycles'] !== true ? flags['max-daemon-cycles'] : null,
      maxWaves: flags['max-waves'] != null && flags['max-waves'] !== true ? flags['max-waves'] : null,
      maxIdleCycles: flags['max-idle-cycles'] != null && flags['max-idle-cycles'] !== true ? flags['max-idle-cycles'] : null,
      idleExitAfterSeconds: flags['idle-exit-after-seconds'] != null && flags['idle-exit-after-seconds'] !== true ? flags['idle-exit-after-seconds'] : null,
      until: flags.until && flags.until !== true ? String(flags.until) : null,
      verifyChecks: flags['verify-checks'] === true,
      verifyRetries: flags['verify-retries'] != null && flags['verify-retries'] !== true ? flags['verify-retries'] : null,
      continueOnFailure: flags['continue-on-failure'] === true,
    };
    const unattended = flags.unattended === true;
    const foreground = flags.foreground === true || !unattended;
    if (foreground) {
      const result = await runDaemon(workDir, {
        ...delegateOptions,
        maxDaemonCycles: delegateOptions.maxDaemonCycles ?? 1,
        onCycle: flags.json ? null : (entry) => {
          console.log(`cycle=${entry.cycle} watchId=${entry.watchId} stopReason=${entry.stopReason} waves=${entry.claimedWaves} items=${entry.claimedItems}`);
          if (entry.stopDetail) console.log(`stopDetail=${entry.stopDetail}`);
        },
      });
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`delegate=${result.name} runnerId=${result.runnerId} cycles=${result.cycles.length} stopped=${result.stopRequested ? 'signal' : 'bounded'}`);
      process.exit(daemonExitCode(result));
    }
    const result = enableDaemon(workDir, {
      ...delegateOptions,
      start: flags['no-start'] === true ? false : true,
      dryRun: flags['dry-run'] === true,
      enable: flags.enable === false || flags.enable === 'false' ? false : true,
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.dryRun ? 'would enable delegate' : 'enabled delegate'} ${result.serviceName}`);
      console.log(result.unitPath);
      console.log(result.activationPath);
      console.log(`start=${result.startRequested ? 'yes' : 'no'} queueItems=${result.activation.syncedQueueItems ?? 'not-synced'}`);
    }
    process.exit(0);
  }

  if (cmd === 'daemon') {
    const {
      controlDaemon,
      daemonLogs,
      enableDaemon,
      installDaemon,
      readDaemonUnit,
      renderSystemdUnit,
      runDaemon,
      uninstallDaemon,
    } = await import('../lib-daemon.js');
    const subcmd = positional[1];
    if (!subcmd) fail('Missing daemon subcommand: run, unit, enable, install, start, stop, restart, status, logs, or uninstall');
    const daemonOptions = {
      name: flags.name && flags.name !== true ? String(flags.name) : null,
      runtimeAdapter: flags.runtime && flags.runtime !== true ? String(flags.runtime) : null,
      runnerId: flags['runner-id'] && flags['runner-id'] !== true ? String(flags['runner-id']) : null,
      runId: flags['run-id'] && flags['run-id'] !== true ? String(flags['run-id']) : null,
      ttlSeconds: flags['ttl-seconds'] && flags['ttl-seconds'] !== true ? flags['ttl-seconds'] : null,
      maxAttempts: flags['max-attempts'] != null && flags['max-attempts'] !== true ? flags['max-attempts'] : null,
      maxParallel: flags['max-parallel'] != null && flags['max-parallel'] !== true ? flags['max-parallel'] : null,
      maxSteps: flags['max-steps'] != null && flags['max-steps'] !== true ? flags['max-steps'] : null,
      maxStepsExplicit: maxStepsExplicitFlag(flags),
      loopback: flags.loopback && flags.loopback !== true ? String(flags.loopback) : null,
      maxLoopbacks: flags['max-loopbacks'] != null && flags['max-loopbacks'] !== true ? flags['max-loopbacks'] : null,
      timeout: flags.timeout != null && flags.timeout !== true ? flags.timeout : null,
      reportSink: flags['report-sink'] && flags['report-sink'] !== true ? String(flags['report-sink']) : null,
      masterSessionKey: flags['master-session-key'] && flags['master-session-key'] !== true ? String(flags['master-session-key']) : null,
      agent: flags.agent && flags.agent !== true ? String(flags.agent) : null,
      actor: flags.actor && flags.actor !== true ? String(flags.actor) : null,
      pollIntervalMs: flags['poll-interval-ms'] != null && flags['poll-interval-ms'] !== true ? flags['poll-interval-ms'] : null,
      daemonPollIntervalMs: flags['daemon-poll-interval-ms'] != null && flags['daemon-poll-interval-ms'] !== true ? flags['daemon-poll-interval-ms'] : null,
      failureBackoffMs: flags['failure-backoff-ms'] != null && flags['failure-backoff-ms'] !== true ? flags['failure-backoff-ms'] : null,
      maxDaemonCycles: flags['max-daemon-cycles'] != null && flags['max-daemon-cycles'] !== true ? flags['max-daemon-cycles'] : null,
      maxWaves: flags['max-waves'] != null && flags['max-waves'] !== true ? flags['max-waves'] : null,
      maxIdleCycles: flags['max-idle-cycles'] != null && flags['max-idle-cycles'] !== true ? flags['max-idle-cycles'] : null,
      idleExitAfterSeconds: flags['idle-exit-after-seconds'] != null && flags['idle-exit-after-seconds'] !== true ? flags['idle-exit-after-seconds'] : null,
      until: flags.until && flags.until !== true ? String(flags.until) : null,
      verifyChecks: flags['verify-checks'] === true,
      verifyRetries: flags['verify-retries'] != null && flags['verify-retries'] !== true ? flags['verify-retries'] : null,
      continueOnFailure: flags['continue-on-failure'] === true,
    };

    if (subcmd === 'run') {
      const workDir = positional[2];
      if (!workDir) fail('Missing daemon run work-dir');
      const result = await runDaemon(workDir, {
        ...daemonOptions,
        onCycle: flags.json ? null : (entry) => {
          console.log(`cycle=${entry.cycle} watchId=${entry.watchId} stopReason=${entry.stopReason} waves=${entry.claimedWaves} items=${entry.claimedItems}`);
          if (entry.stopDetail) console.log(`stopDetail=${entry.stopDetail}`);
        },
      });
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`daemon=${result.name} runnerId=${result.runnerId} cycles=${result.cycles.length} stopped=${result.stopRequested ? 'signal' : 'bounded'}`);
      process.exit(daemonExitCode(result));
    }

    if (subcmd === 'unit') {
      const workDir = positional[2];
      if (!workDir) fail('Missing daemon unit work-dir');
      const result = renderSystemdUnit(workDir, daemonOptions);
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else process.stdout.write(result.unit);
      process.exit(0);
    }

    if (subcmd === 'install') {
      const workDir = positional[2];
      if (!workDir) fail('Missing daemon install work-dir');
      const result = installDaemon(workDir, {
        ...daemonOptions,
        start: flags.start === true,
        dryRun: flags['dry-run'] === true,
        enable: flags.enable === false || flags.enable === 'false' ? false : true,
      });
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`${result.dryRun ? 'would install' : 'installed'} ${result.serviceName}`);
        console.log(result.unitPath);
      }
      process.exit(0);
    }

    if (subcmd === 'enable') {
      const workDir = positional[2];
      if (!workDir) fail('Missing daemon enable work-dir');
      const result = enableDaemon(workDir, {
        ...daemonOptions,
        start: flags['no-start'] === true ? false : true,
        dryRun: flags['dry-run'] === true,
        enable: flags.enable === false || flags.enable === 'false' ? false : true,
      });
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`${result.dryRun ? 'would enable' : 'enabled'} ${result.serviceName}`);
        console.log(result.unitPath);
        console.log(result.activationPath);
        console.log(`start=${result.startRequested ? 'yes' : 'no'} queueItems=${result.activation.syncedQueueItems ?? 'not-synced'}`);
      }
      process.exit(0);
    }

    if (['start', 'stop', 'restart', 'status'].includes(subcmd)) {
      const name = positional[2];
      if (!name) fail(`Missing daemon ${subcmd} name`);
      const result = controlDaemon(name, subcmd);
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else {
        process.stdout.write(result.stdout || '');
        process.stderr.write(result.stderr || '');
        if (!result.stdout && !result.stderr) console.log(`${subcmd} ${result.serviceName}: ${result.ok ? 'ok' : 'failed'}`);
      }
      process.exit(subcmd === 'status' ? 0 : (result.ok ? 0 : 1));
    }

    if (subcmd === 'logs') {
      const name = positional[2];
      if (!name) fail('Missing daemon logs name');
      const result = daemonLogs(name, {
        lines: flags.lines && flags.lines !== true ? flags.lines : 100,
      });
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else {
        process.stdout.write(result.stdout || '');
        process.stderr.write(result.stderr || '');
      }
      process.exit(result.ok ? 0 : 1);
    }

    if (subcmd === 'uninstall') {
      const name = positional[2];
      if (!name) fail('Missing daemon uninstall name');
      const result = uninstallDaemon(name, { dryRun: flags['dry-run'] === true });
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`${result.dryRun ? 'would uninstall' : 'uninstalled'} ${result.serviceName}`);
      process.exit(0);
    }

    if (subcmd === 'read-unit') {
      const name = positional[2];
      if (!name) fail('Missing daemon read-unit name');
      const result = readDaemonUnit(name);
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else if (result.exists) process.stdout.write(result.unit);
      else fail(`No unit installed at ${result.unitPath}`, 1);
      process.exit(0);
    }

    fail(`Unknown daemon subcommand: ${subcmd}`);
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
