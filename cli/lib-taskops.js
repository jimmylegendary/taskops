import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync, watch } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const STATUS_VALUES = ['pending', 'active', 'done', 'blocked', 'cancelled'];
export const RUN_READINESS_VALUES = ['runnable', 'needs_decomposition', 'needs_exploration', 'blocked'];
export const UNDERSTANDING_LEVEL_VALUES = ['known', 'partial', 'unknown'];
export const ENTITY_TYPES = ['project', 'taskGroup', 'taskGroupVersion', 'task', 'versionSnapshot', 'run', 'runNode', 'runEdge'];
export const TASKOPS_SYNC_DIR = '.taskops';
export const TASKOPS_SYNC_CONFIG = 'taskops-sync.json';
export const DEFAULT_LANGUAGE = 'en';

const SUMMARY_LABELS = Object.freeze({
  projectId: 'Project ID',
  projectObjective: 'Project objective',
  projectStatus: 'Project status',
  rootTaskGroup: 'Root task group',
  activeSnapshot: 'Active snapshot',
  taskGroups: 'Task groups',
  taskGroupVersions: 'Task group versions',
  tasks: 'Tasks',
  snapshots: 'Snapshots',
  runNodes: 'Run nodes',
  runEdges: 'Run edges',
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
      invalidStatus: (status) => `invalid status '${status}'`,
      invalidRunReadiness: (value) => `invalid runReadiness '${value}'`,
      invalidUnderstandingLevel: (value) => `invalid understandingLevel '${value}'`,
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
      projectIdMustBe: (id) => `projectId must be '${id}'`,
      runIdMustBe: (id) => `runId must be '${id}'`,
      sourceTaskGroupVersionNotFound: (id) => `sourceTaskGroupVersionId '${id}' not found`,
      sourceTaskNotFound: (id) => `sourceTaskId '${id}' not found`,
      fromRunNodeNotFound: (id) => `fromRunNodeId '${id}' not found`,
      toRunNodeNotFound: (id) => `toRunNodeId '${id}' not found`,
      missingRunIndex: 'missing run/index.md',
      childTaskGroupNotFound: (id) => `childTaskGroupId '${id}' not found`,
      missingTasksDirectory: "missing tasks/ directory",
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
      invalidStatus: (status) => `유효하지 않은 status '${status}'`,
      invalidRunReadiness: (value) => `유효하지 않은 runReadiness '${value}'`,
      invalidUnderstandingLevel: (value) => `유효하지 않은 understandingLevel '${value}'`,
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
      projectIdMustBe: (id) => `projectId는 '${id}'여야 함`,
      runIdMustBe: (id) => `runId는 '${id}'여야 함`,
      sourceTaskGroupVersionNotFound: (id) => `sourceTaskGroupVersionId '${id}'를 찾지 못함`,
      sourceTaskNotFound: (id) => `sourceTaskId '${id}'를 찾지 못함`,
      fromRunNodeNotFound: (id) => `fromRunNodeId '${id}'를 찾지 못함`,
      toRunNodeNotFound: (id) => `toRunNodeId '${id}'를 찾지 못함`,
      missingRunIndex: 'run/index.md가 없음',
      childTaskGroupNotFound: (id) => `childTaskGroupId '${id}'를 찾지 못함`,
      missingTasksDirectory: 'tasks/ 디렉터리가 없음',
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

export function parseScalar(value) {
  const stripped = String(value).trim();
  if (stripped === 'true') return true;
  if (stripped === 'false') return false;
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
      if (!itemText.includes(':')) {
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
      if (fm.entityType === 'project') return [full];
    } catch {}
  }
  const projects = listDirs(full).filter((dir) => {
    const indexPath = join(dir, 'index.md');
    if (!fileExists(indexPath)) return false;
    try {
      return parseMarkdownFile(indexPath).entityType === 'project';
    } catch {
      return false;
    }
  });
  if (projects.length === 0) throw new Error(`No TaskOps project found under ${inputPath}`);
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
  if (project.entityType !== 'project') errors.push(withPath(projectIndex, t.entityTypeMustBe('project')));
  if (!STATUS_VALUES.includes(project.status)) errors.push(withPath(projectIndex, t.invalidStatus(project.status)));

  const taskGroups = new Map();
  const versions = new Map();
  const tasks = new Map();
  const snapshots = new Map();
  const runNodes = new Map();
  const runEdges = new Map();

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
      const versionRecord = { ...v, path: versionDir, tasks: [] };
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
        const key = `${v.id}:${task.id}`;
        if (tasks.has(key)) errors.push(withPath(taskPath, t.duplicateTaskKey(key)));
        const taskRecord = { ...task, path: taskPath };
        tasks.set(key, taskRecord);
        versionRecord.tasks.push(taskRecord);
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

  const runIndex = join(projectDir, 'run', 'index.md');
  if (fileExists(runIndex)) {
    const run = parseMarkdownFile(runIndex);
    checkFields(run, ['taskOpsVersion', 'entityType', 'id', 'projectId', 'createdAt'], runIndex, errors, language);
    if (run.entityType !== 'run') errors.push(withPath(runIndex, t.entityTypeMustBe('run')));
    if (run.projectId !== project.id) errors.push(withPath(runIndex, t.projectIdMustBe(project.id)));

    for (const nodePath of listMd(join(projectDir, 'run', 'nodes'))) {
      const node = parseMarkdownFile(nodePath);
      checkFields(node, ['taskOpsVersion', 'entityType', 'id', 'runId', 'type', 'title', 'status', 'createdAt'], nodePath, errors, language);
      if (node.entityType !== 'runNode') errors.push(withPath(nodePath, t.entityTypeMustBe('runNode')));
      if (node.id !== basename(nodePath, '.md')) errors.push(withPath(nodePath, t.idMustMatchFileName(basename(nodePath, '.md'))));
      if (node.runId !== run.id) errors.push(withPath(nodePath, t.runIdMustBe(run.id)));
      if (node.sourceTaskGroupVersionId && !versions.has(node.sourceTaskGroupVersionId)) errors.push(withPath(nodePath, t.sourceTaskGroupVersionNotFound(node.sourceTaskGroupVersionId)));
      if (node.sourceTaskId) {
        const found = [...tasks.values()].some((t) => t.id === node.sourceTaskId);
        if (!found) errors.push(withPath(nodePath, t.sourceTaskNotFound(node.sourceTaskId)));
      }
      runNodes.set(node.id, { ...node, path: nodePath });
    }
    for (const edgePath of listMd(join(projectDir, 'run', 'edges'))) {
      const edge = parseMarkdownFile(edgePath);
      checkFields(edge, ['taskOpsVersion', 'entityType', 'id', 'runId', 'fromRunNodeId', 'toRunNodeId', 'edgeType', 'createdAt'], edgePath, errors, language);
      if (edge.entityType !== 'runEdge') errors.push(withPath(edgePath, t.entityTypeMustBe('runEdge')));
      if (edge.id !== basename(edgePath, '.md')) errors.push(withPath(edgePath, t.idMustMatchFileName(basename(edgePath, '.md'))));
      if (edge.runId !== run.id) errors.push(withPath(edgePath, t.runIdMustBe(run.id)));
      if (!runNodes.has(edge.fromRunNodeId)) errors.push(withPath(edgePath, t.fromRunNodeNotFound(edge.fromRunNodeId)));
      if (!runNodes.has(edge.toRunNodeId)) errors.push(withPath(edgePath, t.toRunNodeNotFound(edge.toRunNodeId)));
      runEdges.set(edge.id, { ...edge, path: edgePath });
    }
  } else {
    warnings.push(withPath(projectDir, t.missingRunIndex));
  }

  for (const version of versions.values()) {
    for (const task of version.tasks) {
      if (task.childTaskGroupId && !taskGroups.has(task.childTaskGroupId)) errors.push(withPath(task.path, t.childTaskGroupNotFound(task.childTaskGroupId)));
    }
  }

  return { projectDir, project, taskGroups, versions, tasks, snapshots, runNodes, runEdges, errors, warnings, language };
}

export function classifyTaskReadiness(task) {
  if (!task || typeof task !== 'object') throw new Error('Task is required');
  if (task.runReadiness && RUN_READINESS_VALUES.includes(task.runReadiness)) {
    return {
      taskId: task.id,
      runReadiness: task.runReadiness,
      source: 'explicit',
      reason: task.runReadinessReason || 'Task declares runReadiness explicitly.',
      nextAction: nextActionForRunReadiness(task.runReadiness),
    };
  }

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
  const runNodes = [...parsed.runNodes.values()];
  const runEdges = [...parsed.runEdges.values()];
  const countsByStatus = STATUS_VALUES.map((status) => [status, tasks.filter((t) => t.status === status).length]);
  const countsByReadiness = RUN_READINESS_VALUES.map((value) => [value, tasks.filter((task) => classifyTaskReadiness(task).runReadiness === value).length]);
  const activeSnapshot = project.activeSnapshotId ? parsed.snapshots.get(project.activeSnapshotId) : null;
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
    `- ${SUMMARY_LABELS.runNodes}: ${runNodes.length}`,
    `- ${SUMMARY_LABELS.runEdges}: ${runEdges.length}`,
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
      lines.push(`- ${t.node} ${node.id} [${node.status}] type=${node.type}${node.sourceTaskId ? ` sourceTask=${node.sourceTaskId}` : ''}`);
    }
  }
  lines.push('', `## ${SUMMARY_LABELS.runEdges}`);
  if (runEdges.length === 0) lines.push(`- ${t.none}`);
  else {
    for (const edge of runEdges.sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
      lines.push(`- ${t.edge} ${edge.id}: ${edge.fromRunNodeId} -${edge.edgeType}-> ${edge.toRunNodeId}`);
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

function fmBlock(data) {
  const lines = ['---'];
  const emit = (key, value, indent = '') => {
    if (Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entries = Object.entries(item);
          if (entries.length === 0) lines.push(`${indent}  - {}`);
          else {
            const [firstK, firstV] = entries[0];
            lines.push(`${indent}  - ${firstK}: ${firstV}`);
            for (const [k, v] of entries.slice(1)) lines.push(`${indent}    ${k}: ${v}`);
          }
        } else {
          lines.push(`${indent}  - ${item}`);
        }
      }
      return;
    }
    lines.push(`${indent}${key}: ${value}`);
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
  ensureDir(join(root, 'snapshots'));
  ensureDir(join(root, 'run', 'nodes'));
  ensureDir(join(root, 'run', 'edges'));
  ensureDir(join(root, 'derived', 'canvases'));
  ensureDir(join(root, 'derived', 'views'));
  const now = isoNow();
  writeFileSync(join(root, 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'project', id, title, objective, language: resolvedLanguage, activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' }) + `# ${title}\n`, 'utf8');
  writeFileSync(join(root, 'project-log.md'), `# Project log\n\n- ${t.projectInitialized}\n`, 'utf8');
  writeFileSync(join(root, 'task-groups', 'tg-root', 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective, activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' }) + '# Root task group\n', 'utf8');
  writeFileSync(join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: t.initialRootDecomposition, selected: true, createdAt: now, status: 'active' }) + '# Root version\n', 'utf8');
  writeFileSync(join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'decomposition-log.md'), `# Decomposition log\n\n- ${t.initialVersionCreated}\n`, 'utf8');
  writeFileSync(join(root, 'snapshots', 'snapshot-root-v1.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: t.initialSnapshot, status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] }) + '# Snapshot root v1\n', 'utf8');
  writeFileSync(join(root, 'run', 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'run', id: 'run-main', projectId: id, createdAt: now, status: 'active' }) + '# Run main\n', 'utf8');
  writeFileSync(join(root, 'run', 'run-log.md'), `# Run log\n\n- ${t.runInitialized}\n`, 'utf8');
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
  const now = isoNow();
  const versionFm = { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: versionId, taskGroupId, version: spec.version ?? versionId, summary: spec.summary, createdAt: now, status: spec.status ?? 'active' };
  if (supersedesVersionId) versionFm.supersedesVersionId = supersedesVersionId;
  if (spec.selected === true) versionFm.selected = true;
  writeFileSync(join(versionDir, 'index.md'), fmBlock(versionFm) + `# ${spec.summary}\n`, 'utf8');
  writeFileSync(join(versionDir, 'decomposition-log.md'), `# Decomposition log\n\n- ${t.versionCreatedFromSpec}\n`, 'utf8');
  (spec.tasks || []).forEach((task, i) => {
    const fm = {
      taskOpsVersion: 'v1', entityType: 'task', id: task.id, taskGroupId, taskGroupVersionId: versionId,
      title: task.title, objective: task.objective, responsibility: task.responsibility,
      completionCriteria: task.completionCriteria, order: task.order ?? i + 1, createdAt: now, status: task.status ?? 'pending'
    };
    for (const key of ['role', 'purpose', 'runReadiness', 'runReadinessReason', 'understandingLevel', 'decompositionConfidence', 'executionConfidence', 'explorationNeeded', 'nextLearningGoal', 'childTaskGroupId']) {
      if (task[key] !== undefined && task[key] !== null) fm[key] = task[key];
    }
    if (Array.isArray(task.unknowns)) fm.unknowns = task.unknowns;
    writeFileSync(join(versionDir, 'tasks', `${task.id}.md`), fmBlock(fm) + `# ${task.title}\n`, 'utf8');
  });
  return versionDir;
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
