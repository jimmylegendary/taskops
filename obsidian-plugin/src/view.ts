import { ItemView, WorkspaceLeaf, setIcon, TFile } from 'obsidian';
import type TaskOpsPlugin from './main';
import { scanProjects, Entity, collectIssues } from './parser';
import { exportAllProjectCanvases, exportActiveProjectCanvases } from './canvas-export';

export const VIEW_TYPE_GRAPH_TASK = 'graph-task-explorer';

const TYPE_ICONS: Record<Entity['type'], string> = {
  work: 'briefcase',
  project: 'folder-tree',
  taskGroup: 'list-tree',
  taskGroupVersion: 'git-branch-plus',
  task: 'check-square',
  versionSnapshot: 'camera',
  run: 'workflow',
  runNode: 'circle-dot',
  runEdge: 'waypoints',
  eow: 'flag',
};

function badgeText(entity: Entity): string[] {
  const badges = [entity.status];
  if (entity.type === 'taskGroupVersion' && entity.frontmatter.selected === true) badges.push('selected');
  if (entity.type === 'versionSnapshot' && typeof entity.extras?.selectedCount === 'number') badges.push(`${entity.extras.selectedCount} selections`);
  if (entity.type === 'task' && typeof entity.frontmatter.runReadiness === 'string') badges.push(String(entity.frontmatter.runReadiness));
  if (entity.type === 'task' && typeof entity.frontmatter.understandingLevel === 'string') badges.push(`understanding ${entity.frontmatter.understandingLevel}`);
  if (entity.type === 'task' && typeof entity.frontmatter.childTaskGroupId === 'string') badges.push(`child ${entity.frontmatter.childTaskGroupId}`);
  if (entity.type === 'runNode' && typeof entity.frontmatter.type === 'string') badges.push(String(entity.frontmatter.type));
  if (entity.type === 'runNode' && entity.status === 'waiting' && typeof entity.frontmatter.delegateeRef === 'string') badges.push(`waiting ${entity.frontmatter.delegateeRef}`);
  if (entity.type === 'eow' && typeof entity.frontmatter.graphType === 'string') badges.push(`EoW ${entity.frontmatter.graphType}`);
  if (entity.type === 'eow' && typeof entity.frontmatter.attachedToId === 'string') badges.push(`→ ${entity.frontmatter.attachedToId}`);
  if (entity.type === 'runEdge' && typeof entity.frontmatter.edgeType === 'string') badges.push(String(entity.frontmatter.edgeType));
  return badges;
}

export class GraphTaskView extends ItemView {
  plugin: TaskOpsPlugin;
  private collapsed: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: TaskOpsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_GRAPH_TASK; }
  getDisplayText(): string { return 'TaskOps Explorer'; }
  getIcon(): string { return 'folder-tree'; }
  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> {}
  refresh(): void { this.render(); }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('graph-task-view');

    const toolbar = container.createEl('div', { cls: 'graph-task-toolbar' });
    const refreshBtn = toolbar.createEl('button', { cls: 'graph-task-btn', text: 'Refresh' });
    setIcon(refreshBtn.createSpan({ cls: 'graph-task-btn-icon' }), 'refresh-cw');
    refreshBtn.addEventListener('click', () => this.refresh());
    toolbar.createEl('button', { cls: 'graph-task-btn', text: 'Expand all' }).addEventListener('click', () => { this.collapsed.clear(); this.render(); });
    const exportActiveBtn = toolbar.createEl('button', { cls: 'graph-task-btn', text: 'Export active canvas' });
    const exportAllBtn = toolbar.createEl('button', { cls: 'graph-task-btn', text: 'Export all canvases' });
    const collapseBtn = toolbar.createEl('button', { cls: 'graph-task-btn', text: 'Collapse all' });

    container.createEl('div', { cls: 'graph-task-warn', text: 'TaskOps canonical state stays in markdown. The plugin is read-only and exports derived canvases.' });

    const { projects, globalIssues } = scanProjects(this.app);
    exportActiveBtn.addEventListener('click', () => { void exportActiveProjectCanvases(this.app, projects); });
    exportAllBtn.addEventListener('click', () => { void exportAllProjectCanvases(this.app, projects); });

    if (projects.length === 0) {
      const empty = container.createEl('div', { cls: 'graph-task-empty' });
      empty.createEl('p', { text: 'No TaskOps work found in this vault.' });
      empty.createEl('p', { text: 'A work is any folder containing an index.md with frontmatter entityType: work. Legacy entityType: project is still readable.' });
      return;
    }

    collapseBtn.addEventListener('click', () => {
      this.collapsed.clear();
      for (const project of projects) this.markAllCollapsed(project);
      this.render();
    });

    const issues = [...globalIssues];
    for (const project of projects) collectIssues(project, issues);
    if (issues.length > 0) {
      const issueBox = container.createEl('details', { cls: 'graph-task-issues' });
      issueBox.createEl('summary', { text: `Validation issues (${issues.length})` });
      const ul = issueBox.createEl('ul');
      for (const issue of issues) ul.createEl('li', { text: issue });
    }

    const tree = container.createEl('div', { cls: 'graph-task-tree' });
    for (const project of projects) this.renderEntity(tree, project, 0);
  }

  private markAllCollapsed(entity: Entity): void {
    if (entity.children.length > 0) this.collapsed.add(this.entityKey(entity));
    for (const child of entity.children) this.markAllCollapsed(child);
  }

  private entityKey(entity: Entity): string { return `${entity.type}:${entity.file.path}`; }

  private renderEntity(parent: HTMLElement, entity: Entity, depth: number): void {
    const row = parent.createEl('div', { cls: 'graph-task-row' });
    row.style.paddingLeft = `${depth * 14}px`;
    const hasChildren = entity.children.length > 0;
    const collapsed = this.collapsed.has(this.entityKey(entity));

    const caret = row.createEl('span', { cls: 'graph-task-caret' });
    if (hasChildren) {
      setIcon(caret, collapsed ? 'chevron-right' : 'chevron-down');
      caret.addEventListener('click', (event) => {
        event.stopPropagation();
        if (collapsed) this.collapsed.delete(this.entityKey(entity));
        else this.collapsed.add(this.entityKey(entity));
        this.render();
      });
    } else caret.addClass('graph-task-caret-empty');

    const icon = row.createEl('span', { cls: 'graph-task-type-icon' });
    setIcon(icon, TYPE_ICONS[entity.type]);
    const label = row.createEl('span', { cls: 'graph-task-label', text: `${entity.type}: ${entity.id}` });
    const badges = row.createEl('span', { cls: 'graph-task-badges' });
    for (const text of badgeText(entity)) badges.createEl('span', { cls: `graph-task-badge status-${entity.status}`, text });
    if (entity.issues.length > 0) badges.createEl('span', { cls: 'graph-task-badge issues', text: `${entity.issues.length} issue${entity.issues.length === 1 ? '' : 's'}` });

    const open = (newLeaf: boolean) => { void this.openEntity(entity.file, newLeaf); };
    label.addEventListener('click', () => open(false));
    icon.addEventListener('click', () => open(false));
    row.addEventListener('auxclick', (event) => {
      if (event.button === 1) { event.preventDefault(); open(true); }
    });

    if (hasChildren && !collapsed) for (const child of entity.children) this.renderEntity(parent, child, depth + 1);
  }

  private async openEntity(file: TFile, newLeaf: boolean): Promise<void> {
    const leaf = this.app.workspace.getLeaf(newLeaf ? 'tab' : false);
    await leaf.openFile(file);
  }
}
