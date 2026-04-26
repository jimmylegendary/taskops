---
name: taskops
description: "Manage TaskOps md-first projects built around versioned task groups, explicit snapshots, and a separate run graph. Use when you need to inspect or author the canonical markdown layout, validate project structure, summarize project state, or work with the TaskOps CLI / Obsidian plugin surfaces."
---

# TaskOps

## Canonical rule

TaskOps v1 is **md-first**.

Canonical state lives in markdown files arranged around:
- `task-groups/`
- `snapshots/`
- `run/`
- non-canonical `derived/`

Do **not** treat `graph.json` as durable canonical state.
That older path is legacy source material only.

## Read these first

- `../docs/CORE_MODEL.md`
- `../docs/MD_FIRST_FORMAT.md`
- `../examples/taskops-canonical-minimal-v1/`

## Current operating model

- Task graph = decomposition truth
- Run graph = execution truth
- Task groups are versioned
- Snapshots materialize selected version paths
- Markdown is canonical; canvas/views are derived
- Shared status vocabulary: `pending | active | done | blocked | cancelled`

## Preferred CLI

Use the npm CLI first:

```bash
taskops validate <path>
taskops summary <path>
taskops show <path> --json
taskops init <dir> --id <id> --title <title> --objective <objective>
taskops decompose <project-dir> --task-group-id <id> --spec <spec.json>
taskops refactor <project-dir> --task-group-id <id> --spec <spec.json> --supersedes <version-id>
```

## Legacy note

`python3 scripts/graph_task.py ...` still exists as a migration aid for the earlier graph-task prototype.
Only use it when the task is explicitly about legacy behavior or migration.

## Minimum validation before claiming success

Run:

```bash
taskops validate <project-dir>
taskops summary <project-dir>
```

If you changed the skill itself, also run:

```bash
python3 /home/jimmy/.npm-global/lib/node_modules/openclaw/skills/skill-creator/scripts/package_skill.py <skill-dir> <output-dir>
```
