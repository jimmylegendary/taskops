import { App, TFile, TFolder } from 'obsidian';

export type EntityType =
  | 'project'
  | 'taskGroup'
  | 'taskGroupVersion'
  | 'task'
  | 'versionSnapshot'
  | 'run'
  | 'runNode'
  | 'runEdge';

export interface Entity {
  type: EntityType;
  id: string;
  title: string;
  status: string;
  file: TFile;
  folderPath: string | null;
  frontmatter: Record<string, unknown>;
  children: Entity[];
  issues: string[];
  extras?: Record<string, unknown>;
}

export interface ScanResult {
  projects: Entity[];
  globalIssues: string[];
}

const REQUIRED_COMMON = ['taskOpsVersion', 'entityType', 'id'] as const;
const STATUS_VALUES = new Set(['pending', 'active', 'done', 'blocked', 'cancelled']);

function getFrontmatter(app: App, file: TFile): Record<string, unknown> | null {
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter;
  if (!fm) return null;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(fm)) {
    if (key === 'position') continue;
    copy[key] = (fm as Record<string, unknown>)[key];
  }
  return copy;
}

function findChildFolder(folder: TFolder, name: string): TFolder | null {
  for (const child of folder.children) {
    if (child instanceof TFolder && child.name === name) return child;
  }
  return null;
}

function findIndexFile(folder: TFolder): TFile | null {
  for (const child of folder.children) {
    if (child instanceof TFile && child.name === 'index.md') return child;
  }
  return null;
}

function listMdFiles(folder: TFolder): TFile[] {
  const out: TFile[] = [];
  for (const child of folder.children) {
    if (child instanceof TFile && child.extension === 'md') out.push(child);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function listFolders(folder: TFolder): TFolder[] {
  const out: TFolder[] = [];
  for (const child of folder.children) {
    if (child instanceof TFolder) out.push(child);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function commonIssues(fm: Record<string, unknown>, expectedType: EntityType, expectedId: string | null): string[] {
  const issues: string[] = [];
  for (const key of REQUIRED_COMMON) {
    if (fm[key] === undefined || fm[key] === null || fm[key] === '') {
      issues.push(`missing required frontmatter field: ${key}`);
    }
  }
  if (fm.entityType !== expectedType) issues.push(`entityType mismatch: got '${String(fm.entityType)}', expected '${expectedType}'`);
  if (expectedId && typeof fm.id === 'string' && fm.id !== expectedId) issues.push(`id mismatch: frontmatter id '${fm.id}' does not match location '${expectedId}'`);
  const status = fm.status;
  if (status !== undefined && status !== null && status !== '' && !STATUS_VALUES.has(String(status))) {
    issues.push(`invalid status '${String(status)}'`);
  }
  return issues;
}

function titleFor(type: EntityType, fm: Record<string, unknown>, fallback: string): string {
  if (typeof fm.title === 'string' && fm.title.trim()) return fm.title;
  if (typeof fm.summary === 'string' && fm.summary.trim()) return fm.summary;
  if (typeof fm.objective === 'string' && fm.objective.trim()) return fm.objective;
  if (typeof fm.label === 'string' && fm.label.trim()) return fm.label;
  return fallback;
}

function entityFromIndex(app: App, folder: TFolder, expectedType: EntityType): Entity | null {
  const index = findIndexFile(folder);
  if (!index) return null;
  const fm = getFrontmatter(app, index);
  if (!fm || fm.entityType !== expectedType) return null;
  const id = typeof fm.id === 'string' ? fm.id : folder.name;
  return {
    type: expectedType,
    id,
    title: titleFor(expectedType, fm, id),
    status: typeof fm.status === 'string' ? fm.status : 'unknown',
    file: index,
    folderPath: folder.path,
    frontmatter: fm,
    children: [],
    issues: commonIssues(fm, expectedType, folder.name),
  };
}

function entityFromLeafFile(app: App, file: TFile, expectedType: EntityType): Entity | null {
  const fm = getFrontmatter(app, file);
  if (!fm || fm.entityType !== expectedType) return null;
  const expectedId = file.basename;
  const id = typeof fm.id === 'string' ? fm.id : expectedId;
  return {
    type: expectedType,
    id,
    title: titleFor(expectedType, fm, id),
    status: typeof fm.status === 'string' ? fm.status : 'unknown',
    file,
    folderPath: null,
    frontmatter: fm,
    children: [],
    issues: commonIssues(fm, expectedType, expectedId),
  };
}

function buildTaskGroupVersion(app: App, versionFolder: TFolder, projectId: string, taskGroupId: string): Entity {
  const version = entityFromIndex(app, versionFolder, 'taskGroupVersion') ?? {
    type: 'taskGroupVersion' as const,
    id: versionFolder.name,
    title: versionFolder.name,
    status: 'unknown',
    file: (findIndexFile(versionFolder) as TFile) ?? (versionFolder as unknown as TFile),
    folderPath: versionFolder.path,
    frontmatter: {},
    children: [],
    issues: ['taskGroupVersion folder missing valid index.md with entityType: taskGroupVersion'],
  };
  if (version.frontmatter.taskGroupId && version.frontmatter.taskGroupId !== taskGroupId) {
    version.issues.push(`taskGroupId should be '${taskGroupId}'`);
  }
  const tasksFolder = findChildFolder(versionFolder, 'tasks');
  if (!tasksFolder) {
    version.issues.push("missing 'tasks/' folder");
    return version;
  }
  for (const file of listMdFiles(tasksFolder)) {
    const task = entityFromLeafFile(app, file, 'task');
    if (!task) {
      version.issues.push(`task file '${file.name}' missing valid frontmatter (entityType: task)`);
      continue;
    }
    if (task.frontmatter.taskGroupId !== taskGroupId) task.issues.push(`taskGroupId should be '${taskGroupId}'`);
    if (task.frontmatter.taskGroupVersionId !== version.id) task.issues.push(`taskGroupVersionId should be '${version.id}'`);
    task.extras = {
      order: typeof task.frontmatter.order === 'number' ? Number(task.frontmatter.order) : Number.MAX_SAFE_INTEGER,
      childTaskGroupId: typeof task.frontmatter.childTaskGroupId === 'string' ? task.frontmatter.childTaskGroupId : null,
    };
    version.children.push(task);
  }
  version.children.sort((a, b) => Number(a.extras?.order ?? 0) - Number(b.extras?.order ?? 0));
  return version;
}

function buildTaskGroup(app: App, taskGroupFolder: TFolder, projectId: string): Entity {
  const taskGroup = entityFromIndex(app, taskGroupFolder, 'taskGroup') ?? {
    type: 'taskGroup' as const,
    id: taskGroupFolder.name,
    title: taskGroupFolder.name,
    status: 'unknown',
    file: (findIndexFile(taskGroupFolder) as TFile) ?? (taskGroupFolder as unknown as TFile),
    folderPath: taskGroupFolder.path,
    frontmatter: {},
    children: [],
    issues: ['taskGroup folder missing valid index.md with entityType: taskGroup'],
  };
  const versionsFolder = findChildFolder(taskGroupFolder, 'versions');
  if (!versionsFolder) {
    taskGroup.issues.push("missing 'versions/' folder");
    return taskGroup;
  }
  let selectedCount = 0;
  for (const versionFolder of listFolders(versionsFolder)) {
    const version = buildTaskGroupVersion(app, versionFolder, projectId, taskGroup.id);
    if (version.frontmatter.selected === true) selectedCount += 1;
    taskGroup.children.push(version);
  }
  if (selectedCount > 1) taskGroup.issues.push(`contains ${selectedCount} selected versions (expected at most 1)`);
  return taskGroup;
}

function buildSnapshots(app: App, snapshotsFolder: TFolder, taskGroupIds: Set<string>, versionIds: Set<string>): Entity[] {
  const snapshots: Entity[] = [];
  for (const file of listMdFiles(snapshotsFolder)) {
    const snapshot = entityFromLeafFile(app, file, 'versionSnapshot');
    if (!snapshot) continue;
    const selectedVersions = Array.isArray(snapshot.frontmatter.selectedVersions)
      ? (snapshot.frontmatter.selectedVersions as Array<Record<string, unknown>>)
      : [];
    if (!Array.isArray(snapshot.frontmatter.selectedVersions)) snapshot.issues.push('selectedVersions must be a list');
    if (typeof snapshot.frontmatter.rootTaskGroupId === 'string' && !taskGroupIds.has(snapshot.frontmatter.rootTaskGroupId)) {
      snapshot.issues.push(`rootTaskGroupId '${String(snapshot.frontmatter.rootTaskGroupId)}' not found`);
    }
    let selectedCount = 0;
    for (const entry of selectedVersions) {
      const taskGroupId = typeof entry?.taskGroupId === 'string' ? entry.taskGroupId : null;
      const versionId = typeof entry?.versionId === 'string' ? entry.versionId : null;
      if (!taskGroupId || !versionId) {
        snapshot.issues.push('selectedVersions entry missing taskGroupId or versionId');
        continue;
      }
      selectedCount += 1;
      if (!taskGroupIds.has(taskGroupId)) snapshot.issues.push(`selected taskGroupId '${taskGroupId}' not found`);
      if (!versionIds.has(versionId)) snapshot.issues.push(`selected versionId '${versionId}' not found`);
    }
    snapshot.extras = { selectedCount };
    snapshots.push(snapshot);
  }
  return snapshots;
}

function buildRun(app: App, runFolder: TFolder, versionIds: Set<string>, taskIds: Set<string>): Entity | null {
  const run = entityFromIndex(app, runFolder, 'run');
  if (!run) return null;
  const nodesFolder = findChildFolder(runFolder, 'nodes');
  const edgesFolder = findChildFolder(runFolder, 'edges');
  const seenNodes = new Set<string>();

  if (!nodesFolder) run.issues.push("missing 'nodes/' folder");
  if (!edgesFolder) run.issues.push("missing 'edges/' folder");

  if (nodesFolder) {
    for (const file of listMdFiles(nodesFolder)) {
      const node = entityFromLeafFile(app, file, 'runNode');
      if (!node) {
        run.issues.push(`run node file '${file.name}' missing valid frontmatter (entityType: runNode)`);
        continue;
      }
      if (node.frontmatter.runId !== run.id) node.issues.push(`runId should be '${run.id}'`);
      if (typeof node.frontmatter.sourceTaskGroupVersionId === 'string' && !versionIds.has(node.frontmatter.sourceTaskGroupVersionId)) {
        node.issues.push(`sourceTaskGroupVersionId '${String(node.frontmatter.sourceTaskGroupVersionId)}' not found`);
      }
      if (typeof node.frontmatter.sourceTaskId === 'string' && !taskIds.has(node.frontmatter.sourceTaskId)) {
        node.issues.push(`sourceTaskId '${String(node.frontmatter.sourceTaskId)}' not found`);
      }
      seenNodes.add(node.id);
      run.children.push(node);
    }
  }

  if (edgesFolder) {
    for (const file of listMdFiles(edgesFolder)) {
      const edge = entityFromLeafFile(app, file, 'runEdge');
      if (!edge) {
        run.issues.push(`run edge file '${file.name}' missing valid frontmatter (entityType: runEdge)`);
        continue;
      }
      if (edge.frontmatter.runId !== run.id) edge.issues.push(`runId should be '${run.id}'`);
      if (typeof edge.frontmatter.fromRunNodeId === 'string' && !seenNodes.has(edge.frontmatter.fromRunNodeId)) {
        edge.issues.push(`fromRunNodeId '${String(edge.frontmatter.fromRunNodeId)}' not found`);
      }
      if (typeof edge.frontmatter.toRunNodeId === 'string' && !seenNodes.has(edge.frontmatter.toRunNodeId)) {
        edge.issues.push(`toRunNodeId '${String(edge.frontmatter.toRunNodeId)}' not found`);
      }
      run.children.push(edge);
    }
  }

  return run;
}

function buildProject(app: App, projectFolder: TFolder): Entity {
  const project = entityFromIndex(app, projectFolder, 'project');
  if (!project) throw new Error(`buildProject called on non-project folder ${projectFolder.path}`);

  const taskGroupsFolder = findChildFolder(projectFolder, 'task-groups');
  if (!taskGroupsFolder) project.issues.push("project has no 'task-groups/' folder");

  const taskGroupIds = new Set<string>();
  const versionIds = new Set<string>();
  const taskIds = new Set<string>();

  if (taskGroupsFolder) {
    for (const folder of listFolders(taskGroupsFolder)) {
      const taskGroup = buildTaskGroup(app, folder, project.id);
      taskGroupIds.add(taskGroup.id);
      for (const version of taskGroup.children) {
        versionIds.add(version.id);
        for (const task of version.children) taskIds.add(task.id);
      }
      project.children.push(taskGroup);
    }
  }

  const snapshotsFolder = findChildFolder(projectFolder, 'snapshots');
  if (snapshotsFolder) {
    for (const snapshot of buildSnapshots(app, snapshotsFolder, taskGroupIds, versionIds)) {
      project.children.push(snapshot);
    }
  } else {
    project.issues.push("project has no 'snapshots/' folder");
  }

  const runFolder = findChildFolder(projectFolder, 'run');
  if (runFolder) {
    const run = buildRun(app, runFolder, versionIds, taskIds);
    if (run) project.children.push(run);
    else project.issues.push("run folder missing valid index.md with entityType: run");
  } else {
    project.issues.push("project has no 'run/' folder");
  }

  if (typeof project.frontmatter.activeRootTaskGroupId === 'string' && !taskGroupIds.has(project.frontmatter.activeRootTaskGroupId)) {
    project.issues.push(`activeRootTaskGroupId '${String(project.frontmatter.activeRootTaskGroupId)}' not found`);
  }
  if (typeof project.frontmatter.activeSnapshotId === 'string') {
    const hasSnapshot = project.children.some((child) => child.type === 'versionSnapshot' && child.id === project.frontmatter.activeSnapshotId);
    if (!hasSnapshot) project.issues.push(`activeSnapshotId '${String(project.frontmatter.activeSnapshotId)}' not found`);
  }

  project.children.sort((a, b) => {
    const order: Record<EntityType, number> = {
      project: 0,
      taskGroup: 1,
      versionSnapshot: 2,
      run: 3,
      taskGroupVersion: 4,
      task: 5,
      runNode: 6,
      runEdge: 7,
    };
    const diff = order[a.type] - order[b.type];
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  return project;
}

export function scanProjects(app: App): ScanResult {
  const projects: Entity[] = [];
  const globalIssues: string[] = [];
  const seenProjectIds = new Set<string>();

  for (const file of app.vault.getMarkdownFiles()) {
    if (file.name !== 'index.md') continue;
    const fm = getFrontmatter(app, file);
    if (!fm || fm.entityType !== 'project') continue;
    const parent = file.parent;
    if (!(parent instanceof TFolder)) continue;
    const project = buildProject(app, parent);
    if (seenProjectIds.has(project.id)) globalIssues.push(`duplicate project id '${project.id}' at ${parent.path}`);
    seenProjectIds.add(project.id);
    projects.push(project);
  }

  projects.sort((a, b) => a.id.localeCompare(b.id));
  return { projects, globalIssues };
}

export function collectIssues(entity: Entity, out: string[] = []): string[] {
  for (const issue of entity.issues) out.push(`[${entity.type} ${entity.id}] ${issue}`);
  for (const child of entity.children) collectIssues(child, out);
  return out;
}
