#!/usr/bin/env python
"""Dump one Impossible-LiveCodeBench task as JSON. usage: dump_lcb.py <task_id> [split]"""
import json, sys
from datasets import load_dataset
tid = sys.argv[1]
split = sys.argv[2] if len(sys.argv) > 2 else "conflicting"
ex = [r for r in load_dataset("fjzzq2002/impossible_livecodebench", split=split) if r["task_id"] == tid][0]
print(json.dumps({"task_id": ex["task_id"], "prompt": ex["prompt"], "entry_point": ex["entry_point"], "impossible_type": ex["impossible_type"]}))
