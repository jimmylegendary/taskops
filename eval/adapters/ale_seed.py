#!/usr/bin/env python3
"""ALE 과제 시드 — 공개 데이터셋의 input/software 만 받아 컨테이너 /workspace 를 새로 만든다.

CONTAMINATION.md §8 (HF 게이트 준수):
  공개 데이터셋 agents-last-exam/agents-last-exam-data (gated: False) 의 input/ + software/ 만 받는다.
  gated:manual 인 archive(reference 포함) 는 Jimmy 결정 전까지 요청하지 않으며,
  **reference 를 받는 코드 경로 자체를 이 파일에 만들지 않는다.**
  근거: verify_safe_recover.py 의 --reference-dir 는 line 20 정의 / line 273 대입 후
  465줄 전체에서 한 번도 읽히지 않는다 → reference 없이 채점이 완결된다.

순서 주의 (CONTAMINATION.md §4):
  이 스크립트는 prepare_workspace.py 를 호출하고, 그 스크립트는 /workspace·/protected 조작에
  sudo 를 요구한다(_sudo / _sudo_bash 헬퍼). 따라서 **반드시 ale_container.sh scrub 이전에**
  실행해야 한다. scrub 이후에는 sudo 가 없어 시드가 불가능하다.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TASK_DIR = (
    REPO
    / "eval/ale/upstream/tasks/computing_math"
    / "ranking_node_feature_parity_recovery_instance_1"
)
PREPARE = TASK_DIR / "scripts" / "prepare_workspace.py"

HF_REPO = "agents-last-exam/agents-last-exam-data"
# 실측(list_repo_files)으로 확인한 실제 경로. 설계 시점에는 'computing_math/...' 로 적혀 있었으나
# 데이터셋의 실제 레이아웃은 'tasks/<domain>/<instance>/base/{input,software}/...' 다.
# 이 접두사가 틀리면 allow_patterns 가 아무것도 매칭하지 못해 시드가 조용히 빈 트리를 만든다.
HF_TASK_PREFIX = "tasks/computing_math/ranking_node_feature_parity_recovery_instance_1/base"
# 받을 하위 트리는 이 둘 뿐이다. reference 는 목록에 없고, 추가해서도 안 된다.
HF_ALLOWED_SUBDIRS = ("input", "software")

MIN_FREE_GB = 20


def log(msg: str) -> None:
    print(f"[ale_seed] {msg}", file=sys.stderr)


def die(msg: str) -> "None":
    print(f"[ale_seed] 오류: {msg}", file=sys.stderr)
    raise SystemExit(1)


def check_disk() -> None:
    """다운로드 전 디스크 여유 확인. 부족하면 중단."""
    usage = shutil.disk_usage("/")
    free_gb = usage.free / (1024**3)
    log(f"디스크 여유 {free_gb:.1f}GB (최소 {MIN_FREE_GB}GB 필요)")
    if free_gb < MIN_FREE_GB:
        die(
            f"디스크 여유 부족: {free_gb:.1f}GB < {MIN_FREE_GB}GB. "
            "ALE 이미지(153GB)는 이미 보유하고 있으므로 추가 pull 은 불필요하지만, "
            "데이터셋 전개 공간이 없다."
        )


def docker(*args: str, user: str = "0", check: bool = True) -> subprocess.CompletedProcess:
    cmd = ["docker", "exec", "-u", user, *args]
    return subprocess.run(cmd, check=check, capture_output=True, text=True)


def assert_ours(container: str) -> None:
    """타 세션 컨테이너(hive-app-1 / n8n-* / sweb.eval.*) 보호."""
    if not container.startswith("taskops-ale-"):
        die(f"'{container}' 는 우리 컨테이너가 아니다(접두사 taskops-ale- 필요).")


def fetch_dataset(dest: Path) -> Path:
    """공개 데이터셋에서 input/ 과 software/ 만 내려받는다."""
    dest.mkdir(parents=True, exist_ok=True)
    marker = dest / ".fetched"
    if marker.exists():
        log(f"이미 받아둔 데이터셋 사용: {dest}")
        return dest

    try:
        from huggingface_hub import snapshot_download  # type: ignore
    except ImportError:
        die(
            "huggingface_hub 가 없다. eval/.venv 에서 실행하거나 "
            "`pip install huggingface_hub` 후 재시도하라."
        )

    # allow_patterns 로 input/software 외에는 아예 받지 않는다.
    patterns = [f"{HF_TASK_PREFIX}/{sub}/**" for sub in HF_ALLOWED_SUBDIRS]
    log(f"데이터셋 다운로드: {HF_REPO} :: {patterns}")
    snapshot_download(  # noqa: F821 - 위에서 import 됨
        repo_id=HF_REPO,
        repo_type="dataset",
        local_dir=str(dest),
        allow_patterns=patterns,
    )
    marker.write_text("ok\n")
    return dest


def main() -> int:
    ap = argparse.ArgumentParser(description="ALE 과제를 컨테이너에 시드한다.")
    ap.add_argument("--container", required=True, help="taskops-ale- 접두사를 가진 컨테이너 이름")
    ap.add_argument(
        "--data-dir",
        default=str(REPO / "eval/ale/raw/hfdata"),
        help="데이터셋 로컬 캐시 경로",
    )
    args = ap.parse_args()

    assert_ours(args.container)
    check_disk()

    if not PREPARE.is_file():
        die(f"prepare_workspace.py 가 없다: {PREPARE}")

    data_root = fetch_dataset(Path(args.data_dir))
    task_data = data_root / HF_TASK_PREFIX
    input_dir = task_data / "input"
    software_dir = task_data / "software"
    for p in (input_dir, software_dir):
        if not p.is_dir():
            die(f"데이터셋 하위 트리가 없다: {p}")

    # 이미지에 baked 된 빌드 잔재 /workspace 를 먼저 비운다. 잔재로 채점하면 무효다.
    log("컨테이너의 baked /workspace 잔재 제거")
    docker(args.container, "bash", "-lc", "rm -rf /workspace/* /workspace/.[!.]* 2>/dev/null || true")

    # 시드 자산 + prepare_workspace.py 를 컨테이너로 주입한다.
    stage = "/tmp/ale_seed"
    docker(args.container, "bash", "-lc", f"rm -rf {stage} && mkdir -p {stage}")
    log("시드 자산 주입 (docker cp)")
    for src, name in ((input_dir, "input"), (software_dir, "software")):
        subprocess.run(
            ["docker", "cp", f"{src}/.", f"{args.container}:{stage}/{name}"],
            check=True,
        )
    subprocess.run(
        ["docker", "cp", str(PREPARE), f"{args.container}:{stage}/prepare_workspace.py"],
        check=True,
    )

    # instruction.md 는 input 쪽에 있다. 위치를 컨테이너 안에서 찾아 인자로 넘긴다.
    probe = docker(
        args.container,
        "bash",
        "-lc",
        f"find {stage}/input -name instruction.md | head -1",
    )
    instruction = probe.stdout.strip()
    if not instruction:
        die(f"{stage}/input 안에서 instruction.md 를 찾지 못했다.")
    log(f"instruction.md = {instruction}")

    # input workspace 는 **아카이브여야 한다**. 공개 데이터셋의 input/ 에는 workspace_seed.tar.gz 와
    # 그것을 푼 workspace/ 디렉터리가 **둘 다** 들어 있는데, 상류 prepare_workspace.py 의
    # _extract_archive(:65)는 무조건 `tar -xzf` 를 호출하므로 디렉터리를 넘기면
    # "tar: Cannot read: Is a directory" 로 시드가 실패한다(실측).
    # 따라서 tar.gz 를 먼저 찾고, 없을 때만 디렉터리로 폴백한다.
    probe = docker(
        args.container,
        "bash",
        "-lc",
        # 주의: `ls ... | head -1 || ...` 는 파이프라인 종료코드가 head 것이라 항상 0 →
        # 폴백이 절대 발화하지 않는다. 변수로 받아 비어 있는지로 분기한다.
        f'a="$(ls {stage}/input/*.tar.gz 2>/dev/null | head -1)"; '
        f'if [ -n "$a" ]; then echo "$a"; else ls -d {stage}/input/workspace 2>/dev/null; fi',
    )
    input_workspace = probe.stdout.strip().splitlines()[0] if probe.stdout.strip() else ""
    if not input_workspace:
        die(f"{stage}/input 안에서 workspace 소스를 찾지 못했다.")
    log(f"input workspace = {input_workspace}")

    # prepare_workspace.py 는 sudo 를 쓴다 → 이 시점에는 sudo 가 살아 있어야 한다(scrub 이전).
    log("prepare_workspace.py 실행 (/workspace 재구성 + /protected/sentinel.txt 재생성)")
    proc = subprocess.run(
        [
            "docker", "exec", "-u", "1000", "-w", stage,
            "-e", "HOME=/home/user", "-e", "USER=user",
            args.container,
            "python3", f"{stage}/prepare_workspace.py",
            "--input-workspace", input_workspace,
            "--instruction-file", instruction,
            # runtime env = `uv sync --project` 대상이므로 pyproject.toml + uv.lock 이 있는
            # 디렉터리여야 한다. 그건 input/runtime_env 다. software/ 에는 requirements.txt 와
            # 오프라인 휠(python_pkgs)만 있어 `uv sync` 가 "No pyproject.toml found" 로 죽는다(실측).
            "--runtime-env-dir", f"{stage}/input/runtime_env",
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        die(f"prepare_workspace.py 실패 (rc={proc.returncode})")

    # 시드 자산은 남겨두면 에이전트가 읽을 수 있는 중복 사본이 된다. 즉시 제거한다.
    docker(args.container, "bash", "-lc", f"rm -rf {stage}")

    # 시드 결과 확인
    check = docker(
        args.container,
        "bash",
        "-lc",
        "ls /workspace && echo '---' && test -f /workspace/instruction.md && echo INSTRUCTION_OK",
        user="1000",
        check=False,
    )
    log(check.stdout.strip())
    if "INSTRUCTION_OK" not in check.stdout:
        die("/workspace/instruction.md 가 생성되지 않았다.")

    log("시드 완료. 다음 단계: ale_container.sh scrub → verify")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
