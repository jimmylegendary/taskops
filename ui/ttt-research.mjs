#!/usr/bin/env node
// TaskOps work: "test-time training -> 2030 memory-device / AI-workload / market prediction" research, run by
// openclaw in Korean, with 3 human-in-the-loop gates. 4 waves, 15 tasks, dependencies via blockedBy.
//   usage: node ui/ttt-research.mjs [work-dir] [language]
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fmBlock } from '../cli/lib-taskops.js';
import { EXTERNAL_RESOLUTION_TEMPLATE } from '../cli/lib-runner.js';

const now = '2026-07-07T00:00:00.000Z';
const w = process.argv[2] || '/home/jimmy/taskops-runs/ttt-memory-2030';
const language = process.argv[3] || '한국어';
if (existsSync(w)) rmSync(w, { recursive: true, force: true });
const tv = 'task-groups/tg-root/versions/tgv-root-v1';
const md = (p, fm, b) => { mkdirSync(join(w, p, '..'), { recursive: true }); writeFileSync(join(w, p), `${fmBlock(fm)}${b || `# ${fm.id}\n`}`, 'utf8'); };
md('index.md', { taskOpsVersion: 'v1', entityType: 'work', id: 'ttt2030', title: 'TTT → 2030 memory/AI/market prediction', objective: 'Test-time training으로 AI의 일관성·continual learning 문제를 어떻게 풀지, 그리고 그로 인해 2030년에 등장할 신규 메모리 소자·AI 워크로드·시장을 시뮬레이션과 DSE로 종합 예측한다.', language, activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' });
md('task-groups/tg-root/index.md', { taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective: 'x', activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' });
md(`${tv}/index.md`, { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 's', selected: true, createdAt: now, status: 'active' });
md('snapshots/snapshot-root-v1.md', { taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'R', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] });

let order = 0;
const T = (id, title, objective, opts = {}, body) => md(`${tv}/tasks/${id}.md`, {
  taskOpsVersion: 'v1', entityType: 'task', id, taskGroupId: 'tg-root', taskGroupVersionId: 'tgv-root-v1',
  title, objective, responsibility: opts.responsibility || '해당 산출물을 근거와 함께 작성', completionCriteria: opts.completionCriteria || '근거 있는 한국어 산출물이 작성됨',
  order: (order += 1), createdAt: now, status: opts.status || 'pending', runReadiness: opts.runReadiness || 'runnable', understandingLevel: 'known',
  acceptance: { mode: 'informational', expectedOutcome: opts.expectedOutcome || '한국어 마크다운 산출물' },
  ...(opts.resolverKind ? { resolverKind: opts.resolverKind } : {}),
  ...(opts.blockedBy ? { blockedBy: opts.blockedBy.map((t) => ({ type: 'task', taskId: t })) } : {}),
}, body);
const blocked = (ids) => ({ status: 'blocked', runReadiness: 'blocked', blockedBy: ids });
const human = (ids) => ({ resolverKind: 'human', status: 'blocked', runReadiness: 'blocked', blockedBy: ids, responsibility: '방향을 결정한다', completionCriteria: '인간이 방향을 결정함' });
const gate = (q, o) => EXTERNAL_RESOLUTION_TEMPLATE
  .replace('<agent: the single decision that could not be settled — one decision unit, crisp>', q)
  .replace('<agent: candidate answers with trade-offs; if you cannot enumerate them, add an\nexplicit "open:" line naming what is unknown — do not leave this empty>', o);

// ── Wave 1 — 기초 이해 (5 병렬, 독립) ──
T('mem-devices', '메모리 소자 지형', '메모리 소자 지형을 정리하라: SRAM/DRAM/HBM 및 신흥 NVM(ReRAM/PCM/MRAM/FeFET/3D-NAND). 각각의 용량밀도·대역폭·지연·쓰기 내구성(endurance)·에너지·비용을 표로 비교하고, AI 학습/추론 관점의 강·약점을 3줄로 요약하라.');
T('accelerators', '가속기 아키텍처와 메모리 계층', 'AI 가속기 아키텍처(GPU/TPU/NPU/systolic/dataflow/PIM·in-memory compute)를 메모리 계층 관점에서 정리하라. 각 구조가 대역폭/용량/데이터이동 병목을 어떻게 다루는지, 학습 vs 추론에서 메모리 압박이 어디서 오는지 설명하라.');
T('ttt-history', 'Test-Time Training 기술사', 'test-time training(TTT)의 기술 역사를 시간순으로 정리하라: test-time adaptation/BN-adaptation → TTT(자기지도 보조과제) → TTT layers → 2024–2025의 TTT-as-RNN/선형어텐션·상태갱신 계열. 각 단계의 핵심 아이디어·한계·대표 연구를 요약하라.');
T('ai-problems', '현 AI의 핵심 문제', '현재 대형 AI 모델의 핵심 문제를 정리하라: (1) 일관성(consistency), (2) continual learning/catastrophic forgetting, (3) 컨텍스트·장기기억 한계, (4) 배포 후 정적(frozen) 가중치. 각 문제가 실제로 어디서 드러나는지 예시와 함께 설명하라.');
T('ttt-mem-demands', 'TTT의 메모리·연산 요구', 'test-time training이 표준 추론/학습과 다르게 메모리·연산을 압박하는 지점을 분석하라: 추론 중 가중치/상태 갱신(write-heavy), 상태 보존 용량, 대역폭, 쓰기 내구성, 지연 예산. 왜 기존 추론용 메모리 계층으로는 부족한지 논증하라.');

// ── Wave 2 — 분석 ──
T('ttt-solves', 'TTT가 문제를 푸는 방식', 'test-time training이 AI의 일관성과 continual learning을 구체적으로 어떻게 개선하는지, ttt-history/ai-problems/ttt-mem-demands의 결과를 종합해 메커니즘 수준에서 설명하라. 남는 미해결 난점도 명시하라.', blocked(['ttt-history', 'ai-problems', 'ttt-mem-demands']));
T('focus-decision', '[HUMAN] 2030 투영의 초점 결정', '2030년 예측의 초점을 어떤 TTT 패러다임과 시나리오로 잡을지 인간이 결정한다. 결정된 방향을 기록한다.', human(['ttt-solves', 'mem-devices', 'accelerators']),
  gate('2030 예측의 초점을 어떤 TTT 패러다임 + 시나리오로 잡을까요?',
    'A) online/streaming TTT — 매 요청·토큰마다 가중치를 갱신(가장 write-heavy, 내구성 병목).\nB) episodic/session TTT — 세션·태스크 단위 적응(중간, 상태 캐시 중심).\nC) weight-streaming/외부메모리 TTT — 대규모 파라미터를 계층 메모리에서 스트리밍(용량·대역폭 병목).\nopen: 셋 중 하나 또는 조합을 고르고, 대상 규모(엣지/데이터센터)와 시간지평(2030)을 함께 지정.'));

// ── Wave 3 — 시뮬레이션 / DSE ──
T('workload-sim', '2030 TTT 워크로드 시뮬레이션', '선택된 TTT 초점(focus-decision의 결정을 반영)에 대해 2030년 스케일의 워크로드 특성을 시뮬레이션/추정하라: 필요한 메모리 대역폭·용량·쓰기 빈도/내구성·지연 envelope를 수치 범위로 제시하고, 가정과 계산 근거를 밝혀라.', blocked(['focus-decision', 'ttt-mem-demands']));
T('dse-priorities', '[HUMAN] DSE 우선순위 결정', 'DSE(설계공간탐색)에서 무엇을 최우선으로 최적화할지 인간이 결정한다.', human(['workload-sim']),
  gate('메모리 소자 DSE에서 최우선 순위를 어떻게 둘까요? (순위/가중치로)',
    'A) 대역폭(bandwidth) 우선 — 처리량 한계 돌파.\nB) 쓰기 내구성(endurance) 우선 — TTT의 잦은 갱신 견디기.\nC) 용량/비용(capacity/$) 우선 — 대규모 상태·파라미터 수용.\nD) 지연(latency) 우선 — online 갱신의 실시간성.\nopen: 위 축들의 우선순위(예: B>A>D>C)와 하드 제약(전력예산/폼팩터/공정노드)을 지정.'));
T('dse-explore', 'DSE 설계공간 탐색', 'workload-sim의 요구와 dse-priorities의 우선순위를 제약으로, 2030 TTT용 메모리 소자 설계공간을 탐색하라. 후보 소자 유형(신흥 NVM/PIM/HBM 변형 등)별로 spec 포인트를 만들고, 우선순위 기준의 점수/트레이드오프 표로 상위 후보를 선정하라.', blocked(['workload-sim', 'dse-priorities']));

// ── Wave 4 — 예측 / 종합 (3 병렬) → 인간 검토 → 최종 ──
T('mem-device-spec', '신규 2030 메모리 소자 spec', 'dse-explore의 상위 후보를 바탕으로 2030년 등장할 신규 메모리 소자의 구체 spec을 제시하라: 용량밀도, 대역폭(TB/s), 쓰기 내구성(cycles), 지연(ns), 에너지(pJ/bit), 공정/집적 방식, 인터페이스. 오늘 대비 무엇이 새로운지 명확히.', blocked(['dse-explore', 'mem-devices']));
T('ai-workload-2030', '2030 AI 워크로드의 모습', 'TTT가 주류화된 2030년 AI 워크로드의 모습을 예측하라: 학습/추론 경계의 변화, 메모리-연산 비율, 배치·서빙 패턴, 엣지 vs 데이터센터 분화, 소프트웨어 스택 변화.', blocked(['dse-explore', 'ttt-solves']));
T('market-2030', '2030 메모리·AI HW 시장의 모습', '위 소자·워크로드 전제에서 2030년 시장 모습을 예측하라: 핵심 플레이어(메모리/파운드리/가속기/시스템), TAM·성장률 추정, 채택 곡선, 밸류체인 재편, 리스크/불확실성.', blocked(['dse-explore']));
T('synthesis-review', '[HUMAN] 최종 예측 방향 검토', '최종 보고 전에, 3개 예측(소자 spec/AI 워크로드/시장)의 헤드라인 방향을 인간이 확인·조정한다.', human(['mem-device-spec', 'ai-workload-2030', 'market-2030']),
  gate('세 예측의 헤드라인 방향을 이대로 최종화할까요, 아니면 특정 부분을 강조/수정할까요?',
    'A) 이대로 최종화 — 세 산출물을 그대로 종합.\nB) 강조/수정 — 어떤 축(소자/워크로드/시장)을 더 밀거나, 특정 가정(시간지평/규모/기술)을 바꿀지 지정.\nopen: 최종 보고서의 핵심 주장 1–2개를 직접 못박아 주면 그 방향으로 종합.'));
T('final-report', '종합 최종 보고서', 'synthesis-review의 결정을 반영해, 전체를 관통하는 한국어 종합 보고서를 작성하라: 문제→TTT 해법→2030 소자 spec→AI 워크로드→시장, 을 하나의 서사로 엮고 핵심 예측·근거·불확실성을 정리하라.', blocked(['synthesis-review']));

console.log(w);
