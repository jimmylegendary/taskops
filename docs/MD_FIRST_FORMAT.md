# TaskOps md-first format

This document defines the canonical markdown-first storage direction for TaskOps.

## Goals

- human-readable and human-editable
- validator-friendly
- append-preserving where possible
- suitable for both skill and Obsidian plugin surfaces
- clear separation between canonical state and derived visualization artifacts
- graph-visible closure through explicit EoW nodes

## Design stance

TaskOps stores **canonical decomposition state** and **canonical execution state** in markdown-first structures.
Derived artifacts such as canvas views, summaries, or exports must stay explicitly non-canonical.

## Top-level work shape

```text
<taskops-work>/
  index.md
  work-log.md
  task-groups/
    <task-group-id>/
      index.md
      versions/
        <version-id>/
          index.md
          decomposition-log.md
          tasks/
            <task-id>.md
          eow/
            <eow-id>.md
          partials/
            <partial-id>.md
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
      partials/
        <partial-id>.md
      run-log.md
  derived/
    canvases/
    views/
```

Legacy notes:
- old `entityType: project` roots may still be read, but new roots should use `entityType: work`
- old singular `run/` folders may still be read, but new execution graphs should use `runs/<run-id>/`

## Canonical split

### Task graph canonical area
- `task-groups/`
- `snapshots/`
- task-graph EoW nodes under each selected task-group version's `eow/`

### Run graph canonical area
- `runs/<run-id>/`
- run-graph EoW nodes inside the run graph's `nodes/`

### Non-canonical derived area
- `derived/`
- old generated `canvases/` folders when present

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

### Work

Path:
- `<work>/index.md`

Suggested fields:
- `taskOpsVersion`
- `entityType: work`
- `id`
- `title`
- `objective`
- `activeRootTaskGroupId`
- `activeSnapshotId?`
- `createdAt`
- `status`

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
- `runRefs?`
- `acceptance?`
- `createdAt`

Example task↔run reference:

```yaml
runRefs:
  - runId: run-alpha-v1
    runNodeId: run-node-verify
    role: verification
```

Example semantic acceptance assertions:

```yaml
acceptance:
  mode: runner-managed
  expectedOutcome: Published report matches the current artifact and cites the required source.
  semanticAssertions:
    contentIncludes:
      - semantic-controller
    requiredUrls:
      - https://example.com/current-report
    requiredArtifactIdentities:
      - reports/current/index.html
    requiredSources:
      - docs/RUN_READINESS.md
    forbiddenUrls:
      - https://example.com/stale-report
    forbiddenArtifacts:
      - reports/stale/index.html
    requiredCoverage:
      - runner-managed-acceptance
```

The review command checks these against `runNode.result.observed` (`content`/`contentText`, `urlRefs`/`urls`, `artifactRefs`, `sourceRefs`/`citationRefs`, and `coverage`). The stricter closure policy applies to `enforced`, `guarded`, and `runner-managed`; `informational` remains advisory for manual/legacy tasks.

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

### EoW for task graph

Path:
- `task-groups/<task-group-id>/versions/<version-id>/eow/<eow-id>.md`

New TaskOps writers use deterministic v2 EoW IDs:

- task: `eow-v2-t.<base64url(taskId UTF-8)>.<base64url(taskGroupVersionId UTF-8)>`
- run: `eow-v2-r.<base64url(runNodeId UTF-8)>.<base64url(runId UTF-8)>`

The dot-framed base64url components are reversible and make the work-wide EoW
namespace injective across graph kind and tuple components. Consumers must
treat the complete ID as opaque rather than infer semantics by splitting it.
Existing qualified-v1 and unqualified-v0 IDs remain readable and immutable.
New writes never rename or rewrite them.

When looking for an existing task EoW, writers check canonical v2, lossy
qualified v1, then original unqualified v0. A candidate is reusable only when
its filename and frontmatter ID agree and its complete ownership tuple is
exactly `(graphType: task, attachedToType: task, attachedToId: taskId,
taskGroupVersionId)`. A qualified-v1 candidate owned by a different tuple is
skipped only when that valid stored tuple recomputes to the same lossy legacy
ID; canonical-v2 and unqualified-v0 ownership mismatches are errors. Unsafe
unqualified IDs are not probed as paths. Compatible existing files are reused
byte-for-byte. Only a fresh canonical write is subject to the pre-write limit
of 255 UTF-8 bytes for the complete `<eow-id>.md` filename.

Suggested fields:
- `entityType: eow`
- `id`
- `graphType: task`
- `attachedToType: task`
- `attachedToId`
- `reason`
- `declaredBy`
- `declaredAt`
- `evidenceRefs?`
- `createdAt`
- `status: done`

Canonical v2 write example:

```yaml
entityType: eow
id: eow-v2-t.dGFzay12ZXJpZnktZXhhbXBsZQ.dGd2LXJvb3QtdjE
graphType: task
attachedToType: task
attachedToId: task-verify-example
taskGroupVersionId: tgv-root-v1
reason: no_further_decomposition
declaredBy: ai
declaredAt: 2026-05-08T04:45:00+09:00
evidenceRefs:
  - run:run-alpha-v1/node:run-node-verify
status: done
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

Body/frontmatter should include a deterministic selected-version map, for example:

```yaml
selectedVersions:
  - taskGroupId: tg-root
    versionId: tgv-root-v1
  - taskGroupId: tg-design
    versionId: tgv-design-v3
```

### Run index

Path:
- `runs/<run-id>/index.md`

Suggested fields:
- `entityType: run`
- `id`
- `workId`
- `createdAt`
- `status`

### RunNode

Path:
- `runs/<run-id>/nodes/<run-node-id>.md`

Suggested fields:
- `entityType: runNode`
- `id`
- `runId`
- `type`
- `title`
- `status`
- `sourceTaskId?`
- `sourceTaskGroupVersionId?`
- `actionKind`
- `attempt?`
- `predecessorRunNodeId?`
- `createdAt`

`actionKind` is required on every modern run node. It is legacy-optional only
when `actionKind`, `attempt`, `predecessorRunNodeId`, and the attached EoW's
`closureRole` are all absent as properties. Null or blank modern fields are
malformed and cannot contribute policy-approved claim evidence.

These four modern-cohort witnesses are own-properties: inherited values do not
make a record modern. Any one own-property witness selects the modern contract,
including a null or blank value. Historical malformed claims remain
parse-readable for audit, but they are not policy-approved and cannot approve
restart carry-forward provenance.

Suggested `type` values include `execute`, `explore`, `debug`, `review`, `verify`, and `delegate`.
Use `explore` when the run objective is learning enough to update task readiness or decomposition.
Use `delegate` when work is intentionally handed to a human, another AI, an agent, or an external system.

Delegation/waiting example:

```yaml
entityType: runNode
id: run-node-human-decision
runId: run-alpha-v1
type: delegate
title: Ask Jimmy to confirm constraints
status: waiting
sourceTaskId: task-user-constraints
sourceTaskGroupVersionId: tgv-root-v1
delegateeType: human
delegateeRef: jimmy
request: Confirm the constraints needed before downstream execution.
expectedOutput: A clear decision and any constraints that update the task graph.
requestedAt: 2026-05-08T04:45:00+09:00
timeoutAt: 2026-05-10T04:45:00+09:00
```

### EoW for run graph

Path:
- `runs/<run-id>/nodes/<eow-id>.md`

New TaskOps writers use the same deterministic v2 EoW namespace:

- task: `eow-v2-t.<base64url(taskId UTF-8)>.<base64url(taskGroupVersionId UTF-8)>`
- run: `eow-v2-r.<base64url(runNodeId UTF-8)>.<base64url(runId UTF-8)>`

The dot-framed components are reversible, graph-kind-separated base64url
encodings, but the complete ID is opaque to consumers. Existing qualified-v1
and unqualified-v0 records remain readable at their original IDs. Run writers
resolve candidates in canonical-v2, lossy qualified-v1, unqualified-v0 order
and reuse a record only when its filename/frontmatter ID and exact
`(graphType: run, attachedToType: runNode, attachedToId: runNodeId, runId)`
ownership tuple match. A proven qualified-v1 lossy collision may be skipped;
other ownership mismatches are errors. Fresh canonical filenames must fit the
255-byte UTF-8 budget including `.md`, checked immediately before the write.

Suggested fields:
- `entityType: eow`
- `id`
- `runId`
- `graphType: run`
- `attachedToType: runNode`
- `attachedToId`
- `reason`
- `closureRole: supporting | claim-bearing`
- `declaredBy`
- `declaredAt`
- `createdAt`
- `status: done`

Run EoW nodes should usually be connected by a `runEdge` with `edgeType: closes_with`.
The edge must target the actual EoW ID returned by resolution or creation, not
an independently reconstructed ID. This applies to automatic, review, and
manual closure, so a compatible reused legacy EoW keeps its original edge
target.

Manual close first checks parsed logical closure across all supported ID
formats. If the target already has an EoW, it retains the existing
`already closed by EoW` error rather than acting as resolver-driven idempotent
reuse. A fresh manual task or run close writes canonical v2; a fresh manual run
edge targets the exact generated ID.

- `closureRole: supporting` records provenance and is structurally validated,
  but it is not in the policy-approval denominator.
- `closureRole: claim-bearing` carries an objective result and requires a real,
  matching independent review before policy-approved completion.

### Partial markers

Partial markers record honest unfinished progress. They are deliberately **not** EoW nodes:
they do not close task branches, do not close run paths, and do not occupy canonical
`eow-<id>` slots.

Paths:
- `task-groups/<task-group-id>/versions/<version-id>/partials/<partial-id>.md`
- `runs/<run-id>/partials/<partial-id>.md`

Suggested fields:
- `entityType: partial`
- `id`
- `graphType: task | run`
- `attachedToType: task | runNode`
- `attachedToId`
- `taskGroupVersionId` for task partials
- `runId` for run partials
- `reason: partial_complete`
- `completedSummary`
- `incompleteSummary`
- `followUpNeeded: true`
- `supersededBy: null`
- `budget`
- `declaredBy`
- `declaredAt`
- `createdAt`
- `status: active`

### RunEdge

Path:
- `runs/<run-id>/edges/<run-edge-id>.md`

Suggested fields:
- `entityType: runEdge`
- `id`
- `runId`
- `fromRunNodeId`
- `toRunNodeId`
- `edgeType`
- `createdAt`

`fromRunNodeId` and `toRunNodeId` may point to either a `runNode` or an EoW node inside the same run graph.

## Logging files

Append-oriented logs should be plain markdown:
- `work-log.md`
- `decomposition-log.md`
- `run-log.md`

Purpose:
- preserve rationale
- preserve review/audit trail
- avoid hiding important structural changes behind silent rewrites

## Validation targets

Validator should check at least:

### Work
- root `index.md` exists
- new roots use `entityType: work`
- legacy `entityType: project` is readable
- active root task group and active snapshot exist

### Task graph
- required files/folders exist
- ids match paths
- task-group-version ownership is coherent
- sibling task ids are unique within a version
- optional invariant warnings for coverage / orthogonality / closure quality
- only one active version per task group unless explicitly marked otherwise
- active-snapshot terminal task branches have EoW nodes
- partial markers do not satisfy EoW coverage

### Snapshots
- selected task groups exist
- selected versions exist
- selected path is structurally reachable from root

### Run graph
- independent `runs/<run-id>/` folders are valid
- run nodes exist
- run edges reference real run nodes or EoW nodes
- canonical v2 EoW IDs decode strictly and match the raw frontmatter graph kind
  and complete task/run ownership tuple
- referenced source task/task-group-version ids exist if present
- task `runRefs` and run-node `sourceTaskId` agree bidirectionally
- delegated/waiting nodes include enough request/delegatee metadata
- done terminal run paths have EoW nodes
- run partial markers do not create `closes_with` edges
- duplicate EoW IDs are rejected across the complete parsed work, not only
  within one task version or run directory

### Policy-aware closure
- structural closure is reported separately from policy-approved closure
- `approved_result` EoW nodes should carry approved review node/report hashes, reviewed acceptance/result hashes, and a policy-bearing `approvedReviewMode`
- policy approval requires a real independent review node; its reviewed acceptance/result hashes must match the current source task acceptance and the current claim-bearing run-node result
- `manual_verified` / `manual_close` EoW nodes count as manual attestation, not policy-approved review
- `informational` review remains advisory and does not count as policy-approved closure
- summaries should surface mismatches such as active work with structurally complete graphs
- action identity uses own-property cohort witnesses; legacy inference is
  allowed only when `actionKind`, `attempt`, `predecessorRunNodeId`, and the
  attached EoW's `closureRole` are all absent
- malformed modern claims, including historical records, remain auditable but
  cannot supply policy-approved evidence directly or through restart
  carry-forward

### Legacy compatibility
- legacy `entityType: project` and `run/` layouts remain readable
- tasks without `acceptance`, or with `acceptance.mode: informational`, stay advisory/manual-compatible
- stricter acceptance and semantic assertion gates apply to `enforced`, `guarded`, and `runner-managed` paths rather than breaking old informational notes
- qualified-v1 and unqualified-v0 EoWs remain readable and are never renamed
  or rewritten by a new writer

Canonical v2 decoding is strict: accepted components must be primitive,
non-empty, well-formed Unicode; token UTF-8 decoding is fatal; and every
base64url token must re-encode exactly. A malformed v2 frame, graph tag,
component, or non-canonical encoding is rejected. The parser also compares the
decoded graph kind and tuple with raw frontmatter before task-version
normalization, so malformed and wrong-tuple canonical records cannot be
accepted accidentally.

Restart carry-forward always writes the canonical task v2 ID for the actual
destination version and task tuple. Its `preservedFromEowId` remains the
source-exact ID, including a qualified-v1 or unqualified-v0 literal; provenance
is never normalized to the destination codec or independently reconstructed.

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

All should live under `derived/` or a clearly non-canonical generated surface and be labeled non-canonical.

## Reference example

See `../examples/taskops-canonical-minimal-v1/` for the concrete v1-shaped example using:
- `entityType: work`
- versioned task groups
- a selected snapshot
- explicit EoW nodes
- independent `runs/<run-id>/` graph storage
- bidirectional task↔run references
- a clearly non-canonical derived area

## Migration note

This format is a reset from the earlier `graph-task` md-first project/step/phase/node hierarchy.
That older shape is still useful as source material, but TaskOps v1 should align storage around:
- work roots
- versioned task groups
- explicit snapshots
- explicit EoW closure nodes
- independent run graph separation
