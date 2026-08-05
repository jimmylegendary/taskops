# 수렴 압력(convergence pressure) — 3축 × 2단계 게이트

## 왜 필요한가

taskops 는 "한 번 시킨 일을 24-48시간 끝까지 밀되, 정교하게 생각하도록 강제"하는 도구다.
그 강제의 핵심 루프는 넓은 level 분해 → readiness 판정 → 다음 행동 결정 → 모르면 exploration →
알아낸 것으로 계획을 바꿔가며 진행이다.

문제는 **이 루프에 발산 압력만 있고 수렴 압력이 없었다**는 것이다.

```
unknown_unknown → explore(발산) → known_unknown → decompose(발산) → 자식이 또 unknown → explore(발산) → …
```

execute 로 가는 유일한 문은 `uncertaintyState:'known'` + runnable contract 인데, **그 문으로 미는 힘이 없다.**

### 실측 (ALE `ranking_node_feature_parity_recovery`, full-spectrum tier, gpt-5.4/low, 31분)

| 지표 | 값 | 비고 |
| --- | --- | --- |
| decomposition | 5 | 핵심 기능이 처음으로 발동 |
| exploration | 5 | SWE-bench(전부 0)와 정면 대비 |
| surprise | 1 | |
| **execute** | **0** | 예산을 전부 계획에 소비, 산출물 0 |
| realizedDepth | 3+ | `expectedPlan.expectedDepth=2` 를 넘김 |
| 자식 requiredChecks 보유 | 0/17 | 실행할 이유조차 없음 |

이론 문서 `docs/theory/divergence-convergence-v0.md` 가 예측한 공백이 그대로 실측된 것이다:
objective U 는 수렴 target 이자 **발산을 유한히 가두는 울타리**이고, 순수 why(U≡const)면 평형이 없어 무한발산한다.

## 설계 — soft/hard 2단계, 점진적 문턱 상승

하드 컷오프만 쓰면 "탐색이 정말 필요한 순간"을 잘라버린다. 그래서 **예산이 줄수록 계획의 정당화 문턱을 점진적으로 올린다.**

### 3축 (OR 결합 — 어느 한 축이라도 hard 면 차단)

| 축 | 신호 | soft | hard |
| --- | --- | --- | --- |
| 예산 | `max(stepsRun/maxSteps, elapsedMs/maxWallClockMs)` | ≥ 0.50 | ≥ 0.75 |
| 깊이 | `realizedDepthBelow(task) - expectedPlan.expectedDepth` | ≥ 0 | > 0 |
| 발산잔여 | `openPlanDebt` (planDebt, debtRatio) | count ≥ 5 ∧ ratio ≥ 0.8 | 같은 조건이 **sustain(기본 3) 스텝 연속** |

> **발산잔여축의 hard 승격(4차 개정).** 이전 사양은 "영구 soft 전용"이었다. 3차 ALE 실측에서 debtRatio 가
> 첫 스텝부터 1.0 이었는데도 축이 hard 로 갈 수 없어 아무 일도 일어나지 않았고, soft 는 novelty(각 task 의
> 각 kind 는 첫 발산이 무조건 novel)로 매번 무력화되어 **발화만 하고 차단은 못 했다**. 그래서:
> - `critical`(count·ratio 동시 충족)이 **연속** `debt.sustain` 스텝 유지되면 hard 로 승격한다.
>   첫 평가는 절대 hard 가 아니다(soft 전 자유도 보존 — 초기 넓은 분해를 벌하지 않는다).
> - `critical` 이 깨지면 `criticalStreak` 은 즉시 0 으로 리셋된다(누적 처벌 금지). 압력을 푸는 유일한 방법은
>   실제로 실행 가능한 자식을 만드는 것이다.
> - **debt 단독 hard 는 런을 종료시키지 않는다.** 강제 실행 후보도 abandoned 부모도 없을 때, 발화 축이
>   `debt` 뿐이면 `convergence_blocked`(런 종료) 대신 `convergence_debt_hard_planning_continued` 를 남기고
>   계획을 통과시킨다. level 은 hard 그대로라 프롬프트가 hard 지시를 받고 분해 품질 게이트가 hard 로 걸린다.
>   여기서 런을 끝내면 3차 실측 그대로 execute=0 + 조기종료가 재현되기 때문이다. 무한 반복은 분해 품질
>   사다리(재분해 1회 → 부모 폴백 → 정직한 blocked)와 예산축이 막는다.
> - `executable` 의 정의는 **readiness runnable ∧ 검증가능 acceptance**(`isExecutableTask`)로, 강제 실행 후보
>   선정과 **같은 술어**를 쓴다. `blocked` task 는 debt 에 **포함**한다 — 제외하면 분해 LLM 이 blocked 자식만
>   양산할 때 부채가 오히려 내려가 잡아야 할 병리를 축이 못 본다.
> - 부채 수치(planDebt/blockedDebt/executable/debtRatio/criticalStreak)는 soft 를 novelty 로 통과한 경우에도
>   분해·탐색 프롬프트에 실린다(`미집행 계획 부채 실측` 블록) — 차단하지 않되 사실은 되돌려준다.

두 예산 차원이 모두 없으면 예산축 **비활성**(절대 미발화). `expectedPlan` 이 invalid/부재면 깊이축 **비활성** —
울타리 부재를 압력 0으로도 1로도 읽지 않는다(dark-room 가드).

> **깊이 신호의 차원 주의.** 신호는 *이 task 아래로 실제 만들어진 깊이* 대 *이 task 아래로 계획한 깊이*다.
> `computeExpectedPlanCoordinate.consumedDepth` 는 ancestorChain 길이 = task **위쪽**으로 이미 쓴 깊이라
> 차원이 다르다. 둘을 섞으면 fallback 으로 `expectedDepth=0` 을 받은 갓 태어난 자식이 첫 분해도 하기 전에
> `overrun = consumedDepth > 0` 으로 hard 가 되어 버린다(범주 오류 — 구현 중 실제로 이 함정에 빠져
> `uncertainty-lineage` 회귀로 잡혔다). `consumedDepth` 는 진단용으로만 스냅샷에 싣는다.

### 임계 기본값의 근거

- **budget.soft = 0.50** — 기존 `EXPECTED_PLAN_PHASE_THRESHOLDS.soft`(lib-runner.js)와 동일 값·동일 의미
  (절반 소진 = converging). 새 상수를 도입하지 않고 어휘를 재사용한다.
- **budget.hard = 0.75** — `FINISHING_MODE_RESERVE` 가 20%를 마감분으로 예약하므로, execute 1회 + verify 재시도가
  들어갈 여유를 남기려면 20% + 마진 ≈ 25%가 필요하다.
  기존 phase hard 0.85 를 쓰지 **않는** 이유: 0.85 는 프롬프트 조언만 바꾸는 값이라 실행 여유를 고려하지 않았다.
- **debt.count = 5** — 통상 분해 breadth(3~5)의 상한. "한 번의 분해분을 통째로 미집행"인 상태.
- **debt.ratio = 0.8** — 열린 항목 5개 중 1개도 증거를 만들 수 없는 상태.
  ALE 실측(자식 17개 전부 planning, executable 0 → planDebt=17, ratio=1.0)에서 확실히 발화한다.
- **debt.sustain = 3** — hard 승격까지 요구하는 연속 임계 초과 스텝 수. 1스텝 = 부채 관측,
  2스텝 = 부채 수치를 프롬프트로 되먹인 뒤 고칠 기회, 그래도 3스텝째면 hard.
  하한 1 강제(`0` 은 throw) — 첫 평가부터 hard 가 되면 soft 전 자유도 보존이 깨진다.
  env `TASKOPS_CONVERGENCE_DEBT_SUSTAIN`.

설정 우선순위: `options.convergence.*` > env(`TASKOPS_CONVERGENCE*`) > 기본값. 잘못된 값은 **lock 획득 전** throw.
모드는 `enforce`(기본) / `observe`(측정만) / `off`.

## soft 통과 조건 — novelty

**soft 는 "발산이 실제로 새 possibility mass 를 여는가"를 요구한다.**
게이트는 dispatch **전에** 결정하므로 예측이 아니라 **이력 기반**이어야 정직하다
(verify_retry 의 novel-extension 과 같은 구조).

`task.divergenceLedger[]`(상한 20 링버퍼)에 close 시점마다 `{kind, runNodeId, at, sigBefore, sigAfter, novel}` 를 스탬프한다.

- **explore** — 원소집합 = `unknowns` ∪ `knownList[*].id` ∪ `surpriseHistory[*].newUnknownIds/newKnownIds` ∪
  `uncertaintyState`. `novel = (sigAfter ≠ sigBefore) ∧ (sigAfter ∉ 과거 explore sigAfter 집합)`.
  → **직전과 같은 unknown 을 또 파면 거부.**
- **decompose** — 자식 union{`unknowns`, `uncertaintyState`, `acceptance.requiredChecks`} 에서 부모 대응 집합을
  뺀 차집합이 1개 이상이고, 자식집합 시그니처가 과거 decompose 엔트리와 다르면 novel.
  → **새 unknown 을 하나도 안 만든 분해는 거부.**
- 공통: 해당 kind 의 이력이 없으면 **항상 novel=true**(첫 발산은 언제나 통과).

세 novelty 술어(explore / decompose / `verify_retry`의 `isNovel`)는 **서로 다르다**.
재사용은 문자열 정규화 헬퍼 `canonicalStringSetSignature` 까지이며, `verify_retry` 의 history-wide 실패집합
동일성 정책은 **무변경**이다.

## hard 동작 — 계획 차단, 실행만

1. `next.kind` 가 이미 `execute` 이거나 `stop` 이면 무개입.
2. planning(decompose/explore/prototype)이면 `selectForcedExecutionCandidate` 로 "가장 준비된" task 를 고른다.
3. 후보가 있으면 `{kind:'execute', classification.source:'convergence_hard_forced'}` 로 재작성하고
   그 스텝에 한해 `verifyRequiredChecks=true` 를 **강제**한다.
4. 후보가 없으면 **정직하게 blocked**: `stopReason = convergence_blocked`.
   task 파일은 쓰지 않는다 → 남은 task 는 pending 으로 남고 closure 는 미완 → `all_closed` 오보가 불가능하다.

### 강제 runnable 자격 (전부 AND)

1. `status ∉ {done, cancelled, blocked}` ∧ taskPause 없음
2. `applyBlockerGate` 결과가 blocked 아님
3. 리프(자식 그룹 없음 또는 열린 자식 없음)
4. `uncertaintyState ∉ {unknown_unknown, unknown_known}`
   — **unknown_known 은 human pick quadrant 라 절대 강제 금지**
5. **`requiredChecks` 또는 `requiredArtifacts` 를 실제로 보유** ← 거짓 완료 방화벽
6. `needsManualReview !== true` ∧ `convergenceAcceptanceGap !== true` (층3 이 붙인 gap 자식 제외)
7. objective 및 completionCriteria/expectedResult 가 비어있지 않음

랭킹(결정적): policy-approving acceptance 우선 → requiredChecks 수 desc → known > known_unknown →
confidenceScore desc → consumedDepth desc(작은 스코프 우선) → order asc → id asc.

## acceptance 불변식 — 4겹

거짓 완료를 만들지 않는 것이 이 게이트의 최우선 제약이다. 보장은 4겹이다.

| 겹 | 내용 |
| --- | --- |
| **L1** | 게이트는 **스케줄 결정만** 바꾼다. execute 경로(`normalizeAcceptance` → `buildReviewReport` → requiredChecks 실행)는 한 줄도 안 건드린다. |
| **L2** | 자격 조건 5가 informational/빈 acceptance task 의 강제 실행 **자체를** 봉쇄한다. |
| **L3** | 강제 스텝은 `verifyRequiredChecks=true` 라 "policy-approving 인데 실행가능 체크 0개" 거부가 반드시 살아있다. |
| **L4** | 자기저작 체크는 여전히 `self_verified` 까지만 올라간다. |

결과적으로 강제 실행은 **실행을 시도하게 만들 뿐, 닫는 기준은 그대로**다.

게이트는 **task 파일을 절대 쓰지 않는다**(budget-vector 계약 유지).

## 층3 — 자식 실행가능성 계약

발산 사이클의 근본 기전은 자식 생성 시점에서 막는다(`normalizeChildConvergenceContracts`).

1. **expectedDepth 단조감소**: `child = min(선언값, parent-1)`, 하한 0.
   기존 `fallbackExpectedPlanForChild` 는 자식 plan 이 **invalid** 일 때만 발동해서, 자식이 유효한
   `expectedDepth=2` 를 다시 선언하면 그대로 통과했다 — ALE 에서 depth 가 3+ 로 자란 실제 기전이다.
2. **uncertaintyState 제한**: 부모가 `unknown_unknown` 이 아니고 자식이 `unknown_unknown` 을 선언했고
   자식이 blocked 가 아니면 `known_unknown` 으로 clamp + 사유 스탬프.
   배열 인덱스 순위 clamp 금지(→ `unknown_known` 으로 새는 것 방지). blocked 자식은 무변경.
3. **acceptance 전파**: 기본 `childAcceptancePropagation='mode'` — `acceptance.mode` 와 `expectedOutcome`
   기본값만 물려준다. **부모 `requiredChecks` 복사 금지** — 부모 체크는 부모 산출물/cwd 기준이라 리프에서
   필연 실패하고, 그러면 거짓 완료 대신 **거짓 실패**를 만든다. `'full'` 옵션값은 있으나 기본이 아니다.
4. **검증 불가 리프 플래그**: clamp 후 `expectedDepth==0` 인 non-terminal 자식이 `requiredChecks` ·
   `requiredArtifacts` 를 둘 다 안 가지면 `needsManualReview=true` + `convergenceAcceptanceGap=true` +
   `child_acceptance_gap` 이벤트. `status` 는 건드리지 않는다.
   0/17 결함을 "검증 가능한 자식만 강제 실행된다"로 바꾼다.

## 층1 — 깊이 울타리를 lib-runner 에서 강제하는 이유

`classifyTaskReadiness` 가 아니라 게이트에서 강제한다.

- `lib-progress-ledger` → `lib-taskops` import 가 이미 있어, classify 안에서 ledger 를 부르면 **순환 import**.
- uncertainty precedence 를 건드리면 `uncertainty-*` / `unknown-knowns` / `decomposition-depth-chain-recovery`
  회귀 범위가 넓다.
- 기존 `depth_contract`(lib-taskops.js:1687, `expectedDepth>=1 → needs_decomposition`)는 **분해 촉진기**로
  부호가 반대다. 승격 대상이 아니라 병치 대상이다.

실측으로 확인된 사실: **uncertainty 경로가 primary 라 `depth_contract` 는 애초에 잘 발화하지 않는다.**
울타리를 실제로 이기게 하려면 런루프 후처리에 두는 것이 맞다.

`pickNextAction` / `computeNextAction` / `explainWork` 는 무변경 — navigation 경로는 순수 선택기로 남는다.

## progress ledger LIMITATIONS 와의 관계

`cli/lib-progress-ledger.js` 의 LIMITATIONS 는 `openDiv` / `closedShare` / `kappaReabsorb` /
`confinementRatio` 의 **gate·reward 사용을 명시 금지**한다("reward/gate 절대 금지").

따라서 이 게이트는 **그 스칼라들을 읽지 않는다.** 대신 게이트 전용 지표 `openPlanDebt` 를 ledger **밖**
(`cli/lib-convergence.js`)에 새로 정의했다. ledger 출력 스키마와 LIMITATIONS 배열은 무변경이다.

ledger 에서 재사용하는 것은 **순수 구조 측정 함수 `realizedDepthBelow` 의 export 하나뿐**이다.
부수적 이점: `openPlanDebt` 는 O(T) 순수 계산이라 `progressLedger` 의 O(T²)+캐시 부재를 피한다.

> 소유자가 "진짜 P5 를 게이트로 쓰라"고 결정하면 LIMITATIONS 개정이 **별도로** 필요하다.

### 출처 오귀속 정정

"measurement-only / breach 는 pressure 이지 gate 아님"의 출처는 이론 문서가 아니라
`cli/lib-progress-ledger.js` 의 LIMITATIONS 주석이다. 그 주석 안의 라인참조도 stale 이어서 함께 고쳤다:
`lib-taskops.js:1401-1406` → `1682-1687`, `lib-runner.js:4027` → `4152-4154`.

## 관측

- 이벤트: `convergence_pressure`, `convergence_planning_blocked`, `convergence_forced_execute`,
  `convergence_planning_redirected`, `convergence_blocked_no_candidate`, `divergence_novelty`,
  `child_convergence_contract_normalized`, `child_acceptance_gap`
- `runResult.convergence = { mode, config, softFires, hardFires, forcedExecutes, blockedNoCandidate, axesSnapshotLast }` (additive)

## 알려진 한계

- **daemon 경로는 이 게이트만으로 안 고쳐진다.** `lib-queue.js` 가 먼저 target 을 고정하므로 hard 에서
  "다른 runnable task 로 갈아타기"가 불가능하고, target 모드에서는 후보가 그 task 하나로 제한돼
  `convergence_blocked` 가 잦아질 수 있다. queue readiness 필터의 gate-aware 확장은 후속 작업이다.
- exploration 산출물이 자유형 Markdown 이라 "남은 unknown 집합"을 직접 못 읽는다. 시그니처를 frontmatter 의
  구조화 필드로만 계산해 우회했다. marker 없는 exploration 이 frontmatter 를 전혀 안 바꾸면 novel=false 가 되어
  두 번째 explore 가 차단되는데, 이는 **의도된 동작**이다.
- `openPlanDebt` 는 매 스텝 `classifyTaskReadiness` 를 T회 호출한다(O(T)). 수백 task 규모에서는 메모이즈가 필요할 수 있다.
