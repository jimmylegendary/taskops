# Oracle Access 3-tier — 측정 spec (v0)

날짜: 2026-07-19 · 상태: v0 구현 (P0-3 — 측정 우선, 게이트 없음) · smoke: `cli/scripts/oracle-access.mjs` (TC1–TC8)

## 0. 목적

"외부 oracle(공식 judge)을 얼마나 소비했나"를 **close마다 타입으로** 남겨, 벤치 결과를 oracle-접근 수준별로 층화한다. 예: SWE-bench C-arm에서 `interactive` 성공(judge 피드백을 받아 고친 성공)과 `judge_once` 성공(단발 판정 성공)은 다른 주장이다 — 층화 없이 합산하면 oracle 의존도가 은폐된다.

**측정 전용**: 어떤 issue도 발행하지 않고, claimSafe 식은 건드리지 않는다 (issues = 단일 진실원 원칙은 그대로 — 이 필드는 issue가 아니므로 게이트에 아예 진입하지 않는다).

## 1. 선언과 도출

- 선언: `acceptance.requiredChecks[i].oracle === true` — 이 check가 외부 oracle(공식 grader)임을 표시. normalizeAcceptance는 check 객체를 원형 보존(asArray passthrough)하므로 플래그는 추가 코드 없이 생존한다.
- 도출 (buildReviewReport, review 시점 — retry-state 정리는 close 이후라 `task.verifyAttempts`가 아직 살아있다):

```
hasOracle = requiredChecks.some(c => c.oracle === true)
attempts  = Number(task.verifyAttempts || 0)
oracleAccess = !hasOracle ? 'none'
             : (attempts === 0 ? 'judge_once' : 'interactive')
```

| 값 | 의미 |
|---|---|
| `none` | oracle-플래그 check 없음 (oracle-free close) |
| `judge_once` | oracle 판정을 소비했으나 verify-retry 0회 (단발 판정) |
| `interactive` | oracle 판정이 최소 1회 피드백됨 (verifyAttempts ≥ 1) |
| `unknown` (audit 전용) | 판정에 도달한 적 없는 close — infra/protocol 인증서, 레거시 미스탬프 |

값은 닫힌 enum(콜론 없음) — frontmatter 스칼라로 안전, sanitizeFmScalar 불요 (assuranceTier 전례).

## 2. 전파 (양쪽 스탬프 사이트 + FAIL 대칭)

- reviewReport에 `oracleAccess` 필드 (review node fm에 reviewReport 통째로 저장되므로 별도 스탬프 불요).
- approvedReview 객체가 `oracleAccess`를 운반 → **두 스탬프 사이트가 반드시 동기**:
  1. fresh-EoW 경로: `lib-state-writer.js applyApprovedReviewToEow` (task-EoW + run-EoW 공통).
  2. reviewTarget 경로: `lib-runner.js attachApprovedReviewToExistingEows` (기존 EoW에 attach).
  - 두 곳 모두 **guarded** (`if (approvedReview.oracleAccess)`) — P0-3 이전에 발행된 approvedReview가 값을 날조하지 않도록 (state-writer-run-graph의 facade-vs-legacy byte-일치 테스트도 이 guard에 의존).
- FAIL 대칭: `buildFailureCertificate({ ..., oracleAccess })` — **content close만** review-도출값을 전달. infra/protocol/executor-failure close는 판정에 도달한 적이 없으므로 필드를 정직하게 **생략**한다 (성공-암시 기본값 금지; audit이 unknown으로 읽는 것이 올바른 의미).

## 3. Audit 표면 (게이트 변경 0)

- `audit.assurance.oracleAccess = { none, judge_once, interactive, unknown }` — terminal task(done + blocked/failed) 위 집계. done → task-EoW `fm.oracleAccess` (복수 EoW 불일치 시 **최고 소비 우선**: interactive > judge_once > none — 소비는 되돌릴 수 없으므로 tier의 weakest-wins와 반대), blocked/failed → `failureCertificate.oracleAccess`; 미스탬프/비인식 값 → `unknown`.
- `renderAuditText` assurance 라인 확장: `... oracleAccess none=.. judge_once=.. interactive=.. unknown=..`.
- auditAssuranceLedger 불변 — 신규 issue 없음, claimSafe 산식 불변 (smoke TC3이 claimSafe===true로 고정).

## 4. Adapter 마킹

`eval/adapters/run_swebench.mjs` (C-arm)의 grader requiredCheck에 `oracle: true` — 공식 SWE-bench 테스트 = 외부 oracle. bare/naive/selfground arm은 taskops close 경로를 우회하므로 마킹 대상 아님.

## 5. 한계 (문서화된 측정 주의 — 과독 금지)

1. **runner-가시 소비만 센다.** noverify arm(verifyChecks off)이나 self-report close에서는 verifyAttempts가 증가하지 않으므로, executor가 grader를 스스로 여러 번 돌렸어도 oracle-플래그 task는 `judge_once`로 스탬프된다. 층화 해석 시 "runner가 관측한 oracle 소비"로 읽을 것.
2. **post-close reviewTarget 재리뷰는 attempts=0으로 재계산**한다 (verifyAttempts는 close 시 정리됨) — 스탬프된 `interactive`를 `judge_once`로 덮어쓸 수 있다. assuranceTier에 이미 존재하는 동일 hazard와 패턴 일치(덮어쓰기 유지); 스탬프를 건너뛰는 "수정"은 fresh-stamp의 both-sites 불변식을 깨므로 금지.
3. **saturation-escalation은 verifyAttempts를 0으로 리셋** (더 강한 resolver의 fresh floor) — 그 resolver가 첫 시도에 통과하면 이전 resolver의 oracle 소비에도 불구하고 `judge_once`. attemptLedger가 실제 궤적을 보존하므로 필요 시 그쪽으로 복원 가능. 특례화하지 않는다.
