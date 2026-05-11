# TaskOps CLI

TaskOps is a markdown-first task operations CLI for structuring real work as two connected graphs:

- **Task graph** — the decomposition truth: objective, task groups, selected snapshots, and explicit terminal EoW nodes.
- **Run graph** — the execution truth: what actually happened, including exploratory work, delegation, waiting, verification, and closure.

The CLI is designed for human + AI workflows where the state must stay inspectable, versionable, and usable from plain files, Obsidian, Git, and automation.

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

## Quick start

Create a new work tree:

```bash
taskops init ./my-work \
  --id my-work \
  --title "My Work" \
  --objective "Ship the first useful version" \
  --language en
```

Validate and summarize it:

```bash
taskops validate ./my-work
taskops summary ./my-work
```

Show machine-readable state:

```bash
taskops show ./my-work --json
```

Classify whether a task is runnable, needs decomposition, needs exploration, or is blocked:

```bash
taskops classify-runnable ./my-work task-design --json
```

## Commands

```bash
taskops init <dir> --id <id> --title <title> --objective <objective> [--language en|ko]
taskops validate <path>
taskops summary <path> [--write]
taskops show <path> [--json]
taskops classify-runnable <work-dir> <task-id> [--json]
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
- Picks runnable tasks deterministically: active snapshot order, then `task.order`, then `id` lexicographic. Only tasks with status `pending`/`active` and run readiness `runnable` are eligible.
- Updates the task graph and the run graph for every step (run node, runRefs, status, EoW nodes, `closes_with` edge).
- Appends a JSONL event log at `runs/<run-id>/events.jsonl` plus human entries in `runs/<run-id>/run-log.md`.
- Holds a `.taskops-runner.lock` directory under the work root and removes it on exit. A second runner against the same work refuses to start.

### Stop conditions

`--max-steps` and `--until` are both optional and combine with OR semantics: the runner stops before starting a new step if either limit is reached. When neither is supplied the runner defaults to `--max-steps 1` (one bounded step).

| Stop reason         | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `no_runnable`       | No remaining task matches the runnable filter.                 |
| `max_steps`         | The `--max-steps` budget is exhausted.                         |
| `deadline_reached`  | `--until` has already passed when the next step would start.   |
| `task_failed`       | The executor reported a non-zero exit or timeout.              |
| `validation_failed` | A mid-run re-parse found errors and the runner refused to act. |

`--until` accepts any value `Date.parse` understands. When both `--until` and `--timeout` are supplied, the per-task timeout is capped at the remaining time before the deadline.

### Executors

- `--executor dry-run` (default) — no external process. Synthesises a successful result and mutates the markdown graph. Intended for smoke tests, dress rehearsals, and skill reviews. **It does not perform real work.** Pass `--executor openclaw-agent` to dispatch a real run.
- `--executor openclaw-agent` — spawns `openclaw agent --agent <agent-id> --message <prompt> --json [--timeout <seconds>]`. The prompt carries the work objective and task triple (`objective`, `responsibility`, `completionCriteria`) and instructs the agent to execute one TaskOps task without recursively invoking `taskops run`. Default `--agent` is `main`.

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
