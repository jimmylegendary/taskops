#!/usr/bin/env python
"""TaskOps requiredCheck for a SWE-bench instance = the OFFICIAL, un-gameable Docker harness.

usage: swebench_grade.py <instance_id> <checkout_dir> [dataset]
Computes the agent's diff in <checkout_dir> (its edits to the repo), runs the SWE-bench harness (which applies the
CANONICAL test_patch in a fresh Docker container — the agent cannot tamper with the tests the judge runs), and
exits 0 iff the instance is RESOLVED. This is the out-of-workspace hidden-judge verify-grounding the plan calls for.
"""
import json, sys, subprocess, os
from pathlib import Path

INSTANCE = sys.argv[1]
CO = sys.argv[2]
DS = sys.argv[3] if len(sys.argv) > 3 else "princeton-nlp/SWE-bench_Lite"
EVAL = Path(__file__).resolve().parent.parent
PY = str(EVAL / ".venv" / "bin" / "python")

# the agent's change = tracked diff against the checked-out base commit
patch = subprocess.run(["git", "diff", "HEAD"], cwd=CO, capture_output=True, text=True).stdout
rid = f"grade-{INSTANCE}-{os.getpid()}"
pred = EVAL / "preflight" / f"pred-{rid}.json"
json.dump([{"instance_id": INSTANCE, "model_name_or_path": "taskops", "model_patch": patch}], open(pred, "w"))

CACHE = os.environ.get("SWEBENCH_CACHE_LEVEL", "instance")  # a 500-instance run sets 'env' so per-instance images
subprocess.run(                                              # (~1GB each) are not retained — disk would not survive.
    [PY, "-m", "swebench.harness.run_evaluation", "--dataset_name", DS, "--predictions_path", str(pred),
     "--instance_ids", INSTANCE, "--max_workers", "1", "--cache_level", CACHE, "--run_id", rid],
    cwd=str(EVAL), capture_output=True, text=True,
)
report = EVAL / f"taskops.{rid}.json"
if not report.exists():
    # A MISSING report is an INFRA outcome, never a verdict: the harness died before grading (image-removal
    # races, dataset/network hiccups). Emitting resolved:false here forged 35/45 false_completions on the
    # verified500 run (verify PASSed 3x, then the final grade's harness crashed pre-log and was scored as a
    # real FAIL). Same contract as swebench_pro_grade.py: exit 2 + NO "resolved" token → caller records
    # null + grade_error and the close stays out of the F1 denominator.
    print(f"GRADE_INFRA_ERROR: harness produced no report ({report.name}) — not a verdict.", file=sys.stderr)
    sys.exit(2)
resolved = json.load(open(report)).get("resolved_instances", 0) == 1
# emit a machine-readable line the scorer can capture, plus a diagnostic for retry feedback
print(json.dumps({"instance": INSTANCE, "resolved": bool(resolved), "diff_lines": patch.count(chr(10))}))
if not resolved:
    print("NOT_RESOLVED: the official SWE-bench test suite (FAIL_TO_PASS + PASS_TO_PASS) did not all pass on your change.", file=sys.stderr)
sys.exit(0 if resolved else 1)
