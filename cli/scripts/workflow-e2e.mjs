#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'bin', 'taskops.js');
const repoRoot = join(here, '..', '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-workflow-e2e-'));
const resultPath = join(repoRoot, 'test-results', 'taskops-workflow-loopback-e2e.json');

function run(args, expectedStatus = 0) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  if (res.status !== expectedStatus) {
    throw new Error(`Command failed: taskops ${args.join(' ')}\nstatus=${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  }
  return res;
}

function writeMd(path, fm, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) {
        if (item && typeof item === 'object') {
          const entries = Object.entries(item);
          if (entries.length === 0) lines.push('  - {}');
          else {
            const [firstK, firstV] = entries[0];
            lines.push(`  - ${firstK}: ${firstV}`);
            for (const [ek, ev] of entries.slice(1)) lines.push(`    ${ek}: ${ev}`);
          }
        } else lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push('---', body || '');
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

function replaceSnapshotVersion(workDir, fromVersionId, toVersionId) {
  const p = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(p, readFileSync(p, 'utf8').replace(`versionId: ${fromVersionId}`, `versionId: ${toVersionId}`), 'utf8');
}

function readJsonl(path) {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

function createDecompositionWork() {
  const dir = join(tempRoot, 'tc-autonomous-decomposition');
  run(['init', dir, '--id', 'tc-autonomous-decomposition', '--title', 'TC autonomous decomposition', '--objective', 'Validate request-to-completion decomposition loop', '--language', 'en']);
  const specPath = join(tempRoot, 'tc-autonomous-decomposition-spec.json');
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Parent task requires decomposition',
    selected: true,
    tasks: [{
      id: 'task-plan',
      title: 'Plan and execute nested work',
      objective: 'Decompose into a child task and complete it in the same runner invocation.',
      responsibility: 'Own the nested work path.',
      completionCriteria: 'Child execution is complete and all EoW nodes are present.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      runReadinessReason: 'Fixture intentionally starts at parent decomposition.',
      understandingLevel: 'partial'
    }]
  }, null, 2));
  run(['decompose', dir, '--task-group-id', 'tg-root', '--spec', specPath]);
  replaceSnapshotVersion(dir, 'tgv-root-v1', 'tgv-root-v2');

  const tgDir = join(dir, 'task-groups', 'tg-plan');
  const versionDir = join(tgDir, 'versions', 'tgv-plan-v1');
  mkdirSync(join(versionDir, 'tasks'), { recursive: true });
  mkdirSync(join(versionDir, 'eow'), { recursive: true });
  writeMd(join(tgDir, 'index.md'), {
    taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-plan',
    objective: 'Child group for task-plan', activeVersionId: 'tgv-plan-v1', createdAt: '2026-05-15T00:00:00.000Z', status: 'active'
  }, '# Task group tg-plan');
  writeMd(join(versionDir, 'index.md'), {
    taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-plan-v1', taskGroupId: 'tg-plan', version: 'v1', summary: 'Runnable child decomposition', createdAt: '2026-05-15T00:00:00.000Z', status: 'active'
  }, '# Version tgv-plan-v1');
  writeMd(join(versionDir, 'tasks', 'task-child-execute.md'), {
    taskOpsVersion: 'v1', entityType: 'task', id: 'task-child-execute', taskGroupId: 'tg-plan', taskGroupVersionId: 'tgv-plan-v1',
    title: 'Execute decomposed child', objective: 'Complete the child task.', responsibility: 'Do the child work.', completionCriteria: 'Child task marked done by runner.',
    order: 1, createdAt: '2026-05-15T00:00:00.000Z', status: 'pending', runReadiness: 'runnable', runReadinessReason: 'Fully specified fixture task.', understandingLevel: 'known'
  }, '# Execute decomposed child');
  return dir;
}

function createDelegationWork(id, { self = false } = {}) {
  const dir = join(tempRoot, id);
  run(['init', dir, '--id', id, '--title', id, '--objective', 'Validate delegation behavior', '--language', 'en']);
  const specPath = join(tempRoot, `${id}-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Delegation fixture task',
    selected: true,
    tasks: [{
      id: 'task-delegated',
      title: 'Delegated task',
      objective: 'Complete work after pending delegation is resolved.',
      responsibility: 'Own the delegated path.',
      completionCriteria: 'Task is marked done after delegation is resolved.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
      runReadinessReason: 'Fixture task is ready after delegation clears.',
      understandingLevel: 'known'
    }]
  }, null, 2));
  run(['decompose', dir, '--task-group-id', 'tg-root', '--spec', specPath]);
  replaceSnapshotVersion(dir, 'tgv-root-v1', 'tgv-root-v2');
  writeMd(join(dir, 'runs', 'run-main', 'nodes', 'run-node-human-decision.md'), {
    taskOpsVersion: 'v1', entityType: 'runNode', id: 'run-node-human-decision', runId: 'run-main', type: 'delegate',
    title: self ? 'Self decision' : 'Human decision',
    status: 'waiting',
    delegateeType: self ? 'self' : 'human',
    delegateeRef: self ? 'self' : 'jimmy',
    selfDelegate: self,
    sourceTaskId: 'task-delegated',
    sourceTaskGroupVersionId: 'tgv-root-v2',
    request: 'Choose the product direction.',
    expectedOutput: 'A clear decision.',
    requestedAt: '2026-05-15T00:00:00.000Z',
    createdAt: '2026-05-15T00:00:00.000Z'
  }, '# Human decision');
  return dir;
}

const testCases = [];
function record(id, feature, expectedResult, actualResult, pass) {
  testCases.push({ id, feature, expectedResult, actualResult, pass });
}

try {
  // Expected results are declared before executing each test case.
  // P0#6: dry-run 종결은 policy 미승인이라 navigation은 all_closed/complete가 아니라 graph_closed_unapproved/
  // complete=false로 보고한다(구조 종결은 됐지만 policy-approved는 아님 = audit claimSafe와 정렬).
  const tc1Expected = {
    stopReason: 'graph_closed_unapproved',
    requiredActions: ['decompose:completed:task-plan', 'execute:completed:task-child-execute'],
    closure: { complete: false, waitingDelegations: 0, openBlockers: 0 },
    evidence: 'Runner should decompose parent, extend snapshot, execute child, and structurally close work (unapproved).'
  };
  const tc1Dir = createDecompositionWork();
  const tc1Run = JSON.parse(run(['run', tc1Dir, '--executor', 'dry-run', '--max-steps', '5', '--json']).stdout);
  const tc1Explain = JSON.parse(run(['explain', tc1Dir, '--json']).stdout);
  const tc1Actual = {
    stopReason: tc1Run.stopReason,
    actions: tc1Run.actions.map((a) => `${a.kind}:${a.status}:${a.taskId || a.delegateRunNodeId || a.runNodeId}`),
    closure: {
      complete: tc1Explain.complete,
      waitingDelegations: tc1Explain.closure.waitingDelegationCount,
      openBlockers: tc1Explain.closure.openBlockerCount
    },
    eventsPath: tc1Run.eventsPath
  };
  record('TC01', '1. request-to-completion autonomous decomposition', tc1Expected, tc1Actual,
    tc1Actual.stopReason === tc1Expected.stopReason &&
    tc1Expected.requiredActions.every((x) => tc1Actual.actions.includes(x)) &&
    tc1Actual.closure.complete === false && tc1Actual.closure.waitingDelegations === 0 && tc1Actual.closure.openBlockers === 0);

  const tc2Expected = {
    runLogContains: ['runner_started', 'task_started', 'task_completed', 'graph_closed_unapproved'],
    eventsContain: ['decomposition_completed', 'task_completed'],
    explainComplete: false,
    evidence: 'Work history should be inspectable/explainable after execution (structurally closed, unapproved).'
  };
  const runLog = readFileSync(join(tc1Dir, 'runs', 'run-main', 'run-log.md'), 'utf8');
  const events = readFileSync(join(tc1Dir, 'runs', 'run-main', 'events.jsonl'), 'utf8');
  const tc2Actual = {
    runLogContains: tc2Expected.runLogContains.filter((x) => runLog.includes(x)),
    eventsContain: tc2Expected.eventsContain.filter((x) => events.includes(x)),
    explainComplete: tc1Explain.complete,
    explainStatus: tc1Explain.status
  };
  record('TC02', '2. work record inspection and explanation', tc2Expected, tc2Actual,
    tc2Actual.runLogContains.length === tc2Expected.runLogContains.length && tc2Actual.eventsContain.length === tc2Expected.eventsContain.length && tc2Actual.explainComplete === false);

  const tc3Expected = {
    loopbackPolicy: 'none', stopReason: 'delegation_pending', stepsRun: 0,
    source: { type: 'runNode', id: 'run-node-human-decision' },
    evidence: 'Normal mode must pause and surface a request when non-self human delegation is pending.'
  };
  const tc3Dir = createDelegationWork('tc-delegation-pending');
  const tc3Run = JSON.parse(run(['run', tc3Dir, '--executor', 'dry-run', '--json']).stdout);
  const tc3Actual = { loopbackPolicy: tc3Run.loopbackPolicy, stopReason: tc3Run.stopReason, stepsRun: tc3Run.stepsRun, source: tc3Run.stopSource };
  record('TC03', '3. immediate delegation request in normal mode', tc3Expected, tc3Actual,
    tc3Actual.loopbackPolicy === 'none' && tc3Actual.stopReason === 'delegation_pending' && tc3Actual.stepsRun === 0 && tc3Actual.source?.id === 'run-node-human-decision');

  const tc4Expected = {
    loopbackPolicy: 'self', stopReason: 'graph_closed_unapproved', claimedItems: 1, loopbacksUsed: 1, action: { kind: 'loopback', status: 'completed', executedBy: 'Nova', executionMode: 'loopback' },
    delegateFrontmatter: ['status: done', 'resolvedBy: loopback', 'executionMode: loopback', 'executedBy: Nova'],
    evidence: 'User-facing loopback mode should route through daemon-backed queue execution, take a self-delegation, execute it itself, and record who executed it.'
  };
  const tc4Dir = createDelegationWork('tc-loopback-self-delegation', { self: true });
  const tc4Daemon = JSON.parse(run(['run', tc4Dir, '--executor', 'dry-run', '--loopback', 'self', '--actor', 'Nova', '--max-loopbacks', '2', '--max-steps', '3', '--json']).stdout);
  const tc4Node = readFileSync(join(tc4Dir, 'runs', 'run-main', 'nodes', 'run-node-human-decision.md'), 'utf8');
  const tc4Wave = tc4Daemon.cycles[0].waveDetails[0];
  const tc4FullWave = tc4Daemon.cycles[0];
  const tc4Events = readJsonl(join(tc4Dir, 'runs', 'run-tgv-root-v2-task-delegated', 'events.jsonl'));
  const tc4LoopbackEvent = tc4Events.find((event) => event.type === 'loopback_completed' && event.delegateRunNodeId === 'run-node-human-decision');
  const tc4TaskEvent = tc4Events.find((event) => event.type === 'task_completed' && event.taskId === 'task-delegated');
  const tc4StoppedEvent = tc4Events.find((event) => event.type === 'runner_stopped');
  const tc4Actual = {
    loopbackPolicy: tc4Wave ? 'self' : null,
    stopReason: tc4FullWave.stopReason,
    claimedItems: tc4FullWave.claimedItems,
    loopbacksUsed: tc4LoopbackEvent ? 1 : 0,
    action: tc4LoopbackEvent ? { kind: 'loopback', status: 'completed', executedBy: tc4LoopbackEvent.executedBy, executionMode: tc4LoopbackEvent.executionMode } : null,
    taskCompletedEvent: tc4TaskEvent?.type || null,
    runnerStoppedEvent: tc4StoppedEvent?.type || null,
    delegateFrontmatter: tc4Expected.delegateFrontmatter.filter((x) => tc4Node.includes(x))
  };
  record('TC04', '4. loopback mode executes waiting delegation as self and records executor', tc4Expected, tc4Actual,
    tc4Actual.loopbackPolicy === 'self' && tc4Actual.stopReason === 'graph_closed_unapproved' && tc4Actual.claimedItems === 1 && tc4Actual.loopbacksUsed === 1 &&
    tc4Actual.action?.executedBy === 'Nova' && tc4Actual.action?.executionMode === 'loopback' &&
    tc4Actual.taskCompletedEvent === 'task_completed' && tc4Actual.runnerStoppedEvent === 'runner_stopped' &&
    tc4Actual.delegateFrontmatter.length === tc4Expected.delegateFrontmatter.length);

  // P0#6: dry-run(미승인) 종결의 최종 신호는 complete=false/status=active/nextAction=graph_closed_unapproved다 —
  // navigation이 미승인 완료를 done으로 오보하지 않는다(policy-approved만 done/complete로 승격).
  const tc5Expected = {
    complete: false, status: 'active', nextAction: 'graph_closed_unapproved', reportableStopReason: 'graph_closed_unapproved',
    evidence: 'An unapproved structural closure reports complete=false/status=active/graph_closed_unapproved (done requires policy approval).'
  };
  const tc5Actual = {
    complete: tc1Explain.complete,
    status: tc1Explain.status,
    nextAction: tc1Explain.next.action,
    reportableStopReason: tc1Run.stopReason
  };
  record('TC05', '5. final completion report signal', tc5Expected, tc5Actual,
    tc5Actual.complete === false && tc5Actual.status === 'active' && tc5Actual.nextAction === 'graph_closed_unapproved' && tc5Actual.reportableStopReason === 'graph_closed_unapproved');

  mkdirSync(dirname(resultPath), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    tempRoot,
    summary: { passed: testCases.filter((t) => t.pass).length, total: testCases.length, allPassed: testCases.every((t) => t.pass) },
    testCases
  };
  writeFileSync(resultPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.summary.allPassed ? 0 : 1);
} catch (err) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), tempRoot, error: err instanceof Error ? err.message : String(err), testCases };
  writeFileSync(resultPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.error(payload.error);
  process.exit(1);
}
