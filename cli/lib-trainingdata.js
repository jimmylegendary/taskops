// Training-data engine (payoff #2): taskops already produces HONEST, verify-grounded signals — this extracts
// them from a run into LABELED trajectories. The value is that every label rests on runner-verified evidence
// (not self-attestation): a verify-grounded closure, an honest stall, and — the money label — a test-time-scaling
// gain (the task FAILED its verify at least once, then a retry with the failure fed back turned it into a verified
// completion). That is a trustworthy "did more test-time convert a stall into an honest completion?" dataset.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseProject, parseMarkdownFile } from './lib-taskops.js';

function readEventsByTask(projectDir) {
  const byTask = new Map();
  const runsDir = join(projectDir, 'runs');
  if (!existsSync(runsDir)) return byTask;
  for (const run of readdirSync(runsDir, { withFileTypes: true })) {
    if (!run.isDirectory()) continue;
    const ev = join(runsDir, run.name, 'events.jsonl');
    if (!existsSync(ev)) continue;
    let raw = '';
    try { raw = readFileSync(ev, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const tid = e.taskId;
      if (!tid) continue;
      if (!byTask.has(tid)) byTask.set(tid, []);
      byTask.get(tid).push(e);
    }
  }
  return byTask;
}

function readNode(projectDir, runId, runNodeId, prefix = '') {
  if (!runId || !runNodeId) return null;
  const p = join(projectDir, 'runs', runId, 'nodes', `${prefix}${runNodeId}.md`);
  if (!existsSync(p)) return null;
  try { return parseMarkdownFile(p); } catch { return null; }
}

const ACTION_EVENT_KINDS = new Set(['implementation', 'exploration', 'decomposition', 'prototype', 'loopback']);

// Classify a task's terminal state into an HONEST outcome — verify-grounded vs self-reported vs an honest stall.
function classifyOutcome(task, verifyGrounded) {
  if (task.status === 'done') return verifyGrounded ? 'verified_done' : 'reported_done';
  if (task.status === 'blocked') return 'honest_stall';
  if (task.status === 'cancelled') return 'cancelled';
  if (task.resolverKind === 'human' || task.resolverKind === 'ai') return 'awaiting_resolution';
  if (task.runReadiness === 'needs_exploration') return 'open_needs_exploration';
  if (task.runReadiness === 'needs_prototype') return 'open_needs_prototype';
  if (task.runReadiness === 'needs_decomposition') return 'open_needs_decomposition';
  return 'open';
}

export function extractTrainingData(projectDir) {
  const parsed = parseProject(projectDir);
  const eventsByTask = readEventsByTask(projectDir);
  const trajectories = [];
  for (const task of parsed.tasks.values()) {
    const events = eventsByTask.get(task.id) || [];
    const retries = events.filter((e) => e.type === 'verify_retry').length;
    const actions = [...new Set(events.filter((e) => ACTION_EVENT_KINDS.has(e.type)).map((e) => e.type))];
    const partialRequested = events.some((e) => e.type === 'task_partial_requested');

    const ref = (task.runRefs || []).find((r) => /execution/.test(String(r.role || ''))) || (task.runRefs || [])[0] || {};
    const node = readNode(projectDir, ref.runId, ref.runNodeId);
    const review = readNode(projectDir, ref.runId, ref.runNodeId, 'review-');
    const reviewReport = review?.reviewReport || node?.reviewReport || null;
    const observed = node?.result?.observed || {};
    const checkResults = (observed.checkResults || []).map((c) => ({ command: c.command, status: c.status, verifiedBy: c.verifiedBy || null }));
    const quizResults = (observed.quizResults || []).map((q) => ({ command: q.command, status: q.status, verifiedBy: q.verifiedBy || null }));

    const verifyGrounded = reviewReport?.verified === true;
    const comprehensionVerified = reviewReport?.comprehensionVerified === true;
    const outcome = classifyOutcome(task, verifyGrounded);
    const attempts = 1 + retries;

    const labels = {
      // A completion is honest ONLY when it is runner-verified (verified_done); a self-reported done is a
      // separate, weaker label — never conflated with an honest completion.
      honest_completion: outcome === 'verified_done',
      // The money label: more test-time (a retry with the check failure fed back) converted a first-attempt
      // stall into an HONEST verified completion.
      test_time_scaling_gain: retries > 0 && outcome === 'verified_done',
      understanding_verified: comprehensionVerified,
      honest_stall: ['honest_stall', 'awaiting_resolution'].includes(outcome),
      partial_requested: partialRequested,
    };

    trajectories.push({
      taskId: task.id,
      objective: task.objective || '',
      acceptanceMode: (task.acceptance && task.acceptance.mode) || 'informational',
      uncertaintyState: task.uncertaintyState || null,
      attempts,
      actions,
      outcome,
      reviewDecision: reviewReport?.decision || null,
      signals: {
        verifyGrounded,
        comprehensionVerified,
        retries,
        surprises: Array.isArray(task.surpriseHistory) ? task.surpriseHistory.length : 0,
        checkResults,
        quizResults,
      },
      labels,
    });
  }
  return trajectories;
}

// Aggregate label counts — a quick read on how much honest, trustworthy signal the run produced.
export function summarizeTrainingData(trajectories) {
  const s = { tasks: trajectories.length, verified_done: 0, reported_done: 0, honest_stall: 0, open: 0, test_time_scaling_gains: 0, understanding_verified: 0 };
  for (const t of trajectories) {
    if (t.outcome === 'verified_done') s.verified_done += 1;
    else if (t.outcome === 'reported_done') s.reported_done += 1;
    else if (t.labels.honest_stall) s.honest_stall += 1;
    else s.open += 1;
    if (t.labels.test_time_scaling_gain) s.test_time_scaling_gains += 1;
    if (t.labels.understanding_verified) s.understanding_verified += 1;
  }
  return s;
}
