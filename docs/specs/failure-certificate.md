# Failure Certificate + Assurance Ledger — 사전등록 spec (v0)

날짜: 2026-07-19 · 상태: v0 구현 (F-1/F-4/F-5 + P0-1), F-2/F-3 유예 · 승인: Jimmy ("승인함")

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

## 2. 게이트 사다리 F-1 ~ F-5 (비용 오름차순; 강등 또는 보강만, 성공 발명 불가)

- **F-1 유형 triage (비용 0, v0 구현)** — blocked close를 타입화: `content`(check가 산출물을 거부) / `infra`(executor·adapter 실행 실패) / `protocol`(executor 출력이 runner 프로토콜 위반: malformed partial/surprise marker). infra·protocol → `undetermined`.
- **F-2 verifier 자기검증 (저비용, 유예)** — flaky probe(동일 workspace K회 재실행, 흔들리면 check 격리+강등) · positive control(known-good 상태에서 check가 통과 가능한지; 전례 `eval/adapters/lcb_positive_control.py`) · baseline differential(변경 제거 상태에서 같은 시그니처로 실패하면 무관 check 의심 — quiz `differential:false`의 실패측 거울).
- **F-3 실패 재현·국소화 (중비용, 유예)** — check 출력에서 최소 실패 assertion 추출 후 단독 재실행. 재현되면 minimal repro를 인증서에 첨부(제3자가 반증 가능한 실패 = 실패측 EoW), 안 되면 강등.
- **F-4 자원상대성 스탬프 (비용 0, v0 구현)** — 인증서에 attempts·failureSignature·resolversTried(escalatedResolvers)·saturated 기록. **RUNG-1 delegation은 TN 검증기를 겸한다**: 타 resolver가 같은 시그니처로 fixpoint → 실패 주장 보강(합의), 성공 → FN을 TP로 전환(사다리가 짧았다는 학습).
- **F-5 실패측 tier + audit 대칭 (v0 구현)** — 아래 §3, §4.

## 3. failureTier 사다리

```
undetermined  <  self_reported_failure  <  runner_rejected  <  verified_failure
(infra/protocol)  (verify 밖 / 증거-공백)   (verify-모드 runner    (F-2 통과 ∧ F-3 재현 —
                                          실행 check의 명시적    v0에서는 발급 불가,
                                          거부, v0 상한)         F-2/F-3 구현 후 개방)
```

- `content` + verifyMode + decision=`rejected`(failedChecks>0의 명시적 거부) → `runner_rejected`.
- `content` + 그 외(verify 밖, 또는 needs_verification=증거 공백) → `self_reported_failure`.
- `infra`/`protocol` → `undetermined`.
- 저장 위치: task frontmatter `failureCertificate` (`schemaVersion: failure-certificate-v0`). 성공 종결·재개 시 삭제(잔존 금지).

## 4. Audit 전파 (P0-1 — 이번 구현의 핵심)

원칙: **claimSafe 식은 건드리지 않고, issues가 단일 진실원** — tier 위반을 issue로 발행해 기존 `counts.error===0` 조건을 통해 전파한다.

- `self_verified_closure_present` (**error**) — self_verified 종결 위에서 완료 주장은 과잉주장(Arm-D self_ground_gap 구멍의 봉쇄). → **claimSafe 자동 false**.
- `blocked_without_failure_certificate` (**warning**) — 인증서 없는 blocked는 untyped 실패, 진짜 실패로 못 센다 (레거시 관용; 인증서 경로가 보편화되면 error로 승격).
- `undetermined_failures_present` (**info**) — 실패 원장 제외 + 재큐잉 대상 고지.
- 신규 필드 `audit.assurance`:
  - `floor` — done 종결들의 최저 tier (`verified`/`self_verified`/`self_reported` … , 종결 없음=`none`, 레거시 미스탬프=`unknown`; EoW의 P1 `assuranceTier`에서 집계, 약한 것 우선)
  - `externallySafe` — **순수 assurance 차원**(구조적 claimSafe와 직교): 모든 done 종결이 `verified`
  - `failureLedger` — `{ content, undetermined, uncertified }`

## 5. 벤치 측정 프로토콜

1. **claimed-fail 인스턴스에도 official judge를 최종 workspace에 실행** — judge pass ⇒ verdict-FN 확정(우리 verifier 오류의 골드 신호, F-2 학습 데이터); judge fail ⇒ content-failure 보강.
2. SWE-bench류는 gold patch 존재 = 전 인스턴스 solvable ⇒ (c)층 TN은 원리적으로 불성립. TN은 항상 **"자원상대 TN"으로 scoped 기록**.
3. 보고: 3×2 표 + F1 + coverage + undetermined율 + $/판정. verdict-FN(judge-pass)과 search-FN(타 arm/ladder가 해결)은 자동 분리.

## 6. Melete 접점 (부정측 write-gate)

`runner_rejected` 이상만 "이 접근은 이 문맥에서 실패"라는 기록 가치가 있는 friction 지식이 되고, `undetermined`는 기억에 쓰면 안 되는 노이즈다.

## 7. v0 구현 범위 / 유예 / falsifier

- **v0 (이번 커밋)**: F-1 triage(4개 close 지점), F-4 스탬프, F-5 tier + audit 전파(P0-1), 성공/재개 시 인증서 정리, smoke `scripts/failure-certificate.mjs` (T1–T7).
- **유예**: F-2(flaky/positive-control/baseline), F-3(minimal repro), `verified_failure` 발급, decompose-경로 실패의 인증서화, blocked_without_failure_certificate의 error 승격.
- **falsifier**: hard-subset 4-arm에서 (i) claimed-fail 중 judge-pass 비율(verdict-FN율)이 F-2 부재에도 이미 ~0이면 F-2의 우선순위 강등; (ii) runner_rejected 인증서의 judge-fail 일치율이 낮으면(≪90%) 이 tier 정의 자체를 재검토.
