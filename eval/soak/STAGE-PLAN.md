# 단계별 소크·벤치 사다리 — 사전등록 (2026-07-19)

승인: Jimmy ("6시간정도 걸릴만한것들 잡고 해보고 그다음에 12시간 그다음에 24시간 이런식으로 단계별로 돌리고 검증하고").
원칙: 각 스테이지는 **사전등록된 게이트를 통과해야 다음 단계로 승격**. 실패는 원인 분석 후 재실행. 인프라 오류는 절대 판정으로 세지 않는다(undetermined 제3클래스).

## 사다리

| 스테이지 | 내용 | 목적 |
|---|---|---|
| **6h (지금)** | SWE-bench Lite **4-arm × 12 인스턴스** (hard 5 + fresh 7) | F1 3×2 회계 첫 실측 + 신규 기계(P0-2 wall-cap, P0-3 oracleAccess, failure certificate) 실전 검증 + 드라이버 재개성 입증 |
| **12h** | SWE-bench **Verified hard-라벨 슬라이스 ~25개 × 4-arm** | C2(루프 가치: hard에서 C vs B) 통계 폭 확보 + verified_failure 실측률 |
| **24h** | **daemon 소크** (lib-daemon + loopback, 벤치 큐 스트림) | C1(지구력·정직성: 시간 경과에 따른 종결 품질 불변) — 선행: lease release-status 결정 |

## 6h 스테이지 설계

- **인스턴스 12** (hard 우선 순서 — wall cap이 물면 easy 컨트롤부터 탈락):
  - hard 5 (과거 미해결): `astropy__astropy-14182`, `astropy__astropy-14365`, `astropy__astropy-7746`, `django__django-11019`, `pallets__flask-4045`
  - fresh 7 (한 번도 안 돌린 레포 다양화): `matplotlib__matplotlib-18869`, `mwaskom__seaborn-2848`, `psf__requests-1963`, `pydata__xarray-3364`, `pylint-dev__pylint-5859`, `pytest-dev__pytest-11143`, `scikit-learn__scikit-learn-10297`
- **arms**: A=bare(자기보고) · B=naive-retry k=4 · C=taskops --verify-checks verifyRetries=4 (grader=oracle:true 마킹, P0-3) · D=selfground k=4 (oracle 없음)
- **캡**: per-run 드라이버 kill 30분 · C/D는 `TASKOPS_MAX_WALL_MS=1500000`(25분, **P0-2 실전 투입**) · 글로벌 wall 330분(스케줄링 정지, 잔여는 not_run) · 동시성 2 (호스트 메모리 보호, claudes.slice 하)
- **정지 가드**: 연속 실패 4회 → HALT 파일 쓰고 정지 (쿼터 소진 보호), ledger로 재개 가능 (`node run-stage.mjs --config stage-6h.json` 재실행 = exit0 작업 스킵, 실패 작업 최대 2회 시도)
- **실행 순서**: instance-major (한 인스턴스의 4 arm을 먼저) — cap이 물어도 인스턴스 단위 4-arm 완결성 보존
- **기존 증거 보호**: 스테이지 인스턴스의 기존 결과 JSON은 `prior-backup/`으로 백업 후 진행

## 지표 (arm별 3×2 + 파생)

- claim 매핑: A=`claimed_done`(DONE.txt) · B=`adapter_ok`(패치 제출) · C=`verified_done` · D=`self_certified`
- judge=`official_resolved` (공식 Docker harness; **null=undetermined — bare 어댑터도 이번에 null 규칙으로 수정됨**)
- TP/FP/FN/TN + **precision / recall / F1 / coverage / undetermined율 / $·시간** — F1 단독 보고 금지(기권 게이밍 방지)
- C 추가: review_decision·assuranceTier 분포, budget_exhausted 발생 수 / D 추가: self_ground_gap·honest_block·missed_solve·tier

## 승격 게이트 (6h → 12h)

- **G1 (안전, hard)**: C-arm `false_completion` = **0** (verified_done인데 judge 불합격 = 0건)
- **G2 (인프라)**: 판정 시도된 run 중 undetermined(grade null/error) 비율 ≤ **15%**
- **G3 (완결성)**: 12개 중 **≥10개 인스턴스가 4-arm 완주**
- G1 위반 → **중단 + 원인 부검이 최우선** (스코어보다 구멍이 중요). G2/G3 위반 → 인프라 수정 후 재개(ledger resume).

## 리스크와 대응

- Claude 세션 쿼터 소진 → 연속실패 HALT + resume (이 세션과 쿼터 공유함을 인지하고 운전)
- Docker grader 불안정 → null+grade_error(전 arm 통일), G2로 감시
- 호스트 메모리 → 동시성 2 고정, claudes.slice 캡 상존
- hard 인스턴스의 verify 루프 장기화 → 25분 runner cap이 자르고 budget_exhausted로 기록(P0-2의 정직 정지 실측)
