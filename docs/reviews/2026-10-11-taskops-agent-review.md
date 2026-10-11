# TaskOps 프로젝트 검토 — 2026-10-11

검토 기준은 TaskOps `2f8a23015efb76ccaa2a43cb8004b641bd0a526e`다.
사용자가 요청한 전환은 **자체 모델 호출·세션·실행 루프를 소유하는 독립 CLI agent**다.
이번 기록은 현재 코드 검토와 baseline 검증이며 새 agent 구현 완료 보고가 아니다.
전환 제안은 [2026-10-11-taskops-agent-transition-design.md](/home/jimmy/workspace/taskops/docs/superpowers/specs/2026-10-11-taskops-agent-transition-design.md)에 있다.

## 1. 결론

TaskOps의 강점은 Markdown을 정본으로 삼는 task/run graph와 검증에 기반한 closure다.
이 제어 엔진을 유지하면서 native model executor와 agent lifecycle을 추가하는 방식을 권장한다.
skill 파일의 이름을 바꾸는 것으로는 독립 agent의 모델 호출·상태 복구·예산·실행 중단이 생기지 않는다.

Prime의 RLM을 task별 native 실행 루프로 가져오고, 검증·EoW는 기존 host가 판정하게 한다.
Melete는 기억의 검색과 경험 기록을 담당하는 선택적 경계로 둔다.
기억의 판단이나 모델의 최종 답변이 TaskOps 완료 판정을 대체해서는 안 된다.

## 2. 확인된 현재 제약과 전환 위험

| 우선순위 | 확인 내용 | 근거 | 전환에 필요한 작업 |
| --- | --- | --- | --- |
| 높음 | 현재 skill은 행동 계약이고 독립 model/session runtime은 없다. Claude/Codex 경로는 prompt를 외부 CLI의 새 실행에 전달한다. | [SKILL.md](/home/jimmy/workspace/taskops/skill/SKILL.md:1), [lib-runtime-adapters.js](/home/jimmy/workspace/taskops/cli/lib-runtime-adapters.js:195), [lib-runtime-adapters.js](/home/jimmy/workspace/taskops/cli/lib-runtime-adapters.js:331) | 자체 provider 호출·tool loop·세션 저장을 가진 native executor를 추가한다. |
| 높음 | executor 호출은 `spawnSync`다. 이 호출을 독립 agent의 supervisor에 그대로 넣으면 실행 중 제어 메시지·취소 처리가 막힌다. | [lib-runtime-adapters.js](/home/jimmy/workspace/taskops/cli/lib-runtime-adapters.js:362) | supervisor는 async child lifecycle을 소유하고 기존 동기 runner를 별도 process에서 실행한다. |
| 높음 | `initProject`는 work와 빈 root version을 만들며 task를 만들지 않는다. objective만 입력한 새 agent는 이 상태에서 실행할 일이 없다. | [lib-taskops.js](/home/jimmy/workspace/taskops/cli/lib-taskops.js:2711), §5 probe | agent의 objective 진입점에서 미완료 root planning task를 정직하게 seed한다. 빈 work의 완료 판정은 현재처럼 거절한다. |
| 중간 | `typecheck`와 `build`는 안내 문자열을 출력하고 종료한다. 정적 타입 검사·컴파일을 수행하지 않는다. | [package.json](/home/jimmy/workspace/taskops/cli/package.json) | 실제 syntax/protocol/runtime 검사를 추가하고 CI 결과의 의미를 명시한다. |
| 중간 | runner가 8,800줄이며 execution·decomposition·retry·closure·budget·uncertainty를 함께 담당한다. | [lib-runner.js](/home/jimmy/workspace/taskops/cli/lib-runner.js) | 새 provider/kernel/session 로직은 별도 agent workspace에 두고 기존 엔진에는 좁은 adapter/context 경계만 추가한다. |
| 중간 | 활성 workspace와 문서 검사가 skill 중심 구조를 고정한다. | [check-repository-scope.mjs](/home/jimmy/workspace/taskops/scripts/check-repository-scope.mjs:26), [check-contract-docs.mjs](/home/jimmy/workspace/taskops/scripts/check-contract-docs.mjs:31), [REPOSITORY_SCOPE.md](/home/jimmy/workspace/taskops/docs/REPOSITORY_SCOPE.md) | agent를 활성 표면으로 등록하고 행동 계약의 기준을 새 AGENT 문서로 옮긴다. |

위 표는 실제 확인된 구조적 제약과 전환 위험이다. 검토한 81개 회귀 script에서는 코드 실패가 없었다.

## 3. 보존할 검증 경계

- task decomposition truth와 run execution truth를 분리한다.
- Markdown·selected version/snapshot을 정본으로 유지한다.
- 구조적 종결과 policy-approved 완료를 구분한다.
- `graph_closed_unapproved`, `blocked_only`, `waiting`, partial, malformed graph를 완료로 바꾸지 않는다.
- worker가 그래프 제어·EoW를 소유하지 않는다.
- 실패 진단을 retry에 전달하고 반복 실패를 유한하게 처리한다.
- failure certificate의 content/infra/protocol 및 verified/undetermined 구분을 유지한다.
- source task/version/run node와 검증 증거의 연결을 유지한다.

근거: [lib-runner.js](/home/jimmy/workspace/taskops/cli/lib-runner.js:76),
[lib-state-writer.js](/home/jimmy/workspace/taskops/cli/lib-state-writer.js),
[failure-certificate.md](/home/jimmy/workspace/taskops/docs/specs/failure-certificate.md).
이 경계의 대표 회귀는 §5의 closure·audit·retry·failure·budget tests다.

## 4. Prime / Melete 참조 범위

| 참조 | 로컬 revision | 확인한 접점 |
| --- | --- | --- |
| Prime Agent | `f5dede192b4d10a21062fa74ae1a7b37c3bb0d0f`, package v0.9.2 | 지속 Python kernel, programmatic context, typed host request, session snapshot, immutable base와 supplemental harness |
| Melete | `671aed26a1128ad45bedf8c3ee31c6559fcdadef` | source/scope/action/frame provenance, source/case/rule 기본값, owned JSON-lines runtime, stdio MCP query/feedback |

Prime 참조:
[rlm.md](/home/jimmy/repos/prime-agent/packages/coding-agent/docs/rlm.md),
[rlm-runtime.md](/home/jimmy/repos/prime-agent/packages/coding-agent/docs/rlm-runtime.md),
[architecture.md](/home/jimmy/repos/prime-agent/packages/coding-agent/docs/architecture.md),
[refinement.ts](/home/jimmy/repos/prime-agent/packages/coding-agent/src/core/refinement/refinement.ts).

Melete 참조:
[STATUS.md](/home/jimmy/repos/melete/STATUS.md),
[CONTEXT.md](/home/jimmy/repos/melete/CONTEXT.md),
[product-contract.md](/home/jimmy/repos/melete/docs/product-contract.md),
[runtime_cli.py](/home/jimmy/repos/melete/packages/melete-adapters/src/melete_adapters/runtime_cli.py),
[server.py](/home/jimmy/repos/melete/packages/melete-adapters/src/melete_adapters/mcp/server.py),
[session_kernel.py](/home/jimmy/repos/melete/packages/melete-adapters/src/melete_adapters/session_kernel.py).

Melete MCP의 현재 tools는 `melete_capabilities`, `melete_query`, `melete_feedback`다.
feedback tool을 검증된 task outcome의 write API로 간주해서는 안 된다.
후속 adapter는 실제 capability를 확인하고 source intake/action measurement 경로를 별도로 연결해야 한다.
이 검토에서는 참조 저장소·사용자 전역 설정을 수정하거나 live Melete에 기록하지 않았다.

## 5. 실제 실행 증거

### 환경과 명령

- Node: `/home/linuxbrew/.linuxbrew/bin/node`, 실제 출력 `v25.6.1`.
- Python: `python3 --version`, 실제 출력 `Python 3.14.3`.
- 테스트 cwd: `/home/jimmy/workspace/taskops/cli`.
- 실행 형태: 아래 각 script에 `/home/linuxbrew/.linuxbrew/bin/node ./scripts/<name>.mjs`.
- 호출별 timeout은 15초였고 모든 script가 정상 종료했다.
- 기존 CI는 Node 22를 지정한다. 이 baseline을 Node 22 실행 결과로 확대하지 않는다.

| 실행 묶음 | script 수 | 통과 | 실패 | 실제 summary |
| --- | ---: | ---: | ---: | --- |
| 1 | 22 | 22 | 0 | `{"block":1,"passed":22,"failed":0,"plannedTotal":81}` |
| 2 | 44 | 44 | 0 | `{"block":2,"from":22,"to":66,"passed":44,"failed":0,"plannedTotal":81}` |
| 3 | 15 | 15 | 0 | `{"block":3,"passed":15,"failed":0,"plannedTotal":81}` |
| 합계 | 81 | 81 | 0 | 모든 script exit 0 |

이 수는 script 실행 수다. 모든 script 내부의 test case/assertion 수를 합산한 값은 아니다.
`npm run verify` 전체를 실행한 결과로 보고하지 않는다.
첫 탐색 호출은 context-mode의 `process.execPath`가 Bun이라 3개 script에서 runtime 오류가 발생했다.
실제 Node 경로를 지정한 재실행 81개의 결과만 위 baseline에 포함했다.

### 실행 script 목록

```text
run-node-action-attempt-identity.mjs
eow-identity-codec.mjs
eow-global-identity.mjs
dynamic-closure-liveness.mjs
state-writer-frontmatter.mjs
state-writer-run-graph.mjs
eow-resolver-backlink.mjs
eow-resolver-decompose-wiring.mjs
external-resolver-emit.mjs
external-resolution-status.mjs
resolver-kind-enum.mjs
self-resolution-guide.mjs
self-guide-file-loading.mjs
self-stamp-on-decompose.mjs
external-resolution-template.mjs
e2e-self-resolution-pipeline.mjs
execute-closure-writer.mjs
decompose-closure-writer.mjs
version-flow-writer.mjs
readiness-gate.mjs
uncertainty-readiness.mjs
uncertainty-lineage.mjs
uncertainty-lineage-convergence.mjs
uncertainty-live-observability.mjs
expected-plan-preservation.mjs
expected-plan-progress.mjs
expected-plan-phase-surface.mjs
restart-blockedby-rebase.mjs
concurrent-target-validation-isolation.mjs
decomposition-prompt-workdir.mjs
artifact-prompt-paths.mjs
semantic-acceptance-review.mjs
closure-summary-policy.mjs
budget-injection.mjs
partial-completion.mjs
partial-promotion-plan.mjs
audit-gates.mjs
mutation-lock-ownership.mjs
heartbeat-self-lease.mjs
orchestrator-terminal-audit.mjs
policy-approval-evidence.mjs
uncertainty-known-bypass.mjs
self-declaration-holes.mjs
external-resolution-gate.mjs
executor-disclosure.mjs
manual-close-partial-guard.mjs
invalid-graph-not-complete.mjs
work-status-closure-observability.mjs
mutation-lock-pid-reuse.mjs
verify-resolver.mjs
continue-on-failure.mjs
orchestrator-verify-checks.mjs
verify-retries.mjs
retry-feedback-detail.mjs
comprehension-quiz.mjs
unknown-knowns.mjs
verify-isolation.mjs
training-data.mjs
mutation-lock-stale-reap.mjs
delegation-integrity.mjs
delegation-loop.mjs
epistemic-loop.mjs
failure-certificate.mjs
budget-vector.mjs
oracle-access.mjs
failure-probes.mjs
success-flaky-recheck.mjs
progress-ledger.mjs
exploration-nonclosing.mjs
exploration-acceptance-guard.mjs
done-actionable-readiness-invalid.mjs
closure-superseded-blocker-isolation.mjs
restart-semantic-contract.mjs
navigation-approval-parity.mjs
inherited-known-nonclosing.mjs
json-stdout-lifecycle.mjs
convergence-decompose-prompt-injection.mjs
convergence-hard-child-clamp.mjs
convergence-decomposition-quality-unit.mjs
workflow-e2e-lifecycle.mjs
workflow-e2e.mjs
```

### objective만 있는 빈 work probe

임시 directory에서 `initProject` → `parseProject` → `auditParsedWork` →
`computeNextAction` → `runTaskOps({executor:"dry-run",maxSteps:1})`를 실행했다.
실제 process exit는 0이며 다음 결과를 얻었다.

```json
{
  "terminalTaskCount": 0,
  "validationErrors": [],
  "structuralComplete": false,
  "policyApprovedComplete": false,
  "nextAction": "no_runnable",
  "auditClaimSafe": false,
  "runStopReason": "no_runnable",
  "stepsRun": 0,
  "workStatus": "active"
}
```

빈 work를 완료로 오인하지 않는 현재 동작은 적절하다.
독립 agent의 objective 진입점에는 별도 초기 planning task가 필요하다.
probe의 임시 파일은 실행의 finally에서 삭제했다.

### 문서와 저장소 검사

저장소 root에서 다음 명령을 실제 실행했다.

| 명령 | 실제 출력 | exit |
| --- | --- | ---: |
| `node scripts/check-repository-scope.mjs` | `OK repository scope` | 0 |
| `node scripts/check-version-sync.mjs` | `OK: version sync 0.10.1` | 0 |
| `node scripts/check-contract-docs.mjs` | `OK: contract docs align with v1 terminology and paths` | 0 |

신규 두 문서의 별도 QA는 absolute link 25개, 상대 링크 0개,
missing target 0개, placeholder 0개, 기록된 test script 81개/중복 0개를 확인했다.
실제 summary는 `DOC QA {"passed":true,"failures":[]}`다.

### 보조 판단

`decision-models` Jev를 명시적 후보 선택에 한 번 사용했다.
request `20e27f54-6f76-4bd0-81ba-8e5ad0175286`,
returned model `typesafe/jev-1.13-20260917`,
기록된 비용 `$0.000053886`다.

제안은 native runtime, 첫 increment의 programmatic context, 자동 refinement의 후순위 배치,
명시적 허가가 있는 후속 recursive delegation, 선택적 Melete port/outbox였다.
이는 설계의 보조 의견이며 사용자 승인·검증 PASS·구현 증거가 아니다.

## 6. 검토 한계

이 검토는 로컬 source/revision과 위 baseline에 기반한다.
새 native provider/kernel/session/cancellation/Melete adapter는 아직 구현·실행되지 않았다.
실제 LLM 품질, context 절감, 기존 runner 대비 효용, 장시간 재개/운영 효과는 측정하지 않았다.
이 기록을 agent 전환 완료나 일반 학습 효용의 근거로 사용하지 않는다.
