# Failure Certificate + Assurance Ledger — 사전등록 spec (v0)

날짜: 2026-07-19 · 상태: v0 구현 (F-1/F-4/F-5 + P0-1) → **v1 수정**: F-2 flaky-probe·F-3 minimal-repro 구현 → `verified_failure` 발급 개방 (positive-control은 bench측 유지, baseline differential 실행은 유예) + P0-2 budget vector(§1.5)·P0-3 oracle access(§5.5) 연동 · 승인: Jimmy ("승인함")

## 0. 북극성과 지표 세트 (anti-Goodhart)

TaskOps의 목표 = **"말한 완료가 진짜 완료인 비율"의 F1 최대화** (positive = 완료 주장).

| | judge PASS | judge FAIL |
|---|---|---|
| **claim done** | TP | FP |
| **claim fail** | FN | TN(scoped) |
| **undetermined** | (분모 제외) | (분모 제외) |

- precision = TP/(TP+FP), recall = TP/(TP+FN), F1 = 조화평균.
- **F1은 기권으로 게임된다** (어려운 케이스를 undetermined로 밀면 F1↑). 따라서 보고 지표는 항상 세트: **F1 + coverage(판정 낸 비율) + undetermined율 (+ $/판정)**.
- 구조: precision 다이얼 = done-게이트(기존 P1까지). recall 다이얼 = fail-검증기(이 spec) + escalation ladder. 두 다이얼은 같은 게이트로 trade-off되므로 fail-검증기는 done-게이트를 엄격하게 유지하기 위한 **counterweight**다.

## 1. "진짜 실패"의 3층 분해

| 층 | 의미 | 검증 가능성 |
|---|---|---|
| (a) 산출물 불만족 | 낸 결과물이 목표를 실제로 불만족 | 가능 — 단 verifier 오류(FN 최대원천) 배제 필요 |
| (b) 자원상대 불가 | 이 예산·resolver로 못 넘음 | fixpoint(attemptLedger)+ladder 소진이 약한 증명 |
| (c) 본질 불가 | 과제 자체가 불가능 | 주장하지 않는다 — **인증서 scope는 항상 `resource_relative`** |

인프라/프로토콜 오류(executor spawn/timeout, malformed marker, grader-throw)는 4분면 밖 **제3클래스 `undetermined`** — F1 분모에서 제외하고 재큐잉. (전례: eval의 grade-throw→null+grade_error 수정.)

### 1.5 예산 소진은 실패가 아니다 — P0-2 budget vector (v1)

- run-수준 budget vector = **wall-clock** (옵션 `maxWallClockMs` / env `TASKOPS_MAX_WALL_MS` fallback, 옵션 우선 — v1 구현) + **steps** (`maxSteps`, 기존 차원). 소진 = **스케줄링 정지** (stopReason `budget_exhausted` / `max_steps`), step-dispatch **사이**에서만 판정 — in-flight step은 항상 정상 종결 (no-kill; `--until` 절대-시각 deadline과 다른 계약, stopReason도 분리).
- **소진은 절대 task close가 아니다**: 남은 runnable task는 pending 그대로 — blocked 전이 0, failureCertificate 발급 0, task frontmatter 접촉 0. §1의 `undetermined` 제3클래스보다도 바깥이다: close 자체가 발생하지 않으므로 F1 분모에 아무것도 넣지 않는다. (정직 종결 ethos: 예산 소진·인프라 문제가 task 실패/성공을 조작하면 안 된다.)
- 표면화 3곳: events.jsonl `{type:'budget_exhausted', dimension:'wall_clock', elapsedMs, maxWallClockMs}` · run log 한 줄 · runTaskOps 반환값 `budgetExhausted`(항상 존재하는 boolean) + `maxWallClockMs`.
- 상세 spec: `docs/specs/budget-vector.md` · smoke: `cli/scripts/budget-vector.mjs` (T1–T5 — 1ms cap 정직성 불변식, env fallback, option-wins, pre-lock 검증).

## 2. 게이트 사다리 F-1 ~ F-5 (비용 오름차순; 강등 또는 보강만, 성공 발명 불가)

- **F-1 유형 triage (비용 0, v0 구현)** — blocked close를 타입화: `content`(check가 산출물을 거부) / `infra`(executor·adapter 실행 실패) / `protocol`(executor 출력이 runner 프로토콜 위반: malformed partial/surprise marker). infra·protocol → `undetermined`.
- **F-2 verifier 자기검증 (저비용, flaky probe 구현)** — flaky probe(동일 workspace K회 재실행, 흔들리면 check 격리+강등; §3.5) 구현. positive control(known-good 상태에서 check가 통과 가능한지)은 **bench측 유지** — `eval/adapters/lcb_positive_control.py`가 이미 그 역할이며, runner-측 probe로의 이식은 유예. baseline differential(변경 제거 상태에서 같은 시그니처로 실패하면 무관 check 의심)은 **증거-전용으로 확정 + 실행은 유예**: fix-task의 regression check는 baseline에서도 정당하게 실패하므로 같은-시그니처 baseline 실패는 check 무효의 증명이 아니다 — 강등 근거로 쓰지 않고, 구현 전까지 인증서에 `probes.baseline={skipped:'no_baseline_machinery'}`로 정직하게 기록한다 (현존 differential 기계는 quiz의 전체-workspace 복사에 결합되어 close 시점 재사용 불가).
- **F-3 실패 재현·국소화 (중비용, 구현)** — 실패 check를 동일 조건(cwd·sanitized env·timeout)에서 재실행해 마지막 재실행을 minimal repro로 캡처(command + exitCode + 정규화 출력의 sha256): 제3자가 반증 가능한 실패 = 실패측 EoW. 재현 안 되면(=flaky) repro 없이 강등.
- **F-4 자원상대성 스탬프 (비용 0, v0 구현)** — 인증서에 attempts·failureSignature·resolversTried(escalatedResolvers)·saturated 기록. **RUNG-1 delegation은 TN 검증기를 겸한다**: 타 resolver가 같은 시그니처로 fixpoint → 실패 주장 보강(합의), 성공 → FN을 TP로 전환(사다리가 짧았다는 학습).
- **F-2b 성공측 flaky 재확인 (저비용, 구현) — F-2의 대칭** — F-2가 실패(rejected) close에서 "실패가 재현되나"를 물었다면, F-2b는 **approved close에서 "통과가 재현되나"를 묻는다.** verify가 통과한 runner-실행 requiredCheck를 동일 조건(cwd·sanitized env·timeout, `isolate:true`)에서 K회 재실행 — **어느 rerun이든 FAIL하면 그 통과는 flaky oracle의 우연**(네트워크/타이밍 민감 test, 비결정 grader)이므로 command를 격리하고 **verified_done을 거부**, `kind:'oracle_flaky'` → tier `undetermined`로 close(F1 분모 밖). 모든 rerun 통과 = `stable`이면 통과 신뢰, verified_done 유지. **근거(실측)**: stage-3smoke에서 requests C-arm이 false_completion을 냄 — verify grade는 통과, 최종 grade는 실패(flaky test). approved close는 재시도가 없어 통과가 보이는 즉시 인증되므로, **이 재확인이 유일한 방어 창**이다. 비용: approved당 ≤2 command × K회 재실행(무거운 oracle이면 유의미 — oracle-only 제한은 최적화 여지). smoke: `cli/scripts/success-flaky-recheck.mjs` (T1-T4). 이벤트 `verify_pass_flaky`.
- **F-5 실패측 tier + audit 대칭 (v0 구현)** — 아래 §3, §4.

## 3. failureTier 사다리

```
undetermined  <  self_reported_failure  <  runner_rejected  <  verified_failure
(infra/protocol,   (verify 밖 / 증거-공백)   (verify-모드 runner    (F-2 stable ∧ F-3 repro —
 verifier-flake                            실행 check의 명시적    §3.5의 발급 조건 전부 충족
 강등 포함)                                 거부)                  시에만 발급)
```

- `content` + verifyMode + decision=`rejected`(failedChecks>0의 명시적 거부) → `runner_rejected` (probe 증거 없을 때의 상한).
- `content` + rejected + **saturated 최종 close + F-2 probe 전원 실패(stable) + F-3 minimal repro 캡처** → `verified_failure` (§3.5).
- `content` + rejected + F-2 probe에서 한 번이라도 통과(flaky) → **`undetermined`로 강등** + 해당 check 격리 (kind는 content 유지 — 의심 대상은 산출물이 아니라 verifier).
- `content` + 그 외(verify 밖, 또는 needs_verification=증거 공백) → `self_reported_failure` (probe는 self-report를 절대 승격시키지 않는다).
- `infra`/`protocol` → `undetermined` (kind가 항상 우선 — probe 증거로도 뒤집히지 않음).
- 사다리는 `buildFailureCertificate`에 중앙화: 발급 지점은 tier가 아니라 **증거**를 전달한다. probe는 runner-rejection을 강등/승격만 할 뿐, 없는 rejection을 발명하지 못한다.
- 저장 위치: task frontmatter `failureCertificate` (`schemaVersion: failure-certificate-v0` 유지 — 필드는 additive). 성공 종결·재개 시 삭제(잔존 금지; `quarantinedChecks` 포함).

### 3.5 F-2/F-3 probe (발급 조건·비용 상한·스키마)

- **발급 게이트**: `runnerRejected && saturated`인 **최종 close에서만** 실행 (verify_retry·rung-1 delegate·rung-2 decompose 분기는 close 전에 반환). `verifyRetries:0`의 rejected close는 saturated가 아니므로 probe 없이 `runner_rejected` 상한 유지 — 비용 상한 결정이며 smoke(P4)로 고정.
- **probe 대상**: 이번 run의 runner-authored `observed.checkResults` 중 failed인 command (review의 포맷된 failedChecks 문자열을 파싱하지 않는다). artifact/semantic/quiz-만의 rejection은 probe-가능 command가 0개 → probe 생략, tier는 `runner_rejected` 유지.
- **비용 상한**: 최대 2개 command × K=2 재실행, verify exec와 동일한 per-check timeout·cwd·sanitized env(`executeRequiredChecks isolate:true`) — 차이가 나면 그것은 harness 차이가 아니라 check의 불안정성이다.
- **판정**: 한 번이라도 통과한 command가 있으면 전체 verdict `flaky`(혼합 결과 포함 — 부분적으로 불안정한 rejection은 오염된 증거로 승격 불가, stable command의 repro도 폐기), 전원 실패면 `stable`.
- **minimalRepro** (stable일 때만, 첫 probed command의 마지막 재실행에서): `{command, exitCode, outputSha256, capturedAt}` — outputSha256 = stdout+stderr 결합에서 `\r` 제거 후 첫 4096자에 대한 full sha256 hex. timeout-kill이면 exitCode는 정직하게 null (코드 조작 금지). raw 출력 자체는 저장하지 않는다(sha만).
- **격리**: flaky command는 task frontmatter `quarantinedChecks`에 스탬프 — 이후 정직한 성공 close에서만 정리.
- **한계(문서화된 semantics)**: probe는 verify exec **이후의** 같은 workspace에서 돌므로 파일시스템 부작용(marker류)이 있는 check는 재실행에서 정당하게 통과 → flaky로 분류된다. 이것이 의도된 의미다(그 check는 자기 cwd에서 불안정) — `verified_failure`는 부작용-없는 check를 요구한다. workspace 복사로 "고치는" 것은 곧 우리가 유예한 baseline 기계이므로 v-this에서는 문서화로 답한다.
- **positive-control probe** (known-good 상태에서 check 통과 가능성): 이 단계 범위 밖, §7 유예 유지.

## 4. Audit 전파 (P0-1 — 이번 구현의 핵심)

원칙: **claimSafe 식은 건드리지 않고, issues가 단일 진실원** — tier 위반을 issue로 발행해 기존 `counts.error===0` 조건을 통해 전파한다.

- `self_verified_closure_present` (**error**) — self_verified 종결 위에서 완료 주장은 과잉주장(Arm-D self_ground_gap 구멍의 봉쇄). → **claimSafe 자동 false**.
- `blocked_without_failure_certificate` (**warning**) — 인증서 없는 blocked는 untyped 실패, 진짜 실패로 못 센다 (레거시 관용; 인증서 경로가 보편화되면 error로 승격).
- `undetermined_failures_present` (**info**) — 실패 원장 제외 + 재큐잉 대상 고지.
- 신규 필드 `audit.assurance`:
  - `floor` — done 종결들의 최저 tier (`verified`/`self_verified`/`self_reported` … , 종결 없음=`none`, 레거시 미스탬프=`unknown`; EoW의 P1 `assuranceTier`에서 집계, 약한 것 우선)
  - `externallySafe` — **순수 assurance 차원**(구조적 claimSafe와 직교): 모든 done 종결이 `verified`
  - `failureLedger` — `{ content, verifiedFailure, undetermined, uncertified }`. **content 정의 (F-2 이후)**: `kind==='content' && failureTier!=='undetermined'` — verifier-flake로 강등된 close는 진짜 content 실패로 세지 않는다 (probe 이전 인증서에는 no-op: kind=content ∧ tier=undetermined 조합이 존재하지 않았다). `content ≡ kind==='content'`를 가정하던 외부 소비자(§6 Melete write-gate 포함)는 flaky 강등이 생기는 순간 count가 달라진다 — 의도된 정직성 수정.

## 5. 벤치 측정 프로토콜

1. **claimed-fail 인스턴스에도 official judge를 최종 workspace에 실행** — judge pass ⇒ verdict-FN 확정(우리 verifier 오류의 골드 신호, F-2 학습 데이터); judge fail ⇒ content-failure 보강.
2. SWE-bench류는 gold patch 존재 = 전 인스턴스 solvable ⇒ (c)층 TN은 원리적으로 불성립. TN은 항상 **"자원상대 TN"으로 scoped 기록**.
3. 보고: 3×2 표 + F1 + coverage + undetermined율 + $/판정. verdict-FN(judge-pass)과 search-FN(타 arm/ladder가 해결)은 자동 분리.

### 5.5 Oracle access 층화 — P0-3 (측정 전용, v1)

- close마다 외부 oracle(공식 judge) **소비 타입**을 스탬프: `none`(oracle-플래그 check 없음) / `judge_once`(oracle 판정 소비, verify-retry 0회) / `interactive`(판정이 최소 1회 피드백됨). 도출 = `acceptance.requiredChecks[i].oracle === true` 존재 여부 + close 시점 `task.verifyAttempts` (`buildReviewReport`에서 — retry-state 정리는 close 이후라 값이 아직 살아있다). 층화 없이 합산하면 oracle 의존도가 은폐된다 — `judge_once` 성공과 `interactive` 성공은 다른 주장.
- 스탬프 위치: reviewReport `oracleAccess` → approvedReview가 운반 → **양쪽 EoW 스탬프 사이트 필수 동기** (fresh-EoW `lib-state-writer.js applyApprovedReviewToEow` + reviewTarget `lib-runner.js attachApprovedReviewToExistingEows`, 둘 다 guarded — 레거시 approvedReview가 값을 날조하지 않도록). FAIL 대칭 = `failureCertificate.oracleAccess` (**content close만** — infra/protocol은 판정에 도달한 적 없어 필드를 정직하게 생략, audit이 `unknown`으로 집계).
- Audit 표면: `audit.assurance.oracleAccess = {none, judge_once, interactive, unknown}` (done은 task-EoW에서 **최고 소비 우선** — 소비는 되돌릴 수 없음; blocked/failed는 인증서에서) + renderAuditText assurance 라인. **게이트 0**: issue 발행 없음, claimSafe 불변.
- 상세 spec: `docs/specs/oracle-access.md` · smoke: `cli/scripts/oracle-access.mjs` (TC1–TC8) · adapter 마킹: `eval/adapters/run_swebench.mjs` grader check `oracle: true`.

## 6. Melete 접점 (부정측 write-gate)

`runner_rejected` 이상만 "이 접근은 이 문맥에서 실패"라는 기록 가치가 있는 friction 지식이 되고, `undetermined`는 기억에 쓰면 안 되는 노이즈다.

## 7. v0 구현 범위 / 유예 / falsifier

- **v0**: F-1 triage(4개 close 지점), F-4 스탬프, F-5 tier + audit 전파(P0-1), 성공/재개 시 인증서 정리, smoke `scripts/failure-certificate.mjs` (T1–T7).
- **구현 (s1-budget·s2-oracle, v1)**: P0-2 budget vector wall-clock 차원(§1.5, 별도 spec `budget-vector.md`, smoke `budget-vector.mjs` T1–T5) + P0-3 oracle access 3-tier(§5.5, 별도 spec `oracle-access.md`, smoke `oracle-access.mjs` TC1–TC8).
- **구현 (s3-probes, v1)**: F-2 flaky probe(K=2 재실행 + flaky 강등/격리), F-3 minimal repro 캡처, `verified_failure` 발급(§3.5 게이트), failureLedger `verifiedFailure` + content 재정의, smoke `scripts/failure-probes.mjs` (P1–P5) + `failure-certificate.mjs` **T3 기대값 명시 변경**: 기대 tier `runner_rejected` → `verified_failure` — v0의 발급 상한이 걷히며 같은 시나리오(stable `exit 1` saturation)가 이제 상위 tier를 획득하는 spec-주도 변경. assertion 삭제 없이 강화만(probe verdict + repro 존재 추가); probe-없는 `runner_rejected` 상한은 T6·P4/P5가 계속 고정.
- **유예 (실제 잔여)**: F-2 positive-control의 runner-측 probe 이식(bench측 `lcb_positive_control.py`는 존재·유지), baseline differential 실행(증거-전용 원칙은 §2에 확정), budget vector의 token/cost 차원(`budget-vector.md` §5), decompose-경로 실패의 인증서화, blocked_without_failure_certificate의 error 승격, 24h 소크(비용 산출 보고 후 결정), hard-subset 4-arm 사전등록.
- **falsifier**: hard-subset 4-arm에서 (i) claimed-fail 중 judge-pass 비율(verdict-FN율)이 F-2 부재에도 이미 ~0이면 F-2의 우선순위 강등; (ii) runner_rejected 인증서의 judge-fail 일치율이 낮으면(≪90%) 이 tier 정의 자체를 재검토.
