# TaskOps evaluation harness

Runs TaskOps against external benchmarks per the leveled TEST-PLAN (see personal-assets-vault/taskops-governance/
TEST-PLAN.md). Every level starts with a PRE-FLIGHT (1-3 representative tasks that verify infra/keys end-to-end)
before the full iteration. All process + results are recorded here (machine-readable JSON in results/, per-run
trajectories in runs/) for the paper + public release.

Non-negotiable metric at every level: FALSE-COMPLETION RATE = 0 (TaskOps verified_done must be a subset of the
benchmark's own harness verdict).

## Layout
- adapters/   bench-instance -> TaskOps work (bench's runnable checker as requiredCheck) + scorer
- preflight/  pre-flight logs per level (infra verification with representative TCs)
- runs/       per-task TaskOps run dirs + trajectories
- results/    scored JSON/JSONL (verified_done vs official verdict, false-completion rate)
