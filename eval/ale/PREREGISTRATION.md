# ALE × taskops 사전등록 (N=1 스모크)

작성 시점: 2026-07-29. **이 문서는 스모크를 돌리기 전에 고정된다.** 실행 후 어떤 항목도 수정하지
않는다. 결과가 마음에 들지 않아 기준을 고쳐 쓰는 것이 사후 합리화의 전형이므로, 변경이 필요하면
새 문서를 새 번호로 추가하고 이 문서는 그대로 둔다.

대상 과제: `computing_math/ranking_node_feature_parity_recovery_instance_1`
(Agents' Last Exam, Berkeley RDI — 1,500+ 전문가 출제 과제 / 55개 직종 / 인간 소요 시간·주 단위 /
결정론적 실행 검증 + 구조화 rubric / 최상위 tier 프론티어 평균 2.6%).

---

## 1. 가설

**taskops의 강제된 제1원칙 사고가, 넓은 objective + 함정 자료가 심어진 과제에서 실제로 발동하는가.**

taskops가 무엇인지부터 못박는다. taskops는 **한 번 시킨 일을 24-48시간 끝까지 밀되, 한 방에 지멋대로
실행하는 게 아니라 정교하게 생각하도록 강제하는 장치**다. 동작은:

> 넓은 level에서 분해 → readiness 판정 → 다음 행동 결정 → 모르면 exploration →
> 알아낸 것으로 **계획을 바꿔가며** 진행

known/unknown 4축은 "계획이 처음과 달라졌음"을 알기 위한 장치다. 요컨대
**강제된 제1원칙 사고 = 구조화된 CoT**.

거짓 완료 방지(`false_completion=0`)는 이를 가능케 하는 **필수 부품이지 목적이 아니다.**
그것만 자랑하는 보고서는 초점을 잃은 것이다. 이 사전등록의 주 지표가 false_completion이 **아닌**
이유가 바로 이것이다.

ALE의 이 과제를 고른 이유: 지시서가 명시적으로

> "Informal handoff notes, cached manifests, helper snippets, and previous incident summaries should
> only be used if they are independently validated against the authoritative sources above and the
> live files on disk." (instruction.md 19행)

라고 적는다. 즉 **함정 자료가 심어져 있고 무엇이 진실인지 탐색해 판별해야 한다.**
이것이 taskops의 4축·exploration과 정확히 대응하는 과제 구조다.

---

## 2. 이번 스모크의 성공 기준은 "과제 해결"이 아니다

**명시적으로 선언한다: 이 스모크의 성공은 ALE 과제를 푼 것이 아니다.**
성공 기준은 **taskops의 핵심 기능(분해·탐색)이 실제로 발동했는가** 하나다.
ALE score = 0.0 이어도 §5의 주 기준을 만족하면 스모크는 **성공**이다.

이렇게 정의하는 이유는 §3의 실패를 반복하지 않기 위해서다.

---

## 3. 사후 분석 — SWE-bench 실험은 왜 무의미했는가

SWE-bench(Verified/Pro)로 돌린 이전 실험은 **측정 대상이 아예 존재하지 않았다.**

실측 이벤트 집계:

| 이벤트 | 횟수 |
|---|---|
| `task_selected` | 35 |
| `verify_retry` | 22 |
| **`decomposition`** | **0** |
| **`exploration`** | **0** |
| **`surprise`** | **0** |

원인은 벤치가 아니라 **어댑터**에 있었다. 두 개의 독립적인 결함이다.

### 원인 1 — readiness 하드코딩 (`eval/adapters/run_swebench_pro.mjs:90`)

어댑터는 work를 이렇게 만들었다:

```
task: { id: "solve", runReadiness: "runnable", understandingLevel: "known" }
```

task 1개 · `runnable` · `known` **하드코딩**. 분해할 것도 모를 것도 없다고 **미리 못박은** 것이다.
그 결과 taskops가 할 수 있는 일은 execute → verify → retry 뿐이었다.
즉 taskops를 **"retry 래퍼"로 축소해놓고 그 껍데기의 lift를 쟀고**, 당연히 lift=0이 나왔다.

### 원인 2 — 스텝 예산 고갈 (같은 파일)

```
maxSteps: verifyRetries + 2      // = 2~3
```

explore 1스텝 + decompose 1스텝이면 이미 소진되어 **자식 task를 실행할 스텝이 남지 않는다.**
원인 1을 고쳐도 이것만으로 `decomposition=0`이 재현된다. 그래서 이번에는 `maxSteps=40`이다.

### 교훈

lift가 0으로 나왔을 때 "taskops가 쓸모없다"가 아니라 **"내가 taskops를 껐다"**를 먼저 의심해야 했다.
이번 어댑터가 §4를 그토록 강하게 못박는 이유다.

---

## 4. 확정된 work 형태와 그 코드 근거 (사후 변경 금지)

루트 task **1개**. 단, readiness를 하드코딩하지 않는다.

| 필드 | 값 |
|---|---|
| `objective` | `/workspace/instruction.md` **원문** (3499바이트, 요약·재작성·가공 금지). 단 §4.1의 충실도 한계 있음 |
| `title` | `ALE ranking_node_feature_parity_recovery_instance_1` |
| `responsibility` | `/workspace/safe_recover.py` 복구 도구를 구현하고 지시서가 요구하는 산출물 3종을 생성한다 |
| `completionCriteria` | `pytest -q /workspace/testsuite` exit 0 이고 산출물 3종이 존재하며 JSON이 파싱된다 |
| `uncertaintyState` | **`unknown_unknown`** ← 유일한 레버 |
| `expectedPlan` | `{ expectedDepth: 2 }` |
| `acceptance` | `{ mode: 'guarded', requiredChecks: [...] }` (§6) |
| `runReadiness` | **미지정** |
| `understandingLevel` | **미지정** |

### 4.1 objective 충실도 한계 — 설계 요구를 완전히는 만족시킬 수 없다 (구현 중 발견)

> **설계는 objective가 "원문 그대로, 훼손 금지"일 것을 요구했다. 이는 taskops 저장 포맷상
> 달성 불가능하며, 아래가 실제로 일어나는 일이다. 사후에 발견하지 않도록 사전등록에 박아 둔다.**

`fmScalar`(`cli/lib-taskops.js:2320-2332`)는 identity 계열(`id`/`*Id`/`*Ids`)이 **아닌** 모든
스칼라에 대해 무조건 다음을 적용한다:

```js
text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
```

block-scalar 경로가 **없다.** 따라서 frontmatter는 여러 줄 텍스트를 원문 그대로 담을 수 없다.
이것은 taskops 저장 포맷의 구조적 성질이지 어댑터의 선택이 아니며, **벤치를 위해 taskops 코어를
고치는 것은 범위 밖**이다(그것이야말로 벤치에 맞춰 제품을 바꾸는 오염이다).

**실측:**

| 항목 | 값 |
|---|---|
| 원문 | 3499 B |
| 평탄화 후 | 3437 B (−62 B) |
| 토큰 수 | 477 → 477, **순서까지 완전 동일** |
| 내용 손실 | **없음** |
| 줄 구조 | **붕괴** |

**붕괴가 무해하지는 않다.** 예:

```
You may create or modify only: - `/workspace/safe_recover.py` - `/workspace/cleanup_summary.json`
- `/workspace/incident_report.md` - `/workspace/state/feature_manifest.json`
- The service test run may generate `/workspace/service_status.json` ...
```

"수정 허용 목록"과 그 다음 규칙의 경계가 사라져 **네 번째 허용 항목으로 오독될 수 있다.**
그리고 이 구간이 바로 채점의 `disallowed_created` / `disallowed_modified`를 좌우하는
`## Strict rules`다.

**완화책** (objective 자체는 손대지 않는다):
1. taskops 메타 필드인 `responsibility`에 **"정본은 `/workspace/instruction.md`"** 지시를 넣어
   에이전트가 바이트 단위 원문을 읽게 한다. 컨테이너 `/workspace`에 원문이 그대로 있으므로
   정본 접근 경로는 항상 열려 있다.
2. 원문 `sha256`과 바이트 수를 결과 레코드(`instruction_sha256`, `instruction_bytes`)에 남기고,
   `instruction.verbatim.md`를 결과 디렉터리에 보존해 사후 대조 가능하게 한다.
3. `objective_flattened: true` 플래그를 결과에 명시한다.

**해석 시 유의**: 이 아암과 bare 아암은 프롬프트 충실도가 다르다. bare 아암은 `instruction`을
`docker exec`의 argv로 직접 넘기므로 **줄바꿈이 보존된다.** 즉 bare 쪽이 오히려 더 충실한
프롬프트를 받는다. N=1이라 lift를 주장하지 않으므로 당장 문제는 아니지만, **본 실험에서 lift를
측정할 때는 이 비대칭을 반드시 제거해야 한다**(양쪽 모두 `/workspace/instruction.md`를 읽게 하거나,
taskops 코어에 block-scalar를 도입하거나). 이것을 모른 채 lift를 재면 **taskops에 불리한 편향**이
섞인다.

### 왜 runReadiness/understandingLevel을 쓰지 않는가

§3 원인 1이 정확히 이 두 필드였다. 어댑터 소스에도 같은 주석을 박아 두었다.

### 왜 `expectedDepth`로는 분해를 강제할 수 없는가

`cli/lib-taskops.js:1629 hasUncertaintyReadinessFields`는 uncertainty 스칼라 필드가 **하나만
있어도** true를 반환한다. 그러면 uncertainty 경로가 primary가 되고(1538-1590), legacy
`inferTaskReadiness`의 `depth_contract`(1686)는 **우회된다.**
따라서 `expectedPlan.expectedDepth`는 readiness 판정에 관여하지 않으며,
`uncertaintyState`가 **유일한 레버**다.
(`expectedDepth`는 `budgetWithExpectedPlanCoordinate`(`lib-runner.js:6192`)와 decomposition
coverage 평가에 쓰이므로 coarse-first 2단 분해 신호로서 여전히 의미가 있다.)

### 왜 `unknown_unknown`인가 — 결정론적 2스텝 보장

체인 전체를 코드로 실측 확인했다:

1. `lib-taskops.js:1709-1717` — `unknown_unknown`은 explicit runReadiness를 무시하고
   **무조건** `needs_exploration`으로 강제된다.
2. `lib-runner.js:1839-1844 ACTION_BY_READINESS` — `needs_exploration → explore`,
   `needs_decomposition → decompose`.
3. 탐색이 성공하면 핸들러가 **스스로 탈출구를 쓴다** (`lib-runner.js:5148-5163`):
   - `fm.status = 'pending'` (5152)
   - **`fm.runReadiness = 'needs_decomposition'` (5153)**
   - `unknown_unknown → known_unknown` 승격 (5160)
4. `lib-taskops.js:1971-1976 isDecompositionReadyByUncertainty` —
   `runReadiness === 'needs_decomposition'`이면 즉시 true.

⇒ **스텝1 = exploration, 스텝2 = decomposition이 결정론적으로 보장된다.**
루트 하나만으로 두 지표가 모두 0이 아니게 되는 **유일하게 확실한 시드**다.

5155-5159의 주석이 이 anti-loop 설계를 명시적으로 서술한다("승급하지 않으면 매 스텝 재-explore
무한루프가 된다", "이미 known_unknown이면 재승격 없음(anti-loop)").

일관성 검사(`lib-taskops.js:1978-1988`)의 `explicit_readiness_differs_from_uncertainty`는
explicit(`needs_decomposition`)과 semantic(`needs_decomposition`)이 일치하므로 발화하지 않는다.

### 왜 `known_unknown`이 아닌가

`known_unknown`은 `isDecompositionReadyByUncertainty`가 false면 `needs_exploration`,
true면 `needs_decomposition`이다(1718-1734). `decompositionConfidence ≥ 0.7`을 주면 분해는
보장되지만 **exploration은 자식 task가 unknowns를 선언할 때만 발생**하고 그건 분해 LLM에 달렸다 —
보장이 아니다. 성공 기준이 두 이벤트 **모두**를 요구하므로 열등하다.

### 왜 `known`이 아닌가

`1750-1758`, runnable 계약 3필드가 있으면 즉시 runnable → execute-only.
**§3 실패의 정확한 재현**이다.

### 정직성 — 이것은 게이밍이 아니다

`unknown_unknown`은 사실 서술이다. 함정 문서가 심어져 있고 에이전트는 시작 시점에 무엇이 함정인지는
커녕 **함정이 있다는 것조차 모른다.** 이것이 문자 그대로 unknown unknown이다.
반대로 `runnable/known`이야말로 사실이 아닌 주장이었다.

### 폴백 (사전에 등록해 둔다)

스모크에서 exploration 스텝이 어댑터 오류로 실패해 fm이 갱신되지 않고 재-explore가 반복되면
(5148 블록은 **성공 경로에만** 있다), 폴백은 루트를 `uncertaintyState='known_unknown'` +
`decompositionConfidence=0.75`로 바꿔 분해부터 시작시키는 것이다.
**단 이 경우 exploration 보장이 사라지므로 성공 기준을 재평가해야 하며, 폴백을 썼다는 사실을
결과에 반드시 명시한다.**

### 스텝 예산

`maxSteps = 40`, `timeout = 7200`(ALE 공식 task timeout과 동급), `verifyChecks = true`,
`continueOnFailure = true`.

---

## 5. 성공 기준 (사전 고정)

판정은 **`eval/adapters/ale_events_report.mjs`의 출력으로만** 한다. ALE 점수와 분리한다.

### 주 기준 (이것만이 스모크의 성패)

> `decomposition_started` ≥ 1 **AND** `type:'exploration'` 런노드 ≥ 1

즉 taskops의 핵심 기능(분해·탐색)이 실제로 발동했음. **ALE score=0.0이어도 성공.**

### 부 기준

2. 설계상 결정론적으로 보장되는 최소 궤적이 실측 재현될 것: **스텝1 explore → 스텝2 decompose.**
   루트 task 파일에서 `uncertaintyState`가 `unknown_unknown → known_unknown`으로 전이하고
   `runReadiness`가 `needs_decomposition`으로 기록되었을 것
   (`lib-runner.js:5153,5160`의 실제 발화 확인).
3. 분해가 **실질적**일 것: 자식 task ≥ 2개, `decomposition_coverage_gap`이 없거나 coverageRatio가
   납득 가능할 것. **자식 1개짜리 형식적 분해는 실패로 간주한다.**
4. **계획이 바뀌었다는 증거**: `high_surprise` 이벤트 ≥ 1 **또는** 자식 task 중
   `unknowns`/`uncertaintyState`를 선언한 것이 ≥ 1.
   taskops의 존재 이유가 "알아낸 것으로 계획을 바꾸는 것"이므로, **탐색이 아무것도 바꾸지 못했다면
   구조화 CoT가 작동하지 않은 것이다.**
5. 무한 루프가 없을 것: 동일 task에 대한 exploration 스텝이 **2회를 초과하지 않을 것**
   (5159 anti-loop 주석의 실측 검증).
6. **오염 격리가 실제로 성립할 것**: 런 종료 후 감사에서 에이전트가 `/protected`, `/reference`,
   `~/.agenthle_hidden_eval_assets`, `~/.ale`, `verify_safe_recover.py`에 접근한 흔적이 **0건**.
   sudo가 무력화되어 있었음이 확인될 것. (자세한 정의는 `CONTAMINATION.md`.)

### 부차 — ALE 공식 점수

사후 1회 기록. 이진(0.0/1.0).
**이 값은 성공 판정에 쓰지 않으며 어떤 피드백 경로에도 들어가지 않는다.**
향후 N을 늘렸을 때의 기저선으로만 보관한다.

### 비교 기저선

bare 아암(taskops 없이 동일 프롬프트·동일 위생 컨테이너)에서 동일 산출물을 회수해 나란히 기록.
**단 N=1 스모크에서 lift를 주장하지 않는다.**

---

## 6. 측정 지표와 집계 방법 (사전 고정)

`runs/<runId>/events.jsonl`과 `runs/<runId>/nodes/`에서 집계한다.
이벤트 명은 `cli/lib-runner.js`에서 실측 확인한 것이다.

| 지표 | 집계 방법 |
|---|---|
| `decomposition_count` | `events.jsonl`의 `type === 'decomposition_started'` 개수 |
| `decomposition_completed` | `type === 'decomposition_completed'` 개수 |
| `decomposition_coverage_gap` | `type === 'decomposition_coverage_gap'` 개수 + coverageRatio |
| `exploration_count` | 런노드 파일 중 `type === 'exploration'` 개수 (`type === 'exploration_started'` 이벤트로 교차검증) |
| `surprise_count` | `type === 'high_surprise'` 개수 + 루트/자식 task의 `surpriseHistory` 길이 |
| `child_task_count` | `task-groups/*/versions/*/tasks/` 중 루트를 제외한 task 수 |
| `root_transition` | 루트 task 파일의 `uncertaintyState` / `runReadiness` / `runReadinessReason` 최종값 |
| `exploration_per_task` | task별 exploration 런노드 수 (최댓값이 2를 넘으면 루프) |
| `our_gate_pytest_rc` | §7 체크 (1)을 런 종료 후 독립 1회 실행한 rc |
| `our_gate_deliverables_ok` | §7 체크 (2)의 불리언 |

**`ale_events_report.mjs`는 스모크 직후 자동 실행한다.** SWE-bench 때 **사후에야** 이벤트 0을
발견한 실수를 구조적으로 막기 위함이다.

---

## 7. requiredChecks (2개, 전부 지시서 본문에 문자 그대로 적힌 것만)

상세 근거와 ALLOW/DENY 판별은 `CONTAMINATION.md`에 있다. 요약만 적는다.

1. `docker exec -u 1000 <container> /workspace/.venv/bin/pytest -q /workspace/testsuite` — exit 0.
   근거: instruction.md **26행** `## Required behavior` 1번.
   **`oracle:true`를 주지 않는다** — `oracle:true`는 "외부 오라클 소비"를 뜻하는데 이건 과제가 준
   내부 도구다.
2. `docker exec -u 1000 <container> python3 -c "<3종 존재 + json.load 파싱>"`.
   근거: instruction.md **32-42행**.
   **값 검증·임계값 비교는 하지 않는다** (채점기 로직 복제 회피).

**주의**: 루트는 explore→decompose 경로를 타고 자식으로 위임되므로 스스로 execute되지 않는다 →
루트의 requiredChecks가 실행되지 않을 수 있다. 분해 LLM이 자식 leaf에 checks를 전파하는지는
**미확인**이며 §8 위험 1·4다. 따라서 어댑터는 런 종료 후 (1)(2)를 **독립적으로 1회 실행해
기록**한다. 이는 우리 자체 게이트이며 ALE 점수와 무관하고, **런타임 게이트가 아니다.**

---

## 8. 사전 등록된 위험

1. **분해 LLM이 자식에 uncertainty 필드를 어떻게 채우는지 미확인.**
   자식이 전부 known/runnable로 나오면 2단계 이후 탐색이 죽는다. 다만 **루트 단독으로
   exploration·decomposition 각 1건이 보장되므로 주 성공 기준은 이 미확인에 의존하지 않는다.**
   스모크 최우선 확인 항목.
2. **maxSteps 과소 설정 재발.** 40으로 잡되 실제 소진 여부를 로그로 확인해야 한다.
3. **exploration 스텝 실패 시 루프.** `lib-runner.js:5148`의 fm 갱신 블록은 성공 경로에만 있다.
   → `continueOnFailure` + maxSteps 상한 + 동일 task 재탐색 2회 초과 감시를 어댑터에 둔다.
4. **requiredChecks가 실제로 실행되지 않을 가능성.** 루트가 분해로 닫히면 자체 checks가 돌지 않아
   taskops 내부 검증 게이트가 사실상 비고 false_completion 방어가 약해진다.
   사후 독립 실행으로 기록은 남지만 이는 런타임 게이트가 아니다.
5. **컨테이너 위생이 채점을 깨뜨릴 위험.** 채점기 자신이 sudo와 `--protected-root`를 전제한다
   (`needs_sudo()` / `sudo_bash()` 헬퍼). 채점 단계에서 root로 exec해야 하며, 이 복구가
   **에이전트 종료 이후에만** 일어나도록 순서를 강제해야 한다. 순서가 어긋나면 오염이 재발한다.
6. **호스트 자원.** 디스크 여유 **103GB**(실측). ALE 이미지 153GB는 이미 보유해 추가 pull 불필요.
   RAM 가용 ~20GB → 컨테이너 `--memory=6g --cpus=4`.
   **타 세션 컨테이너(`hive-app-1`, `hive-db-1`, `n8n-*`, `sweb.eval.astropy-*`)는 절대 불가침** —
   현재 `sweb.eval` 컨테이너가 돌고 있음을 실측 확인했다.
7. **N=1의 통계적 무의미.** 이 스모크는 **계측 배관이 작동하는지만** 본다.
   **lift·우열 주장 금지.** 본 실험은 full-spectrum ∩ docker 41개 대역에서 사전등록 후 진행한다.
8. **codex 위임 실패(실측).** 설계 단계와 구현 단계 모두 `codex exec`가 출력 0바이트로 정체해
   kill되었다(exit 144 / timeout 143). 따라서 판정·디스패치·탐색 핸들러 분석과 어댑터 구현은
   전부 직접 수행했고, 이 문서의 줄번호 인용은 전부 직접 확인한 것이다.

---

## 9. 이 스모크가 반증할 수 있는 것 / 없는 것

**반증할 수 있는 것**
- "taskops의 분해·탐색은 어떤 과제에서도 발동하지 않는다" → 주 기준 충족 시 반증됨.
- "unknown_unknown 시드는 무한 탐색 루프에 빠진다" → 부 기준 5로 검사됨.
- "오염 격리 절차가 실제로는 작동하지 않는다" → 부 기준 6으로 검사됨.

**반증할 수 없는 것 (주장 금지)**
- taskops가 ALE에서 bare보다 낫다/못하다 (N=1).
- taskops의 lift 크기.
- 이 과제 외 다른 55개 직종으로의 일반화.
