# TaskOps

**TODO lists don’t scale for AI agents.**

Plans lie. Logs drift. Work gets half-done. TaskOps separates task decomposition from execution reality so human + AI work can be inspected, resumed, delegated, and closed honestly.

TaskOps is an **agentic execution control layer** built around three connected records:

- **work** — the top-level objective container
- **task graph** — the decomposition truth: what should be done, what needs more breakdown, what needs exploration, and what is blocked
- **run graph** — the execution truth: what actually happened, including agent runs, exploration, delegation, waiting, failures, and closure evidence

Use TaskOps when a goal is too important to leave as a flat TODO list and too complex to trust to an unstructured chat log.

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

## The core loop

```bash
# 1. Create a work root around one objective
taskops init ./oauth-refactor \
  --id oauth-refactor \
  --title "OAuth Flow Refactor" \
  --objective "Refactor the OAuth flow safely with an AI coding agent"

# 2. Inspect whether the graph is structurally valid
taskops validate ./oauth-refactor
taskops summary ./oauth-refactor

# 3. Classify what can honestly happen next
taskops classify-runnable ./oauth-refactor task-auth-middleware --json

# 4. Advance bounded work: execute, decompose, or explore depending on readiness
taskops run ./oauth-refactor --executor dry-run --max-steps 3 --json

# 5. Or enable a user-level daemon for this runner-managed work directory
taskops daemon enable ./oauth-refactor \
  --name oauth-refactor \
  --runtime openclaw-cli \
  --runner-id taskopsd-oauth-refactor \
  --max-attempts 3 \
  --timeout 300 \
  --report-sink ledger

# 6. Review execution evidence
taskops summary ./oauth-refactor
```

`dry-run` is for smoke tests and graph rehearsals. For real work, use `--executor openclaw-agent --agent <agent-id>`.

Installing TaskOps does not start unattended work by itself. For unattended local work, `taskops daemon enable <work-dir>` is the explicit activation step for a specific runner-managed work directory: it syncs the queue projection, writes `.taskops/runner.json`, installs a user-systemd service around `taskops daemon run`, and starts it by default. The daemon loop starts `taskops runner watch`, interprets each watch stop reason, sleeps between cycles, and lets systemd restart the daemon process if the host session kills it. `taskops runner watch` remains the foreground primitive for tests and controlled sessions; do not wire `runner watch` directly to `Restart=always`, because `all_closed` is a normal stop reason and would otherwise become a restart loop.

For delegated self-loopback work, use `taskops delegate <work-dir>` or `taskops run <work-dir> --loopback self` from the user-facing CLI. Both reuse the daemon-backed queue/watch implementation in foreground mode; `taskops delegate --unattended` uses the same `daemon enable` activation path. Explicit daemon commands remain available for direct control.

SQLite remains a queue/lease/report projection. The runner/daemon process is what stays alive, projects dependency/readiness status from markdown, leases runnable work into one-shot worker transactions, and records progress. Queue size is separate from concurrency: all selected tasks are projected into `.taskops/queue.sqlite`, while `--max-parallel` limits the number of active worker agents. As workers exit, watch mode claims replacement runnable items until the work closes or a real bound/failure is reached. Watch mode defaults to a three-failure retry cap per current task fingerprint so an unchanged failing task does not loop forever. Use `--timeout <seconds>` with CLI runtimes (`openclaw-cli`, `claude-code`, `codex-cli`, or `opencode-cli`) so long worker transactions fail inside TaskOps and release their lease; if the runner process is externally killed, the next queue sync/list/claim operation marks the expired lease stale and finalizes the linked running attempt as failed.

## Killer use case: large AI-assisted refactors

For a goal like **“OAuth flow refactoring”**, TaskOps keeps the work honest:

- the **work** records the objective
- the **task graph** breaks it into analysis, implementation, tests, migration notes, and review
- `runReadiness` decides whether each task is runnable, needs decomposition, needs exploration, or is blocked
- the **run graph** records what the agent actually did, what failed, what was delegated, and what evidence closed the branch
- reviewers can inspect both the intended decomposition and the execution trail before trusting the result

That is the core promise: **TaskOps tells agents how the work is actually getting done.**

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
