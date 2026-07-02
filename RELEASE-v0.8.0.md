# TaskOps v0.8.0 — Self-Resolution (delegation mode)

External-resolver task의 첫 경로인 self-resolution을 추가한다. 위임모드에서 실행이
결정 지점에 막혀도 멈추지 않고, 가정을 명시적으로 남기며 스스로 진행한다.

## What's in
- `resolverKind` enum (`human` | `ai` | `self`) — task 속성으로 검증됨.
- self-resolution guide 주입: `resolverKind: self`인 task 또는 `--delegate` 모드에서
 실행 프롬프트에 XML runbook guide가 주입됨. guide는 `ASSUMPTION -> DECISION -> BASIS`
 형식으로 가정을 명시하도록 지시한다.
- guide 외부 로딩: `--self-guide-file <path>`로 skill md에서 guide를 불러올 수 있음.
 기본값은 내장 상수, 파일 부재 시 명시적 error(silent fallback 없음).
- 생성 편향: 위임모드 decompose가 낳는 자식을 `resolverKind: self`로 스탬프.
- Tier 1 파이프라인 게이트: 전체 runner를 위임모드로 구동하는 결정론적 e2e —
 self 자식이 runnable+self로 생성되고, block 없이 완주하며, 가정이 요약에 기록됨.

## Behavioral evidence (관측)
gpt-5.5 / OpenClaw에서 under-specified work(핵심 값 미지정)를 위임모드로 5회 실행:
- 5/5 완주, block/waiting 없음.
- 4/5에서 미지정 값을 `ASSUMPTION -> DECISION -> BASIS`로 명시하고 진행(self-resolution 관측).
- 나머지 1회도 완주했으나 명시 가정이 다른 지점(module format)에 대한 것이었음.
이는 하드 게이트가 아니라 관측 증거이며, N=5의 소규모 표본이다.

## Known Limitations
- external-resolver의 human/ai 경로(park/resume, waiting-external 뷰, 파일 ingest)는
 미구현 — v0.9 예정. `human`/`ai` 값은 예약·검증만 되고 실행 동작은 없음.
- Tier 2는 관측 증거지 결정론적 게이트가 아님.

## Rollback
- v0.7.0 @ `9469e2c` (직전 안정 버전).

## Merged slices
A1 EoW backlink · A2 resolverKind enum · A2.5a guide 주입 · A2.5a-2 md 로딩 ·
A2.5b-1 task-level 트리거 · A2.5b-2 self 스탬프 · E2E-T1 파이프라인 게이트.
