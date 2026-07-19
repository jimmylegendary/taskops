# stage-6h 진단 — HOLD 원인 분석 (2026-07-19)

48잡 전부 완주(exit 0, HALT 없음, 실행 2.2h). 판정 HOLD는 정확했고, 검증이 **3개 문제(계측 버그 2 + 실행 오염 1)**를 잡아냈다. 능력 결과는 무효이나 **정직성 결과는 강건하게 입증**됐다.

## 확정 결론

### ✅ 지켜진 것 — 정직성 (G1 PASS)
- **C-arm(taskops) 12/12 false_completion = 0.** 아래 오염(에이전트가 편집조차 못 한 극한) 하에서도 taskops는 단 한 번도 거짓 완료를 주장하지 않았다 — 못 풀면 전부 정직하게 blocked. 이는 오히려 **adversarial 조건에서의 강건성 증거**(C3 정직성 headline).
- D-arm(self-grounding) self_ground_gap = 0/12. 자기인증이 틀린 적 없음(단, 대부분 자명하게 blocked돼 강한 증거는 아님).
- C-arm 정확 집계(파일명 수정 후): TP=1 FP=0 FN=1 TN=10 → precision 100%, recall 50%, coverage 100%.

### 🔴 문제 1 — A-arm grade 파싱 (계측 버그, 내가 2026-07-19 넣음) → **수정 완료**
- `swebench_grade.py`는 `{"resolved":false}`를 stdout에 정상 출력하지만 exit code 1로 나간다(라인 35). 어제 넣은 "grade-throw→null" 수정이 이 **정상 NOT_RESOLVED verdict를 infra 오류(undetermined)로 오분류** — 정확히 F-1의 content-vs-infra 구별을 eval 레벨에서 거꾸로 한 것.
- 결과: A-arm 9개가 undetermined 오분류 → G2/G3 FAIL의 주 원인.
- 수정: `run_swebench_bare.mjs`가 naive/selfground와 동일하게 `e.stdout`에서 verdict를 복원(있으면 verdict, 없을 때만 null). **단 기존 A 데이터는 bare가 workspace를 rmSync해 유실 — 재실행에서만 정정 가능.**

### 🔴 문제 2 — C-arm 결과 파일명 불일치 (내 config 버그) → **수정+재집계 완료**
- C-arm은 verifyRetries=4라 실제 파일이 `swebench-k4-{id}.json`인데 stage-6h.json은 `swebench-{id}.json`을 찾아 7개 not_run 오판 + astropy 5개는 **과거 데이터를 잘못 읽음**. config를 `swebench-k4-{id}.json`로 수정 → C-arm coverage 100% 회복(데이터는 온전, 재실행 불필요).

### 🟡 문제 3 — rate-limit 간헐 오염 (실행 환경, 근본 원인) → **재실행 전략 필요**
- 시간순 elapsed: 첫 4 인스턴스(astropy 3 + django)는 정상(123~996s, 편집함), 08:22 이후 다수가 15~25s로 조기종료(edited=false, diff=0 = 에이전트가 아무 작업 못 함). matplotlib에서 A/B(08:23, 342·477s)는 정상인데 C/D(08:28, 101·99s)는 짧음 = 시간대별 간헐.
- 원인: **claude-code executor가 이 대화 세션과 같은 구독 쿼터를 공유.** 6h 실행 내내 이 세션도 활동해 claude 쿼터가 간헐 고갈 → nested claude 호출이 즉시 반환.
- 귀결: **능력(resolve율) 측정 무효** (절반이 편집조차 못 함). 정직성만 유효.

## 재실행 옵션 (Jimmy 결정 필요 — 비용/쿼터)

1. **별도 executor** — `TASKOPS_SWE_EXECUTOR=codex-cli`(또는 API 키 기반)로 이 세션 쿼터와 분리. 근본 해결. naive/selfground/C 모두 env 지원, bare는 4번째 인자.
2. **조용한 창** — 이 대화 세션 idle 상태로 새벽 daemon 실행. 무료지만 쿼터 회복 타이밍 의존.
3. **A-arm만 재실행** — C/D/B는 이미 coverage 100%. A 12개(bare)만 다시 돌리면 G3 충족. 단 오염 조건 그대로면 또 오염.

권장: **옵션 1(별도 executor)** — 오염의 근본을 제거. codex-cli 쿼터/비용 산출 후 결정.

## verify-resolver 정합성 조사 — 완료 (2026-07-19)

**대상**: astropy-14365 C-arm FN (official=resolved, taskops verify=rejected/blocked, 929s 정상 작동).

**결론 1 — taskops 로직은 정합적**: `run_swebench.mjs`에서 taskops의 requiredCheck(라인 74)와 최종 official 채점(라인 94)은 **완전히 동일한 명령·동일한 workspace 경로**(`swebench_grade.py <instance> <workspace>`). taskops는 grade를 조작하지 않고 그대로 실행한다. 버그 없음.

**결론 2 — grader core는 결정적**: `probe-grader-determinism.mjs`로 gold patch 적용 workspace를 5회 grade → **5/5 resolved, infra 0** (각 ~56s). astropy-14365에서 grader는 명확한 fix에 안정적이다.

**결론 3 — FN의 진짜 원인 = 무거운 빌드의 자원 민감성**: grader가 gold에 결정적이므로 순수 비결정성은 아니다. 남는 설명은 **경계선 fix + 자원 부하**: `swebench_grade.py`는 매 호출이 PID-run_id 기반 fresh Docker 실행(라인 20)이라, astropy의 C-확장 빌드가 6h의 rate-limit + 동시성2 피크(08:02 실행 시점)에서 타임아웃/자원부족으로 간헐 실패 → verify는 rejected, 부하 완화된 최종 grade는 resolved.

**대응** (구현/설계 완료):
- **F-2 flaky probe가 정확히 이 케이스를 위해 존재** — saturated content close에서 실패 check를 K회 재실행, 흔들리면 undetermined로 강등(FN이 아니라 판정보류). 이미 구현됨.
- **codex executor 전환** — 4개 어댑터 default를 codex-cli로. 이 대화 세션과 쿼터 분리 → rate-limit 오염 근본 제거. 재실행 시 부하 피크가 사라져 대부분 해소 예상.
- **재사용 도구화**: `probe-grader-determinism.mjs` = 앞으로 어떤 인스턴스든 grader 결정성을 gold로 검사하는 상비 도구 (F-2 positive-control의 bench측).
- **남은 관찰**: 재실행에서도 이 인스턴스가 FN이면, verify check(grade) 자체에 격리+K회 다수결을 추가하는 것을 검토 (현재는 F-2가 close 시점에만 재확인).

## 다음 스테이지 재실행 설정 (확정)
- **executor**: codex-cli (default). 이 세션 쿼터와 분리.
- **tier ladder** (선택): `TASKOPS_SWE_ESCALATION="codex-cli:medium,codex-cli:high"` → saturation 시 gpt-5.6 reasoning tier 약→강 승급.
- 나머지(인스턴스/게이트)는 STAGE-PLAN.md 그대로.
