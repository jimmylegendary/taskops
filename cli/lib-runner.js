import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ancestorChainForTask,
  classifyTaskReadiness,
  discoverProjects,
  ensureDir,
  fmBlock,
  hydrationSourceTaskForChainEntry,
  parseMarkdownFile,
  parseProject,
  readBody,
} from './lib-taskops.js';
import { RUNTIME_ADAPTER_NAMES, invokeRuntimeAdapter } from './lib-runtime-adapters.js';
import {
  appendRunEvent as appendRunEventViaStateWriter,
  appendRunLogEntry as appendRunLogViaStateWriter,
  attachTaskRunRef as attachTaskRunRefViaStateWriter,
  closeRunNodeWithEowFiles as closeRunNodeWithEowViaStateWriter,
  closeTaskWithEowFile as closeTaskWithEowViaStateWriter,
  ensureRunNodeFile as ensureRunNodeViaStateWriter,
  updateMarkdownFrontmatter as updateMarkdownFrontmatterViaStateWriter,
  writeRunEdgeFile as writeRunEdgeViaStateWriter,
} from './lib-state-writer.js';

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

export const FINISHING_MODE_RESERVE = (maxSteps) => {
  const n = Number(maxSteps);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.max(2, Math.ceil(Math.floor(n) * 0.2));
};

export const EXPECTED_PLAN_PHASE_THRESHOLDS = Object.freeze({
  soft: 0.5,
  hard: 0.85,
});

export function computeStepBudget({ stepsRun = 0, maxSteps = null, budgetEnabled = false } = {}) {
  if (!budgetEnabled || maxSteps == null) {
    return { enabled: false, finishingMode: false };
  }
  const normalizedMaxSteps = Math.floor(Number(maxSteps));
  const normalizedStepsRun = Math.floor(Number(stepsRun));
  if (!Number.isFinite(normalizedMaxSteps) || normalizedMaxSteps < 0 || !Number.isFinite(normalizedStepsRun) || normalizedStepsRun < 0) {
    return { enabled: false, finishingMode: false };
  }
  const remaining = normalizedMaxSteps - normalizedStepsRun;
  const reserve = FINISHING_MODE_RESERVE(normalizedMaxSteps);
  // This is intentionally worker-local for now. A future global/wave budget can
  // extend this object with a scope field without changing prompt consumers.
  return {
    enabled: true,
    stepsRun: normalizedStepsRun,
    maxSteps: normalizedMaxSteps,
    remaining,
    finishingMode: remaining <= reserve,
  };
}

export const PARTIAL_REQUEST_PREFIX = 'TASKOPS_PARTIAL_REQUEST:';
export const SURPRISE_REPORT_PREFIX = 'TASKOPS_SURPRISE_REPORT:';

const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));
const TASKOPS_CLI_PATH = realpathSync(join(RUNNER_DIR, 'bin', 'taskops.js'));

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_/:=.,+%-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function taskopsCliCommandForPrompt() {
  return `${shellQuote(process.execPath)} ${shellQuote(TASKOPS_CLI_PATH)}`;
}
export const SURPRISE_PENALTY_WEIGHTS = Object.freeze({
  wrongKnown: 3,
  discoveredUnknown: 1,
  nonBlockingUnknown: 0.5,
});

function looksLikeJson(value) {
  const text = String(value || '').trim();
  return text.startsWith('{') || text.startsWith('[');
}

function collectPartialRequestTexts(value, texts = [], seen = new Set()) {
  if (value == null) return texts;
  if (typeof value === 'string') {
    texts.push(value);
    if (looksLikeJson(value)) {
      try {
        collectPartialRequestTexts(JSON.parse(value), texts, seen);
      } catch {
        // Plain worker text often is not JSON. Sentinel parsing below handles it.
      }
    }
    return texts;
  }
  if (typeof value !== 'object' || seen.has(value)) return texts;
  seen.add(value);

  for (const key of ['finalAssistantRawText', 'finalAssistantVisibleText', 'text', 'message', 'stdout', 'stderr']) {
    if (typeof value[key] === 'string') collectPartialRequestTexts(value[key], texts, seen);
  }
  const payloads = Array.isArray(value.payloads)
    ? value.payloads
    : (Array.isArray(value.result?.payloads) ? value.result.payloads : []);
  for (const payload of payloads) collectPartialRequestTexts(payload, texts, seen);
  if (value.result && typeof value.result === 'object') collectPartialRequestTexts(value.result, texts, seen);
  return texts;
}

function parsePartialRequestText(text) {
  const lines = String(text || '').split(/\r?\n/);
  let malformed = null;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith(PARTIAL_REQUEST_PREFIX)) continue;
    const jsonText = trimmed.slice(PARTIAL_REQUEST_PREFIX.length).trim();
    try {
      const payload = JSON.parse(jsonText);
      if (!payload || payload.partialRequested !== true) {
        return {
          partialRequested: false,
          markerFound: true,
          ignoredReason: 'partial_requested_not_true',
          rawLine: line,
        };
      }
      return {
        partialRequested: true,
        markerFound: true,
        completedSummary: typeof payload.completedSummary === 'string' ? payload.completedSummary : '',
        incompleteSummary: typeof payload.incompleteSummary === 'string' ? payload.incompleteSummary : '',
        followUpNeeded: payload.followUpNeeded !== false,
        rawLine: line,
      };
    } catch (error) {
      malformed = {
        partialRequested: false,
        markerFound: true,
        parseError: error instanceof Error ? error.message : String(error),
        rawLine: line,
      };
    }
  }
  return malformed || { partialRequested: false, markerFound: false };
}

export function parsePartialRequestFromExecutorResult(executorResult) {
  const texts = collectPartialRequestTexts(executorResult);
  let malformed = null;
  for (const text of texts) {
    const parsed = parsePartialRequestText(text);
    if (parsed.partialRequested === true) return parsed;
    if (parsed.markerFound && parsed.parseError && !malformed) malformed = parsed;
    if (parsed.markerFound && parsed.ignoredReason && !malformed) malformed = parsed;
  }
  return malformed || { partialRequested: false, markerFound: false };
}

function compactString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObjectList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
}

function normalizeContradictedKnown(value) {
  return normalizeObjectList(value).map((item) => ({
    knownId: compactString(item.knownId || item.id),
    priorClaim: compactString(item.priorClaim),
    observedEvidence: compactString(item.observedEvidence || item.evidence),
    correctedClaim: compactString(item.correctedClaim),
  })).filter((item) => item.knownId);
}

function normalizeDiscoveredUnknowns(value) {
  return normalizeObjectList(value).map((item, index) => ({
    id: compactString(item.id) || `u${index + 1}`,
    question: compactString(item.question || item.claim || item.unknown),
    whyDiscovered: compactString(item.whyDiscovered || item.reason || item.evidence),
    blocksReadiness: item.blocksReadiness !== false,
  })).filter((item) => item.question);
}

function normalizeNewKnownDeltas(value) {
  return normalizeObjectList(value).map((item, index) => {
    const delta = {
      id: compactString(item.id) || `k-delta-${index + 1}`,
      claim: compactString(item.claim),
      verificationStatus: 'unverified',
      evidence: compactString(item.evidence || item.observedEvidence),
    };
    if (compactString(item.revalidatedFromInheritedRef)) delta.revalidatedFromInheritedRef = compactString(item.revalidatedFromInheritedRef);
    if (compactString(item.sourceTaskId)) delta.sourceTaskId = compactString(item.sourceTaskId);
    if (compactString(item.sourceKnownId)) delta.sourceKnownId = compactString(item.sourceKnownId);
    if (Array.isArray(item.sourceSurpriseRefs)) {
      delta.sourceSurpriseRefs = item.sourceSurpriseRefs.map((ref) => String(ref || '').trim()).filter(Boolean);
    }
    return delta;
  }).filter((item) => item.claim);
}

function normalizeSurpriseReportPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('surprise report must be a JSON object');
  }
  return {
    summary: compactString(payload.summary),
    contradictedKnown: normalizeContradictedKnown(payload.contradictedKnown || payload.contradictedKnownClaims || payload.wrongKnown),
    discoveredUnknowns: normalizeDiscoveredUnknowns(payload.discoveredUnknowns || payload.newUnknowns || payload.unknownsDiscovered),
    newKnownDeltas: normalizeNewKnownDeltas(payload.newKnownDeltas || payload.newKnown || payload.learnedKnown),
  };
}

function parseSurpriseReportText(text) {
  const lines = String(text || '').split(/\r?\n/);
  let malformed = null;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith(SURPRISE_REPORT_PREFIX)) continue;
    const jsonText = trimmed.slice(SURPRISE_REPORT_PREFIX.length).trim();
    try {
      return {
        surpriseReported: true,
        markerFound: true,
        report: normalizeSurpriseReportPayload(JSON.parse(jsonText)),
        rawLine: line,
      };
    } catch (error) {
      malformed = {
        surpriseReported: false,
        markerFound: true,
        parseError: error instanceof Error ? error.message : String(error),
        rawLine: line,
      };
    }
  }
  return malformed || { surpriseReported: false, markerFound: false };
}

export function parseSurpriseReportFromExecutorResult(executorResult, extraTexts = []) {
  const texts = [...collectPartialRequestTexts(executorResult), ...asArray(extraTexts)];
  let malformed = null;
  for (const text of texts) {
    const parsed = parseSurpriseReportText(text);
    if (parsed.surpriseReported === true) return parsed;
    if (parsed.markerFound && parsed.parseError && !malformed) malformed = parsed;
  }
  return malformed || { surpriseReported: false, markerFound: false };
}

function isoNow() {
  return new Date().toISOString();
}

function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, Math.floor(ms));
}

function writeTextFileAtomic(filePath, text) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmpPath, text, 'utf8');
  renameSync(tmpPath, filePath);
}

const FM_SCALAR_MAX_LEN = 500;
const FM_SCALAR_FALLBACK = 'executor_failed';
const ACCEPTANCE_MODES = new Set(['informational', 'enforced', 'guarded', 'runner-managed']);
const POLICY_APPROVING_ACCEPTANCE_MODES = new Set(['enforced', 'guarded', 'runner-managed']);

export function sanitizeFmScalar(value, { maxLen = FM_SCALAR_MAX_LEN, fallback = FM_SCALAR_FALLBACK } = {}) {
  if (value == null) return fallback;
  const collapsed = String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!collapsed) return fallback;
  if (collapsed.length > maxLen) return collapsed.slice(0, Math.max(1, maxLen - 3)) + '...';
  return collapsed;
}

function updateMarkdownFrontmatter(filePath, updater) {
  return updateMarkdownFrontmatterViaStateWriter(filePath, updater, {
    parseMarkdownFile,
    readBody,
    fmBlock,
    writeTextFile: writeTextFileAtomic,
  });
}

function stateWriterIo() {
  return {
    appendTextFile: (filePath, text) => appendFileSync(filePath, text, 'utf8'),
    ensureDir,
    exists: existsSync,
    fmBlock,
    now: isoNow,
    parseMarkdownFile,
    readBody,
    sanitizeFmScalar,
    updateMarkdownFrontmatter,
    writeTextFile: writeTextFileAtomic,
  };
}

function appendSurpriseHistory({ task, report, runId, runNodeId, actionKind, observedAt, evidenceRefs = [] }) {
  if (!task?.path) return null;
  const normalizedReport = normalizeSurpriseReportPayload(report || {});
  const entry = computeSurpriseHistoryEntry({ task, report: normalizedReport, runId, runNodeId, actionKind, observedAt, evidenceRefs });
  const deltas = normalizedReport.newKnownDeltas;
  updateMarkdownFrontmatter(task.path, (fm) => {
    const surpriseHistory = Array.isArray(fm.surpriseHistory) ? [...fm.surpriseHistory] : [];
    surpriseHistory.push(entry);
    fm.surpriseHistory = surpriseHistory;
    if (deltas.length > 0) {
      const knownList = Array.isArray(fm.knownList) ? [...fm.knownList] : [];
      const knownIds = new Set(knownList.map((item) => compactString(item?.id)).filter(Boolean));
      for (const delta of deltas) {
        if (knownIds.has(delta.id)) continue;
        knownList.push(delta);
        knownIds.add(delta.id);
      }
      fm.knownList = knownList;
    }
    return fm;
  });
  return entry;
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function activeSnapshotForParsed(parsed) {
  return parsed?.project?.activeSnapshotId ? parsed.snapshots?.get(parsed.project.activeSnapshotId) || null : null;
}

function claimHash(claim) {
  return sha256Of({ claim: compactString(claim) });
}

function surpriseHistoryForTask(task) {
  return Array.isArray(task?.surpriseHistory) ? task.surpriseHistory.filter((entry) => entry && typeof entry === 'object') : [];
}

function contradictionRefsByKnownId(task) {
  const refs = new Map();
  for (const surprise of surpriseHistoryForTask(task)) {
    const ids = Array.isArray(surprise.contradictedKnownIds) ? surprise.contradictedKnownIds : [];
    for (const knownId of ids.map((id) => compactString(id)).filter(Boolean)) {
      const list = refs.get(knownId) || [];
      list.push(compactString(surprise.id) || 'surprise');
      refs.set(knownId, list);
    }
  }
  return refs;
}

function inheritedFailurePatternsForTask(task) {
  const patterns = [];
  for (const surprise of surpriseHistoryForTask(task)) {
    const surpriseId = compactString(surprise.id) || `surprise-${patterns.length + 1}`;
    const sourceTaskId = compactString(task?.id);
    const summary = compactString(surprise.summary);
    const contradicted = Array.isArray(surprise.contradictedKnownIds) ? surprise.contradictedKnownIds : [];
    for (const knownId of contradicted.map((id) => compactString(id)).filter(Boolean)) {
      patterns.push({
        id: `fp-${sourceTaskId}-${surpriseId}-${knownId}`.replace(/[^A-Za-z0-9._-]+/g, '-'),
        type: 'contradicted_known',
        sourceTaskId,
        sourceSurpriseHistoryId: surpriseId,
        sourceKnownId: knownId,
        severity: 'warning',
        ...(summary ? { summary } : {}),
      });
    }
    if (String(surprise.surpriseLevel || '').trim() === 'high' || Number(surprise.surpriseScore) >= 0.67) {
      patterns.push({
        id: `fp-${sourceTaskId}-${surpriseId}-high-surprise`.replace(/[^A-Za-z0-9._-]+/g, '-'),
        type: 'high_surprise',
        sourceTaskId,
        sourceSurpriseHistoryId: surpriseId,
        severity: 'warning',
        ...(summary ? { summary } : {}),
      });
    }
    const blocking = Array.isArray(surprise.blockingNewUnknownIds) ? surprise.blockingNewUnknownIds : [];
    for (const unknownId of blocking.map((id) => compactString(id)).filter(Boolean)) {
      patterns.push({
        id: `fp-${sourceTaskId}-${surpriseId}-${unknownId}`.replace(/[^A-Za-z0-9._-]+/g, '-'),
        type: 'blocking_unknown',
        sourceTaskId,
        sourceSurpriseHistoryId: surpriseId,
        severity: 'warning',
        summary: summary || `Blocking unknown ${unknownId} was discovered upstream.`,
      });
    }
  }
  return patterns;
}

function inheritedComparable(context) {
  const normalizeRefs = (items, fields) => (Array.isArray(items) ? items : [])
    .map((item) => Object.fromEntries(fields.map((field) => [field, item?.[field] ?? null])))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    parentChain: normalizeRefs(context?.parentChain, ['taskId', 'taskGroupId', 'taskGroupVersionId', 'childTaskGroupId', 'childTaskGroupVersionId', 'decomposedByRunId', 'decomposedByRunNodeId']),
    inheritedKnownRefs: normalizeRefs(context?.inheritedKnownRefs, ['sourceTaskId', 'sourceTaskGroupVersionId', 'sourceKnownId', 'claimHash', 'trust', 'sourceSurpriseRefs']),
    inheritedFailurePatterns: normalizeRefs(context?.inheritedFailurePatterns, ['type', 'sourceTaskId', 'sourceSurpriseHistoryId', 'sourceKnownId']),
    inheritedSurpriseRefs: normalizeRefs(context?.inheritedSurpriseRefs, ['sourceTaskId', 'surpriseHistoryId']),
  };
}

function inheritedSignature(context) {
  return sha256Of(inheritedComparable(context));
}

function inheritedContextWithoutRuntimeFlags(context) {
  const cloned = cloneJson(context);
  if (!cloned || typeof cloned !== 'object') return cloned;
  delete cloned.stale;
  delete cloned.staleWarning;
  delete cloned.birthSnapshotHash;
  delete cloned.dynamicSnapshotHash;
  delete cloned.lineageWarnings;
  return cloned;
}

export function hydrateInheritedContext(parsed, task, activeSnapshot = null, { capturedAt = null } = {}) {
  const chain = ancestorChainForTask(parsed, task, activeSnapshot);
  if (!Array.isArray(chain) || chain.length === 0) return null;
  const parentChain = [];
  const inheritedKnownRefs = [];
  const inheritedFailurePatterns = [];
  const inheritedSurpriseRefs = [];
  const lineageWarnings = [];

  for (const entry of chain) {
    parentChain.push({
      taskId: entry.taskId,
      taskGroupId: entry.taskGroupId,
      taskGroupVersionId: entry.taskGroupVersionId,
      childTaskGroupId: entry.childTaskGroupId,
      childTaskGroupVersionId: entry.childTaskGroupVersionId,
      decomposedByRunId: entry.decomposedByRunId,
      decomposedByRunNodeId: entry.decomposedByRunNodeId,
    });
    const source = hydrationSourceTaskForChainEntry(parsed, entry);
    if (source.warning) lineageWarnings.push(source.warning);
    const sourceTask = source.task;
    if (!sourceTask) continue;
    const contradictions = contradictionRefsByKnownId(sourceTask);
    const knownList = Array.isArray(sourceTask.knownList) ? sourceTask.knownList : [];
    for (const known of knownList) {
      const sourceKnownId = compactString(known?.id);
      const claim = compactString(known?.claim);
      if (!sourceKnownId || !claim) continue;
      const sourceSurpriseRefs = contradictions.get(sourceKnownId) || [];
      inheritedKnownRefs.push({
        id: `inh-${sourceTask.id}-${sourceKnownId}`.replace(/[^A-Za-z0-9._-]+/g, '-'),
        sourceTaskId: sourceTask.id,
        sourceTaskGroupVersionId: sourceTask.taskGroupVersionId,
        sourceKnownId,
        claimHash: claimHash(claim),
        claimPreview: claim,
        trust: sourceSurpriseRefs.length > 0 ? 'contradicted_upstream' : 'inherited_unverified',
        sourceSurpriseRefs,
        hydrationSource: source.source,
        observedAt: compactString(known.observedAt || sourceTask.createdAt || capturedAt || isoNow()),
      });
    }
    inheritedFailurePatterns.push(...inheritedFailurePatternsForTask(sourceTask));
    for (const surprise of surpriseHistoryForTask(sourceTask)) {
      const surpriseId = compactString(surprise.id);
      if (!surpriseId) continue;
      inheritedSurpriseRefs.push({
        sourceTaskId: sourceTask.id,
        surpriseHistoryId: surpriseId,
      });
    }
  }

  const context = {
    schemaVersion: 'phase3b-v1',
    capturedAt: capturedAt || isoNow(),
    parentChain,
    inheritedKnownRefs,
    inheritedFailurePatterns,
    inheritedSurpriseRefs,
  };
  if (lineageWarnings.length > 0) context.lineageWarnings = lineageWarnings;
  if (task?.inheritedFrom && typeof task.inheritedFrom === 'object' && !Array.isArray(task.inheritedFrom)) {
    const birthSnapshotHash = inheritedSignature(task.inheritedFrom);
    const dynamicSnapshotHash = inheritedSignature(context);
    if (birthSnapshotHash !== dynamicSnapshotHash) {
      context.stale = true;
      context.staleWarning = 'birth inheritedFrom snapshot differs from latest ancestor known/surprise context';
      context.birthSnapshotHash = birthSnapshotHash;
      context.dynamicSnapshotHash = dynamicSnapshotHash;
    }
  }
  return context;
}

function inheritedContextForTask(projectDir, task) {
  try {
    const parsed = parseProject(projectDir);
    const parsedTask = parsed.tasks?.get(`${task.taskGroupVersionId}:${task.id}`) || task;
    return hydrateInheritedContext(parsed, parsedTask, activeSnapshotForParsed(parsed));
  } catch {
    return null;
  }
}

function filterLocalKnownCopiesOfInherited(knownList, inheritedContext) {
  const list = Array.isArray(knownList) ? knownList : [];
  const inheritedRefs = Array.isArray(inheritedContext?.inheritedKnownRefs) ? inheritedContext.inheritedKnownRefs : [];
  if (list.length === 0 || inheritedRefs.length === 0) return { knownList: list, removed: [] };
  const inheritedKnownIds = new Set(inheritedRefs.map((ref) => compactString(ref.sourceKnownId)).filter(Boolean));
  const inheritedHashes = new Set(inheritedRefs.map((ref) => compactString(ref.claimHash)).filter(Boolean));
  const kept = [];
  const removed = [];
  for (const item of list) {
    const id = compactString(item?.id);
    const hash = claimHash(item?.claim || '');
    if ((id && inheritedKnownIds.has(id)) || (hash && inheritedHashes.has(hash))) {
      removed.push(item);
    } else {
      kept.push(item);
    }
  }
  return { knownList: kept, removed };
}

export function applyInheritedBirthSnapshotToChildVersion({ projectDir, childTaskGroupId, versionId, capturedAt = null }) {
  const parsed = parseProject(projectDir);
  const activeSnapshot = activeSnapshotForParsed(parsed);
  const version = parsed.versions?.get(versionId);
  if (!version || version.taskGroupId !== childTaskGroupId) return { applied: false, tasksUpdated: 0, removedKnownCopies: 0 };
  let tasksUpdated = 0;
  let removedKnownCopies = 0;
  for (const childTask of version.tasks || []) {
    const inherited = hydrateInheritedContext(parsed, childTask, activeSnapshot, { capturedAt });
    if (!inherited || inherited.parentChain.length === 0) continue;
    const staticInherited = inheritedContextWithoutRuntimeFlags(inherited);
    updateMarkdownFrontmatter(childTask.path, (fm) => {
      const filtered = filterLocalKnownCopiesOfInherited(fm.knownList, staticInherited);
      if (filtered.removed.length > 0) {
        fm.knownList = filtered.knownList;
        fm.inheritedKnownCopyRemoved = true;
        fm.inheritedKnownCopyRemovedAt = capturedAt || isoNow();
        fm.inheritedKnownCopyRemovedIds = filtered.removed.map((item) => compactString(item?.id)).filter(Boolean);
        removedKnownCopies += filtered.removed.length;
      }
      fm.inheritedFrom = staticInherited;
      return fm;
    });
    tasksUpdated += 1;
  }
  return { applied: true, tasksUpdated, removedKnownCopies };
}

function malformedSurpriseReason(parsed) {
  return sanitizeFmScalar(`malformed ${SURPRISE_REPORT_PREFIX.trim()} marker: ${parsed?.parseError || 'invalid surprise report'}`);
}

function logEvent(eventsPath, event) {
  return appendRunEventViaStateWriter(eventsPath, event, stateWriterIo());
}

function appendRunLog(runDir, line) {
  return appendRunLogViaStateWriter(runDir, line, stateWriterIo());
}

function stableForHash(value) {
  if (Array.isArray(value)) return value.map((item) => stableForHash(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableForHash(value[key])]));
  }
  return value ?? null;
}

function sha256Of(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableForHash(value))).digest('hex')}`;
}

function asArray(value) {
  if (value == null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

function round3(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

function taskKnownIds(task) {
  return new Set((Array.isArray(task?.knownList) ? task.knownList : [])
    .map((item) => compactString(item?.id))
    .filter(Boolean));
}

function surpriseLevel(score) {
  if (score >= 0.67) return 'high';
  if (score >= 0.34) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

export function computeSurpriseHistoryEntry({ task, report, runId, runNodeId, actionKind, observedAt, evidenceRefs = [] }) {
  const normalizedReport = normalizeSurpriseReportPayload(report || {});
  const knownIds = taskKnownIds(task);
  const contradictedKnown = normalizedReport.contradictedKnown;
  const discoveredUnknowns = normalizedReport.discoveredUnknowns;
  const newKnownDeltas = normalizedReport.newKnownDeltas;
  const contradictedKnownIds = contradictedKnown.map((item) => item.knownId);
  const unknownKnownReferences = contradictedKnownIds.filter((id) => !knownIds.has(id));
  const blockingUnknowns = discoveredUnknowns.filter((item) => item.blocksReadiness !== false);
  const nonBlockingUnknowns = discoveredUnknowns.filter((item) => item.blocksReadiness === false);
  const rawPenalty =
    contradictedKnown.length * SURPRISE_PENALTY_WEIGHTS.wrongKnown
    + blockingUnknowns.length * SURPRISE_PENALTY_WEIGHTS.discoveredUnknown
    + nonBlockingUnknowns.length * SURPRISE_PENALTY_WEIGHTS.nonBlockingUnknown;
  const score = round3(Math.min(1, rawPenalty / SURPRISE_PENALTY_WEIGHTS.wrongKnown));
  const confidenceBefore = clamp01(task?.confidenceScore);
  const confidenceDrop = Math.min(1, rawPenalty * 0.1);
  const confidenceAfter = confidenceBefore == null ? null : round3(Math.max(0, confidenceBefore - confidenceDrop));
  const safeAction = compactString(actionKind) || 'observe';
  const safeObservedAt = compactString(observedAt) || isoNow();
  const safeRunNodeId = compactString(runNodeId) || 'run-node';
  const safeIdTime = safeObservedAt.replace(/[^0-9A-Za-z]+/g, '').slice(0, 14) || String(Date.now());
  return {
    id: `surprise-${safeAction}-${safeRunNodeId}-${safeIdTime}`.replace(/[^A-Za-z0-9._-]+/g, '-'),
    actionKind: safeAction,
    runId: compactString(runId),
    runNodeId: safeRunNodeId,
    observedAt: safeObservedAt,
    surpriseScore: score,
    surpriseLevel: surpriseLevel(score),
    penaltyModel: {
      wrongKnown: SURPRISE_PENALTY_WEIGHTS.wrongKnown,
      discoveredUnknown: SURPRISE_PENALTY_WEIGHTS.discoveredUnknown,
      nonBlockingUnknown: SURPRISE_PENALTY_WEIGHTS.nonBlockingUnknown,
    },
    rawPenalty: round3(rawPenalty),
    confidenceBefore,
    confidenceAfter,
    confidenceAdjustment: confidenceBefore == null || confidenceAfter == null ? null : round3(confidenceAfter - confidenceBefore),
    contradictedKnownIds,
    unknownKnownReferences,
    newUnknownIds: discoveredUnknowns.map((item) => item.id),
    blockingNewUnknownIds: blockingUnknowns.map((item) => item.id),
    nonBlockingNewUnknownIds: nonBlockingUnknowns.map((item) => item.id),
    newKnownIds: newKnownDeltas.map((item) => item.id),
    reportHash: sha256Of(normalizedReport),
    evidenceRefs: asArray(evidenceRefs).map((item) => String(item || '').trim()).filter(Boolean),
    summary: sanitizeFmScalar(normalizedReport.summary || `surprise ${surpriseLevel(score)} (${score})`, { maxLen: 500, fallback: `surprise ${surpriseLevel(score)}` }),
  };
}

function stringList(value) {
  return asArray(value)
    .map((item) => {
      if (item && typeof item === 'object') {
        const entries = Object.entries(item);
        if (entries.length === 1) return `${entries[0][0]}:${entries[0][1]}`;
        return String(item.value || item.text || item.url || item.path || item.ref || item.id || item.name || item.topic || item.source || item.citation || '');
      }
      return String(item || '');
    })
    .map((item) => item.trim())
    .filter(Boolean);
}

function semanticAssertionsFrom(raw) {
  const source = raw.semanticAssertions && typeof raw.semanticAssertions === 'object' && !Array.isArray(raw.semanticAssertions)
    ? raw.semanticAssertions
    : (raw.assertions && typeof raw.assertions === 'object' && !Array.isArray(raw.assertions) ? raw.assertions : {});
  return {
    contentIncludes: [
      ...stringList(source.contentIncludes),
      ...stringList(source.requiredContent),
      ...stringList(source.content),
    ],
    contentExcludes: [
      ...stringList(source.contentExcludes),
      ...stringList(source.forbiddenContent),
    ],
    requiredUrls: [
      ...stringList(source.requiredUrls),
      ...stringList(source.urlIdentity),
      ...stringList(source.urls),
    ],
    requiredArtifactIdentities: [
      ...stringList(source.requiredArtifactIdentities),
      ...stringList(source.artifactIdentity),
      ...stringList(source.artifactIdentities),
    ],
    requiredSources: [
      ...stringList(source.requiredSources),
      ...stringList(source.requiredCitations),
      ...stringList(source.sources),
      ...stringList(source.citations),
    ],
    forbiddenUrls: stringList(source.forbiddenUrls),
    forbiddenArtifacts: [
      ...stringList(source.forbiddenArtifacts),
      ...stringList(source.forbiddenArtifactIdentities),
    ],
    requiredCoverage: [
      ...stringList(source.requiredCoverage),
      ...stringList(source.coverage),
      ...stringList(source.coverageAssertions),
    ],
  };
}

function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s"'<>),\]]+/g);
  return (matches || []).map((url) => url.replace(/[.;:!?]+$/, ''));
}

function normalizeAcceptance(task) {
  const raw = task && typeof task.acceptance === 'object' && !Array.isArray(task.acceptance) ? task.acceptance : {};
  const mode = ACCEPTANCE_MODES.has(String(raw.mode || '').trim()) ? String(raw.mode).trim() : 'informational';
  return {
    mode,
    expectedOutcome: raw.expectedOutcome || task?.completionCriteria || '',
    requiredArtifacts: asArray(raw.requiredArtifacts),
    requiredChecks: asArray(raw.requiredChecks),
    semanticAssertions: semanticAssertionsFrom(raw),
  };
}

function normalizeResult(runNode) {
  const raw = runNode && typeof runNode.result === 'object' && !Array.isArray(runNode.result) ? runNode.result : {};
  const observed = raw.observed && typeof raw.observed === 'object' && !Array.isArray(raw.observed) ? raw.observed : {};
  const executorSummary = raw.executorSummary || '';
  const outcomeSummary = observed.outcomeSummary || '';
  const content = [
    executorSummary,
    outcomeSummary,
    ...stringList(observed.content),
    ...stringList(observed.contentText),
    ...stringList(observed.text),
  ].filter(Boolean).join('\n');
  return {
    executorSummary,
    observed: {
      outcomeSummary,
      content,
      artifactRefs: asArray(observed.artifactRefs),
      evidenceRefs: asArray(observed.evidenceRefs),
      urlRefs: [
        ...asArray(observed.urlRefs),
        ...asArray(observed.urls),
        ...extractUrls(content),
      ],
      sourceRefs: [
        ...asArray(observed.sourceRefs),
        ...asArray(observed.citationRefs),
        ...asArray(observed.sources),
        ...asArray(observed.citations),
      ],
      coverage: asArray(observed.coverage),
      checkResults: asArray(observed.checkResults),
    },
  };
}

function refText(value) {
  if (value && typeof value === 'object') return String(value.path || value.ref || value.id || value.command || '');
  return String(value || '');
}

function commandText(value) {
  if (value && typeof value === 'object') return String(value.command || value.name || value.id || '');
  return String(value || '');
}

function checkStatus(value) {
  if (value && typeof value === 'object') return String(value.status || value.result || '').toLowerCase();
  return '';
}

function normalizeIdentity(value) {
  return String(value || '').trim();
}

function normalizeUrl(value) {
  const raw = normalizeIdentity(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function identityText(value) {
  if (value && typeof value === 'object') {
    const preferred = value.url || value.path || value.ref || value.id || value.name || value.source || value.citation || value.topic;
    if (preferred) return String(preferred);
    const entries = Object.entries(value);
    if (entries.length === 1) return `${entries[0][0]}:${entries[0][1]}`;
    return '';
  }
  return String(value || '');
}

function observedArtifactIdentities(result) {
  return [
    ...result.observed.artifactRefs,
    ...result.observed.evidenceRefs,
  ].map(identityText).map(normalizeIdentity).filter(Boolean);
}

function observedUrlIdentities(result) {
  return [
    ...result.observed.urlRefs,
    ...result.observed.evidenceRefs,
  ].map(identityText).map(normalizeUrl).filter(Boolean);
}

function observedSourceIdentities(result) {
  return [
    ...result.observed.sourceRefs,
    ...result.observed.evidenceRefs,
  ].map(identityText).map(normalizeIdentity).filter(Boolean);
}

function observedCoverageIdentities(result) {
  return result.observed.coverage.map(identityText).map(normalizeIdentity).filter(Boolean);
}

function listHasIdentity(haystack, needle) {
  const normalizedNeedle = normalizeIdentity(needle);
  return !normalizedNeedle || haystack.includes(normalizedNeedle);
}

function listHasUrl(haystack, needle) {
  const normalizedNeedle = normalizeUrl(needle);
  return !normalizedNeedle || haystack.includes(normalizedNeedle);
}

function evidenceContainsRef(result, expectedRef, projectDir = process.cwd()) {
  const needle = refText(expectedRef);
  if (!needle) return true;
  const observedRefs = [
    ...result.observed.artifactRefs.map(refText),
    ...result.observed.evidenceRefs.map(refText),
  ];
  if (observedRefs.includes(needle)) return true;
  return existsSync(resolve(projectDir, needle)) || existsSync(resolve(needle)) || observedRefs.some((ref) => ref.endsWith(needle));
}

function applySemanticAssertions({ acceptance, result, missingExpected, failedChecks }) {
  const assertions = acceptance.semanticAssertions || {};
  const content = String(result.observed.content || '');
  const artifacts = observedArtifactIdentities(result);
  const urls = observedUrlIdentities(result);
  const sources = observedSourceIdentities(result);
  const coverage = observedCoverageIdentities(result);

  for (const expected of assertions.contentIncludes || []) {
    if (!content.includes(expected)) failedChecks.push(`content assertion not satisfied: ${expected}`);
  }
  for (const forbidden of assertions.contentExcludes || []) {
    if (forbidden && content.includes(forbidden)) failedChecks.push(`forbidden content observed: ${forbidden}`);
  }
  for (const expected of assertions.requiredUrls || []) {
    if (!listHasUrl(urls, expected)) failedChecks.push(`required URL identity mismatch: expected ${expected}`);
  }
  for (const expected of assertions.requiredArtifactIdentities || []) {
    if (!listHasIdentity(artifacts, expected)) failedChecks.push(`required artifact identity mismatch: expected ${expected}`);
  }
  for (const expected of assertions.requiredSources || []) {
    if (!listHasIdentity(sources, expected)) failedChecks.push(`required source/citation not observed: ${expected}`);
  }
  for (const forbidden of assertions.forbiddenUrls || []) {
    if (listHasUrl(urls, forbidden)) failedChecks.push(`forbidden URL observed: ${forbidden}`);
  }
  for (const forbidden of assertions.forbiddenArtifacts || []) {
    if (listHasIdentity(artifacts, forbidden)) failedChecks.push(`forbidden artifact observed: ${forbidden}`);
  }
  for (const expected of assertions.requiredCoverage || []) {
    if (!listHasIdentity(coverage, expected)) missingExpected.push(`required coverage not observed: ${expected}`);
  }
}

function buildExecutionResult({ task, runId, runNodeId, executorResult }) {
  const summary = sanitizeFmScalar(
    executorResult?.message || `Executor completed task ${task.id}.`,
    { maxLen: 1000, fallback: `Executor completed task ${task.id}.` },
  );
  const artifactRefs = [];
  const evidenceRefs = [`run:${runId}/node:${runNodeId}`];
  for (const ref of [executorResult?.artifactPath, executorResult?.workspacePath]) {
    if (!ref || artifactRefs.includes(ref)) continue;
    artifactRefs.push(ref);
  }
  if (executorResult?.workspacePath && !evidenceRefs.includes(executorResult.workspacePath)) {
    evidenceRefs.push(executorResult.workspacePath);
  }
  return {
    executorSummary: summary,
    ...(executorResult?.workspacePath ? { executionWorkspacePath: executorResult.workspacePath } : {}),
    observed: {
      outcomeSummary: summary,
      artifactRefs,
      evidenceRefs,
      checkResults: [],
    },
  };
}

function buildReviewReport({ projectDir, task, runNode }) {
  const acceptance = normalizeAcceptance(task);
  const result = normalizeResult(runNode);
  const missingExpected = [];
  const unsupportedObserved = [];
  const failedChecks = [];

  if (acceptance.expectedOutcome && !result.observed.outcomeSummary) {
    missingExpected.push('observed.outcomeSummary is missing for the expected outcome');
  }

  for (const artifact of acceptance.requiredArtifacts) {
    if (!evidenceContainsRef(result, artifact, projectDir)) {
      missingExpected.push(`required artifact not observed: ${refText(artifact)}`);
    }
  }

  for (const requiredCheck of acceptance.requiredChecks) {
    const command = commandText(requiredCheck);
    if (!command) continue;
    const observed = result.observed.checkResults.find((check) => commandText(check) === command);
    if (!observed) {
      missingExpected.push(`required check not observed: ${command}`);
      continue;
    }
    const status = checkStatus(observed);
    if (status && !['passed', 'pass', 'ok', 'success', 'succeeded'].includes(status)) {
      failedChecks.push(`${command}: ${status}`);
    }
  }

  applySemanticAssertions({ acceptance, result, missingExpected, failedChecks });

  if (result.executorSummary && !result.observed.outcomeSummary && result.observed.artifactRefs.length === 0 && result.observed.evidenceRefs.length === 0) {
    unsupportedObserved.push('executorSummary exists without observed outcome or evidence refs');
  }

  const decision = failedChecks.length > 0
    ? 'rejected'
    : (missingExpected.length > 0 || unsupportedObserved.length > 0 ? 'needs_verification' : 'approved');
  return {
    schemaVersion: 'acceptance-review-v1',
    decision,
    mode: acceptance.mode,
    expectedOutcome: acceptance.expectedOutcome,
    observedOutcome: result.observed.outcomeSummary,
    missingExpected,
    unsupportedObserved,
    failedChecks,
    followUpNeeded: decision === 'approved' ? [] : ['Add observed evidence/check results or revise acceptance before closure is trusted.'],
    reviewedAcceptanceHash: sha256Of(acceptance),
    reviewedResultHash: sha256Of(result),
  };
}

function resolveRunId(parsed, requested) {
  if (requested) return String(requested);
  const runs = [...parsed.runs.values()];
  const active = runs.filter((r) => r.status === 'active');
  if (active.length === 1) return active[0].id;
  return DEFAULT_RUN_ID;
}

export function filterConcurrentTargetValidationErrors(errors, { allowConcurrentTarget, runId, targetTaskId, targetTaskGroupVersionId }) {
  if (!allowConcurrentTarget || !runId) return errors;
  return errors.filter((error) => {
    const message = String(error || '');
    const runMatch = message.match(/\/runs\/([^/:]+)(?:[/:])/);
    if (runMatch && runMatch[1] !== runId) return false;

    const taskMatch = message.match(/\/task-groups\/([^/]+)\/versions\/([^/]+)\/tasks\/([^/]+)\.md:/);
    if (taskMatch) {
      const versionId = taskMatch[2];
      const taskId = taskMatch[3];
      if (targetTaskId && taskId !== targetTaskId) return false;
      if (targetTaskGroupVersionId && versionId !== targetTaskGroupVersionId) return false;
    }

    return true;
  });
}

function isTransientConcurrentParseError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('/runs/') && (
    message.includes('Missing YAML frontmatter')
    || message.includes('ENOENT')
    || message.includes('not found')
  );
}

function parseProjectForRunner(projectDir, { allowConcurrentTarget = false } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return parseProject(projectDir);
    } catch (error) {
      if (!allowConcurrentTarget || attempt >= 5 || !isTransientConcurrentParseError(error)) throw error;
      sleepMs(25 * (attempt + 1));
    }
  }
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
    writeTextFileAtomic(indexPath, fmBlock(fm) + `# Run ${runId}\n`);
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

function hasManualBlockerMarker(task) {
  return Boolean(
    task?.needsManualReview === true
    || task?.manualReviewReason
    || task?.awaitingPromotion === true
    || task?.awaitingPromotionPartialId
    || task?.repeatedPartialNeedsReview === true
    || task?.lastRunFailureReason
    || task?.malformedPartialRequest === true
    || task?.malformedSurpriseReport === true
  );
}

function blockedTaskMissingEvidence(task) {
  const isBlocked = task?.status === 'blocked' || task?.runReadiness === 'blocked';
  return Boolean(isBlocked && normalizeBlockedBy(task).length === 0 && !hasManualBlockerMarker(task));
}

function blockedEvidenceIssueForTask(task) {
  return {
    taskId: task.id,
    taskGroupVersionId: task.taskGroupVersionId,
    path: task.path,
    status: task.status || null,
    runReadiness: task.runReadiness || null,
    runReadinessReason: task.runReadinessReason || null,
    reason: 'blocked_task_missing_machine_readable_blocker',
    message: `Task ${task.taskGroupVersionId}:${task.id} is blocked but has no blockedBy or explicit manual/external blocker marker.`,
  };
}

function blockedEvidenceIssues(parsed) {
  return [...parsed.tasks.values()]
    .filter((task) => !['done', 'cancelled'].includes(task.status))
    .filter(blockedTaskMissingEvidence)
    .map(blockedEvidenceIssueForTask);
}

function blockerEvaluationForTask(parsed, task) {
  const blockers = normalizeBlockedBy(task);
  if (blockers.length === 0) {
    return {
      hasBlockers: false,
      allResolved: true,
      unresolved: false,
      blockers: [],
    };
  }
  const results = blockers.map((ref) => ({ ref, key: blockerKey(ref), ...resolveBlocker(parsed, ref) }));
  const allResolved = results.every((result) => result.resolved);
  return {
    hasBlockers: true,
    allResolved,
    unresolved: !allResolved,
    blockers: results,
  };
}

function applyBlockerGate(parsed, task, classification) {
  const blockerEvaluation = blockerEvaluationForTask(parsed, task);
  if (!blockerEvaluation.hasBlockers || blockerEvaluation.allResolved) {
    return { ...classification, blockerEvaluation };
  }
  const unresolved = blockerEvaluation.blockers
    .filter((result) => !result.resolved)
    .map((result) => result.key)
    .join(', ');
  return {
    ...classification,
    runReadiness: 'blocked',
    originalRunReadiness: classification.runReadiness,
    source: 'blocked_by_gate',
    reason: `Task has unresolved blockedBy reference(s): ${unresolved || 'unknown blocker'}.`,
    nextAction: 'resolve_blocker',
    blockerEvaluation,
  };
}

export function recheckBlockedTasks(workDir, { dryRun = false, allowConcurrentTarget = false, runId = null } = {}) {
  const workRoot = resolve(workDir);
  const projects = discoverProjects(workRoot);
  if (projects.length !== 1) throw new Error(`Expected exactly 1 TaskOps work under ${workDir}, found ${projects.length}`);
  const projectDir = projects[0];
  const parsed = parseProjectForRunner(projectDir, { allowConcurrentTarget });
  const validationErrors = filterConcurrentTargetValidationErrors(parsed.errors, {
    allowConcurrentTarget,
    runId,
    targetTaskId: null,
    targetTaskGroupVersionId: null,
  });
  if (validationErrors.length > 0) {
    throw new Error(`TaskOps work has validation errors; cannot recheck blockers:\n- ${validationErrors.join('\n- ')}`);
  }

  const checked = [];
  const unblocked = [];
  const stillBlocked = [];
  const now = isoNow();

  for (const task of parsed.tasks.values()) {
    if (['done', 'cancelled'].includes(task.status)) continue;
    const isBlocked = task.status === 'blocked' || task.runReadiness === 'blocked';
    if (task.awaitingPromotion === true || task.awaitingPromotionPartialId) {
      const item = {
        taskId: task.id,
        taskGroupVersionId: task.taskGroupVersionId,
        path: task.path,
        allResolved: false,
        awaitingPromotion: true,
        partialId: task.awaitingPromotionPartialId || null,
        blockers: [],
      };
      checked.push(item);
      stillBlocked.push(item);
      continue;
    }
    const blockers = normalizeBlockedBy(task);
    if (!isBlocked && blockers.length === 0) continue;
    if (blockers.length === 0) {
      if (hasManualBlockerMarker(task)) {
        const item = {
          taskId: task.id,
          taskGroupVersionId: task.taskGroupVersionId,
          path: task.path,
          allResolved: false,
          manualBlockerMarker: true,
          blockers: [],
          detail: 'blocked task uses an explicit manual/external blocker marker',
        };
        checked.push(item);
        stillBlocked.push(item);
        continue;
      }
      const item = {
        taskId: task.id,
        taskGroupVersionId: task.taskGroupVersionId,
        path: task.path,
        allResolved: false,
        missingBlockerEvidence: true,
        blockers: [],
        detail: 'blocked task has no blockedBy or explicit manual/external blocker marker',
      };
      checked.push(item);
      stillBlocked.push(item);
      continue;
    }
    const results = blockers.map((ref) => ({ ref, key: blockerKey(ref), ...resolveBlocker(parsed, ref) }));
    const allResolved = results.every((result) => result.resolved);
    const item = { taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, path: task.path, allResolved, blockers: results };
    checked.push(item);
    if (!allResolved) {
      stillBlocked.push(item);
      continue;
    }
    if (!isBlocked) continue;
    unblocked.push(item);
    if (dryRun) continue;
    updateMarkdownFrontmatter(task.path, (fm) => {
      if (fm.status === 'blocked') fm.status = 'pending';
      if (fm.runReadiness === 'blocked') {
        if (fm.unblockRunReadiness) fm.runReadiness = fm.unblockRunReadiness;
        else delete fm.runReadiness;
      }
      const reclassified = classifyTaskReadiness({
        ...task,
        ...fm,
        status: fm.status,
        runReadiness: fm.runReadiness,
      });
      fm.runReadiness = reclassified.runReadiness;
      if (reclassified.runReadiness === 'blocked') fm.status = 'blocked';
      fm.runReadinessReason = sanitizeFmScalar(`Blockers resolved by taskops blocker recheck at ${now}; reclassified as ${reclassified.runReadiness}. ${reclassified.reason || ''}`);
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
    const classification = applyBlockerGate(parsed, task, classifyTaskReadiness(task));
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
    const classification = applyBlockerGate(parsed, task, classifyTaskReadiness(task));
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

export function expectedPlanPhaseForProgress(planProgress, thresholds = EXPECTED_PLAN_PHASE_THRESHOLDS) {
  const progress = Number(planProgress);
  if (!Number.isFinite(progress)) return 'exploring';
  if (progress >= thresholds.hard) return 'committing';
  if (progress >= thresholds.soft) return 'converging';
  return 'exploring';
}

function actionAwareExpectedPlanAdvisory(actionKind, phase) {
  const action = actionKind || 'generic';
  if (action === 'decompose') {
    if (phase === 'committing') return 'Decomposition advisory: committing phase. Prefer closing this depth with bounded terminal children; do not open another scope unless it is strictly necessary and still fully closable within the remaining step budget.';
    if (phase === 'converging') return 'Decomposition advisory: converging phase. Before opening deeper child scopes, check whether the current depth can be closed with runnable, blocked, or exploration-ready children.';
    return 'Decomposition advisory: exploring phase. Decompose normally, but keep child scopes compatible with the declared expected plan.';
  }
  if (action === 'execute') {
    if (phase === 'committing') return 'Execution advisory: committing phase. Prioritize honest completion or a clear partial request when finishing everything is not possible.';
    if (phase === 'converging') return 'Execution advisory: converging phase. Keep execution focused on closure evidence and avoid expanding the task scope.';
    return 'Execution advisory: exploring phase. Execute normally while preserving evidence that will help later closure.';
  }
  if (action === 'explore') {
    if (phase === 'committing') return 'Exploration advisory: committing phase. Capture the smallest useful artifact that makes the current uncertainty closable or explicitly blocked.';
    if (phase === 'converging') return 'Exploration advisory: converging phase. Prefer targeted evidence gathering over broad discovery.';
    return 'Exploration advisory: exploring phase. Explore enough to reduce uncertainty without turning exploration into unbounded scope.';
  }
  if (action === 'loopback') {
    if (phase === 'committing') return 'Loopback advisory: committing phase. Resolve the delegated question narrowly and return the graph to a closable state.';
    if (phase === 'converging') return 'Loopback advisory: converging phase. Keep the resolution concise and avoid spawning new delegation scope.';
    return 'Loopback advisory: exploring phase. Resolve the delegation while preserving enough context for downstream work.';
  }
  if (phase === 'committing') return 'Expected plan advisory: committing phase. Favor closure over expansion.';
  if (phase === 'converging') return 'Expected plan advisory: converging phase. Favor narrowing over expansion.';
  return 'Expected plan advisory: exploring phase. Continue within the expected plan.';
}

function budgetPromptLines(budget, { allowPartialRequest = false, actionKind = 'generic' } = {}) {
  const coordinate = budget?.expectedPlanCoordinate?.enabled === true
    ? budget.expectedPlanCoordinate
    : null;
  if (!budget || budget.enabled !== true || (budget.finishingMode !== true && !coordinate)) return [];
  const lines = [];
  if (coordinate) {
    const pct = Math.round(coordinate.planProgress * 100);
    const diagnostic = coordinate.lineageDiagnostic;
    lines.push(
      '',
      'Budget / expected plan coordinate:',
      `Remaining step budget: ${budget.remaining} / ${budget.maxSteps}.`,
      `Expected plan phase: ${coordinate.phase}.`,
      `Lineage depth consumed: ${coordinate.consumedDepth}. Current task expectedDepth: ${coordinate.expectedDepth}. Consumed/expected progress: ${coordinate.consumedDepthSinceDeclaration} / ${coordinate.expectedDepth} (${pct}%).`,
      `Current task expectedBreadth: ${coordinate.expectedBreadth}.`,
      `Expected plan rationale: ${coordinate.rationale}`,
      actionAwareExpectedPlanAdvisory(actionKind, coordinate.phase),
    );
    if (diagnostic) {
      const diagnosticPct = Math.round(diagnostic.cumulativePlanProgress * 100);
      lines.push(
        `Diagnostic only: lineage cumulative expectedDepth=${diagnostic.cumulativeExpectedDepth}, lineage progress=${diagnostic.consumedDepth}/${diagnostic.cumulativeExpectedDepth} (${diagnosticPct}%). Do not use this as a hard stop policy.`,
      );
    }
  }
  if (budget.finishingMode === true) {
    lines.push(
      '',
      'Budget / finishing mode:',
      `남은 step이 얼마 없다 (remaining ${budget.remaining} / ${budget.maxSteps}). 새 작업 범위를 시작하지 마라. 진행 중인 것을 정직하게 마무리하고, 끝내지 못한 나머지는 follow-up으로 명시한 뒤 partial 상태로 닫을 준비를 해라. 무리하게 done으로 표시하지 마라.`,
    );
  }
  if (allowPartialRequest && budget.finishingMode === true) {
    lines.push(
      'Execution partial request protocol:',
      'Look at the full task scope. If you can finish this task completely and honestly in this turn, finish it normally.',
      'If you can only complete part of it, do only the completed part honestly and leave the rest for follow-up. Do not claim the whole task is done.',
      'Do not call closure or graph-control commands such as `taskops close`; the runner owns closure and graph mutation.',
      `To request runner-owned partial completion, include exactly one final-response line with this prefix and valid JSON: ${PARTIAL_REQUEST_PREFIX} {"partialRequested": true, "completedSummary": "what you completed", "incompleteSummary": "what remains"}`,
    );
  }
  return lines;
}

function promptWithBudget(lines, budget, options = {}) {
  return [...lines, ...budgetPromptLines(budget, options)].join('\n');
}

function taskUncertaintyPromptLines(task) {
  const knownList = Array.isArray(task.knownList) && task.knownList.length
    ? task.knownList.map((item) => `${item?.id || '(no id)'}: ${item?.claim || ''} [${item?.verificationStatus || 'unverified'}]`).join('; ')
    : '(none declared)';
  return [
    `Task uncertaintyState: ${task.uncertaintyState || '(none declared)'}`,
    `Task confidenceScore: ${task.confidenceScore ?? '(none declared)'}`,
    `Task knownList: ${knownList}`,
  ];
}

function inheritedContextPromptLines(inheritedContext = null) {
  const context = inheritedContext && typeof inheritedContext === 'object' && !Array.isArray(inheritedContext)
    ? inheritedContext
    : null;
  if (!context) return [];
  const parentChain = Array.isArray(context.parentChain) && context.parentChain.length
    ? context.parentChain.map((item) => `${item?.taskId || '(unknown task)'}@${item?.taskGroupVersionId || '(unknown version)'}`).join(' -> ')
    : '(none)';
  const inheritedKnownRefs = Array.isArray(context.inheritedKnownRefs) && context.inheritedKnownRefs.length
    ? context.inheritedKnownRefs.map((item) => `${item?.id || '(no id)'}: source ${item?.sourceTaskId || '?'}:${item?.sourceKnownId || '?'} trust=${item?.trust || 'inherited_unverified'}${item?.claimPreview ? ` claimPreview="${item.claimPreview}"` : ''}`).join('; ')
    : '(none)';
  const inheritedFailurePatterns = Array.isArray(context.inheritedFailurePatterns) && context.inheritedFailurePatterns.length
    ? context.inheritedFailurePatterns.map((item) => `${item?.id || '(no id)'}: ${item?.type || 'failure_pattern'} from ${item?.sourceTaskId || '?'}${item?.sourceKnownId ? ` known=${item.sourceKnownId}` : ''}${item?.summary ? ` summary="${item.summary}"` : ''}`).join('; ')
    : '(none)';
  const inheritedSurpriseRefs = Array.isArray(context.inheritedSurpriseRefs) && context.inheritedSurpriseRefs.length
    ? context.inheritedSurpriseRefs.map((item) => `${item?.sourceTaskId || '?'}:${item?.surpriseHistoryId || '?'}`).join('; ')
    : '(none)';
  const staleWarning = context.stale === true || context.staleWarning
    ? `Stale warning: ${context.staleWarning || 'birth snapshot differs from dynamically hydrated ancestor context'}`
    : 'Stale warning: (none)';
  const lineageWarnings = Array.isArray(context.lineageWarnings) && context.lineageWarnings.length
    ? context.lineageWarnings.join('; ')
    : '(none)';
  return [
    '',
    'Inherited context (not ground truth):',
    'Inherited context is not local knowledge. Treat it only as revalidation targets and failure-pattern warnings.',
    'Do not copy inherited claims into knownList unless this task locally revalidates them.',
    `Parent chain: ${parentChain}`,
    `Inherited known refs: ${inheritedKnownRefs}`,
    `Inherited failure patterns: ${inheritedFailurePatterns}`,
    `Inherited surprise refs: ${inheritedSurpriseRefs}`,
    staleWarning,
    `Lineage warnings: ${lineageWarnings}`,
  ];
}

function childTaskUncertaintySchemaPromptLines() {
  return [
    'Phase 1 uncertainty metadata is required on each child task:',
    '- uncertaintyState: unknown_unknown | known_unknown | known',
    '- confidenceScore: number from 0.0 to 1.0. This is only a weak self-estimate; do not overstate certainty.',
    '- knownList: append-only list of concrete claims the task currently treats as known. Each item must have id, claim, verificationStatus: unverified.',
    "Use unknown_unknown when the task's internal structure is not understood enough to decompose or execute honestly.",
    'Use known_unknown when the objective boundary is meaningful but important unknowns remain.',
    'Use known only when the task has enough understood context to be runnable under its stated completionCriteria.',
    'Do not copy inherited context into knownList unless the child task locally revalidates it.',
  ];
}

function childTaskExpectedPlanPromptLines() {
  return [
    'Expected plan metadata is required on each child task:',
    '- expectedPlan.expectedDepth: non-negative integer estimate of how many more decomposition levels this child may need.',
    '- expectedPlan.expectedBreadth: non-negative integer estimate of roughly how many child tasks this child may create if decomposed.',
    '- expectedPlan.rationale: short evidence-based reason for the depth/breadth estimate.',
    'Estimate per child. It is an approximate planning coordinate, not a promise. Do not add declaredAt; the runner may add timing metadata later.',
  ];
}

function childTaskBlockedByPromptLines(versionId, blockerCatalog = []) {
  const catalogLines = Array.isArray(blockerCatalog) && blockerCatalog.length
    ? [
      'Available blocker refs from the active snapshot:',
      ...blockerCatalog.map((item) => `- { type: 'task', id: '${item.id}', taskGroupVersionId: '${item.taskGroupVersionId}' } status=${item.status || 'unknown'} readiness=${item.runReadiness || 'unknown'} terminal=${item.terminal === true ? 'yes' : 'no'} decomposed=${item.decomposed === true ? 'yes' : 'no'}`),
      'If a child depends on implementation output from another active branch, reference the exact terminal descendant task from this catalog. A decomposed parent is not implementation-complete evidence by itself.',
    ]
    : [
      'If a child depends on another active branch, use the exact task id and taskGroupVersionId from the active snapshot when available. Do not replace machine-readable blockedBy with prose.',
      'A decomposed parent is not implementation-complete evidence by itself; implementation dependencies should point at the terminal descendant that produces the evidence.',
    ];
  return [
    'When a child task is blocked by another task, use blockedBy as a list of structured refs, not strings:',
    `- sibling task blocker: { type: 'task', id: '<task-id>', taskGroupVersionId: '${versionId}' }`,
    "- run-node blocker, only when truly needed: { type: 'runNode', runId: '<run-id>', runNodeId: '<run-node-id>' }",
    ...catalogLines,
  ];
}

function surpriseReportPromptLines({ artifactRequired = false } = {}) {
  const locationLine = artifactRequired
    ? 'Include this report inside the exploration artifact. You may also repeat it in the final response.'
    : 'Include this report as exactly one final-response line when the task completes normally.';
  return [
    'Phase 2 surprise report protocol:',
    locationLine,
    `Use prefix ${SURPRISE_REPORT_PREFIX} followed by one-line JSON.`,
    'The worker reports facts only; the runner computes surprise/penalty. Do not self-score surprise.',
    'Schema: {"summary":"what changed relative to knownList","contradictedKnown":[{"knownId":"k1","observedEvidence":"what disproved or weakened it","correctedClaim":"optional corrected claim"}],"discoveredUnknowns":[{"id":"u1","question":"new uncertainty","whyDiscovered":"evidence or reason","blocksReadiness":true}],"newKnownDeltas":[{"id":"k2","claim":"new learned claim","evidence":"supporting evidence","revalidatedFromInheritedRef":"optional inherited ref id when locally revalidated"}]}',
    'Use empty arrays when there is no contradiction, no new unknown, or no new known delta. Do not redeclare the whole knownList.',
  ];
}

export function buildAgentExecutionPrompt({ project, task, budget = null, inheritedContext = null, projectDir = null, artifactWorkspacePath = null }) {
  const projectDirForPrompt = projectDir ? resolve(projectDir) : null;
  const artifactWorkspaceForPrompt = artifactWorkspacePath ? resolve(artifactWorkspacePath) : null;
  return promptWithBudget([
    'You are a TaskOps worker agent.',
    `Work: ${project.id} — ${project.title || ''}`.trim(),
    `Work objective: ${project.objective || ''}`,
    ...(projectDirForPrompt ? [`TaskOps work directory: ${projectDirForPrompt}`] : []),
    '',
    `Task: ${task.id} — ${task.title}`,
    `Task objective: ${task.objective || ''}`,
    `Task responsibility: ${task.responsibility || ''}`,
    `Task completion criteria: ${task.completionCriteria || ''}`,
    ...taskUncertaintyPromptLines(task),
    ...inheritedContextPromptLines(inheritedContext),
    '',
    'Execute this single TaskOps task. Do not recursively invoke `taskops run`.',
    'Do not invoke TaskOps graph/queue control commands such as `taskops run`, `taskops runner`, `taskops queue claim`, `taskops queue release`, `taskops restart`, or `taskops close`; the parent TaskOps runner owns graph mutation, queue leases, and EoW closure.',
    ...(artifactWorkspaceForPrompt ? [
      `Task artifact workspace: ${artifactWorkspaceForPrompt}`,
      'Write any files, code, test fixtures, or other task artifacts under the task artifact workspace only, unless the task explicitly names a different absolute target path.',
      'The runner invokes you with the task artifact workspace as cwd. Relative paths for new files must stay inside that workspace.',
    ] : []),
    'You may inspect local files and produce task artifacts when the task requires it. If the task is only a runtime invocation proof, the successful OpenClaw turn itself is the evidence; return a concise success summary.',
    ...surpriseReportPromptLines(),
    'When done, reply with a short summary of what was accomplished and any artifacts produced.',
  ], budget, { actionKind: 'execute', allowPartialRequest: true });
}

export function buildAgentDecompositionPrompt({ project, projectDir, task, childTaskGroupId, versionId, budget = null, inheritedContext = null, blockerCatalog = [] }) {
  if (!projectDir) throw new Error('Missing projectDir for decomposition prompt');
  const workDirForPrompt = resolve(projectDir);
  return promptWithBudget([
    'You are a TaskOps decomposition agent.',
    `Work: ${project.id} — ${project.title || ''}`.trim(),
    `Work objective: ${project.objective || ''}`,
    '',
    `Task to decompose: ${task.id} — ${task.title}`,
    `Task objective: ${task.objective || ''}`,
    `Task responsibility: ${task.responsibility || ''}`,
    `Task completion criteria: ${task.completionCriteria || ''}`,
    ...taskUncertaintyPromptLines(task),
    ...inheritedContextPromptLines(inheritedContext),
    '',
    'Author a TaskOps child task group and a v1 version that decomposes this task using the canonical md-first format.',
    `Target child task group id: ${childTaskGroupId}`,
    `Target version id: ${versionId}`,
    `Create the task group folder (with index.md) under task-groups/<id>/, then call \`${taskopsCliCommandForPrompt()} decompose ${shellQuote(workDirForPrompt)} --task-group-id <child-tg-id> --spec <spec.json>\` to write the new version.`,
    'Each new child task must include taskOpsVersion, entityType=task, id, taskGroupId, taskGroupVersionId, title, objective, responsibility, completionCriteria, order, createdAt, status, plus an explicit runReadiness.',
    ...childTaskUncertaintySchemaPromptLines(),
    ...childTaskExpectedPlanPromptLines(),
    ...childTaskBlockedByPromptLines(versionId, blockerCatalog),
    'Do not mark child tasks as runnable unless they truly meet the runnable criteria. Use needs_exploration or blocked with a reason field when the inputs are not yet known.',
    'Do not recursively invoke `taskops run`.',
  ], budget, { actionKind: 'decompose' });
}

export function buildAgentLoopbackPrompt({ project, delegate, runId, loopbackNodeId, artifactPath, actorName, budget = null }) {
  if (!artifactPath) throw new Error('Missing artifactPath for loopback prompt');
  const artifactPathForPrompt = resolve(artifactPath);
  return promptWithBudget([
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
    `Write the loopback resolution artifact at: ${artifactPathForPrompt}`,
    'Record the work taken, any decisions made, and what should happen next. Do not recursively invoke `taskops run`.',
  ], budget, { actionKind: 'loopback' });
}

export function buildAgentExplorationPrompt({ project, task, runId, runNodeId, artifactPath, budget = null, inheritedContext = null }) {
  if (!artifactPath) throw new Error('Missing artifactPath for exploration prompt');
  const artifactPathForPrompt = resolve(artifactPath);
  return promptWithBudget([
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
    ...taskUncertaintyPromptLines(task),
    ...inheritedContextPromptLines(inheritedContext),
    '',
    'Run a minimal, safe exploration pass: search/read/try just enough to record learned facts, discovered constraints, failed/successful approaches, remaining unknowns, and a recommended next decomposition or runnable task.',
    `Write the exploration artifact at: ${artifactPathForPrompt}`,
    `Run id: ${runId}, run node id: ${runNodeId}.`,
    ...surpriseReportPromptLines({ artifactRequired: true }),
    'Do not mark the parent task as done; the runner manages task graph state. Do not recursively invoke `taskops run`.',
  ], budget, { actionKind: 'explore' });
}

function safeSessionPart(value, fallback = 'task') {
  const safe = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safe || fallback;
}

function openClawWorkerSessionKey({ agentId, projectId, taskId, action }) {
  const parts = [
    'taskops-worker',
    safeSessionPart(projectId, 'work'),
    safeSessionPart(taskId, 'task'),
    safeSessionPart(action, 'execute'),
    String(process.pid),
    String(Date.now()),
  ];
  return `agent:${agentId}:` + parts.join('-');
}

function invokeExecutor({ project, projectDir = null, task, executor, agentId, stepTimeoutMs, budget = null, inheritedContext = null, artifactWorkspacePath = null }) {
  if (executor === 'dry-run') {
    return {
      ok: true,
      message: `dry-run executor synthetically completed task ${task.id}`,
      executor: 'dry-run',
      ...(artifactWorkspacePath ? { workspacePath: artifactWorkspacePath } : {}),
    };
  }
  const adapter = executor === 'openclaw-agent' ? 'openclaw-cli' : executor;
  if (RUNTIME_ADAPTER_NAMES.includes(adapter)) {
    const prompt = buildAgentExecutionPrompt({ project, task, budget, inheritedContext, projectDir, artifactWorkspacePath });
    const result = invokeRuntimeAdapter(adapter, {
      prompt,
      agentId,
      sessionKey: openClawWorkerSessionKey({ agentId, projectId: project.id, taskId: task.id, action: 'execute' }),
      timeoutMs: stepTimeoutMs,
      ...(artifactWorkspacePath ? { cwd: artifactWorkspacePath } : {}),
    });
    return { ...result, executor, message: result.message || `${adapter} completed task ${task.id}`, ...(artifactWorkspacePath ? { workspacePath: artifactWorkspacePath } : {}) };
  }
  return { ok: false, message: `Unknown executor '${executor}'`, executor };
}

export function isSelfDelegate(node, project) {
  if (!node || typeof node !== 'object') return false;
  if (node.type !== 'delegate') return false;
  const delegateeType = typeof node.delegateeType === 'string' ? node.delegateeType.trim().toLowerCase() : '';
  const delegateeRef = node.delegateeRef == null ? '' : String(node.delegateeRef).trim().toLowerCase();
  const refIsSelf = delegateeRef === 'self' || (project?.id && delegateeRef === String(project.id).toLowerCase());
  if (delegateeType && delegateeType !== 'self') return false;
  if (delegateeRef && !refIsSelf) return false;
  if (delegateeType === 'self' || refIsSelf) return true;
  if (node.selfDelegate === true) return true;
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

function performAgentLoopback({ project, projectDir, delegate, executor, agentId, stepTimeoutMs, runDir, runId, loopbackNodeId, actorName, budget = null }) {
  const artifactsDir = join(runDir, 'artifacts');
  ensureDir(artifactsDir);
  const artifactPath = join(artifactsDir, `${loopbackNodeId}.md`);
  const prompt = buildAgentLoopbackPrompt({ project, delegate, runId, loopbackNodeId, artifactPath, actorName, budget });
  const adapter = executor === 'openclaw-agent' ? 'openclaw-cli' : executor;
  const result = invokeRuntimeAdapter(adapter, {
    prompt,
    agentId,
    sessionKey: openClawWorkerSessionKey({ agentId, projectId: project.id, taskId: delegate.sourceTaskId || delegate.id, action: 'loopback' }),
    timeoutMs: stepTimeoutMs,
    cwd: artifactsDir,
  });
  if (!result.ok) return { ok: false, message: result.message };
  if (!existsSync(artifactPath)) {
    return { ok: false, message: `${adapter} did not write expected loopback artifact at ${artifactPath}; refusing to mark loopback done` };
  }
  return { ok: true, artifactPath, message: result.stdout || `Agent recorded loopback at ${artifactPath}` };
}

function writeRunEdge({ runDir, runId, edgeId, fromRunNodeId, toRunNodeId, edgeType, createdAt, note }) {
  return writeRunEdgeViaStateWriter({ runDir, runId, edgeId, fromRunNodeId, toRunNodeId, edgeType, createdAt, note }, stateWriterIo());
}

function executeSelfLoopback({ projectDir, project, delegate, runDir, runId, eventsPath, executor, agentId, stepTimeoutMs, loopbackIndex, actorName, budget = null }) {
  const startedAt = isoNow();
  const safeDelegateId = String(delegate.id).replace(/[^a-zA-Z0-9._-]/g, '-');
  const loopbackNodeId = `run-node-loopback-${safeDelegateId}${loopbackIndex > 1 ? `-${loopbackIndex}` : ''}`;
  const loopbackRunId = delegate.runId || runId;
  const loopbackRunDir = loopbackRunId === runId ? runDir : ensureRunDirectories(projectDir, loopbackRunId, project);
  const loopbackPath = ensureRunNode({
    runDir: loopbackRunDir, runId: loopbackRunId, runNodeId: loopbackNodeId,
    type: 'loopback',
    title: `Loopback resolution for ${delegate.id}`,
    sourceTaskId: delegate.sourceTaskId || null,
    sourceTaskGroupVersionId: delegate.sourceTaskGroupVersionId || null,
    status: 'active',
    kindLabel: 'loopback',
  });
  updateMarkdownFrontmatter(loopbackPath, (fm) => {
    fm.loopbackOfRunNodeId = delegate.id;
    fm.loopbackPolicy = 'self';
    fm.loopbackIndex = loopbackIndex;
    fm.executionMode = 'loopback';
    fm.executedBy = actorName;
    return fm;
  });

  writeRunEdge({
    runDir: loopbackRunDir, runId: loopbackRunId,
    edgeId: `edge-${delegate.id}-loopback-${loopbackIndex}`,
    fromRunNodeId: delegate.id,
    toRunNodeId: loopbackNodeId,
    edgeType: 'loopback',
    createdAt: startedAt,
    note: 'Loopback resolution opened by runner',
  });

  logEvent(eventsPath, {
    timestamp: startedAt, type: 'loopback_started', runId,
    loopbackRunId,
    delegateRunNodeId: delegate.id, loopbackRunNodeId: loopbackNodeId,
    sourceTaskId: delegate.sourceTaskId || null,
    sourceTaskGroupVersionId: delegate.sourceTaskGroupVersionId || null,
    executor, executedBy: actorName, executionMode: 'loopback', loopbackIndex,
  });
  appendRunLog(runDir, `${startedAt} loopback_started delegateRunNodeId=${delegate.id} loopbackRunNodeId=${loopbackNodeId} executor=${executor} executedBy=${actorName}`);
  if (loopbackRunDir !== runDir) {
    appendRunLog(loopbackRunDir, `${startedAt} loopback_started delegateRunNodeId=${delegate.id} loopbackRunNodeId=${loopbackNodeId} executor=${executor} executedBy=${actorName} workerRunId=${runId}`);
  }

  let result;
  try {
    result = executor === 'dry-run'
      ? performDryRunLoopback({ runDir: loopbackRunDir, loopbackNodeId, delegate, actorName })
      : performAgentLoopback({ project, projectDir, delegate, executor, agentId, stepTimeoutMs, runDir: loopbackRunDir, runId: loopbackRunId, loopbackNodeId, actorName, budget });
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const finishedAt = isoNow();
  if (!result.ok) {
    updateMarkdownFrontmatter(loopbackPath, (fm) => {
      fm.status = 'blocked';
      fm.lastRunFailureReason = sanitizeFmScalar(result.message);
      return fm;
    });
    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'loopback_failed', runId,
      loopbackRunId,
      delegateRunNodeId: delegate.id, loopbackRunNodeId: loopbackNodeId,
      executor, executedBy: actorName, executionMode: 'loopback', loopbackIndex,
      message: result.message || null,
    });
    appendRunLog(runDir, `${finishedAt} loopback_failed delegateRunNodeId=${delegate.id} reason=${result.message || ''}`);
    if (loopbackRunDir !== runDir) {
      appendRunLog(loopbackRunDir, `${finishedAt} loopback_failed delegateRunNodeId=${delegate.id} workerRunId=${runId} reason=${result.message || ''}`);
    }
    return {
      kind: 'loopback', status: 'failed', executor, executedBy: actorName, executionMode: 'loopback',
      delegateRunNodeId: delegate.id, runNodeId: loopbackNodeId,
      message: result.message || null, adapterStatus: result.status || null,
      stdout: result.stdout || '', stderr: result.stderr || '', loopbackIndex,
      budget,
    };
  }

  updateMarkdownFrontmatter(loopbackPath, (fm) => { fm.status = 'done'; return fm; });
  closeRunNodeWithEow({ runDir: loopbackRunDir, runId: loopbackRunId, runNodeId: loopbackNodeId, reason: 'loopback_recorded', finishedAt });

  const delegatePath = delegate.path;
  if (delegatePath && existsSync(delegatePath)) {
    updateMarkdownFrontmatter(delegatePath, (fm) => {
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
  closeRunNodeWithEow({ runDir: loopbackRunDir, runId: loopbackRunId, runNodeId: delegate.id, reason: 'loopback_resolved', finishedAt });

  logEvent(eventsPath, {
    timestamp: finishedAt, type: 'loopback_completed', runId,
    loopbackRunId,
    delegateRunNodeId: delegate.id, loopbackRunNodeId: loopbackNodeId,
    executor, executedBy: actorName, executionMode: 'loopback', loopbackIndex,
    artifactPath: result.artifactPath || null,
    message: result.message || null,
  });
  appendRunLog(runDir, `${finishedAt} loopback_completed delegateRunNodeId=${delegate.id} loopbackRunNodeId=${loopbackNodeId} executedBy=${actorName} artifact=${result.artifactPath || ''}`);
  if (loopbackRunDir !== runDir) {
    appendRunLog(loopbackRunDir, `${finishedAt} loopback_completed delegateRunNodeId=${delegate.id} loopbackRunNodeId=${loopbackNodeId} executedBy=${actorName} workerRunId=${runId} artifact=${result.artifactPath || ''}`);
  }

  return {
    kind: 'loopback', status: 'completed', executor, executedBy: actorName, executionMode: 'loopback',
    delegateRunNodeId: delegate.id, runNodeId: loopbackNodeId,
    artifactPath: result.artifactPath || null,
    message: result.message || null,
    loopbackIndex,
    budget,
  };
}

function ensureRunNode({ runDir, runId, runNodeId, type, title, sourceTaskId, sourceTaskGroupVersionId, status = 'active', kindLabel }) {
  return ensureRunNodeViaStateWriter({
    runDir, runId, runNodeId, type, title, sourceTaskId, sourceTaskGroupVersionId, status, kindLabel,
  }, stateWriterIo());
}

function runNodeIdForTask(runDir, task) {
  const baseId = `run-node-${task.id}`;
  const basePath = join(runDir, 'nodes', `${baseId}.md`);
  if (!existsSync(basePath)) return baseId;
  const existing = parseMarkdownFile(basePath);
  if (
    existing.sourceTaskId === task.id
    && existing.sourceTaskGroupVersionId === task.taskGroupVersionId
  ) {
    return baseId;
  }
  return `run-node-${safeSessionPart(task.taskGroupVersionId, 'version')}-${safeSessionPart(task.id, 'task')}`;
}

function attachRunRef(taskPath, runId, runNodeId, role) {
  return attachTaskRunRefViaStateWriter(taskPath, runId, runNodeId, role, stateWriterIo());
}

function closeRunNodeWithEow({ runDir, runId, runNodeId, reason, finishedAt, approvedReview = null }) {
  return closeRunNodeWithEowViaStateWriter({ runDir, runId, runNodeId, reason, finishedAt, approvedReview }, stateWriterIo());
}

function closeTaskWithEow({ task, reason, finishedAt, approvedReview = null }) {
  return closeTaskWithEowViaStateWriter({ task, reason, finishedAt, approvedReview }, stateWriterIo());
}

function partialIdTimestamp(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function safeIdPart(value) {
  return String(value || 'target').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'target';
}

function uniquePartialPath(dir, baseId) {
  let id = baseId;
  let path = join(dir, `${id}.md`);
  let counter = 2;
  while (existsSync(path)) {
    id = `${baseId}-${counter}`;
    path = join(dir, `${id}.md`);
    counter += 1;
  }
  return { id, path };
}

function normalizePartialOptions({ targetLabel, declaredAt, options = {} }) {
  return {
    completedSummary: sanitizeFmScalar(
      options.completedSummary,
      { maxLen: 1000, fallback: `Partial progress recorded for ${targetLabel} at ${declaredAt}.` },
    ),
    incompleteSummary: sanitizeFmScalar(
      options.incompleteSummary,
      { maxLen: 1000, fallback: `Remaining work for ${targetLabel} still requires follow-up.` },
    ),
    followUpNeeded: options.followUpNeeded !== false,
    budget: options.budget && typeof options.budget === 'object' && !Array.isArray(options.budget)
      ? options.budget
      : { enabled: false },
  };
}

function writeTaskPartialMarker({ task, declaredAt, options = {} }) {
  const versionDir = dirname(dirname(task.path));
  const partialDir = join(versionDir, 'partials');
  ensureDir(partialDir);
  const partialOptions = normalizePartialOptions({ targetLabel: `task ${task.id}`, declaredAt, options });
  const baseId = `partial-${safeIdPart(task.id)}-${partialIdTimestamp(declaredAt)}`;
  const { id: partialId, path: partialPath } = uniquePartialPath(partialDir, baseId);
  const partialFm = {
    taskOpsVersion: 'v1',
    entityType: 'partial',
    id: partialId,
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: task.id,
    taskGroupVersionId: task.taskGroupVersionId,
    reason: 'partial_complete',
    declaredBy: sanitizeFmScalar(options.declaredBy, { maxLen: 120, fallback: 'taskops-close' }),
    declaredAt,
    createdAt: declaredAt,
    status: 'active',
    completedSummary: partialOptions.completedSummary,
    incompleteSummary: partialOptions.incompleteSummary,
    followUpNeeded: partialOptions.followUpNeeded,
    supersededBy: 'null',
    budget: partialOptions.budget,
  };
  if (options.sourceRunId) partialFm.sourceRunId = sanitizeFmScalar(options.sourceRunId, { maxLen: 200, fallback: null });
  if (options.sourceRunNodeId) partialFm.sourceRunNodeId = sanitizeFmScalar(options.sourceRunNodeId, { maxLen: 200, fallback: null });
  writeTextFileAtomic(partialPath, fmBlock(partialFm) + `# Partial: ${task.id}\n`);
  return { partialId, partialPath, partial: partialFm };
}

function writeRunPartialMarker({ projectDir, runNode, declaredAt, options = {} }) {
  const runDir = join(projectDir, 'runs', runNode.runId);
  const partialDir = join(runDir, 'partials');
  ensureDir(partialDir);
  const targetLabel = `run node ${runNode.runId}/${runNode.id}`;
  const partialOptions = normalizePartialOptions({ targetLabel, declaredAt, options });
  const baseId = `partial-${safeIdPart(runNode.id)}-${partialIdTimestamp(declaredAt)}`;
  const { id: partialId, path: partialPath } = uniquePartialPath(partialDir, baseId);
  const partialFm = {
    taskOpsVersion: 'v1',
    entityType: 'partial',
    id: partialId,
    runId: runNode.runId,
    graphType: 'run',
    attachedToType: 'runNode',
    attachedToId: runNode.id,
    reason: 'partial_complete',
    declaredBy: 'taskops-close',
    declaredAt,
    createdAt: declaredAt,
    status: 'active',
    completedSummary: partialOptions.completedSummary,
    incompleteSummary: partialOptions.incompleteSummary,
    followUpNeeded: partialOptions.followUpNeeded,
    supersededBy: 'null',
    budget: partialOptions.budget,
  };
  writeTextFileAtomic(partialPath, fmBlock(partialFm) + `# Partial: ${runNode.id}\n`);
  return { partialId, partialPath, partial: partialFm };
}

function writeReviewForRunNode({ projectDir, task, runNode }) {
  const runDir = join(projectDir, 'runs', runNode.runId);
  const reviewNodeId = `review-${runNode.id}`;
  const reviewNodePath = ensureRunNode({
    runDir,
    runId: runNode.runId,
    runNodeId: reviewNodeId,
    type: 'review',
    title: `Review ${runNode.id}`,
    sourceTaskId: task?.id,
    sourceTaskGroupVersionId: task?.taskGroupVersionId,
    status: 'done',
    kindLabel: 'review',
  });
  const report = buildReviewReport({ projectDir, task, runNode });
  const reviewReportHash = sha256Of(report);
  updateMarkdownFrontmatter(reviewNodePath, (fm) => {
    fm.status = 'done';
    fm.reviewsRunNodeId = runNode.id;
    fm.reviewedRunId = runNode.runId;
    fm.reviewReport = report;
    fm.reviewReportHash = reviewReportHash;
    return fm;
  });

  const edgeId = `edge-${runNode.id}-to-${reviewNodeId}`;
  const edgePath = join(runDir, 'edges', `${edgeId}.md`);
  if (!existsSync(edgePath)) {
    const edgeFm = {
      taskOpsVersion: 'v1',
      entityType: 'runEdge',
      id: edgeId,
      runId: runNode.runId,
      fromRunNodeId: runNode.id,
      toRunNodeId: reviewNodeId,
      edgeType: 'reviews',
      createdAt: isoNow(),
      status: 'done',
    };
    writeTextFileAtomic(edgePath, fmBlock(edgeFm) + `# Run edge: ${runNode.id} reviewed by ${reviewNodeId}\n`);
  }
  closeRunNodeWithEow({ runDir, runId: runNode.runId, runNodeId: reviewNodeId, reason: 'review_recorded', finishedAt: isoNow() });

  return {
    reviewNodeId,
    reviewNodePath,
    reviewReport: report,
    reviewReportHash,
    approvedReview: report.decision === 'approved' && POLICY_APPROVING_ACCEPTANCE_MODES.has(report.mode) ? {
      reviewNodeId,
      reviewMode: report.mode,
      reviewReportHash,
      reviewedAcceptanceHash: report.reviewedAcceptanceHash,
      reviewedResultHash: report.reviewedResultHash,
    } : null,
  };
}

function closeExecutePartial({
  task,
  runDir,
  runId,
  eventsPath,
  executor,
  runNodeId,
  runNodePath,
  finishedAt,
  result,
  executionResult,
  partialRequest,
  budget,
  artifactWorkspacePath,
}) {
  const partial = writeTaskPartialMarker({
    task,
    declaredAt: finishedAt,
    options: {
      completedSummary: partialRequest.completedSummary,
      incompleteSummary: partialRequest.incompleteSummary,
      followUpNeeded: partialRequest.followUpNeeded !== false,
      budget: budget || { enabled: false },
      declaredBy: 'taskops-runner',
      sourceRunId: runId,
      sourceRunNodeId: runNodeId,
    },
  });
  const partialCompletion = {
    partialId: partial.partialId,
    partialPath: partial.partialPath,
    taskId: task.id,
    taskGroupVersionId: task.taskGroupVersionId,
    completedSummary: partial.partial.completedSummary,
    incompleteSummary: partial.partial.incompleteSummary,
    followUpNeeded: partial.partial.followUpNeeded,
    awaitingPromotion: true,
    sourceRunId: runId,
    sourceRunNodeId: runNodeId,
  };
  updateMarkdownFrontmatter(task.path, (fm) => {
    if (fm.status === 'active') fm.status = 'pending';
    fm.runReadiness = 'blocked';
    fm.runReadinessReason = sanitizeFmScalar(`Awaiting partial-driven follow-up promotion (partial: ${partial.partialId})`);
    fm.awaitingPromotion = true;
    fm.awaitingPromotionPartialId = partial.partialId;
    delete fm.lastRunFailureReason;
    return fm;
  });
  updateMarkdownFrontmatter(runNodePath, (fm) => {
    fm.status = 'done';
    fm.result = {
      ...executionResult,
      partialRequest: {
        partialRequested: true,
        completedSummary: partial.partial.completedSummary,
        incompleteSummary: partial.partial.incompleteSummary,
        followUpNeeded: partial.partial.followUpNeeded,
      },
      partialCompletion,
    };
    return fm;
  });
  logEvent(eventsPath, {
    timestamp: finishedAt, type: 'task_partial_requested', runId,
    taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
    partialId: partial.partialId,
  });
  appendRunLog(runDir, `${finishedAt} task_partial_requested taskId=${task.id} runNodeId=${runNodeId} partialId=${partial.partialId}`);
  return {
    taskId: task.id,
    runNodeId,
    kind: 'execute',
    status: 'partial',
    executor,
    message: result.message || null,
    budget,
    executionWorkspacePath: result.workspacePath || artifactWorkspacePath,
    partialCompletion,
  };
}

function closeExecuteFailure({
  task,
  runDir,
  eventsPath,
  runNodePath,
  taskUpdater,
  runNodeUpdater = null,
  event,
  logLine,
  actionResult,
}) {
  updateMarkdownFrontmatter(task.path, taskUpdater);
  if (runNodeUpdater) updateMarkdownFrontmatter(runNodePath, runNodeUpdater);
  logEvent(eventsPath, event);
  appendRunLog(runDir, logLine);
  return actionResult;
}

function closeExecuteSuccess({
  projectDir,
  task,
  runDir,
  runId,
  eventsPath,
  executor,
  runNodeId,
  runNodePath,
  finishedAt,
  result,
  executionResult,
  surpriseReport,
  budget,
  artifactWorkspacePath,
}) {
  const surpriseHistoryEntry = surpriseReport.surpriseReported
    ? appendSurpriseHistory({
        task,
        report: surpriseReport.report,
        runId,
        runNodeId,
        actionKind: 'execute',
        observedAt: finishedAt,
        evidenceRefs: [`run:${runId}/node:${runNodeId}`],
      })
    : null;
  updateMarkdownFrontmatter(task.path, (fm) => { fm.status = 'done'; return fm; });
  updateMarkdownFrontmatter(runNodePath, (fm) => {
    fm.status = 'done';
    fm.result = {
      ...executionResult,
      ...(surpriseReport.surpriseReported ? {
        surpriseReport: surpriseReport.report,
        surpriseHistoryEntry,
      } : {}),
    };
    return fm;
  });
  const reviewedRunNode = parseMarkdownFile(runNodePath);
  const review = writeReviewForRunNode({ projectDir, task, runNode: reviewedRunNode });
  const isGuarded = ['enforced', 'guarded', 'runner-managed'].includes(review.reviewReport.mode);
  if (review.reviewReport.decision !== 'approved' && isGuarded) {
    return closeExecuteFailure({
      task,
      runDir,
      eventsPath,
      runNodePath,
      taskUpdater: (fm) => {
        fm.status = 'blocked';
        fm.lastRunFailureReason = sanitizeFmScalar(`review ${review.reviewReport.decision}: ${review.reviewReport.missingExpected.concat(review.reviewReport.unsupportedObserved, review.reviewReport.failedChecks).join('; ')}`);
        return fm;
      },
      event: {
        timestamp: finishedAt, type: 'task_review_failed', runId,
        taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, reviewNodeId: review.reviewNodeId,
        decision: review.reviewReport.decision,
      },
      logLine: `${finishedAt} task_review_failed taskId=${task.id} runNodeId=${runNodeId} reviewNodeId=${review.reviewNodeId} decision=${review.reviewReport.decision}`,
      actionResult: {
        taskId: task.id,
        runNodeId,
        reviewNodeId: review.reviewNodeId,
        kind: 'execute',
        status: 'failed',
        executor,
        message: result.message || null,
        reviewDecision: review.reviewReport.decision,
        budget,
        executionWorkspacePath: result.workspacePath || artifactWorkspacePath,
      },
    });
  }
  const approvedReview = review.approvedReview;
  const closeReason = approvedReview ? 'approved_result' : 'execution_path_closed';
  closeTaskWithEow({ task, reason: closeReason, finishedAt, approvedReview });
  closeRunNodeWithEow({ runDir, runId, runNodeId, reason: closeReason, finishedAt, approvedReview });

  logEvent(eventsPath, {
    timestamp: finishedAt, type: 'task_completed', runId,
    taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
    reviewNodeId: review.reviewNodeId,
    reviewDecision: review.reviewReport.decision,
    message: result.message || null,
  });
  appendRunLog(runDir, `${finishedAt} task_completed taskId=${task.id} runNodeId=${runNodeId} reviewNodeId=${review.reviewNodeId} reviewDecision=${review.reviewReport.decision}`);
  return { taskId: task.id, runNodeId, reviewNodeId: review.reviewNodeId, kind: 'execute', status: 'completed', executor, message: result.message || null, reviewDecision: review.reviewReport.decision, budget, executionWorkspacePath: result.workspacePath || artifactWorkspacePath };
}

function executeRunnableTask({ project, task, runDir, runId, eventsPath, executor, agentId, stepTimeoutMs, budget = null }) {
  const projectDir = dirname(dirname(runDir));
  const inheritedContext = inheritedContextForTask(projectDir, task);
  const startedAt = isoNow();
  const runNodeId = runNodeIdForTask(runDir, task);
  const artifactWorkspacePath = join(runDir, 'artifacts', runNodeId, 'workspace');
  ensureDir(artifactWorkspacePath);
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
    result = invokeExecutor({ project, projectDir, task, executor, agentId, stepTimeoutMs, budget, inheritedContext, artifactWorkspacePath });
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err), executor, workspacePath: artifactWorkspacePath };
  }

  const finishedAt = isoNow();

  if (result.ok) {
    const executionResult = buildExecutionResult({ task, runId, runNodeId, executorResult: result });
    const partialRequest = parsePartialRequestFromExecutorResult(result);
    if (partialRequest.partialRequested) {
      return closeExecutePartial({
        task,
        runNodeId,
        runNodePath,
        runDir,
        runId,
        eventsPath,
        executor,
        finishedAt,
        result,
        executionResult,
        partialRequest,
        budget,
        artifactWorkspacePath,
      });
    }
    if (partialRequest.markerFound && partialRequest.parseError) {
      const reason = sanitizeFmScalar(`malformed TASKOPS_PARTIAL_REQUEST marker: ${partialRequest.parseError}`);
      return closeExecuteFailure({
        task,
        runDir,
        eventsPath,
        runNodePath,
        taskUpdater: (fm) => {
          fm.status = 'blocked';
          fm.runReadiness = 'blocked';
          fm.runReadinessReason = reason;
          fm.lastRunFailureReason = reason;
          fm.needsManualReview = true;
          fm.malformedPartialRequest = true;
          return fm;
        },
        runNodeUpdater: (fm) => {
          fm.status = 'blocked';
          fm.result = {
            ...executionResult,
            malformedPartialRequest: {
              markerFound: true,
              parseError: partialRequest.parseError,
              rawLine: partialRequest.rawLine || '',
              needsManualReview: true,
            },
          };
          return fm;
        },
        event: {
          timestamp: finishedAt, type: 'task_malformed_partial_request', runId,
          taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
          parseError: partialRequest.parseError,
        },
        logLine: `${finishedAt} task_malformed_partial_request taskId=${task.id} runNodeId=${runNodeId} reason=${reason}`,
        actionResult: {
          taskId: task.id,
          runNodeId,
          kind: 'execute',
          status: 'failed',
          failureKind: 'malformed_partial_request',
          executor,
          message: reason,
          budget,
          executionWorkspacePath: result.workspacePath || artifactWorkspacePath,
          malformedPartialRequest: {
            markerFound: true,
            parseError: partialRequest.parseError,
            rawLine: partialRequest.rawLine || '',
          },
        },
      });
    }
    const surpriseReport = parseSurpriseReportFromExecutorResult(result);
    if (surpriseReport.markerFound && surpriseReport.parseError) {
      const reason = malformedSurpriseReason(surpriseReport);
      return closeExecuteFailure({
        task,
        runDir,
        eventsPath,
        runNodePath,
        taskUpdater: (fm) => {
          fm.status = 'blocked';
          fm.runReadiness = 'blocked';
          fm.runReadinessReason = reason;
          fm.lastRunFailureReason = reason;
          fm.needsManualReview = true;
          fm.malformedSurpriseReport = true;
          return fm;
        },
        runNodeUpdater: (fm) => {
          fm.status = 'blocked';
          fm.result = {
            ...executionResult,
            malformedSurpriseReport: {
              markerFound: true,
              parseError: surpriseReport.parseError,
              rawLine: surpriseReport.rawLine || '',
              needsManualReview: true,
            },
          };
          return fm;
        },
        event: {
          timestamp: finishedAt, type: 'task_malformed_surprise_report', runId,
          taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
          parseError: surpriseReport.parseError,
        },
        logLine: `${finishedAt} task_malformed_surprise_report taskId=${task.id} runNodeId=${runNodeId} reason=${reason}`,
        actionResult: {
          taskId: task.id,
          runNodeId,
          kind: 'execute',
          status: 'failed',
          failureKind: 'malformed_surprise_report',
          executor,
          message: reason,
          budget,
          executionWorkspacePath: result.workspacePath || artifactWorkspacePath,
          malformedSurpriseReport: {
            markerFound: true,
            parseError: surpriseReport.parseError,
            rawLine: surpriseReport.rawLine || '',
          },
        },
      });
    }
    return closeExecuteSuccess({
      projectDir,
      task,
      runDir,
      runId,
      eventsPath,
      executor,
      runNodeId,
      runNodePath,
      finishedAt,
      result,
      executionResult,
      surpriseReport,
      budget,
      artifactWorkspacePath,
    });
  }

  return closeExecuteFailure({
    task,
    runDir,
    eventsPath,
    runNodePath,
    taskUpdater: (fm) => {
      fm.status = 'blocked';
      fm.lastRunFailureReason = sanitizeFmScalar(result.message);
      return fm;
    },
    runNodeUpdater: (fm) => { fm.status = 'blocked'; return fm; },
    event: {
      timestamp: finishedAt, type: 'task_failed', runId,
      taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
      message: result.message || null,
    },
    logLine: `${finishedAt} task_failed taskId=${task.id} reason=${result.message || ''}`,
    actionResult: {
      taskId: task.id, runNodeId, kind: 'execute', status: 'failed', executor,
      message: result.message || null, adapterStatus: result.status || null,
      stdout: result.stdout || '', stderr: result.stderr || '',
      budget,
      executionWorkspacePath: result.workspacePath || artifactWorkspacePath,
    },
  });
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
  updateMarkdownFrontmatter(snapshot.path, (fm) => {
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

function ensureDecompositionBacklink({ projectDir, childTaskGroupId, versionId, task, runId, runNodeId }) {
  const desired = {
    decomposedFromTaskId: task.id,
    decomposedFromTaskGroupId: task.taskGroupId,
    decomposedFromTaskGroupVersionId: task.taskGroupVersionId,
    decomposedByRunId: runId,
    decomposedByRunNodeId: runNodeId,
  };
  const paths = [
    join(projectDir, 'task-groups', childTaskGroupId, 'index.md'),
    join(projectDir, 'task-groups', childTaskGroupId, 'versions', versionId, 'index.md'),
  ];

  for (const filePath of paths) {
    if (!existsSync(filePath)) return { ok: false, message: `Missing decomposition target index at ${filePath}` };
    const current = parseMarkdownFile(filePath);
    for (const [key, value] of Object.entries(desired)) {
      if (current[key] != null && current[key] !== '' && String(current[key]) !== String(value)) {
        return {
          ok: false,
          message: `Conflicting decomposition backlink in ${filePath}: ${key}=${current[key]} expected ${value}`,
        };
      }
    }
  }

  for (const filePath of paths) {
    updateMarkdownFrontmatter(filePath, (fm) => {
      for (const [key, value] of Object.entries(desired)) fm[key] = value;
      return fm;
    });
  }

  return { ok: true };
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
  writeTextFileAtomic(join(tgDir, 'index.md'), fmBlock(tgFm) + `# Task group ${childTaskGroupId}\n\nSynthetic placeholder created by the TaskOps dry-run runner. Real human input is required before the child tasks become runnable.\n`);

  const versionFm = {
    taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: versionId,
    taskGroupId: childTaskGroupId, version: 'v1',
    summary: `Synthetic dry-run decomposition of ${task.title}`,
    createdAt: now, status: 'active',
  };
  writeTextFileAtomic(join(tgDir, 'versions', versionId, 'index.md'), fmBlock(versionFm) + `# Version ${versionId}\n\nSynthetic placeholder children. Replace with concrete tasks once real inputs are supplied.\n`);
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
    needsManualReview: true,
    manualReviewReason: 'Synthetic dry-run placeholder requires human-supplied real inputs.',
    understandingLevel: 'unknown',
  };
  writeTextFileAtomic(
    join(tgDir, 'versions', versionId, 'tasks', `${childTaskId}.md`),
    fmBlock(childFm) + `# ${childFm.title}\n\nSynthetic placeholder created by the TaskOps dry-run runner. This is not real progress; it is structural scaffolding so the parent task can be marked decomposed without losing trace to the open question.\n`,
  );
  return { ok: true, childTaskGroupId, versionId, message: `Synthesized dry-run child task group ${childTaskGroupId}/${versionId}` };
}

function activeBlockerCatalogForPrompt(projectDir, sourceTask) {
  let parsed;
  try {
    parsed = parseProject(projectDir);
  } catch {
    return [];
  }
  const activeSnapshot = parsed.project.activeSnapshotId ? parsed.snapshots.get(parsed.project.activeSnapshotId) : null;
  const selectedVersions = Array.isArray(activeSnapshot?.selectedVersions) ? activeSnapshot.selectedVersions : [];
  const selectedTaskGroupIds = new Set(selectedVersions.map((pair) => pair?.taskGroupId).filter(Boolean));
  const items = [];
  for (const pair of selectedVersions) {
    if (!pair?.versionId) continue;
    const version = parsed.versions.get(pair.versionId);
    if (!version) continue;
    for (const candidate of version.tasks) {
      if (candidate.id === sourceTask.id && candidate.taskGroupVersionId === sourceTask.taskGroupVersionId) continue;
      const classification = applyBlockerGate(parsed, candidate, classifyTaskReadiness(candidate));
      items.push({
        id: candidate.id,
        taskGroupVersionId: candidate.taskGroupVersionId,
        status: candidate.status || null,
        runReadiness: classification.runReadiness || candidate.runReadiness || null,
        terminal: !(candidate.childTaskGroupId && selectedTaskGroupIds.has(candidate.childTaskGroupId)),
        decomposed: Boolean(candidate.childTaskGroupId && selectedTaskGroupIds.has(candidate.childTaskGroupId)),
      });
    }
  }
  return items.slice(0, 30);
}

function performAgentDecomposition({ projectDir, project, task, executor, agentId, stepTimeoutMs, budget = null, inheritedContext = null }) {
  const { childTaskGroupId, versionId } = deriveDecompositionIds(task);
  const versionIndex = join(projectDir, 'task-groups', childTaskGroupId, 'versions', versionId, 'index.md');
  if (existsSync(versionIndex)) {
    return { ok: true, childTaskGroupId, versionId, message: `Decomposition already present at ${versionIndex}; reusing.` };
  }
  const prompt = buildAgentDecompositionPrompt({
    project,
    projectDir,
    task,
    childTaskGroupId,
    versionId,
    budget,
    inheritedContext,
    blockerCatalog: activeBlockerCatalogForPrompt(projectDir, task),
  });
  const adapter = executor === 'openclaw-agent' ? 'openclaw-cli' : executor;
  const result = invokeRuntimeAdapter(adapter, {
    prompt,
    agentId,
    sessionKey: openClawWorkerSessionKey({ agentId, projectId: project.id, taskId: task.id, action: 'decompose' }),
    timeoutMs: stepTimeoutMs,
    cwd: projectDir,
  });
  if (!result.ok) return { ...result, ok: false, message: result.message };
  if (!existsSync(versionIndex)) {
    return { ok: false, message: `${adapter} did not author expected child task group at ${versionIndex}; refusing to mark decomposition done` };
  }
  return { ok: true, childTaskGroupId, versionId, message: result.stdout || `Agent created ${childTaskGroupId}/${versionId}` };
}

function isRecoverableDecompositionAdapterFailure(result) {
  if (!result || result.ok) return false;
  if (result.timedOut === true || result.status === 'timeout') return true;
  return /\btimed out after \d+ms\.?$/i.test(String(result.message || '').trim());
}

function listChildTaskPaths(versionDir) {
  const tasksDir = join(versionDir, 'tasks');
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md')
    .map((entry) => join(tasksDir, entry.name))
    .sort();
}

function normalizeNonNegativeInteger(value) {
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

function normalizeExpectedPlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'expectedPlan must be an object' };
  }
  const expectedDepth = normalizeNonNegativeInteger(value.expectedDepth);
  if (expectedDepth == null) return { ok: false, reason: 'expectedPlan.expectedDepth must be a non-negative integer' };
  const expectedBreadth = normalizeNonNegativeInteger(value.expectedBreadth);
  if (expectedBreadth == null) return { ok: false, reason: 'expectedPlan.expectedBreadth must be a non-negative integer' };
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
  if (!rationale) return { ok: false, reason: 'expectedPlan.rationale must be a non-empty string' };
  const normalized = { expectedDepth, expectedBreadth, rationale };
  if (typeof value.declaredAt === 'string' && value.declaredAt.trim()) normalized.declaredAt = value.declaredAt.trim();
  return { ok: true, value: normalized };
}

function progressRatio(consumedDepth, expectedDepth) {
  if (expectedDepth === 0) return 1;
  return Math.max(0, Math.min(1, consumedDepth / expectedDepth));
}

export function computeExpectedPlanCoordinate({ parsed, task, activeSnapshot = null } = {}) {
  const normalized = normalizeExpectedPlan(task?.expectedPlan);
  if (!normalized.ok) return null;
  const chain = ancestorChainForTask(parsed, task, activeSnapshot);
  const consumedDepth = Array.isArray(chain) ? chain.length : 0;
  const expectedDepth = normalized.value.expectedDepth;
  const expectedBreadth = normalized.value.expectedBreadth;
  const planProgress = progressRatio(consumedDepth, expectedDepth);
  const lineagePlans = [task, ...(chain || []).map((entry) => entry.task)]
    .map((candidate) => normalizeExpectedPlan(candidate?.expectedPlan))
    .filter((plan) => plan.ok)
    .map((plan) => plan.value);
  const cumulativeExpectedDepth = lineagePlans.reduce((sum, plan) => sum + plan.expectedDepth, 0);
  return {
    enabled: true,
    source: 'expectedPlan',
    taskId: task.id,
    consumedDepth,
    consumedDepthSinceDeclaration: consumedDepth,
    expectedDepth,
    expectedBreadth,
    planProgress,
    phase: expectedPlanPhaseForProgress(planProgress),
    phaseThresholds: { ...EXPECTED_PLAN_PHASE_THRESHOLDS },
    rationale: normalized.value.rationale,
    lineageDiagnostic: {
      consumedDepth,
      cumulativeExpectedDepth,
      cumulativePlanProgress: progressRatio(consumedDepth, cumulativeExpectedDepth),
      planCount: lineagePlans.length,
    },
  };
}

function budgetWithExpectedPlanCoordinate(budget, { parsed, task, activeSnapshot = null } = {}) {
  if (!budget || budget.enabled !== true || !task) return budget;
  const coordinate = computeExpectedPlanCoordinate({ parsed, task, activeSnapshot });
  if (!coordinate) return budget;
  return { ...budget, expectedPlanCoordinate: coordinate };
}

function fallbackExpectedPlanForChild(parentTask, reason) {
  const parent = normalizeExpectedPlan(parentTask?.expectedPlan);
  const expectedDepth = parent.ok ? Math.max(0, parent.value.expectedDepth - 1) : 0;
  const expectedBreadth = parent.ok ? parent.value.expectedBreadth : 1;
  return {
    expectedDepth,
    expectedBreadth,
    rationale: `Runner fallback: ${reason}; derived conservatively from ${parent.ok ? `parent task ${parentTask.id} expectedPlan` : `missing parent expectedPlan on ${parentTask?.id || 'source task'}`}.`,
  };
}

function normalizeExpectedPlansForChildVersion({ projectDir, childTaskGroupId, versionId, parentTask }) {
  const versionDir = join(projectDir, 'task-groups', childTaskGroupId, 'versions', versionId);
  const taskPaths = listChildTaskPaths(versionDir);
  const summary = {
    taskCount: taskPaths.length,
    validCount: 0,
    fallbackCount: 0,
    fallbacks: [],
  };
  for (const taskPath of taskPaths) {
    const childTask = parseMarkdownFile(taskPath);
    const normalized = normalizeExpectedPlan(childTask.expectedPlan);
    if (normalized.ok) {
      summary.validCount += 1;
      continue;
    }
    const fallback = fallbackExpectedPlanForChild(parentTask, normalized.reason);
    updateMarkdownFrontmatter(taskPath, (fm) => {
      fm.expectedPlan = fallback;
      return fm;
    });
    summary.fallbackCount += 1;
    summary.fallbacks.push({
      taskId: childTask.id || null,
      reason: normalized.reason,
      expectedDepth: fallback.expectedDepth,
      expectedBreadth: fallback.expectedBreadth,
    });
  }
  return summary;
}

function unresolvedBlockedByMarker({ rawRef, reason, versionId, index }) {
  const raw = String(rawRef ?? '').trim();
  const id = raw || `empty-blockedby-ref-${index + 1}`;
  return {
    type: 'unresolved',
    id,
    rawRef: raw,
    taskGroupVersionId: versionId,
    reason: sanitizeFmScalar(reason),
  };
}

function normalizeChildBlockedByRef(ref, { taskIds, allTaskKeys, allTasksById, runNodeKeys, versionId, index }) {
  if (typeof ref === 'string') {
    const id = ref.trim();
    if (id && taskIds.has(id)) {
      return {
        ref: { type: 'task', id, taskGroupVersionId: versionId },
        changed: true,
        normalized: true,
        originalRef: ref,
        reason: 'string_task_ref',
      };
    }
    const reason = id
      ? `blockedBy string ref '${id}' does not match any task id in child version ${versionId}`
      : `blockedBy string ref at index ${index + 1} is empty`;
    return {
      ref: unresolvedBlockedByMarker({ rawRef: ref, reason, versionId, index }),
      changed: true,
      unresolved: true,
      originalRef: ref,
      reason,
    };
  }

  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
    const reason = `blockedBy ref at index ${index + 1} must be an object or task id string`;
    return {
      ref: unresolvedBlockedByMarker({ rawRef: JSON.stringify(ref ?? null), reason, versionId, index }),
      changed: true,
      unresolved: true,
      originalRef: ref,
      reason,
    };
  }

  if (ref.type === 'task') {
    const id = compactString(ref.id || ref.taskId);
    if (!id) {
      const reason = `blockedBy task ref at index ${index + 1} is missing id`;
      return {
        ref: unresolvedBlockedByMarker({ rawRef: JSON.stringify(ref), reason, versionId, index }),
        changed: true,
        unresolved: true,
        originalRef: ref,
        reason,
      };
    }
    const targetVersionId = compactString(ref.taskGroupVersionId);
    if ((!targetVersionId || targetVersionId === versionId) && taskIds.has(id)) {
      const canonical = { type: 'task', id, taskGroupVersionId: versionId };
      if (
        ref.id === canonical.id
        && ref.taskGroupVersionId === canonical.taskGroupVersionId
        && ref.type === canonical.type
        && ref.taskId == null
      ) {
        return { ref, changed: false };
      }
      return {
        ref: canonical,
        changed: true,
        normalized: true,
        originalRef: ref,
        reason: ref.taskGroupVersionId ? 'canonical_task_ref' : 'defaulted_child_task_group_version',
      };
    }
    if (targetVersionId && allTaskKeys.has(`${targetVersionId}:${id}`)) {
      const canonical = { type: 'task', id, taskGroupVersionId: targetVersionId };
      if (ref.id === canonical.id && ref.taskGroupVersionId === canonical.taskGroupVersionId && ref.type === canonical.type && ref.taskId == null) {
        return { ref, changed: false };
      }
      return {
        ref: canonical,
        changed: true,
        normalized: true,
        originalRef: ref,
        reason: 'canonical_cross_branch_task_ref',
      };
    }
    if (!targetVersionId) {
      const matches = allTasksById.get(id) || [];
      if (matches.length === 1) {
        const canonical = { type: 'task', id, taskGroupVersionId: matches[0].taskGroupVersionId };
        return {
          ref: canonical,
          changed: true,
          normalized: true,
          originalRef: ref,
          reason: 'defaulted_unique_task_group_version',
        };
      }
    }
    const reason = targetVersionId
      ? `blockedBy task ref '${targetVersionId}:${id}' does not match any task`
      : `blockedBy task ref '${id}' is ambiguous or not found; include taskGroupVersionId`;
    return {
      ref: unresolvedBlockedByMarker({ rawRef: JSON.stringify(ref), reason, versionId, index }),
      changed: true,
      unresolved: true,
      originalRef: ref,
      reason,
    };
  }

  if (ref.type === 'runNode') {
    const runId = compactString(ref.runId);
    const runNodeId = compactString(ref.runNodeId || ref.id);
    if (runId && runNodeId && runNodeKeys.has(`${runId}:${runNodeId}`)) {
      const canonical = { type: 'runNode', runId, runNodeId };
      if (ref.type === canonical.type && ref.runId === canonical.runId && ref.runNodeId === canonical.runNodeId && ref.id == null) {
        return { ref, changed: false };
      }
      return {
        ref: canonical,
        changed: true,
        normalized: true,
        originalRef: ref,
        reason: 'canonical_run_node_ref',
      };
    }
    const reason = `blockedBy runNode ref at index ${index + 1} does not match any run node`;
    return {
      ref: unresolvedBlockedByMarker({ rawRef: JSON.stringify(ref), reason, versionId, index }),
      changed: true,
      unresolved: true,
      originalRef: ref,
      reason,
    };
  }

  return { ref, changed: false };
}

function normalizeBlockedByForChildVersion({ projectDir, childTaskGroupId, versionId }) {
  const versionDir = join(projectDir, 'task-groups', childTaskGroupId, 'versions', versionId);
  const taskPaths = listChildTaskPaths(versionDir);
  const childTasks = taskPaths.map((taskPath) => ({ taskPath, task: parseMarkdownFile(taskPath) }));
  const taskIds = new Set(childTasks.map(({ task }) => task.id).filter(Boolean));
  const parsed = parseProject(projectDir);
  const allTaskKeys = new Set([...parsed.tasks.values()].map((task) => `${task.taskGroupVersionId}:${task.id}`));
  const allTasksById = new Map();
  for (const task of parsed.tasks.values()) {
    if (!allTasksById.has(task.id)) allTasksById.set(task.id, []);
    allTasksById.get(task.id).push(task);
  }
  const runNodeKeys = new Set(parsed.runNodes.keys());
  const summary = {
    taskCount: childTasks.length,
    checkedTaskCount: 0,
    normalizedRefCount: 0,
    unresolvedCount: 0,
    normalizedRefs: [],
    unresolvedRefs: [],
  };

  for (const { taskPath, task: childTask } of childTasks) {
    if (childTask.blockedBy == null) continue;
    summary.checkedTaskCount += 1;
    const originalRefs = Array.isArray(childTask.blockedBy) ? childTask.blockedBy : [childTask.blockedBy];
    let changed = false;
    const nextRefs = originalRefs.map((ref, index) => {
      const normalized = normalizeChildBlockedByRef(ref, { taskIds, allTaskKeys, allTasksById, runNodeKeys, versionId, index });
      if (!normalized.changed) return normalized.ref;
      changed = true;
      if (normalized.normalized) {
        summary.normalizedRefCount += 1;
        summary.normalizedRefs.push({
          taskId: childTask.id || null,
          index,
          originalRef: normalized.originalRef,
          normalizedRef: normalized.ref,
          reason: normalized.reason,
        });
      }
      if (normalized.unresolved) {
        summary.unresolvedCount += 1;
        summary.unresolvedRefs.push({
          taskId: childTask.id || null,
          index,
          originalRef: normalized.originalRef,
          unresolvedRef: normalized.ref,
          reason: normalized.reason,
        });
      }
      return normalized.ref;
    });
    if (!changed) continue;
    updateMarkdownFrontmatter(taskPath, (fm) => {
      fm.blockedBy = nextRefs;
      return fm;
    });
  }

  return summary;
}

function committingScopeDeferralReason({ executor, finishedAt }) {
  return sanitizeFmScalar(`Committing scope deferred by taskops-runner (${executor}) at ${finishedAt}: worker authored runReadiness=needs_decomposition during committing phase; review or restart explicitly before expanding this child scope.`);
}

function expectedPlanCoordinateSnapshot(budget) {
  const coordinate = budget?.expectedPlanCoordinate?.enabled === true ? budget.expectedPlanCoordinate : null;
  if (!coordinate) return null;
  return {
    phase: coordinate.phase || null,
    planProgress: coordinate.planProgress,
    consumedDepth: coordinate.consumedDepth,
    consumedDepthSinceDeclaration: coordinate.consumedDepthSinceDeclaration,
    expectedDepth: coordinate.expectedDepth,
    expectedBreadth: coordinate.expectedBreadth,
    remainingSteps: budget.remaining,
    maxSteps: budget.maxSteps,
  };
}

function deferCommittingScopeChildrenForChildVersion({ projectDir, childTaskGroupId, versionId, budget, executor, finishedAt }) {
  const coordinate = budget?.expectedPlanCoordinate?.enabled === true ? budget.expectedPlanCoordinate : null;
  const summary = {
    enabled: false,
    deferredCount: 0,
    guardMode: 'soft_post_authoring',
    reason: 'committing_phase_needs_decomposition_child',
    coordinate: expectedPlanCoordinateSnapshot(budget),
    deferredChildren: [],
  };
  if (!coordinate || coordinate.phase !== 'committing') return summary;

  summary.enabled = true;
  const versionDir = join(projectDir, 'task-groups', childTaskGroupId, 'versions', versionId);
  for (const taskPath of listChildTaskPaths(versionDir)) {
    const childTask = parseMarkdownFile(taskPath);
    if (childTask.runReadiness !== 'needs_decomposition') continue;

    const reason = committingScopeDeferralReason({ executor, finishedAt });
    summary.deferredChildren.push({
      taskId: childTask.id || null,
      originalStatus: childTask.status || null,
      originalRunReadiness: childTask.runReadiness || null,
      originalRunReadinessReason: childTask.runReadinessReason || null,
      newStatus: 'blocked',
      newRunReadiness: 'blocked',
      reason,
      expectedPlan: childTask.expectedPlan || null,
    });
    updateMarkdownFrontmatter(taskPath, (fm) => {
      fm.status = 'blocked';
      fm.runReadiness = 'blocked';
      fm.runReadinessReason = reason;
      fm.needsManualReview = true;
      fm.manualReviewReason = reason;
      return fm;
    });
  }
  summary.deferredCount = summary.deferredChildren.length;
  return summary;
}

function hasManualReviewOrPartialMarker(value) {
  if (!value || typeof value !== 'object') return false;
  return value.needsManualReview === true
    || value.manualReviewReason != null
    || value.awaitingPromotion === true
    || value.awaitingPromotionPartialId != null
    || value.followUpFromPartialId != null
    || value.followUpForTaskId != null
    || value.partialRepeatThreshold != null
    || value.repeatedPartialNeedsReview === true;
}

function canApplyDecompositionBacklink({ projectDir, childTaskGroupId, versionId, task, runId, runNodeId }) {
  const desired = {
    decomposedFromTaskId: task.id,
    decomposedFromTaskGroupId: task.taskGroupId,
    decomposedFromTaskGroupVersionId: task.taskGroupVersionId,
    decomposedByRunId: runId,
    decomposedByRunNodeId: runNodeId,
  };
  const paths = [
    join(projectDir, 'task-groups', childTaskGroupId, 'index.md'),
    join(projectDir, 'task-groups', childTaskGroupId, 'versions', versionId, 'index.md'),
  ];
  for (const filePath of paths) {
    if (!existsSync(filePath)) return { ok: false, reason: `missing decomposition target index at ${filePath}` };
    const current = parseMarkdownFile(filePath);
    for (const [key, value] of Object.entries(desired)) {
      if (current[key] != null && current[key] !== '' && String(current[key]) !== String(value)) {
        return { ok: false, reason: `conflicting decomposition backlink in ${filePath}: ${key}=${current[key]} expected ${value}` };
      }
    }
  }
  return { ok: true };
}

function probeCompletedDecompositionAfterAdapterFailure({ projectDir, project, task, runId, runNodeId }) {
  const { childTaskGroupId, versionId } = deriveDecompositionIds(task);
  const childGroupIndex = join(projectDir, 'task-groups', childTaskGroupId, 'index.md');
  const versionDir = join(projectDir, 'task-groups', childTaskGroupId, 'versions', versionId);
  const versionIndex = join(versionDir, 'index.md');
  if (!existsSync(childGroupIndex)) return { ok: false, reason: `missing child task group index at ${childGroupIndex}` };
  if (!existsSync(versionIndex)) return { ok: false, reason: `missing child task group version index at ${versionIndex}` };

  let childGroup;
  let version;
  try {
    childGroup = parseMarkdownFile(childGroupIndex);
    version = parseMarkdownFile(versionIndex);
  } catch (err) {
    return { ok: false, reason: `failed to parse child decomposition indexes: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (childGroup.entityType !== 'taskGroup') return { ok: false, reason: `child group entityType is '${childGroup.entityType}', expected taskGroup` };
  if (childGroup.id !== childTaskGroupId) return { ok: false, reason: `child group id '${childGroup.id}' did not match expected '${childTaskGroupId}'` };
  if (version.entityType !== 'taskGroupVersion') return { ok: false, reason: `child version entityType is '${version.entityType}', expected taskGroupVersion` };
  if (version.id !== versionId) return { ok: false, reason: `child version id '${version.id}' did not match expected '${versionId}'` };
  if (version.taskGroupId !== childTaskGroupId) return { ok: false, reason: `child version taskGroupId '${version.taskGroupId}' did not match expected '${childTaskGroupId}'` };
  if (hasManualReviewOrPartialMarker(childGroup) || hasManualReviewOrPartialMarker(version)) {
    return { ok: false, reason: 'child decomposition index carries manual-review or partial markers' };
  }

  const taskPaths = listChildTaskPaths(versionDir);
  if (taskPaths.length === 0) return { ok: false, reason: `child version '${versionId}' has no child task files` };
  const taskIds = [];
  for (const taskPath of taskPaths) {
    let childTask;
    try {
      childTask = parseMarkdownFile(taskPath);
    } catch (err) {
      return { ok: false, reason: `failed to parse child task ${taskPath}: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (childTask.entityType !== 'task') return { ok: false, reason: `child task ${taskPath} entityType is '${childTask.entityType}', expected task` };
    if (!childTask.id || !taskPath.endsWith(`${childTask.id}.md`)) return { ok: false, reason: `child task ${taskPath} id does not match file name` };
    if (childTask.taskGroupId !== childTaskGroupId) return { ok: false, reason: `child task '${childTask.id}' taskGroupId '${childTask.taskGroupId}' did not match expected '${childTaskGroupId}'` };
    if (childTask.taskGroupVersionId !== versionId) return { ok: false, reason: `child task '${childTask.id}' taskGroupVersionId '${childTask.taskGroupVersionId}' did not match expected '${versionId}'` };
    if (hasManualReviewOrPartialMarker(childTask)) return { ok: false, reason: `child task '${childTask.id}' carries manual-review or partial markers` };
    taskIds.push(childTask.id);
  }

  const parsed = parseProject(projectDir);
  const activeSnapshot = parsed.snapshots.get(project.activeSnapshotId);
  const selectedVersions = Array.isArray(activeSnapshot?.selectedVersions) ? activeSnapshot.selectedVersions : [];
  const selectedForChild = selectedVersions.filter((pair) => pair && pair.taskGroupId === childTaskGroupId);
  if (selectedForChild.length > 1) return { ok: false, reason: `active snapshot has multiple selections for child task group '${childTaskGroupId}'` };
  if (selectedForChild.length === 1 && selectedForChild[0].versionId !== versionId) {
    return { ok: false, reason: `active snapshot selects '${selectedForChild[0].versionId}' for '${childTaskGroupId}', expected '${versionId}'` };
  }
  if (task.childTaskGroupId && task.childTaskGroupId !== childTaskGroupId) {
    return { ok: false, reason: `source task already points at childTaskGroupId '${task.childTaskGroupId}', expected '${childTaskGroupId}'` };
  }

  const backlink = canApplyDecompositionBacklink({ projectDir, childTaskGroupId, versionId, task, runId, runNodeId });
  if (!backlink.ok) return backlink;

  return {
    ok: true,
    childTaskGroupId,
    versionId,
    childTaskCount: taskIds.length,
    snapshotAlreadySelected: selectedForChild.length === 1,
  };
}

function maybeRecoverCompletedDecomposition({ projectDir, project, task, runId, runNodeId, result }) {
  if (!isRecoverableDecompositionAdapterFailure(result)) return result;
  const probe = probeCompletedDecompositionAfterAdapterFailure({ projectDir, project, task, runId, runNodeId });
  if (!probe.ok) {
    return {
      ...result,
      message: `${result.message || 'adapter failed'}; timeout recovery rejected: ${probe.reason}`,
      recoveryRejected: true,
      recoveryRejectedReason: probe.reason,
    };
  }
  const adapterFailureReason = result.message || 'adapter timed out';
  return {
    ...result,
    ok: true,
    childTaskGroupId: probe.childTaskGroupId,
    versionId: probe.versionId,
    message: `Recovered completed decomposition after adapter failure: ${adapterFailureReason}`,
    recoveredAfterAdapterFailure: true,
    adapterFailureReason,
    adapterFailureStatus: result.status || null,
    recoveryStatus: 'recovered_after_timeout',
    recovery: {
      childTaskCount: probe.childTaskCount,
      snapshotAlreadySelected: probe.snapshotAlreadySelected,
    },
  };
}

function executeDecompositionTask({ projectDir, project, task, runDir, runId, eventsPath, executor, agentId, stepTimeoutMs, budget = null }) {
  const inheritedContext = inheritedContextForTask(projectDir, task);
  const startedAt = isoNow();
  const runNodeId = runNodeIdForTask(runDir, task);
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
      : performAgentDecomposition({ projectDir, project, task, executor, agentId, stepTimeoutMs, budget, inheritedContext });
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const finishedAt = isoNow();
  if (!result.ok) {
    result = maybeRecoverCompletedDecomposition({ projectDir, project, task, runId, runNodeId, result });
    if (result.recoveredAfterAdapterFailure === true) {
      logEvent(eventsPath, {
        timestamp: finishedAt, type: 'decomposition_recovered_after_adapter_failure', runId,
        taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
        childTaskGroupId: result.childTaskGroupId, versionId: result.versionId,
        adapterFailureReason: result.adapterFailureReason || null,
        adapterStatus: result.adapterFailureStatus || result.status || null,
        recoveryStatus: result.recoveryStatus || null,
        recovery: result.recovery || null,
      });
      appendRunLog(runDir, `${finishedAt} decomposition_recovered_after_adapter_failure taskId=${task.id} childTaskGroupId=${result.childTaskGroupId} versionId=${result.versionId} reason=${result.adapterFailureReason || ''}`);
    }
  }
  if (!result.ok) {
    updateMarkdownFrontmatter(task.path, (fm) => {
      fm.status = 'blocked';
      fm.lastRunFailureReason = sanitizeFmScalar(result.message);
      return fm;
    });
    updateMarkdownFrontmatter(runNodePath, (fm) => { fm.status = 'blocked'; return fm; });
    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'decomposition_failed', runId,
      taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
      message: result.message || null,
    });
    appendRunLog(runDir, `${finishedAt} decomposition_failed taskId=${task.id} reason=${result.message || ''}`);
    return {
    taskId: task.id, runNodeId, kind: 'decompose', status: 'failed', executor,
    message: result.message || null, adapterStatus: result.status || null,
    stdout: result.stdout || '', stderr: result.stderr || '',
    budget,
    };
  }

  const backlinkResult = ensureDecompositionBacklink({
    projectDir,
    childTaskGroupId: result.childTaskGroupId,
    versionId: result.versionId,
    task,
    runId,
    runNodeId,
  });
  if (!backlinkResult.ok) {
    updateMarkdownFrontmatter(task.path, (fm) => {
      fm.status = 'blocked';
      fm.lastRunFailureReason = sanitizeFmScalar(backlinkResult.message);
      return fm;
    });
    updateMarkdownFrontmatter(runNodePath, (fm) => { fm.status = 'blocked'; return fm; });
    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'decomposition_failed', runId,
      taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
      message: backlinkResult.message || null,
    });
    appendRunLog(runDir, `${finishedAt} decomposition_failed taskId=${task.id} reason=${backlinkResult.message || ''}`);
    return {
      taskId: task.id, runNodeId, kind: 'decompose', status: 'failed', executor,
      message: backlinkResult.message || null,
      budget,
    };
  }

  const expectedPlanNormalization = normalizeExpectedPlansForChildVersion({
    projectDir,
    childTaskGroupId: result.childTaskGroupId,
    versionId: result.versionId,
    parentTask: task,
  });
  if (expectedPlanNormalization.fallbackCount > 0) {
    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'expected_plan_fallback_applied', runId,
      taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
      childTaskGroupId: result.childTaskGroupId, versionId: result.versionId,
      expectedPlanFallbacks: expectedPlanNormalization.fallbacks,
    });
    appendRunLog(runDir, `${finishedAt} expected_plan_fallback_applied taskId=${task.id} childTaskGroupId=${result.childTaskGroupId} versionId=${result.versionId} count=${expectedPlanNormalization.fallbackCount}`);
  }

  const blockedByNormalization = normalizeBlockedByForChildVersion({
    projectDir,
    childTaskGroupId: result.childTaskGroupId,
    versionId: result.versionId,
  });
  if (blockedByNormalization.unresolvedCount > 0) {
    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'blockedby_normalization_unresolved', runId,
      taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
      childTaskGroupId: result.childTaskGroupId, versionId: result.versionId,
      unresolvedRefs: blockedByNormalization.unresolvedRefs,
      summary: {
        unresolvedCount: blockedByNormalization.unresolvedCount,
        normalizedRefCount: blockedByNormalization.normalizedRefCount,
        reason: 'blockedby_ref_unresolved_in_child_version',
      },
    });
    appendRunLog(runDir, `${finishedAt} blockedby_normalization_unresolved taskId=${task.id} childTaskGroupId=${result.childTaskGroupId} versionId=${result.versionId} count=${blockedByNormalization.unresolvedCount}`);
  }

  const committingScopeDeferral = deferCommittingScopeChildrenForChildVersion({
    projectDir,
    childTaskGroupId: result.childTaskGroupId,
    versionId: result.versionId,
    budget,
    executor,
    finishedAt,
  });
  if (committingScopeDeferral.deferredCount > 0) {
    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'committing_scope_deferred', runId,
      taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
      childTaskGroupId: result.childTaskGroupId, versionId: result.versionId,
      coordinate: committingScopeDeferral.coordinate,
      deferredChildren: committingScopeDeferral.deferredChildren,
      summary: {
        deferredCount: committingScopeDeferral.deferredCount,
        guardMode: committingScopeDeferral.guardMode,
        reason: committingScopeDeferral.reason,
      },
    });
    appendRunLog(runDir, `${finishedAt} committing_scope_deferred taskId=${task.id} childTaskGroupId=${result.childTaskGroupId} versionId=${result.versionId} count=${committingScopeDeferral.deferredCount}`);
  }

  updateMarkdownFrontmatter(task.path, (fm) => {
    fm.status = 'done';
    fm.childTaskGroupId = result.childTaskGroupId;
    fm.runReadiness = 'needs_decomposition';
    fm.runReadinessReason = sanitizeFmScalar(result.recoveredAfterAdapterFailure
      ? `Decomposed by taskops-runner (${executor}) into ${result.childTaskGroupId}/${result.versionId} at ${finishedAt} after adapter timeout recovery: ${result.adapterFailureReason || 'adapter failed'}.`
      : `Decomposed by taskops-runner (${executor}) into ${result.childTaskGroupId}/${result.versionId} at ${finishedAt}.`);
    delete fm.lastRunFailureReason;
    return fm;
  });
  const taskCloseReason = result.recoveredAfterAdapterFailure ? 'decomposed_by_runner_after_adapter_timeout_recovery' : 'decomposed_by_runner';
  const runCloseReason = result.recoveredAfterAdapterFailure ? 'decomposition_recorded_after_adapter_timeout_recovery' : 'decomposition_recorded';
  closeTaskWithEow({ task, reason: taskCloseReason, finishedAt });
  updateMarkdownFrontmatter(runNodePath, (fm) => { fm.status = 'done'; return fm; });
  closeRunNodeWithEow({ runDir, runId, runNodeId, reason: runCloseReason, finishedAt });
  const inheritedBirthSnapshot = applyInheritedBirthSnapshotToChildVersion({
    projectDir,
    childTaskGroupId: result.childTaskGroupId,
    versionId: result.versionId,
    capturedAt: finishedAt,
  });

  logEvent(eventsPath, {
    timestamp: finishedAt, type: 'decomposition_completed', runId,
    taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
    childTaskGroupId: result.childTaskGroupId, versionId: result.versionId,
    message: result.message || null,
    recoveredAfterAdapterFailure: result.recoveredAfterAdapterFailure === true,
    adapterFailureReason: result.adapterFailureReason || null,
    adapterStatus: result.adapterFailureStatus || null,
    recoveryStatus: result.recoveryStatus || null,
    inheritedBirthSnapshot,
    expectedPlanNormalization,
    blockedByNormalization,
    committingScopeDeferral,
  });
  appendRunLog(runDir, `${finishedAt} decomposition_completed taskId=${task.id} childTaskGroupId=${result.childTaskGroupId} versionId=${result.versionId}`);
  return {
    taskId: task.id, runNodeId, kind: 'decompose', status: 'completed', executor,
    childTaskGroupId: result.childTaskGroupId, versionId: result.versionId, message: result.message || null,
    recoveredAfterAdapterFailure: result.recoveredAfterAdapterFailure === true,
    adapterFailureReason: result.adapterFailureReason || null,
    adapterStatus: result.adapterFailureStatus || null,
    recoveryStatus: result.recoveryStatus || null,
    inheritedBirthSnapshot,
    expectedPlanNormalization,
    blockedByNormalization,
    committingScopeDeferral,
    budget,
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

function performAgentExploration({ project, projectDir, task, executor, agentId, stepTimeoutMs, runDir, runId, runNodeId, budget = null, inheritedContext = null }) {
  const artifactsDir = join(runDir, 'artifacts');
  ensureDir(artifactsDir);
  const artifactPath = join(artifactsDir, `${runNodeId}.md`);
  const prompt = buildAgentExplorationPrompt({ project, task, runId, runNodeId, artifactPath, budget, inheritedContext });
  const adapter = executor === 'openclaw-agent' ? 'openclaw-cli' : executor;
  const result = invokeRuntimeAdapter(adapter, {
    prompt,
    agentId,
    sessionKey: openClawWorkerSessionKey({ agentId, projectId: project.id, taskId: task.id, action: 'explore' }),
    timeoutMs: stepTimeoutMs,
    cwd: artifactsDir,
  });
  if (!result.ok) return { ok: false, message: result.message };
  if (!existsSync(artifactPath)) {
    return { ok: false, message: `${adapter} did not write expected exploration artifact at ${artifactPath}; refusing to mark exploration done` };
  }
  return { ok: true, artifactPath, message: result.stdout || `Agent recorded exploration at ${artifactPath}` };
}

function executeExplorationTask({ projectDir, project, task, runDir, runId, eventsPath, executor, agentId, stepTimeoutMs, budget = null }) {
  const inheritedContext = inheritedContextForTask(projectDir, task);
  const startedAt = isoNow();
  const runNodeId = runNodeIdForTask(runDir, task);
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
      : performAgentExploration({ project, projectDir, task, executor, agentId, stepTimeoutMs, runDir, runId, runNodeId, budget, inheritedContext });
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const finishedAt = isoNow();
  if (!result.ok) {
    updateMarkdownFrontmatter(task.path, (fm) => {
      fm.status = 'blocked';
      fm.lastRunFailureReason = sanitizeFmScalar(result.message);
      return fm;
    });
    updateMarkdownFrontmatter(runNodePath, (fm) => { fm.status = 'blocked'; return fm; });
    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'exploration_failed', runId,
      taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
      message: result.message || null,
    });
    appendRunLog(runDir, `${finishedAt} exploration_failed taskId=${task.id} reason=${result.message || ''}`);
    return {
      taskId: task.id, runNodeId, kind: 'explore', status: 'failed', executor,
      message: result.message || null, adapterStatus: result.status || null,
      stdout: result.stdout || '', stderr: result.stderr || '',
      budget,
    };
  }

  const artifactText = result.artifactPath && existsSync(result.artifactPath)
    ? readFileSync(result.artifactPath, 'utf8')
    : '';
  const surpriseReport = parseSurpriseReportFromExecutorResult(result, artifactText ? [artifactText] : []);
  if (surpriseReport.markerFound && surpriseReport.parseError) {
    const reason = malformedSurpriseReason(surpriseReport);
    updateMarkdownFrontmatter(task.path, (fm) => {
      fm.status = 'blocked';
      fm.runReadiness = 'blocked';
      fm.runReadinessReason = reason;
      fm.lastRunFailureReason = reason;
      fm.needsManualReview = true;
      fm.malformedSurpriseReport = true;
      return fm;
    });
    updateMarkdownFrontmatter(runNodePath, (fm) => {
      fm.status = 'blocked';
      fm.result = {
        artifactPath: result.artifactPath || null,
        malformedSurpriseReport: {
          markerFound: true,
          parseError: surpriseReport.parseError,
          rawLine: surpriseReport.rawLine || '',
          needsManualReview: true,
        },
      };
      return fm;
    });
    logEvent(eventsPath, {
      timestamp: finishedAt, type: 'exploration_malformed_surprise_report', runId,
      taskId: task.id, taskGroupVersionId: task.taskGroupVersionId, runNodeId, executor,
      parseError: surpriseReport.parseError,
    });
    appendRunLog(runDir, `${finishedAt} exploration_malformed_surprise_report taskId=${task.id} runNodeId=${runNodeId} reason=${reason}`);
    return {
      taskId: task.id,
      runNodeId,
      kind: 'explore',
      status: 'failed',
      failureKind: 'malformed_surprise_report',
      executor,
      message: reason,
      budget,
      malformedSurpriseReport: {
        markerFound: true,
        parseError: surpriseReport.parseError,
        rawLine: surpriseReport.rawLine || '',
      },
    };
  }
  const surpriseHistoryEntry = surpriseReport.surpriseReported
    ? appendSurpriseHistory({
        task,
        report: surpriseReport.report,
        runId,
        runNodeId,
        actionKind: 'explore',
        observedAt: finishedAt,
        evidenceRefs: result.artifactPath ? [result.artifactPath, `run:${runId}/node:${runNodeId}`] : [`run:${runId}/node:${runNodeId}`],
      })
    : null;

  updateMarkdownFrontmatter(task.path, (fm) => {
    fm.status = 'done';
    fm.runReadiness = 'needs_decomposition';
    fm.runReadinessReason = sanitizeFmScalar(`Exploration recorded by taskops-runner (${executor}) at ${finishedAt}; ready for decomposition with informed inputs.`);
    delete fm.lastRunFailureReason;
    return fm;
  });
  closeTaskWithEow({ task, reason: 'exploration_recorded_by_runner', finishedAt });
  updateMarkdownFrontmatter(runNodePath, (fm) => {
    fm.status = 'done';
    fm.result = {
      artifactPath: result.artifactPath || null,
      ...(surpriseReport.surpriseReported ? {
        surpriseReport: surpriseReport.report,
        surpriseHistoryEntry,
      } : {}),
    };
    return fm;
  });
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
    budget,
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
    const c = applyBlockerGate(parsed, task, classifyTaskReadiness(task));
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

function normalizeRunRefs(task) {
  return Array.isArray(task?.runRefs) ? task.runRefs : [];
}

function findTaskForRunNode(parsed, node) {
  if (!node?.sourceTaskId) return null;
  const matches = [...parsed.tasks.values()].filter((task) => (
    task.id === node.sourceTaskId
    && (!node.sourceTaskGroupVersionId || task.taskGroupVersionId === node.sourceTaskGroupVersionId)
  ));
  return matches.length === 1 ? matches[0] : null;
}

function findReviewSubject(parsed, targetId) {
  const direct = findCloseTarget(parsed, targetId);
  if (direct.type === 'runNode') {
    const task = findTaskForRunNode(parsed, direct.runNode);
    return { task, runNode: direct.runNode };
  }

  const task = direct.task;
  const refs = normalizeRunRefs(task).slice().reverse();
  for (const ref of refs) {
    if (!ref?.runId || !ref?.runNodeId) continue;
    const node = parsed.runNodes.get(`${ref.runId}:${ref.runNodeId}`);
    if (node && node.type !== 'review') return { task, runNode: node };
  }
  const node = [...parsed.runNodes.values()]
    .reverse()
    .find((candidate) => candidate.sourceTaskId === task.id && candidate.sourceTaskGroupVersionId === task.taskGroupVersionId && candidate.type !== 'review');
  if (node) return { task, runNode: node };
  throw new Error(`Task '${task.id}' has no run node to review`);
}

function attachApprovedReviewToExistingEows({ parsed, task, runNode, approvedReview }) {
  if (!approvedReview) return [];
  const touched = [];
  for (const eow of parsed.eowNodes.values()) {
    const taskMatch = task && eow.graphType === 'task' && eow.attachedToId === task.id && eow.taskGroupVersionId === task.taskGroupVersionId;
    const runMatch = eow.graphType === 'run' && eow.runId === runNode.runId && eow.attachedToId === runNode.id;
    if (!taskMatch && !runMatch) continue;
    updateMarkdownFrontmatter(eow.path, (fm) => {
      fm.approvedByReviewNodeId = approvedReview.reviewNodeId;
      fm.approvedReviewMode = approvedReview.reviewMode;
      fm.approvedReviewReportHash = approvedReview.reviewReportHash;
      fm.reviewedAcceptanceHash = approvedReview.reviewedAcceptanceHash;
      fm.reviewedResultHash = approvedReview.reviewedResultHash;
      if (fm.reason === 'manual_close' || fm.reason === 'no_further_decomposition' || fm.reason === 'execution_path_closed') {
        fm.reason = 'approved_result';
      }
      return fm;
    });
    touched.push(eow.path);
  }
  return touched;
}

export function reviewTarget(workDir, targetId) {
  if (!targetId) throw new Error('Missing review target id');
  const projectDir = resolveSingleProject(workDir);
  const parsed = parseProject(projectDir);
  if (parsed.errors.length > 0) {
    throw new Error(`TaskOps work has validation errors; refuse to review until resolved:\n- ${parsed.errors.join('\n- ')}`);
  }
  const { task, runNode } = findReviewSubject(parsed, targetId);
  const review = writeReviewForRunNode({ projectDir, task, runNode });
  const eowPathsUpdated = attachApprovedReviewToExistingEows({
    parsed,
    task,
    runNode,
    approvedReview: review.approvedReview,
  });
  return {
    workId: parsed.project.id,
    projectDir,
    target: {
      type: task ? 'task' : 'runNode',
      id: task?.id || runNode.id,
      taskGroupVersionId: task?.taskGroupVersionId || null,
      runId: runNode.runId,
      runNodeId: runNode.id,
    },
    reviewNodeId: review.reviewNodeId,
    reviewNodePath: review.reviewNodePath,
    reviewReport: review.reviewReport,
    reviewReportHash: review.reviewReportHash,
    eowPathsUpdated,
  };
}

const RUN_NODE_OVERRIDE_REASONS = new Set(['manual_verified', 'manual_close', 'failure', 'superseded', 'cancelled']);
const DELEGATION_OVERRIDE_REASONS = new Set(['manual_verified', 'cancelled', 'superseded']);

export function closeTarget(workDir, targetId, {
  reason = null,
  completedSummary = null,
  incompleteSummary = null,
  followUpNeeded = true,
  budget = null,
} = {}) {
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

    if (declaredReason === 'partial_complete') {
      const marker = writeTaskPartialMarker({
        task,
        declaredAt,
        options: { completedSummary, incompleteSummary, followUpNeeded, budget },
      });
      return {
        workId: parsed.project.id,
        projectDir,
        target: { type: 'task', id: task.id, taskGroupId: task.taskGroupId, taskGroupVersionId: task.taskGroupVersionId },
        reason: declaredReason,
        partial: true,
        closed: false,
        statusFlipped: false,
        partialCompletion: marker.partial,
        partialId: marker.partialId,
        partialPath: marker.partialPath,
      };
    }

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
      updateMarkdownFrontmatter(task.path, (fm) => {
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
    writeTextFileAtomic(eowPath, fmBlock(eowFm) + `# EoW: ${task.id}\n`);
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

  if (declaredReason === 'partial_complete') {
    const marker = writeRunPartialMarker({
      projectDir,
      runNode: node,
      declaredAt,
      options: { completedSummary, incompleteSummary, followUpNeeded, budget },
    });
    return {
      workId: parsed.project.id,
      projectDir,
      target: { type: 'runNode', runId: node.runId, id: node.id },
      reason: declaredReason,
      partial: true,
      closed: false,
      partialCompletion: marker.partial,
      partialId: marker.partialId,
      partialPath: marker.partialPath,
    };
  }

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
  writeTextFileAtomic(eowPath, fmBlock(eowFm) + `# EoW: ${node.id}\n`);
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
    writeTextFileAtomic(edgePath, fmBlock(edgeFm) + `# Run edge: ${node.id} closes with EoW\n`);
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
  const allowedExecutors = ['openclaw-agent', ...RUNTIME_ADAPTER_NAMES];
  if (!allowedExecutors.includes(executor)) {
    throw new Error(`Invalid --executor '${executor}'. Use ${allowedExecutors.join(', ')}.`);
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
    : (executor === 'openclaw-agent' || executor === 'openclaw-cli' ? agentId : 'taskops-runner');
  const maxStepsExplicit = options.maxStepsExplicit === true || options.maxStepsExplicit === 'true';
  const budgetEnabled = maxStepsExplicit && maxSteps != null;
  const targetTaskId = options.targetTaskId || null;
  const targetTaskGroupVersionId = options.targetTaskGroupVersionId || null;
  const allowConcurrentTarget = options.allowConcurrentTarget === true && Boolean(targetTaskId);

  const lockDir = join(projectDir, RUNNER_LOCK_DIR);
  let ownsLock = false;
  if (!allowConcurrentTarget) {
    try {
      mkdirSync(lockDir, { recursive: false });
      ownsLock = true;
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        throw new Error(`TaskOps runner lock already held at ${lockDir}; remove it if no runner is active`);
      }
      throw err;
    }
    try {
      writeFileSync(join(lockDir, 'pid'), String(process.pid), 'utf8');
    } catch {}
  }

  const cleanup = () => {
    if (!ownsLock) return;
    try { rmSync(lockDir, { recursive: true, force: true }); } catch {}
  };

  try {
    let parsed = parseProjectForRunner(projectDir, { allowConcurrentTarget });
    let validationErrors = filterConcurrentTargetValidationErrors(parsed.errors, {
      allowConcurrentTarget,
      runId: options.runId ? String(options.runId) : null,
      targetTaskId,
      targetTaskGroupVersionId,
    });
    if (validationErrors.length > 0) {
      throw new Error(`TaskOps work has validation errors; cannot start runner:\n- ${validationErrors.join('\n- ')}`);
    }

    const runId = resolveRunId(parsed, options.runId);
    const runDir = ensureRunDirectories(projectDir, runId, parsed.project);
    const eventsPath = join(runDir, 'events.jsonl');

    const startedAt = isoNow();
    logEvent(eventsPath, {
      timestamp: startedAt, type: 'runner_started',
      workId: parsed.project.id, runId, executor,
      agentId: executor === 'openclaw-agent' || executor === 'openclaw-cli' ? agentId : null,
      maxSteps, until: until != null ? new Date(until).toISOString() : null,
      maxStepsExplicit, budgetEnabled,
      loopbackPolicy, maxLoopbacks, actorName,
    });
    appendRunLog(runDir, `${startedAt} runner_started workId=${parsed.project.id} runId=${runId} executor=${executor}${loopbackPolicy !== 'none' ? ` loopbackPolicy=${loopbackPolicy} maxLoopbacks=${maxLoopbacks}` : ''}`);

    let stepsRun = 0;
    let loopbacksUsed = 0;
    let stopReason = null;
    let stopDetail = null;
    let stopSource = null;
    let finalBudget = computeStepBudget({ stepsRun, maxSteps, budgetEnabled });
    const actions = [];
    const reportedBlockedEvidenceIssues = new Set();

    while (true) {
      finalBudget = computeStepBudget({ stepsRun, maxSteps, budgetEnabled });
      if (until != null && Date.now() >= until) { stopReason = STOP_REASONS.DEADLINE_REACHED; break; }
      if (maxSteps != null && stepsRun >= maxSteps) { stopReason = STOP_REASONS.MAX_STEPS; break; }

      recheckBlockedTasks(projectDir, { allowConcurrentTarget, runId });
      parsed = parseProjectForRunner(projectDir, { allowConcurrentTarget });
      validationErrors = filterConcurrentTargetValidationErrors(parsed.errors, {
        allowConcurrentTarget,
        runId,
        targetTaskId,
        targetTaskGroupVersionId,
      });
      if (validationErrors.length > 0) {
        stopReason = STOP_REASONS.VALIDATION_FAILED;
        logEvent(eventsPath, { timestamp: isoNow(), type: 'validation_failed', runId, errors: validationErrors });
        break;
      }
      const missingBlockerIssues = blockedEvidenceIssues(parsed)
        .filter((issue) => {
          const key = `${issue.taskGroupVersionId}:${issue.taskId}`;
          if (reportedBlockedEvidenceIssues.has(key)) return false;
          reportedBlockedEvidenceIssues.add(key);
          return true;
        });
      if (missingBlockerIssues.length > 0) {
        logEvent(eventsPath, {
          timestamp: isoNow(),
          type: 'blockedby_missing_for_blocked_task',
          runId,
          issues: missingBlockerIssues,
          summary: {
            count: missingBlockerIssues.length,
            reason: 'blocked_task_missing_machine_readable_blocker',
          },
        });
        appendRunLog(runDir, `${isoNow()} blockedby_missing_for_blocked_task count=${missingBlockerIssues.length}`);
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
          if (delegate && delegate.type === 'delegate' && isSelfDelegate(delegate, parsed.project)) {
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
              budget: finalBudget,
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
      const activeSnapshot = parsed.snapshots.get(parsed.project.activeSnapshotId) || null;
      const stepBudget = budgetWithExpectedPlanCoordinate(finalBudget, {
        parsed,
        task: next.task,
        activeSnapshot,
      });

      let stepResult;
      if (next.kind === 'execute') {
        stepResult = executeRunnableTask({
          project: parsed.project, task: next.task,
          runDir, runId, eventsPath, executor, agentId, stepTimeoutMs,
          budget: stepBudget,
        });
      } else if (next.kind === 'decompose') {
        stepResult = executeDecompositionTask({
          projectDir, project: parsed.project, task: next.task,
          runDir, runId, eventsPath, executor, agentId, stepTimeoutMs,
          budget: stepBudget,
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
          budget: stepBudget,
        });
      } else {
        throw new Error(`Unhandled action kind: ${next.kind}`);
      }

      actions.push(stepResult);
      stepsRun += 1;

      if (stepResult.status === 'failed') { stopReason = STOP_REASONS.TASK_FAILED; break; }
    }

    if (!stopReason) stopReason = STOP_REASONS.NO_RUNNABLE;
    finalBudget = computeStepBudget({ stepsRun, maxSteps, budgetEnabled });
    const partialCompletions = actions
      .map((action) => action?.partialCompletion)
      .filter(Boolean);

    const stoppedAt = isoNow();
    logEvent(eventsPath, {
      timestamp: stoppedAt, type: 'runner_stopped', runId,
      workId: parsed.project.id, stopReason, stepsRun, detail: stopDetail, source: stopSource,
    });
    appendRunLog(runDir, `${stoppedAt} runner_stopped stopReason=${stopReason} stepsRun=${stepsRun}${stopDetail ? ` detail=${stopDetail}` : ''}`);

    return {
      workId: parsed.project.id, runId,
      stopReason, stopDetail, stopSource,
      stepsRun, maxSteps, maxStepsExplicit, finalBudget,
      until: until != null ? new Date(until).toISOString() : null,
      executor,
      loopbackPolicy, maxLoopbacks, loopbacksUsed, actorName,
      partialCompletions,
      eventsPath,
      tasks: actions,
      actions,
    };
  } finally {
    cleanup();
  }
}
