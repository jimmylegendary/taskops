# Budget Vector — wall-clock 차원 (v1)

날짜: 2026-07-19 · 상태: v1 구현 (P0-2 — budget vector 최소형, wall-clock 차원만) · smoke: `cli/scripts/budget-vector.mjs` (T1–T5)

## 0. 목적과 범위

runTaskOps에 **글로벌 wall-clock 예산** 1차원을 추가한다. budget vector의 나머지 차원(token, cost 등)은 유예 — v1은 벡터의 첫 성분만 구현하고 확장 좌표를 남긴다.

- 옵션 `maxWallClockMs` (number, ms) + env `TASKOPS_MAX_WALL_MS` fallback. **옵션이 env를 이긴다.**
- 유효값 = 유한한 비음수. 불량값은 runner lock 획득 **이전**에 throw — lock 잔존 없음 (`--max-steps`/`--until` 검증기와 동일 배치 계약, T5가 고정).
- CLI 플래그는 v1에 없음: `taskops run`은 runTaskOps를 in-process로 호출하므로 `TASKOPS_MAX_WALL_MS=5000 taskops run …`으로 이미 도달한다.

## 1. 의미론 — "스케줄링 정지"

소진 판정은 메인 step-dispatch 루프의 **dispatch 사이**에서만 일어난다 (`until`/`maxSteps` 체크 다음, 세 번째 정지 조건 — 기존 stopReason 우선순위 보존).

- **no-kill (v1)**: in-flight step은 정상 종료한다. `--until`과 달리 이 cap은 stepTimeoutMs를 절대 단축하지 않는다.
- 기산점 = runner_started 시각 (parse/lock 이후) — budget_exhausted 이벤트의 `elapsedMs`가 run 자체 이벤트 타임라인과 일치.
- deadline(절대 시각 `--until`)과 budget(상대 cap)은 **다른 계약** — stopReason도 분리 (`deadline_reached` vs `budget_exhausted`).

## 2. 소진 시 표면화 (3곳, task frontmatter는 0곳)

| 표면 | 내용 |
|---|---|
| events.jsonl | `{type:'budget_exhausted', runId, dimension:'wall_clock', elapsedMs, maxWallClockMs}` |
| run log | `budget_exhausted dimension=wall_clock elapsedMs=… maxWallClockMs=…` 한 줄 |
| runTaskOps 반환값 | `budgetExhausted` (항상 존재하는 boolean — undefined-vs-false 모호성 차단) + `maxWallClockMs`; `stopReason='budget_exhausted'` (STOP_REASONS.BUDGET_EXHAUSTED) |

runner_started 이벤트에도 `maxWallClockMs`를 스탬프 (maxSteps/until과 관측 대칭). **task frontmatter에는 아무것도 쓰지 않으므로 sanitizeFmScalar 경유 대상이 v1에 없다** — 향후 어떤 경로든 소진 문자열을 frontmatter에 넣게 되면 반드시 sanitizeFmScalar를 통과시킬 것 (colon-in-string 전례).

## 3. 정직성 불변식 (핵심)

**소진은 run의 자원에 대한 진술이지, 어떤 task에 대한 진술도 아니다.**

- 남은 runnable task는 **정확히 그대로** — pending 유지, blocked 전이 금지, failureCertificate 발급 금지.
- dispatch된 step은 정직하게 종결된 것만 done — 성공/실패 조작 없음.
- 구조적 보장: 루프 break 이후 반환 전 유일한 변이는 finalizeWorkStatusForClosure인데, closure 미완이면 no-op. blocked/failureCertificate는 step 실행 경로 안에서만 쓰이고 그 경로는 break로 건너뛴다. smoke T1/T3이 회귀 게이트로 고정 (failureLedger content=0 · uncertified=0, `blocked_without_failure_certificate` issue 부재).

## 4. env 전파 주의

`TASKOPS_MAX_WALL_MS`는 **모든** runTaskOps 호출이 읽는다 — 개발 셸에 export돼 있으면 기존 테스트 스위트 전체가 wall-cap된다 (의도된 runner 동작이지 버그가 아님; smoke는 try/finally로 자기 것만 정리하고 남의 env를 지우지 않는다). executor 자식-env sanitizer(DANGEROUS_ENV_PREFIX에 `TASKOPS_` 포함)가 중첩 worker 상속은 이미 차단한다.

## 5. 유예 (v1 밖) — 사유 포함

- **token/cost 차원**: budget vector의 나머지 성분. 계측원(源) 미설계.
- **budgetPromptLines wall-pressure threading**: `budget-injection.mjs`/`partial-completion.mjs`가 computeStepBudget 출력·finalBudget·EoW marker.budget의 **정확한 shape을 deepEqual로 고정**하고 있고, budgetPromptLines는 step-budget 의미론(`budget.enabled`)으로 게이트되므로 시간 기반 finishing-reserve 설계 없이는 "trivially clean"이 아니다. computeStepBudget 주석이 호환 확장 좌표를 이미 예약 — 그 경로로 후속 설계.
- **daemon/orchestrator pass-through**: `lib-daemon.js` runnerArgs에 새 플래그 배관 필요 + per-worker cap vs daemon-global cap 의미 미설계. 특히 orchestrator `terminalStatusFromRun`은 fall-through로 `failed`를 반환하므로 budget_exhausted worker 정지가 queue-lease를 failed로 release한다 (task 파일은 무손상 — task 층에서는 정직하지만, lease release-status 결정이 선행돼야 함).
- EoW marker에 wall 정보를 스탬프하게 되면 **두 스탬프 지점 모두** 갱신할 것: fresh-EoW 경로(`lib-state-writer.js` applyApprovedReviewToEow)와 reviewTarget 경로(`lib-runner.js` attachApprovedReviewToExistingEows).

## 6. smoke 계약 (`cli/scripts/budget-vector.mjs`)

- T1 — 1ms cap + 2 runnable task('sleep 0.01' guarded check가 timing-flake 차단): dispatch ≤1, budget_exhausted 이벤트 정확히 1개(dimension/elapsedMs/cap), 반환 budgetExhausted=true, **양 task 모두 pending|done · failureCertificate 없음 · pending ≥1 · done 수 = stepsRun**, audit 실패원장 0.
- T2 — 60000ms cap: 둘 다 done, stepsRun=2, budgetExhausted=false, 이벤트 0 (all_closed vs no_runnable은 계약 아님).
- T3 — env fallback (`TASKOPS_MAX_WALL_MS=1`, try/finally 정리): T1과 동일 계약.
- T4 — 옵션 60000ms가 env 1ms를 override (option-wins 규칙 고정).
- T5 — `maxWallClockMs:'nope'` throw 후 즉시 재실행 성공 = pre-lock 검증 (lock 잔존 없음) 증명.
