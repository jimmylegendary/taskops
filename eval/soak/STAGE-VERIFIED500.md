# stage-verified500 — 사전등록: taskops가 모델 성능을 끌어올리는가 (첫 능력 테스트)

날짜: 2026-07-21 · 승인: Jimmy ("실 benchmark 하나 잡고 다 돌려서 … 진짜 model의 성능을 끌어올리는지 확인하는 첫 테스트")

## 0. 목적 전환 (이전 스테이지와 다름)

이전(stage-lcb/swe-f1/pro-f1)의 주 지표는 **정직성**(false_completion)이었다. 이 스테이지의 주 지표는 **능력**:
> 같은 모델(gpt-5.6-sol)로, taskops 위임 실행이 공개된 bare 점수를 **넘어서는가**.

## 1. 벤치·앵커 (bare = 공개 점수, 우리는 taskops arm만 실행)

- **벤치**: SWE-bench Verified **전수 500** (princeton-nlp/SWE-bench_Verified)
- **공개 bare 앵커**: **gpt-5.6 Sol = 96.20%** — [vals.ai SWE-bench Verified 리더보드](https://www.vals.ai/benchmarks/swebench) (2026-07 접근, bash-tool-only harness). 같은 모델의 공개값이라 채택.
- **선택 이유**: 정확히 같은 모델의 공개 bare가 존재하는 유일한 벤치. SWE-bench Pro는 gpt-5.6 공개 앵커 불명확(집계 사이트별 상이, Scale 표준화는 GPT-5.4 xHigh 59.1%)이라 기각.

## 2. 우리 arm 설정 (동일 모델·동일 effort 원칙)

- executor: **codex-cli = gpt-5.6-sol** (공개 앵커와 동일 모델)
- effort: **high 고정**. vals.ai는 effort 미공개 — 리더보드 관행(xHigh/High 표기 관례)에 맞춰 high로 고정하고 이 불확실성을 §5에 기록. **tier escalation ladder는 OFF** (동일-effort 원칙과 충돌).
- 위임 해석: **runTaskOps verify-grounded 실행** (verifyRetries=1, requiredCheck=공식 Docker 하니스 oracle). 외부 ai-resolver는 **연결 안 함** — 다른 모델(claude)이 개입하면 "같은 모델" 순수성이 깨진다. 즉 gpt-5.6-sol 단독 + taskops 게이트/재시도.
- 파라미터: per-instance runner wall 40min(`TASKOPS_MAX_WALL_MS`), driver kill 50min, 동시성 1, 연속실패 3 → HALT(재개형), job당 최대 2회 시도.
- 디스크: `SWEBENCH_CACHE_LEVEL=env` — per-instance 이미지(~1GB×500)를 남기지 않음. env 이미지만 유지.

## 3. 지표 (사전등록)

1. **주 지표**: resolve율 = official_resolved=true / 500 — **vs 96.20%** (Wilson 95% CI 병기)
2. per-repo 분해 (django 231 / sympy 75 / sphinx 44 / matplotlib 34 / sklearn 32 / astropy 22 / xarray 22 / pytest 19 / …)
3. 미해결 인스턴스 전량 목록 (앵커 기대 미해결 ≈ 19개와 대조)
4. undetermined(grade infra)는 분모 제외하고 **별도 보고** (F1 규율 유지 — 능력 테스트에서도 인프라를 실패로 안 센다)
5. 부 지표(참고): verified_done vs official_resolved 일치율(정직성 회귀 감시), verify-retry 발동률, 평균 wall/인스턴스

## 4. 판정 규칙 (사전등록 — 사후 이동 금지)

- **LIFT**: 점추정 > 96.2% 이고 96.2%가 우리 95% CI 밖 → "taskops가 공개 bare를 넘었다"
- **PARITY**: 96.2%가 CI 안 → "동급 (넘었다고 주장 금지)"
- **DROP**: 점추정 < 96.2% 이고 CI 밖 → "이 구성으로는 미달" — 원인 분해(§3.2/3.3)로 후속
- 어떤 결과든 §5의 confound 한계와 함께 보고한다.

## 5. 정직 고지 (미리 박아두는 한계)

1. **Ceiling**: 앵커 96.2%는 천장 근처 — 여지 ~4pt(500 중 ~19개). LIFT가 나와도 폭은 작을 수밖에 없고, 이 벤치는 "끌어올림의 크기"보다 "**넘느냐**"를 묻는 인스트루먼트다.
2. **Scaffold confound**: 공개 bare는 vals의 bash-tool-only harness, 우리는 codex CLI+taskops. 순수 taskops 효과(같은 scaffold ± taskops)의 분리가 아니라 **"공개된 그 모델 최고 성적을 taskops 구성이 넘는가"**를 묻는다. 순수 분리는 후속(bare-codex-CLI arm)으로.
3. **effort 불확실성**: vals의 reasoning effort 미공개 → high 고정은 근사.
4. flaky oracle은 F-2b(성공측 재확인)가 방어 — flaky 통과는 undetermined로 빠진다.

## 6. 운영

- 재개: `node run-stage.mjs --config stage-verified500.json` 재실행 = done skip, 실패 job 최대 2회.
- 체크포인트: 진행 20개 단위 Monitor 이벤트 + 수시 ledger 집계(중간 resolve율 vs 96.2%). 초반 4개 완료 시 실측 pace로 총 ETA 보고.
- 예상 규모: 인스턴스당 codex(high) + verify/최종 grade ≈ 8~25분 → **총 3~6일** (재개형, HALT 가드).
