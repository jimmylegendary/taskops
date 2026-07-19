#!/usr/bin/env python
"""Dump one SWE-bench *Pro* instance's metadata as JSON. usage: dump_instance_pro.py <instance_id> [dataset]

Pro's schema is NOT compatible with dump_instance.py (classic princeton-nlp), so this is a separate dump:
  - fail_to_pass / pass_to_pass are LOWERCASE (classic is FAIL_TO_PASS / PASS_TO_PASS) and Python-repr-encoded:
    ast.literal_eval decodes 731/731 rows, json.loads only 9/731 (entries embed apostrophes, e.g.
    "... should return multiple keys and null if key doesn't exist"), so we MUST use ast, never json.loads.
  - repos are multi-language (repo_language js/go/py/...), graded inside a prebuilt image, so we also carry the
    dockerhub_tag + before_repo_set_cmd + selected_test_files_to_run the Pro grader needs, and the requirements +
    interface the objective needs (Pro issues are underspecified without them).
run_swebench_pro.mjs consumes repo/base_commit/problem_statement/requirements/interface/repo_language; the counts
and test-file fields are diagnostics.
"""
import ast, json, sys
from datasets import load_dataset

inst = sys.argv[1]
ds = sys.argv[2] if len(sys.argv) > 2 else "ScaleAI/SWE-bench_Pro"
ex = [r for r in load_dataset(ds, split="test") if r["instance_id"] == inst][0]


def parse_list(v):
    # Pro list fields are a repr string (single-quoted). ast.literal_eval is the only reliable decoder; an
    # already-decoded list (some dataset revisions) passes straight through.
    return ast.literal_eval(v) if isinstance(v, str) else v


def unwrap(s):
    # problem_statement / requirements / interface arrive wrapped in one CSV-export pair of double-quotes; strip a
    # single matched pair so the prompt (and the YAML frontmatter it is flattened into) begins with prose, not a
    # dangling quote that could confuse the frontmatter round-trip.
    if isinstance(s, str) and len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1]
    return s


f2p = parse_list(ex["fail_to_pass"])
p2p = parse_list(ex["pass_to_pass"])
print(json.dumps({
    "instance_id": ex["instance_id"], "repo": ex["repo"], "base_commit": ex["base_commit"],
    "repo_language": ex["repo_language"], "dockerhub_tag": ex["dockerhub_tag"],
    "problem_statement": unwrap(ex["problem_statement"]),
    "requirements": unwrap(ex["requirements"]),
    "interface": unwrap(ex["interface"]),
    "before_repo_set_cmd": ex["before_repo_set_cmd"],
    "selected_test_files_to_run": ex["selected_test_files_to_run"],
    "fail_to_pass_count": len(f2p), "pass_to_pass_count": len(p2p),
}))
