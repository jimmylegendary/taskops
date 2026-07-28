# stage-haiku-lift — 사전등록: taskops가 **약한 모델**의 SWE-bench Verified 점수를 끌어올리는가

작성: 2026-07-28 · 상태: **사전등록(PRE-REGISTERED)** — 본실행 착수 전에 확정하며, 결과를 본 뒤에는 어떤 항목도 수정하지 않는다.

**수정 이력** (본실행 **착수 전** · 스모크 1건만 실행된 시점 · 가설/판정 규칙/인스턴스 선정은 **불변**):

| 일시 | 항목 | 내용 |
|---|---|---|
| 2026-07-28 | §6 단계 1·3 | 스모크 `perRunTimeoutMin` 17→**40분**, `globalWallMin` 36→**90분**. 사유: 17분이 A arm의 **코드 고정** 예산 35분보다 작아 "arm 내부 예산이 먼저 물린다" 원칙이 A에서 역전돼 있었다. |
| 2026-07-28 | §2 · §5 | 두 어댑터가 `claude_model` / `result_tag`(+ C arm `executor`)를 결과 JSON에 기록. 리포터가 스테이지 내 단일값 여부를 대조해 재개 실행 중 env 드리프트를 검출한다. |
| 2026-07-28 | §5 | 리포터에 **배제 arm 비대칭 경고**(표시 전용, 판정 규칙 불변) 추가. |
| 2026-07-28 | §4.2 | 참고 병기 Yates χ²에 `max(0,·)` 클램프(\|b−c\|≤1에서 대칭이 치우침보다 큰 값으로 찍히던 표시 결함). 판정에는 원래부터 미사용. |

근거 요청(Jimmy, 2026-07-25 03:24):
> "sw bench verified나 pro등 어려운 시험을 gpt 5.4와 같은 예전 model에서 점수를 최대한 올릴 수 있는지 bench돌려서 검증도 해줘야함"

## 0. 모델 대체 근거 (gpt-5.4 → Claude Haiku)

gpt-5.4는 codex 한도 소진(리셋 8/3)으로 이번 창에서 사용 불가하다. **실험 변수는 "특정 모델 gpt-5.4"가 아니라 "약한/저가
모델"** 이므로, 그 역할을 `claude-haiku-4-5-20251001`이 대신한다 (Jimmy 승인 2026-07-28). 이 대체는 가설을 바꾸지 않는다
— 바뀌는 것은 "약한 모델"의 구체적 인스턴스뿐이며, 결론 문장에는 반드시 실제로 쓴 모델 ID를 명시한다.

`stage-gpt54-*`는 폐기하지 않고 남겨두되, **기준선으로 인용하지 않는다**(§7-4 참조).

## 1. 가설

taskops의 acceptance / requiredChecks / verify-retries 게이트가 **약한(저가) 모델**의 SWE-bench Verified resolve율을
bare 대비 끌어올린다.

## 2. 설계 — 페어드 2-arm

동일 인스턴스 · 동일 모델 · 동일 executor(`claude-code`) · 동일 안전 래퍼 · concurrency 1. **차이는 taskops 유무뿐.**

| arm | 구성 | taskops | 재시도 | wall 예산 |
|---|---|---|---|---|
| **A (bare)** | `run_swebench_bare.mjs` — 체크아웃 + 이슈만 주고 self-report(`DONE.txt`) | 없음 | 없음 | 900s 단발(코드 고정) + 채점 |
| **C (taskops)** | `run_swebench.mjs` — taskops 위임, acceptance guarded + requiredChecks(공식 하니스, `oracle:true`) + `verifyRetries=2` | 있음 | 최대 8회 | `TASKOPS_MAX_WALL_MS`=45분 + 최종 재채점 |

판정은 양 arm 모두 **공식 SWE-bench Docker 하니스**(`swebench_grade.py`)가 한다 = 조작 불가 oracle. taskops 자체 게이트
통과 여부(`verified_done`)와 **독립적으로** 최종 워크스페이스를 재채점한다.

- 모델: `TASKOPS_CLAUDE_MODEL=claude-haiku-4-5-20251001`
- executor 문자열은 **정확히 `claude-code`** 여야 한다 — variant 접미사를 붙이면 어댑터의 `=== 'claude-code'` 비교가
  실패해 MCP-safe 래퍼가 주입되지 않고 nested-agent hang이 재현된다.
- 결과 격리: `TASKOPS_SWE_RESULT_TAG` → 본실행 `results/verified-haiku/` · `results/bare/verified-haiku/`,
  스모크 `results/verified-haiku-smoke/` · `results/bare/verified-haiku-smoke/`.
  기존 gpt-5.5 45건(`results/verified/`)과 gpt-5.4 4건(`results/verified-gpt54/`)은 **덮어쓰지 않는다.**
- **모델 기록 = 태그와 독립**: 태그는 config가 준 자유 문자열(디렉터리명)이라 스스로 오라벨링을 검출하지 못한다.
  두 어댑터가 결과 JSON에 `claude_model`(= 실행 시점 `TASKOPS_CLAUDE_MODEL`) · `result_tag` · `executor`를 함께 박고,
  `report-stage.mjs`의 **"실행 모델 감사" 섹션**이 두 가지를 대조한다:
  (a) 스테이지 내 단일값인가(2종 이상 → `models.drift_warning` — 본실행은 2~3회 재개로 나뉘어 돌기 때문에 이 대조가
  없으면 중간에 env가 달라져도 파일만으로는 검출되지 않는다), (b) 기록값이 **config가 선언한 `env.TASKOPS_CLAUDE_MODEL`
  과 같은가**(다르면 `models.mismatch_warning` — 단일값 검사만으로는 "전부 **일관되게 틀린** 모델로 돌았다"를 못 잡는다).
  `result_tag`도 같은 방식으로 대조한다. **주의: 스모크 2건(`*-haiku-smoke`)은 이 필드가 추가되기 전에 생성돼
  `claude_model`이 없다** — 스모크의 Haiku 출처는 여전히 config·코드 경로 추론일 뿐 파일이 증언하지 않는다.
  파일 자체가 증언하는 것은 **본실행부터**다.

## 3. 인스턴스 선정 규칙 (기계적 · 사후 조정 금지)

1. **모집단** = `eval/results/verified/` 45건 중 gpt-5.5 taskops가 `official_resolved=true`를 받은 **43건**.
   "강한 모델은 푼다"가 확인된 인스턴스여야 약한 모델의 실패를 *모델 능력* 신호로 읽을 수 있다.
   실측 제외 2건 = `django__django-10999`, `django__django-10097` (gpt-5.5도 실패 → 양 arm 바닥 확정, 페어드 정보량 0).
2. **초대형 패치 제외**: `diff_lines > 150` → `astropy__astropy-13398`(332줄, wall 1748s), `django__django-11138`(192줄).
   남은 모집단 **41건**.
3. **레포 내부에서** `wallclock_s` 3분위 층화. 전역 층화는 **금지** — 실측상 wallclock이 레포와 강하게 교락된다
   (django median 293s vs astropy median 653.5s). 전역 층화하면 사실상 "레포로 층화"가 된다.
4. 각 tercile 내부에서 wallclock **오름차순 상위 k건**(easy 7 / mid 5 / hard 3 — 레포별). 손으로 고르지 않는 순수
   기계 규칙이라 선정 편향 반론을 차단한다.
5. 레포 균형 **15:15** 고정. 실행 순서는 레포 교차 + 난이도 오름차순 (run-stage는 instance-major라 조기 중단해도
   레포·난이도 균형이 유지된다).

**최종 30건 (= `stage-haiku-lift.json`의 `instances` 순서)** — easy 14 · mid 10 · hard 6:

| # | 인스턴스 | 층 | | # | 인스턴스 | 층 |
|---:|---|---|---|---:|---|---|
| 1 | django__django-11179 | easy(PILOT) | | 16 | astropy__astropy-14096 | mid |
| 2 | astropy__astropy-7336 | easy(PILOT) | | 17 | django__django-11099 | mid |
| 3 | django__django-11119 | easy(PILOT) | | 18 | astropy__astropy-12907 | mid |
| 4 | astropy__astropy-7166 | easy(PILOT) | | 19 | django__django-11239 | mid |
| 5 | django__django-11066 | easy(PILOT) | | 20 | astropy__astropy-13236 | mid |
| 6 | astropy__astropy-14309 | easy(PILOT) | | 21 | django__django-11087 | mid |
| 7 | django__django-11133 | easy | | 22 | astropy__astropy-14508 | mid |
| 8 | astropy__astropy-7671 | easy | | 23 | django__django-11206 | mid |
| 9 | django__django-11163 | easy | | 24 | astropy__astropy-14598 | mid |
| 10 | astropy__astropy-14365 | easy | | 25 | django__django-11149 | hard |
| 11 | django__django-11276 | easy | | 26 | astropy__astropy-13033 | hard |
| 12 | astropy__astropy-14995 | easy | | 27 | django__django-11292 | hard |
| 13 | django__django-10880 | easy | | 28 | astropy__astropy-14182 | hard |
| 14 | astropy__astropy-14539 | easy | | 29 | django__django-11095 | hard |
| 15 | django__django-10973 | mid | | 30 | astropy__astropy-13977 | hard |

**난이도 프록시 주의**: `wallclock_s`는 gpt-5.5 taskops 실행에서 나온 값이라 "인스턴스 고유 난이도"가 아니라 "그 실행의
난이도"다(캐시·Docker 워밍업·모델 변동 포함). **층화 변수로 쓰는 것은 정당하나 "난이도 점수"로 인용하면 과대해석이다.**

## 4. 주지표와 검정

### 4.1 주지표

- **페어드 공통 판정집합** `P` = {양 arm 모두 `official_resolved`가 boolean인 인스턴스}
- `resolveRate_X` = |{i∈P : judge_X(i)=true}| / |P|
- **lift = resolveRate_C − resolveRate_A** (P 기준)
- arm별 decided 분모가 서로 다를 수 있으므로 **arm별 resolve율(분모=그 arm의 decided)과 페어드 resolve율(분모=|P|)을
  리포트에 함께 명시**한다.
- 부지표: `false_completion`(현행 G1), undetermined율, arm별 wallclock 합, **C arm `verify_retry_count`**(게이트 실제
  발동 횟수 — 이번에 신규 계측).

### 4.2 검정 — exact McNemar

**연속성보정 카이제곱은 쓰지 않는다(사전등록 결정).** N=30에서 기대 불일치쌍 n은 대략 5~12로 정규근사가 요구하는
b+c≥25에 한참 못 미치고, Yates 보정도 n<10 구간에서는 불안정하다. 정확검정은 모든 n에서 타당하고 보정이 필요 없다.
χ² 값은 참고용으로 리포트에 병기하되 **판정에는 절대 쓰지 않는다.**

```
b = |{i∈P : judge_A(i)=true  ∧ judge_C(i)=false}|   (A만 성공)
c = |{i∈P : judge_A(i)=false ∧ judge_C(i)=true }|   (C만 성공)
n = b + c
H0: 불일치쌍이 C쪽일 확률 = 0.5,  즉 c ~ Binomial(n, 0.5)
양측 p = min(1, 2 · Σ_{k=0}^{min(b,c)} C(n,k) · 0.5^n)
n = 0 이면 p = 1 (효과 추정 불가로 별도 표기)
lift = (c − b) / |P|      ← resolveRate_C − resolveRate_A 와 대수적으로 동일
```

효과크기 CI(부지표): π = c/n 에 대한 Clopper–Pearson 95% 구간을 lift 스케일로 사상 — `lift = n(2π − 1)/|P|`.
**n을 고정한 조건부 구간**이며 n 자체가 확률변수이므로 **무조건부 커버리지는 95%가 아니다.** 스테이지 간 교차비교는
SUMMARY.json으로 하도록 설계돼 있으므로 키 이름 자체에 조건부성을 박았다: `paired.lift_ci95_conditional_on_n`
(+ `paired.ci_method`). 무단서 `lift_ci95` 키는 쓰지 않는다.

χ² 참고값에는 `max(0, |b−c| − 1)` 클램프가 걸려 있다. 클램프가 없으면 |b−c| ≤ 1 구간에서 (|b−c|−1)² 이 되살아나
**b=c=5(완전대칭)가 0.100, b=6·c=5(1쌍 치우침)가 0.000** 으로 뒤집혀 찍힌다. 판정에는 원래부터 미사용이지만 REPORT.md
독자가 오해할 수 있으므로 표시 자체를 고쳤다.

**SUMMARY.json 규약**: `JSON.stringify`가 NaN/Infinity를 조용히 `null`로 바꾸므로(실측: n=0인 스모크의
`chi2_yates_reference_only`) 기계 소비자가 "계산 불가"와 "필드 없음"을 구분할 수 없다. → 비유한값은 `null`로 두되
**그 경로를 최상위 `nonFinite` 배열에 열거**한다. `nonFinite`에 있는 null = 계산 불가, 없는 null = 값 없음
(`conventions` 필드에 영문으로도 명시).

구현: `eval/soak/mcnemar.mjs` (부작용 없는 순수 모듈) · 검증: `node eval/soak/test-mcnemar.mjs`.

### 4.3 판정 규칙 (이 순서대로 평가 · 사후 이동 금지)

1. `|P| < 20` → **INSUFFICIENT** (페어드 표본 부족 — 재실행/확장 필요)
2. `p < 0.05 ∧ c > b` → **LIFT** (taskops가 약한 모델의 resolve율을 끌어올린다)
3. `p < 0.05 ∧ b > c` → **DROP** (이 구성에서 taskops는 해가 된다)
4. `p ≥ 0.05 ∧ n ≥ 6` → **NULL** (이 표본에서 효과 미검출 — "효과 없음"과 **구별해** 보고)
5. `p ≥ 0.05 ∧ n < 6` → **INSUFFICIENT** (불일치쌍 부족, 검정력 0)

**소표본 취급**: n < 6이면 α=0.05에서 기각이 *수학적으로 불가능*하다(최소 p = 2·0.5ⁿ ≥ 0.0625). 따라서 n<6인 비유의
결과를 "NULL(효과 없음 미검출)"로 부르는 것을 금지한다. 리포트에는 b, c, n, |P|, arm별 decided를 **항상 함께** 출력해
"효과 없음"과 "표본 부족"이 혼동되지 않게 한다.

**검정력 감각**: n=30 페어에서 α=0.05로 기각하려면 불일치쌍이 최소 6쌍(b=0,c=6 → p=0.03125) 필요하고, 안정적으로는
8~10쌍이 있어야 한다. 불일치쌍은 A arm 성공률이 30~50% 구간일 때 최대가 된다.

## 5. undetermined 3중 규칙

1. **[판정 불가]** `official_resolved`가 boolean이 아님 — null(`grade_error` / `GRADE_INFRA_ERROR`), 결과 파일 부재,
   JSON 파싱 실패.
2. **[무효 실행 = invalid_run]** `wallclock_s < 60초`. **양 arm 동일 임계값**(`invalidRunMaxWallS: 60`, arm별 특례 없음
   → taskops 유리 방향 조작 불가). 근거: 이 인스턴스 집합에서 가장 강한 모델(gpt-5.5)의 최소 실행이 195초였고,
   `wallclock_s`는 양 어댑터 모두 최종 Docker 채점까지 포함한 값이라 60초 미만은 에이전트가 실제로 붙지 못한
   인프라·레이트리밋 실패다. 실측 근거: gpt-5.4 스모크 4건 중 3건이 `taskops_status='blocked'` + wall 6/6/31초였고,
   그중 django-11133은 `official_resolved=false`까지 받았다 — 이걸 taskops 실패로 세면 인프라 장애가 가설 검정을
   오염시킨다.
3. **[페어드 배제]** 한쪽 arm이라도 undetermined면 그 인스턴스는 **P에서 통째로 제외**한다. 절대 "실패"로 대체하지 않는다.

**배제의 arm 비대칭 = MNAR 위험(반드시 확인)**: C arm은 wall 예산이 크고 verify 재시도가 있어 미완주가 A보다 잦을
*구조적* 이유가 있다. 그런 인스턴스가 통째로 |P|에서 빠지면 배제가 무작위가 아니어서(MNAR) 페어드 추정치가 편향된다.
`report-stage.mjs`는 페어드 섹션에 **배제 분해(A만 배제 k건 / C만 배제 m건 / 양쪽 배제)** 를 출력하고
`|k−m| > 0.1·|P|` 이면 경고 한 줄을 찍는다(SUMMARY.json `paired.exclusions.asymmetry_warning`).
**이 경고는 표시 전용이며 §4.3 판정 규칙을 바꾸지 않는다** — 경고가 뜨면 사람이 사유를 읽고 결론 문장에 명시한다.

`invalidRunMaxWallS`의 코드 기본값은 **0(비활성)** 이다 — `stage-lcb` 같은 짧은 벤치의 과거 리포트를 재생성해도 결과가
바뀌지 않는다. Haiku config에서만 60으로 켠다.

undetermined 발생 시: `maxAttemptsPerJob=2`로 1회 자동 재시도되며, 재시도 후에도 undetermined면 리포트의
"undetermined / 오류 상세" 섹션에 사유와 함께 나열하고 분석에서 제외한다.

## 6. 단계와 정지 규칙

### 단계 0 — 무쿼터 채점 검증 (본실행 전 필수 게이트)

Claude 호출 0회로 P0 수정을 증명한다. Lite에 **없는** Verified 인스턴스를 base_commit 그대로(빈 diff) 체크아웃한 뒤:

```
cd /home/jimmy/repos/taskops/eval
.venv/bin/python adapters/swebench_grade.py django__django-11066 <clean-checkout> princeton-nlp/SWE-bench_Verified; echo exit=$?
```

**기대: `exit=1` + stdout에 `"resolved": false`** (= 진짜 판정). `exit=2` + `GRADE_INFRA_ERROR`면 수정이 불충분하므로
**본실행 금지**. 비용 = 이미지 1개 pull + Docker 시간, Claude 쿼터 0.

### 단계 1 — 스모크

`stage-haiku-smoke.json` · `django__django-11179` 1건 × 2 arm (= 2 job) · 드라이버 상한 `perRunTimeoutMin=40` ·
`globalWallMin=90`(= A 40 + C 40 + 여유). **실측 소요는 A 5.5분 + C 4.75분 = 총 10.3분**이며, 이 상한들은 목표가 아니라
"드라이버 kill이 arm 내부 예산보다 먼저 물리지 않게" 두는 천장이다(§6 단계 3 타임아웃 계층 참조).
선정 근거: (a) 이미지 로컬 보유(`swebench/sweb.eval.x86_64.django_1776_django-11179:latest`), (b) gpt-5.5 taskops
최단 실행(wall 195s, diff 48줄), (c) gpt-5.4 bare에서도 250s에 resolved, (d) Lite∩Verified 교집합에 포함돼 dataset 인자
버그가 남아 있어도 채점이 되므로 배관 검증이 채점 실패에 가려지지 않는다.

**합격 기준 5개 — 하나라도 실패하면 본실행 금지:**
1. 양 arm 결과 JSON이 태그 경로(`*-haiku-smoke`)에 생성된다.
2. `official_resolved`가 true/false 중 하나다(null 아님).
3. **A arm `wallclock_s` ≥ 60s 이고 `diff_files` > 0** — 과거 bare Lite 38건 중 12건 이상이 13~33초 + `diff_files`
   0/4 고정으로 "무시도 종료"했던 하니스 결함의 재발 여부를 여기서 잡는다.
4. C arm `taskops_status`가 `blocked`가 아니다(= Haiku 접속·한도 정상).
5. `report-stage`가 resolve율 열 + 페어드 McNemar 섹션을 출력한다.

### 단계 2 — PILOT GATE (본실행 1~6번 완료 시점, 사전등록 정지 규칙)

`cd eval/soak && node report-stage.mjs --config stage-haiku-lift.json` (순수 파일 재집계 — 벤치 재실행 0, 쿼터 0)로
A arm resolve율을 확인한다.

- A가 6건 중 **0건** resolved → **FLOOR 판정: 즉시 중단.** 인스턴스 세트를 SWE-bench Lite 쉬운 층으로 재선정한다
  (쿼터 낭비 방지).
- A가 **1~5건** → 계속.
- A가 **6/6** → easy 층 천장이므로 계속하되 최종 리포트에 **CEILING-LIMITED**를 명기하고, 전체 A arm resolve율이
  85%를 넘으면 결론을 "lift 여지 부족"으로 강등한다.

### 단계 3 — 본실행

`stage-haiku-lift.json` · 30건 × 2 arm = 60 job · concurrency 1 · `globalWallMin=720` → 2~3회 재개 실행
(run-stage는 resumable: 같은 명령을 다시 실행하면 exit-0 job은 건너뛴다).

실행은 **반드시 `eval/soak`에서 basename으로**:
```
cd /home/jimmy/repos/taskops/eval/soak && node run-stage.mjs --config stage-haiku-lift.json
```
(`join(here, ...)` 해석 때문에 repo 루트에서 `--config eval/soak/x.json`을 주면 `eval/soak/eval/soak/x.json`을 찾아 실패한다.)

**타임아웃 계층**: 1차 제어는 arm 내부 예산, 2차가 드라이버 `perRunTimeoutMin`(SIGTERM→30초 후 SIGKILL).
**드라이버 kill은 결과 JSON을 남기지 않아 undetermined가 되므로 arm 내부 예산이 반드시 먼저 물려야 한다.**

| arm | 내부 예산 | 성질 |
|---|---|---|
| **A** | 900s 에이전트(`run_swebench_bare.mjs:46`) + 1200s 채점(같은 파일 `timeout`) = **35분** | **코드 고정 하드 상한**. 조절하는 env가 없다 — `TASKOPS_MAX_WALL_MS`는 C arm 전용이라 A는 무시한다. |
| **C** | `TASKOPS_MAX_WALL_MS`(스모크 13분 / 본실행 45분) + 최종 재채점 | **소프트 상한**. `cli/lib-runner.js:6054`의 검사는 스텝 스케줄링 사이에서만 일어나고("in-flight work already completed normally"), `run_swebench.mjs`의 최종 재채점 `execFileSync`에는 자체 timeout이 없다. 즉 하드 천장이 아니다. |

- **스모크**: `perRunTimeoutMin=40 > A 35분` ✅ (수정 전 17분은 A의 35분보다 **작아** 부등식이 역전돼 있었다 —
  Haiku가 에이전트 예산 15분을 다 쓰면 Docker 채점 도중 드라이버가 kill → 결과 파일 없음 → `maxAttemptsPerJob=1`이라
  재시도도 없음 → 배관 결함이 아닌 이유로 스모크 합격기준 1·2가 실패하고 "본실행 금지"가 잘못 발동한다. 이번 실행은
  A가 5.5분에 끝나 발동하지 않았다.)
- **본실행**: `perRunTimeoutMin=60 > A 35분` ✅. **C는 부등식이 보장되지 않는다** — 45분 소프트 캡 + in-flight 스텝
  초과 + timeout 없는 최종 재채점이 60분을 넘길 수 있다. 사전등록 config는 그대로 두되(설계 변경은 소유자 판단),
  이 잔여 위험을 여기 명시한다. 발생하면 그 인스턴스는 C arm `not_run`/undetermined가 되어 §5-3에 따라 페어드에서
  통째로 배제되며, **배제가 C쪽에 몰리는지는 `report-stage.mjs`의 "배제 분해 + arm 비대칭 경고"가 표시한다**
  (경고는 표시 전용 — 판정 규칙은 바뀌지 않는다).

## 7. 정직 고지 (결과와 무관하게 리포트에 포함)

1. **시간·호출 예산 비대칭 — 인과 귀속의 한계.** A는 에이전트 호출 1회 15분, C는 최대 45분 wall에 verify 재시도 최대
   8회(`verifyRetries=2` + `VERIFY_NOVEL_EXTENSION=6`). 재시도·검증은 taskops의 기능이므로 lift에 포함하는 것이 맞지만,
   **wall-clock까지 비대칭**이라는 사실은 인과 귀속을 제한한다. 관측된 lift에는 "검증 게이트 효과"와 "더 많은 시간·모델
   호출" 효과가 분리 불가능하게 섞여 있다. 분리하려면 후속 **B arm(bare + 동일 wall 예산 + self-retry N회, 게이트 없음)**
   이 필요하다 — 이번 범위 밖. 사전등록에 고지하는 것으로 정직성은 확보되지만 **인과 귀속은 확보되지 않는다.**
2. **선정 조건부성.** 모집단은 "gpt-5.5 taskops가 푼 43건"이다. 정당한 설계지만 동시에 "강한 모델이 푸는 문제로만
   구성된 세트"라는 뜻이며, **일반 SWE-bench Verified로 일반화하면 안 된다.** 이 조건부성을 결론 문장 자체에 박는다.
3. **외적 타당성.** astropy·django 두 파이썬 라이브러리 레포뿐이다. matplotlib/xarray/sklearn 등은 taskops 기준선이 없다.
4. **gpt-5.4 파일럿(`results/verified-gpt54/` 4건)은 기준선으로 인용하지 않는다** — 3/4가 `taskops_status=blocked`
   (wall 6/6/31초)인 인프라 실패 기록이지 약한 모델 신호가 아니다. 이 4건의 유일한 가치는 2-arm 배관이 한 번 관통됐다는
   사실뿐이다.
5. **채점 인프라 결함이 이번에 수정된 상태로 실행한다.** 최종 재채점이 `dataset` 인자를 넘기지 않아 Lite에 없는 Verified
   인스턴스가 undetermined로 떨어지던 결함(양 어댑터)을 수정했다. **gpt-5.5 45건 중 35건은 이 결함 때문에 사후
   `regrade-from-preds.py`로 복구된 결과**임을 명시한다.
6. **undetermined는 어느 arm에서도 실패로 세지 않는다.** 한쪽이라도 undetermined면 그 인스턴스는 페어드 분모에서
   통째로 제외하고 사유와 함께 별도 보고한다.
7. **Haiku의 SWE-bench Verified 절대 성공률은 이 저장소에 실측이 전혀 없다.** 사전분포 추정치를 쓰지 않으며,
   PILOT GATE가 추정을 대체한다.
8. **환경 드리프트.** 안전 래퍼가 하드코딩한 `/home/jimmy/.local/bin/claude`는 심링크(현재 versions/2.1.220)라
   claude 자동 업데이트가 걸리면 벤치 도중 스캐폴드가 바뀔 수 있다(모델 ID는 고정되지만 CLI 동작은 변한다).
   완화: 본실행 **시작·종료 시 `claude --version`을 기록**해 드리프트를 사후 검출한다.
9. **C arm의 `blocked`와 "게이트 때문에 실패"는 결과 JSON만으로 구분되지 않는다.** invalid_run 60초 규칙이 명백한
   접속 실패는 걸러내지만, 예컨대 90초짜리 blocked는 규칙을 통과해 taskops 실패로 집계된다. 리포트의 `taskops_status`
   분포를 사람이 직접 확인해야 한다.

## 8. 가드레일

- **쿼터**: A·C 양 arm 모두 `claude-code` executor라 대화 세션과 **동일한 Claude 한도**를 먹는다. 본실행 30건×2 arm =
  최소 60회 호출, C arm 재시도까지 더하면 100회 이상. → concurrency=1 고정, 스모크는 1회만, 본실행은 대화 세션이
  유휴일 때 백그라운드로. `haltOnConsecutiveFailures=3`으로 레이트리밋 벽에 빠르게 멈춘다.
- **절대 건드리지 않는 기존 경로**: `results/verified/`(gpt-5.5 45건 — 이 실험의 층화 근거이자 유일한 신뢰 소스),
  `results/verified-gpt54/`, `results/bare/verified/`, `results/bare/verified-gpt54/`, `results/verified-legacy-0709/`.
  (run-stage가 실행 전 `<stage>/prior-backup/`으로 자동 백업하지만, 이건 안전망이지 설계가 아니다.)
- **환경변수 함정 3종**: (1) `TASKOPS_SWE_EXECUTOR`는 정확히 `claude-code`. (2) `TASKOPS_CLAUDE_BIN`을 config에 넣지
  말 것 — 두 어댑터가 무조건 래퍼 경로로 덮어쓰므로 적어두면 "다른 바이너리를 지정했다"고 착각하게 된다.
  (3) `TASKOPS_CODEX_NATIVE_MODEL`/`TASKOPS_CODEX_EFFORT`는 넣지 않는다 — claude 경로에서 무시되지만 사전등록과
  불일치를 만든다.
- **Docker 위생**: `postJobCleanup`을 **C arm 결과 파일 존재로 가드**해 인스턴스당 1회만 발동시킨다(run-stage는
  instance-major라 A→C 순서이고, 가드 없이는 A 직후에도 삭제돼 C가 이미지를 재다운로드한다). swebench는 Docker Hub의
  `swebench/` 네임스페이스 이미지를 pull하므로 **접두사 없는 이름만 지우는 기존 cleanup 문자열은 no-op이었다** —
  새 cleanup은 두 형태를 모두 지운다. `rmi` 대상은 `sweb.eval.x86_64.*`로만 한정되며, **다른 세션의 컨테이너
  (hive-app-1, hive-db-1, n8n-n8n-1, n8n-traefik-1)는 절대 건드리지 않는다.**
  인스턴스 이미지 실측 3.94GB(공유 1.11GB). 소유자가 재다운로드 시간을 피하고 싶으면 `postJobCleanup`을 `""`로 비우고
  실행 종료 후 일괄 정리하면 된다.
- **arm key 고정**: taskops arm = `'C'`, bare arm = `'A'`. `report-stage.mjs`의 G1 게이트가 `armStats.C?.FP`로
  하드코딩돼 있어 다른 키를 쓰면 optional chaining 때문에 게이트가 **조용히 PASS** 처리된다(침묵 실패).
