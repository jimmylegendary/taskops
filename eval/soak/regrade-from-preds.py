#!/usr/bin/env python3
"""Forged-FAIL recovery: re-grade false_completion rows from their PRESERVED final pred files (no agent re-run,
$0). The verified500 incident: the final grade's harness died pre-report (env-level image-removal race) and the
old grade script scored the missing report as resolved:false — forging false_completion on rows whose verify had
truly PASSed. Each pred file (preflight/pred-grade-<inst>-<pid>.json) still holds the exact model_patch that was
graded, so the official verdict is recoverable offline: run the harness on that pred (instance-level), then patch
the result JSON in place (official_resolved / false_completion / missed_honest) + an audit trail field.

usage: .venv/bin/python soak/regrade-from-preds.py [--dataset princeton-nlp/SWE-bench_Verified] [--dir results/verified]
"""
import json, glob, os, subprocess, sys, time

EVAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(EVAL, '.venv', 'bin', 'python')
DATASET = 'princeton-nlp/SWE-bench_Verified'
RESULT_DIR = 'results/verified'
args = sys.argv[1:]
if '--dataset' in args: DATASET = args[args.index('--dataset') + 1]
if '--dir' in args: RESULT_DIR = args[args.index('--dir') + 1]

os.chdir(EVAL)
targets = []
for f in sorted(glob.glob(os.path.join(RESULT_DIR, 'swebench-verified-*.json'))):
    r = json.load(open(f))
    if r.get('false_completion') and not r.get('regraded'):
        targets.append((f, r))
print(f'[regrade] {len(targets)} forged-FAIL candidates')

fixed = infra = real_fail = 0
for i, (f, r) in enumerate(targets):
    iid = r['instance_id']
    preds = sorted(glob.glob(f'preflight/pred-grade-{iid}-*.json'), key=os.path.getmtime)
    if not preds:
        print(f'  [{i+1}] {iid}: pred 없음 — 건너뜀 (재실행 필요)'); continue
    pred = preds[-1]  # the FINAL grade's pred = the exact patch that was mis-scored
    rid = f'regrade-{iid}-{os.getpid()}'
    report = os.path.join(EVAL, f'taskops.{rid}.json')
    t0 = time.time()
    subprocess.run([PY, '-m', 'swebench.harness.run_evaluation', '--dataset_name', DATASET,
                    '--predictions_path', pred, '--instance_ids', iid, '--max_workers', '1',
                    '--cache_level', 'instance', '--run_id', rid],
                   cwd=EVAL, capture_output=True, text=True, timeout=1800)
    el = int(time.time() - t0)
    if not os.path.exists(report):
        infra += 1
        print(f'  [{i+1}/{len(targets)}] {iid}: report 부재 (infra 재발, {el}s) — 미정정')
        continue
    resolved = json.load(open(report)).get('resolved_instances', 0) == 1
    r['official_resolved'] = bool(resolved)
    r['false_completion'] = bool(r.get('verified_done')) and not resolved
    r['missed_honest'] = (not r.get('verified_done')) and resolved
    r['regraded'] = {'at': time.strftime('%Y-%m-%dT%H:%M:%S'), 'from_pred': os.path.basename(pred),
                     'reason': 'forged-FAIL recovery (missing-report infra scored as verdict)'}
    json.dump(r, open(f, 'w'), indent=2)
    if resolved: fixed += 1
    else: real_fail += 1
    print(f'  [{i+1}/{len(targets)}] {iid}: resolved={resolved} ({el}s)')
    # tidy the instance image as we go (same non-racing point as the driver's postJobCleanup)
    subprocess.run(['docker', 'rmi', '-f', f'sweb.eval.x86_64.{iid.replace("__", "_1776_")}:latest'],
                   capture_output=True)

print(f'[regrade] 완료: 정정→resolved {fixed} / 진짜 FAIL {real_fail} / infra 재발 {infra}')
