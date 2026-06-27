import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync, watch } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const STATUS_VALUES = ['pending', 'active', 'done', 'blocked', 'waiting', 'cancelled'];
export const RUN_READINESS_VALUES = ['runnable', 'needs_decomposition', 'needs_exploration', 'blocked'];
export const UNDERSTANDING_LEVEL_VALUES = ['known', 'partial', 'unknown'];
export const UNCERTAINTY_STATE_VALUES = ['unknown_unknown', 'known_unknown', 'known'];
export const KNOWN_VERIFICATION_STATUS_VALUES = ['unverified'];
export const REVIEW_DECISION_VALUES = ['approved', 'rejected', 'needs_verification'];
export const ACCEPTANCE_MODE_VALUES = ['informational', 'enforced', 'guarded', 'runner-managed'];
export const ENTITY_TYPES = ['work', 'project', 'taskGroup', 'taskGroupVersion', 'task', 'versionSnapshot', 'run', 'runNode', 'runEdge', 'eow', 'partial'];
export const WORK_ENTITY_TYPES = ['work', 'project'];
export const EOW_GRAPH_TYPES = ['task', 'run'];
export const EOW_ATTACHED_TO_TYPES = ['task', 'runNode'];
export const TASKOPS_SYNC_DIR = '.taskops';
export const TASKOPS_SYNC_CONFIG = 'taskops-sync.json';
export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_MAX_FOLLOW_UP_DEPTH = 1;
export const DEFAULT_PARTIAL_PROMOTION_WAVE_BUDGET = 10;
export const DEFAULT_PARTIAL_REPEAT_THRESHOLD = 3;

const TASK_UNCERTAINTY_SCALAR_FIELDS = ['uncertaintyState', 'confidenceScore'];
const TASK_UNCERTAINTY_ARRAY_FIELDS = ['knownList', 'surpriseHistory'];
const POLICY_APPROVED_EOW_FIELDS = [
  'approvedByReviewNodeId',
  'approvedReviewMode',
  'approvedReviewReportHash',
  'reviewedAcceptanceHash',
  'reviewedResultHash',
];
const POLICY_APPROVED_MODES = new Set(['enforced', 'guarded', 'runner-managed']);

const SUMMARY_LABELS = Object.freeze({
  projectId: 'Work ID',
  projectObjective: 'Work objective',
  projectStatus: 'Work status',
  rootTaskGroup: 'Root task group',
  activeSnapshot: 'Active snapshot',
  taskGroups: 'Task groups',
  taskGroupVersions: 'Task group versions',
  tasks: 'Tasks',
  snapshots: 'Snapshots',
  runs: 'Runs',
  runNodes: 'Run nodes',
  runEdges: 'Run edges',
  eowNodes: 'EoW nodes',
  partialNodes: 'Partial markers',
  taskEowCoverage: 'Terminal task EoW coverage',
  structuralClosure: 'Structural closure',
  policyApprovedClosure: 'Policy-approved closure',
  manualAttestedClosure: 'Manual-attested closure',
  closureState: 'Closure state',
  waitingDelegations: 'Waiting delegations',
  openBlockers: 'Open blockers',
  workCompletion: 'Work completion',
  taskStatusCounts: 'Task status counts',
  selectedVersion: 'Selected version',
  warnings: 'Warnings',
  errors: 'Errors',
});

const LOCALIZED_TEXT = {
  en: {
    summary: {
      none: 'none',
      noRunNodes: 'no run nodes',
      unknown: 'unknown',
      objective: 'objective',
      version: 'version',
      task: 'task',
      node: 'node',
      edge: 'edge',
      selectedTag: 'selected',
    },
    init: {
      projectInitialized: 'Initialized project.',
      initialRootDecomposition: 'Initial root decomposition',
      initialVersionCreated: 'Initial version created.',
      initialSnapshot: 'Initial snapshot',
      runInitialized: 'Run initialized.',
      versionCreatedFromSpec: 'Version created from spec.',
    },
    validation: {
      missingRequiredField: (field) => `missing required field '${field}'`,
      entityTypeMustBe: (type) => `entityType must be '${type}'`,
      entityTypeMustBeOneOf: (types) => `entityType must be one of: ${types.join(', ')}`,
      invalidStatus: (status) => `invalid status '${status}'`,
      invalidRunReadiness: (value) => `invalid runReadiness '${value}'`,
      invalidUnderstandingLevel: (value) => `invalid understandingLevel '${value}'`,
      invalidUncertaintyState: (value) => `invalid uncertaintyState '${value}'`,
      invalidConfidenceScore: (value) => `invalid confidenceScore '${value}'`,
      invalidKnownList: (detail) => `invalid knownList: ${detail}`,
      invalidSurpriseHistory: (detail) => `invalid surpriseHistory: ${detail}`,
      invalidEowGraphType: (value) => `invalid EoW graphType '${value}'`,
      invalidEowAttachedToType: (value) => `invalid EoW attachedToType '${value}'`,
      missingIndexMd: 'missing index.md',
      idMustMatchFolderName: (name) => `id must match folder name '${name}'`,
      idMustMatchFileName: (name) => `id must match file name '${name}'`,
      taskGroupIdMustBe: (id) => `taskGroupId must be '${id}'`,
      taskGroupVersionIdMustBe: (id) => `taskGroupVersionId must be '${id}'`,
      duplicateTaskKey: (key) => `duplicate task key '${key}'`,
      activeRootTaskGroupNotFound: (id) => `activeRootTaskGroupId '${id}' not found`,
      activeVersionNotFound: (id) => `activeVersionId '${id}' not found`,
      multipleSelectedVersionsDetected: 'multiple selected/active versions detected',
      selectedVersionsMustBeList: 'selectedVersions must be a list',
      invalidSelectedVersionsEntry: 'invalid selectedVersions entry',
      selectedTaskGroupNotFound: (id) => `selected taskGroupId '${id}' not found`,
      selectedVersionNotFound: (id) => `selected versionId '${id}' not found`,
      rootTaskGroupNotFound: (id) => `rootTaskGroupId '${id}' not found`,
      activeSnapshotNotFound: (id) => `activeSnapshotId '${id}' not found`,
      projectIdMustBe: (id) => `projectId/workId must be '${id}'`,
      runIdMustBe: (id) => `runId must be '${id}'`,
      sourceTaskGroupVersionNotFound: (id) => `sourceTaskGroupVersionId '${id}' not found`,
      sourceTaskNotFound: (id) => `sourceTaskId '${id}' not found`,
      fromRunNodeNotFound: (id) => `fromRunNodeId '${id}' not found`,
      toRunNodeNotFound: (id) => `toRunNodeId '${id}' not found`,
      missingRunIndex: 'missing runs/<run-id>/index.md',
      childTaskGroupNotFound: (id) => `childTaskGroupId '${id}' not found`,
      missingTasksDirectory: "missing tasks/ directory",
      eowAttachedTaskNotFound: (id) => `EoW attached task '${id}' not found`,
      eowAttachedRunNodeNotFound: (id) => `EoW attached run node '${id}' not found`,
      terminalTaskMissingEow: (id) => `terminal task '${id}' has no EoW node`,
      runTerminalMissingEow: (runId, id) => `run '${runId}' terminal node '${id}' has no EoW node`,
      runRefTargetNotFound: (runId, nodeId) => `runRef target '${runId}/${nodeId}' not found`,
      runRefSourceMismatch: (runId, nodeId, taskId) => `runRef '${runId}/${nodeId}' does not point back to task '${taskId}'`,
      missingTaskBackReference: (taskId, runId, nodeId) => `run node '${runId}/${nodeId}' points to task '${taskId}' but task has no matching runRefs entry`,
      delegateMissingField: (field) => `delegation/waiting node missing '${field}'`,
      taskGroupNotFound: (id) => `Task group not found: ${id}`,
      versionAlreadyExists: (id) => `Version already exists: ${id}`,
    },
  },
  ko: {
    summary: {
      none: '없음',
      noRunNodes: '실행 노드 없음',
      unknown: '알 수 없음',
      objective: 'objective',
      version: 'version',
      task: 'task',
      node: 'node',
      edge: 'edge',
      selectedTag: 'selected',
    },
    init: {
      projectInitialized: '프로젝트를 초기화했다.',
      initialRootDecomposition: '초기 루트 분해',
      initialVersionCreated: '초기 버전을 만들었다.',
      initialSnapshot: '초기 스냅샷',
      runInitialized: '실행 기록을 초기화했다.',
      versionCreatedFromSpec: 'spec에서 버전을 만들었다.',
    },
    validation: {
      missingRequiredField: (field) => `필수 frontmatter field '${field}'가 없음`,
      entityTypeMustBe: (type) => `entityType은 '${type}'여야 함`,
      entityTypeMustBeOneOf: (types) => `entityType은 다음 중 하나여야 함: ${types.join(', ')}`,
      invalidStatus: (status) => `유효하지 않은 status '${status}'`,
      invalidRunReadiness: (value) => `유효하지 않은 runReadiness '${value}'`,
      invalidUnderstandingLevel: (value) => `유효하지 않은 understandingLevel '${value}'`,
      invalidUncertaintyState: (value) => `유효하지 않은 uncertaintyState '${value}'`,
      invalidConfidenceScore: (value) => `유효하지 않은 confidenceScore '${value}'`,
      invalidKnownList: (detail) => `유효하지 않은 knownList: ${detail}`,
      invalidEowGraphType: (value) => `유효하지 않은 EoW graphType '${value}'`,
      invalidEowAttachedToType: (value) => `유효하지 않은 EoW attachedToType '${value}'`,
      missingIndexMd: 'index.md가 없음',
      idMustMatchFolderName: (name) => `id는 folder name '${name}'와 일치해야 함`,
      idMustMatchFileName: (name) => `id는 file name '${name}'와 일치해야 함`,
      taskGroupIdMustBe: (id) => `taskGroupId는 '${id}'여야 함`,
      taskGroupVersionIdMustBe: (id) => `taskGroupVersionId는 '${id}'여야 함`,
      duplicateTaskKey: (key) => `중복 task key '${key}'`,
      activeRootTaskGroupNotFound: (id) => `activeRootTaskGroupId '${id}'를 찾지 못함`,
      activeVersionNotFound: (id) => `activeVersionId '${id}'를 찾지 못함`,
      multipleSelectedVersionsDetected: 'selected/active version이 여러 개 감지됨',
      selectedVersionsMustBeList: 'selectedVersions는 list여야 함',
      invalidSelectedVersionsEntry: 'selectedVersions entry가 유효하지 않음',
      selectedTaskGroupNotFound: (id) => `selected taskGroupId '${id}'를 찾지 못함`,
      selectedVersionNotFound: (id) => `selected versionId '${id}'를 찾지 못함`,
      rootTaskGroupNotFound: (id) => `rootTaskGroupId '${id}'를 찾지 못함`,
      activeSnapshotNotFound: (id) => `activeSnapshotId '${id}'를 찾지 못함`,
      projectIdMustBe: (id) => `projectId/workId는 '${id}'여야 함`,
      runIdMustBe: (id) => `runId는 '${id}'여야 함`,
      sourceTaskGroupVersionNotFound: (id) => `sourceTaskGroupVersionId '${id}'를 찾지 못함`,
      sourceTaskNotFound: (id) => `sourceTaskId '${id}'를 찾지 못함`,
      fromRunNodeNotFound: (id) => `fromRunNodeId '${id}'를 찾지 못함`,
      toRunNodeNotFound: (id) => `toRunNodeId '${id}'를 찾지 못함`,
      missingRunIndex: 'runs/<run-id>/index.md가 없음',
      childTaskGroupNotFound: (id) => `childTaskGroupId '${id}'를 찾지 못함`,
      missingTasksDirectory: 'tasks/ 디렉터리가 없음',
      eowAttachedTaskNotFound: (id) => `EoW가 붙은 task '${id}'를 찾지 못함`,
      eowAttachedRunNodeNotFound: (id) => `EoW가 붙은 run node '${id}'를 찾지 못함`,
      terminalTaskMissingEow: (id) => `terminal task '${id}'에 EoW node가 없음`,
      runTerminalMissingEow: (runId, id) => `run '${runId}' terminal node '${id}'에 EoW node가 없음`,
      runRefTargetNotFound: (runId, nodeId) => `runRef target '${runId}/${nodeId}'를 찾지 못함`,
      runRefSourceMismatch: (runId, nodeId, taskId) => `runRef '${runId}/${nodeId}'가 task '${taskId}'로 되돌아가리키지 않음`,
      missingTaskBackReference: (taskId, runId, nodeId) => `run node '${runId}/${nodeId}'가 task '${taskId}'를 가리키지만 task에 대응 runRefs가 없음`,
      delegateMissingField: (field) => `delegation/waiting node에 '${field}'가 없음`,
      taskGroupNotFound: (id) => `Task group '${id}'를 찾지 못함`,
      versionAlreadyExists: (id) => `Version '${id}'가 이미 존재함`,
    },
  },
};

function normalizeLanguage(language = DEFAULT_LANGUAGE) {
  const value = String(language || DEFAULT_LANGUAGE).trim().toLowerCase();
  if (value.startsWith('ko')) return 'ko';
  return 'en';
}

function localeBundle(language = DEFAULT_LANGUAGE) {
  return LOCALIZED_TEXT[normalizeLanguage(language)] || LOCALIZED_TEXT.en;
}

function withPath(filePath, message) {
  return `${filePath}: ${message}`;
}

export function isPartialUnresolved(partial) {
  const value = partial?.supersededBy;
  if (value == null) return true;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '' || normalized === 'null';
}

function nonNegativeInteger(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function positiveInteger(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export function partialPromotionWaveBudgetState(project, { promotionCount = 0 } = {}) {
  const budget = nonNegativeInteger(project?.partialPromotionWaveBudget, DEFAULT_PARTIAL_PROMOTION_WAVE_BUDGET);
  const count = nonNegativeInteger(project?.partialPromotionWaveCount, 0);
  const willApply = Number(promotionCount || 0) > 0;
  const nextCount = willApply ? count + 1 : count;
  return {
    budget,
    count,
    nextCount,
    promotionCount: Number(promotionCount || 0),
    remainingBefore: Math.max(0, budget - count),
    remainingAfterApply: Math.max(0, budget - nextCount),
    exhausted: count >= budget,
    wouldExceed: willApply && nextCount > budget,
  };
}

export function partialRepeatThresholdValue(project, override = null) {
  if (override != null) {
    const value = positiveInteger(override, null);
    if (value == null) throw new Error(`Invalid partial repeat threshold '${override}'`);
    return value;
  }
  return positiveInteger(project?.partialRepeatThreshold, DEFAULT_PARTIAL_REPEAT_THRESHOLD);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(Object(value), key);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function cloneFrontmatterValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneFrontmatterValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneFrontmatterValue(item)]));
  }
  return value;
}

function validateTaskUncertaintyFields(task, taskPath, errors, t) {
  if (task.uncertaintyState != null) {
    const state = String(task.uncertaintyState).trim();
    if (!UNCERTAINTY_STATE_VALUES.includes(state)) {
      errors.push(withPath(taskPath, t.invalidUncertaintyState(task.uncertaintyState)));
    }
  }

  if (task.confidenceScore != null) {
    const score = Number(task.confidenceScore);
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      errors.push(withPath(taskPath, t.invalidConfidenceScore(task.confidenceScore)));
    }
  }

  if (task.knownList != null) {
    if (!Array.isArray(task.knownList)) {
      errors.push(withPath(taskPath, t.invalidKnownList('knownList must be a list')));
    } else {
      task.knownList.forEach((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push(withPath(taskPath, t.invalidKnownList(`entry ${index + 1} must be an object`)));
          return;
        }
        if (!nonEmptyString(item.id)) {
          errors.push(withPath(taskPath, t.invalidKnownList(`entry ${index + 1} missing non-empty id`)));
        }
        if (!nonEmptyString(item.claim)) {
          errors.push(withPath(taskPath, t.invalidKnownList(`entry ${index + 1} missing non-empty claim`)));
        }
        const status = String(item.verificationStatus || '').trim();
        if (!KNOWN_VERIFICATION_STATUS_VALUES.includes(status)) {
          errors.push(withPath(taskPath, t.invalidKnownList(`entry ${index + 1} has invalid verificationStatus '${item.verificationStatus}'`)));
        }
      });
    }
  }

  if (task.surpriseHistory == null) return;
  if (!Array.isArray(task.surpriseHistory)) {
    errors.push(withPath(taskPath, t.invalidSurpriseHistory('surpriseHistory must be a list')));
    return;
  }

  task.surpriseHistory.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(withPath(taskPath, t.invalidSurpriseHistory(`entry ${index + 1} must be an object`)));
      return;
    }
    if (!nonEmptyString(entry.id)) {
      errors.push(withPath(taskPath, t.invalidSurpriseHistory(`entry ${index + 1} missing non-empty id`)));
    }
    if (!nonEmptyString(entry.actionKind)) {
      errors.push(withPath(taskPath, t.invalidSurpriseHistory(`entry ${index + 1} missing non-empty actionKind`)));
    }
    if (!nonEmptyString(entry.observedAt)) {
      errors.push(withPath(taskPath, t.invalidSurpriseHistory(`entry ${index + 1} missing non-empty observedAt`)));
    }
    if (entry.surpriseScore != null) {
      const score = Number(entry.surpriseScore);
      if (!Number.isFinite(score) || score < 0 || score > 1) {
        errors.push(withPath(taskPath, t.invalidSurpriseHistory(`entry ${index + 1} has invalid surpriseScore '${entry.surpriseScore}'`)));
      }
    }
    for (const listField of ['contradictedKnownIds', 'newUnknownIds', 'blockingNewUnknownIds', 'nonBlockingNewUnknownIds', 'newKnownIds']) {
      if (entry[listField] != null && !Array.isArray(entry[listField])) {
        errors.push(withPath(taskPath, t.invalidSurpriseHistory(`entry ${index + 1} field ${listField} must be a list`)));
      }
    }
  });
}

export function parseScalar(value) {
  const stripped = String(value).trim();
  if (stripped === 'true') return true;
  if (stripped === 'false') return false;
  if (stripped === '[]') return [];
  if (stripped === '{}') return {};
  if (/^-?\d+$/.test(stripped)) return Number(stripped);
  return stripped;
}

export function parseFrontmatterText(content, filePath = '<inline>') {
  if (!content.startsWith('---\n')) throw new Error(`Missing YAML frontmatter in ${filePath}`);
  const lines = content.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error(`Unclosed YAML frontmatter in ${filePath}`);

  const root = {};
  const stack = [{ indent: -1, container: root, kind: 'object' }];

  const setValue = (container, key, value) => {
    if (Array.isArray(container)) container.push(value);
    else container[key] = value;
  };

  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const trimmed = raw.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];

    if (trimmed.startsWith('- ')) {
      if (!Array.isArray(parent.container)) throw new Error(`Invalid list item in ${filePath}: ${raw}`);
      const itemText = trimmed.slice(2);
      if (!/^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(itemText)) {
        parent.container.push(parseScalar(itemText));
      } else {
        const obj = {};
        parent.container.push(obj);
        stack.push({ indent, container: obj, kind: 'object' });
        const idx = itemText.indexOf(':');
        const key = itemText.slice(0, idx).trim();
        const rest = itemText.slice(idx + 1).trim();
        if (rest === '') {
          obj[key] = [];
          stack.push({ indent: indent + 2, container: obj[key], kind: 'array' });
        } else {
          obj[key] = parseScalar(rest);
        }
      }
      continue;
    }

    const idx = trimmed.indexOf(':');
    if (idx === -1) throw new Error(`Invalid frontmatter line in ${filePath}: ${raw}`);
    const key = trimmed.slice(0, idx).trim();
    const rest = trimmed.slice(idx + 1).trim();
    if (rest === '') {
      const next = lines.slice(i + 1, end).find((line) => line.trim());
      const nextTrimmed = next ? next.trim() : '';
      const nextIndent = next ? next.match(/^\s*/)[0].length : indent + 2;
      const container = nextTrimmed.startsWith('- ') && nextIndent > indent ? [] : {};
      setValue(parent.container, key, container);
      stack.push({ indent, container, kind: Array.isArray(container) ? 'array' : 'object' });
    } else {
      setValue(parent.container, key, parseScalar(rest));
    }
  }

  return root;
}

export function parseMarkdownFile(filePath) {
  return parseFrontmatterText(readFileSync(filePath, 'utf8'), filePath);
}

export function readBody(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  return end === -1 ? content : lines.slice(end + 1).join('\n').trim();
}

function fileExists(path) {
  return existsSync(path);
}

export function findNearestSyncConfigPath(startPath) {
  const full = resolve(startPath);
  const st = statSync(full, { throwIfNoEntry: false });
  let current = st?.isDirectory() ? full : dirname(full);
  while (current) {
    const candidate = join(current, TASKOPS_SYNC_DIR, TASKOPS_SYNC_CONFIG);
    if (fileExists(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function readNearestSyncConfig(startPath) {
  const configPath = findNearestSyncConfigPath(startPath);
  if (!configPath) return null;
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

export function resolveLanguage(startPath, fallback = DEFAULT_LANGUAGE) {
  try {
    return normalizeLanguage(readNearestSyncConfig(startPath)?.language || fallback);
  } catch {
    return normalizeLanguage(fallback);
  }
}

function listDirs(path) {
  if (!fileExists(path)) return [];
  return readdirSync(path).map((name) => join(path, name)).filter((p) => statSync(p).isDirectory()).sort();
}

function listMd(path) {
  if (!fileExists(path)) return [];
  return readdirSync(path).map((name) => join(path, name)).filter((p) => p.endsWith('.md')).sort();
}

function checkFields(fm, required, filePath, errors, language = DEFAULT_LANGUAGE) {
  const t = localeBundle(language).validation;
  for (const field of required) {
    if (!(field in fm) || fm[field] === '' || fm[field] == null) errors.push(withPath(filePath, t.missingRequiredField(field)));
  }
}

export function discoverProjects(inputPath) {
  const full = resolve(inputPath);
  const st = statSync(full, { throwIfNoEntry: false });
  if (!st) throw new Error(`Path not found: ${inputPath}`);
  if (st.isFile()) return discoverProjects(dirname(full));
  const directIndex = join(full, 'index.md');
  if (fileExists(directIndex)) {
    try {
      const fm = parseMarkdownFile(directIndex);
      if (WORK_ENTITY_TYPES.includes(fm.entityType)) return [full];
    } catch {}
  }
  const projects = listDirs(full).filter((dir) => {
    const indexPath = join(dir, 'index.md');
    if (!fileExists(indexPath)) return false;
    try {
      return WORK_ENTITY_TYPES.includes(parseMarkdownFile(indexPath).entityType);
    } catch {
      return false;
    }
  });
  if (projects.length === 0) throw new Error(`No TaskOps work found under ${inputPath}`);
  return projects;
}

export function parseProject(projectDir) {
  const errors = [];
  const warnings = [];
  const projectIndex = join(projectDir, 'index.md');
  const project = parseMarkdownFile(projectIndex);
  const language = normalizeLanguage(project.language || resolveLanguage(projectDir));
  const t = localeBundle(language).validation;

  checkFields(project, ['taskOpsVersion', 'entityType', 'id', 'title', 'objective', 'activeRootTaskGroupId', 'createdAt', 'status'], projectIndex, errors, language);
  if (!WORK_ENTITY_TYPES.includes(project.entityType)) errors.push(withPath(projectIndex, t.entityTypeMustBeOneOf(WORK_ENTITY_TYPES)));
  if (!STATUS_VALUES.includes(project.status)) errors.push(withPath(projectIndex, t.invalidStatus(project.status)));

  const taskGroups = new Map();
  const versions = new Map();
  const tasks = new Map();
  const snapshots = new Map();
  const runs = new Map();
  const runNodes = new Map();
  const runEdges = new Map();
  const eowNodes = new Map();
  const partialNodes = new Map();
  const taskEowsByTaskKey = new Map();
  const runEowsByRunNodeKey = new Map();

  const addEow = (eow, filePath) => {
    if (eowNodes.has(eow.id)) errors.push(withPath(filePath, `duplicate EoW id '${eow.id}'`));
    eowNodes.set(eow.id, { ...eow, path: filePath });
  };
  const addPartial = (partial, filePath) => {
    if (partialNodes.has(partial.id)) errors.push(withPath(filePath, `duplicate partial id '${partial.id}'`));
    partialNodes.set(partial.id, { ...partial, path: filePath });
  };

  const normalizeRunRefs = (task) => Array.isArray(task.runRefs) ? task.runRefs : [];
  const taskKey = (versionId, taskId) => `${versionId}:${taskId}`;
  const runNodeKey = (runId, nodeId) => `${runId}:${nodeId}`;

  for (const tgDir of listDirs(join(projectDir, 'task-groups'))) {
    const tgIndex = join(tgDir, 'index.md');
    if (!fileExists(tgIndex)) { errors.push(withPath(tgDir, t.missingIndexMd)); continue; }
    const tg = parseMarkdownFile(tgIndex);
    checkFields(tg, ['taskOpsVersion', 'entityType', 'id', 'objective', 'createdAt'], tgIndex, errors, language);
    if (tg.entityType !== 'taskGroup') errors.push(withPath(tgIndex, t.entityTypeMustBe('taskGroup')));
    if (tg.id !== basename(tgDir)) errors.push(withPath(tgIndex, t.idMustMatchFolderName(basename(tgDir))));
    taskGroups.set(tg.id, { ...tg, path: tgDir, versions: [] });

    for (const versionDir of listDirs(join(tgDir, 'versions'))) {
      const versionIndex = join(versionDir, 'index.md');
      if (!fileExists(versionIndex)) { errors.push(withPath(versionDir, t.missingIndexMd)); continue; }
      const v = parseMarkdownFile(versionIndex);
      checkFields(v, ['taskOpsVersion', 'entityType', 'id', 'taskGroupId', 'version', 'summary', 'createdAt'], versionIndex, errors, language);
      if (v.entityType !== 'taskGroupVersion') errors.push(withPath(versionIndex, t.entityTypeMustBe('taskGroupVersion')));
      if (v.id !== basename(versionDir)) errors.push(withPath(versionIndex, t.idMustMatchFolderName(basename(versionDir))));
      if (v.taskGroupId !== tg.id) errors.push(withPath(versionIndex, t.taskGroupIdMustBe(tg.id)));
      const versionRecord = { ...v, path: versionDir, tasks: [], eows: [] };
      versions.set(v.id, versionRecord);
      taskGroups.get(tg.id).versions.push(versionRecord);

      const tasksDir = join(versionDir, 'tasks');
      if (!fileExists(tasksDir)) errors.push(withPath(versionDir, t.missingTasksDirectory));
      for (const taskPath of listMd(tasksDir)) {
        if (basename(taskPath) === 'index.md') continue;
        const task = parseMarkdownFile(taskPath);
        checkFields(task, ['taskOpsVersion', 'entityType', 'id', 'taskGroupId', 'taskGroupVersionId', 'title', 'objective', 'responsibility', 'completionCriteria', 'order', 'createdAt', 'status'], taskPath, errors, language);
        if (task.entityType !== 'task') errors.push(withPath(taskPath, t.entityTypeMustBe('task')));
        if (task.id !== basename(taskPath, '.md')) errors.push(withPath(taskPath, t.idMustMatchFileName(basename(taskPath, '.md'))));
        if (task.taskGroupId !== tg.id) errors.push(withPath(taskPath, t.taskGroupIdMustBe(tg.id)));
        if (task.taskGroupVersionId !== v.id) errors.push(withPath(taskPath, t.taskGroupVersionIdMustBe(v.id)));
        if (!STATUS_VALUES.includes(task.status)) errors.push(withPath(taskPath, t.invalidStatus(task.status)));
        if (task.runReadiness && !RUN_READINESS_VALUES.includes(task.runReadiness)) errors.push(withPath(taskPath, t.invalidRunReadiness(task.runReadiness)));
        if (task.understandingLevel && !UNDERSTANDING_LEVEL_VALUES.includes(task.understandingLevel)) errors.push(withPath(taskPath, t.invalidUnderstandingLevel(task.understandingLevel)));
        validateTaskUncertaintyFields(task, taskPath, errors, t);
        if (task.acceptance != null) {
          if (!task.acceptance || typeof task.acceptance !== 'object' || Array.isArray(task.acceptance)) {
            warnings.push(withPath(taskPath, 'acceptance should be an object with expectedOutcome, requiredArtifacts, and requiredChecks'));
          } else if (task.acceptance.mode && !ACCEPTANCE_MODE_VALUES.includes(task.acceptance.mode)) {
            warnings.push(withPath(taskPath, `invalid acceptance.mode '${task.acceptance.mode}'`));
          } else {
            for (const key of ['semanticAssertions', 'assertions']) {
              if (task.acceptance[key] != null && (!task.acceptance[key] || typeof task.acceptance[key] !== 'object' || Array.isArray(task.acceptance[key]))) {
                warnings.push(withPath(taskPath, `acceptance.${key} should be an object with deterministic semantic assertion fields`));
              }
            }
          }
        }
        const readinessConsistency = classifyTaskReadiness(task);
        for (const issue of readinessConsistency.consistencyIssues || []) {
          warnings.push(withPath(taskPath, `readiness consistency: ${issue.message}`));
        }
        const key = taskKey(v.id, task.id);
        if (tasks.has(key)) errors.push(withPath(taskPath, t.duplicateTaskKey(key)));
        const taskRecord = { ...task, path: taskPath };
        tasks.set(key, taskRecord);
        versionRecord.tasks.push(taskRecord);
      }

      for (const eowPath of listMd(join(versionDir, 'eow'))) {
        const eow = parseMarkdownFile(eowPath);
        checkFields(eow, ['taskOpsVersion', 'entityType', 'id', 'graphType', 'attachedToType', 'attachedToId', 'reason', 'declaredBy', 'declaredAt', 'createdAt', 'status'], eowPath, errors, language);
        if (eow.entityType !== 'eow') errors.push(withPath(eowPath, t.entityTypeMustBe('eow')));
        if (eow.id !== basename(eowPath, '.md')) errors.push(withPath(eowPath, t.idMustMatchFileName(basename(eowPath, '.md'))));
        if (!STATUS_VALUES.includes(eow.status)) errors.push(withPath(eowPath, t.invalidStatus(eow.status)));
        if (!EOW_GRAPH_TYPES.includes(eow.graphType)) errors.push(withPath(eowPath, t.invalidEowGraphType(eow.graphType)));
        if (!EOW_ATTACHED_TO_TYPES.includes(eow.attachedToType)) errors.push(withPath(eowPath, t.invalidEowAttachedToType(eow.attachedToType)));
        if (eow.graphType !== 'task') errors.push(withPath(eowPath, t.invalidEowGraphType(eow.graphType)));
        if (eow.attachedToType !== 'task') errors.push(withPath(eowPath, t.invalidEowAttachedToType(eow.attachedToType)));
        if (eow.taskGroupVersionId && eow.taskGroupVersionId !== v.id) errors.push(withPath(eowPath, t.taskGroupVersionIdMustBe(v.id)));
        const attachedKey = taskKey(v.id, eow.attachedToId);
        if (!tasks.has(attachedKey)) errors.push(withPath(eowPath, t.eowAttachedTaskNotFound(eow.attachedToId)));
        const eowRecord = { ...eow, path: eowPath, taskGroupId: tg.id, taskGroupVersionId: v.id };
        addEow(eowRecord, eowPath);
        versionRecord.eows.push(eowRecord);
        if (!taskEowsByTaskKey.has(attachedKey)) taskEowsByTaskKey.set(attachedKey, []);
        taskEowsByTaskKey.get(attachedKey).push(eowRecord);
      }

      for (const partialPath of listMd(join(versionDir, 'partials'))) {
        const partial = parseMarkdownFile(partialPath);
        checkFields(partial, ['taskOpsVersion', 'entityType', 'id', 'graphType', 'attachedToType', 'attachedToId', 'reason', 'declaredBy', 'declaredAt', 'createdAt', 'status', 'completedSummary', 'incompleteSummary', 'followUpNeeded', 'supersededBy', 'budget'], partialPath, errors, language);
        if (partial.entityType !== 'partial') errors.push(withPath(partialPath, t.entityTypeMustBe('partial')));
        if (partial.id !== basename(partialPath, '.md')) errors.push(withPath(partialPath, t.idMustMatchFileName(basename(partialPath, '.md'))));
        if (!STATUS_VALUES.includes(partial.status)) errors.push(withPath(partialPath, t.invalidStatus(partial.status)));
        if (!EOW_GRAPH_TYPES.includes(partial.graphType)) errors.push(withPath(partialPath, t.invalidEowGraphType(partial.graphType)));
        if (!EOW_ATTACHED_TO_TYPES.includes(partial.attachedToType)) errors.push(withPath(partialPath, t.invalidEowAttachedToType(partial.attachedToType)));
        if (partial.graphType !== 'task') errors.push(withPath(partialPath, t.invalidEowGraphType(partial.graphType)));
        if (partial.attachedToType !== 'task') errors.push(withPath(partialPath, t.invalidEowAttachedToType(partial.attachedToType)));
        if (partial.taskGroupVersionId && partial.taskGroupVersionId !== v.id) errors.push(withPath(partialPath, t.taskGroupVersionIdMustBe(v.id)));
        const attachedKey = taskKey(v.id, partial.attachedToId);
        if (!tasks.has(attachedKey)) errors.push(withPath(partialPath, t.eowAttachedTaskNotFound(partial.attachedToId)));
        addPartial({ ...partial, path: partialPath, taskGroupId: tg.id, taskGroupVersionId: v.id }, partialPath);
      }
    }
  }

  if (!taskGroups.has(project.activeRootTaskGroupId)) errors.push(withPath(projectIndex, t.activeRootTaskGroupNotFound(project.activeRootTaskGroupId)));

  for (const [id, tg] of taskGroups) {
    const activeVersions = tg.versions.filter((v) => v.selected === true || v.id === tg.activeVersionId);
    if (tg.activeVersionId && !versions.has(tg.activeVersionId)) errors.push(withPath(`${tg.path}/index.md`, t.activeVersionNotFound(tg.activeVersionId)));
    if (activeVersions.length > 1) warnings.push(withPath(`${tg.path}/index.md`, t.multipleSelectedVersionsDetected));
  }

  for (const snapshotPath of listMd(join(projectDir, 'snapshots'))) {
    const snap = parseMarkdownFile(snapshotPath);
    checkFields(snap, ['taskOpsVersion', 'entityType', 'id', 'rootTaskGroupId', 'createdAt'], snapshotPath, errors, language);
    if (snap.entityType !== 'versionSnapshot') errors.push(withPath(snapshotPath, t.entityTypeMustBe('versionSnapshot')));
    if (!Array.isArray(snap.selectedVersions)) errors.push(withPath(snapshotPath, t.selectedVersionsMustBeList));
    if (snap.id !== basename(snapshotPath, '.md')) errors.push(withPath(snapshotPath, t.idMustMatchFileName(basename(snapshotPath, '.md'))));
    if (!taskGroups.has(snap.rootTaskGroupId)) errors.push(withPath(snapshotPath, t.rootTaskGroupNotFound(snap.rootTaskGroupId)));
    for (const pair of snap.selectedVersions || []) {
      if (!pair || typeof pair !== 'object') { errors.push(withPath(snapshotPath, t.invalidSelectedVersionsEntry)); continue; }
      if (!taskGroups.has(pair.taskGroupId)) errors.push(withPath(snapshotPath, t.selectedTaskGroupNotFound(pair.taskGroupId)));
      if (!versions.has(pair.versionId)) errors.push(withPath(snapshotPath, t.selectedVersionNotFound(pair.versionId)));
    }
    snapshots.set(snap.id, { ...snap, path: snapshotPath });
  }
  if (project.activeSnapshotId && !snapshots.has(project.activeSnapshotId)) errors.push(withPath(projectIndex, t.activeSnapshotNotFound(project.activeSnapshotId)));

  const parseRunFolder = (runDir, { legacy = false } = {}) => {
    const runIndex = join(runDir, 'index.md');
    if (!fileExists(runIndex)) { errors.push(withPath(runDir, t.missingIndexMd)); return; }
    const run = parseMarkdownFile(runIndex);
    checkFields(run, ['taskOpsVersion', 'entityType', 'id', 'createdAt', 'status'], runIndex, errors, language);
    if (run.entityType !== 'run') errors.push(withPath(runIndex, t.entityTypeMustBe('run')));
    if (!legacy && run.id !== basename(runDir)) errors.push(withPath(runIndex, t.idMustMatchFolderName(basename(runDir))));
    const ownerId = run.workId ?? run.projectId;
    if (!ownerId) errors.push(withPath(runIndex, t.missingRequiredField('workId')));
    else if (ownerId !== project.id) errors.push(withPath(runIndex, t.projectIdMustBe(project.id)));
    if (!STATUS_VALUES.includes(run.status)) errors.push(withPath(runIndex, t.invalidStatus(run.status)));

    const runRecord = { ...run, path: runDir, nodes: [], edges: [], eows: [], partials: [], legacy };
    if (runs.has(run.id)) errors.push(withPath(runIndex, `duplicate run id '${run.id}'`));
    runs.set(run.id, runRecord);
    const graphNodes = new Map();

    for (const nodePath of listMd(join(runDir, 'nodes'))) {
      const node = parseMarkdownFile(nodePath);
      if (node.entityType === 'eow') {
        checkFields(node, ['taskOpsVersion', 'entityType', 'id', 'runId', 'graphType', 'attachedToType', 'attachedToId', 'reason', 'declaredBy', 'declaredAt', 'createdAt', 'status'], nodePath, errors, language);
        if (node.id !== basename(nodePath, '.md')) errors.push(withPath(nodePath, t.idMustMatchFileName(basename(nodePath, '.md'))));
        if (node.runId !== run.id) errors.push(withPath(nodePath, t.runIdMustBe(run.id)));
        if (!STATUS_VALUES.includes(node.status)) errors.push(withPath(nodePath, t.invalidStatus(node.status)));
        if (node.graphType !== 'run') errors.push(withPath(nodePath, t.invalidEowGraphType(node.graphType)));
        if (node.attachedToType !== 'runNode') errors.push(withPath(nodePath, t.invalidEowAttachedToType(node.attachedToType)));
        const eowRecord = { ...node, path: nodePath };
        addEow(eowRecord, nodePath);
        runRecord.eows.push(eowRecord);
        graphNodes.set(node.id, eowRecord);
        const attachedKey = runNodeKey(run.id, node.attachedToId);
        if (!runEowsByRunNodeKey.has(attachedKey)) runEowsByRunNodeKey.set(attachedKey, []);
        runEowsByRunNodeKey.get(attachedKey).push(eowRecord);
        continue;
      }

      checkFields(node, ['taskOpsVersion', 'entityType', 'id', 'runId', 'type', 'title', 'status', 'createdAt'], nodePath, errors, language);
      if (node.entityType !== 'runNode') errors.push(withPath(nodePath, t.entityTypeMustBe('runNode')));
      if (node.id !== basename(nodePath, '.md')) errors.push(withPath(nodePath, t.idMustMatchFileName(basename(nodePath, '.md'))));
      if (node.runId !== run.id) errors.push(withPath(nodePath, t.runIdMustBe(run.id)));
      if (!STATUS_VALUES.includes(node.status)) errors.push(withPath(nodePath, t.invalidStatus(node.status)));
      if (node.sourceTaskGroupVersionId && !versions.has(node.sourceTaskGroupVersionId)) errors.push(withPath(nodePath, t.sourceTaskGroupVersionNotFound(node.sourceTaskGroupVersionId)));
      if (node.sourceTaskId) {
        const found = [...tasks.values()].some((task) => task.id === node.sourceTaskId && (!node.sourceTaskGroupVersionId || task.taskGroupVersionId === node.sourceTaskGroupVersionId));
        if (!found) errors.push(withPath(nodePath, t.sourceTaskNotFound(node.sourceTaskId)));
      }
      if (node.status === 'waiting' || node.type === 'delegate') {
        for (const field of ['delegateeType', 'delegateeRef', 'expectedOutput', 'requestedAt']) {
          if (!(field in node) || node[field] === '' || node[field] == null) warnings.push(withPath(nodePath, t.delegateMissingField(field)));
        }
      }
      if (node.type === 'review') {
        if (!node.reviewReport || typeof node.reviewReport !== 'object' || Array.isArray(node.reviewReport)) {
          warnings.push(withPath(nodePath, 'review node missing reviewReport'));
        } else if (!REVIEW_DECISION_VALUES.includes(node.reviewReport.decision)) {
          errors.push(withPath(nodePath, `invalid reviewReport.decision '${node.reviewReport.decision}'`));
        }
        if (!node.reviewsRunNodeId) warnings.push(withPath(nodePath, 'review node missing reviewsRunNodeId'));
      }
      const nodeRecord = { ...node, path: nodePath };
      const key = runNodeKey(run.id, node.id);
      if (runNodes.has(key)) errors.push(withPath(nodePath, `duplicate run node key '${key}'`));
      runNodes.set(key, nodeRecord);
      runRecord.nodes.push(nodeRecord);
      graphNodes.set(node.id, nodeRecord);
    }

    for (const edgePath of listMd(join(runDir, 'edges'))) {
      const edge = parseMarkdownFile(edgePath);
      checkFields(edge, ['taskOpsVersion', 'entityType', 'id', 'runId', 'fromRunNodeId', 'toRunNodeId', 'edgeType', 'createdAt'], edgePath, errors, language);
      if (edge.entityType !== 'runEdge') errors.push(withPath(edgePath, t.entityTypeMustBe('runEdge')));
      if (edge.id !== basename(edgePath, '.md')) errors.push(withPath(edgePath, t.idMustMatchFileName(basename(edgePath, '.md'))));
      if (edge.runId !== run.id) errors.push(withPath(edgePath, t.runIdMustBe(run.id)));
      if (!graphNodes.has(edge.fromRunNodeId)) errors.push(withPath(edgePath, t.fromRunNodeNotFound(edge.fromRunNodeId)));
      if (!graphNodes.has(edge.toRunNodeId)) errors.push(withPath(edgePath, t.toRunNodeNotFound(edge.toRunNodeId)));
      const edgeRecord = { ...edge, path: edgePath };
      const key = `${run.id}:${edge.id}`;
      if (runEdges.has(key)) errors.push(withPath(edgePath, `duplicate run edge key '${key}'`));
      runEdges.set(key, edgeRecord);
      runRecord.edges.push(edgeRecord);
    }

    for (const eow of runRecord.eows) {
      if (!graphNodes.has(eow.attachedToId) || graphNodes.get(eow.attachedToId).entityType !== 'runNode') {
        errors.push(withPath(eow.path, t.eowAttachedRunNodeNotFound(eow.attachedToId)));
      }
    }

    for (const partialPath of listMd(join(runDir, 'partials'))) {
      const partial = parseMarkdownFile(partialPath);
      checkFields(partial, ['taskOpsVersion', 'entityType', 'id', 'runId', 'graphType', 'attachedToType', 'attachedToId', 'reason', 'declaredBy', 'declaredAt', 'createdAt', 'status', 'completedSummary', 'incompleteSummary', 'followUpNeeded', 'supersededBy', 'budget'], partialPath, errors, language);
      if (partial.entityType !== 'partial') errors.push(withPath(partialPath, t.entityTypeMustBe('partial')));
      if (partial.id !== basename(partialPath, '.md')) errors.push(withPath(partialPath, t.idMustMatchFileName(basename(partialPath, '.md'))));
      if (partial.runId !== run.id) errors.push(withPath(partialPath, t.runIdMustBe(run.id)));
      if (!STATUS_VALUES.includes(partial.status)) errors.push(withPath(partialPath, t.invalidStatus(partial.status)));
      if (partial.graphType !== 'run') errors.push(withPath(partialPath, t.invalidEowGraphType(partial.graphType)));
      if (partial.attachedToType !== 'runNode') errors.push(withPath(partialPath, t.invalidEowAttachedToType(partial.attachedToType)));
      if (!graphNodes.has(partial.attachedToId) || graphNodes.get(partial.attachedToId).entityType !== 'runNode') {
        errors.push(withPath(partialPath, t.eowAttachedRunNodeNotFound(partial.attachedToId)));
      }
      const partialRecord = { ...partial, path: partialPath };
      addPartial(partialRecord, partialPath);
      runRecord.partials.push(partialRecord);
    }
  };

  const runsDir = join(projectDir, 'runs');
  for (const runDir of listDirs(runsDir)) parseRunFolder(runDir);
  const legacyRunDir = join(projectDir, 'run');
  if (fileExists(join(legacyRunDir, 'index.md'))) {
    parseRunFolder(legacyRunDir, { legacy: true });
    warnings.push(withPath(legacyRunDir, 'legacy run/ layout is supported; prefer runs/<run-id>/ for independent run graphs'));
  }
  if (runs.size === 0) warnings.push(withPath(projectDir, t.missingRunIndex));

  for (const version of versions.values()) {
    for (const task of version.tasks) {
      if (task.childTaskGroupId && !taskGroups.has(task.childTaskGroupId)) errors.push(withPath(task.path, t.childTaskGroupNotFound(task.childTaskGroupId)));
    }
  }

  for (const task of tasks.values()) {
    for (const ref of normalizeRunRefs(task)) {
      if (!ref || typeof ref !== 'object') {
        warnings.push(withPath(task.path, 'runRefs entry must be an object'));
        continue;
      }
      if (!ref.runId || !ref.runNodeId) {
        warnings.push(withPath(task.path, 'runRefs entry must include runId and runNodeId'));
        continue;
      }
      const node = runNodes.get(runNodeKey(ref.runId, ref.runNodeId));
      if (!node) {
        errors.push(withPath(task.path, t.runRefTargetNotFound(ref.runId, ref.runNodeId)));
        continue;
      }
      if (node.sourceTaskId !== task.id || (node.sourceTaskGroupVersionId && node.sourceTaskGroupVersionId !== task.taskGroupVersionId)) {
        errors.push(withPath(task.path, t.runRefSourceMismatch(ref.runId, ref.runNodeId, task.id)));
      }
    }
  }

  for (const node of runNodes.values()) {
    if (!node.sourceTaskId) continue;
    if (node.type === 'review') continue;
    const candidates = [...tasks.values()].filter((task) => task.id === node.sourceTaskId && (!node.sourceTaskGroupVersionId || task.taskGroupVersionId === node.sourceTaskGroupVersionId));
    for (const task of candidates) {
      const hasRef = normalizeRunRefs(task).some((ref) => ref && ref.runId === node.runId && ref.runNodeId === node.id);
      if (!hasRef) warnings.push(withPath(node.path, t.missingTaskBackReference(task.id, node.runId, node.id)));
    }
  }

  let terminalTaskCount = 0;
  let terminalTaskEowCount = 0;
  let policyApprovedTerminalTaskEowCount = 0;
  let manualAttestedTerminalTaskEowCount = 0;
  const activeSnapshot = project.activeSnapshotId ? snapshots.get(project.activeSnapshotId) : null;
  const selectedPairs = activeSnapshot?.selectedVersions || [];
  const selectedTaskGroupIds = new Set(selectedPairs.map((pair) => pair.taskGroupId));
  for (const pair of selectedPairs) {
    const version = versions.get(pair.versionId);
    if (!version) continue;
    for (const task of version.tasks) {
      const branchContinues = task.childTaskGroupId && selectedTaskGroupIds.has(task.childTaskGroupId);
      if (branchContinues) continue;
      terminalTaskCount += 1;
      const terminalEows = taskEowsByTaskKey.get(taskKey(version.id, task.id)) || [];
      const hasEow = terminalEows.length > 0;
      if (hasEow) terminalTaskEowCount += 1;
      else warnings.push(withPath(task.path, t.terminalTaskMissingEow(task.id)));
      if (terminalEows.some(isPolicyApprovedEow)) policyApprovedTerminalTaskEowCount += 1;
      if (terminalEows.some(isManualAttestedEow)) manualAttestedTerminalTaskEowCount += 1;
    }
  }

  let runTerminalNodeCount = 0;
  let runTerminalEowCount = 0;
  let waitingDelegationCount = 0;
  for (const run of runs.values()) {
    const outgoing = new Set(run.edges.map((edge) => edge.fromRunNodeId));
    for (const node of run.nodes) {
      if (node.status === 'waiting' || (node.type === 'delegate' && !['done', 'cancelled'].includes(node.status))) waitingDelegationCount += 1;
      if (outgoing.has(node.id) || node.status === 'cancelled') continue;
      runTerminalNodeCount += 1;
      const terminalEows = runEowsByRunNodeKey.get(runNodeKey(run.id, node.id)) || [];
      const hasEow = terminalEows.length > 0;
      if (hasEow) runTerminalEowCount += 1;
      else if (node.status === 'done') warnings.push(withPath(node.path, t.runTerminalMissingEow(run.id, node.id)));
    }
  }
  let runEowClosureCount = 0;
  let policyApprovedRunEowClosureCount = 0;
  let manualAttestedRunEowClosureCount = 0;
  for (const eow of eowNodes.values()) {
    if (eow.graphType !== 'run' || eow.attachedToType !== 'runNode') continue;
    const node = runNodes.get(runNodeKey(eow.runId, eow.attachedToId));
    if (node?.type === 'review') continue;
    runEowClosureCount += 1;
    if (isPolicyApprovedEow(eow)) policyApprovedRunEowClosureCount += 1;
    if (isManualAttestedEow(eow)) manualAttestedRunEowClosureCount += 1;
  }
  const partialTaskCount = [...partialNodes.values()].filter((partial) => partial.graphType === 'task' && partial.attachedToType === 'task').length;
  const partialRunCount = [...partialNodes.values()].filter((partial) => partial.graphType === 'run' && partial.attachedToType === 'runNode').length;
  const partialCount = partialTaskCount + partialRunCount;
  const openBlockerCount = [...tasks.values()].filter((task) => task.status === 'blocked').length + [...runNodes.values()].filter((node) => node.status === 'blocked').length;
  const structuralComplete = terminalTaskCount > 0 && terminalTaskCount === terminalTaskEowCount && runTerminalNodeCount === runTerminalEowCount && waitingDelegationCount === 0 && openBlockerCount === 0;
  const policyApprovedComplete = structuralComplete
    && terminalTaskCount === policyApprovedTerminalTaskEowCount
    && runEowClosureCount === policyApprovedRunEowClosureCount;
  const manualAttestedComplete = structuralComplete
    && terminalTaskCount === manualAttestedTerminalTaskEowCount
    && runEowClosureCount === manualAttestedRunEowClosureCount;
  const hasManualAttestation = manualAttestedTerminalTaskEowCount > 0 || manualAttestedRunEowClosureCount > 0;
  const closureState = policyApprovedComplete
    ? 'policy_approved_complete'
    : (manualAttestedComplete ? 'manual_attested_complete' : (structuralComplete ? 'structurally_complete_unapproved' : 'open'));
  if (structuralComplete && project.status === 'active') {
    warnings.push(withPath(projectIndex, `work status is active while graph is structurally complete (${closureState})`));
  }
  if (structuralComplete && hasManualAttestation && !policyApprovedComplete) {
    warnings.push(withPath(projectIndex, 'manual_verified/manual_close EoW attests structural closure but is not policy-approved review closure'));
  }

  const closure = {
    terminalTaskCount,
    terminalTaskEowCount,
    openTerminalTaskCount: Math.max(0, terminalTaskCount - terminalTaskEowCount),
    policyApprovedTerminalTaskEowCount,
    manualAttestedTerminalTaskEowCount,
    runTerminalNodeCount,
    runTerminalEowCount,
    openRunTerminalNodeCount: Math.max(0, runTerminalNodeCount - runTerminalEowCount),
    runEowClosureCount,
    policyApprovedRunEowClosureCount,
    manualAttestedRunEowClosureCount,
    partialTaskCount,
    partialRunCount,
    partialCount,
    waitingDelegationCount,
    openBlockerCount,
    structuralComplete,
    policyApprovedComplete,
    manualAttestedComplete,
    closureState,
    complete: structuralComplete,
  };

  return { projectDir, project, taskGroups, versions, tasks, snapshots, runs, runNodes, runEdges, eowNodes, partialNodes, errors, warnings, language, closure };
}

function isPolicyApprovedEow(eow) {
  return Boolean(
    eow
    && ['approved_result', 'preserved_upstream_after_restart'].includes(eow.reason)
    && eow.approvedByReviewNodeId
    && eow.approvedReviewReportHash
    && eow.reviewedAcceptanceHash
    && eow.reviewedResultHash
    && POLICY_APPROVED_MODES.has(String(eow.approvedReviewMode || '').trim())
  );
}

function isManualAttestedEow(eow) {
  return Boolean(eow && ['manual_verified', 'manual_close'].includes(eow.reason));
}

export function classifyTaskReadiness(task) {
  if (!task || typeof task !== 'object') throw new Error('Task is required');
  const legacy = classifyTaskReadinessV05(task);
  if (!hasUncertaintyReadinessFields(task)) return legacy;

  const semanticReadiness = inferUncertaintyReadiness(task);
  const consistencyIssues = uncertaintyReadinessConsistencyIssues(task, semanticReadiness);
  return {
    ...semanticReadiness,
    consistencyIssues,
    legacyComparison: readinessComparisonFromLegacy(legacy),
    compatibilityPolicy: 'uncertainty readiness is primary when uncertaintyState/confidenceScore/knownList is present; legacy v0.5 readiness is retained for comparison',
  };
}

export function classifyTaskReadinessV05(task) {
  if (!task || typeof task !== 'object') throw new Error('Task is required');
  const semanticReadiness = inferTaskReadiness(task);
  const consistencyIssues = explicitReadinessConsistencyIssues(task, semanticReadiness);
  if (task.runReadiness && RUN_READINESS_VALUES.includes(task.runReadiness)) {
    const downgrade = strongestReadinessDowngrade(task.runReadiness, consistencyIssues);
    if (downgrade) {
      return {
        taskId: task.id,
        runReadiness: downgrade.runReadiness,
        originalRunReadiness: task.runReadiness,
        source: 'explicit_with_consistency_downgrade',
        reason: downgrade.reason,
        nextAction: nextActionForRunReadiness(downgrade.runReadiness),
        consistencyIssues,
        compatibilityPolicy: 'semantic contradictions downgrade explicit runnable; legacy/manual acceptance gaps warn unless guarded or runner-managed',
      };
    }
    return {
      taskId: task.id,
      runReadiness: task.runReadiness,
      source: 'explicit',
      reason: task.runReadinessReason || 'Task declares runReadiness explicitly.',
      nextAction: nextActionForRunReadiness(task.runReadiness),
      consistencyIssues,
      compatibilityPolicy: 'semantic contradictions downgrade explicit runnable; legacy/manual acceptance gaps warn unless guarded or runner-managed',
    };
  }

  return {
    ...semanticReadiness,
    consistencyIssues,
    compatibilityPolicy: 'semantic contradictions downgrade explicit runnable; legacy/manual acceptance gaps warn unless guarded or runner-managed',
  };
}

function hasUncertaintyReadinessFields(task) {
  return TASK_UNCERTAINTY_SCALAR_FIELDS.some((field) => hasOwn(task, field))
    || TASK_UNCERTAINTY_ARRAY_FIELDS.some((field) => hasOwn(task, field));
}

function readinessComparisonFromLegacy(legacy) {
  return {
    runReadiness: legacy.runReadiness,
    source: legacy.source,
    reason: legacy.reason,
    nextAction: legacy.nextAction,
    consistencyIssues: legacy.consistencyIssues || [],
  };
}

function inferTaskReadiness(task) {
  const unknowns = Array.isArray(task.unknowns) ? task.unknowns : (task.unknowns ? [task.unknowns] : []);
  const understanding = task.understandingLevel ? String(task.understandingLevel) : '';
  const explorationNeeded = task.explorationNeeded === true || task.needsExploration === true;
  if (task.status === 'blocked') {
    return { taskId: task.id, runReadiness: 'blocked', source: 'heuristic', reason: 'Task status is blocked.', nextAction: nextActionForRunReadiness('blocked') };
  }
  if (explorationNeeded || understanding === 'unknown' || unknowns.length > 0) {
    return {
      taskId: task.id,
      runReadiness: 'needs_exploration',
      source: 'heuristic',
      reason: task.nextLearningGoal || 'The task has unknowns or insufficient understanding; run an exploratory/discovery pass before decomposing.',
      nextAction: nextActionForRunReadiness('needs_exploration'),
    };
  }
  if (task.childTaskGroupId) {
    return { taskId: task.id, runReadiness: 'needs_decomposition', source: 'heuristic', reason: `Task points at child task group '${task.childTaskGroupId}'.`, nextAction: nextActionForRunReadiness('needs_decomposition') };
  }
  const hasObjective = typeof task.objective === 'string' && task.objective.trim().length > 0;
  const hasResponsibility = typeof task.responsibility === 'string' && task.responsibility.trim().length > 0;
  const hasCompletion = typeof task.completionCriteria === 'string' && task.completionCriteria.trim().length > 0;
  if (hasObjective && hasResponsibility && hasCompletion && understanding !== 'partial') {
    return { taskId: task.id, runReadiness: 'runnable', source: 'heuristic', reason: 'Objective, responsibility, and completionCriteria are present with no declared unknowns.', nextAction: nextActionForRunReadiness('runnable') };
  }
  return {
    taskId: task.id,
    runReadiness: 'needs_decomposition',
    source: 'heuristic',
    reason: 'The task is not blocked or unknown, but it lacks enough single-responsibility run criteria.',
    nextAction: nextActionForRunReadiness('needs_decomposition'),
  };
}

export function inferUncertaintyReadiness(task) {
  const state = String(task.uncertaintyState || '').trim();
  if (task.status === 'blocked' || task.runReadiness === 'blocked') {
    return { taskId: task.id, runReadiness: 'blocked', source: 'uncertainty', reason: 'Blocked status/readiness remains orthogonal to uncertainty.', nextAction: nextActionForRunReadiness('blocked') };
  }
  if (state === 'unknown_unknown') {
    return {
      taskId: task.id,
      runReadiness: 'needs_exploration',
      source: 'uncertainty',
      reason: 'uncertaintyState unknown_unknown requires exploration before honest execution or decomposition.',
      nextAction: nextActionForRunReadiness('needs_exploration'),
    };
  }
  if (state === 'known_unknown') {
    if (isDecompositionReadyByUncertainty(task)) {
      return {
        taskId: task.id,
        runReadiness: 'needs_decomposition',
        source: 'uncertainty',
        reason: 'uncertaintyState known_unknown has enough structure to decompose before execution.',
        nextAction: nextActionForRunReadiness('needs_decomposition'),
      };
    }
    return {
      taskId: task.id,
      runReadiness: 'needs_exploration',
      source: 'uncertainty',
      reason: 'uncertaintyState known_unknown still needs exploration before decomposition is honest.',
      nextAction: nextActionForRunReadiness('needs_exploration'),
    };
  }
  if (state === 'known') {
    if (hasRunnableTaskContract(task)) {
      return {
        taskId: task.id,
        runReadiness: 'runnable',
        source: 'uncertainty',
        reason: 'uncertaintyState known and runnable task contract fields are present.',
        nextAction: nextActionForRunReadiness('runnable'),
      };
    }
    return {
      taskId: task.id,
      runReadiness: 'needs_decomposition',
      source: 'uncertainty',
      reason: 'uncertaintyState known, but objective/responsibility/completionCriteria are not complete enough for one run.',
      nextAction: nextActionForRunReadiness('needs_decomposition'),
    };
  }

  return {
    taskId: task.id,
    runReadiness: 'needs_exploration',
    source: 'uncertainty',
    reason: 'Uncertainty metadata is present but uncertaintyState is missing or invalid; explore before acting.',
    nextAction: nextActionForRunReadiness('needs_exploration'),
  };
}

export function informationGainConvergence(task, { window = 3, maxSurpriseScore = 0.2 } = {}) {
  const history = Array.isArray(task?.surpriseHistory) ? task.surpriseHistory : [];
  const normalizedWindow = Math.max(1, Math.floor(Number(window) || 3));
  const threshold = Number.isFinite(Number(maxSurpriseScore)) ? Number(maxSurpriseScore) : 0.2;
  if (history.length < normalizedWindow) {
    return {
      converged: false,
      window: normalizedWindow,
      maxSurpriseScore: threshold,
      observedCount: history.length,
      reason: `need ${normalizedWindow} surprise observations; found ${history.length}`,
    };
  }
  const recent = history.slice(-normalizedWindow);
  const highSurprise = recent.filter((entry) => Number(entry.surpriseScore) > threshold);
  const contradictedKnownIds = recent.flatMap((entry) => Array.isArray(entry.contradictedKnownIds) ? entry.contradictedKnownIds : []);
  const blockingNewUnknownIds = recent.flatMap((entry) => Array.isArray(entry.blockingNewUnknownIds)
    ? entry.blockingNewUnknownIds
    : (Array.isArray(entry.newUnknownIds) ? entry.newUnknownIds : []));
  const converged = highSurprise.length === 0 && contradictedKnownIds.length === 0 && blockingNewUnknownIds.length === 0;
  return {
    converged,
    window: normalizedWindow,
    maxSurpriseScore: threshold,
    observedCount: history.length,
    recentScores: recent.map((entry) => Number(entry.surpriseScore || 0)),
    contradictedKnownIds,
    blockingNewUnknownIds,
    reason: converged
      ? `${normalizedWindow} consecutive low-surprise observations`
      : 'recent surprise history still contains high surprise, contradicted known claims, or blocking unknowns',
  };
}

function hasRunnableTaskContract(task) {
  return nonEmptyString(task.objective)
    && nonEmptyString(task.responsibility)
    && nonEmptyString(task.completionCriteria);
}

function isDecompositionReadyByUncertainty(task) {
  if (task.runReadiness === 'needs_decomposition') return true;
  if (task.childTaskGroupId) return true;
  const confidence = Number(task.decompositionConfidence);
  return Number.isFinite(confidence) && confidence >= 0.7;
}

function uncertaintyReadinessConsistencyIssues(task, semanticReadiness) {
  const issues = [];
  const explicit = task.runReadiness && RUN_READINESS_VALUES.includes(task.runReadiness) ? task.runReadiness : null;
  if (explicit && explicit !== semanticReadiness.runReadiness) {
    issues.push({
      code: 'explicit_readiness_differs_from_uncertainty',
      severity: 'warning',
      downgradeTo: null,
      message: `explicit runReadiness '${explicit}' differs from uncertainty readiness '${semanticReadiness.runReadiness}'`,
    });
  }
  if (String(task.uncertaintyState || '').trim() === 'known' && !hasRunnableTaskContract(task)) {
    issues.push({
      code: 'known_uncertainty_missing_runnable_contract',
      severity: 'warning',
      downgradeTo: null,
      message: "uncertaintyState 'known' still lacks objective/responsibility/completionCriteria for a runnable contract",
    });
  }
  return issues;
}

function explicitReadinessConsistencyIssues(task, semanticReadiness) {
  if (task.runReadiness !== 'runnable') return [];
  const issues = [];
  const unknowns = Array.isArray(task.unknowns) ? task.unknowns : (task.unknowns ? [task.unknowns] : []);
  const understanding = task.understandingLevel ? String(task.understandingLevel) : '';
  const explorationNeeded = task.explorationNeeded === true || task.needsExploration === true;

  if (task.status === 'blocked') {
    issues.push({
      code: 'explicit_runnable_blocked_status',
      severity: 'error',
      downgradeTo: 'blocked',
      message: "explicit runReadiness 'runnable' conflicts with blocked task status",
    });
  }
  if (explorationNeeded) {
    issues.push({
      code: 'explicit_runnable_exploration_flag',
      severity: 'error',
      downgradeTo: 'needs_exploration',
      message: "explicit runReadiness 'runnable' conflicts with explorationNeeded/needsExploration",
    });
  }
  if (understanding === 'unknown') {
    issues.push({
      code: 'explicit_runnable_unknown_understanding',
      severity: 'error',
      downgradeTo: 'needs_exploration',
      message: "explicit runReadiness 'runnable' conflicts with understandingLevel 'unknown'",
    });
  } else if (understanding === 'partial') {
    issues.push({
      code: 'explicit_runnable_partial_understanding',
      severity: 'warning',
      downgradeTo: null,
      message: "explicit runReadiness 'runnable' has partial understanding; keep only with concrete scope or acceptance evidence",
    });
  }
  if (unknowns.length > 0) {
    issues.push({
      code: 'explicit_runnable_declared_unknowns',
      severity: 'error',
      downgradeTo: 'needs_exploration',
      message: "explicit runReadiness 'runnable' conflicts with declared unknowns",
    });
  }
  const lowConfidence = lowConfidenceFields(task);
  for (const field of lowConfidence) {
    issues.push({
      code: `explicit_runnable_low_${field}`,
      severity: 'error',
      downgradeTo: 'needs_exploration',
      message: `explicit runReadiness 'runnable' conflicts with low ${field}`,
    });
  }

  const acceptance = task.acceptance && typeof task.acceptance === 'object' && !Array.isArray(task.acceptance)
    ? task.acceptance
    : null;
  const acceptanceMode = String(acceptance?.mode || '').trim();
  if (acceptance && ['guarded', 'runner-managed'].includes(acceptanceMode)) {
    const missing = missingConcreteAcceptanceFields(acceptance);
    if (missing.length > 0) {
      issues.push({
        code: 'explicit_runnable_incomplete_guarded_acceptance',
        severity: 'error',
        downgradeTo: 'blocked',
        message: `explicit runReadiness 'runnable' with ${acceptanceMode} acceptance is missing concrete acceptance: ${missing.join(', ')}`,
      });
    }
  }

  if (semanticReadiness.runReadiness !== 'runnable' && issues.length === 0) {
    issues.push({
      code: 'explicit_runnable_semantic_mismatch',
      severity: 'error',
      downgradeTo: semanticReadiness.runReadiness,
      message: `explicit runReadiness 'runnable' conflicts with semantic readiness '${semanticReadiness.runReadiness}'`,
    });
  }

  return issues;
}

function missingConcreteAcceptanceFields(acceptance) {
  const missing = [];
  const hasExpectedOutcome = typeof acceptance.expectedOutcome === 'string' && acceptance.expectedOutcome.trim().length > 0;
  const requiredArtifacts = Array.isArray(acceptance.requiredArtifacts) ? acceptance.requiredArtifacts : (acceptance.requiredArtifacts ? [acceptance.requiredArtifacts] : []);
  const requiredChecks = Array.isArray(acceptance.requiredChecks) ? acceptance.requiredChecks : (acceptance.requiredChecks ? [acceptance.requiredChecks] : []);
  if (!hasExpectedOutcome) missing.push('expectedOutcome');
  if (requiredArtifacts.length === 0 && requiredChecks.length === 0) missing.push('requiredArtifacts or requiredChecks');
  return missing;
}

function lowConfidenceFields(task) {
  const fields = [];
  for (const field of ['executionConfidence', 'decompositionConfidence']) {
    if (!(field in task)) continue;
    if (isLowConfidence(task[field])) fields.push(field);
  }
  return fields;
}

function isLowConfidence(value) {
  if (typeof value === 'number') return value > 0 && value < 0.7;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  if (['low', 'weak', 'unsupported', 'uncertain'].includes(text)) return true;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 && numeric < 0.7;
}

function strongestReadinessDowngrade(originalRunReadiness, issues) {
  if (originalRunReadiness !== 'runnable') return null;
  const downgrades = issues.filter((issue) => issue.severity === 'error' && RUN_READINESS_VALUES.includes(issue.downgradeTo));
  if (downgrades.length === 0) return null;
  const precedence = ['blocked', 'needs_exploration', 'needs_decomposition'];
  for (const value of precedence) {
    const issue = downgrades.find((candidate) => candidate.downgradeTo === value);
    if (issue) return { runReadiness: value, reason: issue.message };
  }
  const first = downgrades[0];
  return { runReadiness: first.downgradeTo, reason: first.message };
}

function nextActionForRunReadiness(runReadiness) {
  if (runReadiness === 'runnable') return 'send_to_run_graph';
  if (runReadiness === 'needs_decomposition') return 'decompose_task_group';
  if (runReadiness === 'needs_exploration') return 'create_exploratory_run';
  if (runReadiness === 'blocked') return 'resolve_blocker';
  return 'review_task';
}

export function findTaskById(parsed, taskId) {
  const matches = [...parsed.tasks.values()].filter((task) => task.id === taskId);
  if (matches.length === 0) throw new Error(`Task not found: ${taskId}`);
  if (matches.length > 1) throw new Error(`Task id '${taskId}' is ambiguous across selected versions; use unique task ids or inspect with taskops show --json`);
  return matches[0];
}

export function summarizeProject(parsed) {
  const language = parsed.language || resolveLanguage(parsed.projectDir);
  const t = localeBundle(language).summary;
  const project = parsed.project;
  const taskGroups = [...parsed.taskGroups.values()];
  const versions = [...parsed.versions.values()];
  const tasks = [...parsed.tasks.values()];
  const snapshots = [...parsed.snapshots.values()];
  const runs = [...(parsed.runs?.values() || [])];
  const runNodes = [...parsed.runNodes.values()];
  const runEdges = [...parsed.runEdges.values()];
  const eowNodes = [...(parsed.eowNodes?.values() || [])];
  const partialNodes = [...(parsed.partialNodes?.values() || [])];
  const countsByStatus = STATUS_VALUES.map((status) => [status, tasks.filter((t) => t.status === status).length]);
  const countsByReadiness = RUN_READINESS_VALUES.map((value) => [value, tasks.filter((task) => classifyTaskReadiness(task).runReadiness === value).length]);
  const activeSnapshot = project.activeSnapshotId ? parsed.snapshots.get(project.activeSnapshotId) : null;
  const closure = parsed.closure || {};
  const lines = [
    `# ${project.title || project.id}`,
    '',
    `- ${SUMMARY_LABELS.projectId}: ${project.id}`,
    `- ${SUMMARY_LABELS.projectObjective}: ${project.objective || ''}`,
    `- ${SUMMARY_LABELS.projectStatus}: ${project.status || t.unknown}`,
    `- ${SUMMARY_LABELS.rootTaskGroup}: ${project.activeRootTaskGroupId || t.none}`,
    `- ${SUMMARY_LABELS.activeSnapshot}: ${project.activeSnapshotId || t.none}`,
    `- ${SUMMARY_LABELS.taskGroups}: ${taskGroups.length}`,
    `- ${SUMMARY_LABELS.taskGroupVersions}: ${versions.length}`,
    `- ${SUMMARY_LABELS.tasks}: ${tasks.length}`,
    `- ${SUMMARY_LABELS.snapshots}: ${snapshots.length}`,
    `- ${SUMMARY_LABELS.runs}: ${runs.length}`,
    `- ${SUMMARY_LABELS.runNodes}: ${runNodes.length}`,
    `- ${SUMMARY_LABELS.runEdges}: ${runEdges.length}`,
    `- ${SUMMARY_LABELS.eowNodes}: ${eowNodes.length}`,
    `- ${SUMMARY_LABELS.partialNodes}: ${partialNodes.length}`,
    `- ${SUMMARY_LABELS.taskEowCoverage}: ${closure.terminalTaskEowCount ?? 0}/${closure.terminalTaskCount ?? 0}`,
    `- ${SUMMARY_LABELS.structuralClosure}: ${closure.structuralComplete === true ? 'complete' : 'open'}`,
    `- ${SUMMARY_LABELS.policyApprovedClosure}: ${closure.policyApprovedComplete === true ? 'complete' : 'incomplete'} (tasks ${closure.policyApprovedTerminalTaskEowCount ?? 0}/${closure.terminalTaskCount ?? 0}, run closures ${closure.policyApprovedRunEowClosureCount ?? 0}/${closure.runEowClosureCount ?? 0})`,
    `- ${SUMMARY_LABELS.manualAttestedClosure}: ${closure.manualAttestedComplete === true ? 'complete' : 'incomplete'} (tasks ${closure.manualAttestedTerminalTaskEowCount ?? 0}/${closure.terminalTaskCount ?? 0}, run closures ${closure.manualAttestedRunEowClosureCount ?? 0}/${closure.runEowClosureCount ?? 0})`,
    `- ${SUMMARY_LABELS.closureState}: ${closure.closureState || (closure.complete === true ? 'structurally_complete' : 'open')}`,
    `- ${SUMMARY_LABELS.waitingDelegations}: ${closure.waitingDelegationCount ?? 0}`,
    `- ${SUMMARY_LABELS.openBlockers}: ${closure.openBlockerCount ?? 0}`,
    `- ${SUMMARY_LABELS.workCompletion}: ${closure.complete === true ? 'complete' : 'open'}`,
    `- ${SUMMARY_LABELS.partialNodes}: ${closure.partialCount ?? partialNodes.length}`,
    '',
    `## ${SUMMARY_LABELS.taskStatusCounts}`,
    ...countsByStatus.map(([status, count]) => `- ${status}: ${count}`),
    '',
    '## Run readiness counts',
    ...countsByReadiness.map(([value, count]) => `- ${value}: ${count}`),
    '',
    `## ${SUMMARY_LABELS.taskGroups}`,
  ];
  for (const tg of taskGroups.sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
    lines.push(`- ${tg.id} — ${t.objective}: ${tg.objective}`);
    for (const version of tg.versions.sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
      lines.push(`  - ${t.version} ${version.id}${version.selected === true ? ` [${t.selectedTag}]` : ''}: ${version.summary}`);
      for (const task of version.tasks.sort((a,b)=>(a.order??0)-(b.order??0))) {
        const readiness = classifyTaskReadiness(task).runReadiness;
        lines.push(`    - ${t.task} ${task.id} [${task.status}; ${readiness}]${task.childTaskGroupId ? ` -> ${task.childTaskGroupId}` : ''}: ${task.title}`);
      }
    }
  }
  lines.push('', `## ${SUMMARY_LABELS.selectedVersion}`);
  if (activeSnapshot) {
    for (const pair of activeSnapshot.selectedVersions || []) {
      lines.push(`- ${pair.taskGroupId} -> ${pair.versionId}`);
    }
  } else {
    lines.push(`- ${t.none}`);
  }
  lines.push('', `## ${SUMMARY_LABELS.runNodes}`);
  if (runNodes.length === 0) lines.push(`- ${t.noRunNodes}`);
  else {
    for (const node of runNodes.sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
      lines.push(`- ${t.node} ${node.runId}/${node.id} [${node.status}] type=${node.type}${node.sourceTaskId ? ` sourceTask=${node.sourceTaskId}` : ''}`);
    }
  }
  lines.push('', `## ${SUMMARY_LABELS.runEdges}`);
  if (runEdges.length === 0) lines.push(`- ${t.none}`);
  else {
    for (const edge of runEdges.sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
      lines.push(`- ${t.edge} ${edge.runId}/${edge.id}: ${edge.fromRunNodeId} -${edge.edgeType}-> ${edge.toRunNodeId}`);
    }
  }
  lines.push('', '## EoW nodes');
  if (eowNodes.length === 0) lines.push(`- ${t.none}`);
  else {
    for (const eow of eowNodes.sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
      const target = eow.runId ? `${eow.runId}/${eow.attachedToId}` : eow.attachedToId;
      lines.push(`- EoW ${eow.id} [${eow.graphType}] -> ${eow.attachedToType}:${target} (${eow.reason})`);
    }
  }
  lines.push('', '## Partial markers');
  if (partialNodes.length === 0) lines.push(`- ${t.none}`);
  else {
    for (const partial of partialNodes.sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
      const target = partial.runId ? `${partial.runId}/${partial.attachedToId}` : partial.attachedToId;
      lines.push(`- Partial ${partial.id} [${partial.graphType}] -> ${partial.attachedToType}:${target} (${partial.reason})`);
    }
  }
  if (parsed.errors.length) {
    lines.push('', `## ${SUMMARY_LABELS.errors}`);
    for (const error of parsed.errors) lines.push(`- ERROR: ${error}`);
  }
  if (parsed.warnings.length) {
    lines.push('', `## ${SUMMARY_LABELS.warnings}`);
    for (const warning of parsed.warnings) lines.push(`- WARN: ${warning}`);
  }
  return lines.join('\n') + '\n';
}

export function writeSummary(parsed, fileName = 'summary.md') {
  const outPath = join(parsed.projectDir, fileName);
  writeFileSync(outPath, summarizeProject(parsed), 'utf8');
  return outPath;
}

function isoNow() { return new Date().toISOString(); }

function fmScalar(value) {
  if (value == null) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function fmBlock(data) {
  const lines = ['---'];
  const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const emitArrayItem = (item, indent) => {
    if (Array.isArray(item)) {
      if (item.length === 0) {
        lines.push(`${indent}- []`);
        return;
      }
      lines.push(`${indent}-`);
      for (const nested of item) emitArrayItem(nested, `${indent}  `);
      return;
    }
    if (isObject(item)) {
      const entries = Object.entries(item);
      if (entries.length === 0) {
        lines.push(`${indent}- {}`);
        return;
      }
      const [firstK, firstV] = entries[0];
      if (Array.isArray(firstV)) {
        if (firstV.length === 0) lines.push(`${indent}- ${firstK}: []`);
        else {
          lines.push(`${indent}- ${firstK}:`);
          for (const nested of firstV) emitArrayItem(nested, `${indent}  `);
        }
      } else if (isObject(firstV)) {
        if (Object.keys(firstV).length === 0) lines.push(`${indent}- ${firstK}: {}`);
        else {
          lines.push(`${indent}- ${firstK}:`);
          for (const [k, v] of Object.entries(firstV)) emit(k, v, `${indent}  `);
        }
      } else {
        lines.push(`${indent}- ${firstK}: ${fmScalar(firstV)}`);
      }
      for (const [k, v] of entries.slice(1)) emit(k, v, `${indent}  `);
      return;
    }
    lines.push(`${indent}- ${fmScalar(item)}`);
  };
  const emit = (key, value, indent = '') => {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${indent}${key}: []`);
        return;
      }
      lines.push(`${indent}${key}:`);
      for (const item of value) {
        emitArrayItem(item, `${indent}  `);
      }
      return;
    }
    if (isObject(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        lines.push(`${indent}${key}: {}`);
        return;
      }
      lines.push(`${indent}${key}:`);
      for (const [k, v] of entries) emit(k, v, `${indent}  `);
      return;
    }
    lines.push(`${indent}${key}: ${fmScalar(value)}`);
  };
  for (const [k,v] of Object.entries(data)) emit(k,v);
  lines.push('---', '');
  return lines.join('\n');
}

export function ensureDir(path) { mkdirSync(path, { recursive: true }); }

function isDirectoryEmpty(path) {
  return readdirSync(path).filter((name) => name !== '.' && name !== '..').length === 0;
}

function runCommand(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(stderr || stdout || `${command} ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

export function runGit(args, { cwd } = {}) {
  return runCommand('git', args, { cwd });
}

function tryRunGit(args, { cwd } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function gitDirFor(path) {
  return join(path, '.git');
}

export function isGitRepo(path) {
  return existsSync(gitDirFor(path));
}

export function currentGitBranch(path) {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: path });
  return branch === 'HEAD' ? 'main' : branch;
}

export function syncConfigPath(vaultDir) {
  return join(resolve(vaultDir), TASKOPS_SYNC_DIR, TASKOPS_SYNC_CONFIG);
}

export function readSyncConfig(vaultDir) {
  const path = syncConfigPath(vaultDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeSyncConfig(vaultDir, config) {
  const dir = join(resolve(vaultDir), TASKOPS_SYNC_DIR);
  ensureDir(dir);
  const path = join(dir, TASKOPS_SYNC_CONFIG);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return path;
}

function ensureGitUserConfig(vaultDir) {
  const name = tryRunGit(['config', '--get', 'user.name'], { cwd: vaultDir }).stdout;
  const email = tryRunGit(['config', '--get', 'user.email'], { cwd: vaultDir }).stdout;
  if (!name || !email) {
    throw new Error(`Git user.name/user.email are required before TaskOps can sync automatically in ${vaultDir}`);
  }
}

function hasRemote(vaultDir, remote = 'origin') {
  return tryRunGit(['remote', 'get-url', remote], { cwd: vaultDir }).ok;
}

function ensureBranch(vaultDir, branch) {
  const result = tryRunGit(['symbolic-ref', '--short', 'HEAD'], { cwd: vaultDir });
  if (!result.ok || !result.stdout) {
    tryRunGit(['checkout', '-b', branch], { cwd: vaultDir });
    return;
  }
  if (result.stdout !== branch) runGit(['branch', '-M', branch], { cwd: vaultDir });
}

export function initVaultRepo(vaultDir, { repoUrl = null, branch = 'main', autoSync = true, language = 'en', debounceMs = 5000, commitMessage = 'TaskOps auto-sync', ignorePaths = [] } = {}) {
  const root = resolve(vaultDir);
  const resolvedLanguage = normalizeLanguage(language);
  ensureDir(root);

  if (!isGitRepo(root)) {
    if (repoUrl && isDirectoryEmpty(root)) {
      const parent = dirname(root);
      const name = basename(root);
      ensureDir(parent);
      runGit(['clone', '--branch', branch, repoUrl, name], { cwd: parent });
    } else {
      runGit(['init', '-b', branch], { cwd: root });
      if (!isGitRepo(root)) {
        runGit(['init'], { cwd: root });
        ensureBranch(root, branch);
      }
    }
  }

  ensureBranch(root, branch);

  if (repoUrl) {
    if (hasRemote(root, 'origin')) {
      const existing = runGit(['remote', 'get-url', 'origin'], { cwd: root });
      if (existing !== repoUrl) throw new Error(`Origin already points to ${existing}; expected ${repoUrl}`);
    } else {
      runGit(['remote', 'add', 'origin', repoUrl], { cwd: root });
    }
  }

  const configPath = writeSyncConfig(root, {
    version: 1,
    enabled: autoSync,
    language: resolvedLanguage,
    repoUrl,
    branch,
    debounceMs,
    commitMessage,
    ignorePaths: ['.git/', '.obsidian/workspace', '.obsidian/workspace-mobile', ...ignorePaths],
  });

  return { vaultDir: root, configPath, branch, repoUrl };
}

export function gitStatus(vaultDir, { branch = null } = {}) {
  const root = resolve(vaultDir);
  if (!isGitRepo(root)) throw new Error(`Not a git repo: ${root}`);
  const resolvedBranch = branch || currentGitBranch(root);
  const remoteUrl = hasRemote(root, 'origin') ? runGit(['remote', 'get-url', 'origin'], { cwd: root }) : '';
  const head = tryRunGit(['rev-parse', '--short', 'HEAD'], { cwd: root }).stdout || '(no-commit)';
  const dirty = runGit(['status', '--porcelain'], { cwd: root }).split('\n').filter(Boolean);
  let sync = 'no-remote';
  if (remoteUrl) {
    tryRunGit(['fetch', 'origin', resolvedBranch], { cwd: root });
    const localHead = tryRunGit(['rev-parse', 'HEAD'], { cwd: root }).stdout;
    const remoteHead = tryRunGit(['rev-parse', `origin/${resolvedBranch}`], { cwd: root }).stdout;
    const baseHead = localHead && remoteHead ? tryRunGit(['merge-base', 'HEAD', `origin/${resolvedBranch}`], { cwd: root }).stdout : '';
    if (!localHead || !remoteHead) sync = 'unborn';
    else if (localHead === remoteHead) sync = 'in-sync';
    else if (localHead === baseHead) sync = 'behind';
    else if (remoteHead === baseHead) sync = 'ahead';
    else sync = 'diverged';
  }
  return { vaultDir: root, branch: resolvedBranch, remoteUrl, head, dirty, sync };
}

function hasUncommittedChanges(vaultDir) {
  return runGit(['status', '--porcelain'], { cwd: vaultDir }).split('\n').filter(Boolean).length > 0;
}

function hasAnyCommit(vaultDir) {
  return tryRunGit(['rev-parse', '--verify', 'HEAD'], { cwd: vaultDir }).ok;
}

function commitAll(vaultDir, message) {
  if (!hasUncommittedChanges(vaultDir)) return false;
  ensureGitUserConfig(vaultDir);
  runGit(['add', '-A'], { cwd: vaultDir });
  runGit(['commit', '-m', message], { cwd: vaultDir });
  return true;
}

export function syncVaultRepo(vaultDir, { message = 'TaskOps sync', branch = null } = {}) {
  const root = resolve(vaultDir);
  if (!isGitRepo(root)) throw new Error(`Not a git repo: ${root}`);
  const config = readSyncConfig(root) || {};
  const resolvedBranch = branch || config.branch || currentGitBranch(root);
  ensureBranch(root, resolvedBranch);

  const hadCommit = commitAll(root, message);
  const remoteExists = hasRemote(root, 'origin');
  if (remoteExists) {
    if (hasAnyCommit(root)) {
      const pullResult = tryRunGit(['pull', '--rebase', '--autostash', 'origin', resolvedBranch], { cwd: root });
      if (!pullResult.ok && !/couldn't find remote ref|no such ref/i.test(`${pullResult.stderr} ${pullResult.stdout}`)) {
        throw new Error(pullResult.stderr || pullResult.stdout || `Failed to pull origin/${resolvedBranch}`);
      }
    }
    const pushArgs = ['push'];
    const upstream = tryRunGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: root });
    if (!upstream.ok) pushArgs.push('-u', 'origin', resolvedBranch);
    else pushArgs.push('origin', resolvedBranch);
    runGit(pushArgs, { cwd: root });
  }
  return { vaultDir: root, branch: resolvedBranch, committed: hadCommit, remoteExists };
}

export function initProject(dir, { id, title, objective, language = null }) {
  const root = resolve(dir);
  const resolvedLanguage = normalizeLanguage(language || resolveLanguage(root));
  const t = localeBundle(resolvedLanguage).init;
  ensureDir(join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'tasks'));
  ensureDir(join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'eow'));
  ensureDir(join(root, 'snapshots'));
  ensureDir(join(root, 'runs', 'run-main', 'nodes'));
  ensureDir(join(root, 'runs', 'run-main', 'edges'));
  ensureDir(join(root, 'derived', 'canvases'));
  ensureDir(join(root, 'derived', 'views'));
  const now = isoNow();
  writeFileSync(join(root, 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'work', id, title, objective, language: resolvedLanguage, activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' }) + `# ${title}\n`, 'utf8');
  writeFileSync(join(root, 'work-log.md'), `# Work log\n\n- ${t.projectInitialized}\n`, 'utf8');
  writeFileSync(join(root, 'task-groups', 'tg-root', 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective, activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' }) + '# Root task group\n', 'utf8');
  writeFileSync(join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: t.initialRootDecomposition, selected: true, createdAt: now, status: 'active' }) + '# Root version\n', 'utf8');
  writeFileSync(join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'decomposition-log.md'), `# Decomposition log\n\n- ${t.initialVersionCreated}\n`, 'utf8');
  writeFileSync(join(root, 'snapshots', 'snapshot-root-v1.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: t.initialSnapshot, status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] }) + '# Snapshot root v1\n', 'utf8');
  writeFileSync(join(root, 'runs', 'run-main', 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'run', id: 'run-main', workId: id, createdAt: now, status: 'active' }) + '# Run main\n', 'utf8');
  writeFileSync(join(root, 'runs', 'run-main', 'run-log.md'), `# Run log\n\n- ${t.runInitialized}\n`, 'utf8');
  return root;
}

export function writeVersionFromSpec(projectDir, taskGroupId, spec, { supersedesVersionId = null } = {}) {
  const language = resolveLanguage(projectDir);
  const t = localeBundle(language).init;
  const taskGroupDir = join(projectDir, 'task-groups', taskGroupId);
  const tgIndex = join(taskGroupDir, 'index.md');
  if (!fileExists(tgIndex)) throw new Error(localeBundle(language).validation.taskGroupNotFound(taskGroupId));
  const versionId = spec.versionId;
  const versionDir = join(taskGroupDir, 'versions', versionId);
  if (fileExists(versionDir)) throw new Error(localeBundle(language).validation.versionAlreadyExists(versionId));
  ensureDir(join(versionDir, 'tasks'));
  ensureDir(join(versionDir, 'eow'));
  const now = isoNow();
  const versionFm = { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: versionId, taskGroupId, version: spec.version ?? versionId, summary: spec.summary, createdAt: now, status: spec.status ?? 'active' };
  if (supersedesVersionId) versionFm.supersedesVersionId = supersedesVersionId;
  if (spec.selected === true) versionFm.selected = true;
  for (const key of ['restartedFromVersionId', 'restartedFromTaskId', 'restartInstruction', 'restartReason', 'restartedAt']) {
    if (spec[key] !== undefined && spec[key] !== null && spec[key] !== '') versionFm[key] = spec[key];
  }
  writeFileSync(join(versionDir, 'index.md'), fmBlock(versionFm) + `# ${spec.summary}\n`, 'utf8');
  const logSeedLine = spec.logSeedLine || t.versionCreatedFromSpec;
  writeFileSync(join(versionDir, 'decomposition-log.md'), `# Decomposition log\n\n- ${logSeedLine}\n`, 'utf8');
  (spec.tasks || []).forEach((task, i) => {
    const fm = {
      taskOpsVersion: 'v1', entityType: 'task', id: task.id, taskGroupId, taskGroupVersionId: versionId,
      title: task.title, objective: task.objective, responsibility: task.responsibility,
      completionCriteria: task.completionCriteria, order: task.order ?? i + 1, createdAt: now, status: task.status ?? 'pending'
    };
    for (const key of ['role', 'purpose', 'runReadiness', 'runReadinessReason', 'unblockRunReadiness', 'understandingLevel', ...TASK_UNCERTAINTY_SCALAR_FIELDS, 'decompositionConfidence', 'executionConfidence', 'explorationNeeded', 'nextLearningGoal', 'childTaskGroupId', 'preservedUpstream', 'preservedFromVersionId', 'preservedFromTaskId', 'restartedFromVersionId', 'restartedFromTaskId', 'restartInstruction', 'restartReason', 'restartedAt', 'followUpFromPartialId', 'followUpForTaskId', 'followUpForTaskGroupVersionId', 'followUpDepth', 'sourceRunId', 'sourceRunNodeId', 'followUpCompletedSummary', 'followUpIncompleteSummary', 'needsManualReview', 'manualReviewReason', 'repeatedPartialNeedsReview', 'repeatedPartialCount', 'partialRepeatThreshold']) {
      if (task[key] !== undefined && task[key] !== null && task[key] !== '') fm[key] = task[key];
    }
    if (Array.isArray(task.blockedBy)) fm.blockedBy = task.blockedBy;
    if (Array.isArray(task.unknowns)) fm.unknowns = task.unknowns;
    if (Array.isArray(task.knownList)) fm.knownList = cloneFrontmatterValue(task.knownList);
    if (Array.isArray(task.surpriseHistory)) fm.surpriseHistory = cloneFrontmatterValue(task.surpriseHistory);
    if (Array.isArray(task.runRefs)) fm.runRefs = task.runRefs;
    if (task.acceptance && typeof task.acceptance === 'object' && !Array.isArray(task.acceptance)) fm.acceptance = task.acceptance;
    if (task.followUpBudget && typeof task.followUpBudget === 'object' && !Array.isArray(task.followUpBudget)) fm.followUpBudget = task.followUpBudget;
    if (Array.isArray(task.followUpBlockedByPartialIds)) fm.followUpBlockedByPartialIds = task.followUpBlockedByPartialIds;
    if (Array.isArray(task.repeatedPartialReviewPartialIds)) fm.repeatedPartialReviewPartialIds = task.repeatedPartialReviewPartialIds;
    writeFileSync(join(versionDir, 'tasks', `${task.id}.md`), fmBlock(fm) + `# ${task.title}\n`, 'utf8');
  });
  for (const eow of spec.eows || []) {
    if (!eow || !eow.id) continue;
    const eowFm = {
      taskOpsVersion: 'v1', entityType: 'eow', id: eow.id,
      graphType: eow.graphType || 'task',
      attachedToType: eow.attachedToType || 'task',
      attachedToId: eow.attachedToId,
      reason: eow.reason || 'preserved_upstream_after_restart',
      declaredBy: eow.declaredBy || 'taskops-restart',
      declaredAt: eow.declaredAt || now,
      createdAt: eow.createdAt || now,
      status: eow.status || 'done',
      taskGroupVersionId: versionId,
    };
    for (const key of ['preservedFromVersionId', 'preservedFromEowId', 'preservedFromReason', ...POLICY_APPROVED_EOW_FIELDS]) {
      if (eow[key] !== undefined && eow[key] !== null && eow[key] !== '') eowFm[key] = eow[key];
    }
    writeFileSync(join(versionDir, 'eow', `${eow.id}.md`), fmBlock(eowFm) + `# EoW: ${eow.attachedToId}\n`, 'utf8');
  }
  return versionDir;
}

function rewriteFrontmatterInPlace(filePath, updater) {
  const fm = parseMarkdownFile(filePath);
  const body = readBody(filePath);
  const next = updater({ ...fm }) ?? fm;
  const text = fmBlock(next) + (body ? body + '\n' : '');
  writeFileSync(filePath, text, 'utf8');
}

function deriveRestartVersionId(taskGroup, sourceVersionId) {
  const existingIds = new Set(taskGroup.versions.map((v) => v.id));
  const versionMatch = /^(.*-v)(\d+)$/.exec(sourceVersionId);
  if (versionMatch) {
    let n = Number(versionMatch[2]) + 1;
    while (existingIds.has(`${versionMatch[1]}${n}`)) n += 1;
    return `${versionMatch[1]}${n}`;
  }
  let n = 1;
  while (existingIds.has(`${sourceVersionId}-restart-${n}`)) n += 1;
  return `${sourceVersionId}-restart-${n}`;
}

function safeTaskIdPart(value) {
  return String(value || 'target')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'target';
}

function uniqueTaskId(baseId, usedIds) {
  let id = baseId;
  let counter = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${counter}`;
    counter += 1;
  }
  usedIds.add(id);
  return id;
}

function truncateForTitle(value, maxLen = 72) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3)).trim()}...`;
}

function numericFollowUpDepth(task) {
  const n = Number(task?.followUpDepth || 0);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function cloneTaskForPromotion(task) {
  const cloned = {
    id: task.id,
    title: task.title,
    objective: task.objective,
    responsibility: task.responsibility,
    completionCriteria: task.completionCriteria,
    order: task.order,
    status: task.status ?? 'pending',
  };
  const preserveKeys = [
    'role',
    'purpose',
    'runReadiness',
    'runReadinessReason',
    'unblockRunReadiness',
    'understandingLevel',
    ...TASK_UNCERTAINTY_SCALAR_FIELDS,
    'decompositionConfidence',
    'executionConfidence',
    'explorationNeeded',
    'nextLearningGoal',
    'childTaskGroupId',
    'preservedUpstream',
    'preservedFromVersionId',
    'preservedFromTaskId',
    'restartedFromVersionId',
    'restartedFromTaskId',
    'restartInstruction',
    'restartReason',
    'restartedAt',
    'followUpFromPartialId',
    'followUpForTaskId',
    'followUpForTaskGroupVersionId',
    'followUpDepth',
    'sourceRunId',
    'sourceRunNodeId',
    'followUpCompletedSummary',
    'followUpIncompleteSummary',
    'needsManualReview',
    'manualReviewReason',
    'repeatedPartialNeedsReview',
    'repeatedPartialCount',
    'partialRepeatThreshold',
  ];
  for (const key of preserveKeys) {
    if (task[key] !== undefined && task[key] !== null && task[key] !== '') cloned[key] = task[key];
  }
  if (Array.isArray(task.blockedBy)) cloned.blockedBy = [...task.blockedBy];
  if (Array.isArray(task.unknowns)) cloned.unknowns = [...task.unknowns];
  if (Array.isArray(task.knownList)) cloned.knownList = cloneFrontmatterValue(task.knownList);
  if (Array.isArray(task.surpriseHistory)) cloned.surpriseHistory = cloneFrontmatterValue(task.surpriseHistory);
  if (Array.isArray(task.followUpBlockedByPartialIds)) cloned.followUpBlockedByPartialIds = [...task.followUpBlockedByPartialIds];
  if (Array.isArray(task.repeatedPartialReviewPartialIds)) cloned.repeatedPartialReviewPartialIds = [...task.repeatedPartialReviewPartialIds];
  if (task.acceptance && typeof task.acceptance === 'object' && !Array.isArray(task.acceptance)) cloned.acceptance = task.acceptance;
  if (task.followUpBudget && typeof task.followUpBudget === 'object' && !Array.isArray(task.followUpBudget)) cloned.followUpBudget = task.followUpBudget;
  return cloned;
}

function taskKey(versionId, taskId) {
  return `${versionId}:${taskId}`;
}

function runNodeKey(runId, nodeId) {
  return `${runId}:${nodeId}`;
}

function selectedVersionPairs(parsed) {
  const activeSnapshot = parsed.project.activeSnapshotId ? parsed.snapshots.get(parsed.project.activeSnapshotId) : null;
  return Array.isArray(activeSnapshot?.selectedVersions) ? activeSnapshot.selectedVersions.filter(Boolean) : [];
}

function selectedVersionIds(parsed) {
  return new Set(selectedVersionPairs(parsed).map((pair) => pair.versionId).filter(Boolean));
}

function partialSkip(partial, reason, detail = null, extra = {}) {
  return {
    partialId: partial?.id || null,
    graphType: partial?.graphType || null,
    attachedToId: partial?.attachedToId || null,
    reason,
    detail,
    path: partial?.path || null,
    ...extra,
  };
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function repeatedPartialReviewPatch({ partial, sourceTask, sourceVersion, repeatCount, repeatThreshold }) {
  const detail = `Task ${sourceTask.id} already has ${repeatCount} partial promotion wave(s), meeting repeat threshold ${repeatThreshold}; human review is required before another follow-up promotion.`;
  return {
    taskId: sourceTask.id,
    taskGroupVersionId: sourceVersion.id,
    partialId: partial.id,
    repeatCount,
    repeatThreshold,
    reason: 'repeated_partial_needs_review',
    detail,
  };
}

function applyRepeatedPartialReviewToTask(task, patches) {
  if (!Array.isArray(patches) || patches.length === 0) return task;
  const repeatCount = Math.max(...patches.map((patch) => Number(patch.repeatCount || 0)));
  const repeatThreshold = Math.max(...patches.map((patch) => Number(patch.repeatThreshold || DEFAULT_PARTIAL_REPEAT_THRESHOLD)));
  const reviewPartialIds = uniqueStrings([
    ...(Array.isArray(task.repeatedPartialReviewPartialIds) ? task.repeatedPartialReviewPartialIds : []),
    ...patches.map((patch) => patch.partialId),
  ]);
  return {
    ...task,
    status: 'blocked',
    runReadiness: 'blocked',
    runReadinessReason: `Repeated partial promotion requires human review: task ${task.id} already has ${repeatCount} partial promotion wave(s), threshold=${repeatThreshold}.`,
    needsManualReview: true,
    manualReviewReason: 'repeated_partial_needs_review',
    repeatedPartialNeedsReview: true,
    repeatedPartialCount: repeatCount,
    partialRepeatThreshold: repeatThreshold,
    repeatedPartialReviewPartialIds: reviewPartialIds,
  };
}

function resolvePartialSource(parsed, partial) {
  if (partial.graphType === 'task' && partial.attachedToType === 'task') {
    const versionId = partial.taskGroupVersionId;
    const task = parsed.tasks.get(taskKey(versionId, partial.attachedToId));
    if (!task) return { ok: false, reason: 'missing_attached_task', detail: `Task ${versionId}:${partial.attachedToId} not found.` };
    return { ok: true, task, source: { type: 'task', taskId: task.id, taskGroupVersionId: task.taskGroupVersionId } };
  }

  if (partial.graphType === 'run' && partial.attachedToType === 'runNode') {
    const node = parsed.runNodes.get(runNodeKey(partial.runId, partial.attachedToId));
    if (!node) return { ok: false, reason: 'missing_attached_run_node', detail: `Run node ${partial.runId}:${partial.attachedToId} not found.` };
    if (!node.sourceTaskId || !node.sourceTaskGroupVersionId) {
      return {
        ok: false,
        reason: 'needs_manual_mapping',
        detail: `Run node ${partial.runId}/${node.id} has no exact sourceTaskId/sourceTaskGroupVersionId.`,
      };
    }
    const task = parsed.tasks.get(taskKey(node.sourceTaskGroupVersionId, node.sourceTaskId));
    if (!task) {
      return {
        ok: false,
        reason: 'needs_manual_mapping',
        detail: `Source task ${node.sourceTaskGroupVersionId}:${node.sourceTaskId} was not found for run node ${partial.runId}/${node.id}.`,
      };
    }
    return {
      ok: true,
      task,
      runNode: node,
      source: {
        type: 'runNode',
        runId: partial.runId,
        runNodeId: node.id,
        taskId: task.id,
        taskGroupVersionId: task.taskGroupVersionId,
      },
    };
  }

  return {
    ok: false,
    reason: 'unsupported_partial_target',
    detail: `Unsupported partial target ${partial.graphType}/${partial.attachedToType}.`,
  };
}

function buildFollowUpTask({ partial, sourceTask, sourceVersion, newVersionId, followUpTaskId, followUpDepth, runNode = null }) {
  const clipped = truncateForTitle(partial.incompleteSummary || sourceTask.title || partial.id);
  const followUpTask = {
    id: followUpTaskId,
    title: `Follow up ${sourceTask.id}: ${clipped}`,
    objective: partial.incompleteSummary || `Complete remaining work recorded by partial marker ${partial.id}.`,
    responsibility: `Complete the unfinished work recorded by partial marker ${partial.id} for source task ${sourceTask.id}.`,
    completionCriteria: `The incomplete work from partial marker ${partial.id} is completed with evidence, and source task ${sourceTask.id} can be unblocked for final closure.`,
    status: 'pending',
    runReadiness: 'runnable',
    runReadinessReason: `Promoted from unresolved partial marker ${partial.id}; complete the recorded follow-up before returning to ${sourceTask.id}.`,
    understandingLevel: sourceTask.understandingLevel || 'partial',
    followUpFromPartialId: partial.id,
    followUpForTaskId: sourceTask.id,
    followUpForTaskGroupVersionId: sourceVersion.id,
    followUpDepth,
    followUpCompletedSummary: partial.completedSummary || '',
    followUpIncompleteSummary: partial.incompleteSummary || '',
    followUpBudget: partial.budget && typeof partial.budget === 'object' && !Array.isArray(partial.budget)
      ? partial.budget
      : { enabled: false },
  };
  if (runNode) {
    followUpTask.sourceRunId = runNode.runId;
    followUpTask.sourceRunNodeId = runNode.id;
  }
  return followUpTask;
}

function eowDeclaredTime(eow) {
  const value = Date.parse(eow?.declaredAt || eow?.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function selectTaskEowForCarryForward(sourceVersion, task) {
  const candidates = (sourceVersion.eows || []).filter((eow) => (
    eow
    && eow.graphType === 'task'
    && eow.attachedToType === 'task'
    && eow.attachedToId === task.id
    && eow.status === 'done'
  ));
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    const policyDelta = Number(isPolicyApprovedEow(b)) - Number(isPolicyApprovedEow(a));
    if (policyDelta !== 0) return policyDelta;
    const manualDelta = Number(isManualAttestedEow(a)) - Number(isManualAttestedEow(b));
    if (manualDelta !== 0) return manualDelta;
    const timeDelta = eowDeclaredTime(b) - eowDeclaredTime(a);
    if (timeDelta !== 0) return timeDelta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  })[0];
}

function carriedForwardTaskEow({ sourceEow, task, sourceVersion, newVersionId, declaredBy }) {
  const eow = {
    id: `eow-${task.id}-${newVersionId}`,
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: task.id,
    reason: 'preserved_upstream_after_restart',
    declaredBy,
    status: 'done',
    preservedFromVersionId: sourceEow.preservedFromVersionId || sourceEow.taskGroupVersionId || sourceVersion.id,
    preservedFromEowId: sourceEow.preservedFromEowId || sourceEow.id || `eow-${task.id}`,
    preservedFromReason: sourceEow.preservedFromReason || sourceEow.reason || null,
  };
  for (const key of POLICY_APPROVED_EOW_FIELDS) {
    if (sourceEow[key] !== undefined && sourceEow[key] !== null && sourceEow[key] !== '') eow[key] = sourceEow[key];
  }
  return eow;
}

function preservedEowsForPromotion(sourceVersion, newVersionId) {
  const eows = [];
  for (const task of sourceVersion.tasks) {
    if ((task.status ?? 'pending') !== 'done') continue;
    if (task.childTaskGroupId) continue;
    const sourceEow = selectTaskEowForCarryForward(sourceVersion, task);
    if (!sourceEow) continue;
    eows.push(carriedForwardTaskEow({
      sourceEow,
      task,
      sourceVersion,
      newVersionId,
      declaredBy: 'taskops-promote-partials',
    }));
  }
  return eows;
}

function buildPromotionVersionPlan({ parsed, sourceVersion, taskGroup, selectedPair, promotions, repeatedReviewPatches = [] }) {
  const newVersionId = deriveRestartVersionId(taskGroup, sourceVersion.id);
  const usedIds = new Set(sourceVersion.tasks.map((task) => task.id));
  const orderedTasks = [...sourceVersion.tasks].sort((a, b) => (Number(a.order ?? 0) - Number(b.order ?? 0)) || String(a.id).localeCompare(String(b.id)));
  const promotionsByTaskId = new Map();
  const repeatedReviewPatchesByTaskId = new Map();

  for (const patch of repeatedReviewPatches) {
    const list = repeatedReviewPatchesByTaskId.get(patch.taskId) || [];
    list.push(patch);
    repeatedReviewPatchesByTaskId.set(patch.taskId, list);
  }

  const plannedPromotions = promotions.map((promotion) => {
    const baseId = `task-${safeTaskIdPart(promotion.sourceTask.id)}-followup`;
    const followUpTaskId = uniqueTaskId(baseId, usedIds);
    const followUpTask = buildFollowUpTask({
      partial: promotion.partial,
      sourceTask: promotion.sourceTask,
      sourceVersion,
      newVersionId,
      followUpTaskId,
      followUpDepth: promotion.followUpDepth,
      runNode: promotion.runNode || null,
    });
    const item = {
      ...promotion,
      followUpTaskId,
      followUpTask,
      supersededBy: `task:${newVersionId}/${followUpTaskId}`,
    };
    const list = promotionsByTaskId.get(promotion.sourceTask.id) || [];
    list.push(item);
    promotionsByTaskId.set(promotion.sourceTask.id, list);
    return item;
  });

  let nextOrder = 1;
  const specTasks = [];
  const sourceTaskPatches = [];
  for (const task of orderedTasks) {
    let cloned = cloneTaskForPromotion(task);
    cloned.order = nextOrder;
    nextOrder += 1;

    const repeatedReviewPatchesForTask = repeatedReviewPatchesByTaskId.get(task.id) || [];
    if (repeatedReviewPatchesForTask.length > 0) {
      cloned = applyRepeatedPartialReviewToTask(cloned, repeatedReviewPatchesForTask);
    }

    const taskPromotions = promotionsByTaskId.get(task.id) || [];
    if (taskPromotions.length > 0) {
      const blockers = Array.isArray(cloned.blockedBy) ? [...cloned.blockedBy] : [];
      const partialIds = Array.isArray(cloned.followUpBlockedByPartialIds) ? [...cloned.followUpBlockedByPartialIds] : [];
      for (const promotion of taskPromotions) {
        blockers.push({ type: 'task', id: promotion.followUpTaskId, taskGroupVersionId: newVersionId });
        partialIds.push(promotion.partial.id);
      }
      cloned.status = 'blocked';
      cloned.runReadiness = 'blocked';
      cloned.unblockRunReadiness = cloned.unblockRunReadiness || 'runnable';
      cloned.runReadinessReason = `Blocked by partial-driven follow-up task(s): ${taskPromotions.map((p) => p.followUpTaskId).join(', ')}.`;
      cloned.blockedBy = blockers;
      cloned.followUpBlockedByPartialIds = partialIds;
      sourceTaskPatches.push({
        taskId: task.id,
        taskGroupVersionId: sourceVersion.id,
        newTaskGroupVersionId: newVersionId,
        status: 'blocked',
        runReadiness: 'blocked',
        unblockRunReadiness: cloned.unblockRunReadiness,
        blockedByAppend: taskPromotions.map((promotion) => ({
          type: 'task',
          id: promotion.followUpTaskId,
          taskGroupVersionId: newVersionId,
          partialId: promotion.partial.id,
        })),
      });
    }
    specTasks.push(cloned);

    for (const promotion of taskPromotions) {
      promotion.followUpTask.order = nextOrder;
      nextOrder += 1;
      specTasks.push(promotion.followUpTask);
    }
  }

  const specPreview = {
    versionId: newVersionId,
    version: newVersionId,
    summary: `Partial-driven follow-up promotion from ${sourceVersion.id}`,
    selected: true,
    tasks: specTasks,
    eows: preservedEowsForPromotion(sourceVersion, newVersionId),
    logSeedLine: `Partial-driven follow-up promotion supersedes version ${sourceVersion.id}.`,
  };

  return {
    taskGroupId: taskGroup.id,
    fromVersionId: sourceVersion.id,
    toVersionId: newVersionId,
    snapshotId: parsed.project.activeSnapshotId || null,
    selectedPair,
    supersedesVersionId: sourceVersion.id,
    reason: 'partial_follow_up_promotion',
    promotions: plannedPromotions.map((promotion) => ({
      partialId: promotion.partial.id,
      graphType: promotion.partial.graphType,
      sourceTaskId: promotion.sourceTask.id,
      sourceTaskGroupVersionId: sourceVersion.id,
      sourceRunId: promotion.runNode?.runId || null,
      sourceRunNodeId: promotion.runNode?.id || null,
      followUpTaskId: promotion.followUpTaskId,
      followUpDepth: promotion.followUpDepth,
      supersededBy: promotion.supersededBy,
      incompleteSummary: promotion.partial.incompleteSummary || '',
    })),
    sourceTaskPatches,
    followUpTasks: plannedPromotions.map((promotion) => promotion.followUpTask),
    specPreview,
  };
}

export function planPartialPromotions(workDir, { partialId = null, maxFollowUpDepth = DEFAULT_MAX_FOLLOW_UP_DEPTH, partialRepeatThreshold = null } = {}) {
  const projectDir = resolve(workDir);
  const parsed = parseProject(projectDir);
  if (parsed.errors.length > 0) {
    throw new Error(`Cannot promote partials: project has validation errors:\n- ${parsed.errors.join('\n- ')}`);
  }

  const maxDepth = Math.max(0, Math.floor(Number(maxFollowUpDepth ?? DEFAULT_MAX_FOLLOW_UP_DEPTH)));
  if (!Number.isFinite(maxDepth)) throw new Error(`Invalid --max-follow-up-depth '${maxFollowUpDepth}'`);
  const repeatThreshold = partialRepeatThresholdValue(parsed.project, partialRepeatThreshold);

  const pairs = selectedVersionPairs(parsed);
  const selected = selectedVersionIds(parsed);
  const selectedPairByVersion = new Map(pairs.map((pair) => [pair.versionId, pair]));
  const candidates = [...parsed.partialNodes.values()]
    .filter((partial) => !partialId || partial.id === partialId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (partialId && candidates.length === 0) throw new Error(`Partial '${partialId}' not found`);

  const skipped = [];
  const repeatedReviewPatches = [];
  const groups = new Map();
  for (const partial of candidates) {
    if (!isPartialUnresolved(partial)) {
      skipped.push(partialSkip(partial, 'already_superseded', `supersededBy=${partial.supersededBy}`));
      continue;
    }
    if (partial.followUpNeeded === false || String(partial.followUpNeeded).trim().toLowerCase() === 'false') {
      skipped.push(partialSkip(partial, 'follow_up_not_needed'));
      continue;
    }

    const resolved = resolvePartialSource(parsed, partial);
    if (!resolved.ok) {
      skipped.push(partialSkip(partial, resolved.reason, resolved.detail));
      continue;
    }

    const sourceTask = resolved.task;
    const sourceVersion = parsed.versions.get(sourceTask.taskGroupVersionId);
    if (!sourceVersion) {
      skipped.push(partialSkip(partial, 'missing_source_version', `Version ${sourceTask.taskGroupVersionId} not found.`));
      continue;
    }
    if (!selected.has(sourceVersion.id)) {
      skipped.push(partialSkip(partial, 'not_in_selected_version', `Version ${sourceVersion.id} is not selected in active snapshot.`));
      continue;
    }

    const repeatCount = Array.isArray(sourceTask.followUpBlockedByPartialIds) ? sourceTask.followUpBlockedByPartialIds.length : 0;
    if (repeatCount >= repeatThreshold) {
      const patch = repeatedPartialReviewPatch({
        partial,
        sourceTask,
        sourceVersion,
        repeatCount,
        repeatThreshold,
      });
      repeatedReviewPatches.push(patch);
      skipped.push(partialSkip(partial, 'repeated_partial_needs_review', patch.detail, {
        sourceTaskId: sourceTask.id,
        sourceTaskGroupVersionId: sourceVersion.id,
        repeatCount,
        repeatThreshold,
        needsManualReview: true,
      }));
      continue;
    }

    const sourceDepth = numericFollowUpDepth(sourceTask);
    const followUpDepth = sourceDepth + 1;
    if (followUpDepth > maxDepth) {
      skipped.push(partialSkip(
        partial,
        'exceeded_follow_up_depth',
        `Promotion would create followUpDepth=${followUpDepth}, exceeding maxFollowUpDepth=${maxDepth}.`,
      ));
      continue;
    }

    const taskGroup = parsed.taskGroups.get(sourceVersion.taskGroupId);
    if (!taskGroup) {
      skipped.push(partialSkip(partial, 'missing_task_group', `Task group ${sourceVersion.taskGroupId} not found.`));
      continue;
    }

    const groupKey = `${taskGroup.id}:${sourceVersion.id}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        taskGroup,
        sourceVersion,
        selectedPair: selectedPairByVersion.get(sourceVersion.id) || null,
        promotions: [],
      });
    }
    groups.get(groupKey).promotions.push({
      partial,
      sourceTask,
      sourceVersion,
      followUpDepth,
      runNode: resolved.runNode || null,
    });
  }

  const versionPlans = [...groups.values()]
    .sort((a, b) => String(a.sourceVersion.id).localeCompare(String(b.sourceVersion.id)))
    .map((group) => buildPromotionVersionPlan({
      parsed,
      sourceVersion: group.sourceVersion,
      taskGroup: group.taskGroup,
      selectedPair: group.selectedPair,
      promotions: group.promotions,
      repeatedReviewPatches: repeatedReviewPatches.filter((patch) => patch.taskGroupVersionId === group.sourceVersion.id),
    }));
  const promotionCount = versionPlans.reduce((sum, plan) => sum + plan.promotions.length, 0);

  return {
    workId: parsed.project.id,
    projectDir,
    dryRun: true,
    selectedVersionOnly: true,
    maxFollowUpDepth: maxDepth,
    partialRepeatThreshold: repeatThreshold,
    partialId: partialId || null,
    promotionCount,
    skippedCount: skipped.length,
    waveBudget: partialPromotionWaveBudgetState(parsed.project, { promotionCount }),
    repeatedReviewPatches,
    versionPlans,
    skipped,
  };
}

function appendTextFile(path, text) {
  if (existsSync(path)) writeFileSync(path, readFileSync(path, 'utf8') + text, 'utf8');
  else writeFileSync(path, text, 'utf8');
}

function appendWorkLog(projectDir, line) {
  const workLogPath = join(projectDir, 'work-log.md');
  appendTextFile(workLogPath, existsSync(workLogPath) ? line : `# Work log\n\n${line}`);
}

function closePromotedPartialSourceRunNode(projectDir, partial, now) {
  const runId = partial?.sourceRunId;
  const runNodeId = partial?.sourceRunNodeId;
  if (!runId || !runNodeId) return null;

  const runDir = join(projectDir, 'runs', runId);
  const runNodePath = join(runDir, 'nodes', `${runNodeId}.md`);
  if (!existsSync(runNodePath)) {
    return { runId, runNodeId, closed: false, reason: 'missing_source_run_node' };
  }

  ensureDir(join(runDir, 'nodes'));
  ensureDir(join(runDir, 'edges'));

  const eowRunNodeId = `eow-${runNodeId}`;
  const eowRunPath = join(runDir, 'nodes', `${eowRunNodeId}.md`);
  const edgeId = `edge-${runNodeId}-to-eow`;
  const edgePath = join(runDir, 'edges', `${edgeId}.md`);
  let wroteEow = false;
  let wroteEdge = false;

  if (!existsSync(eowRunPath)) {
    writeFileSync(eowRunPath, fmBlock({
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: eowRunNodeId,
      runId,
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: runNodeId,
      reason: 'partial_follow_up_promoted',
      declaredBy: 'taskops-promote-partials',
      declaredAt: now,
      createdAt: now,
      status: 'done',
    }) + `# EoW: ${runNodeId}\n`, 'utf8');
    wroteEow = true;
  }

  if (!existsSync(edgePath)) {
    writeFileSync(edgePath, fmBlock({
      taskOpsVersion: 'v1',
      entityType: 'runEdge',
      id: edgeId,
      runId,
      fromRunNodeId: runNodeId,
      toRunNodeId: eowRunNodeId,
      edgeType: 'closes_with',
      createdAt: now,
      status: 'done',
    }) + `# Run edge: ${runNodeId} closes with EoW\n`, 'utf8');
    wroteEdge = true;
  }

  appendTextFile(
    join(runDir, 'run-log.md'),
    `${now} partial_source_run_node_closed runNodeId=${runNodeId} partialId=${partial.id || ''} reason=partial_follow_up_promoted\n`,
  );

  return { runId, runNodeId, eowRunNodeId, edgeId, closed: true, wroteEow, wroteEdge };
}

function applyRepeatedPartialReviewPatches(parsed, patches) {
  const applied = [];
  for (const patch of patches || []) {
    const task = parsed.tasks.get(taskKey(patch.taskGroupVersionId, patch.taskId));
    if (!task?.path) continue;
    rewriteFrontmatterInPlace(task.path, (fm) => applyRepeatedPartialReviewToTask(fm, [patch]));
    applied.push({
      taskId: patch.taskId,
      taskGroupVersionId: patch.taskGroupVersionId,
      partialId: patch.partialId,
      repeatCount: patch.repeatCount,
      repeatThreshold: patch.repeatThreshold,
      reason: patch.reason,
    });
  }
  return applied;
}

export function promotePartialCompletions(workDir, { partialId = null, maxFollowUpDepth = DEFAULT_MAX_FOLLOW_UP_DEPTH, partialRepeatThreshold = null, dryRun = true } = {}) {
  const plan = planPartialPromotions(workDir, { partialId, maxFollowUpDepth, partialRepeatThreshold });
  if (dryRun) return plan;
  if (plan.promotionCount === 0) {
    const parsed = parseProject(plan.projectDir);
    if (parsed.errors.length > 0) {
      throw new Error(`Cannot promote partials: project has validation errors:\n- ${parsed.errors.join('\n- ')}`);
    }
    const now = isoNow();
    const repeatedReviewApplied = applyRepeatedPartialReviewPatches(parsed, plan.repeatedReviewPatches);
    if (repeatedReviewApplied.length > 0) {
      appendWorkLog(
        plan.projectDir,
        `- ${now} promote partials repeated partial needs review work=${plan.workId} tasks=${repeatedReviewApplied.map((patch) => `${patch.taskGroupVersionId}/${patch.taskId}`).join(',')} partials=${repeatedReviewApplied.map((patch) => patch.partialId).join(',')}\n`,
      );
    }
    return {
      ...plan,
      dryRun: false,
      applied: false,
      appliedAt: null,
      reason: repeatedReviewApplied.length > 0 ? 'repeated_partial_needs_review' : null,
      appliedVersionPlans: [],
      repeatedReviewApplied,
    };
  }
  if (plan.waveBudget?.wouldExceed) {
    const now = isoNow();
    appendWorkLog(
      plan.projectDir,
      `- ${now} promote partials wave budget exhausted work=${plan.workId} count=${plan.waveBudget.count} budget=${plan.waveBudget.budget} requestedWave=${plan.waveBudget.nextCount} promotions=${plan.promotionCount}\n`,
    );
    return {
      ...plan,
      dryRun: false,
      applied: false,
      appliedAt: null,
      reason: 'wave_budget_exhausted',
      appliedVersionPlans: [],
      repeatedReviewApplied: [],
    };
  }

  const parsed = parseProject(plan.projectDir);
  if (parsed.errors.length > 0) {
    throw new Error(`Cannot promote partials: project has validation errors:\n- ${parsed.errors.join('\n- ')}`);
  }
  const activeSnapshot = parsed.project.activeSnapshotId ? parsed.snapshots.get(parsed.project.activeSnapshotId) : null;
  if (!activeSnapshot) throw new Error('Cannot promote partials: project has no active snapshot');

  const now = isoNow();
  const appliedVersionPlans = [];
  const repeatedReviewApplied = applyRepeatedPartialReviewPatches(parsed, plan.repeatedReviewPatches);

  for (const versionPlan of plan.versionPlans) {
    const sourceVersion = parsed.versions.get(versionPlan.fromVersionId);
    if (!sourceVersion) throw new Error(`Cannot promote partials: source version '${versionPlan.fromVersionId}' not found`);
    const taskGroup = parsed.taskGroups.get(versionPlan.taskGroupId);
    if (!taskGroup) throw new Error(`Cannot promote partials: task group '${versionPlan.taskGroupId}' not found`);

    const newVersionDir = writeVersionFromSpec(plan.projectDir, versionPlan.taskGroupId, versionPlan.specPreview, {
      supersedesVersionId: versionPlan.fromVersionId,
    });

    rewriteFrontmatterInPlace(join(sourceVersion.path, 'index.md'), (fm) => {
      fm.selected = false;
      fm.supersededByVersionId = versionPlan.toVersionId;
      fm.supersededAt = now;
      fm.supersededReason = 'partial_follow_up_promotion';
      return fm;
    });

    rewriteFrontmatterInPlace(join(taskGroup.path, 'index.md'), (fm) => {
      fm.activeVersionId = versionPlan.toVersionId;
      return fm;
    });

    rewriteFrontmatterInPlace(activeSnapshot.path, (fm) => {
      const list = Array.isArray(fm.selectedVersions) ? [...fm.selectedVersions] : [];
      fm.selectedVersions = list.map((p) => {
        if (!p || typeof p !== 'object') return p;
        if (p.taskGroupId === versionPlan.taskGroupId && p.versionId === versionPlan.fromVersionId) {
          return { taskGroupId: p.taskGroupId, versionId: versionPlan.toVersionId };
        }
        return p;
      });
      return fm;
    });

    const decompositionLogPath = join(newVersionDir, 'decomposition-log.md');
    const promotedIds = versionPlan.promotions.map((promotion) => promotion.partialId).join(', ');
    appendTextFile(
      decompositionLogPath,
      `- ${now} partial-driven follow-up promotion from=${versionPlan.fromVersionId} to=${versionPlan.toVersionId} partials=${promotedIds}\n`,
    );

    const closedSourceRunNodes = [];
    for (const promotion of versionPlan.promotions) {
      const partial = parsed.partialNodes.get(promotion.partialId);
      if (!partial) throw new Error(`Cannot promote partials: partial '${promotion.partialId}' disappeared before apply`);
      rewriteFrontmatterInPlace(partial.path, (fm) => {
        fm.supersededBy = promotion.supersededBy;
        fm.supersededAt = now;
        fm.supersededReason = 'partial_follow_up_promotion';
        fm.followUpTaskId = promotion.followUpTaskId;
        fm.followUpTaskGroupVersionId = versionPlan.toVersionId;
        return fm;
      });
      const closedSourceRunNode = closePromotedPartialSourceRunNode(plan.projectDir, partial, now);
      if (closedSourceRunNode) {
        closedSourceRunNodes.push({
          partialId: promotion.partialId,
          ...closedSourceRunNode,
        });
      }
    }

    appliedVersionPlans.push({
      taskGroupId: versionPlan.taskGroupId,
      fromVersionId: versionPlan.fromVersionId,
      toVersionId: versionPlan.toVersionId,
      newVersionDir,
      promotionCount: versionPlan.promotions.length,
      promotedPartialIds: versionPlan.promotions.map((promotion) => promotion.partialId),
      closedSourceRunNodes,
    });
  }

  const logLine = `- ${now} promote partials work=${plan.workId} promotions=${plan.promotionCount} skipped=${plan.skippedCount} versions=${appliedVersionPlans.map((p) => `${p.fromVersionId}->${p.toVersionId}`).join(',')}\n`;
  appendWorkLog(plan.projectDir, logLine);
  rewriteFrontmatterInPlace(join(plan.projectDir, 'index.md'), (fm) => {
    fm.partialPromotionWaveBudget = plan.waveBudget.budget;
    fm.partialPromotionWaveCount = plan.waveBudget.nextCount;
    return fm;
  });

  return {
    ...plan,
    dryRun: false,
    applied: true,
    appliedAt: now,
    appliedVersionPlans,
    repeatedReviewApplied,
  };
}

export function restartFromTask(workDir, { fromTaskId, instruction = null, instructionFile = null, reason = null } = {}) {
  if (!fromTaskId) throw new Error('Missing required fromTaskId');
  const projectDir = resolve(workDir);
  let instructionText = instruction == null ? '' : String(instruction).trim();
  if (!instructionText && instructionFile) {
    instructionText = readFileSync(resolve(instructionFile), 'utf8').trim();
  }
  if (!instructionText) throw new Error('Missing --instruction or --instruction-file content');

  const parsed = parseProject(projectDir);
  if (parsed.errors.length > 0) {
    throw new Error(`Cannot restart: project has validation errors:\n- ${parsed.errors.join('\n- ')}`);
  }

  const activeSnapshot = parsed.project.activeSnapshotId ? parsed.snapshots.get(parsed.project.activeSnapshotId) : null;
  if (!activeSnapshot) throw new Error('Cannot restart: project has no active snapshot');
  const selectedPairs = Array.isArray(activeSnapshot.selectedVersions) ? activeSnapshot.selectedVersions : [];

  const matches = [];
  for (const pair of selectedPairs) {
    const v = parsed.versions.get(pair.versionId);
    if (!v) continue;
    for (const task of v.tasks) {
      if (task.id === fromTaskId) matches.push({ pair, version: v, task });
    }
  }
  if (matches.length === 0) throw new Error(`Task '${fromTaskId}' not found in active snapshot's selected versions`);
  if (matches.length > 1) {
    const detail = matches.map((m) => `${m.pair.taskGroupId}/${m.version.id}`).join(', ');
    throw new Error(`Task id '${fromTaskId}' is ambiguous across selected versions: ${detail}`);
  }
  const { pair: targetPair, version: sourceVersion, task: targetTask } = matches[0];
  const taskGroup = parsed.taskGroups.get(sourceVersion.taskGroupId);
  if (!taskGroup) throw new Error(`Task group '${sourceVersion.taskGroupId}' not found`);

  const newVersionId = deriveRestartVersionId(taskGroup, sourceVersion.id);
  const now = isoNow();

  const targetOrder = targetTask.order ?? 0;
  const orderedTasks = [...sourceVersion.tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const preserveKeys = ['role', 'purpose', 'runReadiness', 'runReadinessReason', 'unblockRunReadiness', 'understandingLevel', ...TASK_UNCERTAINTY_SCALAR_FIELDS, 'decompositionConfidence', 'executionConfidence', 'explorationNeeded', 'nextLearningGoal', 'childTaskGroupId'];

  const specTasks = orderedTasks.map((task) => {
    const cloned = { id: task.id, title: task.title, objective: task.objective, responsibility: task.responsibility, completionCriteria: task.completionCriteria, order: task.order };
    for (const key of preserveKeys) {
      if (task[key] !== undefined && task[key] !== null) cloned[key] = task[key];
    }
    if (Array.isArray(task.blockedBy)) cloned.blockedBy = [...task.blockedBy];
    if (Array.isArray(task.unknowns)) cloned.unknowns = [...task.unknowns];
    if (Array.isArray(task.knownList)) cloned.knownList = cloneFrontmatterValue(task.knownList);
    if (Array.isArray(task.surpriseHistory)) cloned.surpriseHistory = cloneFrontmatterValue(task.surpriseHistory);
    const order = task.order ?? 0;
    if (task.id === fromTaskId) {
      cloned.status = 'pending';
      cloned.restartInstruction = instructionText;
      if (reason) cloned.restartReason = reason;
      cloned.restartedFromVersionId = sourceVersion.id;
      cloned.restartedFromTaskId = task.id;
      cloned.restartedAt = now;
    } else if (order < targetOrder) {
      cloned.status = task.status ?? 'pending';
      cloned.preservedUpstream = true;
      cloned.preservedFromVersionId = sourceVersion.id;
      cloned.preservedFromTaskId = task.id;
    } else {
      cloned.status = 'pending';
    }
    return cloned;
  });

  const specEows = [];
  for (const task of orderedTasks) {
    const order = task.order ?? 0;
    if (order >= targetOrder) continue;
    if ((task.status ?? 'pending') !== 'done') continue;
    if (task.childTaskGroupId) continue;
    const sourceEow = selectTaskEowForCarryForward(sourceVersion, task);
    if (!sourceEow) continue;
    specEows.push(carriedForwardTaskEow({
      sourceEow,
      task,
      sourceVersion,
      newVersionId,
      declaredBy: 'taskops-restart',
    }));
  }

  const summary = `Restart from task '${fromTaskId}'${reason ? ` (${reason})` : ''}`;
  const spec = {
    versionId: newVersionId,
    version: newVersionId,
    summary,
    selected: true,
    tasks: specTasks,
    eows: specEows,
    restartedFromVersionId: sourceVersion.id,
    restartedFromTaskId: fromTaskId,
    restartInstruction: instructionText,
    restartReason: reason || null,
    restartedAt: now,
    logSeedLine: `Restart from task '${fromTaskId}' supersedes version ${sourceVersion.id}.`,
  };

  const newVersionDir = writeVersionFromSpec(projectDir, taskGroup.id, spec, { supersedesVersionId: sourceVersion.id });

  rewriteFrontmatterInPlace(join(sourceVersion.path, 'index.md'), (fm) => {
    fm.selected = false;
    fm.supersededByVersionId = newVersionId;
    fm.supersededAt = now;
    fm.supersededReason = reason || 'restart';
    return fm;
  });

  rewriteFrontmatterInPlace(join(taskGroup.path, 'index.md'), (fm) => {
    if (fm.activeVersionId === sourceVersion.id) fm.activeVersionId = newVersionId;
    return fm;
  });

  rewriteFrontmatterInPlace(activeSnapshot.path, (fm) => {
    const list = Array.isArray(fm.selectedVersions) ? [...fm.selectedVersions] : [];
    fm.selectedVersions = list.map((p) => {
      if (!p || typeof p !== 'object') return p;
      if (p.taskGroupId === targetPair.taskGroupId && p.versionId === sourceVersion.id) {
        return { taskGroupId: p.taskGroupId, versionId: newVersionId };
      }
      return p;
    });
    return fm;
  });

  const workLogPath = join(projectDir, 'work-log.md');
  const logLine = `- ${now} restart from task=${fromTaskId} taskGroup=${taskGroup.id} from=${sourceVersion.id} to=${newVersionId}${reason ? ` reason="${reason}"` : ''}\n`;
  if (existsSync(workLogPath)) writeFileSync(workLogPath, readFileSync(workLogPath, 'utf8') + logLine, 'utf8');
  else writeFileSync(workLogPath, `# Work log\n\n${logLine}`, 'utf8');

  return {
    workId: parsed.project.id,
    taskGroupId: taskGroup.id,
    fromVersionId: sourceVersion.id,
    toVersionId: newVersionId,
    fromTaskId,
    reason: reason || null,
    instructionLength: instructionText.length,
    preservedTaskCount: specTasks.filter((t) => t.preservedUpstream === true).length,
    resetTaskCount: specTasks.filter((t) => t.id !== fromTaskId && !t.preservedUpstream).length,
    newVersionDir,
    snapshotId: activeSnapshot.id,
  };
}

export function watchAndSyncVault(vaultDir, { debounceMs = 5000, message = 'TaskOps watch-sync', branch = null } = {}) {
  const root = resolve(vaultDir);
  let timer = null;
  let syncing = false;
  let rerun = false;
  const watcher = watch(root, { recursive: true }, (_eventType, fileName) => {
    const rel = String(fileName || '');
    const config = readSyncConfig(root) || {};
    const ignorePaths = config.ignorePaths || [];
    if (ignorePaths.some((prefix) => rel.startsWith(prefix))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (syncing) {
        rerun = true;
        return;
      }
      syncing = true;
      try {
        syncVaultRepo(root, { message, branch: branch || config.branch });
        console.log(`TaskOps watch-sync: synced ${root}`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        syncing = false;
        if (rerun) {
          rerun = false;
          syncVaultRepo(root, { message, branch: branch || config.branch });
        }
      }
    }, debounceMs);
  });
  return watcher;
}
