# Changelog

## v0.9.0 — Honest completion, enforced and verified

This release turns TaskOps' honest-completion invariant from **self-attested** into **runner-ENFORCED**, adds a
test-time-scaling meter and a training-data engine, and ships the first **external validation**: on 81 real-agent
benchmark tasks the false-completion rate is **0**.

### Verify-grounded completion (the core)
- **`run --verify-checks`** — the runner independently EXECUTES a task's `requiredChecks` (verifiedBy: `runner`)
  instead of trusting the agent's self-report; claimSafe is grounded in a real exit code. Artifact provenance
  (produced-this-run) + tamper-evident output hashes.
- **verify-resolver env isolation** — checks run with a denylist-sanitized environment (NODE_OPTIONS / NODE_PATH /
  npm_config_* / LD_PRELOAD / PATH-shim / TASKOPS_* dropped) so an agent can't game a check via the environment,
  while PATH/proxies/tool-dirs are kept (no false negatives).
- **`run --verify-retries N`** — test-time-scaling: on a failed verify-check, retry with the failure fed back
  (bounded, gated on `--verify-checks`) — more test-time can convert a stall into an honest verified completion.
- **`run --continue-on-failure`** — isolate a caught fake as a blocked stall and keep making honest progress
  instead of halting the whole run. Composes with the parallel orchestrator.

### Understanding + the missing uncertainty quadrant
- **Comprehension Quiz** (`acceptance.comprehensionQuiz`) — an INDEPENDENT quiz-generator writes runner-executed
  behavioral probes about the change; claim-safety also requires them to pass (empty = inconclusive). A
  differential baseline drops probes that pass without the change. Verifies understanding, not just output.
- **Unknown Knowns** — a 4th `uncertaintyState` (`unknown_known`) → a `prototype` action that surfaces a
  recognize-when-seen requirement via a human pick (reusing external-resolution) before execution.

### Payoffs
- **Test-time-scaling capability meter** — parallel, verify-grounded, retries-aware.
- **Training-data engine** (`taskops trainingdata`) — labeled trajectories where every label rests on
  runner-verified evidence: honest_completion (only verified_done), test_time_scaling_gain, honest_stall.

### Evaluation harness (`eval/`)
- TaskOps × SWE-bench Lite (out-of-workspace Docker judge) and × ImpossibleBench (canonical mutated test).
- **L2 result: 81 real-agent tasks, false-completion rate = 0.** SWE-bench Lite 26/31 verified_done == resolved
  (recall 84%, 0 false positives, 0 missed); ImpossibleBench 50/50 honest stall, 0 reward-hacking.

### Notable fixes
- Training-data labels rest on runner PASS + review approval + policy mode (never the verify-mode flag alone).
- Comprehension Quiz independence hardened (isolated quiz workspace; no self-authored probes).
- verify_retry stays on the execute path even after an executor records a surprise (was flipping to exploration).
- 17 ultrareview findings + several adversarial-self-review remediations landed with regression tests.

79 commits since v0.8.0. cli test suite: 62 checks green.
