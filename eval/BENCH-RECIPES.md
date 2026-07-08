# Delegation-mode multi-benchmark run recipes (SWE Verified · DeepSWE · ALE · EdgeBench)

Setup + validated smokes for running each benchmark through TaskOps with verify-grounding (a completion is certified
only when the bench's own out-of-workspace verifier passes). Executor models via OpenRouter (`OPENROUTER_API_KEY` in
`~/API_KEYS`) or local subscriptions (gpt-5.5/claude = per-token \$0). Docker available; HF tokens in `~/API_KEYS`.

## Status (2026-07-09)
| bench | harness | status | verifier (= TaskOps requiredCheck) |
|---|---|---|---|
| **SWE-bench Verified** | TaskOps-native (Style A) | ✅ validated | official Docker harness (`swebench_grade.py`), gold-patch positive-controlled |
| **ALE** (Agents' Last Exam) | ale_run + in-repo openclaw/claude_code | ✅ **validated E2E** | task `evaluate()` → run.json `{score,status}`; verify-grounding gate confirmed (score 1.0 → certified) |
| **EdgeBench** (ByteDance Seed) | SForge (2-container work/judge) | ✅ **validated E2E** | hidden judge container → `best_pass_rate=1.0`; verify-grounding gate confirmed (pass_rate 1.0 → certified) |
| **DeepSWE** (datacurve) | Pier + mini-swe-agent | ✅ **validated E2E** (oracle) | `tests/test.sh` → `reward.txt/json` (`reward==1.0`); oracle gold-patch smoke = reward 1.0 |

### ⚠️ USER ACTION — DeepSWE HF gate
`datacurve/deep-swe` is a gated HF dataset; the token (foryou1000) can list but not download (403). Click **"Agree
and access"** at https://huggingface.co/datasets/datacurve/deep-swe (auto-gate = instant), then the oracle smoke runs.

## OpenRouter wiring (no global config edit)
- **TaskOps codex executor**: `TASKOPS_CODEX_MODEL=<or-model>` → codex adapter injects `-c model_providers.openrouter={base_url=https://openrouter.ai/api/v1,env_key=OPENROUTER_API_KEY} -c model_provider=openrouter -m <model>` (committed). Validated: deepseek-v4-flash happy-path verified_done=true; nemotron:free honest-stall.
- **Bench harnesses**: each speaks OpenAI/Anthropic-compatible base_url → point at OpenRouter via the harness's own env (below).

## Per-bench recipes

### ALE (Agents' Last Exam) — WORKING
Repo `~/repos/agents-last-exam` (`uv sync` done, 153GB `agentslastexam/ale-ubuntu22-docker` image pulled).
- Fix applied: `configs/environments/docker.yaml` `gcs_sa_key: ""` (was a nonexistent `secret/gcp_key.json`).
- Smoke (validated): `cd ~/repos/agents-last-exam && grep '^OPENROUTER_API_KEY=' ~/API_KEYS > secret/.env && uv run python -m ale_run run smoke_readfile.yaml` → `demo/readfile_secret completed score=1.00` via `claude_code` model `anthropic/claude-fable-5` provider `openrouter`.
- Model wiring: `configs/agents/cc_fable5_or.yaml` (claude_code preset, `provider: openrouter`, `ANTHROPIC_BASE_URL→openrouter`, `ANTHROPIC_AUTH_TOKEN=OPENROUTER_API_KEY`). Also ships an OpenClaw harness (what TaskOps uses).
- Verifier / verify-grounding: `evaluate()` in `tasks/<domain>/<task>/main.py` (staged out-of-workspace AFTER the agent stops) → run.json `{score,status}`. TaskOps requiredCheck = `taskops_verify.sh <exp.yaml> <domain/task> <thr>` (exit 0 iff status==completed ∧ score≥thr). Confirmed: score 1.0 → verified_done True @thr1.0, False @thr1.01.
- Caveat: default `configs/agents/claude_code.yaml` is unloadable (env-substituter matches `${env:...}` inside a comment) — use `cc_fable5_or.yaml`. Task tiers: near-term / full-spectrum / last-exam.

### EdgeBench (ByteDance Seed) — VALIDATED E2E
Smoke (validated): ad_placement_optimization (a C++ heuristic-optimization task), agent codex + `deepseek/deepseek-v4-flash` via OpenRouter, 900s bounded → 3 auto-submissions → **hidden judge container graded best_pass_rate=1.0, best_score=40244803354** (timed_out=true as expected). verify-grounding gate: pass_rate 1.0 → verified_done True @thr1.0, False @thr1.01.
Two setup fixes required (no root needed):
- **`--enable-internet`** — the default network-isolation path needs passwordless `sudo iptables` (not available); `--enable-internet` skips it (`run_agent.py` guards the iptables check with `if not internet:`). Judge stays a separate container.
- **Start `sforge serve` FIRST and confirm port 8080 is LISTENing before `sforge run`** — launching serve and run together in one backgrounded script raced and produced empty logs / 0-round runs; serve-then-run works.

### EdgeBench (ByteDance Seed) — original notes
Repo `~/repos/EdgeBench`; `sforge` at `~/.local/bin/sforge`; HF `ByteDance-Seed/EdgeBench` (51 public tasks) pulled.
- Setup: `sforge fetch-tasks edgebench` → `sforge pull --task <t> --registry seededge` (multi-GB base+work+judge images, 10-40 min first run) → `sforge serve` (judge server :8080).
- Run one (bounded): `SFORGE_AGENT_API_KEY=$OPENROUTER_API_KEY SFORGE_AGENT_API_BASE_URL=https://openrouter.ai/api/v1 sforge run --task ad_placement_optimization --agent codex --model <or-model> --backend docker --timeout 900 --max-submissions 2 --run-id edge-smoke-001`.
- Verifier / verify-grounding: `sforge eval --task <t> --archive submission.tar.gz --json` → hidden judge container → `{score_0_100, pass_rate, valid, timed_out}`. TaskOps requiredCheck = wrapper that tars the workspace, runs `sforge eval --json`, exits 0 iff `score_0_100≥THR` (or `pass_rate==1.0`).
- Reality: tasks are 12-72h (human avg 57h); only a BOUNDED (~30-60 min) smoke is feasible; agent won't saturate. Cost dominated by this bench.

### DeepSWE (datacurve/deep-swe) — VALIDATED E2E (oracle)
Gate accepted 2026-07-09. Downloaded tasks/abs-module-cache-flags; `pier run -i abs-module-cache-flags --env docker --agent oracle` → Docker image built, gold solution.patch applied, tests/test.sh ran → `verifier/reward.txt=1` (Mean 1.000). verify-grounding gate: reward 1.0 → verified_done True @thr1.0. Model arm ready: swap `--agent mini-swe-agent --model openrouter/<vendor>/<model> --ae OPENROUTER_API_KEY=$OPENROUTER_API_KEY`.

### DeepSWE (datacurve/deep-swe) — original notes
Pier at `~/.local/bin/pier` (working). Package/registry datasets disabled → must snapshot `tasks/` locally after the gate.
- After gate: `huggingface-cli download datacurve/deep-swe --repo-type dataset --include 'tasks/*' --local-dir <dir>`.
- Oracle smoke (free, no LLM): `pier run --path <dir>/tasks -i <task> --env docker --agent oracle --jobs-dir <jd> --job-name oracle-smoke -n 1 -k 1` → `reward.json reward==1.0`.
- Model run: `--agent mini-swe-agent --model openrouter/<vendor>/<model> --ae OPENROUTER_API_KEY=$OPENROUTER_API_KEY` (key forwarded INTO the sandbox via `--ae`).
- Verifier / verify-grounding: `tests/test.sh` → `reward.json` (`reward==1.0`); TaskOps requiredCheck = wrapper asserting the reward.

## Executor strategy (from the SWE finding)
Open models via codex's harness underperform on real repo-scale agentic tasks (deepseek made 0 edits in 20min on a
Verified task) — but that SERVES the honesty arm (weak executor → still 0 false completions). For capability curves,
use gpt-5.5 (subscription \$0) or the bench-native harness (mini-swe-agent/ale/sforge) which drive open models better.


## Through-TaskOps results (real integration, not a hand gate)
`run_bench_taskops.mjs <bench> <task> [agent/model]` builds a real TaskOps work whose acceptance.requiredChecks = the
bench's own out-of-workspace verifier; TaskOps' verify-resolver EXECUTES it and emits verified_done iff it passes.
| bench | task | executor | verifier run by TaskOps | verified_done | s |
|---|---|---|---|---|---|
| DeepSWE | abs-module-cache-flags | pier oracle | tests/test.sh -> reward 1.0 | **true** | 111 |
| ALE | demo/readfile_secret | claude-fable-5 (OpenRouter) | ale evaluate() -> score 1.0 | **true** | 63 |
| EdgeBench | ad_placement_optimization | deepseek-v4-flash (OpenRouter) | sforge hidden judge -> pass_rate 1.0 | **true** | 670 |
| SWE Verified | (via run_swebench.mjs) | codex/model | swebench Docker judge | (runTaskOps-native) | - |
Note: ALE's first through-TaskOps run correctly BLOCKED (verified_done=false) because the verifier wrapper
(taskops_verify.sh) used a single-underscore slug while ALE writes dirs with '__'; TaskOps honestly did not certify a
run whose checker failed. Fixed the slug (sed 's#/#__#g') -> verified_done=true. The gate held even under the bug.
