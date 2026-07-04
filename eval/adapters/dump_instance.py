#!/usr/bin/env python
"""Dump one SWE-bench instance's metadata as JSON. usage: dump_instance.py <instance_id> [dataset]"""
import json, sys
from datasets import load_dataset
inst = sys.argv[1]
ds = sys.argv[2] if len(sys.argv) > 2 else "princeton-nlp/SWE-bench_Lite"
ex = [r for r in load_dataset(ds, split="test") if r["instance_id"] == inst][0]
print(json.dumps({
    "instance_id": ex["instance_id"], "repo": ex["repo"], "base_commit": ex["base_commit"],
    "problem_statement": ex["problem_statement"],
    "fail_to_pass": ex["FAIL_TO_PASS"], "pass_to_pass_count":
        len(json.loads(ex["PASS_TO_PASS"]) if isinstance(ex["PASS_TO_PASS"], str) else ex["PASS_TO_PASS"]),
}))
