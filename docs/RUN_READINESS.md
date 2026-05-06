# Run Readiness

TaskOps classifies every task node before it enters execution.

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
taskops classify-runnable <project-dir> <task-id>
taskops classify-runnable <project-dir> <task-id> --json
```

The command returns the current readiness, reason, and next action:

- `send_to_run_graph`
- `decompose_task_group`
- `create_exploratory_run`
- `resolve_blocker`
