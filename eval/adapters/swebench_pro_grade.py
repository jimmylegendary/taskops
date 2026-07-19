#!/usr/bin/env python
"""TaskOps requiredCheck for a SWE-bench *Pro* instance = the OFFICIAL Scale AI Pro harness (out-of-workspace judge).

usage: swebench_pro_grade.py <instance_id> <checkout_dir> [dataset]

swebench_grade.py (classic) is UNUSABLE for Pro: Pro is multi-language and grades INSIDE a prebuilt per-instance
DockerHub image (jefzda/sweap-images:<dockerhub_tag>), not via the princeton-nlp pytest harness, and its
fail_to_pass/pass_to_pass are lowercase + Python-repr-encoded. This grader wraps the exact leaderboard code path,
scaleapi/SWE-bench_Pro-os `swe_bench_pro_eval.eval_with_docker`, so a taskops verdict == a leaderboard verdict:
  1. agent patch = `git diff HEAD` in <checkout_dir> (its edits vs the checked-out base commit),
  2. the harness, inside the image: `git reset --hard base` -> `git apply` the patch -> run `before_repo_set_cmd`
     whose LAST line `git checkout <fix> -- <test files>` overlays the CANONICAL tests (so the agent cannot tamper
     with the judged tests) -> run run_scripts/<iid>/{run_script.sh,parser.py} -> emit output.json,
  3. resolved iff (fail_to_pass | pass_to_pass) is a subset of {tests reported PASSED}  (identical to harness main()).

Contract mirrors swebench_grade.py so run_swebench_pro.mjs can reuse the classic parsing:
  - a REAL verdict prints {"instance","resolved","diff_lines"} on stdout and exits 0 iff resolved (1 if not),
  - an INFRA failure (harness missing / image pull / entryscript crash / no output.json) prints NO "resolved" token
    (only a GRADE_INFRA_ERROR diagnostic on stderr) and exits 2, so the caller records null + grade_error and never
    mislabels transient infra as an honest UNRESOLVED.
The heavy `docker pull jefzda/sweap-images:<tag>` is the ORCHESTRATOR's job; this grader just drives it serially.
Set TASKOPS_PRO_GRADE_DRYRUN=1 for a no-Docker readiness probe (validates every input the container step consumes).
"""
import ast, json, os, subprocess, sys
from pathlib import Path

INSTANCE = sys.argv[1]
CO = os.path.abspath(sys.argv[2])
DS = sys.argv[3] if len(sys.argv) > 3 else "ScaleAI/SWE-bench_Pro"

EVAL = Path(__file__).resolve().parent.parent
HARNESS = EVAL / "swebench_pro_os"
DOCKERHUB_USER = os.environ.get("TASKOPS_PRO_DOCKERHUB_USER", "jefzda")
# network inside the grading container is ON by default (many Pro repos install deps at test time); TASKOPS_PRO_BLOCK_NETWORK=1 isolates it.
BLOCK_NET = os.environ.get("TASKOPS_PRO_BLOCK_NETWORK") == "1"
DRYRUN = os.environ.get("TASKOPS_PRO_GRADE_DRYRUN") == "1"


def fail(msg, code=2):
    # infra path: NO "resolved" token on stdout -> run_swebench_pro.mjs classifies as grade_error (null verdict).
    print(f"GRADE_INFRA_ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


if not HARNESS.exists():
    fail(f"Pro harness not vendored; run: git clone https://github.com/scaleapi/SWE-bench_Pro-os {HARNESS}")

# The harness resolves dockerfiles/ & run_scripts/ by RELATIVE path and does `from helper_code.image_uri import ...`,
# so we must both put HARNESS on sys.path and run from it. (git diff below uses cwd=CO, so chdir is safe.)
sys.path.insert(0, str(HARNESS))
os.chdir(HARNESS)
try:
    import swe_bench_pro_eval as H
except Exception as e:  # missing dep / broken vendor -> infra, not a verdict
    fail(f"cannot import swe_bench_pro_eval: {e!r}")

# agent change = tracked diff vs the checked-out base commit (same definition as swebench_grade.py).
patch = ""
if (Path(CO) / ".git").exists():
    patch = subprocess.run(["git", "diff", "HEAD"], cwd=CO, capture_output=True, text=True).stdout
elif not DRYRUN:
    fail(f"{CO} is not a git checkout (no .git) — cannot compute the agent patch")

from datasets import load_dataset
rows = [r for r in load_dataset(DS, split="test") if r["instance_id"] == INSTANCE]
if not rows:
    fail(f"instance {INSTANCE} not found in {DS}")
row = rows[0]

# The harness sample is dict-like; create_entryscript() does .strip()/eval() on the raw strings, so pass them
# through verbatim. f2p/p2p are decoded with ast.literal_eval (Pro repr encoding; json.loads fails on apostrophes).
sample = {
    "instance_id": row["instance_id"], "repo": row["repo"], "base_commit": row["base_commit"],
    "before_repo_set_cmd": row["before_repo_set_cmd"],
    "selected_test_files_to_run": row["selected_test_files_to_run"],
    "fail_to_pass": row["fail_to_pass"], "pass_to_pass": row["pass_to_pass"],
}
f2p = set(ast.literal_eval(row["fail_to_pass"]))
p2p = set(ast.literal_eval(row["pass_to_pass"]))

if DRYRUN:
    # Static readiness probe: exercise every input the Docker step consumes WITHOUT pulling the image or running a
    # container. Confirms harness import, dataset row, patch computation, image-URI derivation, and the presence of
    # the per-instance run scripts + dockerfiles. exit 0 = wired; exit 3 = a required local file is missing.
    from helper_code.image_uri import get_dockerhub_image_uri
    uri = get_dockerhub_image_uri(row["instance_id"], DOCKERHUB_USER, row["repo"])
    need = {
        "run_script.sh": HARNESS / "run_scripts" / INSTANCE / "run_script.sh",
        "parser.py": HARNESS / "run_scripts" / INSTANCE / "parser.py",
        "base_dockerfile": HARNESS / "dockerfiles" / "base_dockerfile" / INSTANCE / "Dockerfile",
        "instance_dockerfile": HARNESS / "dockerfiles" / "instance_dockerfile" / INSTANCE / "Dockerfile",
    }
    missing = [k for k, p in need.items() if not p.exists()]
    print(json.dumps({
        "dryrun": True, "instance": INSTANCE, "image": uri,
        "image_matches_tag": uri.split(":", 1)[1] == row["dockerhub_tag"],
        "f2p": len(f2p), "p2p": len(p2p), "diff_lines": patch.count(chr(10)),
        "scripts_present": not missing, "missing": missing,
    }))
    sys.exit(0 if not missing else 3)

rid = f"pro-grade-{INSTANCE}-{os.getpid()}"
out_dir = EVAL / "preflight" / rid
out_dir.mkdir(parents=True, exist_ok=True)
prefix = "taskops"

# Drive the OFFICIAL code path: eval_with_docker pulls jefzda/sweap-images:<tag>, runs the entryscript in the image,
# and returns the parsed output dict (or None on any infra failure). redo=True so a stale output.json never masks it.
try:
    output = H.eval_with_docker(
        patch, sample, str(out_dir), DOCKERHUB_USER, str(HARNESS / "run_scripts"),
        prefix=prefix, redo=True, block_network=BLOCK_NET, docker_platform=None,
    )
except Exception as e:
    fail(f"eval_with_docker raised: {e!r}")

if not output or "tests" not in output:
    # no output.json (image pull failed / entryscript crashed / parser produced nothing) = INFRA, not a verdict.
    fail(f"harness produced no test output for {INSTANCE} (see {out_dir}/{prefix}_stderr.log)")

passed = {t["name"] for t in output["tests"] if t.get("status") == "PASSED"}
resolved = (f2p | p2p) <= passed
print(json.dumps({"instance": INSTANCE, "resolved": bool(resolved), "diff_lines": patch.count(chr(10))}))
if not resolved:
    missing = sorted((f2p | p2p) - passed)[:8]
    print(f"NOT_RESOLVED: {len(missing)}+ required test(s) not PASSED, e.g. {missing}", file=sys.stderr)
sys.exit(0 if resolved else 1)
