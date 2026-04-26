import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { GraphTaskView, VIEW_TYPE_GRAPH_TASK } from './view';
import { exportActiveProjectCanvases, exportAllProjectCanvases } from './canvas-export';
import { scanProjects } from './parser';

export default class GraphTaskPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(
      VIEW_TYPE_GRAPH_TASK,
      (leaf) => new GraphTaskView(leaf, this),
    );

    this.addRibbonIcon('folder-tree', 'Open TaskOps Explorer', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-explorer',
      name: 'Open project explorer',
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: 'refresh',
      name: 'Refresh projects',
      callback: () => this.refreshAllViews(),
    });

    this.addCommand({
      id: 'export-active-project-canvases',
      name: 'Export canvas views for active project',
      callback: async () => {
        const { projects } = scanProjects(this.app);
        await exportActiveProjectCanvases(this.app, projects);
      },
    });

    this.addCommand({
      id: 'export-all-project-canvases',
      name: 'Export canvas views for all projects',
      callback: async () => {
        const { projects } = scanProjects(this.app);
        await exportAllProjectCanvases(this.app, projects);
      },
    });

    // Refresh when frontmatter changes so the tree stays in sync.
    this.registerEvent(
      this.app.metadataCache.on('changed', () => {
        this.refreshAllViews(false);
      }),
    );

    // Auto-open on first load so first-time users see the tree.
    this.app.workspace.onLayoutReady(() => {
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE_GRAPH_TASK).length === 0) {
        void this.activateView();
      }
    });
  }

  async onunload(): Promise<void> {
    // Obsidian unregisters views registered via registerView automatically.
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_GRAPH_TASK);
    let leaf: WorkspaceLeaf | null;
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        leaf = workspace.getLeaf(true);
      }
      await leaf.setViewState({
        type: VIEW_TYPE_GRAPH_TASK,
        active: true,
      });
    }
    workspace.revealLeaf(leaf);
  }

  private refreshAllViews(notify = true): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRAPH_TASK);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof GraphTaskView) view.refresh();
    }
    if (notify) new Notice('TaskOps: refreshed');
  }
}
