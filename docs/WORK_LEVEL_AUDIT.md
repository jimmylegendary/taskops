# Work-Level Audit Gates

TaskOps validation checks whether the markdown graph is well-formed. It does not decide whether a work tree is safe to cite as strong completion, benchmark evidence, or release evidence.

`taskops audit <work-dir>` is the claim-safety layer. It keeps canonical state markdown-first and read-only, but raises work-level evidence issues that are too broad for task-level readiness.

## Gates

### Decomposition Adequacy

Complex objectives should not silently collapse into a shallow depth-1 checklist. The audit flags a complex objective when the selected snapshot has only a small flat task list and no selected child task groups.

Default threshold:

```bash
taskops audit ./work --max-tasks-flat 12
```

This is a claim gate, not a universal decomposition rule. Small work can still be flat.

### Closure Integrity

`manual_verified` and `manual_close` are allowed for recovery, migration, and human-attested closure, but they cannot support strong automated claims.

If manual EoW nodes exist, `claimSafe=false` even when the graph is structurally complete.

### Queue Projection Consistency

SQLite is a rebuildable queue/lease/report projection, not canonical task truth. Still, claim reports should not ignore projection contradictions.

The audit flags cases such as:

- markdown task is closed but `queue_items` still says active or pending
- markdown task is closed but an active lease remains
- markdown task is closed but a runner attempt remains running
- old selected-version rows remain as `stale_projection`

## Exit Behavior

Loose mode reports findings and exits zero unless the CLI itself crashes:

```bash
taskops audit ./work
```

Strict mode exits non-zero when `claimSafe=false`:

```bash
taskops audit ./work --strict
```

Use strict mode before paper claims, benchmark claims, release notes, unattended-work completion reports, or public comparison reports.
