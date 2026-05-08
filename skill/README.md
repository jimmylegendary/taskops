# TaskOps skill

Structured task-operations protocol with a **markdown-canonical** TaskOps v1 model.

## Canonical shape

TaskOps v1 separates:
- **work root** at `index.md` with `entityType: work`
- **task graph** under `task-groups/`
- **snapshot selection** under `snapshots/`
- **execution truth** under independent `runs/<run-id>/` graphs
- **EoW terminal nodes** under task-version `eow/` folders and run `nodes/`
- **derived views** under `derived/`

Markdown is canonical.
Derived canvas/views are not.

## Current surfaces

- `../cli/` — installable `taskops` CLI for `init / validate / summary / show / decompose / refactor` plus git-backed vault setup/sync
- `../obsidian-plugin/` — Obsidian explorer + derived canvas export for TaskOps v1 projects, with desktop git auto-sync support when configured
- `scripts/graph_task.py` — legacy graph-task prototype kept only as migration/source material

## Main working references

- `../docs/CORE_MODEL.md`
- `../docs/MD_FIRST_FORMAT.md`
- `../examples/taskops-canonical-minimal-v1/`
- `SKILL.md`

## Validation stance

Prefer the CLI for current validation and summaries:

```bash
taskops validate <work-dir>
taskops summary <work-dir>
```

For a git-backed Obsidian vault workflow:

```bash
taskops vault-init <vault-dir> --repo-url <github-repo-url> --branch main --auto-sync true
taskops git-sync <vault-dir> --message "Sync vault changes"
```

Only use the legacy Python script when the work is explicitly about old graph-task compatibility or migration.
