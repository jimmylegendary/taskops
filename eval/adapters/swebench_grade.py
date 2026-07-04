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

subprocess.run(
    [PY, "-m", "swebench.harness.run_evaluation", "--dataset_name", DS, "--predictions_path", str(pred),
     "--instance_ids", INSTANCE, "--max_workers", "1", "--cache_level", "instance", "--run_id", rid],
    cwd=str(EVAL), capture_output=True, text=True,
)
report = EVAL / f"taskops.{rid}.json"
resolved = report.exists() and json.load(open(report)).get("resolved_instances", 0) == 1
# emit a machine-readable line the scorer can capture, plus a diagnostic for retry feedback
print(json.dumps({"instance": INSTANCE, "resolved": bool(resolved), "diff_lines": patch.count(chr(10))}))
if not resolved:
    print("NOT_RESOLVED: the official SWE-bench test suite (FAIL_TO_PASS + PASS_TO_PASS) did not all pass on your change.", file=sys.stderr)
sys.exit(0 if resolved else 1)
