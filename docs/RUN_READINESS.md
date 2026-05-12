# Run Readiness

TaskOps classifies every task node before it enters execution.
Execution happens in independent run graphs under `runs/<run-id>/` and should remain bidirectionally traceable to the source task when the run originates from a task.

## Values

### `runnable`

The task can move to the run graph now.

Minimum conditions:

- input is clear
- output is clear
- success can be judged
- responsibility is singular
- running it will not change the meaning of downstream tasks

### `needs_decomposition`

The task is too large for a single run, and the system understands the domain well enough to split it into child responsibility units.

This is not the same as “large”. Decomposition requires knowledge.

### `needs_exploration`

The task objective is meaningful, but TaskOps does not yet understand the inner structure well enough to decompose or execute honestly.

This is the unknown-unknowns state.

Exploratory runs may include:

- search
- source reading
- small prototype
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
| `needs_exploration`   | Open a `type: exploration` run node; write a reflection artifact under `runs/<run-id>/artifacts/`; close parent with EoW reason `exploration_recorded_by_runner` and switch its `runReadiness` to `needs_decomposition`. |
| `blocked`             | Skip unless declared `blockedBy` references have all resolved; then reopen the task before selection. If only unresolved blocked tasks remain, stop with `blocked_only`. |

The runner rechecks `blockedBy` references before each selection pass. A `blockedBy` entry can point at a task (`type: task`, `id`, optional `taskGroupVersionId`) or a run node (`type: runNode`, `runId`, `id`). When all referenced blockers are `done` or `cancelled`, the task is reopened with `status: pending`; `runReadiness: blocked` is cleared unless `unblockRunReadiness` provides the next readiness. `taskops unblock-check <work-dir> --dry-run --json` exposes the same check without mutating files.

The runner pauses immediately on a `status: waiting` task or non-delegate run node, or on a `type: delegate` run node that is not yet `done`/`cancelled`. Delegate type wins over generic waiting, so `type: delegate` + `status: waiting` reports `delegation_pending`.

## Terminal stop reasons

When the runner cannot start a new step, it reports one of the following:

- `all_closed` — every selected terminal task is closed by task EoW, every run terminal node is closed by run EoW, and no waiting/delegated/blocked work remains. This is the closure-complete terminal state.
- `no_runnable` — nothing is actionable but the work is not yet closed (terminal EoW coverage incomplete or otherwise inconsistent). Inspect the work before treating this as a successful finish.
- `blocked_only` — open tasks remain but every one is `blocked`.
- `waiting` / `delegation_pending` — a task or run node is parked waiting on something external.
- `max_steps` / `deadline_reached` — safety caps stopped the run before further work could begin. They take precedence over `all_closed` / `no_runnable`.
- `task_failed` / `validation_failed` — the executor failed or a mid-run re-parse found errors.
