# TaskOps Core Stabilization Design

Status: approved in conversation on 2026-07-25  
Base revision: `666a403` (`v0.10.1`)

## Objective

Make TaskOps a reliable long-horizon verified execution controller by repairing the state-transition and closure defects found in the v0.10.1 six-scenario evaluation. The result must preserve TaskOps's conservative honesty guarantees while restoring liveness for valid, fully verified work.

This cycle focuses on TaskOps core development, improvement, and verification. It does not add new orchestration features merely because Superpowers exposes them.

## Context

The v0.10.1 evaluation confirmed that seven earlier regression fixes work, especially the rule that exploration must not falsely complete its source objective. It also exposed four integration-level failures:

1. Restarted task-group versions keep stale internal `blockedBy.taskGroupVersionId` references.
2. Decomposition and exploration runs can make otherwise verified work permanently unable to obtain policy-approved closure.
3. The prototype path does not normalize the documented executor alias, does not require its promised options artifact, and can route away from the required human wait.
4. Large JSON output can be truncated when stdout is a pipe because the CLI exits before the stream drains.

The existing repository checkout also contains user-owned evaluation outputs. Implementation must use an isolated worktree and must not alter those outputs.

## Scope

### Active product scope

- `cli/` state transitions, run graph, audit, and machine interface
- core TaskOps documentation
- `skill/` as the internal, user-facing TaskOps behavioral contract
- deterministic regressions, end-to-end fixtures, and continuous verification

### Repository boundary

- Root workspace execution and version checks cover the active CLI/core surface.
- The CLI remains usable through the local npm toolchain, but public publication is fail-closed through package metadata and inactive automation.
- The Obsidian implementation remains preserved but is excluded from root workspace execution, version synchronization, verification, artifact assembly, and automated release paths.
- The TaskOps skill source remains maintained as part of the behavioral contract; external skill publication is not part of this cycle.
- Automated external publication and tag-driven multi-artifact assembly are not active.
- No version bump or release tag is part of this stabilization cycle.
- A concise repository policy document records the inactive surfaces and the explicit steps required to reactivate them.

### Out of scope

- New Obsidian functionality
- External package or skill publication
- Productizing Superpowers concepts such as TDD chronology or worktree identity inside TaskOps
- Performance claims based only on benchmark anecdotes
- Refactoring unrelated large files

## Architectural invariants

The implementation must preserve these invariants:

1. Task graph and run graph remain independent.
2. Exploration, decomposition, and prototype work cannot complete the source objective by themselves.
3. A runner cannot manufacture policy approval for its own claim.
4. Structurally invalid supporting work cannot be ignored during completion.
5. Supporting work that is structurally valid cannot make verified objective completion permanently unreachable.
6. A selected graph cannot silently depend on a superseded internal version.
7. `claimSafe=true` remains strictly harder to obtain than structural closure.
8. Machine-readable output must be complete and parseable in direct, redirected, piped, and subprocess-captured execution.

## Component design

### 1. Restart dependency rebasing

Restart creates an explicit mapping from the superseded task-group version to the new selected version. While copying tasks, a dedicated rebasing function rewrites only internal `blockedBy.taskGroupVersionId` references that point to the source version.

References to other task groups or versions remain unchanged. After materialization, validation scans the selected graph for stale in-scope references. Any such reference is a hard validation error and stops scheduling; TaskOps must never respond by executing early or waiting forever.

The rebasing logic must be a focused unit with fixture-driven tests rather than an incidental mutation embedded across restart code paths.

### 2. Run identity and closure roles

Every action attempt receives its own run-node identity. Identity is derived from at least the source task, action kind, and attempt instance; a later action cannot reuse an earlier action's node or EoW.

Run closures have two roles:

- **Supporting/provenance closure:** exploration, decomposition, prototype, and review-control runs that produce knowledge, graph changes, decision options, or independent evidence without carrying the objective claim themselves.
- **Claim-bearing closure:** result-bearing execution runs whose EoW claims that an objective result satisfies its acceptance contract.

Every persisted run closure must be schema-valid. Supporting closures in the selected/current lineage must also pass the checks appropriate to their action, including backlinks, selected-snapshot consistency, and required action artifacts. They do not enter the policy-approval denominator and cannot carry `approved_result` merely because the runner completed them. Failed and superseded attempts remain historical provenance without becoming completion claims.

Claim-bearing closures remain subject to independent result, acceptance, review, and assurance evidence. The review node produces that evidence; the reviewed result-bearing EoW enters the policy-approval denominator.

A work is eligible for `all_closed` only when:

- every selected terminal task has a valid EoW;
- every supporting closure is structurally valid;
- every claim-bearing closure is policy-approved;
- there are no open blockers, partials, waiting delegations, or validation errors.

The audit layer then applies all remaining assurance gates before returning `claimSafe=true`. Missing claim approval continues to surface as `graph_closed_unapproved`.

### 3. Prototype state machine

All runner paths use one executor-normalization function. The user-facing `openclaw-agent` alias resolves to the registered `openclaw-cli` adapter before invocation.

A prototype action succeeds only if the runtime succeeds and `options.md` exists as a regular UTF-8 file with non-whitespace content in the expected workspace. Semantic ranking or minimum option-count validation is outside this cycle. A missing, unreadable, or empty artifact is recorded as an explicit failed run with the normal failure evidence; no success EoW is created.

After successful option generation, the source task transitions to `waiting` with `resolverKind: human`. Inherited-known consistency checks cannot downgrade this state or route it back to exploration while the human resolution is outstanding. Once the selected option is recorded, normal readiness classification resumes.

### 4. JSON stdout lifecycle

CLI entry points use an asynchronous main lifecycle. They do not call `process.exit()` immediately after writing output. Success and failure set `process.exitCode`, allowing stdout and stderr to drain naturally.

The implementation should centralize this lifecycle where practical so that fixing `show --json` does not leave the same truncation defect in other JSON commands.

## State flows

### Restart

1. Create the new task-group version.
2. Build the source-to-target version map.
3. Copy tasks and rebase internal dependency references.
4. Select the new version.
5. Validate that no selected in-scope dependency references a superseded version.
6. Schedule only after validation succeeds.

### Dynamic decomposition through completion

1. Exploration or decomposition creates a distinct supporting run node.
2. The action's artifacts and graph mutations are validated.
3. The supporting run closes as provenance without claiming objective approval.
4. Atomic tasks execute in distinct claim-bearing run nodes.
5. Acceptance and independent review evidence attach to task and run closure.
6. Navigation reports `all_closed` only when structural and approval requirements align.
7. Audit returns `claimSafe=true` only after all other honesty gates pass.

### Prototype

1. Readiness selects prototype.
2. Executor identity is normalized.
3. The adapter writes options into the isolated action workspace.
4. TaskOps validates `options.md`.
5. The prototype run closes as supporting provenance.
6. The task waits for a human resolver.
7. A recorded selection re-enters ordinary readiness classification.

## Error handling

- Stale internal dependency reference: validation error and scheduling stop.
- Supporting run with invalid schema, backlink, snapshot, or required artifact: structural completion remains false.
- Claim-bearing run without approved evidence: `graph_closed_unapproved`.
- Prototype runtime or artifact failure: explicit failed run, no success EoW, no human-wait transition.
- Human selection still pending: explicit waiting state, not exploration or completion.
- JSON command failure: complete diagnostic on stderr and non-zero `process.exitCode`; no premature stream termination.

No fix may broaden an approval whitelist merely to make a positive scenario pass. If an unverified result can reach `claimSafe=true`, implementation stops until the architecture is corrected.

## Verification design

### Targeted RED-to-GREEN regressions

Each defect begins with a focused test that fails on `666a403` and is observed failing before production code changes:

1. Restart rebases internal dependencies.
2. Restart preserves external dependencies.
3. A stale selected-graph dependency is rejected.
4. Separate actions and attempts receive separate run nodes and EoWs.
5. Verified dynamic decomposition can reach `all_closed` and `claimSafe=true`.
6. An unapproved claim remains `graph_closed_unapproved`.
7. Invalid supporting provenance blocks structural completion.
8. The executor alias works in the prototype path.
9. Missing or invalid `options.md` fails the prototype.
10. A successful prototype waits for human resolution despite inherited-known context.
11. JSON larger than 64 KiB survives redirect, pipe, and subprocess capture byte-for-byte and parses successfully.

### Integration verification

- Keep all seven v0.10.1 targeted regressions green.
- Add the existing workflow E2E suite to the default test chain.
- Add deterministic fixtures reproducing the evaluation's restart, dynamic decomposition, prototype, and large-output failures.
- Run the full repository verification command from a clean worktree.
- Add push and pull-request CI for the same core verification path.
- Verify behavioral-contract consistency across code, core docs, and `skill/`.
- Confirm that user-owned evaluation outputs in the original checkout remain untouched.

### Completion evidence

Completion requires fresh evidence for both positive and negative paths:

- A verified multi-step dynamic work reaches `all_closed`.
- Its full audit returns `claimSafe=true`.
- The same fixture with missing approval remains `graph_closed_unapproved`.
- No selected graph contains stale internal version references after restart.
- Downstream tasks become runnable at the correct time after restart.
- Prototype output waits for a human and cannot succeed without its promised artifact.
- Large JSON is complete across all supported output transports.
- Targeted tests, full tests, contract checks, and CI configuration validation all pass.

## Superpowers development workflow

Superpowers controls the development session; TaskOps is the system under test. TaskOps does not recursively orchestrate its own repair.

1. Create an isolated Git worktree and establish a clean baseline.
2. Convert this design into small, explicit implementation tasks.
3. For each task, observe RED, implement the minimum fix, and observe GREEN.
4. Give each task a focused commit.
5. Use a fresh implementer context per task where practical.
6. Review each task for two independent verdicts: spec compliance and code quality.
7. Re-review every correction in scope.
8. Run one whole-branch review after all tasks.
9. Run fresh full verification before any completion claim.

Unexpected failures follow a reproduce, evidence, root-cause, single-hypothesis, minimal-experiment sequence. Repeated speculative patches are not acceptable.

## Implementation order

1. Establish repository scope and core verification baseline.
2. Fix restart dependency rebasing.
3. Separate run identity and closure roles.
4. Repair prototype execution and human-wait routing.
5. Repair JSON output lifecycle.
6. Add integration fixtures, default workflow E2E coverage, and CI.
7. Reconcile code, docs, and skill contracts.
8. Run whole-branch review and fresh full verification.

## Required follow-up: difficult legacy-model benchmark campaign

After core stabilization, a separate design and execution plan must test whether TaskOps can materially improve difficult software-engineering benchmark performance with a fixed older model, including GPT-5.4 if it is available in the installed runtime, and with SWE-bench Verified and SWE-bench Pro where dataset access permits.

That campaign is a separate experimental system because it requires preregistered model, dataset, compute, retry, oracle-access, and scoring controls. It must distinguish:

- equal-budget TaskOps uplift over a bare-model baseline;
- maximum-score search under a declared larger compute envelope;
- resolved rate, pass@1, cost, wall time, retries, and failure classes;
- genuine controller improvements from model variance, grader leakage, or cherry-picked subsets.

The existing TaskOps benchmark harness and historical evaluation artifacts should be reused where valid. Model availability and endpoint identity must be verified before preregistration. A negative result is valid evidence; the campaign must not tune on hidden test outcomes or report only favorable subsets.

This follow-up is required, but it does not block the correctness design above from remaining a focused, independently verifiable implementation unit.
