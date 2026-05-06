# TaskOps core model

This document freezes the first shared conceptual contract for TaskOps.

## 1. Layer split

TaskOps has two connected but distinct layers.

### 1.1 Task graph
Purpose:
- represent decomposition truth
- enforce structural quality
- preserve version history of decomposition changes

### 1.2 Run graph
Purpose:
- represent execution truth
- capture real dependency, overlap, reuse, and branching work
- connect work across levels when reality does not stay tree-shaped

## 2. Main entities

### 2.1 TaskGroup
A versioned decomposition unit.

Fields:
- `id`
- `objective`
- `parentTaskId?`
- `activeVersionId?`
- `createdAt`
- `status?` (optional high-level lifecycle state)

### 2.2 TaskGroupVersion
A concrete decomposition of one task group.

Fields:
- `id`
- `taskGroupId`
- `version`
- `summary`
- `createdAt`
- `supersedesVersionId?`
- `isSelected`

Contains:
- ordered child tasks
- decomposition rationale
- validation metadata

### 2.3 Task
A child responsibility unit in one specific task-group version.

Fields:
- `id`
- `taskGroupVersionId`
- `title`
- `objective`
- `responsibility`
- `completionCriteria`
- `order`
- `runReadiness?` (`runnable | needs_decomposition | needs_exploration | blocked`)
- `runReadinessReason?`
- `understandingLevel?` (`known | partial | unknown`)
- `unknowns?`
- `nextLearningGoal?`
- `decompositionConfidence?`
- `executionConfidence?`
- `childTaskGroupId?`

A task may point to a child task group if it is further decomposed.
If TaskOps does not understand the domain well enough to split a task, the task should be marked `needs_exploration` rather than forcing a fake decomposition.

### 2.4 VersionSnapshot
A selected version path across connected task groups.

Fields:
- `id`
- `rootTaskGroupId`
- `selectedVersionMap`
- `createdAt`
- `label?`

Important:
- a snapshot records a chosen path
- it is not the materialization of all combinatorial version states

### 2.5 RunNode
A unit of execution reality.

Fields:
- `id`
- `type`
- `title`
- `objective?`
- `status`
- `sourceTaskId?`
- `sourceTaskGroupVersionId?`
- `createdAt`

### 2.6 RunEdge
A relation between run nodes.

Fields:
- `id`
- `fromRunNodeId`
- `toRunNodeId`
- `edgeType`
- `note?`

Suggested `edgeType` examples:
- `depends_on`
- `informs`
- `reuses`
- `blocks`
- `follows`
- `tests`

## 3. Task graph invariants

These are the core quality rules.

### 3.1 Coverage
The child tasks in a task-group version must be sufficient to accomplish the parent objective.

Operational test:
> If every child task completes, can we honestly say the parent objective is accomplished?

### 3.2 Responsibility orthogonality
Sibling tasks must not overlap in:
- primary responsibility
- primary ownership of the same deliverable
- completion judgment

Allowed:
- shared context
- mutual influence
- downstream impact on each other
- overlap in actual execution work inside the run graph

Not allowed:
- two sibling tasks both being the primary owner of the same thing
- two sibling tasks requiring the same completion judgment to be considered done

### 3.3 Closure
Each task must have a locally understandable completion boundary.

Operational test:
> Can a human say what “done” means for this task without reading the entire project history?

## 4. Task graph operations

### 4.1 `decompose`
Creates the first concrete child-task set for a task group.

Input:
- parent task group objective
- rationale
- proposed children

Output:
- new `TaskGroupVersion`
- child `Task` records
- optional validation report

### 4.2 `refactor`
Creates a new version of an existing task group.

Use when:
- coverage is weak
- sibling responsibility is overlapping
- completion boundaries are unclear
- learning changed the best decomposition

Important:
- refactor does not erase old decomposition history
- refactor creates a new `TaskGroupVersion`
- child subtrees become version-dependent under the chosen path

## 5. Run graph rules

The run graph may be messier than the task graph.
That is expected.

Allowed in run graph:
- overlapping work
- cross-level work relations
- one run node helping multiple tasks
- reused outputs
- exploratory loops
- explicit debugging, verification, and review work

Exploratory run nodes are valid execution truth when their objective is learning: search, try/error, prototype, debug, or review enough context to improve the next task-graph decision.

The run graph should tell the truth about how work actually unfolded, even when that truth is not tree-shaped.

## 6. Relation between task and run layers

### 6.1 Traceability
A run node may link back to:
- one source task
- one source task-group version
- or neither, if the work emerged opportunistically

### 6.2 Non-isomorphism
The run graph is not required to mirror the task graph one-to-one.
That would be a design mistake.

Task graph answers:
> What is the right decomposition?

Run-readiness classification answers:
> Should this task run now, decompose next, explore first, or wait on a blocker?

Run graph answers:
> What actually happened in execution?

### 6.3 Honest divergence
If real work repeatedly violates a decomposition, that is a signal to consider `refactor`.
The solution is not to falsify the run graph.

## 7. Example

### Parent objective
`Build an app that can earn revenue`

### Valid task-group version children
1. Build the product
2. Acquire users
3. Design monetization and pricing
4. Measure and operate growth/revenue loop

Why valid:
- coverage is plausible
- sibling responsibility is distinct
- each task can have local completion criteria

Why run graph still matters:
- pricing research may alter product UX
- acquisition work may change onboarding
- analytics may reshape monetization and product roadmap

Those overlaps belong in the run graph, not as an excuse to blur decomposition responsibilities.

## 8. Immediate implementation implications

The first implementation should favor:
- explicit ids
- append-preserving history
- version selection over destructive overwrite
- validator checks for task-graph invariants
- md-first human inspectability

The first implementation should avoid:
- combinatorial snapshot explosion
- implicit mutation magic
- overfitting the model to one UI surface
