#!/usr/bin/env python3
"""ALE 사후 채점 전용 진입점.

╔══════════════════════════════════════════════════════════════════════════════╗
║  이 모듈을 어댑터 런타임 경로에서 import 하거나 spawn 하지 마라.              ║
║                                                                              ║
║  이 스크립트는 **에이전트 프로세스가 완전히 종료한 뒤에만** 호출된다.         ║
║  점수는 taskops 실행 루프에 어떤 형태로도 피드백되지 않는다 —                 ║
║  requiredChecks · 재시도 판단 · 프롬프트 어디에도 들어가지 않는다.            ║
║                                                                              ║
║  근거(소유자 명시 절대 규칙): "벤치의 점수 측정이나 벤치 환경을 피드백으로     ║
║  쓰는 것은, 시험지를 내고 채점 결과·해설을 본 뒤 답안을 고쳐 재제출하는       ║
║  꼴이다." SWE-bench 실험에서 requiredCheck 에 공식 채점 하니스를 걸었던       ║
║  것(run_swebench_pro.mjs:94, oracle:true)이 정확히 이 오염이었다.            ║
║                                                                              ║
║  run_ale.mjs / run_ale_bare.mjs 는 이 파일을 import 하지도 spawn 하지도       ║
║  않는다. 그렇게 되어 있는지 코드 리뷰 시 반드시 확인하라.                     ║
╚══════════════════════════════════════════════════════════════════════════════╝

순서 강제 (CONTAMINATION.md §4):
  ale_container.sh scrub 이 sudo 를 제거했지만 채점기 자신이 sudo 를 전제한다
  (verify_safe_recover.py 의 _sudo / _sudo_bash 헬퍼). 따라서 채점은 sudo 를 user 에게
  되돌려주는 대신 **docker exec -u 0 (root)** 로 실행한다. 이렇게 하면 에이전트 구간의
  무권한 상태를 되돌리지 않고도 채점이 가능하다.
  이 스크립트가 실행되는 시점에는 에이전트가 이미 종료해 있어야 한다.

--reference-dir 에 대하여 (CONTAMINATION.md §7-1):
  verify_safe_recover.py 는 이 인자를 line 20 에서 정의하고 line 273 에서 변수에 대입할 뿐
  465줄 전체에서 한 번도 읽지 않는다. required=True 라 값은 넘겨야 하지만 내용은 무관하므로
  **더미 빈 디렉터리**를 준다. 따라서 gated:manual 인 archive(reference 포함) 를 받을 필요가
  없고, 이 스크립트는 그것을 요청하지 않는다.

채점 대상에 대하여 (CONTAMINATION.md §7-2 — 중요):
  채점기는 workspace 를 처음부터 다시 만들고(line 285) remote_output_dir/safe_recover.py
  **하나만** 복사해 넣는다(line 279, 286). 즉 채점 대상은 오직 safe_recover.py 이며,
  에이전트가 손으로 쓴 산출물 3종은 폐기되고 safe_recover.py 를 두 번 실행해 재생성한 것으로
  평가된다. 그래서 이 스크립트는 /workspace/safe_recover.py 를 remote_output_dir 로 복사한다.
  또한 채점이 workspace 를 파괴하므로 **산출물 회수는 채점보다 먼저** 끝나 있어야 한다.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TASK_DIR = (
    REPO
    / "eval/ale/upstream/tasks/computing_math"
    / "ranking_node_feature_parity_recovery_instance_1"
)
VERIFY = TASK_DIR / "scripts" / "verify_safe_recover.py"


def log(msg: str) -> None:
    print(f"[ale_grade] {msg}", file=sys.stderr)


def die(msg: str) -> None:
    print(f"[ale_grade] 오류: {msg}", file=sys.stderr)
    raise SystemExit(2)


def assert_ours(container: str) -> None:
    """타 세션 컨테이너(hive-app-1 / n8n-* / sweb.eval.*) 보호."""
    if not container.startswith("taskops-ale-"):
        die(f"'{container}' 는 우리 컨테이너가 아니다(접두사 taskops-ale- 필요).")


def agent_still_running(container: str) -> bool:
    """에이전트(codex) 프로세스가 아직 살아 있으면 채점하면 안 된다."""
    proc = subprocess.run(
        ["docker", "exec", "-u", "0", container, "bash", "-lc", "pgrep -f '/usr/local/bin/codex' || true"],
        capture_output=True, text=True,
    )
    return bool(proc.stdout.strip())


def main() -> int:
    ap = argparse.ArgumentParser(description="ALE 사후 채점 (에이전트 종료 후 1회).")
    ap.add_argument("--container", required=True)
    ap.add_argument("--out", required=True, help="채점 결과 JSON 저장 경로")
    ap.add_argument(
        "--force",
        action="store_true",
        help="에이전트가 아직 살아 있어도 강행(권장하지 않음 — 오염 순서가 깨진다)",
    )
    args = ap.parse_args()

    assert_ours(args.container)
    if not VERIFY.is_file():
        die(f"채점기가 없다: {VERIFY}")

    # 순서 강제: 에이전트가 완전히 종료한 뒤에만 채점한다.
    if agent_still_running(args.container) and not args.force:
        die(
            "에이전트(codex) 프로세스가 아직 실행 중이다. 채점은 에이전트 완전 종료 후 사후 1회만 "
            "허용된다. 순서가 어긋나면 오염이 재발한다."
        )

    stage = "/tmp/ale_grade"
    # 채점 자산을 컨테이너에 주입한다. 이 시점에는 에이전트가 이미 종료했으므로
    # 채점기 소스가 컨테이너에 들어가도 에이전트가 읽을 수 없다.
    subprocess.run(
        ["docker", "exec", "-u", "0", args.container, "bash", "-lc",
         f"rm -rf {stage} && mkdir -p {stage}/reference {stage}/remote_output"],
        check=True,
    )
    subprocess.run(
        ["docker", "cp", str(VERIFY), f"{args.container}:{stage}/verify_safe_recover.py"],
        check=True,
    )

    # 채점 대상 = 에이전트가 만든 safe_recover.py 하나 (§7-2).
    probe = subprocess.run(
        ["docker", "exec", "-u", "0", args.container, "bash", "-lc",
         f"cp /workspace/safe_recover.py {stage}/remote_output/safe_recover.py && echo COPIED"],
        capture_output=True, text=True,
    )
    if "COPIED" not in probe.stdout:
        out = {"score": 0.0, "error": "에이전트가 /workspace/safe_recover.py 를 만들지 않았다."}
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(out, indent=2, ensure_ascii=False))
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0

    # 시드 자산(input/software)을 다시 준비한다 — 채점기가 workspace 를 재구성하는 데 필요하다.
    seed_probe = subprocess.run(
        ["docker", "exec", "-u", "0", args.container, "bash", "-lc",
         "ls -d /tmp/ale_seed/input /tmp/ale_seed/software 2>/dev/null || true"],
        capture_output=True, text=True,
    )
    if "/tmp/ale_seed/input" not in seed_probe.stdout:
        die(
            "채점에 필요한 시드 자산(/tmp/ale_seed)이 없다. ale_seed.py 는 에이전트 오염을 막기 위해 "
            "시드 후 이를 제거하므로, 채점 직전에 --reseed 로 다시 주입해야 한다. "
            "ale_seed.py --container <name> 을 재실행한 뒤 다시 시도하라."
        )

    instruction = subprocess.run(
        ["docker", "exec", "-u", "0", args.container, "bash", "-lc",
         "find /tmp/ale_seed/input -name instruction.md | head -1"],
        capture_output=True, text=True,
    ).stdout.strip()
    input_ws = subprocess.run(
        ["docker", "exec", "-u", "0", args.container, "bash", "-lc",
         "ls -d /tmp/ale_seed/input/workspace 2>/dev/null || ls /tmp/ale_seed/input/*.tar.gz 2>/dev/null | head -1"],
        capture_output=True, text=True,
    ).stdout.strip().splitlines()
    if not instruction or not input_ws:
        die("채점용 시드 경로를 찾지 못했다.")

    log("채점기 실행 (root exec, 1회)")
    proc = subprocess.run(
        [
            "docker", "exec", "-u", "0", "-w", stage,
            "-e", "HOME=/root", "-e", "USER=root",
            args.container,
            "python3", f"{stage}/verify_safe_recover.py",
            "--input-workspace", input_ws[0],
            "--instruction-file", instruction,
            "--runtime-env-dir", "/tmp/ale_seed/software",
            # 더미 빈 디렉터리. 채점기가 이 인자를 읽지 않는다 (§7-1).
            "--reference-dir", f"{stage}/reference",
            "--remote-output-dir", f"{stage}/remote_output",
        ],
        capture_output=True, text=True,
    )

    raw = proc.stdout
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {
            "score": None,
            "grade_error": "채점기 stdout 이 JSON 이 아니다",
            "stdout_tail": raw[-2000:],
            "stderr_tail": proc.stderr[-2000:],
            "returncode": proc.returncode,
        }

    # 채점기 출력을 **그대로** 보존한다. 재해석·요약하지 않는다.
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    score = payload.get("score")
    log(f"score = {score}")
    log(
        "이 점수는 성공 판정에 쓰이지 않는다. 스모크의 성패는 "
        "ale_events_report.mjs 의 주 기준(decomposition≥1 AND exploration≥1)으로만 정한다."
    )
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
