// ---- Progress ledger (발산/수렴 축; spec: docs/theory/divergence-convergence-v0.md) ------------------------
// 정직성 축(claimSafe = 말한 완료가 진짜 완료인가)과 직교하는 두 번째 축을 계측한다: work = 자유에너지
// F=E_q[U]−T·H[q] 의 gradient flow이고 그 접공간은 transport(수렴-해결) ⊕ reaction(발산 / 수렴-소거)으로
// 갈린다(이론 §3). 이 원장은 세 채널을 따로 장부한다 (단일 ± 점수 금지 — 상쇄로 정보 손실):
//   · A_div              (reaction⁺, 발산):   새 possibility mass 열기 — surpriseHistory penalty + 분해 log-branching
//   · A_conv_transport   (수렴-해결):          해로 질량 이동 — verified-close × assuranceTier
//   · A_conv_elim        (reaction⁻, 소거):    죽은 mass 제거 — 인증된 종단 실패(failureTier)
//
// 핵심 불변식 (이론 §3.2): 상태합산 금지, 경로-작용(path-action) 적분만. 정보량은 subadditive
// (K(x,y) ≤ K(x)+K(y))이므로 "현재 열린 unknown 개수" 같은 종단 상태를 더하면 종속 task 간 공유정보를
// 이중계상한다. 반드시 궤적을 시간순으로 걸으며 append-only 발생(surpriseHistory 항목·분해·EoW 닫힘·종단
// 실패)의 증분을 해당 채널에 더한다: ∫rate dt = Σ(궤적상 event magnitude). task.unknowns[](상태 총량)는
// 의도적으로 읽지 않는다. progress(κ)와 정직성(claimSafe)은 하나의 점수로 합치지 않고 직교 sibling으로 보고한다.
//
// 이 지표는 Tier-1 rate proxy다: 자유상수(T, κ scale, ground metric)를 고정하지 않았으므로 절대량이 아니라
// 서수적/상대적 지표이며, κ→1(수렴)을 자동 보상하면 조기수렴=국소최적을 상 주는 Goodhart 함정이다(이론 §4.3).
// 이 module은 순수함수다: parsed(=parseProject 반환)만 읽고, 파일 I/O·mutation 없음, 알 수 없는 runNode
// type에 절대 throw 하지 않는다(runNode.type은 enum 없음 — lib-taskops.js:977은 status만 검증).

// DONE 측 assurance 사다리 — lib-audit.js:313의 module-private 상수를 byte-동일하게 재선언(의도적 중복;
// lib-audit는 손대지 않는다). transport magnitude를 정직성 축에 연결한다: self_verified(2) < verified(3).
export const DONE_TIER_RANK = { verified: 3, self_verified: 2, self_reported: 1, unverified: 0 };
// FAIL 측 사다리 — 네 값은 buildFailureCertificate의 failureTier 출력 그대로다(lib-runner.js:3193-3199).
// NOTE: 인증서 없는 blocked/failed close(UNCERTIFIED)는 여기 key가 아니다 — 부재(ABSENCE)로 처리해 magnitude 0 +
// 진단 카운트로 센다(channelMapping). undetermined=0 과 uncertified→0 은 audit의 배제 규칙을 그대로 미러한다.
export const FAIL_TIER_RANK = { verified_failure: 3, runner_rejected: 2, self_reported_failure: 1, undetermined: 0 };
// surprise penalty 가중치 — lib-runner.js:171 SURPRISE_PENALTY_WEIGHTS 와 동일. rawPenalty가 이 가중합으로
// 계산되므로(lib-runner.js:840-846), 보존된 id-array로부터의 재구성이 저장된 rawPenalty와 by construction 일치한다.
export const SURPRISE_PENALTY_WEIGHTS = { wrongKnown: 3, discoveredUnknown: 1, nonBlockingUnknown: 0.5 };

// ---- INTERNAL helpers (lib-audit의 module-private 헬퍼를 자급자족으로 최소 재구현) --------------------------
function activeSnapshot(parsed) {
  return parsed.project?.activeSnapshotId ? parsed.snapshots.get(parsed.project.activeSnapshotId) : null;
}

function selectedPairs(parsed) {
  const snapshot = activeSnapshot(parsed);
  return Array.isArray(snapshot?.selectedVersions) ? snapshot.selectedVersions.filter(Boolean) : [];
}

function selectedVersionIds(parsed) {
  return new Set(selectedPairs(parsed).map((pair) => pair.versionId).filter(Boolean));
}

function selectedTaskGroupIds(parsed) {
  return new Set(selectedPairs(parsed).map((pair) => pair.taskGroupId).filter(Boolean));
}

// 스냅샷/선택이 없으면 ALL task record로 폴백(정확히 lib-audit.js:55-58).
function selectedTasks(parsed) {
  const selected = selectedVersionIds(parsed);
  const tasks = [...parsed.tasks.values()];
  if (selected.size === 0) return tasks;
  return tasks.filter((task) => selected.has(task.taskGroupVersionId));
}

// 선택된 task 중 childTaskGroupId가 (선택된) 그룹이 아닌 것 = 종단(lib-audit.js:62-64). div는 sel, close는 term.
function terminalSelectedTasks(parsed) {
  const selectedGroups = selectedTaskGroupIds(parsed);
  return selectedTasks(parsed).filter((task) => !(task.childTaskGroupId && selectedGroups.has(task.childTaskGroupId)));
}

// task에 붙은 task-EoW (lib-audit.js:104-111 복제).
function taskEows(parsed, task) {
  return [...parsed.eowNodes.values()].filter((eow) => (
    eow.graphType === 'task'
    && eow.attachedToType === 'task'
    && eow.attachedToId === task.id
    && (!eow.taskGroupVersionId || eow.taskGroupVersionId === task.taskGroupVersionId)
  ));
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

// 날짜 문자열(ISO, tz offset 포함 가능)을 ms로. NaN-safe → 0. 호출부가 createdAt??declaredAt??observedAt 를
// 미리 골라 넘긴다(궤적을 명시적 시간순으로 세우기 위한 정렬 키; 채널 합은 순서에 불변).
function ts(x) {
  const parsed = Date.parse(x);
  return Number.isFinite(parsed) ? parsed : 0;
}

// 발산 magnitude — 보존된 id-array에서 재구성(primary, exact). 저장된 entry.rawPenalty와 by construction 일치.
// 세 id-array가 모두 ABSENT일 때만 폴백 사다리: rawPenalty(유한) → surpriseScore·3 → 1. surpriseScore는
// min(1, rawPenalty/3)로 포화(lib-runner.js:846)하므로 절대 primary로 쓰지 않는다.
function penalty(entry) {
  const hasArrays = Array.isArray(entry?.contradictedKnownIds)
    || Array.isArray(entry?.blockingNewUnknownIds)
    || Array.isArray(entry?.nonBlockingNewUnknownIds);
  if (hasArrays) {
    const len = (a) => (Array.isArray(a) ? a.length : 0);
    return SURPRISE_PENALTY_WEIGHTS.wrongKnown * len(entry.contradictedKnownIds)
      + SURPRISE_PENALTY_WEIGHTS.discoveredUnknown * len(entry.blockingNewUnknownIds)
      + SURPRISE_PENALTY_WEIGHTS.nonBlockingUnknown * len(entry.nonBlockingNewUnknownIds);
  }
  if (Number.isFinite(entry?.rawPenalty)) return entry.rawPenalty;
  if (Number.isFinite(entry?.surpriseScore)) return entry.surpriseScore * SURPRISE_PENALTY_WEIGHTS.wrongKnown;
  return 1;
}

// VERSION-SCOPED child count (다중버전 팽창 방지, taskops-B2). scopedTasks는 이미 version-filtered된 선택 세트(sel)라
// superseded child-group 버전이 제외된다: parsed.tasks는 composite taskKey(versionId,taskId)로 keying되고 하나의
// taskGroupId가 여러 버전에 걸치므로, naive한 taskGroupId 필터는 superseded 버전을 세어 log2(1+cc)를 부풀린다.
function childCount(scopedTasks, parentTask) {
  const n = parentTask.childTaskGroupVersionId
    ? scopedTasks.filter((t) => t.taskGroupVersionId === parentTask.childTaskGroupVersionId).length
    : scopedTasks.filter((t) => t.taskGroupId === parentTask.childTaskGroupId).length;
  if (n > 0) return n;
  if (Number.isFinite(parentTask.coverage?.childCount)) return parentTask.coverage.childCount;
  return 1;
}

const LIMITATIONS = [
  'Tier-1 rate proxy: ordinal/relative, not absolute — free constants (T, kappa scale, ground metric) unfixed (theory §4.2/§5.1).',
  'kappaReabsorb is convention-relative and unbounded; kappa->1 is NOT auto-good (may be premature/deceptive convergence, §4.3) — never use as a reward signal or gate.',
  'Progress axis is ORTHOGONAL to claimSafe; reported side-by-side, never merged.',
  'Elim channel is under-instrumented: v0 captures ONLY terminal task-failure elimination. Scope-deferral elimination (committing_scope_deferred) is an events.jsonl-only signal the pure-parsed ledger cannot see (Tier-1.5). Uncertified and undetermined failures are tracked as zero-magnitude diagnostics, EXCLUDED from the kappa numerator so possible infra-flakes are not credited as reabsorption (mirrors lib-audit: uncertified \'must not be counted as a true failure\', undetermined excluded from the failure ledger).',
  'A_div and A_conv are theoretically SLAVED, not independent — both derive from one field δF/δμ (theory §4.1); in a best-effort trajectory they are expected to co-vary (prediction P1), so kappa is a ratio of dynamically-coupled channels, NOT an independent-reabsorption efficiency. This ledger performs channel attribution (which §4.1 permits) and is the instrument for TESTING slaving, not a claim of axis independence.',
  'transportReabsorb is a rank-weighted analog of the theory §5.1 R̂ (certified-solve reabsorption), NOT the literal bounded [0,1] count-ratio: transport is tier-rank (0-3) weighted while divergence is penalty-magnitude weighted, so it is unbounded (>1 possible; TC2=5.0). The theory\'s R̂∈[0,1] is idealized-continuous with no bounded Tier-1 realization.',
];

// ---- PUBLIC API --------------------------------------------------------------------------------------------
// progressLedger(parsed, options?) — parsed의 순수함수. options는 예약(e.g. {runId} per-run scoping); 기본 scope =
// 선택된 종단 세트 + 전-task 폴백. 경로-작용 walk: append-only 발생만 증분으로 더하고 종단-상태 count는 절대 읽지 않는다.
export function progressLedger(parsed, options = {}) {
  const sel = selectedTasks(parsed);
  const term = terminalSelectedTasks(parsed);
  const runNodes = [...(parsed.runNodes?.values?.() ?? [])];

  // 2. 하나의 평평한 증분 배열 events{t,key,channel,magnitude,sub}. key는 VERSION-QUALIFIED(task.taskGroupVersionId
  //    포함) — parsed.tasks가 composite key로 keying되고 같은 task.id가 버전을 넘어 재등장하기 때문. 항상 파싱된
  //    그래프에서만 push(최종-상태 aggregate에서 절대 읽지 않음).
  const events = [];

  // 2a. A_div surprise — sel의 각 task, surpriseHistory의 각 항목 = 그 step이 새로 연 mass의 dated 증분 1개.
  for (const task of sel) {
    const history = Array.isArray(task.surpriseHistory) ? task.surpriseHistory : [];
    for (const entry of history) {
      if (!entry || typeof entry !== 'object') continue;
      events.push({
        t: ts(entry.observedAt),
        key: `div:surprise:${task.taskGroupVersionId}:${task.id}:${entry.id}`,
        channel: 'div',
        magnitude: penalty(entry),
        sub: 'surprise',
      });
    }
  }

  // 2b. A_div decomposition — childTaskGroupId를 가진 각 parent에 대해 log2(1+childCount) 증분 1개(§3.2 Σ_tree log(branching)).
  //     childCount는 VERSION-SCOPED. dnode는 timestamp만 제공(없으면 task.createdAt로 폴백).
  for (const task of sel) {
    if (!task.childTaskGroupId) continue;
    const cc = childCount(sel, task);
    const dnode = runNodes.find((n) => n.type === 'decomposition'
      && n.sourceTaskId === task.id
      && (!n.sourceTaskGroupVersionId || n.sourceTaskGroupVersionId === task.taskGroupVersionId));
    events.push({
      t: ts(dnode?.createdAt ?? task.createdAt),
      key: `div:decomp:${task.taskGroupVersionId}:${task.id}`,
      channel: 'div',
      magnitude: Math.log2(1 + cc),
      sub: 'decomposition',
    });
  }

  // 2c. A_conv_transport — term의 done task마다: tier가 찍힌 task-EoW는 DONE_TIER_RANK로 각각 가산(re-close/복수 EoW
  //     포착, event-faithful); tier 없는 legacy solve close는 floor 1(self_reported-equivalent).
  for (const task of term) {
    if (task.status !== 'done') continue;
    const eows = taskEows(parsed, task);
    const tiered = eows.filter((e) => e.assuranceTier in DONE_TIER_RANK);
    if (tiered.length > 0) {
      for (const e of tiered) {
        events.push({
          t: ts(e.createdAt ?? e.declaredAt),
          key: `tr:${task.taskGroupVersionId}:${task.id}:${e.id}`,
          channel: 'transport',
          magnitude: DONE_TIER_RANK[e.assuranceTier],
          sub: 'tieredClose',
        });
      }
    } else if (eows.length > 0) {
      events.push({
        t: ts(eows[0].createdAt ?? task.createdAt),
        key: `tr:${task.taskGroupVersionId}:${task.id}:legacy`,
        channel: 'transport',
        magnitude: 1,
        sub: 'legacyClose',
      });
    }
  }

  // 2d. A_conv_elim — term의 blocked/failed task(v0의 유일한 elim 소스). 인증된 실패만 magnitude; uncertified/undetermined는
  //     0-magnitude 진단 marker(κ 분자에서 배제 — infra-flake를 reabsorption으로 인정하지 않음).
  //     [step 2e committing_scope_deferred 제거 — dead read path, events.jsonl 전용이라 pure-parsed 원장은 볼 수 없음.]
  //     정렬 키 t=ts(task.createdAt): failureCertificate는 자체 timestamp를 싣지 않는다(buildFailureCertificate
  //     lib-runner.js:3200-3218 미방출; close 사이트 3307/3445/3624/3679/3752 도 task-level 닫힘 시각을 안 쓴다) —
  //     task.createdAt만이 always-present 시각이므로 이를 직접 쓴다(존재한 적 없는 .declaredAt dead read 제거).
  //     채널 합은 순서 불변(§3.2)이라 이 키는 결정적 정렬·미래 rate/slope 진단에만 쓰이고 magnitude엔 영향 없다.
  for (const task of term) {
    if (!['blocked', 'failed'].includes(task.status)) continue;
    if (task.failureCertificate) {
      const ft = task.failureCertificate.failureTier;
      const mag = ft in FAIL_TIER_RANK ? FAIL_TIER_RANK[ft] : 0;
      if (mag > 0) {
        events.push({
          t: ts(task.createdAt),
          key: `el:${task.taskGroupVersionId}:${task.id}`,
          channel: 'elim',
          magnitude: mag,
          sub: 'taskFailure',
        });
      } else {
        events.push({
          t: ts(task.createdAt),
          key: `el:undet:${task.taskGroupVersionId}:${task.id}`,
          channel: 'elim',
          magnitude: 0,
          sub: 'undetermined',
        });
      }
    } else {
      events.push({
        t: ts(task.createdAt),
        key: `el:unc:${task.taskGroupVersionId}:${task.id}`,
        channel: 'elim',
        magnitude: 0,
        sub: 'uncertified',
      });
    }
  }

  // 3. SORT — (t, key) 오름차순으로 안정·결정적. 명시적 시간순 궤적을 만든다(채널 합은 순서 불변이지만 결정성/
  //    미래 rate·slope 진단을 위해 정렬을 유지). ISO tz offset은 Date.parse가 흡수; 동시각은 version-qualified key로 tie-break.
  events.sort((a, b) => (a.t - b.t) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // 4. WALK once — 채널 총합 누적(= ∫rate dt) + 채널별 count/sub 소계/진단 카운터.
  let aDiv = 0;
  let aConvTransport = 0;
  let aConvElim = 0;
  const div = { count: 0, magnitude: 0, surprise: 0, decomposition: 0 };
  const transport = { count: 0, magnitude: 0 };
  const elim = { count: 0, magnitude: 0, taskFailure: 0, uncertifiedCount: 0, undeterminedCount: 0 };
  for (const ev of events) {
    if (ev.channel === 'div') {
      aDiv += ev.magnitude;
      div.count += 1;
      div.magnitude += ev.magnitude;
      if (ev.sub === 'surprise') div.surprise += ev.magnitude;
      else if (ev.sub === 'decomposition') div.decomposition += ev.magnitude;
    } else if (ev.channel === 'transport') {
      aConvTransport += ev.magnitude;
      transport.count += 1;
      transport.magnitude += ev.magnitude;
    } else if (ev.channel === 'elim') {
      if (ev.sub === 'taskFailure') {
        aConvElim += ev.magnitude;
        elim.count += 1;
        elim.magnitude += ev.magnitude;
        elim.taskFailure += ev.magnitude;
      } else if (ev.sub === 'uncertified') {
        elim.uncertifiedCount += 1;
      } else if (ev.sub === 'undetermined') {
        elim.undeterminedCount += 1;
      }
    }
  }

  // 5. DERIVE scalars — κ는 aDiv===0일 때 null(Infinity/NaN 금지), UNBOUNDED(클램프 금지). residual은 음수 허용.
  const aConv = aConvTransport + aConvElim;
  const kappaReabsorb = aDiv === 0 ? null : round3(aConv / aDiv);
  const transportReabsorb = aDiv === 0 ? null : round3(aConvTransport / aDiv);
  const residual = round3(aDiv - aConv);

  return {
    tier: 'tier-1-rate-proxy',
    aDiv: round3(aDiv),
    aConvTransport: round3(aConvTransport),
    aConvElim: round3(aConvElim),
    aConv: round3(aConv),
    kappaReabsorb,
    transportReabsorb,
    residual,
    channels: {
      div: { count: div.count, magnitude: round3(div.magnitude), surprise: round3(div.surprise), decomposition: round3(div.decomposition) },
      transport: { count: transport.count, magnitude: round3(transport.magnitude) },
      elim: { count: elim.count, magnitude: round3(elim.magnitude), taskFailure: round3(elim.taskFailure), uncertifiedCount: elim.uncertifiedCount, undeterminedCount: elim.undeterminedCount },
    },
    limitations: LIMITATIONS,
  };
}

// renderProgressLedgerText(ledger) — renderAuditText가 push할 단일 라인(trailing newline 없음). caveat가 숫자와
// 함께 이동하도록 '(ordinal rate proxy; not a reward)'로 끝맺는다. 안정 substring: 'progress tier=', 'kappa=',
// 'A_div=', 'A_conv_transport=', 'A_conv_elim='.
export function renderProgressLedgerText(ledger) {
  return `progress tier=${ledger.tier} kappa=${ledger.kappaReabsorb ?? 'na'} A_div=${ledger.aDiv} A_conv_transport=${ledger.aConvTransport} A_conv_elim=${ledger.aConvElim} residual=${ledger.residual} (ordinal rate proxy; not a reward)`;
}
