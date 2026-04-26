# TaskOps skill

Structured task-operations protocol with a **markdown-canonical** TaskOps v1 model.

## Canonical shape

TaskOps v1 separates:
- **task graph** under `task-groups/`
- **snapshot selection** under `snapshots/`
- **execution truth** under `run/`
- **derived views** under `derived/`

Markdown is canonical.
Derived canvas/views are not.

## Current surfaces

- `../cli/` — installable `taskops` CLI for `init / validate / summary / show / decompose / refactor`
- `../obsidian-plugin/` — Obsidian explorer + derived canvas export for TaskOps v1 projects
- `scripts/graph_task.py` — legacy graph-task prototype kept only as migration/source material

## Main working references

- `../docs/CORE_MODEL.md`
- `../docs/MD_FIRST_FORMAT.md`
- `../examples/taskops-canonical-minimal-v1/`
- `SKILL.md`

## Validation stance

Prefer the CLI for current validation and summaries:

```bash
taskops validate <project-dir>
taskops summary <project-dir>
```

Only use the legacy Python script when the work is explicitly about old graph-task compatibility or migration.
