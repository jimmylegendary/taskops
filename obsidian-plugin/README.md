# TaskOps Obsidian plugin MVP

Tree-first Obsidian client for the canonical md-first TaskOps v1 model.

## What it does
- scans the current vault for TaskOps projects
- detects a project when a folder contains `index.md` with `entityType: project`
- renders a side-panel tree:
  - Project
  - TaskGroup
    - TaskGroupVersion
      - Task
  - VersionSnapshot
  - Run
    - RunNode
    - RunEdge
- shows compact badges for status, selection, child task-group links, and validation issues
- lets you click an item to open the canonical markdown file
- includes a refresh command / button
- exports derived canvas views for task-groups, snapshots, and run graph
- shows a validation issue panel instead of failing silently when structure is broken
- can debounce-sync a git-backed vault when `.taskops/taskops-sync.json` is present

## Current scope
This MVP is intentionally read-only.

Included:
- parse the canonical TaskOps v1 folder layout
- inspect the tree in Obsidian
- open canonical markdown files
- refresh the parsed state
- export deterministic `task-groups / snapshots / run` canvas views
- surface validation issues
- desktop-only git auto-sync command + background debounce sync for repo-backed vaults

Not included yet:
- create or edit entities from the plugin
- lock / lease handling
- conflict resolution
- rich inspector pane

## Build

```bash
npm install
npm run typecheck
npm run build
```

## Smoke tests

```bash
npm run smoke
npm run smoke:canvas
```

Expected output includes:
- `project: project-alpha-v1`
- `taskGroup: tg-root`
- `version: tgv-root-v1`
- `task: task-design`
- `snapshot: snapshot-alpha-v1`
- `runNode: run-node-verify`
- canvas file paths under `taskops/examples/taskops-canonical-minimal-v1/canvases/`
- final parse line: `OK: projects=1 taskGroups=2 versions=2 tasks=5 snapshots=1 runNodes=2 runEdges=1`

## Git-backed vault auto-sync
If your vault is also your GitHub-backed work repo, initialize it first with the CLI:

```bash
taskops vault-init <vault-dir> --repo-url <github-repo-url> --branch main --auto-sync true
```

That creates `.taskops/taskops-sync.json` in the vault root. You can also include a `language` field there (for example `"language": "ko"`). When the desktop plugin is enabled:
- vault file create/modify/delete/rename events are debounced
- changed files are committed automatically
- the plugin rebases/pulls then pushes to `origin/<branch>`
- you can also run `TaskOps Explorer: Sync vault git now`

Notes:
- desktop only
- local git `user.name` and `user.email` must already be configured
- by default workspace-layout churn files like `.obsidian/workspace*` are ignored

## Load into Obsidian
### Option A — use the canonical example directly
1. Open Obsidian.
2. Choose **Open folder as vault**.
3. Select `../examples/taskops-canonical-minimal-v1/`.
4. Create the community plugin folder inside that vault if needed:
   - `<vault>/.obsidian/plugins/taskops-obsidian/`
5. Copy these plugin files into that folder:
   - `manifest.json`
   - `main.js`
   - `styles.css`
6. In Obsidian:
   - Settings → Community plugins
   - turn off Restricted mode
   - enable **TaskOps Explorer**
7. Click the ribbon icon or run the command:
   - `TaskOps Explorer: Open project explorer`

### Option B — use your real vault
If your real vault contains TaskOps v1 project folders with the same structure, install the plugin the same way and open the explorer.

## Export canvas views in Obsidian
After enabling the plugin, you can run either of these commands:
- `TaskOps Explorer: Export canvas views for active project`
- `TaskOps Explorer: Export canvas views for all projects`

For each project, the plugin writes three derived canvas files:
- `<project-id>-task-groups-view.canvas`
- `<project-id>-snapshots-view.canvas`
- `<project-id>-run-view.canvas`

Markdown remains canonical.

## Validation behavior
The plugin currently flags issues such as:
- missing required frontmatter
- wrong `entityType`
- id mismatch with folder/file name
- missing `task-groups/`, `snapshots/`, or `run/`
- selected snapshot references to missing task groups or versions
- run edges that reference missing run nodes
- task `childTaskGroupId` references that do not resolve

## Next likely steps
- detail pane for selected entity
- create entity commands
- status mutation commands
- shared validator module between CLI and plugin
- lightweight lock / lease awareness
