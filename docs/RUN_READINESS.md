# Run Readiness

TaskOps classifies every task node before it enters execution.
Execution happens in independent run graphs under `runs/<run-id>/` and should remain bidirectionally traceable to the source task when the run originates from a task.
The exhaustive readiness contract is `runnable | needs_decomposition | needs_exploration | needs_prototype | blocked`.

## Values

### `runnable`

The task can move to the run graph now.

Minimum conditions:

- input is clear
- output is clear
- success can be judged
- responsibility is singular
- running it will not change the meaning of downstream tasks

An explicit `runReadiness: runnable` is not allowed to override contradictory task metadata. If the same task declares `unknowns`, `explorationNeeded`, `needsExploration`, `understandingLevel: unknown`, low execution/decomposition confidence, or `status: blocked`, the classifier downgrades it to the honest readiness (`needs_exploration`, `needs_decomposition`, or `blocked`) and reports the consistency issue. `understandingLevel: partial` on explicit runnable work remains compatible for scoped manual/legacy tasks, but it emits a warning unless the task has concrete scope or acceptance evidence. This keeps stale frontmatter from silently pushing uncertain work into execution while avoiding a blanket hard block for deliberately scoped partial work.

For `acceptance.mode: guarded` or `acceptance.mode: runner-managed`, runnable work must also carry concrete acceptance shape: an `expectedOutcome` plus at least one `requiredArtifacts` or `requiredChecks` entry. Missing concrete acceptance blocks runner-managed execution instead of treating vague acceptance as good enough. Legacy/manual tasks without acceptance, or with `mode: informational`, remain compatible; their acceptance gaps are advisory rather than a hard readiness gate.

### `needs_decomposition`

The task is too large for a single run, and the system understands the domain well enough to split it into child responsibility units.

This is not the same as “large”. Decomposition requires knowledge.

### `needs_exploration`

The task objective is meaningful, but TaskOps does not yet understand the inner structure well enough to decompose or execute honestly.

This is the unknown-unknowns state.

Exploratory runs may include:

- search
- source reading
- small experiment
- tool/API trial
- debug attempt
- try/error loop
- retrospective

The output is not “task completed”. The output is understanding that enables the next decomposition or execution decision.

Required exploratory run output:

- learned facts
- discovered constraints
- failed/successful approaches
- remaining unknowns
- recommended next decomposition or runnable task

Exploration records evidence and closes only its supporting run node; the
source task stays open and advances to informed decomposition.

### `needs_prototype`

The requirement is an unknown-known: the system knows which decision is
missing and can cheaply create concrete alternatives before asking a human.

`needs_prototype` creates cheap alternatives for an unknown-known requirement.
Success requires a non-empty UTF-8 `options.md`, closes only a supporting run
node, and puts the source task in `status: waiting` with `resolverKind: human`.

### `blocked`

The task cannot progress until an external dependency, missing input, permission, or decision is resolved.

If the dependency has been intentionally handed to a human, another AI, an agent, or an external system, represent that in the run graph as a delegated waiting node rather than hiding it inside a vague blocker.

## Recommended task frontmatter

```yaml
runReadiness: needs_exploration
runReadinessReason: We do not yet know whether the API supports the required state transition.
understandingLevel: partial
unknowns:
  - API behavior under retry
  - exact validation constraints
nextLearningGoal: Try a minimal API call and summarize the constraints needed for decomposition.
```

Optional confidence fields:

```yaml
decompositionConfidence: 0.4
executionConfidence: 0.2
```

## CLI

```bash
taskops classify-runnable <work-dir> <task-id>
taskops classify-runnable <work-dir> <task-id> --json
```

The command returns the current readiness, reason, and next action:

- `send_to_run_graph`
- `decompose_task_group`
- `create_exploratory_run`
- `resolve_blocker`

When explicit readiness is downgraded, JSON output includes `originalRunReadiness`, `consistencyIssues`, and a compatibility policy note. Plain text output prints the original readiness and each warning/error after the reason.

## Delegated waiting in the run graph

Delegation is execution truth, not decomposition truth.

When a runnable/exploratory task requires someone else to produce an output, create a run node like:

```yaml
entityType: runNode
type: delegate
status: waiting
delegateeType: human|ai|agent|system
delegateeRef: jimmy
request: The concrete ask.
expectedOutput: The exact output needed before downstream execution continues.
requestedAt: 2026-05-08T04:45:00+09:00
timeoutAt: 2026-05-10T04:45:00+09:00
sourceTaskId: task-user-constraints
sourceTaskGroupVersionId: tgv-root-v1
```

Downstream run paths should not continue until the delegated node is resolved, cancelled, or timed out into an explicit follow-up.

## Runner dispatch

`taskops run` consumes every actionable readiness, not only `runnable`. Each step:

| Classification        | Runner action                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runnable`            | Execute via the executor; mark task done; attach task + run EoW; write `closes_with` edge.                                                               |
| `needs_decomposition` | Open a `type: decomposition` run node; expand the task graph with a child task group + version; set parent `childTaskGroupId`; close parent with EoW reason `decomposed_by_runner`. The runner also extends the active snapshot's `selectedVersions` to include the new child task group/version so the new children become visible to later steps of the same runner invocation. |
| `needs_exploration`   | Open a `type: exploration` run node; write a reflection artifact under `runs/<run-id>/artifacts/`; close only the supporting run node and advance the still-open source task to informed decomposition. |
| `needs_prototype`     | Open a `type: prototype` run node and require a non-empty UTF-8 `options.md`; on success close only the supporting run node and put the source task in `status: waiting` with `resolverKind: human`. |
| `blocked`             | Skip unless declared `blockedBy` references have all resolved; then reopen the task before selection. If only unresolved blocked tasks remain, stop with `blocked_only`. |

The runner rechecks `blockedBy` references before each selection pass. A `blockedBy` entry can point at a task (`type: task`, `id`, optional `taskGroupVersionId`) or a run node (`type: runNode`, `runId`, `id`). When all referenced blockers are `done` or `cancelled`, the task is reopened with `status: pending`; `runReadiness: blocked` is cleared unless `unblockRunReadiness` provides the next readiness. `taskops unblock-check <work-dir> --dry-run --json` exposes the same check without mutating files.

The runner pauses immediately on a `status: waiting` task or non-delegate run node, or on a `type: delegate` run node that is not yet `done`/`cancelled`. Delegate type wins over generic waiting, so `type: delegate` + `status: waiting` reports `delegation_pending`.

### Optional loopback mode

When invoked with `--loopback self`, the runner treats pending self-delegate run nodes as resolvable inline instead of stopping with `delegation_pending`: the runner takes the waiting delegation back and executes it itself. Self-delegates are `delegateeType: self`, `delegateeRef: self`, `delegateeRef: <work-id>`, or `selfDelegate: true`; non-self delegates still stop with `delegation_pending`. For each pending self-delegate it opens a `type: loopback` resolution node (`run-node-loopback-<delegate-id>[-<n>]`) in the delegate's own run graph, writes a `loopback` edge from the delegate to the resolution, executes the loopback (dry-run synthesises an artifact; `openclaw-agent` dispatches a fresh single-step agent invocation with a no-recursive-runner prompt), then closes the loopback node (EoW reason `loopback_recorded`) and the original delegate (EoW reason `loopback_resolved`). The original delegate records `executionMode: loopback`, `executedBy: <actor>`, `executedAt`, `resolvedBy: loopback`, and `resolvedByRunNodeId`; pass `--actor <name>` to control the audit-trail executor name. Each loopback counts against `--max-steps` *and* a separate `--max-loopbacks` budget (default `3`). Default policy `--loopback none` preserves the pre-existing pause behaviour.

## Terminal stop reasons

When the runner cannot start a new step, it reports one of the following:

- `all_closed` — the selected graph is structurally closed, every supporting closure validates, and every claim-bearing closure has matching policy-approved review evidence.
- `graph_closed_unapproved` — the graph is structurally closed but at least one claim lacks policy-approved evidence. It is not `all_closed`.
- `no_runnable` — nothing is actionable but the work is not yet closed (terminal EoW coverage incomplete or otherwise inconsistent). Inspect the work before treating this as a successful finish.
- `blocked_only` — open tasks remain but every one is `blocked`.
- `waiting` / `delegation_pending` — a task or run node is parked waiting on something external.
- `max_steps` / `deadline_reached` — safety caps stopped the run before further work could begin. They take precedence over `all_closed` / `no_runnable`.
- `max_loopbacks` — the `--max-loopbacks` budget is exhausted while a delegate is still pending. Resolve the delegate, raise the budget, or invoke `taskops run` again to spend more loopbacks.
- `task_failed` / `validation_failed` — the executor failed or a mid-run re-parse found errors.

## Restarting a task

`taskops restart <work-dir> --from <task-id> --instruction "<text>" [--reason <text>] [--instruction-file <path>] [--json]` rolls the active selected version forward to a new version that re-executes from the named task. It is the safe alternative to manually editing `status: done` back to `pending`:

- Upstream tasks (`order < target.order`) keep their status and gain `preservedUpstream: true` with `preservedFromVersionId`. Done leaves also get a fresh EoW with `reason: preserved_upstream_after_restart` so closure remains explicit.
- The target task is reset to `pending` and gains `restartInstruction`, optional `restartReason`, `restartedFromVersionId`, and `restartedAt`.
- Downstream tasks (`order >= target.order`, excluding the target) are reset to `pending`.
- Task-valued `blockedBy` references to the restarted source version are rebased to the new selected version. External-version references and run-node blockers are preserved.
- The prior version is marked `selected: false` with `supersededByVersionId`; historical run nodes/EoWs/edges are not modified. The active snapshot's `selectedVersions` is updated to point at the new version and the parent task group's `activeVersionId` follows if it pointed at the prior version. A `restart from task=…` line is appended to `work-log.md`.

Restart refuses if the project currently has validation errors or if `<task-id>` is missing from or ambiguous across the active snapshot's selected versions. Validation also rejects a selected restarted lineage that still points at a superseded internal task-group version, so navigation and the runner fail closed instead of executing stale dependencies.
