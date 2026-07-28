# stage-pro-haiku-lift — 사전등록: SWE-bench **Pro**에서 taskops가 Haiku 점수를 끌어올리는가

날짜: 2026-07-28 · 근거: Jimmy 요청(2026-07-25) "sw bench verified나 **pro**등 어려운 시험을 … 예전 model에서
점수를 최대한 올릴 수 있는지 bench돌려서 검증" + 방향 전환(2026-07-28) "외부에 haiku도 돌린 bench중에 **점수 낮은거** 대상으로".

## 0. 왜 Verified에서 Pro로 옮겼는가 (실측 근거)

`stage-haiku-lift`(Verified 30건 설계, 27 job 실행 후 중단)에서 **천장 효과**가 실측됐다:

| | 실측 |
|---|---|
| A (bare Haiku) | **12/13 = 92.3%** |
| C (taskops Haiku) | 11/13 = 84.6% |
| 불일치쌍 | b=1, c=0 → **n=1** (판정 불가) |

원인: 모집단을 "gpt-5.5 taskops가 푼 43건"으로 한정 → **정의상 풀 수 있는 문제만** 모였고, easy tercile부터
실행돼 A가 거의 다 풀었다. lift를 볼 헤드룸이 없다. 부분 결과는 `results/{verified-haiku,bare/verified-haiku}/`에
증거로 보존한다(그 자체가 발견: **Verified의 이 층은 Haiku에게도 쉽다**).

## 1. 새 대상: SWE-bench Pro (공개 Haiku 앵커가 낮은 벤치)

공개된 Haiku 4.5 점수 중 낮은 것을 골랐다:

| 벤치 | Haiku 4.5 공개 점수 | 우리 인프라 |
|---|---:|---|
| SWE-bench Verified | 73.3% | 있음 (천장 확인됨) |
| **SWE-bench Pro** | **39.5%** | **있음** (Docker 하니스 검증 완료) |
| Terminal-bench (Terminus-2) | ~40% | 없음(구축 비용 큼) |
| OSWorld | 50.7% | 없음(GUI/VM 필요) |

**Pro 선정 이유**: 공개 앵커 39.5% → **헤드룸 60%** · 하니스가 이미 검증됨(기존 6건 전부 정상 채점) ·
원 목표 문장에 "verified나 pro등"으로 명시 · 다언어(go/js/python)라 난이도가 실제로 높다.

## 2. 설계 — 페어드 2-arm

| arm | 구성 | taskops |
|---|---|---|
| **A (bare)** | `run_swebench_pro_bare.mjs` — 체크아웃 + **동일 task 텍스트**(issue + requirements + interface) 주고 DONE.txt 자기보고 | 없음 |
| **C (taskops)** | `run_swebench_pro.mjs` — acceptance(guarded) + requiredCheck(공식 하니스, oracle) + verify-retries=2 | 있음 |

동일 인스턴스 · 동일 모델(`claude-haiku-4-5-20251001`) · 동일 executor(claude-code + MCP-safe wrapper) →
**차이는 taskops 유무뿐**. 판정은 양쪽 다 Scale AI 공식 Pro Docker 하니스(sealed image) = 조작 불가.

> **공정성 주의**: A arm에 requirements/interface를 주는 것이 핵심이다. Pro 이슈는 의도적으로 underspecified라
> 이를 빼면 대조가 "taskops vs 나쁜 프롬프트"가 되어 lift가 부풀려진다.

## 3. 인스턴스 20건 — 결정론적 선정 (사후 조정 금지)

repo별 `instance_id` 정렬 후 **균등 간격 추출**(무작위 없음, 재현 가능). 언어 배분 python 12 / go 5 / js 3
(go·js는 우리 인프라에서 미검증이라 보수적으로 배분). repo 10종: ansible 4 · openlibrary 4 · qutebrowser 4 ·
flipt 2 · teleport/vuls/navidrome/webclients/element-web/NodeBB 각 1.

|P|≥20을 만족시키기 위한 최소 규모다.

## 4. 통계 (stage-haiku-lift와 동일 — `mcnemar.mjs`)

- 주지표 **lift = resolveRate_C − resolveRate_A**, 페어드 판정집합 P(양 arm 모두 boolean) 기준
- **exact McNemar**(불일치쌍 양측 이항검정). 연속성보정 χ²는 판정에 쓰지 않음(참고 병기만)
- 판정: `|P|<20` INSUFFICIENT / `p<0.05 ∧ c>b` **LIFT** / `p<0.05 ∧ b>c` DROP / `n≥6 ∧ p≥0.05` NULL / `n<6` INSUFFICIENT
- undetermined(인프라 실패, `grade_error`)는 **어느 arm에서도 실패로 세지 않고 분모 제외**

## 5. 단계

1. **스모크** (`stage-pro-haiku-smoke.json`): ansible 1(python, 검증된 repo) + flipt 1(**go, 미검증 언어**) × 2 arm.
   go 인프라(이미지 pull/entryscript)가 도는지 확인하는 것이 주목적.
2. **본 실행** (`stage-pro-haiku-lift.json`): 20건 × 2 arm = 40 job. 기존 Pro 실측 462s/건 기준 **6~10시간**
   (Haiku 속도와 이미지 pull에 따라 변동), 재개형.

## 6. 정직 고지

1. **공개 앵커 39.5%는 Scale의 scaffold에서 나온 값**이고 우리는 claude-code+taskops다. 우리 A arm이 39.5%와
   다르게 나오는 것은 정상이며, **판정은 오직 우리 A vs C 페어드 대조로만** 한다. 39.5%는 "헤드룸이 있다"는
   선정 근거일 뿐 비교 기준이 아니다.
2. **재시도 비대칭은 의도** — bare에는 재시도가 없다. 검증·재시도가 taskops의 기능이므로 lift에 포함되는 것이 맞다.
   순수 "재시도만의 효과"를 분리하려면 후속으로 A+retry arm이 필요하다.
3. go/js는 우리 인프라에서 처음 돌린다. 인프라 실패가 나면 undetermined로 빠지고 분모에서 제외되므로 |P|가
   20 미만으로 떨어질 수 있다 — 그 경우 판정은 **INSUFFICIENT**이며 표본을 늘려 재실행해야 한다.
4. Verified 실험에서 **C가 A보다 낮았던 관측**(11 vs 12)은 n=1이라 노이즈지만, Pro에서도 재현되면 taskops의
   verify-retry가 오히려 방해가 되는지 별도 조사가 필요하다.
