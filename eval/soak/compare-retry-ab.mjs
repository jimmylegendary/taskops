#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from 'node:path';
import {
  PAIRED_MIN_P,
  liftInterval,
  mcnemar,
  pairedVerdict,
} from './mcnemar.mjs';

const NL = String.fromCharCode(10);
const here = dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const evalRoot = dirname(here);
const searchDepth = 6;
const defaults = {
  blind: join(here, 'stage-pro-gpt54low-lift.json'),
  informed: join(here, 'stage-pro-gpt54low-informed.json'),
  out: join(here, 'RETRY-AB-COMPARE.json'),
  runGlob: '/tmp/taskops-swepro-',
};
const usage = [
  '사용법: node eval/soak/compare-retry-ab.mjs [--blind <config>] [--informed <config>] [--out <path>] [--run-glob <dir prefix>]',
  '',
  '기본값: blind=stage-pro-gpt54low-lift.json, informed=stage-pro-gpt54low-informed.json, out=eval/soak/RETRY-AB-COMPARE.json, run-glob=/tmp/taskops-swepro-',
].join(NL);

function parseArgs(argv) {
  const options = { ...defaults, help: false };
  const names = new Map([
    ['--blind', 'blind'],
    ['--informed', 'informed'],
    ['--out', 'out'],
    ['--run-glob', 'runGlob'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const name = names.get(arg);
    if (!name) throw new Error('알 수 없는 인자입니다: ' + arg + NL + usage);
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) {
      throw new Error(arg + ' 뒤에 값이 필요합니다.' + NL + usage);
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function inputPath(value) {
  if (isAbsolute(value)) return value;
  const fromCwd = resolve(process.cwd(), value);
  return existsSync(fromCwd) ? fromCwd : resolve(here, value);
}

function outputPath(value) {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function loadConfig(path, requiredArms) {
  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error('스테이지 config를 읽지 못했습니다: ' + path + ' (' + error.message + ')');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('스테이지 config가 객체가 아닙니다: ' + path);
  }
  if (typeof config.stage !== 'string' || !config.stage) {
    throw new Error('스테이지 config에 stage가 없습니다: ' + path);
  }
  if (!Array.isArray(config.instances) || config.instances.some((id) => typeof id !== 'string')) {
    throw new Error('스테이지 config의 instances가 문자열 배열이 아닙니다: ' + path);
  }
  if (!Array.isArray(config.arms)) {
    throw new Error('스테이지 config의 arms가 배열이 아닙니다: ' + path);
  }
  for (const key of requiredArms) {
    const arm = config.arms.find((item) => item && item.key === key);
    if (!arm) throw new Error('스테이지 config에 ' + key + ' arm이 없습니다: ' + path);
    if (typeof arm.claimField !== 'string' || typeof arm.resultPattern !== 'string') {
      throw new Error(key + ' arm의 claimField/resultPattern이 올바르지 않습니다: ' + path);
    }
    if (!arm.resultPattern.includes('{id}')) {
      throw new Error(key + ' arm의 resultPattern에 {id}가 없습니다: ' + path);
    }
  }
  return config;
}

function armOf(config, key) {
  return config.arms.find((arm) => arm.key === key);
}

function resultPath(arm, id) {
  const expanded = arm.resultPattern.replace('{id}', id);
  return isAbsolute(expanded) ? expanded : resolve(evalRoot, expanded);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// 파일 없음, 파싱 실패, 판정 불가를 서로 섞지 않고 report-stage 규약대로 분류한다.
function readRows(config, arm) {
  const judgeField = config.judgeField || 'official_resolved';
  return config.instances.map((id) => {
    const path = resultPath(arm, id);
    if (!existsSync(path)) {
      return { id, path, found: false, parsed: false, decided: false, cls: 'not_run', claim: null, judge: null, wallclockS: null, result: null, note: '결과 파일 없음' };
    }
    let result;
    try {
      result = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return { id, path, found: true, parsed: false, decided: false, cls: 'undetermined', claim: null, judge: null, wallclockS: null, result: null, note: '결과 JSON 파싱 실패' };
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return { id, path, found: true, parsed: true, decided: false, cls: 'undetermined', claim: null, judge: null, wallclockS: null, result, note: '결과 JSON이 객체가 아님' };
    }
    const claim = result[arm.claimField] === true;
    const judge = result[judgeField];
    const wallclockS = finite(result.wallclock_s);
    if (judge !== true && judge !== false) {
      return { id, path, found: true, parsed: true, decided: false, cls: 'undetermined', claim, judge: null, wallclockS, result, note: judgeField + '가 불리언이 아님' };
    }
    const cls = claim && judge ? 'TP' : claim && !judge ? 'FP' : !claim && judge ? 'FN' : 'TN';
    return { id, path, found: true, parsed: true, decided: true, cls, claim, judge, wallclockS, result, note: null };
  });
}

function armStats(rows, expected) {
  const count = (cls) => rows.filter((row) => row.cls === cls).length;
  const TP = count('TP');
  const FP = count('FP');
  const FN = count('FN');
  const TN = count('TN');
  const UND = count('undetermined');
  const NR = count('not_run');
  const decided = TP + FP + FN + TN;
  const resolved = rows.filter((row) => row.judge === true).length;
  const precision = TP + FP > 0 ? TP / (TP + FP) : Number.NaN;
  const recall = TP + FN > 0 ? TP / (TP + FN) : Number.NaN;
  const f1 = Number.isFinite(precision) && Number.isFinite(recall) && precision + recall > 0
    ? 2 * precision * recall / (precision + recall)
    : Number.NaN;
  const wallSeconds = rows.reduce((sum, row) => sum + (row.wallclockS == null ? 0 : row.wallclockS), 0);
  return {
    resultsFound: rows.filter((row) => row.found).length,
    expected,
    TP,
    FP,
    FN,
    TN,
    UND,
    NR,
    undetermined: UND,
    not_run: NR,
    decided,
    precision,
    recall,
    f1,
    falseCompletionCount: FP,
    falseCompletionRate: decided > 0 ? FP / decided : Number.NaN,
    resolved,
    resolveRate: decided > 0 ? resolved / decided : Number.NaN,
    coverage: expected > 0 ? decided / expected : Number.NaN,
    wallSeconds,
    wallMin: wallSeconds / 60,
    undeterminedIds: rows.filter((row) => row.cls === 'undetermined').map((row) => row.id),
    notRunIds: rows.filter((row) => row.cls === 'not_run').map((row) => row.id),
  };
}

// McNemar 검정, CI, 판정은 반드시 부작용 없는 통계 코어를 재사용한다.
function pairedStats(instances, aRows, cRows) {
  const aById = new Map(aRows.map((row) => [row.id, row]));
  const cById = new Map(cRows.map((row) => [row.id, row]));
  const ids = [];
  const aOnlySuccess = [];
  const cOnlySuccess = [];
  const bothSuccess = [];
  const bothFailure = [];
  const aOnlyDecided = [];
  const cOnlyDecided = [];
  const neitherDecided = [];
  for (const id of instances) {
    const a = aById.get(id);
    const c = cById.get(id);
    if (a && a.decided && c && c.decided) {
      ids.push(id);
      if (a.judge && !c.judge) aOnlySuccess.push(id);
      else if (!a.judge && c.judge) cOnlySuccess.push(id);
      else if (a.judge && c.judge) bothSuccess.push(id);
      else bothFailure.push(id);
    } else if (a && a.decided) aOnlyDecided.push(id);
    else if (c && c.decided) cOnlyDecided.push(id);
    else neitherDecided.push(id);
  }
  const mc = mcnemar(aOnlySuccess.length, cOnlySuccess.length);
  const sizeP = ids.length;
  return {
    sizeP,
    pairedIds: ids,
    aResolveCount: aOnlySuccess.length + bothSuccess.length,
    cResolveCount: cOnlySuccess.length + bothSuccess.length,
    aResolveRate: sizeP > 0 ? (aOnlySuccess.length + bothSuccess.length) / sizeP : Number.NaN,
    cResolveRate: sizeP > 0 ? (cOnlySuccess.length + bothSuccess.length) / sizeP : Number.NaN,
    b: mc.b,
    c: mc.c,
    n: mc.n,
    pExact: mc.pExact,
    chi2YatesReferenceOnly: mc.chi2Yates,
    lift: sizeP > 0 ? (mc.c - mc.b) / sizeP : Number.NaN,
    liftInterval95ConditionalOnDiscordantN: liftInterval(mc.b, mc.c, sizeP),
    verdict: pairedVerdict(mc, sizeP),
    cells: {
      aOnlySuccess: aOnlySuccess.length,
      cOnlySuccess: cOnlySuccess.length,
      bothSuccess: bothSuccess.length,
      bothFailure: bothFailure.length,
    },
    transitionIds: { aOnlySuccess, cOnlySuccess, bothSuccess, bothFailure },
    exclusions: { aOnlyDecided, cOnlyDecided, neitherDecided },
  };
}

function analyzeStage(label, configPath, config, aArm, cArm) {
  const aRows = readRows(config, aArm);
  const cRows = readRows(config, cArm);
  const expected = config.instances.length;
  const a = armStats(aRows, expected);
  const c = armStats(cRows, expected);
  const paired = pairedStats(config.instances, aRows, cRows);
  const resultsFound = c.resultsFound;
  const partial = resultsFound > 0 && resultsFound < expected;
  const warnings = partial
    ? ['부분 실행 — 사전등록 판정 불가(|P| 부족): C 결과 파일 ' + resultsFound + '/' + expected + ', |P|=' + paired.sizeP + '/' + PAIRED_MIN_P]
    : [];
  return {
    summary: {
      label,
      stage: config.stage,
      configPath,
      ran: resultsFound > 0,
      resultsFound,
      expected,
      partial,
      resultsFoundDefinition: '해당 스테이지 C arm의 존재하는 결과 파일 수',
      sharedA: { reused: label === 'informed', sourceStage: label === 'informed' ? 'blind' : null },
      arms: { A: a, C: c },
      paired,
      warnings,
    },
    aRows,
    cRows,
  };
}

function compareC(blind, informed) {
  const blindById = new Map(blind.cRows.map((row) => [row.id, row]));
  const informedOnlySuccess = [];
  const blindOnlySuccess = [];
  const bothSuccessIds = [];
  const bothFailureIds = [];
  const qIds = [];
  for (const informedRow of informed.cRows) {
    const blindRow = blindById.get(informedRow.id);
    if (!blindRow || !blindRow.decided || !informedRow.decided) continue;
    qIds.push(informedRow.id);
    if (!blindRow.judge && informedRow.judge) informedOnlySuccess.push(informedRow.id);
    else if (blindRow.judge && !informedRow.judge) blindOnlySuccess.push(informedRow.id);
    else if (blindRow.judge && informedRow.judge) bothSuccessIds.push(informedRow.id);
    else bothFailureIds.push(informedRow.id);
  }
  const mc = mcnemar(blindOnlySuccess.length, informedOnlySuccess.length);
  const sizeQ = qIds.length;
  return {
    exploratory: true,
    note: '사전등록된 주판정이 아닌 탐색적 C-vs-C 대비',
    sizeQ,
    qIds,
    informedOnlySuccess,
    blindOnlySuccess,
    bothSuccess: bothSuccessIds.length,
    bothFailure: bothFailureIds.length,
    bothSuccessIds,
    bothFailureIds,
    mcnemar: { b: mc.b, c: mc.c, n: mc.n, pExact: mc.pExact, chi2YatesReferenceOnly: mc.chi2Yates },
    delta: sizeQ > 0 ? (informedOnlySuccess.length - blindOnlySuccess.length) / sizeQ : Number.NaN,
    deltaLift: informed.summary.paired.lift - blind.summary.paired.lift,
    falseCompletion: {
      blind: { count: blind.summary.arms.C.falseCompletionCount, rate: blind.summary.arms.C.falseCompletionRate },
      informed: { count: informed.summary.arms.C.falseCompletionCount, rate: informed.summary.arms.C.falseCompletionRate },
    },
  };
}

function readLedger(label, config) {
  const path = join(here, config.stage, 'ledger.jsonl');
  const known = new Set(config.instances);
  const intervals = [];
  let parseErrors = 0;
  let entries = 0;
  if (!existsSync(path)) return { label, path, exists: false, entries, parseErrors, intervals };
  for (const line of readFileSync(path, 'utf8').split(NL)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      parseErrors += 1;
      continue;
    }
    entries += 1;
    if (!entry || entry.arm !== 'C' || !known.has(entry.id)) continue;
    const startedMs = Date.parse(entry.startedAt);
    const endedMs = Date.parse(entry.ts);
    if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs < startedMs) continue;
    intervals.push({ id: entry.id, startedMs, endedMs, startedAt: entry.startedAt, endedAt: entry.ts });
  }
  return { label, path, exists: true, entries, parseErrors, intervals };
}

// runs 아래 runId 수에 의존하지 않고 제한된 깊이로 events.jsonl을 찾는다.
function findEventFiles(root, maxDepth) {
  const files = [];
  let scanErrors = 0;
  function walk(directory, depth) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      scanErrors += 1;
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isFile() && entry.name === 'events.jsonl') files.push(path);
      else if (entry.isDirectory() && depth < maxDepth) walk(path, depth + 1);
    }
  }
  walk(root, 0);
  return { files, scanErrors };
}

function scanRuns(runPrefix) {
  const parent = dirname(runPrefix);
  const namePrefix = basename(runPrefix);
  const runDirectories = [];
  const events = [];
  let eventFiles = 0;
  let parseErrors = 0;
  let scanErrors = 0;
  let entries = [];
  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch {
    scanErrors += 1;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(namePrefix)) continue;
    const root = join(parent, entry.name);
    runDirectories.push(root);
    const rawId = entry.name.slice(namePrefix.length);
    const match = rawId.match(/^(.*)-([A-Za-z0-9]{6})$/);
    const instanceId = match ? match[1] : null;
    const found = findEventFiles(root, searchDepth);
    eventFiles += found.files.length;
    scanErrors += found.scanErrors;
    for (const eventsPath of found.files) {
      let lines;
      try {
        lines = readFileSync(eventsPath, 'utf8').split(NL);
      } catch {
        scanErrors += 1;
        continue;
      }
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          parseErrors += 1;
          continue;
        }
        if (!event || event.type !== 'verify_retry') continue;
        events.push({
          instanceId,
          timestamp: event.timestamp == null ? null : event.timestamp,
          runId: event.runId == null ? null : event.runId,
          taskId: event.taskId == null ? null : event.taskId,
          attempt: finite(event.attempt),
          maxRetries: finite(event.maxRetries),
          novel: event.novel,
          mode: event.mode == null ? null : event.mode,
          runDirectory: root,
          eventsPath,
        });
      }
    }
  }
  return { runDirectories, eventFiles, events, parseErrors, scanErrors };
}

// timestamp가 정확히 하나의 C-arm ledger 구간과 일치할 때만 귀속한다.
function attributeEvents(events, ledgers) {
  const attributed = Object.fromEntries(ledgers.map((ledger) => [ledger.label, []]));
  const unattributed = [];
  for (const event of events) {
    const eventMs = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : Number.NaN;
    let matches = [];
    let reason = null;
    if (!event.instanceId) reason = '디렉토리명에서 instanceId 파싱 실패';
    else if (!Number.isFinite(eventMs)) reason = 'verify_retry timestamp 파싱 실패';
    else {
      matches = ledgers.filter((ledger) => ledger.intervals.some((interval) => (
        interval.id === event.instanceId && interval.startedMs <= eventMs && eventMs <= interval.endedMs
      )));
      if (matches.length === 0) reason = '어느 스테이지의 C-arm ledger 실행 구간에도 포함되지 않음';
      else if (matches.length > 1) reason = '둘 이상의 스테이지 ledger 실행 구간과 겹쳐 모호함';
    }
    if (matches.length === 1 && reason == null) attributed[matches[0].label].push(event);
    else unattributed.push({ ...event, reason });
  }
  return { attributed, unattributed };
}

function aggregateEvents(events) {
  const instanceIds = [...new Set(events.map((event) => event.instanceId).filter(Boolean))].sort();
  const instanceMaxAttempts = {};
  for (const event of events) {
    if (!event.instanceId || event.attempt == null) continue;
    const previous = instanceMaxAttempts[event.instanceId];
    instanceMaxAttempts[event.instanceId] = previous == null ? event.attempt : Math.max(previous, event.attempt);
  }
  const attempts = Object.values(instanceMaxAttempts).filter(Number.isFinite);
  const novelFalseCount = events.filter((event) => event.novel === false).length;
  return {
    totalVerifyRetryEvents: events.length,
    coveredInstances: instanceIds.length,
    instanceIds,
    novelFalseCount,
    novelFalseRate: events.length > 0 ? novelFalseCount / events.length : Number.NaN,
    averageMaxAttempt: attempts.length > 0 ? attempts.reduce((sum, value) => sum + value, 0) / attempts.length : Number.NaN,
    instanceMaxAttempts,
  };
}

function numberStats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length === 0
    ? Number.NaN
    : sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    samples: sorted.length,
    medianS: median,
    meanS: sorted.length > 0 ? sum / sorted.length : Number.NaN,
    sumS: sum,
  };
}

function fallback(rows) {
  const wallclock = numberStats(rows.map((row) => row.wallclockS).filter((value) => value != null));
  const limits = rows.map((row) => finite(row.result && row.result.verifyRetries)).filter((value) => value != null);
  const counts = {};
  for (const limit of limits) counts[String(limit)] = (counts[String(limit)] || 0) + 1;
  return {
    wallclock,
    verifyRetries: {
      observedResults: limits.length,
      configuredUpperBoundValues: [...new Set(limits)].sort((a, b) => a - b),
      counts,
      note: 'verifyRetries는 설정 상한이며 실제 verify_retry 발동 횟수가 아니므로 saturation 지표로 사용할 수 없음',
    },
  };
}

function stageSaturation(label, config, events, fallbackValues) {
  const aggregate = aggregateEvents(events);
  const expected = config.instances.length;
  const coverage = expected > 0 ? aggregate.coveredInstances / expected : Number.NaN;
  const measurable = expected > 0 && aggregate.coveredInstances === expected;
  const reason = measurable
    ? null
    : aggregate.coveredInstances === 0
      ? '측정 불가: run 디렉토리 없음(KEEP_RUN=1 미설정) — saturation 직접 측정 불가'
      : '측정 불가: run 디렉토리 커버리지 ' + aggregate.coveredInstances + '/' + expected + ' (KEEP_RUN=1 미설정 가능) — saturation 직접 측정 불가';
  return {
    label,
    expected,
    ...aggregate,
    coverage,
    partialSample: coverage < 1,
    measurable,
    reason,
    fallback: fallbackValues,
  };
}

function saturation(runPrefix, blindConfig, informedConfig, blindRows, informedRows, informedRan) {
  const ledgers = [readLedger('blind', blindConfig), readLedger('informed', informedConfig)];
  const scan = scanRuns(runPrefix);
  const attribution = attributeEvents(scan.events, ledgers);
  const blind = stageSaturation('blind', blindConfig, attribution.attributed.blind, fallback(blindRows));
  const informed = stageSaturation('informed', informedConfig, attribution.attributed.informed, fallback(informedRows));
  const unattributedAggregate = aggregateEvents(attribution.unattributed);
  const reasonCounts = {};
  for (const event of attribution.unattributed) reasonCounts[event.reason] = (reasonCounts[event.reason] || 0) + 1;
  const measurable = informedRan && blind.measurable && informed.measurable;
  const reasons = [];
  if (!blind.measurable) reasons.push('blind: ' + blind.reason);
  if (!informedRan) reasons.push('informed 스테이지 미실행으로 두 스테이지 saturation 비교 불가');
  else if (!informed.measurable) reasons.push('informed: ' + informed.reason);
  return {
    measurable,
    reason: measurable ? null : reasons.join(' / '),
    runGlob: runPrefix,
    recursiveSearchDepth: searchDepth,
    attributionRule: '디렉토리명에서 instanceId를 얻고 verify_retry timestamp가 C-arm ledger의 [startedAt, ts]에 포함될 때만 귀속',
    scan: {
      runDirectories: scan.runDirectories.length,
      runDirectoryPaths: scan.runDirectories,
      eventsFiles: scan.eventFiles,
      totalVerifyRetryEvents: scan.events.length,
      jsonlParseErrors: scan.parseErrors,
      scanErrors: scan.scanErrors,
    },
    ledgers: Object.fromEntries(ledgers.map((ledger) => [ledger.label, {
      path: ledger.path,
      exists: ledger.exists,
      entries: ledger.entries,
      cArmIntervals: ledger.intervals.length,
      parseErrors: ledger.parseErrors,
    }])),
    stages: { blind, informed },
    unattributed: {
      ...unattributedAggregate,
      reasonCounts,
      events: attribution.unattributed.map((event) => ({
        instanceId: event.instanceId,
        timestamp: event.timestamp,
        runId: event.runId,
        taskId: event.taskId,
        attempt: event.attempt,
        maxRetries: event.maxRetries,
        novel: event.novel,
        mode: event.mode,
        runDirectory: event.runDirectory,
        eventsPath: event.eventsPath,
        reason: event.reason,
      })),
    },
    verifyRetriesNote: '결과 JSON의 verifyRetries는 설정 상한이며 실제 발동 횟수가 아니므로 saturation 계산에 사용하지 않음',
  };
}

function pct(value) {
  return Number.isFinite(value) ? (100 * value).toFixed(1) + '%' : '계산 불가';
}

function dec(value, digits) {
  const places = digits == null ? 4 : digits;
  return Number.isFinite(value) ? value.toFixed(places) : '계산 불가';
}

function ci(interval) {
  return Array.isArray(interval) ? '[' + pct(interval[0]) + ', ' + pct(interval[1]) + ']' : '계산 불가';
}

function list(ids) {
  return ids.length > 0 ? ids.join(', ') : '없음';
}

function wallText(fallbackValues) {
  const stats = fallbackValues.wallclock;
  const minutes = (seconds) => Number.isFinite(seconds) ? (seconds / 60).toFixed(1) : '계산 불가';
  return minutes(stats.medianS) + ' / ' + minutes(stats.meanS) + ' / ' + minutes(stats.sumS) + ' (n=' + stats.samples + ')';
}

function retryLimitText(fallbackValues) {
  const values = fallbackValues.verifyRetries.configuredUpperBoundValues;
  return values.length > 0 ? values.join(', ') : '없음';
}

function render(report) {
  const lines = [
    '# 재시도 blind vs informed 비교',
    '',
    '생성 시각: ' + report.generatedAt,
    '공유 A arm: blind config의 ' + report.inputs.sharedAResultPattern,
    '',
  ];
  // 인스턴스 집합 불일치는 페어드 설계 자체를 깨므로 표보다 먼저, 눈에 띄게 알린다.
  if (report.inputs.instanceSets && !report.inputs.instanceSets.identical) {
    lines.push('> ⚠️ **두 스테이지의 instances가 동일하지 않습니다 — 사전등록(§4) 위반이며 페어드 대비가 교집합으로 축소됩니다.**');
    for (const warning of report.inputs.instanceSets.warnings) lines.push('> - ' + warning);
    lines.push('');
  }
  lines.push(
    '## 스테이지 요약',
    '',
    '| 스테이지 | arm | 결과 파일 | TP | FP | FN | TN | undetermined | not_run | precision | recall | F1 | false_completion | resolve율 | wall 합(min) |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  );
  const appendStage = (stage, label) => {
    for (const key of ['A', 'C']) {
      const stats = stage.arms[key];
      const shown = label === 'informed' && key === 'A' ? 'A(공유)' : key;
      lines.push('| ' + label + ' | ' + shown + ' | ' + stats.resultsFound + '/' + stats.expected + ' | ' + stats.TP + ' | ' + stats.FP + ' | ' + stats.FN + ' | ' + stats.TN + ' | ' + stats.UND + ' | ' + stats.NR + ' | ' + pct(stats.precision) + ' | ' + pct(stats.recall) + ' | ' + pct(stats.f1) + ' | ' + stats.falseCompletionCount + '/' + stats.decided + ' (' + pct(stats.falseCompletionRate) + ') | ' + stats.resolved + '/' + stats.decided + ' (' + pct(stats.resolveRate) + ') | ' + stats.wallMin.toFixed(1) + ' |');
    }
  };
  appendStage(report.blind, 'blind');
  if (report.informed.ran) appendStage(report.informed, 'informed');
  if (report.blind.partial) {
    lines.push('', '> ⚠️ blind 부분 실행: C 결과 파일 ' + report.blind.resultsFound + '/' + report.blind.expected + ', |P|=' + report.blind.paired.sizeP + '/' + PAIRED_MIN_P);
  }
  if (!report.informed.ran) {
    lines.push('', '## informed 스테이지 미실행 (결과 파일 0/' + report.informed.expected + ')', '', 'informed 결과가 없어 blind 스테이지만 요약합니다. 프로세스는 정상 종료하며 직접 대비는 계산하지 않습니다.');
  } else if (report.informed.partial) {
    lines.push('', '> ⚠️ 부분 실행 — 사전등록 판정 불가(|P| 부족): 결과 파일 ' + report.informed.resultsFound + '/' + report.informed.expected + ', |P|=' + report.informed.paired.sizeP + '/' + PAIRED_MIN_P);
  }

  lines.push(
    '',
    '## 스테이지별 페어드 비교',
    '',
    '| 스테이지 | &#124;P&#124; | A resolve율 | C resolve율 | b(A만 성공) | c(C만 성공) | n | exact p | lift | lift CI 95% | pairedVerdict |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  );
  const appendPaired = (stage, label) => {
    const paired = stage.paired;
    lines.push('| ' + label + ' | ' + paired.sizeP + ' | ' + paired.aResolveCount + '/' + paired.sizeP + ' (' + pct(paired.aResolveRate) + ') | ' + paired.cResolveCount + '/' + paired.sizeP + ' (' + pct(paired.cResolveRate) + ') | ' + paired.b + ' | ' + paired.c + ' | ' + paired.n + ' | ' + dec(paired.pExact) + ' | ' + pct(paired.lift) + 'p | ' + ci(paired.liftInterval95ConditionalOnDiscordantN) + ' | ' + paired.verdict + ' |');
  };
  appendPaired(report.blind, 'blind');
  if (report.informed.ran) appendPaired(report.informed, 'informed');

  lines.push('', '## blind vs informed 직접 대비');
  if (!report.directComparison) {
    lines.push('', 'informed 결과가 없어 C-vs-C 전환 분석을 생략합니다.');
  } else {
    const direct = report.directComparison;
    lines.push(
      '',
      '**탐색적(exploratory) 지표이며 사전등록된 주판정이 아닙니다.**',
      '',
      '| &#124;Q&#124; | informed만 성공 | blind만 성공 | 둘 다 성공 | 둘 다 실패 | exact p | delta | deltaLift |',
      '|---:|---:|---:|---:|---:|---:|---:|---:|',
      '| ' + direct.sizeQ + ' | ' + direct.informedOnlySuccess.length + ' | ' + direct.blindOnlySuccess.length + ' | ' + direct.bothSuccess + ' | ' + direct.bothFailure + ' | ' + dec(direct.mcnemar.pExact) + ' | ' + pct(direct.delta) + 'p | ' + pct(direct.deltaLift) + 'p |',
      '',
      '- informed만 성공 (' + direct.informedOnlySuccess.length + '): ' + list(direct.informedOnlySuccess),
      '- blind만 성공 (' + direct.blindOnlySuccess.length + '): ' + list(direct.blindOnlySuccess),
      '- false_completion: blind ' + direct.falseCompletion.blind.count + '건 (' + pct(direct.falseCompletion.blind.rate) + ') vs informed ' + direct.falseCompletion.informed.count + '건 (' + pct(direct.falseCompletion.informed.rate) + ')',
    );
  }

  const sat = report.saturation;
  lines.push(
    '',
    '## saturation 측정',
    '',
    '| 구분 | 직접 측정 가능 | verify_retry 이벤트 | 커버 인스턴스 | 커버리지 | novel=false | 평균 max attempt | wall 중앙값/평균/합(min) | verifyRetries 상한 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const label of ['blind', 'informed']) {
    const stage = sat.stages[label];
    lines.push('| ' + label + ' | ' + (stage.measurable ? '예' : '아니요') + ' | ' + stage.totalVerifyRetryEvents + ' | ' + stage.coveredInstances + '/' + stage.expected + ' | ' + pct(stage.coverage) + ' | ' + stage.novelFalseCount + '/' + stage.totalVerifyRetryEvents + ' (' + pct(stage.novelFalseRate) + ') | ' + dec(stage.averageMaxAttempt, 2) + ' | ' + wallText(stage.fallback) + ' | ' + retryLimitText(stage.fallback) + ' |');
  }
  const unattributed = sat.unattributed;
  lines.push(
    '| unattributed | 해당 없음 | ' + unattributed.totalVerifyRetryEvents + ' | ' + unattributed.coveredInstances + ' | 해당 없음 | ' + unattributed.novelFalseCount + '/' + unattributed.totalVerifyRetryEvents + ' (' + pct(unattributed.novelFalseRate) + ') | ' + dec(unattributed.averageMaxAttempt, 2) + ' | 해당 없음 | 해당 없음 |',
    '',
    '- run 디렉토리 ' + sat.scan.runDirectories + '개, events.jsonl ' + sat.scan.eventsFiles + '개, verify_retry ' + sat.scan.totalVerifyRetryEvents + '건을 깊이 ' + sat.recursiveSearchDepth + '까지 재귀 탐색했습니다.',
  );
  for (const label of ['blind', 'informed']) {
    const stage = sat.stages[label];
    if (stage.coverage < 1) lines.push('- ' + label + ' 커버리지 ' + stage.coveredInstances + '/' + stage.expected + ' (' + pct(stage.coverage) + '): 100% 미만의 부분표본입니다.');
  }
  if (!sat.measurable) lines.push('- **' + sat.reason + '**');
  if (unattributed.totalVerifyRetryEvents > 0) {
    lines.push('- 어느 스테이지에도 귀속하지 않은 verify_retry ' + unattributed.totalVerifyRetryEvents + '건: ' + list(unattributed.instanceIds));
  }
  lines.push(
    '- run 디렉토리는 KEEP_RUN=1이 아니면 어댑터 종료 시 삭제되므로, 없는 이벤트를 추정하거나 특정 스테이지에 임의 배정하지 않았습니다.',
    '- verifyRetries는 결과 JSON에 기록된 설정 상한이며 실제 발동 횟수가 아니므로 saturation 지표로 사용하지 않았습니다.',
    '',
    '기계용 JSON 출력: ' + report.outputPath,
  );
  return lines.join(NL);
}

// JSON.stringify가 비유한값을 조용히 null로 바꾸기 전에 정확한 경로를 함께 기록한다.
function sanitize(value, path, nonFinite) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    nonFinite.push(path);
    return null;
  }
  if (Array.isArray(value)) return value.map((item, index) => sanitize(item, path + '[' + index + ']', nonFinite));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = sanitize(item, path ? path + '.' + key : key, nonFinite);
    }
    return output;
  }
  return value;
}

function writeReport(path, body) {
  const nonFinite = [];
  const clean = sanitize(body, '', nonFinite);
  const report = {
    ...clean,
    nonFinite,
    conventions: '숫자 필드의 null은 값 없음이며, nonFinite에 경로가 열거된 null은 NaN/Infinity라 계산 불가임. lift CI는 불일치쌍 n=b+c 조건부 Clopper–Pearson 95% 구간임.',
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + NL, 'utf8');
  return report;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  const blindPath = inputPath(options.blind);
  const informedPath = inputPath(options.informed);
  const outPath = outputPath(options.out);
  const runPrefix = outputPath(options.runGlob);
  if (outPath === blindPath || outPath === informedPath) {
    throw new Error('--out 경로는 입력 config 경로와 달라야 합니다.');
  }
  const blindConfig = loadConfig(blindPath, ['A', 'C']);
  const informedConfig = loadConfig(informedPath, ['C']);
  // 두 스테이지의 instances가 다르면 C-vs-C 대비가 조용히 교집합만 보게 되어, 빠진 인스턴스가 "판정 불가"가 아니라
  // 아예 존재하지 않았던 것처럼 사라진다. 사전등록(STAGE-PRO-INFORMED-RETRY.md §4)은 문자 단위 동일을 요구하므로
  // 여기서 명시적으로 대조하고 불일치를 경고로 노출한다(계산은 계속하되 그 사실을 감춘 채 진행하지 않는다).
  const blindOnlyInstances = blindConfig.instances.filter((id) => !informedConfig.instances.includes(id));
  const informedOnlyInstances = informedConfig.instances.filter((id) => !blindConfig.instances.includes(id));
  const sameOrder = blindConfig.instances.length === informedConfig.instances.length
    && blindConfig.instances.every((id, index) => id === informedConfig.instances[index]);
  const instanceSetWarnings = [];
  if (blindOnlyInstances.length > 0) instanceSetWarnings.push('blind에만 있는 인스턴스 ' + blindOnlyInstances.length + '건: ' + blindOnlyInstances.join(', '));
  if (informedOnlyInstances.length > 0) instanceSetWarnings.push('informed에만 있는 인스턴스 ' + informedOnlyInstances.length + '건: ' + informedOnlyInstances.join(', '));
  if (instanceSetWarnings.length === 0 && !sameOrder) instanceSetWarnings.push('인스턴스 집합은 같지만 순서가 다릅니다(집합 기반 계산에는 영향 없음).');
  const sharedA = armOf(blindConfig, 'A');
  const blind = analyzeStage('blind', blindPath, blindConfig, sharedA, armOf(blindConfig, 'C'));
  const informed = analyzeStage('informed', informedPath, informedConfig, sharedA, armOf(informedConfig, 'C'));
  const informedRan = informed.summary.resultsFound > 0;
  const body = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    outputPath: outPath,
    inputs: {
      blindConfig: blindPath,
      informedConfig: informedPath,
      sharedAResultPattern: sharedA.resultPattern,
      runGlob: runPrefix,
      instanceSets: {
        identical: instanceSetWarnings.length === 0,
        sameOrder,
        blindCount: blindConfig.instances.length,
        informedCount: informedConfig.instances.length,
        blindOnly: blindOnlyInstances,
        informedOnly: informedOnlyInstances,
        warnings: instanceSetWarnings,
      },
    },
    blind: blind.summary,
    informed: informedRan ? informed.summary : { ran: false, resultsFound: 0, expected: informed.summary.expected },
    directComparison: informedRan ? compareC(blind, informed) : null,
    saturation: saturation(runPrefix, blindConfig, informedConfig, blind.cRows, informed.cRows, informedRan),
  };
  const report = writeReport(outPath, body);
  console.log(render(report));
}

try {
  main();
} catch (error) {
  console.error('오류: ' + error.message);
  process.exitCode = 1;
}
