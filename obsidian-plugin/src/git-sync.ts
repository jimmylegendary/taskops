import { App, EventRef, Notice, TAbstractFile } from 'obsidian';

const CONFIG_PATH = '.taskops/taskops-sync.json';

type SyncConfig = {
  version?: number;
  enabled?: boolean;
  language?: string;
  repoUrl?: string | null;
  branch?: string;
  debounceMs?: number;
  commitMessage?: string;
  ignorePaths?: string[];
};

function desktopRequire(name: string): any {
  const g = globalThis as any;
  if (typeof g.require === 'function') return g.require(name);
  if (typeof (window as any)?.require === 'function') return (window as any).require(name);
  throw new Error('Desktop Node require is unavailable');
}

function repoRoot(app: App): string {
  const adapter: any = app.vault.adapter;
  if (typeof adapter.getBasePath !== 'function') throw new Error('TaskOps git sync requires the desktop filesystem adapter');
  return adapter.getBasePath();
}

async function readConfig(app: App): Promise<SyncConfig | null> {
  const file = app.vault.getAbstractFileByPath(CONFIG_PATH);
  if (!file) return null;
  const raw = await app.vault.cachedRead(file as any);
  return JSON.parse(raw);
}

function shouldIgnore(path: string, config: SyncConfig): boolean {
  const ignorePaths = config.ignorePaths ?? [];
  return ignorePaths.some((prefix) => path.startsWith(prefix));
}

function git(app: App, args: string[], cwd: string): string {
  const { execFileSync } = desktopRequire('node:child_process');
  return String(execFileSync('git', args, { cwd, encoding: 'utf8' })).trim();
}

function tryGit(app: App, args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const { spawnSync } = desktopRequire('node:child_process');
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function syncNow(app: App, cwd: string, config: SyncConfig): string {
  const branch = config.branch || 'main';
  const message = config.commitMessage || 'TaskOps auto-sync';
  const dirty = git(app, ['status', '--porcelain'], cwd).split('\n').filter(Boolean);
  if (dirty.length > 0) {
    const userName = tryGit(app, ['config', '--get', 'user.name'], cwd).stdout;
    const userEmail = tryGit(app, ['config', '--get', 'user.email'], cwd).stdout;
    if (!userName || !userEmail) throw new Error('Git user.name/user.email must be configured before TaskOps auto-sync can commit');
    git(app, ['add', '-A'], cwd);
    git(app, ['commit', '-m', message], cwd);
  }

  const hasOrigin = tryGit(app, ['remote', 'get-url', 'origin'], cwd).ok;
  if (!hasOrigin) return dirty.length > 0 ? 'committed locally (no origin configured)' : 'no changes';

  const pull = tryGit(app, ['pull', '--rebase', '--autostash', 'origin', branch], cwd);
  if (!pull.ok && !/couldn't find remote ref|no such ref/i.test(`${pull.stderr} ${pull.stdout}`)) {
    throw new Error(pull.stderr || pull.stdout || `Failed to pull origin/${branch}`);
  }

  const upstream = tryGit(app, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
  if (!upstream.ok) git(app, ['push', '-u', 'origin', branch], cwd);
  else git(app, ['push', 'origin', branch], cwd);
  return dirty.length > 0 ? 'committed and pushed' : 'pushed';
}

export class VaultGitSyncManager {
  private timer: number | null = null;
  private running = false;
  private queued = false;
  private lastRunAt = 0;

  constructor(private app: App) {}

  attach(): EventRef[] {
    const schedule = (file?: TAbstractFile | null) => {
      void this.schedule(file?.path || '');
    };
    return [
      this.app.vault.on('modify', schedule),
      this.app.vault.on('create', schedule),
      this.app.vault.on('delete', schedule),
      this.app.vault.on('rename', schedule),
    ];
  }

  async syncManual(): Promise<void> {
    const config = await readConfig(this.app);
    if (!config?.enabled) throw new Error('TaskOps auto-sync is not enabled for this vault');
    const result = syncNow(this.app, repoRoot(this.app), config);
    new Notice(`TaskOps sync: ${result}`);
  }

  private async schedule(path: string): Promise<void> {
    const config = await readConfig(this.app);
    if (!config?.enabled) return;
    if (path === CONFIG_PATH || shouldIgnore(path, config)) return;
    const debounceMs = typeof config.debounceMs === 'number' ? config.debounceMs : 5000;
    if (Date.now() - this.lastRunAt < 1500) return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      void this.run(config);
    }, debounceMs);
  }

  private async run(config: SyncConfig): Promise<void> {
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    this.lastRunAt = Date.now();
    try {
      syncNow(this.app, repoRoot(this.app), config);
    } catch (error) {
      new Notice(`TaskOps sync failed: ${error instanceof Error ? error.message : String(error)}`, 8000);
    } finally {
      this.running = false;
      if (this.queued) {
        this.queued = false;
        await this.run(config);
      }
    }
  }
}
