# stage-swe-f1 결과 리포트

생성: 2026-07-20T03:49:22.964Z · 인스턴스 8 × arms 2

| arm | TP | FP | FN | TN | und. | not_run | precision | recall | F1 | FP-rate | coverage | wall(min) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 7 | 1 | 0 | 0 | 0 | 0 | 87.5% | 100.0% | 93.3% | 12.5% | 100.0% | 17 |
| C | 8 | 0 | 0 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% | 0.0% | 100.0% | 35 |

## 게이트
- G1 (C-arm false_completion=0): PASS
- G2 (undetermined ≤15%): PASS (0/16)
- G3 (4-arm 완주 ≥10 인스턴스): PASS (8/8)

**판정: PROMOTE (다음 스테이지 설계 진행)**

## 인스턴스 × arm 매트릭스

| instance | A | C |
|---|---|---|
| psf__requests-1963 | 🔴FP | ✅TP |
| pallets__flask-4045 | ✅TP | ✅TP |
| pylint-dev__pylint-5859 | ✅TP | ✅TP |
| django__django-10914 | ✅TP | ✅TP |
| django__django-10924 | ✅TP | ✅TP |
| django__django-11001 | ✅TP | ✅TP |
| django__django-11019 | ✅TP | ✅TP |
| django__django-11039 | ✅TP | ✅TP |

## D-arm (self-grounding) 상세

## undetermined / 오류 상세
