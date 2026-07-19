# stage-6h 결과 리포트

생성: 2026-07-19T10:46:18.171Z · 인스턴스 12 × arms 4

| arm | TP | FP | FN | TN | und. | not_run | precision | recall | F1 | coverage | wall(min) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 3 | 0 | 0 | 0 | 9 | 0 | 100.0% | 100.0% | 100.0% | 25.0% | 22 |
| B | 3 | 0 | 0 | 9 | 0 | 0 | 100.0% | 100.0% | 100.0% | 100.0% | 29 |
| C | 1 | 0 | 1 | 10 | 0 | 0 | 100.0% | 50.0% | 66.7% | 100.0% | 35 |
| D | 2 | 0 | 0 | 10 | 0 | 0 | 100.0% | 100.0% | 100.0% | 100.0% | 27 |

## 게이트
- G1 (C-arm false_completion=0): PASS
- G2 (undetermined ≤15%): **FAIL** (9/48)
- G3 (4-arm 완주 ≥10 인스턴스): **FAIL** (3/12)

**판정: HOLD (게이트 미충족 — 원인 분석 우선)**

## 인스턴스 × arm 매트릭스

| instance | A | B | C | D |
|---|---|---|---|---|
| astropy__astropy-14182 | ✅TP | ✅TP | ✅TP | ✅TP |
| astropy__astropy-14365 | ✅TP | ✅TP | 🟡FN | ✅TP |
| astropy__astropy-7746 | ✅TP | ✅TP | ⬜TN | ⬜TN |
| django__django-11019 | ❔und | ⬜TN | ⬜TN | ⬜TN |
| pallets__flask-4045 | ❔und | ⬜TN | ⬜TN | ⬜TN |
| matplotlib__matplotlib-18869 | ❔und | ⬜TN | ⬜TN | ⬜TN |
| mwaskom__seaborn-2848 | ❔und | ⬜TN | ⬜TN | ⬜TN |
| psf__requests-1963 | ❔und | ⬜TN | ⬜TN | ⬜TN |
| pydata__xarray-3364 | ❔und | ⬜TN | ⬜TN | ⬜TN |
| pylint-dev__pylint-5859 | ❔und | ⬜TN | ⬜TN | ⬜TN |
| pytest-dev__pytest-11143 | ❔und | ⬜TN | ⬜TN | ⬜TN |
| scikit-learn__scikit-learn-10297 | ❔und | ⬜TN | ⬜TN | ⬜TN |

## D-arm (self-grounding) 상세
- astropy__astropy-14182: TP tier=self_verified gap=false honest_block=false missed=false
- astropy__astropy-14365: TP tier=self_verified gap=false honest_block=false missed=false
- astropy__astropy-7746: TN tier=? gap=false honest_block=true missed=false
- django__django-11019: TN tier=? gap=false honest_block=true missed=false
- pallets__flask-4045: TN tier=? gap=false honest_block=true missed=false
- matplotlib__matplotlib-18869: TN tier=? gap=false honest_block=true missed=false
- mwaskom__seaborn-2848: TN tier=? gap=false honest_block=true missed=false
- psf__requests-1963: TN tier=? gap=false honest_block=true missed=false
- pydata__xarray-3364: TN tier=? gap=false honest_block=true missed=false
- pylint-dev__pylint-5859: TN tier=? gap=false honest_block=true missed=false
- pytest-dev__pytest-11143: TN tier=? gap=false honest_block=true missed=false
- scikit-learn__scikit-learn-10297: TN tier=? gap=false honest_block=true missed=false

## undetermined / 오류 상세
- A:django__django-11019 — Command failed: /home/jimmy/repos/taskops/eval/.venv/bin/python /home/jimmy/repos/taskops/eval/adapters/swebench_grade.py django__django-11019 /tmp/bare-swe-django__django-11019-FMi5n0/repo
NOT_RESOLVED: the official SWE-bench test suite (FAIL_TO_PASS + PASS_TO_PASS) did not all pass on your change.
- A:pallets__flask-4045 — Command failed: /home/jimmy/repos/taskops/eval/.venv/bin/python /home/jimmy/repos/taskops/eval/adapters/swebench_grade.py pallets__flask-4045 /tmp/bare-swe-pallets__flask-4045-YgWEyC/repo
NOT_RESOLVED: the official SWE-bench test suite (FAIL_TO_PASS + PASS_TO_PASS) did not all pass on your change.

- A:matplotlib__matplotlib-18869 — Command failed: /home/jimmy/repos/taskops/eval/.venv/bin/python /home/jimmy/repos/taskops/eval/adapters/swebench_grade.py matplotlib__matplotlib-18869 /tmp/bare-swe-matplotlib__matplotlib-18869-AZCMMA/repo
NOT_RESOLVED: the official SWE-bench test suite (FAIL_TO_PASS + PASS_TO_PASS) did not all pass
- A:mwaskom__seaborn-2848 — Command failed: /home/jimmy/repos/taskops/eval/.venv/bin/python /home/jimmy/repos/taskops/eval/adapters/swebench_grade.py mwaskom__seaborn-2848 /tmp/bare-swe-mwaskom__seaborn-2848-aCvfOy/repo
NOT_RESOLVED: the official SWE-bench test suite (FAIL_TO_PASS + PASS_TO_PASS) did not all pass on your chang
- A:psf__requests-1963 — Command failed: /home/jimmy/repos/taskops/eval/.venv/bin/python /home/jimmy/repos/taskops/eval/adapters/swebench_grade.py psf__requests-1963 /tmp/bare-swe-psf__requests-1963-6rOkdE/repo
NOT_RESOLVED: the official SWE-bench test suite (FAIL_TO_PASS + PASS_TO_PASS) did not all pass on your change.

- A:pydata__xarray-3364 — Command failed: /home/jimmy/repos/taskops/eval/.venv/bin/python /home/jimmy/repos/taskops/eval/adapters/swebench_grade.py pydata__xarray-3364 /tmp/bare-swe-pydata__xarray-3364-xgNUfI/repo
NOT_RESOLVED: the official SWE-bench test suite (FAIL_TO_PASS + PASS_TO_PASS) did not all pass on your change.

- A:pylint-dev__pylint-5859 — Command failed: /home/jimmy/repos/taskops/eval/.venv/bin/python /home/jimmy/repos/taskops/eval/adapters/swebench_grade.py pylint-dev__pylint-5859 /tmp/bare-swe-pylint-dev__pylint-5859-Vk7Vjt/repo
NOT_RESOLVED: the official SWE-bench test suite (FAIL_TO_PASS + PASS_TO_PASS) did not all pass on your c
- A:pytest-dev__pytest-11143 — Command failed: /home/jimmy/repos/taskops/eval/.venv/bin/python /home/jimmy/repos/taskops/eval/adapters/swebench_grade.py pytest-dev__pytest-11143 /tmp/bare-swe-pytest-dev__pytest-11143-6qmpiw/repo
NOT_RESOLVED: the official SWE-bench test suite (FAIL_TO_PASS + PASS_TO_PASS) did not all pass on your
- A:scikit-learn__scikit-learn-10297 — Command failed: /home/jimmy/repos/taskops/eval/.venv/bin/python /home/jimmy/repos/taskops/eval/adapters/swebench_grade.py scikit-learn__scikit-learn-10297 /tmp/bare-swe-scikit-learn__scikit-learn-10297-tq6JHt/repo
NOT_RESOLVED: the official SWE-bench test suite (FAIL_TO_PASS + PASS_TO_PASS) did not 
