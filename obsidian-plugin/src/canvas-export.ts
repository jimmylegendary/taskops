import { Notice, normalizePath, type App } from 'obsidian';
import type { Entity } from './parser';

export interface CanvasNodeData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  type: 'file' | 'group';
  file?: string;
  label?: string;
}

export interface CanvasEdgeData {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'left' | 'right' | 'top' | 'bottom';
  toSide?: 'left' | 'right' | 'top' | 'bottom';
  toEnd?: 'none' | 'arrow';
  color?: string;
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
}

export type CanvasViewMode = 'task-groups' | 'snapshots' | 'run';

const COLORS: Record<string, string> = {
  work: '#94A3B8',
  project: '#94A3B8',
  taskGroup: '#F59E0B',
  taskGroupVersion: '#60A5FA',
  task: '#10B981',
  versionSnapshot: '#8B5CF6',
  run: '#334155',
  runNode: '#2563EB',
  runEdge: '#64748B',
  eow: '#EF4444',
  active: '#2563EB',
  done: '#16A34A',
  blocked: '#DC2626',
  waiting: '#F97316',
  pending: '#94A3B8',
  cancelled: '#6B7280',
};

const SIZE: Record<string, [number, number]> = {
  work: [320, 100],
  project: [320, 100],
  taskGroup: [280, 92],
  taskGroupVersion: [260, 84],
  task: [240, 78],
  versionSnapshot: [260, 84],
  run: [260, 84],
  runNode: [240, 78],
  runEdge: [220, 72],
  eow: [200, 70],
};

function key(entity: Entity): string {
  return `${entity.type}-${entity.id}-${entity.file.path.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function fileNode(entity: Entity, x: number, y: number, color?: string): CanvasNodeData {
  const [width, height] = SIZE[entity.type] ?? [240, 80];
  return { id: key(entity), type: 'file', file: entity.file.path, x, y, width, height, color };
}

function groupNode(id: string, label: string, x: number, y: number, width: number, height: number, color?: string): CanvasNodeData {
  return { id, type: 'group', label, x, y, width, height, color };
}

function edge(fromNode: string, toNode: string, color?: string, label?: string): CanvasEdgeData {
  return { id: `${fromNode}--${toNode}`, fromNode, toNode, fromSide: 'right', toSide: 'left', toEnd: 'arrow', color, label };
}

function statusColor(status: string): string {
  return COLORS[status] ?? COLORS.pending;
}

function taskGroupsOf(project: Entity): Entity[] {
  return project.children.filter((child) => child.type === 'taskGroup');
}

function snapshotsOf(project: Entity): Entity[] {
  return project.children.filter((child) => child.type === 'versionSnapshot');
}

function runsOf(project: Entity): Entity[] {
  return project.children.filter((child) => child.type === 'run');
}

function buildTaskGroupCanvas(project: Entity): CanvasData {
  const nodes: CanvasNodeData[] = [];
  const edges: CanvasEdgeData[] = [];
  const projectNode = fileNode(project, 0, 0, COLORS[project.type] ?? COLORS.project);
  nodes.push(projectNode);

  taskGroupsOf(project).forEach((taskGroup, tgIndex) => {
    const x = tgIndex * 920;
    const y = 220;
    const group = groupNode(`group-${key(taskGroup)}`, `${taskGroup.id} · ${taskGroup.status}`, x - 24, y - 24, 860, 520, COLORS.taskGroup);
    nodes.push(group);
    const taskGroupNode = fileNode(taskGroup, x, y, COLORS.taskGroup);
    nodes.push(taskGroupNode);
    edges.push(edge(projectNode.id, taskGroupNode.id, statusColor(taskGroup.status), 'taskGroup'));

    taskGroup.children.forEach((version, versionIndex) => {
      const versionX = x + versionIndex * 280;
      const versionY = y + 150;
      const versionNode = fileNode(version, versionX, versionY, COLORS.taskGroupVersion);
      nodes.push(versionNode);
      edges.push(edge(taskGroupNode.id, versionNode.id, COLORS.taskGroupVersion, version.frontmatter.selected === true ? 'selected' : 'version'));

      version.children.forEach((task, taskIndex) => {
        const color = task.type === 'eow' ? COLORS.eow : COLORS.task;
        const taskNode = fileNode(task, versionX, versionY + 140 + taskIndex * 104, color);
        nodes.push(taskNode);
        let label = task.type === 'eow' ? `EoW -> ${String(task.frontmatter.attachedToId ?? '')}` : 'task';
        if (task.type === 'task' && typeof task.frontmatter.childTaskGroupId === 'string') label = `task -> ${task.frontmatter.childTaskGroupId}`;
        edges.push(edge(versionNode.id, taskNode.id, statusColor(task.status), label));
      });
    });
  });

  return { nodes, edges };
}

function buildSnapshotCanvas(project: Entity): CanvasData {
  const nodes: CanvasNodeData[] = [];
  const edges: CanvasEdgeData[] = [];
  const projectNode = fileNode(project, 0, 0, COLORS[project.type] ?? COLORS.project);
  nodes.push(projectNode);
  const versionNodeMap = new Map<string, CanvasNodeData>();

  taskGroupsOf(project).forEach((taskGroup, tgIndex) => {
    taskGroup.children.forEach((version, versionIndex) => {
      const x = 420 + tgIndex * 360;
      const y = 320 + versionIndex * 140;
      const node = fileNode(version, x, y, COLORS.taskGroupVersion);
      versionNodeMap.set(version.id, node);
      nodes.push(node);
    });
  });

  snapshotsOf(project).forEach((snapshot, idx) => {
    const snapX = idx * 340;
    const snapY = 140;
    const snapshotNode = fileNode(snapshot, snapX, snapY, COLORS.versionSnapshot);
    nodes.push(snapshotNode);
    edges.push(edge(projectNode.id, snapshotNode.id, COLORS.versionSnapshot, 'snapshot'));
    const selectedVersions = Array.isArray(snapshot.frontmatter.selectedVersions)
      ? (snapshot.frontmatter.selectedVersions as Array<Record<string, unknown>>)
      : [];
    for (const pair of selectedVersions) {
      const versionId = typeof pair?.versionId === 'string' ? pair.versionId : null;
      if (!versionId) continue;
      const versionNode = versionNodeMap.get(versionId);
      if (versionNode) edges.push(edge(snapshotNode.id, versionNode.id, COLORS.taskGroupVersion, 'selects'));
    }
  });

  return { nodes, edges };
}

function buildRunCanvas(project: Entity): CanvasData {
  const nodes: CanvasNodeData[] = [];
  const edges: CanvasEdgeData[] = [];
  const projectNode = fileNode(project, 0, 0, COLORS[project.type] ?? COLORS.project);
  nodes.push(projectNode);
  const runs = runsOf(project);
  if (runs.length === 0) return { nodes, edges };

  runs.forEach((run, runIndex) => {
    const baseY = 180 + runIndex * 420;
    const runNode = fileNode(run, 0, baseY, COLORS.run);
    nodes.push(runNode);
    edges.push(edge(projectNode.id, runNode.id, COLORS.run, 'run'));

    const graphNodes = run.children.filter((child) => child.type === 'runNode' || child.type === 'eow');
    const runEdges = run.children.filter((child) => child.type === 'runEdge');
    const runNodeMap = new Map<string, CanvasNodeData>();

    graphNodes.forEach((nodeEntity, idx) => {
      const x = idx * 320;
      const y = baseY + 160;
      const color = nodeEntity.type === 'eow' ? COLORS.eow : COLORS.runNode;
      const node = fileNode(nodeEntity, x, y, color);
      nodes.push(node);
      runNodeMap.set(nodeEntity.id, node);
      const label = nodeEntity.type === 'eow' ? `EoW -> ${String(nodeEntity.frontmatter.attachedToId ?? '')}` : String(nodeEntity.frontmatter.type ?? 'runNode');
      edges.push(edge(runNode.id, node.id, statusColor(nodeEntity.status), label));
    });

    runEdges.forEach((edgeEntity, idx) => {
      const fromId = typeof edgeEntity.frontmatter.fromRunNodeId === 'string' ? edgeEntity.frontmatter.fromRunNodeId : null;
      const toId = typeof edgeEntity.frontmatter.toRunNodeId === 'string' ? edgeEntity.frontmatter.toRunNodeId : null;
      if (fromId && toId && runNodeMap.has(fromId) && runNodeMap.has(toId)) {
        edges.push(edge(runNodeMap.get(fromId)!.id, runNodeMap.get(toId)!.id, COLORS.runEdge, String(edgeEntity.frontmatter.edgeType ?? 'edge')));
      } else {
        const stub = fileNode(edgeEntity, idx * 260, baseY + 340, COLORS.runEdge);
        nodes.push(stub);
        edges.push(edge(runNode.id, stub.id, COLORS.runEdge, 'edge-record'));
      }
    });
  });

  return { nodes, edges };
}

function buildCanvas(project: Entity, mode: CanvasViewMode): CanvasData {
  if (mode === 'task-groups') return buildTaskGroupCanvas(project);
  if (mode === 'snapshots') return buildSnapshotCanvas(project);
  return buildRunCanvas(project);
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (normalized === '.' || normalized === '/') return;
  if (await app.vault.adapter.exists(normalized)) return;
  const parent = normalized.split('/').slice(0, -1).join('/');
  if (parent && parent !== normalized) await ensureFolder(app, parent);
  await app.vault.createFolder(normalized).catch(() => {});
}

async function writeFile(app: App, path: string, content: string) {
  const normalized = normalizePath(path);
  const parent = normalized.split('/').slice(0, -1).join('/');
  if (parent) await ensureFolder(app, parent);
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (existing && 'path' in existing) return app.vault.modify(existing as never, content);
  return app.vault.create(normalized, content);
}

function projectForActiveFile(projects: Entity[], active: unknown): Entity | null {
  if (!active || typeof active !== 'object' || !('path' in active)) return projects.length === 1 ? projects[0] : null;
  const activePath = String((active as { path: string }).path);
  for (const project of projects) {
    if (!project.folderPath) continue;
    if (activePath === `${project.folderPath}/index.md` || activePath.startsWith(`${project.folderPath}/`)) return project;
  }
  return projects.length === 1 ? projects[0] : null;
}

async function exportProject(app: App, project: Entity, openFirst: boolean) {
  if (!project.folderPath) throw new Error(`project ${project.id} is missing folderPath`);
  const files: Array<{ mode: CanvasViewMode; path: string }> = [];
  for (const mode of ['task-groups', 'snapshots', 'run'] as const) {
    const data = buildCanvas(project, mode);
    const path = normalizePath(`${project.folderPath}/derived/canvases/${project.id}-${mode}-view.canvas`);
    await writeFile(app, path, `${JSON.stringify(data, null, 2)}\n`);
    files.push({ mode, path });
  }
  if (openFirst) {
    const first = app.vault.getAbstractFileByPath(files[0].path);
    if (first) await app.workspace.getLeaf(true).openFile(first as never);
  }
  return { project, files };
}

export async function exportActiveProjectCanvases(app: App, projects: Entity[]): Promise<void> {
  if (projects.length === 0) {
    new Notice('TaskOps: no projects found to export');
    return;
  }
  const activeProject = projectForActiveFile(projects, app.workspace.getActiveFile());
  if (!activeProject) {
    new Notice('TaskOps: open a note inside a project first, or use export-all');
    return;
  }
  const result = await exportProject(app, activeProject, true);
  new Notice(`TaskOps: exported ${result.files.length} canvas views for ${result.project.id}`);
}

export async function exportAllProjectCanvases(app: App, projects: Entity[]): Promise<void> {
  if (projects.length === 0) {
    new Notice('TaskOps: no projects found to export');
    return;
  }
  for (const project of projects) await exportProject(app, project, false);
  new Notice(`TaskOps: exported canvas views for ${projects.length} project${projects.length === 1 ? '' : 's'}`);
}

export function describeCanvasPaths(project: Entity): string[] {
  if (!project.folderPath) return [];
  return (['task-groups', 'snapshots', 'run'] as CanvasViewMode[]).map((mode) => normalizePath(`${project.folderPath}/derived/canvases/${project.id}-${mode}-view.canvas`));
}
