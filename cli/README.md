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
taskops decompose <work-dir> --task-group-id <id> --spec <spec.json>
taskops refactor <work-dir> --task-group-id <id> --spec <spec.json> --supersedes <version-id>
taskops vault-init <vault-dir> [--repo-url <url>] [--branch main] [--auto-sync true|false]
taskops git-status <vault-dir>
taskops git-sync <vault-dir> [--message <msg>] [--branch <branch>]
taskops watch-sync <vault-dir> [--message <msg>] [--debounce-ms <ms>] [--branch <branch>]
```

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
