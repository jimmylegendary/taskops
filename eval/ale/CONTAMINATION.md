# 오염 경계 (ALE × taskops)

## 0. 소유자가 명시한 절대 규칙

> "벤치의 점수 측정이나 벤치 환경을 피드백으로 쓰는 것은, **시험지를 내고 채점 결과·해설을 본 뒤
> 답안을 고쳐 재제출하는 꼴**이다."

SWE-bench 실험에서 `requiredCheck`에 **공식 채점 하니스**를 걸어 정확히 이 오염을 저질렀다:

```
// eval/adapters/run_swebench_pro.mjs:94
requiredChecks: [{ command: `${VENV_PY} ${GRADE} ${instanceId} ${workspace} ${dataset}`, oracle: true }]
```

`swebench_pro_grade.py`는 공식 Scale AI Pro 채점기다. 이것이 실행 루프 안에 있었다는 것은
**에이전트가 채점 결과를 보고 답안을 고칠 수 있었다**는 뜻이다. **반복 금지.**

---

## 1. 판별 기준

> **과제가 에이전트에게 명시적으로 준 도구인가?** → ALLOW
> **채점자가 사후에 쓰는 것인가?** → DENY
> **경계가 모호한가?** → **무조건 DENY** (보수적으로 배제)

이 구분은 자의적이지 않다. `instruction.md`는 에이전트에게 **주어지는 문서**이고, 그 안에
요구사항으로 적힌 검증 수단은 과제 정의의 일부다. 반면 채점기는 에이전트에게 주어지지 않으며
에이전트의 존재를 전제로 그를 평가한다.

구체적으로 `pytest -q /workspace/testsuite`는 지시서가 "must exit with code 0"이라고 **요구사항으로
선언**한 것이다. 에이전트가 이것을 돌려보는 것은 채점 결과를 훔쳐보는 게 아니라
**주어진 명세를 확인하는 것**이다.

---

## 2. ALLOW 표

| 대상 | 근거 |
|---|---|
| `pytest -q /workspace/testsuite` | `instruction.md` **26행**, `## Required behavior` 1번이 문자 그대로 `pytest -q /workspace/testsuite must exit with code 0`을 요구. `task_card.json`의 `taskPrompt`도 `/workspace/.venv/bin/pytest` 사용을 안내. 공개 데이터셋에서 이 파일은 `input/workspace/testsuite/`에 있어 **input 쪽**이며 reference 쪽이 아니다. grep 결과 `/protected`·`/reference`를 전혀 참조하지 않는다. |
| 산출물 3종의 **존재 + JSON 파싱** 확인 | `instruction.md` **32-42행** (`## Required behavior` 3번 + `## Deliverable requirements`)이 파일 경로와 필드(`bytes_freed:int`, `files_deleted:int`, `notes:str`)를 직접 명시. |
| `/workspace/instruction.md` | 지시서 본문. 에이전트에게 주어지는 문서 그 자체. |
| `/workspace/config.json` | `instruction.md` **16행**이 authoritative input으로 명시. |
| `/workspace/logs/service.log` | **19행**이 "runtime evidence about the auxiliary shard path"로 명시. |
| `/workspace/app`, `assets`, `cache`, `trash`, `state` | 과제 대상 데이터. **11-19행**이 규정. |

### ALLOW 안의 금지선

산출물 검사는 **존재 + `json.load` 파싱까지만**이다.
**값의 정합성·임계값 비교는 하지 않는다** — 그건 채점기 로직의 복제이며, 복제된 채점기도 채점기다.

배제한 임계값 검사의 예: `config.json`의 `min_free_bytes(314572800)`,
`feature_index_size(130MB)`, `junk_bytes(420MB)`.
(덧붙여 이 임계값들은 이미 `/workspace/testsuite/test_service.py`의 assert 6개에 들어 있어
ALLOW 1번이 자연히 커버한다. 즉 별도로 복제할 실익조차 없다.)

---

## 3. DENY 표

| 대상 | 성격 | 조치 |
|---|---|---|
| `scripts/verify_safe_recover.py` | **ALE 공식 채점기 본체** | `requiredChecks`에 절대 연결 금지. `ale_grade.py`에서 사후 1회만. |
| 태스크 `main.py` | 채점 드라이버 | 동일 |
| `/reference/**` | 채점 fixture (정답) | 기동 직후 **빈 디렉터리로 덮어쓰기** |
| `/protected/**` | 트립와이어 (`sentinel.txt` sha256 비교). `instruction.md` **55행**도 "Do not access `/protected` in any way"로 접근 자체를 금지 | 퍼미션 + sudo 무력화로 차단 |
| `/output_test_pos`, `/output_test_neg` | 채점기 자체를 검증하는 positive/negative control로 **보이나** 이 태그에선 비어 있어 **확증하지 못했다** | **모호 → 보수적으로 배제** |
| `/home/user/.agenthle_hidden_eval_assets/**` | 평문 노출된 채점 자산 잔재 | **삭제** |
| `/home/user/.ale/**` | 과거 에이전트 런 transcript | **삭제** |
| `/home/user/.codex/{sessions,memories*,logs_2.sqlite*,goals_1.sqlite,state_5.sqlite,shell_snapshots,skills,tmp,.tmp}` | 과거 에이전트 대화·셸 이력 | **삭제** |
| `/home/user/.claude/{projects,sessions,shell-snapshots,backups,session-env}` | 동일 | **삭제** |
| `sudo` | 위 모든 DENY를 **무효화**하는 상위 권한 | **무력화** (§4) |

### 3.1 실측으로 확인한 누출 내용

문서상 추정이 아니라 이미지를 직접 열어 확인했다.

**`/home/user/.ale/`** — 12개 에이전트 디렉터리:
`claude-code, codex, cursor-cli, droid, forgecode, gemini-cli, grok-cli, hermes, openclaw-cli,
openhands_cli, terminus_2` (+ 1). **타 에이전트의 풀이 과정 = 직접적 힌트 누출.**

**`/home/user/.agenthle_hidden_eval_assets/`** — 실제 내용:
```
scientific_data_analysis/volume_rendering_rendering_1/{base,variant_2}/
    ├── reference/
    ├── output_test_pos/
    └── output_test_neg/
```
`user:user drwxr-xr-x`로 **평문 노출**. 이 태그에 들어있는 것은 다른 태스크(volume_rendering)의
자산이지만, 성격이 채점 fixture이므로 무관하게 삭제한다.

### 3.2 설계 문서 작성 이후 추가로 발견된 누출 경로

> **아래 두 항목은 원 설계의 DENY 목록에 없었다. 이미지 실측 중 새로 발견하여 추가한 것이다.**

`/home/user/.codex/`에는 `sessions/`, `memories/`, `memories_1.sqlite`, `logs_2.sqlite`,
`goals_1.sqlite`, `state_5.sqlite`, `shell_snapshots/`, `skills/`가 baked되어 있다.
`/home/user/.claude/`에는 `projects/`, `sessions/`, `shell-snapshots/`, `backups/`,
`session-env/`가 있다.

이들은 `.ale`와 **동일한 성격의 과거 에이전트 이력**이다. 특히 우리가 실행기로 쓰는 codex가
`~/.codex/sessions`를 읽을 수 있는 위치에 있으므로, 방치하면 **에이전트가 자기 전임자의 풀이를
읽는** 경로가 된다. 반드시 함께 스크럽한다.

### 3.3 호스트 쪽 누출 경로 — 실행기를 컨테이너 안에서 돌리는 또 다른 이유

호스트의 `/home/jimmy/repos/taskops/eval/ale/upstream/`에는 ALE upstream 클론이 있고, 그 안에
**`verify_safe_recover.py`(공식 채점기)와 `main.py`가 그대로 들어 있다.**

만약 실행기를 호스트에서 돌리고 컨테이너를 `docker exec`로만 조작하게 했다면, 에이전트는
`--sandbox danger-full-access`로 호스트 파일시스템을 읽을 수 있으므로 **채점기 소스를 직접 읽을 수
있었다.** 이는 치명적 오염이다.

따라서 실행기는 **컨테이너 안에서 실행한다**(§5). 컨테이너에는 upstream 클론이 없다.

---

## 4. sudo 무력화

기본 사용자 `user`(uid 1000)는 실측상 다음 그룹에 속한다:

```
uid=1000(user) gid=1000(user) groups=...,27(sudo),138(docker),1001(google-sudoers)
```

그리고 `/etc/sudoers.d/google_sudoers`가 NOPASSWD:ALL을 부여한다.
실측: `sudo -n cat /protected/sentinel.txt` → **rc=0**.

즉 **0700 퍼미션은 에이전트를 막지 못한다.** §3의 모든 DENY가 sudo 한 줄로 무효화된다.

조치 (에이전트 실행 구간에 한해):
- `rm -f /etc/sudoers.d/google_sudoers`
- `gpasswd -d user sudo`
- `gpasswd -d user google-sudoers`
- `gpasswd -d user docker`

### 4.1 채점기가 sudo를 전제한다는 충돌

`verify_safe_recover.py`와 `prepare_workspace.py`는 둘 다 `_sudo()` / `_sudo_bash()` 헬퍼를 쓰며
`/workspace`·`/protected` 조작에 sudo를 요구한다.

따라서 **순서를 강제한다**:

```
기동 → 시드(sudo 살아있음) → 위생(sudo 제거) → 위생 검증 →
  [에이전트 실행 구간 — sudo 없음] →
  에이전트 완전 종료 → 산출물 회수 → 사후 채점(root exec)
```

**시드가 위생보다 먼저**인 이유가 이것이다. `prepare_workspace.py`는 sudo가 필요하므로 위생 이후에는
실행할 수 없다.
채점은 sudo를 `user`에게 되돌려주는 대신 **`docker exec -u 0`(root)로 실행**한다 — 이렇게 하면
에이전트 구간의 무권한 상태를 되돌리지 않고도 채점이 가능하다.

**이 순서가 어긋나면 오염이 재발한다.** `ale_container.sh`는 위생 검증에 실패하면 런을 중단한다.

---

## 5. 실행기 배치 — 컨테이너 안에서 실행

`cli/lib-runtime-adapters.js:47-50 adapterCommand()`가 `TASKOPS_CODEX_BIN` 환경변수로 codex
바이너리 경로를 override한다. 이를 이용해 `ale_codex_shim.sh`를 끼우고, 셰임이 인자를 그대로
컨테이너로 전달한다:

```sh
exec docker exec -u 1000 -w /workspace -i "$ALE_CONTAINER" \
  env HOME=/home/user /usr/local/bin/codex "$@" < /dev/null
```

실측 전제:
- ALE 이미지에 `codex`가 `/usr/local/bin/codex`로 **이미 설치되어 있다.**
- 그러나 `/home/user/.codex/auth.json`은 **없다** → 호스트 인증을 주입해야 한다.

인증 주입은 **단일 파일 read-only 마운트**로만 한다:

```
-v $HOME/.codex/auth.json:/home/user/.codex/auth.json:ro
```

**호스트 `~/.codex` 전체를 마운트하면 안 된다.** 그러면 내 개발 세션 이력이 컨테이너로 새어
**반대 방향 오염**이 된다. 반드시 `auth.json` 하나만.

---

## 6. 절차적 격리

- 채점은 에이전트 프로세스가 **완전히 종료한 뒤 사후 1회**만 실행한다.
- 점수는 taskops 실행 루프에 **어떤 형태로도 피드백되지 않는다** —
  `requiredChecks`·재시도 판단·프롬프트 어디에도 들어가지 않는다.
- `ale_grade.py`는 **스코어러 전용 진입점**이며 어댑터 런타임 경로에서 **import 금지**.
  `run_ale.mjs` / `run_ale_bare.mjs`는 이 파일을 import하지도 spawn하지도 않는다.
- 위반을 코드로 검출할 수 있도록, `ale_grade.py` 상단에 금지 선언 주석을 두고
  `run_ale*.mjs`에도 대응 주석을 둔다.

---

## 7. 채점 구조에 관한 실측 사실 (중요)

`verify_safe_recover.py`를 읽어 확인한 것:

1. **`--reference-dir`는 line 20에서 정의되고 line 273에서 변수에 대입될 뿐, 이후 465줄 전체에서
   한 번도 사용되지 않는다.** 따라서 gated:manual인 archive(reference 포함)를 받지 않고도
   실행+채점이 완결된다. → **HF 게이트를 건드릴 이유가 없다.**
2. **채점기는 workspace를 처음부터 다시 만든다** (line 285 `prepare_workspace(...)`), 그리고
   `remote_output_dir/safe_recover.py` **하나만** 복사해 넣는다 (line 279, 286).
   즉 **채점 대상은 오직 `safe_recover.py`이며, 에이전트가 손으로 쓴 산출물 3종은 폐기되고
   `safe_recover.py`를 두 번 실행해 재생성한 것으로 평가된다.**
   - 실무적 함의: 산출물을 하드코딩으로 써두는 풀이는 0점이다. 도구가 재현 가능해야 한다.
   - 우리 자체 게이트(§2 ALLOW 2번)는 여전히 유효하다 — 그건 지시서 32-42행이 요구하는 것이며
     채점 방식과 무관하다. 다만 **우리 게이트 통과 ≠ ALE 통과**임을 결과 해석 시 유의한다.
3. 최종 `score=1.0` 조건은 `tests_ok and cleanup_ok and incident_ok and manifest_ok and
   shard_integrity_ok and protected_ok and not disallowed_{created,modified,deleted}`.
   **이 조건식을 어댑터 어디에도 복제하지 않는다.**

---

## 8. HF 게이트 준수

- 공개 데이터셋 `agents-last-exam/agents-last-exam-data`(gated: **False**)의
  **`input/` + `software/`만** 받는다.
- `gated: manual`인 archive(`reference/` 포함)는 **Jimmy 결정 전까지 요청하지 않는다.**
  `ale_seed.py`에 reference를 받는 코드 경로 자체를 만들지 않는다.
- 근거는 §7-1: reference 없이도 채점이 완결된다.

크리덴셜/결제 요구가 발생하면 자동 우회하지 않고 중단 후 보고한다(표준 방침).

---

## 9. 감사 (런 종료 후 확인할 것)

성공 기준 6번의 실사 항목:

1. `/protected` 접근 흔적 0건
2. `/reference` 접근 흔적 0건
3. `~/.agenthle_hidden_eval_assets` 접근 흔적 0건 (그리고 위생 단계에서 삭제되었음)
4. `~/.ale` 접근 흔적 0건 (그리고 삭제되었음)
5. `verify_safe_recover.py` / `main.py` 문자열이 에이전트 트랜스크립트에 등장하지 않음
6. 에이전트 구간 동안 `sudo -n true`가 **실패**했음
7. 호스트 `eval/ale/upstream/` 경로가 에이전트 트랜스크립트에 등장하지 않음 (§3.3)
