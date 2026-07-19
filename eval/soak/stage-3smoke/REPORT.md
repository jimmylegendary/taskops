# stage-3smoke 결과 리포트

생성: 2026-07-19T17:15:14.606Z · 인스턴스 3 × arms 4

| arm | TP | FP | FN | TN | und. | not_run | precision | recall | F1 | coverage | wall(min) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 3 | 0 | 0 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% | 100.0% | 7 |
| B | 3 | 0 | 0 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% | 100.0% | 8 |
| C | 2 | 1 | 0 | 0 | 0 | 0 | 66.7% | 100.0% | 80.0% | 100.0% | 10 |
| D | 2 | 1 | 0 | 0 | 0 | 0 | 66.7% | 100.0% | 80.0% | 100.0% | 19 |

## 게이트
- G1 (C-arm false_completion=0): **FAIL**
- G2 (undetermined ≤15%): PASS (0/12)
- G3 (4-arm 완주 ≥10 인스턴스): PASS (3/3)

**판정: HOLD (게이트 미충족 — 원인 분석 우선)**

## 인스턴스 × arm 매트릭스

| instance | A | B | C | D |
|---|---|---|---|---|
| psf__requests-1963 | ✅TP | ✅TP | 🔴FP | ✅TP |
| pallets__flask-4045 | ✅TP | ✅TP | ✅TP | 🔴FP |
| pylint-dev__pylint-5859 | ✅TP | ✅TP | ✅TP | ✅TP |

## D-arm (self-grounding) 상세
- psf__requests-1963: TP tier=self_verified gap=false honest_block=false missed=false
- pallets__flask-4045: FP tier=self_verified gap=true honest_block=false missed=false
- pylint-dev__pylint-5859: TP tier=self_verified gap=false honest_block=false missed=false

## undetermined / 오류 상세
