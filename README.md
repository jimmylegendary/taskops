# TaskOps

TaskOps is a task-operations framework built around two distinct but connected layers:

- **work** — the top-level container around one objective
- **task graph** — a decomposition graph that enforces structural quality
- **run graph** — independent execution graphs that record real-world work, overlap, dependency, delegation, waiting, and closure

This monorepo contains:

- `skill/` — OpenClaw skill package for TaskOps guidance
- `cli/` — installable `taskops` npm CLI
- `obsidian-plugin/` — Obsidian explorer + derived canvas export
- `docs/` — canonical design docs
- `examples/` — shared fixtures and dogfood projects, including `examples/taskops-canonical-minimal-v1/` as the docs-reference v1 fixture and `examples/taskops-minimal-v1/` as a richer companion fixture

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
- **EoW (End of Work)** is a visible terminal node attached to task branches or run paths when they are truly closed.
- **Delegated waiting** is represented as `type: delegate` / `status: waiting` in the run graph, with delegatee, request, expected output, and optional timeout metadata.
- **Task↔run references** are bidirectional: tasks use `runRefs`; run nodes use `sourceTaskId` / `sourceTaskGroupVersionId`.
- **Run readiness** classifies each task as `runnable`, `needs_decomposition`, `needs_exploration`, or `blocked` before execution.
- **Exploratory runs** are first-class feedback loops for unknown-unknowns: run/search/try/error to learn enough to decompose honestly.
- **Task groups** are versioned decomposition units.
- **Refactor** creates a new task-group version rather than mutating decomposition history away.
- **Snapshots** represent selected version paths, not every possible combinatorial version state.

## v1 canonical work shape

```text
<taskops-work>/
  index.md
  work-log.md
  task-groups/
  snapshots/
  runs/
  derived/
```

See:
- `docs/CORE_MODEL.md`
- `docs/MD_FIRST_FORMAT.md`
- `docs/DECOMPOSITION_PROTOCOL.md`
- `docs/RUN_READINESS.md`
- `examples/taskops-canonical-minimal-v1/`

New roots use `entityType: work`. Legacy `entityType: project` and singular `run/` folders remain readable for migration, but new work should use independent `runs/<run-id>/` graphs.

For a slightly denser non-canonical companion fixture, see `examples/taskops-minimal-v1/`.

## CLI quick start

```bash
cd cli
npm install
npm test

# examples
taskops validate ../examples/taskops-canonical-minimal-v1
taskops summary ../examples/taskops-canonical-minimal-v1
taskops classify-runnable ../examples/taskops-canonical-minimal-v1 task-run

# scaffold with language-aware default values (field names stay English)
taskops init ../tmp/demo-taskops \
  --id demo-taskops \
  --title "Demo TaskOps" \
  --objective "Ship the MVP" \
  --language ko
```

## Release model

One GitHub repo, one shared release source of truth, three distribution channels:

- Skill → ClawHub
- CLI → npm
- Obsidian plugin → GitHub Release assets

All three should still participate in GitHub Releases so the repo remains the canonical release timeline.

Local preflight:

```bash
npm run verify
npm run release:preflight
```

If you want the individual steps, use:

```bash
npm run build:release
npm run smoke:publish-artifact
```

That emits the versioned CLI tarball, plugin zip, and skill package under `dist/release/v<version>/`, then dry-runs npm publication against the built CLI tarball artifact. The GitHub Actions release workflow now uses that same `release:preflight` path before its npm publish job consumes the tarball, and the ClawHub publish job logs in with `CLAWHUB_TOKEN` to publish the checked-out `skill/` folder at the matching version in non-interactive mode.

For automated publishes, configure `NPM_TOKEN` for the CLI job and `CLAWHUB_TOKEN` for the skill job. A manual `workflow_dispatch` run still exercises verify/build/release-asset assembly, but the actual npm/ClawHub publish jobs remain tag-gated on `v*` refs.

## Migration note

The copied code from `graph-task-*` is transitional starting material.
Legacy filenames and references may still exist where they are useful migration context, but user-facing TaskOps surfaces should prefer the v1 task-group / snapshot / run model.
