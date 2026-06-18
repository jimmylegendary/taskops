# Loopback Delegation Requirements

## Purpose

TaskOps has two execution paths that must become one coherent delegation path:

- `taskops run --loopback self` can reclaim pending self-delegate run nodes and resolve them through the runner, but it is a low-level worker primitive.
- `taskops runner watch` and `taskops daemon run/enable` provide the queue, lease, attempt, progress-report, and systemd-supervised execution path.

When a user asks for TaskOps delegated autonomous execution, the queue/daemon path must be able to run with self-loopback enabled so that the actual flow is:

```text
canonical markdown task graph
-> queue projection in .taskops/queue.sqlite
-> runner/daemon claims executable queue items
-> each claim opens a lease and runner_attempt
-> worker invokes taskops run with openclaw-agent and loopback policy
-> pending self-delegates are reclaimed as loopback run nodes
-> OpenClaw agent executes the loopback resolution
-> loopback node and original delegate node are closed by EoW
-> claimed task execution continues or is requeued honestly
-> progress is recorded in SQLite
-> queue projection refreshes
-> dependencies unblock and later waves continue
-> explain reports all_closed or an honest pause/failure
```

The implementation must not split "delegation mode" into an unqueued `taskops run --loopback self` path and a queue-backed daemon path that cannot pass loopback options.

User-facing delegated autonomous execution must reuse the daemon-backed path. Keep the explicit daemon CLI commands, but when a high-level command is asked to run delegated TaskOps work with `--loopback self`, it should activate or call the same daemon path internally rather than creating a second orchestration loop. Low-level targeted `taskops run --loopback self --target-task-id ...` remains available for the worker process; it is not the normal autonomous entrypoint.

## Implemented Contract

`taskops run` accepts:

```bash
taskops run <work-dir> --loopback none|self --max-loopbacks <n>
```

For non-targeted user-facing `taskops run --loopback self`, the CLI now calls the same daemon-backed queue/watch path used by `taskops delegate --foreground`. Targeted worker invocations keep the low-level run path:

```bash
taskops run <work-dir> \
  --executor <dry-run|openclaw-agent> \
  --max-steps <n> \
  --loopback self \
  --max-loopbacks <n> \
  --target-task-id <task-id> \
  --target-task-group-version-id <version-id> \
  --allow-concurrent-target \
  --run-id <worker-run-id> \
  --json
```

Queue-backed workers receive `--loopback`, `--max-loopbacks`, and variable `--max-steps` from `runner watch` / `daemon run`. `--run-id` is preserved through the daemon options and used as the prefix for daemon-backed worker run ids.

Loopback resolution consumes a `taskops run` step, so delegated runs should set `--max-steps` high enough to both resolve self-delegates and complete claimed tasks. Queue release and attempt status distinguish "made loopback progress" from "claimed task reached a terminal result".

Current queue behavior is close to the desired direction: `syncQueueProjection` projects every selected task into `.taskops/queue.sqlite`, while `claimQueueItems(..., limit: maxParallel)` only claims a bounded batch for execution. The implementation must preserve that separation: queue size is not concurrency.

## Required CLI Surface

Add loopback options to queue-backed runner commands:

```bash
taskops runner once <work-dir> \
  [--runtime dry-run|openclaw-cli] \
  [--loopback none|self] \
  [--max-loopbacks <n>] \
  ...

taskops runner watch <work-dir> \
  [--runtime dry-run|openclaw-cli] \
  [--loopback none|self] \
  [--max-loopbacks <n>] \
  ...
```

Add the same options to daemon commands:

```bash
taskops daemon run <work-dir> \
  [--runtime dry-run|openclaw-cli] \
  [--loopback none|self] \
  [--max-loopbacks <n>] \
  ...

taskops daemon unit <work-dir> \
  [--runtime dry-run|openclaw-cli] \
  [--loopback none|self] \
  [--max-loopbacks <n>] \
  ...

taskops daemon enable <work-dir> \
  [--runtime dry-run|openclaw-cli] \
  [--loopback none|self] \
  [--max-loopbacks <n>] \
  ...

taskops daemon install <work-dir> \
  [--runtime dry-run|openclaw-cli] \
  [--loopback none|self] \
  [--max-loopbacks <n>] \
  ...
```

Defaults:

- `--loopback none` remains the default for backward compatibility.
- `--max-loopbacks` is a safety fuse, not the main work-sizing knob. It prevents infinite self-delegate recursion or repeated self-delegate loops inside one worker/run.
- `--max-loopbacks` defaults to the existing `taskops run` default when loopback is `self`.
- When `--loopback none`, the effective loopback budget is zero.

Add or document one high-level delegated execution entrypoint that routes to daemon activation. The exact CLI name can be chosen during implementation, but the semantics must be:

```bash
taskops <delegated-entrypoint> <work-dir> \
  --runtime openclaw-cli \
  --loopback self \
  --max-parallel 3 \
  --max-steps <large-safety-cap> \
  --until <optional-deadline>
```

This entrypoint must internally call the same code path as `taskops daemon enable` or `taskops daemon run`, not a separate ad hoc loop. The explicit daemon commands remain available for users who want direct control:

```bash
taskops daemon enable <work-dir> --runtime openclaw-cli --loopback self ...
taskops daemon run <work-dir> --runtime openclaw-cli --loopback self ...
```

## Required Runtime Behavior

### Runner once/watch

`runQueueOnce`, `runQueueWave`, and `runQueueWatch` must accept and propagate:

- `loopback`
- `maxLoopbacks`

`runClaimedQueueItemWorker` must pass those values to the child `taskops run` invocation:

```bash
taskops run ... --loopback self --max-loopbacks <n>
```

only when requested. The dry-run runtime must use the same option path so smoke tests can cover the behavior without invoking OpenClaw.

Queue projection and worker scheduling requirements:

- `taskops queue sync` must project all selected task nodes into `.taskops/queue.sqlite`, not only the tasks that can run immediately.
- Queue capacity should be treated as a large operational limit, not as the concurrency limit. Use a default capacity around 1000 queue items if a hard cap is introduced.
- Blocked or not-yet-runnable tasks should remain visible in the queue projection with honest `status`, `readiness`, and `blocked_reason`.
- `--max-parallel <n>` means the maximum number of concurrently running worker agents, not the number of queue items.
- If 10 tasks are ready and `--max-parallel 3`, all 10 belong in the queue projection, 3 workers should run concurrently, and the remaining runnable items should wait for worker capacity.
- When one worker exits and active worker count drops below `--max-parallel`, the watch/daemon loop should claim and start another runnable queue item without waiting for all workers in the earlier batch to finish.
- Each worker process/session should be one-shot: claim one queue item, run it to a terminal or honest non-terminal result, record evidence, release/finalize its lease, then exit.
- The daemon/watch process is the pool supervisor. Worker agents must not become long-lived daemons and must not recursively run queue control commands.

### Daemon

`normalizeDaemonOptions`, `renderSystemdUnit`, `enableDaemon`, `installDaemon`, and `runDaemon` must preserve and pass:

- `loopback`
- `maxLoopbacks`

The generated user-systemd unit must include loopback flags when configured, for example:

```text
ExecStart=... taskops daemon run <work-dir> ... --loopback self --max-loopbacks 3
```

`.taskops/runner.json` must record:

- `loopbackPolicy`
- `maxLoopbacks`

so activation state reflects whether delegated loopback execution is actually enabled.

High-level delegated execution must reuse this daemon implementation:

- Do not create a parallel "loopback runner" outside daemon/watch.
- If the high-level entrypoint starts work in the foreground, it should call `runDaemon` with bounded options.
- If the high-level entrypoint starts unattended work, it should call `enableDaemon` and persist `.taskops/runner.json`.
- Tests for the high-level entrypoint should assert that the daemon path was used, including queue sync, activation config, and watch cycle evidence.

## Step Budget, Deadlines, And Lease Semantics

The current queue worker uses `taskops run --max-steps 1`. That is too small for real delegated autonomous execution. `--max-steps` and `--until` are safety bounds to prevent runaway execution; they are not intended to be the normal unit of work. Real delegated runs should use a large enough step budget to let useful progress happen while still bounding mistakes.

The worker still needs a clear claimed-task boundary. It may need to:

1. resolve one or more self-delegate nodes, then
2. continue executing or closing the originally claimed task.

Implement a budget policy explicitly:

### Required Policy: Separate Safety Budgets

Add separate safety budgets:

```text
max total steps = large safety cap
max loopback steps = --max-loopbacks
max claimed task completions per worker = 1
```

`--max-loopbacks` exists only to prevent infinite loopback recursion. It should not be used to control normal task throughput. `--max-parallel` controls concurrent workers. Queue size controls backlog. `--max-steps` and `--until` control runaway risk.

If a worker makes loopback progress but does not complete the claimed task, it must not be treated as a successful claimed-task completion. It must either continue within budget or release/finalize the attempt in a state that lets the daemon honestly requeue, retry, or pause with evidence.

Do not mark a claimed queue item as `done` merely because `stepsRun > 0` when the only completed action was `kind: loopback`.

## Terminal Status Requirements

Update queue worker terminal status mapping so it is target-aware.

Current behavior:

```js
if (result.stepsRun > 0) return 'done';
```

Required behavior:

- `task_failed` and `validation_failed` remain failed.
- failed loopback action remains failed.
- claimed task closed, target action completed, or `all_closed` may release as `done`.
- loopback-only progress must not be reported as completed task work.
- `delegation_pending` with `--loopback none` remains an honest pause/failure for queue automation unless a future waiting state is introduced.
- `max_loopbacks` is not success; it must leave clear evidence and stop/retry according to retry policy.

Progress reports must identify loopback-only progress separately from task completion:

```text
completed: loopback:<delegate-id>
targetCompleted: false
releaseStatus: <non-terminal or retryable policy>
```

If the existing SQLite schema cannot represent non-terminal progress, document the selected fallback and add tests proving the queue eventually reclaims or honestly pauses.

## Queue And Worker Pool Requirements

The queue runner must behave like a normal bounded worker pool:

```text
queue size: large backlog, default around 1000 if capped
max parallel: active worker limit, for example 3
worker lifetime: one claimed item, then exit
supervisor: daemon/watch keeps filling free slots
```

Required behavior:

- A queue sync with 10 selected runnable tasks must create/project all 10 queue items.
- With `--max-parallel 3`, the daemon/watch supervisor starts at most 3 worker agents at once.
- If one of the 3 workers finishes while 2 continue running, the supervisor should start one more worker so concurrency returns to 3 when runnable backlog exists.
- The supervisor should not wait for a full wave of 3 workers to finish before filling an open slot.
- Queue item ordering should remain deterministic: priority descending, then stable id ordering unless a future scheduler changes it intentionally.
- Expired/stale leases must be recoverable by sync/list/claim.
- Attempt limits apply to the same markdown fingerprint; editing the task should reset retry eligibility as it does today.
- Worker completion must refresh queue projection so newly unblocked tasks become claimable.

If the current wave-based implementation waits for all claimed workers before claiming more, replace or extend it with slot-refill scheduling while preserving the existing bounded wave mode for smoke tests if useful.

## Self-Delegate Scope

Loopback mode must only reclaim self-delegates:

- `delegateeType: self`, or
- `delegateeRef: self`, or
- `delegateeRef: <work-id>`

Non-self delegates must still stop as `delegation_pending`. The queue/daemon path must not silently execute human, external agent, or external system delegations.

## Evidence Requirements

A successful loopback-enabled queue/daemon run must leave evidence in both canonical markdown and SQLite.

Canonical markdown:

- original delegate run node changed to `status: done`
- original delegate has `resolvedBy: loopback`
- original delegate has `resolvedByRunNodeId`
- loopback run node exists with `type: loopback`
- loopback run node has EoW reason `loopback_recorded`
- original delegate has EoW reason `loopback_resolved`
- run log includes `loopback_started` and `loopback_completed`
- final task/run closure remains valid

SQLite:

- queue item row exists for the claimed task
- lease row exists and reaches an honest terminal state
- runner_attempt row records runtime adapter, run id, status, and stop reason
- progress report row records loopback activity and final target status

Systemd daemon proof:

- generated unit includes `--loopback self` when configured
- `daemon enable --dry-run --json` exposes loopback activation
- real or smoke daemon cycle preserves loopback settings into `runQueueWatch`

## Test Requirements

Add smoke/unit coverage for these cases.

1. `runner watch --runtime dry-run --loopback self`
   - Given a work graph with a pending self-delegate that blocks downstream completion.
   - The runner resolves the delegate with a loopback node.
   - The downstream/claimed task is not falsely marked complete if only loopback work happened.
   - A later wave or continued step completes the remaining target work.
   - Final `taskops explain` reports `all_closed`.

2. `runner watch --runtime dry-run --loopback none`
   - Same work graph.
   - The runner stops honestly with `delegation_pending` or equivalent failed/pause state.
   - It does not close the delegate.

3. `runner watch --runtime dry-run --loopback self --max-loopbacks 0`
   - Stops with `max_loopbacks`.
   - Does not close the delegate.

4. `runner watch --runtime dry-run --loopback self --max-parallel 2`
   - Independent runnable queue items still run in the same wave.
   - A self-delegate on one item does not corrupt another worker's run graph.

5. Worker-pool refill behavior
   - Given 10 runnable queue items and `--max-parallel 3`.
   - Queue projection contains all 10 items.
   - At most 3 workers run at once.
   - When one worker finishes while two remain active, another worker is started before waiting for the whole original batch to finish.
   - All 10 eventually finish or stop with honest evidence.

6. `daemon unit --loopback self --max-loopbacks 4`
   - Generated unit contains both flags.

7. `daemon enable --dry-run --loopback self --max-loopbacks 4 --json`
   - Activation JSON records the loopback settings.

8. `daemon run --runtime dry-run --loopback self`
   - Foreground daemon cycle passes loopback settings into watch.
   - Ledger progress reports include loopback evidence.

9. High-level delegated execution entrypoint
   - Invoked with `--loopback self`.
   - Internally uses daemon enable/run code path.
   - Produces queue sync, lease, attempt, report, and daemon/watch cycle evidence.

10. `runner watch --runtime dry-run --loopback self` with a non-self delegate
   - Does not execute the delegate.
   - Stops with `delegation_pending`.

If an OpenClaw CLI integration test is available, add one bounded `--runtime openclaw-cli --loopback self --timeout <seconds>` proof that verifies the OpenClaw worker writes the required loopback artifact and that TaskOps refuses to close the loopback when the artifact is missing.

## Documentation Requirements

Update all user-facing command lists:

- `cli/bin/taskops.js` usage text
- `cli/README.md`
- `skill/SKILL.md`
- installed workspace skill proposal for `skills/taskops/SKILL.md`

Document the distinction:

- `type: delegate` means execution truth is waiting on a delegated output.
- `--loopback self` means the runner is explicitly allowed to reclaim self-delegates.
- delegated autonomous mode must route through daemon/watch with `--loopback self`; non-targeted `taskops run --loopback self` is now a user-facing alias into that daemon-backed path, while targeted `taskops run --loopback self --target-task-id ...` remains the low-level worker/debug primitive.
- `--max-loopbacks` is a recursion safety cap, not a concurrency control.
- `--max-parallel` is the concurrent worker-agent count.
- queue capacity/backlog is separate from `--max-parallel`; project all selected tasks, then claim only according to worker capacity.
- `--max-steps` and `--until` are runaway safety bounds and should usually be large enough for the delegated run to make real progress.

## Acceptance Criteria

The implementation is acceptable only when all of the following are true:

- `taskops runner watch --runtime dry-run --loopback self` passes loopback options to worker `taskops run`.
- `taskops daemon enable --runtime openclaw-cli --loopback self` installs a unit whose `ExecStart` preserves loopback settings.
- The high-level delegated execution path for `--loopback self` reuses daemon enable/run internals instead of a separate orchestration loop.
- Queue projection includes all selected tasks up to the configured large queue capacity; `--max-parallel` only limits concurrent workers.
- With 10 runnable tasks and `--max-parallel 3`, all 10 are queued, at most 3 workers run at once, and free slots are refilled as workers exit.
- loopback-only progress cannot falsely release a claimed queue item as completed work.
- self-delegates are resolved through loopback nodes and EoW evidence.
- non-self delegates still stop honestly.
- SQLite contains lease, runner_attempt, and progress report evidence for the delegated flow.
- canonical markdown remains the semantic source of truth.
- `npm test --workspace cli` and `npm run verify` pass.
- A real or bounded smoke proof demonstrates the complete flow from queue sync through runner/daemon, OpenClaw worker invocation, loopback resolution, queue refresh, and `all_closed`.
