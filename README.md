# TaskOps

TaskOps is a task-operations framework built around two distinct but connected layers:

- **task graph** — a decomposition graph that enforces structural quality
- **run graph** — an execution graph that records real-world work, overlap, and dependency

This monorepo contains:

- `skill/` — OpenClaw skill package for TaskOps guidance
- `cli/` — installable `taskops` npm CLI
- `obsidian-plugin/` — Obsidian explorer + derived canvas export
- `docs/` — canonical design docs
- `examples/` — shared fixtures and dogfood projects, including `examples/taskops-canonical-minimal-v1/` for the v1 model

## Current status

TaskOps has moved past the old `graph-task` split-repo phase.
The v1 working contract is now:

1. freeze naming and glossary
2. freeze the core TaskOps model
3. freeze the md-first storage format
4. implement skill / CLI / plugin on that shared contract

## Key concepts

- **Task graph** exists to guarantee good decomposition.
- **Run graph** exists to represent execution reality.
- **Task groups** are versioned decomposition units.
- **Refactor** creates a new task-group version rather than mutating decomposition history away.
- **Snapshots** represent selected version paths, not every possible combinatorial version state.

## v1 canonical project shape

```text
<taskops-project>/
  index.md
  project-log.md
  task-groups/
  snapshots/
  run/
  derived/
```

See:
- `docs/CORE_MODEL.md`
- `docs/MD_FIRST_FORMAT.md`
- `examples/taskops-canonical-minimal-v1/`

## CLI quick start

```bash
cd cli
npm install
npm test

# examples
taskops validate ../examples/taskops-canonical-minimal-v1
taskops summary ../examples/taskops-canonical-minimal-v1
```

## Release model

One GitHub repo, one shared release source of truth, three distribution channels:

- Skill → ClawHub
- CLI → npm
- Obsidian plugin → GitHub Release assets

All three should still participate in GitHub Releases so the repo remains the canonical release timeline.

## Migration note

The copied code from `graph-task-*` is transitional starting material.
Legacy filenames and references may still exist where they are useful migration context, but user-facing TaskOps surfaces should prefer the v1 task-group / snapshot / run model.
