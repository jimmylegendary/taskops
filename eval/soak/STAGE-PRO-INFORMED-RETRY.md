# stage-pro-gpt54low-informed — 사전등록: informed retry가 능력 lift를 되살리는가

날짜: 2026-07-29 · 대조군: `stage-pro-gpt54low-lift` · 변경점: `ac2a545`의 verify 실패 진단 전달

---

## 0. 왜 이 스테이지가 존재하는가 — 정직성은 이겼고 능력 lift는 없었다

`stage-pro-gpt54low-lift`(SWE-bench Pro 20건, gpt-5.4, effort=low, codex-cli)의 실측은 다음과 같다.

| 지표 | A (bare) | C (taskops, blind retry) |
|---|---:|---:|
| resolve | **4/19 = 21.1%** | **4/19 = 21.1%** |
| false_completion | **15/19 = 78.9%** | **0/19 = 0%** |
| F1 | 34.8% | **100%** |
| wall | 75분 | 200분 |

| 페어드 통계 | 실측 |
|---|---:|
| 판정집합 | `|P|=19` |
| 불일치쌍 | `b=0`, `c=0`, `n=0` |
| exact McNemar | `p=1.0` |
| lift | **0.0%p** |
| 판정 | **INSUFFICIENT** |

요약은 날카롭게 둘로 갈린다. **정직성은 압승**했다. C는 false completion을 15건에서 0건으로 없애고 F1을
34.8%에서 100%로 올렸다. 그러나 **능력 lift는 정확히 0**이었다. 더 오래 돌고 더 정직해졌지만, A가 못 푼 문제를
C가 새로 푼 사례는 한 건도 없었다. 이 스테이지는 그 0의 직접 원인으로 관측된 blind retry를 겨냥한다.

---

## 1. 진단 — 실패를 보지 못한 blind retry

대조군의 재시도 프롬프트에 들어간 `lastCheckFailure`의 실제 정보량은 아래 한 줄뿐이었다.

```text
Previous attempt failed verification: <커맨드경로>: failed
```

어떤 assertion이 깨졌는지, expected/actual이 무엇인지, 빌드와 테스트 중 어디서 실패했는지가 없었다. 그 결과 첫
시도는 `novel=true`였지만 두 번째 시도는 `novel=false`로 포화됐다. 재시도 횟수는 있었으나 진단 정보가 없어서 같은
접근을 반복한 셈이다.

커밋 `ac2a545`는 이 병목만 바꾼다. `cli/lib-runner.js`의 `executeRequiredChecks`가 이미 캡처하던 실제 체크 출력
`detail`을 `failedChecks`에 싣고 재시도 프롬프트의 `lastCheckFailure`까지 전달한다. 체크별 진단은
`CHECK_DIAGNOSIS_MAX=400`으로 제한하고, 전체 `RETRY_FEEDBACK_MAX_LEN`은 1000에서 2400으로 늘렸다. 출력이 없는 실패도
문자열 타입가드로 안전하게 처리한다. 즉 retry budget은 그대로 두고, blind retry를 informed retry로 바꾼 변경이다.

---

## 2. 가설 — informed retry가 attempt 2의 탐색을 회복한다

**H1(사전등록)**: 실제 실패 진단이 실린 재시도는 attempt 2의 접근 다양성을 회복시켜 `novel=false` saturation을
줄인다. 그 결과 대조군에서 0이었던 불일치쌍 `c`(A는 실패, informed C만 성공)가 `c>0`이 된다.

방향성 증거는 `c>0`, attempt 2의 `novel` 비율 상승, saturation 감소가 함께 나타나는지로 본다. 단, 방향성 신호와
통계적 LIFT 판정은 같은 말이 아니다. `c>0`이어도 exact McNemar가 유의하지 않으면 결과는 LIFT가 아니라 사전등록된
판정규칙을 따른다.

**반증 조건**도 미리 고정한다. `c=0`이 유지되면 실패 진단이 능력 회복을 만들었다는 H1을 기각한다. `b>c`이면
informed C가 A보다 더 많이 잃은 것이므로 H1 기각을 넘어 **역효과**로 해석한다.

---

## 3. 설계 — C만 재실행하고 A는 코드적으로 안전하게 재사용한다

| arm | adapter / 코드 경로 | 결과 | 이번 단계 |
|---|---|---|---|
| **A (bare)** | `run_swebench_pro_bare.mjs` | `eval/results/bare/pro-gpt54low/` | 기존 결과 재사용, 무변경 |
| **C (informed taskops)** | `run_swebench_pro.mjs`, `extraArgs=["2"]` | `eval/results/pro-gpt54low-informed/` | 신규 20 job 실행 |

A를 재실행하지 않는 근거는 추정이 아니라 import 경계다.

- `eval/adapters/run_swebench_pro.mjs:18`은
  `import { runTaskOps } from '/home/jimmy/repos/taskops/cli/lib-runner.js'`를 사용한다. 따라서 `ac2a545`의 영향을 받는다.
- `eval/adapters/run_swebench_pro_bare.mjs:14`는
  `import { invokeRuntimeAdapter } from '/home/jimmy/repos/taskops/cli/lib-runtime-adapters.js'`만 사용하고
  `lib-runner.js`를 사용하지 않는다. 따라서 `ac2a545`의 영향을 받지 않는다.

그러므로 이번 config의 `arms`에는 C만 둔다. A는 Phase 2 분석에서 `stage-pro-gpt54low-lift`의 bare 결과를 읽어
결합한다. A 코드를 바꾸지 않은 채 같은 20건을 다시 태우는 것은 비용만 늘리고 모델 분산을 새로 섞는다.

결과는 태그로 격리한다. `TASKOPS_SWE_RESULT_TAG=gpt54low-informed`는 adapter에서 허용 문자만 남긴 뒤
`tagDir=-gpt54low-informed`, `proDir=eval/results/pro-gpt54low-informed`가 된다. `extraArgs=["2"]`이므로 파일명은
`swebench-pro-k2-<instance_id>.json`이다. config의 `resultPattern`도
`results/pro-gpt54low-informed/swebench-pro-k2-{id}.json`으로 고정한다. 따라서 대조군
`eval/results/pro-gpt54low/`를 **절대 덮어쓰지 않는다**.

---

## 4. 인스턴스 — 동일 20건, 동일 순서, 사후 조정 금지

`stage-pro-gpt54low-lift.json`의 20개 `instances`를 **문자 단위로 동일하게, 같은 순서로** 사용한다. repo, 언어,
성공 가능성을 보고 사후에 추가·제외·교체하지 않는다. 한 건이라도 바꾸면 재사용 A와의 페어가 깨져 실험이 무효다.

인프라 실패는 인스턴스 교체 사유가 아니다. `grade_error`로 기록하고 아래 판정집합 규칙에 따라 제외한다.

---

## 5. 통계·판정규칙 — 대조군과 동일

- 주지표는 **lift = resolveRate_C(informed) − resolveRate_A(재사용)**다.
- 페어드 판정집합 `P`는 양 arm 모두 boolean verdict가 있는 인스턴스다. `b`는 A만 성공, `c`는 C만 성공,
  `n=b+c`는 전체 불일치쌍이다.
- 주검정은 **exact McNemar 양측 이항검정**이다. 연속성보정 χ²는 참고값으로만 병기하고 판정에는 쓰지 않는다.
- 판정은 `|P|<20` **INSUFFICIENT** / `p<0.05 ∧ c>b` **LIFT** / `p<0.05 ∧ b>c` **DROP** /
  `n≥6 ∧ p≥0.05` **NULL** / `n<6` **INSUFFICIENT**로 고정한다.
- undetermined(`grade_error`)는 어느 arm에서도 실패로 세지 않고 분모에서 제외한다.

부차지표는 세 가지다.

1. **G1 — false_completion 게이트**: informed C도 0을 유지해야 한다. 한 건이라도 생기면 능력 신호와 별개로 G1 실패다.
2. **attempt 2 novel 비율(saturation)**: informed 실행은 `KEEP_RUN=1`로 run 디렉터리를 보존해야
   `events.jsonl`의 `verify_retry.novel`을 직접 측정할 수 있다. 보존하지 않으면 이 부차지표는 영구적으로 측정할
   수 없다. 디스크 폭증을 막기 위해 `postJobCleanup`은 job 종료 후 `events.jsonl`만 남기고 나머지를 즉시
   삭제한다. 디렉터리 이름과 계층은 유지되므로 `compare-retry-ab.mjs`의 instanceId 파싱과 ledger 시간구간
   귀속은 그대로 동작한다.
3. **wall**: 진단 전달이 총 실행시간을 얼마나 바꾸는지 기록한다.

---

## 6. 분석 절차 — 실행 config와 페어드 분석을 분리한다

이 config에는 의도적으로 `pairedTest`가 없고 `arms`도 C 하나뿐이다. `report-stage.mjs:85-86`은
`cfg.pairedTest`가 존재하고 두 arm 키가 모두 `cfg.arms`에 있을 때만 페어드 섹션을 계산한다. 따라서 이 config에
`report-stage.mjs`를 돌리면 **C arm 단독 요약만** 나온다. 그것이 정상이다.

Phase 2에서는 별도 분석 스크립트가 필요하다. 그 스크립트는 다음 두 스테이지를 instance id로 결합한 뒤
`mcnemar.mjs`로 계산해야 한다.

| 역할 | 입력 |
|---|---|
| A | `stage-pro-gpt54low-lift`의 `eval/results/bare/pro-gpt54low/` |
| C | `stage-pro-gpt54low-informed`의 `eval/results/pro-gpt54low-informed/` |

Phase 2 스크립트는 이번 준비 범위에 포함하지 않는다. C 단독 config에 가짜 A arm이나 `pairedTest`를 넣어
`report-stage.mjs`가 계산하는 것처럼 보이게 만들지 않는다.

---

## 7. 실행 방법 — 준비만 완료하고 소유자가 백그라운드 실행한다

이 문서와 config는 실행 준비물이다. **이번 작업에서는 벤치를 실행하지 않는다.** `run-stage.mjs`의 실제 인자 규약은
`--config <stage.json> [--dry]`이며 config 경로는 `eval/soak/` 기준으로 해석된다. 저장소 루트에서의 정확한 직접 실행은
다음과 같다.

```bash
cd /home/jimmy/repos/taskops
node eval/soak/run-stage.mjs --config stage-pro-gpt54low-informed.json
```

소유자가 `launch.log`를 남기며 백그라운드로 띄우려면 redirect 전에 stage 디렉터리를 만든다.

```bash
cd /home/jimmy/repos/taskops
mkdir -p eval/soak/stage-pro-gpt54low-informed
nohup node eval/soak/run-stage.mjs --config stage-pro-gpt54low-informed.json \
  > eval/soak/stage-pro-gpt54low-informed/launch.log 2>&1 &
```

이번 단계는 C arm 20 job이다. 대조군 C의 실측 wall 200분을 pace로 쓰면 **약 3.5시간**을 예상한다. 모델·Docker
상태에 따라 달라질 수 있으며, `globalWallMin=900`, `perRunTimeoutMin=45`, `maxAttemptsPerJob=2`,
`haltOnConsecutiveFailures=4`, `concurrency=1`은 대조군과 동일하다.

---

## 8. 정직 고지

1. **A는 시점이 다른 재사용이다.** 동일 시각·동일 환경에서 C와 동시 실행한 대조가 아니다. 코드 경계상
   `ac2a545`의 영향은 받지 않지만, 시간에 따른 외부 환경 차이까지 통제한 것은 아니다.
2. **모델 비결정성이 남는다.** taskops 코드 변경이 없어도 C를 다시 실행하면 결과가 달라질 수 있다. 따라서 관측된
   차이의 귀속 후보는 **taskops 코드 변경(informed retry) + 모델 분산** 둘 다이며, 이 설계 하나로 둘을 분리할 수 없다.
3. 둘을 분리하려면 `ac2a545` 이전 blind C를 informed C와 동시에 다시 돌리는 **3-arm 설계**가 필요하다. 대안은
   blind/informed 동일 조건을 반복 실행해 모델 분산을 추정하는 것이다. 둘 다 이번 범위 밖이다.
4. `|P|=19~20`의 작은 표본이다. 대조군은 이미 **INSUFFICIENT**였다. exact McNemar에서 `p<0.05`를 만들려면
   불일치쌍이 적어도 `n≥5` 수준으로 한 방향에 몰려야 하며, 정확히 `b=0`이면 `c=5`도 `p=0.0625`라 부족하고
   `c=6`에서야 `p=0.03125`다. 즉 **이번에도 통계적 유의는 기대하기 어렵다.** 실질 산출물은 우선 `c>0`이
   나오는가라는 방향성 신호다. 결과 발표에서 이를 LIFT처럼 부풀리지 않는다.
5. A의 false_completion **15/19 = 78.9%**는 대조군 실측을 그대로 재사용하는 값이다. 이번 C-only 실행으로
   갱신되거나 재측정되지 않는다.
6. **blind saturation은 소급 측정할 수 없다.** 대조군 blind 스테이지는 `KEEP_RUN` 없이 실행되어 run
   디렉터리가 이미 삭제됐다. 따라서 이번에 얻는 novel 비율은 informed 단독 관측값이며, blind 대비 saturation
   감소를 입증하는 값이 아니다. `/tmp`에 남은 `verify_retry` 4건(인스턴스 2개)은 어느 스테이지에도 귀속되지
   않은 잔여물이므로 대조군 대표값으로 쓰지 않는다.
7. **`postJobCleanup`은 대조군 config에는 없던 항목이다.** job 종료와 결과 파일 기록이 끝난 뒤 실행되므로
   채점·판정에는 영향을 주지 않으며 모델 행동도 바꾸지 않는다. 이 차이는 informed 실행의 측정 자료를
   보존하면서 디스크 사용량만 제한하기 위한 저장 수명주기 차이다.
