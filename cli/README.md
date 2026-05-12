# TaskOps CLI

**Agentic work needs an execution graph, not a TODO list.**

TaskOps is a markdown-first CLI for human + AI work where plans, execution logs, blockers, delegation, and closure evidence must stay inspectable and versionable.

It separates two truths:

- **Task graph** — the decomposition truth: objective, task groups, selected snapshots, readiness, and explicit terminal EoW nodes.
- **Run graph** — the execution truth: what actually happened, including execution, exploration, decomposition, delegation, waiting, verification, failure, and closure.

## Why TaskOps exists

Traditional task lists usually blur three different questions:

1. What is the right decomposition of the work?
2. What is actually runnable right now?
3. What happened during execution, including delegation or waiting?

TaskOps keeps those layers separate so an agent or human can make honest decisions instead of pretending every task is a flat checklist item.

## Core concepts

- `work` — the top-level objective container (`entityType: work`).
- `task-groups/` — versioned decomposition trees.
- `snapshots/` — selected version paths through the task graph.
- `runs/<run-id>/` — independent execution graphs.
- `eow` — explicit **End of Work** nodes attached to terminal task/run branches.
- `runRefs` — task-side references to run nodes.
- `sourceTaskId` / `sourceTaskGroupVersionId` — run-side references back to the task graph.
- `type: delegate` + `status: waiting` — explicit human/AI/agent delegation points.

## Install

```bash
npm install -g taskops
```

Then run:

```bash
taskops --help
```

## Quick start: the smallest useful loop

```bash
# 1. Create a work tree around one objective
taskops init ./my-work \
  --id my-work \
  --title "My Work" \
  --objective "Ship the first useful version" \
  --language en

# 2. Validate and summarize the current graph
taskops validate ./my-work
taskops summary ./my-work

# 3. Inspect machine-readable state
taskops show ./my-work --json

# 4. Classify what can honestly happen next
taskops classify-runnable ./my-work task-design --json

# 5. Advance bounded work
taskops run ./my-work --executor dry-run --max-steps 1 --json
```

`taskops run` dispatches by readiness: runnable tasks execute, `needs_decomposition` tasks expand the task graph, `needs_exploration` tasks create exploratory run evidence, and blocked/waiting/delegated work stops instead of being silently skipped.

## Example: AI-assisted OAuth refactor

A large refactor should not be trusted to a flat checklist or a disappearing chat transcript. With TaskOps:

1. A `work` captures the objective: “Refactor the OAuth flow safely.”
2. The task graph decomposes analysis, token validation changes, regression tests, migration notes, and review.
3. The runner classifies each task as `runnable`, `needs_decomposition`, `needs_exploration`, or `blocked`.
4. The run graph records what the agent actually did, which tests failed, what was delegated, and why each branch was closed.
5. Reviewers inspect `taskops summary`, `runs/<run-id>/events.jsonl`, and EoW nodes before trusting completion.

TaskOps tells agents how the work is actually getting done.

## Commands

```bash
taskops init <dir> --id <id> --title <title> --objective <objective> [--language en|ko]
taskops validate <path>
taskops summary <path> [--write]
taskops show <path> [--json]
taskops classify-runnable <work-dir> <task-id> [--json]
taskops unblock-check <work-dir> [--dry-run] [--json]
taskops run <work-dir> [--run-id <id>] [--agent <agent-id>] [--executor dry-run|openclaw-agent] [--max-steps <n>] [--until <iso-timestamp>] [--timeout <seconds>] [--json]
taskops decompose <work-dir> --task-group-id <id> --spec <spec.json>
taskops refactor <work-dir> --task-group-id <id> --spec <spec.json> --supersedes <version-id>
taskops vault-init <vault-dir> [--repo-url <url>] [--branch main] [--auto-sync true|false]
taskops git-status <vault-dir>
taskops git-sync <vault-dir> [--message <msg>] [--branch <branch>]
taskops watch-sync <vault-dir> [--message <msg>] [--debounce-ms <ms>] [--branch <branch>]
```

## Run a TaskOps work

`taskops run <work-dir>` executes runnable tasks against the canonical markdown state. It is the bridge between the passive task graph and an actual run graph: agents (OpenClaw or otherwise) invoke this command rather than mutating files by hand.

```bash
# bounded single step using the safe synthetic executor
taskops run ./my-work --executor dry-run --max-steps 1

# real execution against an OpenClaw agent, capped by a deadline
taskops run ./my-work --executor openclaw-agent --agent main --until 2026-05-13T09:00:00+09:00

# machine-readable summary for programmatic callers
taskops run ./my-work --max-steps 3 --json
```

The runner:

- Re-uses an existing active run when there is exactly one, else creates/uses `runs/run-main/`. Override with `--run-id`.
- Rechecks blocked tasks that declare `blockedBy` references before selecting the next action. When every blocker is resolved, the runner reopens the task (`status: pending`) and clears `runReadiness: blocked` unless `unblockRunReadiness` says what readiness to use next. Use `taskops unblock-check <work-dir> --dry-run --json` to inspect the same transition without mutating files.
- Picks the next task deterministically: active snapshot order, then `task.order`, then `id` lexicographic. Only tasks with status `pending`/`active` are eligible. Tasks classified as `blocked` are excluded; tasks classified as `runnable`, `needs_decomposition`, or `needs_exploration` are dispatched to the matching runner step.
- For `runnable` tasks: creates the run node, mutates task status to done, attaches task and run EoW nodes, and writes the `closes_with` edge.
- For `needs_decomposition` tasks: creates a `type: decomposition` run node, expands the task graph by writing a child task group and version (dry-run synthesizes a deterministic placeholder; `openclaw-agent` delegates authoring to the agent), updates the parent task's `childTaskGroupId`, marks the parent done with an EoW reason `decomposed_by_runner`, and closes the run node with an EoW reason `decomposition_recorded`.
- For `needs_exploration` tasks: creates a `type: exploration` run node, writes a reflection artifact under `runs/<run-id>/artifacts/<run-node-id>.md`, marks the parent task done with an EoW reason `exploration_recorded_by_runner` and `runReadiness: needs_decomposition` (ready for an informed decomposition pass), and closes the run node with an EoW reason `exploration_recorded`.
- Pauses immediately when it encounters a `status: waiting` task or run node, or a `type: delegate` run node that is not yet `done`/`cancelled`. Delegated run nodes are classified by `type` first, so `type: delegate` + `status: waiting` reports `delegation_pending` rather than generic `waiting`.
- Appends a JSONL event log at `runs/<run-id>/events.jsonl` plus human entries in `runs/<run-id>/run-log.md`.
- Holds a `.taskops-runner.lock` directory under the work root and removes it on exit. A second runner against the same work refuses to start.

### Stop conditions

`--max-steps` and `--until` are both optional and combine with OR semantics: the runner stops before starting a new step if either limit is reached. When neither is supplied the runner defaults to `--max-steps 1` (one bounded step). Every action — execute, decompose, or explore — counts as one step against `--max-steps`.

| Stop reason            | Meaning                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `no_runnable`          | No remaining task is actionable (runnable, decomposable, or explorable).                                 |
| `blocked_only`         | Open tasks remain but they are all classified as `blocked`; resolve the blockers before continuing.      |
| `waiting`              | A task or run node is in `status: waiting`; resolve or cancel it before continuing.                      |
| `delegation_pending`   | A `type: delegate` run node is still pending (not `done`/`cancelled`); resolve the delegation first.     |
| `max_steps`            | The `--max-steps` budget is exhausted.                                                                   |
| `deadline_reached`     | `--until` has already passed when the next step would start.                                             |
| `task_failed`          | The executor reported a non-zero exit, timeout, or refused to author the expected decomposition/artifact.|
| `validation_failed`    | A mid-run re-parse found errors and the runner refused to act.                                           |

`--until` accepts any value `Date.parse` understands. When both `--until` and `--timeout` are supplied, the per-task timeout is capped at the remaining time before the deadline.

### Executors

- `--executor dry-run` (default) — no external process. Synthesises a successful result and mutates the markdown graph. For decomposition steps it writes a deterministic child task group/version with a single blocked placeholder task asking for human input. For exploration steps it writes a deterministic reflection artifact under `runs/<run-id>/artifacts/`. Intended for smoke tests, dress rehearsals, and skill reviews. **It does not perform real work.** Pass `--executor openclaw-agent` to dispatch a real run.
- `--executor openclaw-agent` — spawns `openclaw agent --agent <agent-id> --message <prompt> --json [--timeout <seconds>]`. The prompt is tailored to the picked action — execute, decompose, or explore — and instructs the agent not to recursively invoke `taskops run`. After the agent returns the runner verifies that the expected artifact (the executed task's outcome, the decomposition version index, or the exploration artifact) was authored before marking the step done. Default `--agent` is `main`.

## Canonical file layout

```text
<taskops-work>/
  index.md                  # entityType: work
  work-log.md
  task-groups/
    <task-group-id>/
      index.md
      versions/
        <version-id>/
          index.md
          tasks/
            <task-id>.md
          eow/
            <eow-id>.md
  snapshots/
    <snapshot-id>.md
  runs/
    <run-id>/
      index.md
      nodes/
        <run-node-id>.md
        <eow-id>.md
      edges/
        <run-edge-id>.md
  derived/
    canvases/
    views/
```

## Run readiness

TaskOps classifies each task before execution:

- `runnable` — send it to a run graph.
- `needs_decomposition` — split it into a child task group/version.
- `needs_exploration` — run/search/try/debug first to learn enough for honest decomposition.
- `blocked` — resolve the dependency before continuing.

## Closure and delegation

TaskOps does not treat `done` as the same thing as closure.

A branch is closed when an explicit EoW node is attached. The summary reports closure state, for example:

```text
Terminal task EoW coverage: 4/4
Waiting delegations: 0
Open blockers: 0
Work completion: complete
```

Delegation is represented in the run graph rather than hidden as a vague blocker:

```yaml
entityType: runNode
type: delegate
status: waiting
delegateeType: human
delegateeRef: jimmy
request: Confirm the constraints needed before downstream execution.
expectedOutput: A clear decision and any constraints that update the task graph.
```

## Obsidian and Git-backed vaults

TaskOps works well with Obsidian because canonical state is plain markdown.

Initialize a vault with automatic Git sync metadata:

```bash
taskops vault-init ~/vaults/my-taskops-vault \
  --repo-url git@github.com:ORG/my-taskops-vault.git \
  --branch main \
  --auto-sync true \
  --language en
```

Then sync manually or watch for changes:

```bash
taskops git-status ~/vaults/my-taskops-vault
taskops git-sync ~/vaults/my-taskops-vault --message "Sync TaskOps vault"
taskops watch-sync ~/vaults/my-taskops-vault --debounce-ms 5000
```

The companion Obsidian plugin can read the same markdown state and export derived canvas views.

## Examples and docs

- GitHub: https://github.com/jimmylegendary/taskops
- Canonical example: `examples/taskops-canonical-minimal-v1/`
- Core model: `docs/CORE_MODEL.md`
- Markdown format: `docs/MD_FIRST_FORMAT.md`
- Run readiness: `docs/RUN_READINESS.md`

## Development

```bash
git clone git@github.com:jimmylegendary/taskops.git
cd taskops
npm install
npm run verify
npm run release:preflight
```

## License

MIT
