# Delegation-mode multi-benchmark run recipes (SWE Verified · DeepSWE · ALE · EdgeBench)

Setup + validated smokes for running each benchmark through TaskOps with verify-grounding (a completion is certified
only when the bench's own out-of-workspace verifier passes). Executor models via OpenRouter (`OPENROUTER_API_KEY` in
`~/API_KEYS`) or local subscriptions (gpt-5.5/claude = per-token \$0). Docker available; HF tokens in `~/API_KEYS`.

## Status (2026-07-09)
| bench | harness | status | verifier (= TaskOps requiredCheck) |
|---|---|---|---|
| **SWE-bench Verified** | TaskOps-native (Style A) | ✅ validated | official Docker harness (`swebench_grade.py`), gold-patch positive-controlled |
| **ALE** (Agents' Last Exam) | ale_run + in-repo openclaw/claude_code | ✅ **validated E2E** | task `evaluate()` → run.json `{score,status}`; verify-grounding gate confirmed (score 1.0 → certified) |
| **EdgeBench** (ByteDance Seed) | SForge (2-container work/judge) | 🔶 harness installed, 51-task dataset pulled, images pulling | `sforge eval --json` → hidden judge container → EvalReport `{score_0_100,pass_rate}` |
| **DeepSWE** (datacurve) | Pier + mini-swe-agent | ⛔ HF gate | task `tests/test.sh` → `reward.json` (`reward==1.0`) |

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

### EdgeBench (ByteDance Seed) — harness ready, images pulling
Repo `~/repos/EdgeBench`; `sforge` at `~/.local/bin/sforge`; HF `ByteDance-Seed/EdgeBench` (51 public tasks) pulled.
- Setup: `sforge fetch-tasks edgebench` → `sforge pull --task <t> --registry seededge` (multi-GB base+work+judge images, 10-40 min first run) → `sforge serve` (judge server :8080).
- Run one (bounded): `SFORGE_AGENT_API_KEY=$OPENROUTER_API_KEY SFORGE_AGENT_API_BASE_URL=https://openrouter.ai/api/v1 sforge run --task ad_placement_optimization --agent codex --model <or-model> --backend docker --timeout 900 --max-submissions 2 --run-id edge-smoke-001`.
- Verifier / verify-grounding: `sforge eval --task <t> --archive submission.tar.gz --json` → hidden judge container → `{score_0_100, pass_rate, valid, timed_out}`. TaskOps requiredCheck = wrapper that tars the workspace, runs `sforge eval --json`, exits 0 iff `score_0_100≥THR` (or `pass_rate==1.0`).
- Reality: tasks are 12-72h (human avg 57h); only a BOUNDED (~30-60 min) smoke is feasible; agent won't saturate. Cost dominated by this bench.

### DeepSWE (datacurve/deep-swe) — blocked on HF gate
Pier at `~/.local/bin/pier` (working). Package/registry datasets disabled → must snapshot `tasks/` locally after the gate.
- After gate: `huggingface-cli download datacurve/deep-swe --repo-type dataset --include 'tasks/*' --local-dir <dir>`.
- Oracle smoke (free, no LLM): `pier run --path <dir>/tasks -i <task> --env docker --agent oracle --jobs-dir <jd> --job-name oracle-smoke -n 1 -k 1` → `reward.json reward==1.0`.
- Model run: `--agent mini-swe-agent --model openrouter/<vendor>/<model> --ae OPENROUTER_API_KEY=$OPENROUTER_API_KEY` (key forwarded INTO the sandbox via `--ae`).
- Verifier / verify-grounding: `tests/test.sh` → `reward.json` (`reward==1.0`); TaskOps requiredCheck = wrapper asserting the reward.

## Executor strategy (from the SWE finding)
Open models via codex's harness underperform on real repo-scale agentic tasks (deepseek made 0 edits in 20min on a
Verified task) — but that SERVES the honesty arm (weak executor → still 0 false completions). For capability curves,
use gpt-5.5 (subscription \$0) or the bench-native harness (mini-swe-agent/ale/sforge) which drive open models better.
