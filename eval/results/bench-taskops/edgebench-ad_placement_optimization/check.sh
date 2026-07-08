#!/bin/bash
set -a; . ~/API_KEYS; set +a
cd /home/jimmy/repos/EdgeBench
pgrep -f 'sforge serve' >/dev/null || { sforge serve >/tmp/sforge-serve-tk.log 2>&1 & sleep 12; }
RID="tk-ad_placement_optimization-$$"
SFORGE_AGENT_API_KEY="$OPENROUTER_API_KEY" SFORGE_AGENT_API_BASE_URL="https://openrouter.ai/api/v1" \
  timeout 1000 sforge run --task ad_placement_optimization --agent codex --model "deepseek/deepseek-v4-flash" \
  --backend docker --judge-url http://host.docker.internal:8080 \
  --enable-internet --timeout 600 --max-submissions 2 --run-id "$RID" >/dev/null 2>&1
F=/home/jimmy/repos/EdgeBench/logs/runs/$RID/ad_placement_optimization/final_result.json
[ ! -f "$F" ] && { echo '{"resolved":false,"reason":"no final_result"}'; exit 1; }
python3 -c "
import json,sys
d=json.load(open('$F')); pr=d.get('best_pass_rate',0)
print(json.dumps({'bench':'edgebench','task':'ad_placement_optimization','pass_rate':pr,'resolved':pr is not None and float(pr)>=1.0}))
sys.exit(0 if pr is not None and float(pr)>=1.0 else 1)
"