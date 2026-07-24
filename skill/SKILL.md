---
name: taskops
description: "Manage AI-agent work as an execution graph instead of a flat TODO list. Use TaskOps to structure objectives, task decomposition, run readiness, execution logs, exploration, delegation/waiting, EoW closure, validation, summaries, and runner-driven progress."
---

# TaskOps

TaskOps is a **work-truth protocol**, not just a task manager. It exists so that AI agents can be trusted with hours/days/weeks of work without pretending tasks are done, silently stopping, asking "what next?", or executing a wrong plan. Plans lie, logs drift, and TODO lists make agent work look simpler than it is; TaskOps separates task decomposition from execution reality and forces explicit, file-backed closure.

Use it when the user needs to know what should happen, what actually happened, what is blocked or delegated, and whether work is truly closed.

## Canonical rule

TaskOps v1 is **md-first**.

Canonical state lives in markdown files arranged around:
- `task-groups/`
- `snapshots/`
- `runs/<run-id>/`
- non-canonical `derived/`

Do **not** treat `.taskops/queue.sqlite`, `graph.json`, or generated canvases as durable semantic truth. SQLite is an execution projection/ledger, not the task graph source of truth.

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
- SQLite queue state is a rebuildable execution projection plus lease/report ledger
- Shared status vocabulary: `pending | active | done | blocked | waiting | cancelled`
- Before execution, classify task run readiness as `runnable | needs_decomposition | needs_exploration | needs_prototype | blocked`
- Use `needs_exploration` when the objective is meaningful but the system does not yet know enough to decompose honestly; exploratory runs may search, try, debug, experiment, and reflect to learn constraints for the next graph update

- `needs_prototype` creates cheap alternatives for an unknown-known requirement.
  Success requires a non-empty UTF-8 `options.md`, closes only a supporting run
  node, and puts the source task in `status: waiting` with `resolverKind: human`.
- Exploration records evidence and closes only its supporting run node; the
  source task stays open and advances to informed decomposition.
- `closureRole: supporting` records provenance and is structurally validated,
  but it is not in the policy-approval denominator.
- `closureRole: claim-bearing` carries an objective result and requires a real,
  matching independent review before policy-approved completion.
- `graph_closed_unapproved` means the graph is structurally closed but at least
  one claim lacks policy-approved evidence. It is not `all_closed`.

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
taskops audit <work-dir> [--strict] [--max-tasks-flat <n>] [--json]
taskops summary <path>
taskops show <path> --json
taskops classify-runnable <work-dir> <task-id> --json
taskops next <work-dir> --json
taskops explain <work-dir> --json
taskops close <work-dir> <run-node-id|task-id> [--reason <reason>] [--json]
taskops init <dir> --id <id> --title <title> --objective <objective>
taskops trainingdata <work-dir> [--summary]
taskops vault-init <vault-dir> --repo-url <url> --branch <branch> --auto-sync true
taskops git-status <vault-dir>
taskops git-sync <vault-dir> --message <message>
taskops watch-sync <vault-dir> --debounce-ms 5000
taskops decompose <work-dir> --task-group-id <id> --spec <spec.json>
taskops refactor <work-dir> --task-group-id <id> --spec <spec.json> --supersedes <version-id>
taskops run <work-dir> [--run-id <id>] [--agent <agent-id>] [--executor dry-run|openclaw-agent] [--max-steps <n>] [--until <iso-timestamp>] [--timeout <seconds>] [--verify-checks] [--verify-retries <n>] [--continue-on-failure] [--loopback none|self] [--max-loopbacks <n>] [--max-parallel <n>] [--json]
taskops delegate <work-dir> [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--runner-id <id>] [--loopback self] [--max-parallel <n>] [--max-steps <n>] [--max-loopbacks <n>] [--timeout <seconds>] [--verify-checks] [--verify-retries <n>] [--foreground] [--unattended] [--no-start] [--dry-run] [--json]
taskops queue sync <work-dir> [--json]
taskops queue list <work-dir> [--json]
taskops queue claim <work-dir> [--runner-id <id>] [--ttl-seconds <n>] [--max-attempts <n>] [--json]
taskops queue heartbeat <work-dir> <lease-id> [--ttl-seconds <n>] [--json]
taskops queue release <work-dir> <lease-id> [--status done|failed|cancelled] [--json]
taskops queue reports <work-dir> [--json]
taskops runner once <work-dir> [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--runner-id <id>] [--ttl-seconds <n>] [--max-attempts <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--timeout <seconds>] [--report-sink none|ledger|openclaw-chat-inject] [--master-session-key <key>] [--json]
taskops runner watch <work-dir> [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--runner-id <id>] [--ttl-seconds <n>] [--max-attempts <n>] [--max-parallel <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--timeout <seconds>] [--report-sink none|ledger|openclaw-chat-inject] [--master-session-key <key>] [--poll-interval-ms <n>] [--max-waves <n>] [--max-idle-cycles <n>] [--idle-exit-after-seconds <n>] [--until <iso-timestamp>] [--verify-checks] [--continue-on-failure] [--json]
taskops daemon run <work-dir> [--name <name>] [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--runner-id <id>] [--ttl-seconds <n>] [--max-attempts <n>] [--max-parallel <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--timeout <seconds>] [--report-sink none|ledger|openclaw-chat-inject] [--master-session-key <key>] [--poll-interval-ms <n>] [--daemon-poll-interval-ms <n>] [--failure-backoff-ms <n>] [--max-daemon-cycles <n>] [--continue-on-failure] [--json]
taskops daemon unit <work-dir> [--name <name>] [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--max-parallel <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--json]
taskops daemon enable <work-dir> [--name <name>] [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--max-parallel <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--no-start] [--dry-run] [--json]
taskops daemon install <work-dir> [--name <name>] [--runtime dry-run|openclaw-cli|claude-code|codex-cli|opencode-cli] [--max-parallel <n>] [--max-steps <n>] [--loopback none|self] [--max-loopbacks <n>] [--start] [--dry-run] [--json]
taskops daemon start|stop|restart|status|logs|uninstall <name> [--json]
taskops restart <work-dir> --from <task-id> [--instruction <text>] [--instruction-file <path>] [--reason <text>] [--json]
```

## Honest-loop commands

These commands are the small surface area that keeps long-running agents honest. They never silently mutate progress:

- `taskops next <work-dir> --json` — returns the one next honest action: `execute`, `decompose`, `explore`, `prototype`, `wait`, `delegation_pending`, `blocked`, `done`, or `no_runnable`. Use it instead of guessing what to do next.
- `taskops explain <work-dir> --json` — explains why work is or is not closed: closure summary, next honest action, and concrete open reasons (missing EoW, blockers, waiting delegations, runnable/decompose/explore/prototype tasks, validation errors).
- `taskops audit <work-dir> [--strict] [--max-tasks-flat <n>] [--json]` — checks whether a work tree is safe to cite as a strong progress/completion claim. It flags shallow flat decomposition for complex objectives, manual EoW closure, structural-but-unapproved completion, stale queue projection rows, and closed markdown tasks that still have active queue rows/leases/attempts. Use `--strict` before paper, benchmark, release, or unattended-work claims.
- `taskops close <work-dir> <run-node-id|task-id> [--reason <reason>] [--json]` — make EoW closure explicit and guarded. It refuses to close a task that already has an EoW, has open child branches, or is not yet `done` unless `--reason manual_verified` is supplied. It refuses to close a run node unless its status is `done`/`cancelled` or an explicit reason (`failure`, `superseded`, `cancelled`, `manual_verified`) is supplied. Use this rather than editing EoW files by hand.

## v0.9 verify-grounded completion

TaskOps v0.9 makes strong completion claims depend on runner-owned evidence, not an agent's self-report.

- Use `taskops run <work-dir> --verify-checks` when a task has `acceptance.requiredChecks` and the result needs to be claim-safe. The runner executes the checks itself and records `verifiedBy: runner`.
- Use `taskops delegate <work-dir> --verify-checks` for delegated execution that must pass `acceptance.requiredChecks`; combine with `--verify-retries <n>` for bounded repair.
- Use `--verify-retries <n>` with `--verify-checks` when a failed check should be fed back for bounded repair/test-time-scaling. Do not use unbounded retries.
- Use `--continue-on-failure` when a failed task should become an honest blocked/stalled branch while other runnable work continues.
- A task with no executable `requiredChecks`, no produced required artifacts, and no semantic assertions should not be treated as `policy_approved_complete`. Empty checks are intentionally non-certifying.
- `taskops trainingdata <work-dir> [--summary]` emits labels from runner-verified trajectories. Treat these labels as useful only when they rest on verified completion/stall evidence.
- `policy_approved_complete` is stronger than structural EoW closure. Structural closure can mean "the graph is closed"; policy-approved closure means TaskOps has evidence that the work passed its declared acceptance policy.

## Running TaskOps work

`taskops run <work-dir>` is the canonical way to advance a TaskOps work graph. The skill is passive guidance; the runner is the layer that actually mutates state.

- Use `taskops run <work-dir>` instead of editing run nodes / EoW / runRefs / child task groups by hand. The runner deterministically picks the next task (active snapshot order, then `task.order`, then `id`), classifies it, and dispatches the matching action.
- The runner handles four actionable task readiness states each as one bounded step:
  - `runnable` — creates the run node, executes via the executor, marks the task done, writes the task and run EoW nodes, and creates the `closes_with` edge.
  - `needs_decomposition` — creates a `type: decomposition` run node, expands the task graph with a child task group and a v1 version (dry-run synthesizes a deterministic placeholder; `openclaw-agent` delegates authoring to the agent and verifies the result), sets the parent task's `childTaskGroupId`, closes the parent task with EoW reason `decomposed_by_runner`, and extends the active snapshot's `selectedVersions` so the new child task group/version becomes visible to later steps of the same runner invocation.
  - `needs_exploration` — creates a `type: exploration` run node, writes a reflection artifact at `runs/<run-id>/artifacts/<run-node-id>.md`, closes only the supporting run node, and advances the still-open source task to informed decomposition.
  - `needs_prototype` — creates a `type: prototype` run node and requires a non-empty UTF-8 `options.md`; success closes only the supporting run node and puts the source task in `status: waiting` with `resolverKind: human`.
- To resume execution after prototype success, fill both generated `## DECISION`
  and `## BASIS` sections on the waiting source task. Leaving either section
  empty keeps the task waiting and prevents execution from resuming.
- `blocked` tasks are excluded from execution. If only blocked tasks remain the runner stops with `blocked_only`.
- Before each selection pass, the runner rechecks blocked tasks with `blockedBy` references. If every referenced task/run node blocker is `done` or `cancelled`, it reopens the task (`status: pending`) and clears `runReadiness: blocked` unless `unblockRunReadiness` is set. Use `taskops unblock-check <work-dir> --dry-run --json` to inspect this without mutation.
- `status: waiting` tasks and non-delegate run nodes, and `type: delegate` run nodes that are not yet `done`/`cancelled`, pause the runner with stop reason `waiting` or `delegation_pending`. Delegate type wins over generic waiting, so `type: delegate` + `status: waiting` reports `delegation_pending`. Surface the pause to the user; do not auto-skip.
- Prefer `--executor openclaw-agent --agent <agent-id>` for real execution, decomposition, exploration, and prototype work. Default `--agent` is `main`. Only use `--executor dry-run` for smoke tests, reviews, or to demonstrate the graph mutations without touching an external agent — it produces synthetic success and never performs real work. The synthetic decomposition placeholders are explicitly `runReadiness: blocked` so they cannot be mistaken for real progress.
- `--max-steps <n>` bounds the total number of actions (execute + decompose + explore + prototype). `--until <iso-timestamp>` bounds wall-clock work. Both are optional and **combine with OR semantics**: stop before a new step if either limit is reached.
- If neither `--max-steps` nor `--until` is supplied, the runner defaults to `--max-steps 1` — exactly one step, then stop.
- When the user says something like "before tomorrow 9am" or "by EOD", convert the requested deadline to an explicit ISO-8601 timestamp **with timezone** before passing it as `--until`. Do not pass natural-language deadlines.
- Stop reasons reported back: `all_closed`, `graph_closed_unapproved`, `no_runnable`, `blocked_only`, `waiting`, `delegation_pending`, `max_steps`, `deadline_reached`, `max_loopbacks`, `task_failed`, `validation_failed`. `all_closed` means the selected work has structurally valid closures and every claim-bearing closure has matching policy-approved review evidence; `graph_closed_unapproved` is structurally closed but has an unapproved claim. Always surface the reason to the user.
- The runner appends to `runs/<run-id>/events.jsonl` and `runs/<run-id>/run-log.md`, and holds a `.taskops-runner.lock` directory inside the work root while running. Do not launch a second runner against the same work until the lock is gone.
- Do **not** instruct the executing agent to call `taskops run` again — it runs one task. Recursion is the orchestrator's job, not the worker's.
- `--loopback none` (default) keeps the cautious behaviour: every pending `type: delegate` stops the runner. Pass `--loopback self` to let the runner auto-resolve *self-delegates* (`delegateeType: self`, `delegateeRef: self`, `delegateeRef: <work-id>`, or `selfDelegate: true`) by opening a `type: loopback` resolution node in the delegate's own run graph, executing the loopback once, writing a `loopback` edge, and closing both the loopback and the original delegate (`reason: loopback_resolved`, `resolvedBy: loopback`). Non-self delegates are still surfaced as `delegation_pending`. Each loopback counts against `--max-steps` and a separate `--max-loopbacks` budget (default `3`); exceeding it stops with `max_loopbacks` and leaves the delegate open. The executing agent inside a loopback must still not call `taskops run` recursively — orchestration stays at the runner.
- `taskops restart <work-dir> --from <task-id> --instruction "<text>" [--reason <text>] [--instruction-file <path>] [--json]` rolls the active version of the containing task group forward to a new version, marks the prior version `selected: false` and `supersededByVersionId`, points the active snapshot at the new version, and updates the task group's `activeVersionId`. Upstream tasks (`order < target.order`) keep their status and gain `preservedUpstream: true` with a fresh `preserved_upstream_after_restart` EoW when they were done leaves. The target task is reset to `pending`; downstream tasks are reset to `pending`. Task-valued `blockedBy` references to the source version are rebased to the new selected version while external-version and run-node blockers stay unchanged. Selected stale internal restart references are validation errors, so navigation and execution fail closed. Historical runs/run nodes/EoWs are not modified.
- Runner-authored execute, decompose, explore, prototype, and review nodes persist immutable `actionKind`, `attempt`, and `predecessorRunNodeId` identity. Updating an existing node with mismatched identity is rejected.
- With `--json`, the CLI awaits complete pretty-JSON output, including backpressure/drain, before setting its exit status. Successful JSON ends with a newline; command failures stay on stderr.

## Queue projection and watch runner

`taskops queue sync <work-dir>` creates or refreshes `.taskops/queue.sqlite` from the canonical markdown state. The database is rebuildable projection state for queue items, leases, attempts, and progress reports. Deleting it and syncing again must not destroy semantic truth.

`taskops runner once <work-dir>` claims one executable queue item, runs exactly that claimed task through a runtime adapter, releases the lease, refreshes the queue projection, and optionally writes a progress report ledger row.

`taskops runner watch <work-dir>` is the local always-on primitive. It keeps up to `--max-parallel` one-shot worker transactions active, claims a replacement runnable queue item as each worker exits, waits when no queue item is currently claimable, and exits with `all_closed` when TaskOps closure says the work is complete. Queue projection is backlog state, not concurrency state: all selected tasks belong in `.taskops/queue.sqlite`, while `--max-parallel` limits active agents. Bounds such as `--max-waves`, `--max-idle-cycles`, `--idle-exit-after-seconds`, and `--until` are for tests, controlled sessions, and supervised deployments. Watch mode defaults to `--max-attempts 3`; pass `--max-attempts 0` only when an external supervisor owns retry safety.

Important boundary:

- SQLite does not call OpenClaw and does not execute triggers by itself.
- The watch runner is the process that stays alive and invokes the runtime adapter.
- For self-delegated autonomous execution, prefer `taskops delegate <work-dir> --runtime openclaw-cli --max-parallel <n>` or user-facing `taskops run <work-dir> --loopback self ...`; both route through the daemon-backed queue/watch path. Targeted worker invocations of `taskops run --loopback self --target-task-id ...` remain the low-level single-item primitive.
- `taskops daemon install <work-dir> --name <name> --start` is the preferred unattended local mode. It writes a user-systemd service around `taskops daemon run`, not around `runner watch`, so normal `all_closed` watch exits do not become systemd restart loops.
- `taskops daemon run` repeatedly starts watch cycles, preserves stop reasons, sleeps between cycles, and is the foreground process that systemd supervises.
- Runtime adapters: `dry-run`, `openclaw-cli`, `claude-code`, `codex-cli`, and `opencode-cli`.
- `openclaw-cli` maps to same-host `openclaw agent --json`; the other CLI adapters map to their local agent binaries and return structured missing-binary, auth/runtime failure, and timeout diagnostics.
- Use `--timeout <seconds>` with CLI runtimes for unattended waves. Internal timeout finalizes the attempt as failed and releases the lease; external shell `timeout` should be a supervisor last resort, not the normal control path.
- If a runner process is externally killed after claiming a lease, the next queue sync/list/claim operation marks the expired lease stale, finalizes any linked running attempt as failed, and lets the fingerprint retry cap decide whether to reclaim it.
- `--max-attempts <n>` skips queue items whose current markdown fingerprint already has `n` failed runner attempts. Editing the task markdown changes the fingerprint and resets the retry budget.
- Watch mode stops on the first failed wave by default to avoid retry loops. Use `--continue-on-failure` only with `--max-attempts` or a separate retry/attempt guard.
- `--report-sink ledger` records progress in `.taskops/queue.sqlite`.
- `--report-sink openclaw-chat-inject` delivers progress to `--master-session-key` with `openclaw gateway call chat.inject` and records delivery success/failure in the same SQLite report ledger.
- Future dashboard/webhook sinks should not change TaskOps graph truth.

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
taskops audit <work-dir> --strict
taskops summary <work-dir>
```

If you changed the skill itself, also run:

```bash
python3 /home/jimmy/.npm-global/lib/node_modules/openclaw/skills/skill-creator/scripts/package_skill.py <skill-dir> <output-dir>
```
