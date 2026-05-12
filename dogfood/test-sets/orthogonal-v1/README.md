# TaskOps Runner Orthogonal Test Set v1

Purpose: exercise TaskOps runner behavior across five orthogonal work shapes before broader dogfood/promotion claims.

Each case has two examples and an explicit suggested `--max-steps` + `--until` pair.
The work roots under `works/` are pristine fixtures. Run tests on copies when you want to preserve the fixture state.

## Cases

1. **Runnable execution throughput** — only `runnable` tasks; validates execute/run-node/EoW/event-log behavior.
2. **Decomposition expansion** — only `needs_decomposition`; validates child task group creation and decomposition run closure.
3. **Exploration before decomposition** — only `needs_exploration`; validates exploration artifacts and readiness transition.
4. **Waiting/delegation pause** — waiting task and pending delegate run node; validates that the runner stops and surfaces the reason.
5. **Stop-condition behavior** — mixed readiness with low max step, plus an already-expired deadline.

## Run all smoke tests on temp copies

```bash
bash dogfood/test-sets/orthogonal-v1/scripts/run-smoke.sh
```

The script copies each work into `/tmp`, runs the command from `manifest.json`, and checks expected stop reason and action kinds.

## Manual example

```bash
cd dogfood/test-sets/orthogonal-v1
taskops validate works/09-mixed-max-step-budget
taskops run works/09-mixed-max-step-budget \
  --executor dry-run \
  --max-steps 2 \
  --until 2026-05-12T21:00:00+09:00 \
  --json
```

For manual runs, prefer copying `works/<id>` to `/tmp` first so the fixture remains reusable.
