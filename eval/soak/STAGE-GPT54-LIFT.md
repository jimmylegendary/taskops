# stage-gpt54-lift — 사전등록: taskops가 **구형 모델**의 SWE-bench 점수를 끌어올리는가

날짜: 2026-07-28 · 근거 요청(Jimmy, 2026-07-25 03:24):
> "sw bench verified나 pro등 어려운 시험을 gpt 5.4와 같은 예전 model에서 점수를 최대한 올릴 수 있는지 bench돌려서 검증도 해줘야함"

## 0. 이 스테이지가 이전과 다른 점

`stage-verified500`은 bare를 **공개 앵커**(OpenAI 보고 gpt-5.5 88.7%)로 잡아 scaffold confound가 있었다
(공개 점수는 vendor harness, 우리는 codex CLI+taskops). 이번엔 **bare arm을 우리가 직접 돌린다**:

| arm | 구성 | taskops |
|---|---|---|
| **A (bare)** | codex-cli + **gpt-5.4**, 저장소 체크아웃 + 이슈만 주고 self-report | 없음 |
| **C (taskops)** | codex-cli + **gpt-5.4**, taskops 위임(acceptance/requiredChecks/verify-retries=2) | 있음 |

동일 인스턴스 · 동일 모델 · 동일 effort · 동일 executor → **차이는 taskops 유무뿐**. 이것이 순수 lift다.

## 1. 주 지표

- **lift = C.resolve율 − A.resolve율** (official SWE-bench Docker 하니스 판정, `official_resolved`)
- 페어드 설계이므로 **McNemar 검정**(같은 인스턴스에서 A는 실패·C는 성공한 쌍 b, 그 반대 c)
- 부 지표: false_completion(주장 vs 판정 불일치), undetermined(인프라 오류, **분모 제외**), wallclock, verify-retry 발동률

## 2. 모델·설정

- 네이티브 모델 **gpt-5.4** (`TASKOPS_CODEX_NATIVE_MODEL`; 구독 경로, per-token 과금 없음 — 호출 가능 확인 완료)
- effort **medium** 양 arm 동일 (공정성 우선; "최대한 올릴 수 있는지"는 taskops 게이트/재시도가 담당)
- 결과 격리: `TASKOPS_SWE_RESULT_TAG=gpt54` → `results/verified-gpt54/`, `results/bare/verified-gpt54/`
  (기존 gpt-5.5 결과 45개를 **덮어쓰지 않는다** — 어댑터에 이번에 추가한 기능)

## 3. 단계

| 단계 | 인스턴스 | job | 목적 |
|---|---|---:|---|
| **smoke** | django 4개 (gpt-5.5에서 전부 resolved, 195~214s) | 8 | 배관 검증 — gpt-5.4가 양 arm에서 실제로 돌고 채점되는가 |
| **main** | Verified 30~50 (astropy/django 혼합, gpt-5.5 기존 45개와 겹치게) | 60~100 | lift 실측 |

smoke가 통과해야 main으로 간다. main 규모는 smoke의 실측 pace로 확정한다.

## 4. 판정 규칙 (사전등록 — 사후 이동 금지)

- **LIFT**: C > A 이고 McNemar p < 0.05 → "taskops가 구형 모델 점수를 끌어올린다"
- **NULL**: 차이가 유의하지 않음 → "이 표본에서는 입증 실패"(효과 없음과 구별해 보고)
- **DROP**: C < A 이고 유의 → "이 구성에서는 taskops가 해가 된다"
- undetermined(인프라)는 **어느 arm에서도 실패로 세지 않고** 별도 보고한다.

## 5. 정직 고지

1. **천장 효과**: gpt-5.5 taskops는 45개 중 43(95.6%) resolved였다. gpt-5.4가 bare에서 이미 높으면 lift 여지가 작다.
   smoke 표본(django 빠른 4개)은 **쉬운 쪽으로 편향**돼 있어 lift 측정이 아니라 배관 검증용이다.
2. **재시도 비대칭은 의도**: bare에는 재시도가 없다. 재시도·검증은 taskops의 기능이므로 lift에 포함되는 것이 맞다.
   순수 "재시도만의 효과"를 분리하려면 후속으로 A+retry arm이 필요하다.
3. 3-way 비교(gpt-5.4 bare / gpt-5.4 taskops / gpt-5.5 taskops)는 인스턴스가 겹칠 때만 유효하며, gpt-5.5 결과는
   effort=high로 돌아 **effort가 다르다**. 모델 간 비교는 참고용으로만 쓴다.
