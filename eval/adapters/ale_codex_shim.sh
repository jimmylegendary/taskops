#!/bin/sh
# codex 실행기를 ALE 컨테이너 '안'에서 돌리기 위한 셰임.
#
# 배선: cli/lib-runtime-adapters.js:47-50 adapterCommand() 가 TASKOPS_CODEX_BIN 으로 codex 바이너리
# 경로를 override 한다. 인자 벡터(codexArgs, 211행)는 그대로 유지되므로 여기서는 앞에 docker exec 만
# 붙여 컨테이너로 전달하면 된다.
#
# 왜 컨테이너 안에서 돌리는가 (CONTAMINATION.md §3.3):
#   실행기를 호스트에서 돌리면 에이전트가 --sandbox danger-full-access 로 호스트를 읽을 수 있고,
#   호스트 eval/ale/upstream/ 에는 공식 채점기 verify_safe_recover.py 소스가 그대로 있다.
#   컨테이너 안에는 upstream 클론이 없으므로 이 경로가 원천 차단된다.

set -eu

if [ -z "${ALE_CONTAINER:-}" ]; then
  echo "[ale_codex_shim] 오류: ALE_CONTAINER 환경변수가 설정되지 않았다. 어댑터가 컨테이너 이름을 주입해야 한다." >&2
  exit 90
fi

case "$ALE_CONTAINER" in
  taskops-ale-*) : ;;
  *)
    # 타 세션 컨테이너 보호: 우리 접두사가 아니면 실행 자체를 거부한다.
    echo "[ale_codex_shim] 오류: ALE_CONTAINER='${ALE_CONTAINER}' 는 우리 컨테이너가 아니다(접두사 taskops-ale- 필요)." >&2
    exit 91
    ;;
esac

# "$@" 로 넘긴다. prompt 인자에 공백·개행이 들어 있으므로 $* 를 쓰면 인자가 쪼개져 망가진다.
# stdin 은 즉시 EOF: codex exec 는 열린 파이프가 있으면 "Reading additional input from stdin..." 로
# 블록한다. invokeRuntimeAdapter 도 input:'' 로 같은 방어를 하지만 셰임에서도 이중으로 막는다.
exec docker exec -u 1000 -w /workspace -i "$ALE_CONTAINER" \
  env HOME=/home/user /usr/local/bin/codex "$@" < /dev/null
