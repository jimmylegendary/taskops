# TaskOps Runner Composite Test Set v1

Purpose: exercise realistic mixed TaskOps runner flows, not just orthogonal single-axis behavior.

This set intentionally mixes `runnable`, `needs_decomposition`, `needs_exploration`, `blocked`, `waiting`, pending delegation, `max_steps`, and `deadline_reached` in the same work shapes.

## Scenarios

1. **Full refactor chain** — execute → decompose → explore → execute.
2. **Research-to-build chain** — explore → decompose → execute, stopped before all work is consumed.
3. **Ops incident with blocker** — execute/explore/decompose, then `blocked_only`.
4. **Human waiting gate** — progress until a waiting task, then stop.
5. **Delegated review pending** — pending delegate run node globally pauses execution.
6. **Expired deadline** — otherwise actionable composite work stops before starting.

## Run smoke

```bash
bash dogfood/test-sets/composite-v1/scripts/run-smoke.sh
```

The script runs every fixture on a `/tmp` copy and checks expected stop reason + action sequence.
