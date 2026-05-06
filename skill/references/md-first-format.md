# TaskOps md-first format (draft v1)

This document defines the first md-first storage direction for TaskOps.

## Goals

- human-readable and human-editable
- validator-friendly
- append-preserving where possible
- suitable for both skill and Obsidian plugin surfaces
- clear separation between canonical state and derived visualization artifacts

## Design stance

TaskOps should store **canonical decomposition state** and **canonical execution state** in markdown-first structures.
Derived artifacts such as canvas views, summaries, or exports must stay explicitly non-canonical.

## Top-level project shape

```text
<taskops-project>/
  index.md
  project-log.md
  task-groups/
    <task-group-id>/
      index.md
      versions/
        <version-id>/
          index.md
          decomposition-log.md
          tasks/
            <task-id>.md
  snapshots/
    <snapshot-id>.md
  run/
    index.md
    nodes/
      <run-node-id>.md
    edges/
      <run-edge-id>.md
    run-log.md
  derived/
    canvases/
    views/
```

## Canonical split

### Task graph canonical area
- `task-groups/`
- `snapshots/`

### Run graph canonical area
- `run/`

### Non-canonical derived area
- `derived/`

## Canonical entity notes

Every canonical entity note should use YAML frontmatter.

Minimum common fields:
- `taskOpsVersion`
- `entityType`
- `id`
- `createdAt`
- `updatedAt?`
- `status?`

## Entity notes

### Project
Path:
- `<project>/index.md`

Suggested fields:
- `taskOpsVersion`
- `entityType: project`
- `id`
- `title`
- `objective`
- `activeRootTaskGroupId`
- `activeSnapshotId?`
- `createdAt`

### TaskGroup
Path:
- `task-groups/<task-group-id>/index.md`

Suggested fields:
- `entityType: taskGroup`
- `id`
- `objective`
- `parentTaskId?`
- `activeVersionId?`
- `createdAt`

### TaskGroupVersion
Path:
- `task-groups/<task-group-id>/versions/<version-id>/index.md`

Suggested fields:
- `entityType: taskGroupVersion`
- `id`
- `taskGroupId`
- `version`
- `summary`
- `supersedesVersionId?`
- `selected: true|false`
- `createdAt`

### Task
Path:
- `task-groups/<task-group-id>/versions/<version-id>/tasks/<task-id>.md`

Suggested fields:
- `entityType: task`
- `id`
- `taskGroupId`
- `taskGroupVersionId`
- `title`
- `objective`
- `responsibility`
- `completionCriteria`
- `order`
- `runReadiness?`
- `runReadinessReason?`
- `understandingLevel?`
- `unknowns?`
- `nextLearningGoal?`
- `decompositionConfidence?`
- `executionConfidence?`
- `childTaskGroupId?`
- `createdAt`

Example exploratory task metadata:

```yaml
runReadiness: needs_exploration
runReadinessReason: The task objective is clear, but the API behavior is not understood well enough to decompose.
understandingLevel: partial
unknowns:
  - retry semantics
  - required permission scope
nextLearningGoal: Run a minimal API trial and write the constraints needed for the next decomposition.
```

### VersionSnapshot
Path:
- `snapshots/<snapshot-id>.md`

Suggested fields:
- `entityType: versionSnapshot`
- `id`
- `rootTaskGroupId`
- `createdAt`
- `label?`

Body should include a deterministic selected-version map, for example:

```yaml
selectedVersions:
  - taskGroupId: tg-root
    versionId: tgv-root-v1
  - taskGroupId: tg-design
    versionId: tgv-design-v3
```

### Run index
Path:
- `run/index.md`

Suggested fields:
- `entityType: run`
- `id`
- `projectId`
- `createdAt`

### RunNode
Path:
- `run/nodes/<run-node-id>.md`

Suggested fields:
- `entityType: runNode`
- `id`
- `runId`
- `type`
- `title`
- `status`
- `sourceTaskId?`
- `sourceTaskGroupVersionId?`
- `createdAt`

Suggested `type` values include `execute`, `explore`, `debug`, `review`, and `verify`. Use `explore` when the run objective is learning enough to update task readiness or decomposition.

### RunEdge
Path:
- `run/edges/<run-edge-id>.md`

Suggested fields:
- `entityType: runEdge`
- `id`
- `runId`
- `fromRunNodeId`
- `toRunNodeId`
- `edgeType`
- `createdAt`

## Logging files

Append-oriented logs should be plain markdown:
- `project-log.md`
- `decomposition-log.md`
- `run-log.md`

Purpose:
- preserve rationale
- preserve review/audit trail
- avoid hiding important structural changes behind silent rewrites

## Validation targets

Validator v1 should check at least:

### Task graph
- required files/folders exist
- ids match paths
- task-group-version ownership is coherent
- sibling task ids are unique
- optional invariant warnings for coverage / orthogonality / closure quality
- only one active version per task group unless explicitly marked otherwise

### Snapshots
- selected task groups exist
- selected versions exist
- selected path is structurally reachable from root

### Run graph
- run nodes exist
- run edges reference real nodes
- referenced source task/task-group-version ids exist if present

## Selection model

Important rule:
- version trees may exist broadly
- snapshots materialize chosen paths
- the system should not generate or persist all theoretical combinations

## Derived artifacts

Examples:
- Obsidian canvas exports
- tree summaries
- filtered work views
- visual layouts

All should live under `derived/` and be clearly labeled non-canonical.

## Reference example

See `../examples/taskops-canonical-minimal-v1/` for the first concrete v1-shaped example using:
- versioned task groups
- a selected snapshot
- a separate run graph
- a clearly non-canonical `derived/` area

## Migration note

This format is a reset from the earlier `graph-task` md-first project/step/phase/node hierarchy.
That older shape is still useful as source material, but TaskOps v1 should align storage around:
- versioned task groups
- explicit snapshots
- explicit run graph separation
