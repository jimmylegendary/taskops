# TaskOps Decomposition Protocol

TaskOps is not a checklist store. It turns an objective into a task tree, then uses execution feedback to improve the tree over time.

## Core loop

1. State the work objective in one sentence.
2. Decompose only one requested depth at a time.
3. Classify each task node by run readiness:
   - `runnable`
   - `needs_decomposition`
   - `needs_exploration`
   - `needs_prototype`
   - `blocked`
4. Send only `runnable` nodes into an independent run graph under `runs/<run-id>/`.
5. For `needs_decomposition`, create the next task group/version.
6. For `needs_exploration`, create an exploratory run whose purpose is understanding, not delivery; close only that supporting run node and keep the source task open for informed decomposition.
7. For `needs_prototype`, create cheap alternatives in a non-empty UTF-8 `options.md`; close only the supporting run node and wait for human resolution on the source task.
8. If a run needs a human, another AI, an agent, or an external system, create a `type: delegate` / `status: waiting` run node with expected output and timeout metadata.
9. After every run, feed the result back into the task graph: update unknowns, constraints, decomposition, readiness, or task↔run refs.
10. When a selected branch is truly terminal, attach an explicit EoW node. A branch without EoW is still open.

## Objective discipline

Every work root and task group should have a one-line objective. That objective is the root of its decomposition tree.

Good:

```text
Build a today-first action app that makes the current actionable surface trusted.
```

Bad:

```text
Research tasks, build screens, define states, test, polish, launch.
```

The bad example is an activity list. It mixes levels and hides responsibility boundaries.

## Depth discipline

Default decomposition depth is `1`.

A depth-1 result should contain the largest responsibility units under the parent objective, not every activity the system can imagine.

Example:

```text
Develop Today It app
├─ Define product contract
├─ Design core action loop
├─ Build app foundation
├─ Implement core features
└─ Verify MVP
```

Only decompose a child when the current child is not runnable and the system understands enough to split it honestly.

## Anti-list validator heuristics

A decomposition should be reviewed when:

- sibling tasks mix abstraction levels
- tasks are activities rather than responsibility units
- parent-child relationship is weak or merely topical
- depth expands before the parent objective is stable
- a task is marked decomposable even though the system cannot explain the child responsibilities

## Negative feedback loop

TaskOps should improve inductively:

```text
objective
→ tree decomposition
→ run-readiness classification
→ run / decompose / explore
→ result + delegation + failure + learned constraints
→ revised tree
→ EoW closure when a branch is terminal
→ better next classification
```

The important rule: failed or exploratory execution is not waste. It is feedback that updates the task graph.

## Closure discipline

Do not treat `done` as the same thing as EoW.

- `done` is a status on a task or run node.
- `EoW` is a visible terminal graph node declaring that this branch/path should not decompose or execute further.

Work completion should be derived from graph closure:

```text
all active-snapshot terminal task branches have EoW
+ required terminal run paths have EoW
+ no unresolved waiting/delegated/blocking nodes remain
```

Supporting EoW records provenance and must validate structurally; it does not
enter the policy-approval denominator. Claim-bearing EoW carries an objective
result and needs matching independent policy review. A structurally closed
graph with an unapproved claim reports `graph_closed_unapproved`, not
`all_closed`.
