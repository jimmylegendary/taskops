# TaskOps Residual Identity Hardening Design

Status: approved in conversation on 2026-07-25  
Base revision: `2440929` (`v0.10.1`)

## Objective

Close the two load-bearing identity defects left after the TaskOps core
stabilization review:

1. an explicitly claim-bearing run closure can remain policy-approved after
   only its `actionKind` is deleted; and
2. distinct run or task tuples can produce the same globally indexed EoW ID.

The result must fail closed for modern records, preserve genuinely legacy
history without rewriting it, and prove the fix through real runner, review,
manual-close, restart, and compatibility paths.

## Context

The current classifier validates `actionKind` when it is present, but requires
a missing value only for explicit supporting closures. A selected
`closureRole: claim-bearing` record can therefore keep coherent review
evidence, lose only `actionKind`, and still report `policyApproved: true`.

The current EoW helpers sanitize both tuple components into a lossy slug and
join them with `-`. This has two independent collision classes:

- normalization collision, such as `a+b` and `a-b`; and
- tuple-boundary collision, such as `(a-b, c)` and `(a, b-c)`.

TaskOps indexes task-graph and run-graph EoWs in one work-wide map keyed by
`eow.id`. Either collision therefore becomes a canonical duplicate-ID error
even when the underlying graph tuples are distinct.

## Scope

### Active scope

- run closure action-identity classification and policy approval
- deterministic, reversible EoW ID generation
- legacy EoW discovery and immutable reuse
- EoW writer, edge-target, parser, restart, and partial-promotion integration
- deterministic regression tests and core format documentation

### Out of scope

- rewriting or renaming existing EoW files
- rewriting historical `closes_with` targets or `preservedFromEowId` values
- changing run-node allocation IDs
- weakening work-wide duplicate EoW rejection
- changing the TaskOps record version or releasing a new package version
- unrelated refactors or benchmark optimization

## Architectural invariants

1. Policy approval requires valid action identity as well as valid review
   evidence.
2. Legacy inference is available only to records with no modern action or
   closure-schema witness.
3. A malformed historical claim remains readable as history but cannot be
   resurrected as approved evidence through restart carry-forward.
4. Every newly written EoW ID is a deterministic, injective representation of
   its graph kind and identity tuple.
5. Existing EoW IDs remain opaque, immutable references.
6. Existing non-colliding legacy records remain readable and reusable.
7. A legacy filename collision cannot suppress writing a distinct canonical
   EoW for another tuple.
8. Every new `closes_with` edge targets the exact EoW ID that was created or
   immutably reused.
9. Global duplicate EoW IDs remain canonical validation errors.

## Component design

### 1. Action-identity cohort resolution

Run closure classification first determines whether a node/EoW pair belongs
to the modern action-identity cohort. The following own-properties are schema
witnesses:

- `node.actionKind`
- `node.attempt`
- `node.predecessorRunNodeId`
- `eow.closureRole`

A record is `legacy-inferred` only when all four properties are absent.
Presence with `null`, an empty string, or another invalid value is modern but
malformed; it is not treated as legacy.

For a modern record, `actionKind` is required and must pass the existing
type/action validation with `requireActionKind: true`. Missing, unknown, or
type-mismatched values make the action identity invalid.

For a genuinely legacy record, TaskOps may infer the action kind from the
legacy type map. Failure to infer from the recorded type is invalid. This
retains pre-action-identity history without granting modern records a
field-deletion bypass.

The resolver returns one normalized result for both supporting and
claim-bearing paths:

```text
{
  mode: "explicit" | "legacy-inferred",
  actionKind,
  valid,
  issues
}
```

Action identity is resolved for every run closure, including closures whose
source version is no longer selected. Selected-record issues continue to enter
the canonical parser error list. Historical malformed records remain
parse-readable, but their classification is not policy-approved. This matters
because restart provenance can recursively consult historical claim evidence.

Role inference remains compatible with legacy EoWs. An explicit
`closureRole` must still agree with the expected role, and supporting closures
retain their selected-lineage artifact, backlink, and review-control checks.
Those supporting checks remain selected-only; the action-identity trust check
does not.

`policyApproved` is true only when all of the following hold:

- the role is claim-bearing;
- action identity is valid;
- live review evidence is valid; and
- no closure classification issue remains.

### 2. Canonical EoW v2 encoding

New EoW IDs accept only primitive, non-empty, well-formed Unicode strings.
Constructors do not coerce numbers, objects, or other values with `String()`.
Each component is encoded as UTF-8 and then unpadded base64url. A literal `.`
frames components because `.` is not in the base64url alphabet.

The canonical formats are:

```text
run:  eow-v2-r.<base64url(runNodeId)>.<base64url(runId)>
task: eow-v2-t.<base64url(taskId)>.<base64url(taskGroupVersionId)>
```

The graph-kind marker makes run and task namespaces disjoint. UTF-8 encoding
of well-formed Unicode, base64url encoding, and dot framing are individually
reversible, so the combined tuple representation is injective. Lossy slug
sanitization is not used for EoW components. The existing slug helper remains
unchanged for run-node allocation, which is outside this defect.

Before a new file is written, TaskOps validates that the complete
`<eow-id>.md` filename is within the 255-byte UTF-8 filename-component budget.
Invalid Unicode, empty components, malformed canonical encodings, and
over-budget filenames fail before any EoW or edge write.

The public constructor signatures remain stable:

```text
runEowId({ runId, runNodeId })
taskEowId({ taskGroupVersionId, taskId })
```

The identity module additionally provides:

```text
runEowIdCandidates({ runId, runNodeId })
taskEowIdCandidates({ taskGroupVersionId, taskId })
decodeCanonicalEowId(id)
```

The decoder returns `null` for non-v2 legacy IDs. A v2-looking ID must decode
strictly: decoding uses fatal UTF-8 handling, components must be non-empty,
and re-encoding must reproduce the original ID exactly so permissive base64
decoder behavior cannot create aliases.

### 3. Legacy-read, canonical-write compatibility

Candidate helpers return the following ordered, de-duplicated IDs:

1. canonical v2 ID;
2. the current qualified but lossy ID; and
3. the original unqualified `eow-<attached-id>` ID.

Every fresh EoW uses v2. Existing files are never renamed or rewritten merely
to adopt the new format.

A candidate suppresses a new write only when its frontmatter owns the exact
requested tuple:

- run EoW: `graphType: run`, `attachedToType: runNode`, exact `runId`, and
  exact `attachedToId`; or
- task EoW: `graphType: task`, `attachedToType: task`, exact
  `taskGroupVersionId`, and exact `attachedToId`.

An existing canonical v2 candidate with a decoding or tuple mismatch is
corruption and fails closed. A nonmatching current-qualified candidate may be
the valid historical owner of a colliding old filename. It is treated as such
only when its stored relational tuple is valid and regenerates that same
legacy-qualified ID; then it is preserved but does not suppress a new v2 write
for the requested tuple. Any other mismatch, including an ownership mismatch
at an original unqualified candidate, fails closed. Existing relational
validation continues to surface malformed legacy records.

When an existing candidate is reused, its stored `id` becomes the edge target.
Historical edges and provenance pointers keep their stored values. The task
state writer, which currently treats an existing path as a silent no-op, must
parse and verify immutable ownership before accepting reuse.

Immutable candidate reuse applies consistently to:

- automatic run-node and task closure writers;
- promoted-partial source run closure; and
- any review closure routed through the automatic run-node writer.

The exploration non-closing guard uses the same candidate ownership rules for
discovery rather than treating path existence alone as proof that its source
task is closed.

Restart, version carry-forward, and partial-promotion materialization create a
new version directory rather than reusing an EoW in place. They generate v2
IDs for the new task EoWs while retaining the source EoW ID verbatim in
`preservedFromEowId`.

Manual task and run-node close commands retain their current mutation
semantics. If the parsed graph already contains a logical closure for the
requested tuple, they return the existing “already closed” error rather than
silently reusing it. For a genuinely open tuple they write v2 directly; an
unrelated colliding legacy-qualified filename cannot block that canonical
path.

### 4. Canonical parser validation

Legacy IDs retain their current relational validation and remain opaque.

For IDs beginning with `eow-v2-`, the parser additionally requires:

- strict canonical decoding;
- encoded graph kind equal to `graphType`;
- encoded attachment equal to `attachedToId`;
- encoded run or version component equal to the corresponding frontmatter
  field; and
- the existing ID-to-filename equality.

A malformed or tuple-inconsistent v2 ID is a canonical validation error.
Work-wide duplicate EoW detection remains unchanged and strict.

### 5. Writer and edge behavior

Idempotent state writers resolve an immutable existing candidate before
creating anything. They either:

1. reuse an exactly matching canonical or legacy EoW and use its stored ID;
2. write one canonical v2 EoW and point the new edge to it; or
3. fail before mutation on canonical corruption, immutable field mismatch, or
   invalid new identity.

Edge IDs do not need a new format because run-edge identity is scoped by
`runId`, while the edge target carries the globally unique EoW identity.

Manual close checks the parsed graph for a logical existing closure before
constructing a new v2 ID. That semantic guard remains authoritative; manual
close is not converted into an idempotent reuse operation.

## Error handling

- Modern missing `actionKind`: classification issue, no policy approval.
- Modern unknown or mismatched `actionKind`: existing specific validation
  issue, no policy approval.
- Genuine legacy type that cannot be inferred: classification issue.
- Malformed v2 ID: canonical parser error.
- Existing v2 path owned by another tuple: corruption error.
- Existing lossy legacy path owned by another tuple: preserve it and continue
  with the requested v2 write.
- Existing candidate with matching tuple ownership but conflicting immutable
  closure fields: fail rather than rewrite.
- Invalid or over-budget new filename: fail before EoW and edge mutation.

## Verification design

### Action-identity regressions

The policy-approval fixture includes:

1. a valid explicit claim that remains approved;
2. the same claim with only `actionKind` deleted while `closureRole` and
   `attempt` remain, which must retain coherent review evidence but lose policy
   approval with a missing-action issue;
3. existing unknown and type-mismatched action controls;
4. an unselected historical modern claim with invalid identity, which remains
   readable but cannot be policy-approved for carry-forward; and
5. a genuine legacy control with all action/closure witnesses removed, which
   retains intentional type inference.

Each fixture mutation must assert that it changed the source text so a
non-matching replacement cannot produce a false green test.

### EoW identity regressions

Pure helper tests cover both normalization and tuple-boundary collision pairs
for run and task IDs, strict round-trip decoding, malformed canonical input,
Unicode input, and filename-budget rejection.

Integration tests exercise actual production paths:

1. automatic run closure across colliding run tuples;
2. automatic task closure for colliding task tuples;
3. independent review closures in colliding run tuples;
4. manual task closure beside a colliding historical task EoW;
5. manual run-node closure and its exact edge target;
6. real restart carry-forward beside a colliding historical EoW;
7. promoted-partial source closure; and
8. reuse of both current-qualified and original-unqualified legacy records.

Every applicable case asserts distinct semantic attachments, exact edge or
provenance targets, absence of duplicate-ID errors, and no unintended second
closure.

Generated-ID assertions import the canonical helper. Hand-authored legacy
fixtures remain literal compatibility records rather than being mechanically
rewritten.

### Verification gates

Targeted gates cover policy approval, EoW global identity, state-writer run
graphs, partial promotion, closure summaries, and workflow lifecycle. The
cycle finishes with a fresh root `npm run verify` and a byte-for-byte protected
path comparison against the pre-cycle baseline.

## Documentation

`docs/MD_FIRST_FORMAT.md` records the canonical v2 algorithm, the fact that
`actionKind` is optional only for genuine legacy records, and the
legacy-read/canonical-write policy. `docs/CORE_MODEL.md` records the work-wide
injective EoW identity invariant.

Historical dated plans and fixtures that intentionally demonstrate old formats
are not silently rewritten.

## Acceptance criteria

The design is complete when:

1. deleting only `actionKind` from an explicit claim makes policy approval
   false without invalidating its otherwise coherent review evidence;
2. only records with no modern action/closure witness use legacy inference;
3. malformed historical claims cannot become approved restart provenance;
4. all newly written run and task EoW IDs use the injective v2 encoding;
5. real run, task, review, manual, and restart collision pairs coexist without
   duplicate EoW IDs;
6. compatible existing EoWs are reused by idempotent writers without rename
   or rewrite, while manual close retains its “already closed” guard;
7. every new closure edge points to the exact created or reused EoW;
8. malformed canonical IDs and immutable mismatches fail closed;
9. the full repository verification gate passes; and
10. protected user-owned paths remain byte-identical.
