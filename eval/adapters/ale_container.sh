#!/usr/bin/env bash
# ALE 컨테이너 생애주기 + 오염 위생.
#
# 사용법:
#   ale_container.sh up      [runTag]   컨테이너 기동 (이름 출력)
#   ale_container.sh seed    <name>     과제 시드 (sudo 필요 → 반드시 scrub 이전)
#   ale_container.sh scrub   <name>     오염 자산 제거 + sudo 무력화
#   ale_container.sh verify  <name>     위생 검증 (실패 시 rc≠0 → 런 중단)
#   ale_container.sh collect <name> <outDir>   산출물 회수
#   ale_container.sh down    <name>     정리
#   ale_container.sh id      [runTag]   컨테이너 이름만 계산해 출력
#
# 순서 강제 (CONTAMINATION.md §4):
#   up → seed(sudo 살아있음) → scrub(sudo 제거) → verify → [에이전트] → collect → 사후 채점
# seed 가 scrub 보다 먼저인 이유: prepare_workspace.py 가 sudo 를 요구하므로
# scrub 이후에는 시드가 불가능하다.
set -euo pipefail

IMAGE="${ALE_IMAGE:-agentslastexam/ale-ubuntu22-docker:latest}"
# 타 세션 컨테이너(hive-app-1 / hive-db-1 / n8n-* / sweb.eval.*)를 절대 건드리지 않기 위해
# 우리 컨테이너는 전부 이 접두사를 강제한다. 전역 정리(prune 등)는 이 파일 어디에도 없다.
NAME_PREFIX="taskops-ale-"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# taskops 런 work 디렉터리를 호스트/컨테이너에 **동일한 절대경로**로 bind-mount 한다.
#
# 왜 필요한가 (실측으로 발견한 결함):
#   performAgentExploration(lib-runner.js:5017)는 에이전트에게 아티팩트 경로를
#   `<runDir>/artifacts/<runNodeId>.md` 로 지시한 뒤 5018 에서 existsSync 로 **호스트에서** 검사하고,
#   없으면 'refusing to mark exploration done' 으로 탐색을 실패 처리한다.
#   실행기는 컨테이너 안에서 도는데 경로는 호스트 경로이므로, mount 가 없으면 에이전트가 무엇을 쓰든
#   호스트에는 파일이 생기지 않아 exploration 이 **항상 실패**한다.
#   탐색이 실패하면 lib-runner.js:5148-5163 의 readiness 승격 블록(성공 경로에만 있음)이 돌지 않아
#   needs_decomposition 으로 전이하지 못하고 decomposition 은 영원히 0 이 된다.
#   → SWE-bench 의 "taskops 를 껍데기로 만든" 실패가 형태만 바꿔 재발한다.
#
# 오염 관점: 마운트되는 것은 이 전용 디렉터리 하나뿐이다. 저장소(eval/ale/upstream 의 공식 채점기
# 소스 포함)는 컨테이너에 노출되지 않는다. 호스트/컨테이너 모두 uid 1000 이라 퍼미션도 일치한다.
ALE_WORK_ROOT="${ALE_WORK_ROOT:-/tmp/taskops-ale-work}"

die() { echo "[ale_container] 오류: $*" >&2; exit 1; }
log() { echo "[ale_container] $*" >&2; }

# 우리 소유 컨테이너인지 이름으로 검사한다. 이 가드를 통과하지 못하면 어떤 docker 조작도 하지 않는다.
assert_ours() {
  local name="${1:-}"
  [[ -n "$name" ]] || die "컨테이너 이름이 비어 있다."
  case "$name" in
    "${NAME_PREFIX}"*) : ;;
    *) die "'$name' 은 우리 컨테이너가 아니다(접두사 ${NAME_PREFIX} 필요). 타 세션 컨테이너 보호를 위해 거부한다." ;;
  esac
}

cmd_id() {
  local tag="${1:-smoke}"
  echo "${NAME_PREFIX}${tag}"
}

cmd_up() {
  local tag="${1:-smoke}"
  local name; name="$(cmd_id "$tag")"
  assert_ours "$name"

  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    die "'$name' 이 이미 존재한다. 먼저 'down $name' 으로 정리하라."
  fi

  # 인증 주입은 auth.json 단일 파일 read-only 마운트로만 한다.
  # 호스트 ~/.codex 전체를 마운트하면 내 개발 세션 이력이 컨테이너로 새어 '반대 방향 오염'이 된다.
  local auth="${HOME}/.codex/auth.json"
  [[ -f "$auth" ]] || die "호스트 codex 인증 파일이 없다: $auth"

  # ALE_ENABLE_DIND 미설정 → --privileged 불필요.
  # 자원: 호스트 RAM 가용 ~20GB, 16코어 → c4-standard-4 상당으로 제한.
  # work 루트는 호스트/컨테이너 동일 경로로 rw 마운트한다(위 ALE_WORK_ROOT 주석 참조).
  mkdir -p "$ALE_WORK_ROOT"

  log "기동: $name (image=$IMAGE, workRoot=$ALE_WORK_ROOT)"
  docker run -d \
    --name "$name" \
    --entrypoint /dockerstartup/entrypoint.sh \
    --memory=6g --cpus=4 \
    -v "${auth}:/home/user/.codex/auth.json:ro" \
    -v "${ALE_WORK_ROOT}:${ALE_WORK_ROOT}" \
    "$IMAGE" >/dev/null

  # 준비 확인: 120초 상한. entrypoint 가 서비스를 올릴 때까지 기다린다.
  local deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
      docker logs --tail 40 "$name" >&2 || true
      die "'$name' 이 기동 중 종료했다."
    fi
    # /status 가 없는 태그도 있으므로 exec 가능 여부를 1차 신호로 쓴다.
    if docker exec "$name" sh -c 'test -d /workspace' >/dev/null 2>&1; then
      log "준비 완료 (${SECONDS}s)"
      echo "$name"
      return 0
    fi
    sleep 2
  done
  die "'$name' 준비 확인 120초 초과."
}

cmd_seed() {
  local name="${1:-}"; assert_ours "$name"
  # 시드 본체는 파이썬 쪽에 있다(HF 다운로드 + docker cp + prepare_workspace.py 실행).
  log "시드 시작 (sudo 가 아직 살아 있어야 한다)"
  python3 "${HERE}/ale_seed.py" --container "$name"
}

cmd_scrub() {
  local name="${1:-}"; assert_ours "$name"
  log "위생 시작: 오염 자산 제거 + sudo 무력화"

  # root 로 실행. 마운트된 auth.json 은 ro 이므로 절대 건드리지 않는다.
  docker exec -u 0 "$name" bash -lc '
    set -u
    # (1) 채점 자산 잔재
    rm -rf /home/user/.agenthle_hidden_eval_assets || true
    # (2) 12개 에이전트의 과거 런 transcript
    rm -rf /home/user/.ale/* || true
    # (3) 과거 에이전트 대화·셸 이력 — 설계 이후 이미지 실측으로 추가 발견된 누출 경로.
    #     auth.json 은 ro 마운트이므로 목록에서 제외한다.
    for p in sessions memories memories_1.sqlite goals_1.sqlite state_5.sqlite \
             shell_snapshots skills tmp .tmp logs_2.sqlite logs_2.sqlite-shm logs_2.sqlite-wal; do
      rm -rf "/home/user/.codex/$p" || true
    done
    for p in projects sessions shell-snapshots backups session-env; do
      rm -rf "/home/user/.claude/$p" || true
    done
    # (4) 채점 fixture: 빈 디렉터리로 덮어쓴다
    rm -rf /reference || true
    mkdir -p /reference
    chmod 700 /reference
    # (5) 채점기 자체 검증용 control (이 태그에선 비어 있으나 보수적으로 배제)
    rm -rf /output_test_pos /output_test_neg || true
    # (6) sudo 무력화 — 0700 퍼미션은 에이전트를 막지 못한다. sudo 한 줄이면 모든 DENY 가 무효화된다.
    rm -f /etc/sudoers.d/google_sudoers || true
    gpasswd -d user sudo           >/dev/null 2>&1 || true
    gpasswd -d user google-sudoers >/dev/null 2>&1 || true
    gpasswd -d user docker         >/dev/null 2>&1 || true
    # /protected 는 삭제하지 않는다(채점 시 sentinel 비교 대상). 접근만 차단한다.
    chmod 700 /protected 2>/dev/null || true
    chown root:root /protected 2>/dev/null || true
  '
  log "위생 완료"
}

cmd_verify() {
  local name="${1:-}"; assert_ours "$name"
  log "위생 검증 (실패 시 런 중단)"
  local failed=0

  # user(uid 1000) 로 접근했을 때 반드시 '실패' 해야 하는 것들.
  _must_fail() {
    local desc="$1"; shift
    if docker exec -u 1000 "$name" bash -lc "$*" >/dev/null 2>&1; then
      echo "[ale_container] 위생 실패: ${desc} 이(가) 여전히 가능하다." >&2
      failed=1
    else
      log "  ok: ${desc} 차단됨"
    fi
  }

  _must_fail "/protected 읽기"        'cat /protected/sentinel.txt'
  _must_fail "/protected 목록"        'ls /protected'
  _must_fail "sudo 사용"              'sudo -n true'
  _must_fail "sudo 로 /protected 읽기" 'sudo -n cat /protected/sentinel.txt'

  # 삭제되어야 하는 경로들 — 존재하면 실패.
  for p in /home/user/.agenthle_hidden_eval_assets /home/user/.ale/codex \
           /home/user/.codex/sessions /home/user/.claude/projects; do
    if docker exec -u 1000 "$name" bash -lc "test -e '$p'" >/dev/null 2>&1; then
      echo "[ale_container] 위생 실패: $p 가 여전히 존재한다." >&2
      failed=1
    else
      log "  ok: $p 제거됨"
    fi
  done

  # /reference 는 비어 있어야 한다.
  if [[ -n "$(docker exec -u 0 "$name" bash -lc 'ls -A /reference 2>/dev/null' || true)" ]]; then
    echo "[ale_container] 위생 실패: /reference 가 비어 있지 않다." >&2
    failed=1
  else
    log "  ok: /reference 비어 있음"
  fi

  # 실행기 배선 전제: 컨테이너 안 codex + 주입된 인증.
  if ! docker exec -u 1000 "$name" bash -lc 'test -x /usr/local/bin/codex'; then
    echo "[ale_container] 위생 실패: 컨테이너에 /usr/local/bin/codex 가 없다." >&2
    failed=1
  fi
  if ! docker exec -u 1000 "$name" bash -lc 'test -r /home/user/.codex/auth.json'; then
    echo "[ale_container] 위생 실패: codex 인증이 주입되지 않았다." >&2
    failed=1
  fi

  if (( failed )); then
    die "위생 검증 실패 — 오염된 상태로 진행하지 않는다. 런을 중단한다."
  fi
  log "위생 검증 통과"
}

cmd_collect() {
  local name="${1:-}"; assert_ours "$name"
  local out="${2:-}"; [[ -n "$out" ]] || die "출력 디렉터리를 지정하라."
  mkdir -p "$out"
  # 사후 채점이 workspace 를 재생성하므로(CONTAMINATION.md §7-2) 회수는 채점보다 먼저여야 한다.
  log "산출물 회수 → $out"
  docker cp "${name}:/workspace" "${out}/workspace" >/dev/null 2>&1 \
    || log "  경고: /workspace 회수 실패"

  # 시드된 대용량 바이너리(shard/junk 블롭)는 **에이전트 산출물이 아니라 입력**이고 이미지에서
  # 언제든 재현된다. 그대로 두면 인스턴스당 ~700MB 가 저장소 트리에 untracked 로 쌓여
  # (41개 대역이면 ~29GB) 실수로 `git add -A` 하면 그대로 커밋된다.
  # 텍스트 증거(산출물 3종·safe_recover.py·instruction.md·로그)는 남기고 블롭만 지운다.
  # 크기 증거는 지우기 전에 목록으로 남긴다.
  if [[ -d "${out}/workspace" ]]; then
    find "${out}/workspace" \( -name '*.bin' -o -name 'required.dat' \) -type f \
      -printf '%s\t%p\n' > "${out}/pruned-blobs.tsv" 2>/dev/null || true
    find "${out}/workspace" \( -name '*.bin' -o -name 'required.dat' \) -type f -delete 2>/dev/null || true
    # .venv 는 런타임 환경이지 증거가 아니다.
    rm -rf "${out}/workspace/.venv" 2>/dev/null || true
  fi
  log "회수 완료 (대용량 블롭은 pruned-blobs.tsv 에 목록만 보존)"
}

cmd_down() {
  local name="${1:-}"; assert_ours "$name"
  log "정리: $name"
  docker rm -f "$name" >/dev/null 2>&1 || true
  log "정리 완료"
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    up)      cmd_up      "$@" ;;
    seed)    cmd_seed    "$@" ;;
    scrub)   cmd_scrub   "$@" ;;
    verify)  cmd_verify  "$@" ;;
    collect) cmd_collect "$@" ;;
    down)    cmd_down    "$@" ;;
    id)      cmd_id      "$@" ;;
    *) die "알 수 없는 서브커맨드 '${sub}'. up|seed|scrub|verify|collect|down|id" ;;
  esac
}
main "$@"
