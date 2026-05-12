---
name: taskops
description: "Manage TaskOps md-first work roots built around versioned task groups, explicit snapshots, and a separate run graph. Use when you need to inspect or author the canonical markdown layout, validate project structure, summarize project state, or work with the TaskOps CLI / Obsidian plugin surfaces."
---

# TaskOps

## Canonical rule

TaskOps v1 is **md-first**.

Canonical state lives in markdown files arranged around:
- `task-groups/`
- `snapshots/`
- `runs/<run-id>/`
- non-canonical `derived/`

Do **not** treat `graph.json` as durable canonical state.
That older path is legacy source material only.

## Read these first

- `references/core-model.md`
- `references/md-first-format.md`
- `references/decomposition-protocol.md`
- `references/run-readiness.md`
- `../examples/taskops-canonical-minimal-v1/`

## Current operating model

- Task graph = decomposition truth
- Run graph = execution truth
- Work = top-level objective container (`entityType: work`; legacy `project` can still be read)
- Task groups are versioned
- Snapshots materialize selected version paths
- EoW (End of Work) is an explicit terminal node, not just a status field
- Run graphs are independent under `runs/<run-id>/` and may reference external runs/tasks without being merged
- Task↔run traceability is bidirectional: task `runRefs` plus run-node `sourceTaskId` / `sourceTaskGroupVersionId`
- Delegation/waiting belongs in the run graph as `type: delegate` / `status: waiting` with delegatee, request, expected output, and optional timeout metadata
- Markdown is canonical; canvas/views are derived
- Shared status vocabulary: `pending | active | done | blocked | waiting | cancelled`
- Before execution, classify task run readiness as `runnable | needs_decomposition | needs_exploration | blocked`
- Use `needs_exploration` when the objective is meaningful but the system does not yet know enough to decompose honestly; exploratory runs may search, try, debug, prototype, and reflect to learn constraints for the next graph update

## Decomposition discipline

- Start with a one-line objective.
- Decompose depth 1 by default.
- Do not turn decomposition into an activity checklist.
- A task can be large but not decomposable yet; if the missing knowledge blocks honest decomposition, create an exploratory run and feed the result back into the task graph.
- A terminal selected branch is not closed until an EoW node is attached.
- Do not continue past a delegated/waiting run node until it resolves, is cancelled, or times out into an explicit follow-up.

## Preferred CLI

Use the npm CLI first:

```bash
taskops validate <path>
taskops summary <path>
taskops show <path> --json
taskops classify-runnable <work-dir> <task-id> --json
taskops init <dir> --id <id> --title <title> --objective <objective>
taskops vault-init <vault-dir> --repo-url <url> --branch <branch> --auto-sync true
taskops git-status <vault-dir>
taskops git-sync <vault-dir> --message <message>
taskops watch-sync <vault-dir> --debounce-ms 5000
taskops decompose <work-dir> --task-group-id <id> --spec <spec.json>
taskops refactor <work-dir> --task-group-id <id> --spec <spec.json> --supersedes <version-id>
taskops run <work-dir> [--run-id <id>] [--agent <agent-id>] [--executor dry-run|openclaw-agent] [--max-steps <n>] [--until <iso-timestamp>] [--timeout <seconds>] [--json]
```

## Running TaskOps work

`taskops run <work-dir>` is the canonical way to advance a TaskOps work graph. The skill is passive guidance; the runner is the layer that actually mutates state.

- Use `taskops run <work-dir>` instead of editing run nodes / EoW / runRefs / child task groups by hand. The runner deterministically picks the next task (active snapshot order, then `task.order`, then `id`), classifies it, and dispatches the matching action.
- The runner handles three task readiness states each as one bounded step:
  - `runnable` — creates the run node, executes via the executor, marks the task done, writes the task and run EoW nodes, and creates the `closes_with` edge.
  - `needs_decomposition` — creates a `type: decomposition` run node, expands the task graph with a child task group and a v1 version (dry-run synthesizes a deterministic placeholder; `openclaw-agent` delegates authoring to the agent and verifies the result), sets the parent task's `childTaskGroupId`, and closes the parent task with EoW reason `decomposed_by_runner`.
  - `needs_exploration` — creates a `type: exploration` run node, writes a reflection artifact at `runs/<run-id>/artifacts/<run-node-id>.md`, then marks the parent done with EoW reason `exploration_recorded_by_runner` and sets its `runReadiness` to `needs_decomposition` so the next pass can author informed children.
- `blocked` tasks are excluded from execution. If only blocked tasks remain the runner stops with `blocked_only`.
- `status: waiting` tasks and run nodes, and `type: delegate` run nodes that are not yet `done`/`cancelled`, pause the runner with stop reason `waiting` or `delegation_pending`. Surface the pause to the user; do not auto-skip.
- Prefer `--executor openclaw-agent --agent <agent-id>` for real execution, decomposition, and exploration. Default `--agent` is `main`. Only use `--executor dry-run` for smoke tests, reviews, or to demonstrate the graph mutations without touching an external agent — it produces synthetic success and never performs real work. The synthetic decomposition placeholders are explicitly `runReadiness: blocked` so they cannot be mistaken for real progress.
- `--max-steps <n>` bounds the total number of actions (execute + decompose + explore). `--until <iso-timestamp>` bounds wall-clock work. Both are optional and **combine with OR semantics**: stop before a new step if either limit is reached.
- If neither `--max-steps` nor `--until` is supplied, the runner defaults to `--max-steps 1` — exactly one step, then stop.
- When the user says something like "before tomorrow 9am" or "by EOD", convert the requested deadline to an explicit ISO-8601 timestamp **with timezone** before passing it as `--until`. Do not pass natural-language deadlines.
- Stop reasons reported back: `no_runnable`, `blocked_only`, `waiting`, `delegation_pending`, `max_steps`, `deadline_reached`, `task_failed`, `validation_failed`. Always surface the reason to the user.
- The runner appends to `runs/<run-id>/events.jsonl` and `runs/<run-id>/run-log.md`, and holds a `.taskops-runner.lock` directory inside the work root while running. Do not launch a second runner against the same work until the lock is gone.
- Do **not** instruct the executing agent to call `taskops run` again — it runs one task. Recursion is the orchestrator's job, not the worker's.

## Git-backed vault rule

If the user is working in an Obsidian vault that should stay aligned with a GitHub repo, prefer:

1. `taskops vault-init ... --repo-url ... --auto-sync true`
2. keep `.taskops/taskops-sync.json` in the vault root
3. use the desktop Obsidian plugin or `taskops watch-sync`/`taskops git-sync` so local vault edits are pushed back to GitHub instead of drifting

## Legacy note

`python3 scripts/graph_task.py ...` still exists as a migration aid for the earlier graph-task prototype.
Only use it when the task is explicitly about legacy behavior or migration.

## Minimum validation before claiming success

Run:

```bash
taskops validate <work-dir>
taskops summary <work-dir>
```

If you changed the skill itself, also run:

```bash
python3 /home/jimmy/.npm-global/lib/node_modules/openclaw/skills/skill-creator/scripts/package_skill.py <skill-dir> <output-dir>
```
