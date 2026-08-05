#!/usr/bin/env node
// 수렴 압력 3차 — 분해 품질 게이트의 runner 통합 회귀.
// 검증 경계는 생성된 frontmatter, events.jsonl, fake executor가 받은 prompt뿐이다.
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(scriptDir, '..', 'bin', 'taskops.js');
const PASS_CHECK = 'node -e "process.exit(0)"';
const FAIL_CHECK = 'node -e "process.exit(7)"';
const DECOMPOSED_TWICE_CHECK = 'node -e "const f=require(\'fs\');const p=\'__TASKOPS_WORK_DIR__/.fixture-adapter-state.json\';let n=0;try{n=JSON.parse(f.readFileSync(p,\'utf8\')).decompose||0}catch{}process.exit(n>=2?0:7)"';
const FEEDBACK_MARKER = '직전 분해 실측:';
let fixtureSequence = 0;

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      'taskops ' + args.join(' ') + ' 실패'
      + '\nSTDOUT:\n' + result.stdout
      + '\nSTDERR:\n' + result.stderr,
    );
  }
  return result.stdout;
}

function rootTaskPath(workDir, taskId = 'task-parent') {
  return join(
    workDir,
    'task-groups',
    'tg-root',
    'versions',
    'tgv-root-v2',
    'tasks',
    taskId + '.md',
  );
}

function snapshotPath(workDir) {
  return join(workDir, 'snapshots', 'snapshot-root-v1.md');
}

function promptPath(workDir, kind, index) {
  return join(workDir, 'fixture-prompts', kind + '-' + index + '.txt');
}

function readEvents(workDir, runId) {
  const path = join(workDir, 'runs', runId, 'events.jsonl');
  const raw = existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
  return raw ? raw.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line)) : [];
}

function eventsOfType(events, type) {
  return events.filter((event) => event.type === type);
}

function readRunIndex(workDir, runId) {
  return parseMarkdownFile(join(workDir, 'runs', runId, 'index.md'));
}

function selectedVersions(workDir) {
  const snapshot = parseMarkdownFile(snapshotPath(workDir));
  return Array.isArray(snapshot.selectedVersions) ? snapshot.selectedVersions : [];
}

function hasSelectedVersion(workDir, taskGroupId, versionId) {
  return selectedVersions(workDir).some((entry) => (
    entry?.taskGroupId === taskGroupId && entry?.versionId === versionId
  ));
}

function feedbackLine(prompt) {
  return String(prompt || '').split(/\r?\n/).find((line) => line.includes(FEEDBACK_MARKER)) || null;
}

function assertFeedbackNumbers(prompt, expected) {
  const line = feedbackLine(prompt);
  assert.ok(line, '수치 피드백 블록의 실측 행이 prompt에 있어야 한다.');
  assert.equal(
    line.includes('자식 ' + expected.childCount + '개'),
    true,
    'prompt는 실제 childCount=' + expected.childCount + '를 포함해야 한다.',
  );
  assert.equal(
    line.includes('가능한 자식 ' + expected.executableChildrenCount + '개'),
    true,
    'prompt는 실제 executableChildrenCount=' + expected.executableChildrenCount + '를 포함해야 한다.',
  );
  assert.equal(line.includes('runnable=' + expected.runnableCount), true);
  assert.equal(line.includes('검증가능 acceptance 보유=' + expected.verifiableCount), true);
  assert.equal(line.includes('blocked=' + expected.blockedCount), true);
  assert.equal(line.includes('해소불가 blockedBy 마커=' + expected.unresolvedBlockerCount), true);
}

function planningTask(id, order, overrides = {}) {
  return {
    id,
    title: id,
    objective: id + '의 계획 범위를 한 단계 분해한다.',
    responsibility: id + ' 범위만 책임진다.',
    completionCriteria: id + '의 하위 범위가 명시된다.',
    expectedResult: id + '의 하위 task group',
    order,
    status: 'pending',
    runReadiness: 'needs_decomposition',
    uncertaintyState: 'known_unknown',
    confidenceScore: 0.7,
    decompositionConfidence: 0.9,
    expectedPlan: {
      expectedDepth: 1,
      expectedBreadth: 2,
      rationale: '한 단계 분해가 더 필요한 계획 task다.',
    },
    ...overrides,
  };
}

function runnableTask(id, order, acceptance, overrides = {}) {
  return {
    id,
    title: id,
    objective: id + '를 한 실행 turn에서 완료한다.',
    responsibility: id + ' 실행 범위만 책임진다.',
    completionCriteria: id + '의 검증 가능한 완료조건을 충족한다.',
    expectedResult: id + '의 검증 결과',
    order,
    status: 'pending',
    runReadiness: 'runnable',
    uncertaintyState: 'known',
    confidenceScore: 0.9,
    expectedPlan: {
      expectedDepth: 0,
      expectedBreadth: 0,
      rationale: '즉시 실행 가능한 리프다.',
    },
    acceptance,
    ...overrides,
  };
}

function blockedChild(id, order, overrides = {}) {
  return {
    id,
    title: id,
    objective: id + '의 blocker를 정직하게 보존한다.',
    responsibility: id + ' blocker만 기록한다.',
    completionCriteria: 'blocker가 해소되기 전에는 실행하지 않는다.',
    expectedResult: id + ' blocker 기록',
    order,
    status: 'blocked',
    runReadiness: 'blocked',
    uncertaintyState: 'unknown_unknown',
    confidenceScore: 0.2,
    decompositionConfidence: 0.1,
    blockedReason: 'fixture blocker',
    expectedPlan: {
      expectedDepth: 0,
      expectedBreadth: 0,
      rationale: '현재는 blocked 리프다.',
    },
    ...overrides,
  };
}

function explorationChild(id, order, overrides = {}) {
  return {
    id,
    title: id,
    objective: id + '의 미지 정보를 탐색한다.',
    responsibility: id + '의 unknown만 밝힌다.',
    completionCriteria: '다음 실행 판단에 필요한 정보를 기록한다.',
    expectedResult: id + ' 탐색 결과',
    order,
    status: 'pending',
    runReadiness: 'needs_exploration',
    uncertaintyState: 'unknown_unknown',
    confidenceScore: 0.2,
    decompositionConfidence: 0.2,
    expectedPlan: {
      expectedDepth: 0,
      expectedBreadth: 1,
      rationale: '먼저 unknown을 탐색해야 한다.',
    },
    ...overrides,
  };
}

function guardedCheck(command = PASS_CHECK) {
  return {
    mode: 'guarded',
    expectedOutcome: 'runner가 실제 명령을 검증한다.',
    requiredChecks: [command],
    requiredArtifacts: [],
  };
}

function guardedArtifact(path) {
  return {
    mode: 'guarded',
    expectedOutcome: '구체 산출물 경로가 존재한다.',
    requiredChecks: [],
    requiredArtifacts: [{ path }],
  };
}

function primerTask(order = 1) {
  return runnableTask('task-primer', order, guardedCheck(PASS_CHECK), {
    title: 'hard 압력 발화용 선행 실행',
    objective: '한 step을 정직하게 소진한다.',
    responsibility: '예산 압력만 준비한다.',
    completionCriteria: 'fake executor 실행이 완료된다.',
    expectedResult: '다음 dispatch의 결정적 budget fraction',
  });
}

function parentTask({
  order = 1,
  acceptance = null,
  blockedBy = null,
  id = 'task-parent',
} = {}) {
  const task = planningTask(id, order, {
    title: '분해 품질 평가 부모',
    objective: '실행 가능한 자식을 포함하는 정직한 분해를 만든다.',
    responsibility: '분해 품질 게이트의 부모 범위만 책임진다.',
    completionCriteria: '자식 분해가 평가되고 정책에 맞는 다음 상태가 기록된다.',
    expectedResult: '평가 가능한 자식 task group',
    confidenceScore: 0.8,
  });
  if (acceptance) task.acceptance = acceptance;
  if (blockedBy) task.blockedBy = blockedBy;
  return task;
}

function pressureTask(id, order) {
  return planningTask(id, order, {
    title: id + ' hard pressure primer',
    objective: 'hard dispatch 직전 한 번 분해된다.',
    responsibility: 'tier 선택을 위한 budget step만 제공한다.',
    completionCriteria: 'blocked 자식 하나가 기록된다.',
    expectedResult: 'hard pressure 준비',
  });
}

function lowQualityChildren(count = 2, prefix = 'task-child-plan') {
  return Array.from({ length: count }, (_, index) => (
    planningTask(prefix + '-' + (index + 1), index + 1)
  ));
}

function mixedSixChildren() {
  return [
    planningTask('task-child-plan', 1),
    explorationChild('task-child-explore-verifiable', 2, {
      acceptance: guardedCheck(PASS_CHECK),
    }),
    runnableTask('task-child-runnable-empty', 3),
    runnableTask('task-child-status-blocked', 4, guardedCheck(PASS_CHECK), {
      status: 'blocked',
      runReadiness: 'runnable',
      blockedReason: 'status 우선순위 fixture',
    }),
    runnableTask('task-child-unresolved', 5, guardedCheck(PASS_CHECK), {
      blockedBy: [{ type: 'unresolved', raw: 'fixture unresolved blocker' }],
    }),
    planningTask('task-child-plan-artifact', 6, {
      acceptance: guardedArtifact('artifacts/plan-result.json'),
    }),
  ];
}

function executableTwoChildren() {
  return [
    planningTask('task-child-plan-next', 1),
    runnableTask('task-child-exec-check', 2, guardedCheck(PASS_CHECK)),
    runnableTask('task-child-exec-artifact', 3, guardedArtifact('artifacts/result.json')),
  ];
}

function acceptedHardChildren() {
  return [
    runnableTask('task-child-exec', 1, guardedCheck(PASS_CHECK)),
    planningTask('task-child-still-planning', 2),
    blockedChild('task-child-blocked', 3),
  ];
}

function honestLowQualityChildren() {
  return [
    planningTask('task-child-plan', 1),
    blockedChild('task-child-unresolved', 2, {
      blockedBy: [{ type: 'unresolved', raw: 'fixture unresolved blocker' }],
    }),
  ];
}

function clampProbeChildren() {
  return [
    planningTask('task-child-needs-decomposition', 1),
    explorationChild('task-child-needs-exploration', 2),
    blockedChild('task-child-blocked', 3),
  ];
}

function nonExecutableDescendants(parentCheck = null) {
  return [
    blockedChild('task-child-covered-blocked', 1, {
      acceptance: parentCheck ? guardedCheck(parentCheck) : undefined,
    }),
    explorationChild('task-child-exploration', 2),
  ];
}

function executableDescendants(parentCheck) {
  return [
    runnableTask('task-child-tier-one', 1, guardedCheck(parentCheck)),
    blockedChild('task-child-control-blocked', 2),
  ];
}

function blockedPressureChildren(label) {
  return [blockedChild('task-' + label + '-blocked', 1)];
}

function fakeExecutorSource() {
  return [
    '#!/usr/bin/env node',
    "import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    '',
    "if (process.argv.includes('--version')) {",
    "  console.log('openclaw fake decomposition quality');",
    '  process.exit(0);',
    '}',
    '',
    'const args = process.argv.slice(2);',
    "const messageIndex = args.indexOf('--message');",
    "const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';",
    'const workDir = process.env.TASKOPS_DECOMPOSITION_QUALITY_WORK_DIR;',
    'const scenarioPath = process.env.TASKOPS_DECOMPOSITION_QUALITY_SCENARIO;',
    "if (!workDir || !scenarioPath) { console.error('missing fixture environment'); process.exit(2); }",
    "const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));",
    "const statePath = join(workDir, '.fixture-adapter-state.json');",
    "const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { total: 0, decompose: 0, execute: 0 };",
    "const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();",
    "const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();",
    "const kind = childTaskGroupId && versionId ? 'decompose' : 'execute';",
    'state.total += 1;',
    'state[kind] += 1;',
    "mkdirSync(join(workDir, 'fixture-prompts'), { recursive: true });",
    "writeFileSync(join(workDir, 'fixture-prompts', kind + '-' + state[kind] + '.txt'), prompt, 'utf8');",
    "writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');",
    '',
    "const yaml = (value) => JSON.stringify(String(value));",
    "const writeAcceptanceList = (lines, label, items, objectKeys) => {",
    '  lines.push("  " + label + ":");',
    '  if (!items.length) { lines[lines.length - 1] += " []"; return; }',
    '  for (const item of items) {',
    "    if (item && typeof item === 'object' && !Array.isArray(item)) {",
    '      const key = objectKeys.find((candidate) => String(item[candidate] || "").trim());',
    '      if (key) lines.push("    - " + key + ": " + yaml(item[key]));',
    '      else lines.push("    - " + yaml(JSON.stringify(item)));',
    '    } else {',
    '      lines.push("    - " + yaml(item));',
    '    }',
    '  }',
    '};',
    '',
    'const writeTask = (tasksDir, task, now) => {',
    '  const lines = [',
    "    '---',",
    "    'taskOpsVersion: v1',",
    "    'entityType: task',",
    "    'id: ' + task.id,",
    "    'taskGroupId: ' + childTaskGroupId,",
    "    'taskGroupVersionId: ' + versionId,",
    "    'title: ' + yaml(task.title || task.id),",
    "    'objective: ' + yaml(task.objective || (task.id + ' objective')),",
    "    'purpose: ' + yaml(task.purpose || (task.id + ' purpose')),",
    "    'responsibility: ' + yaml(task.responsibility || (task.id + ' responsibility')),",
    "    'completionCriteria: ' + yaml(task.completionCriteria || (task.id + ' completion criteria')),",
    "    'expectedResult: ' + yaml(task.expectedResult || (task.id + ' expected result')),",
    "    'order: ' + Number(task.order || 1),",
    "    'createdAt: ' + now,",
    "    'status: ' + (task.status || 'pending'),",
    "    'runReadiness: ' + (task.runReadiness || 'needs_decomposition'),",
    "    'fixtureAuthoredRunReadiness: ' + (task.runReadiness || 'needs_decomposition'),",
    '  ];',
    '  if (task.uncertaintyState) {',
    "    lines.push('uncertaintyState: ' + task.uncertaintyState);",
    "    lines.push('fixtureAuthoredUncertaintyState: ' + task.uncertaintyState);",
    '  }',
    "  if (task.confidenceScore != null) lines.push('confidenceScore: ' + Number(task.confidenceScore));",
    "  if (task.decompositionConfidence != null) lines.push('decompositionConfidence: ' + Number(task.decompositionConfidence));",
    "  if (task.blockedReason) lines.push('blockedReason: ' + yaml(task.blockedReason));",
    '  if (task.expectedPlan) {',
    "    lines.push('expectedPlan:');",
    "    lines.push('  expectedDepth: ' + Number(task.expectedPlan.expectedDepth));",
    "    lines.push('  expectedBreadth: ' + Number(task.expectedPlan.expectedBreadth));",
    "    lines.push('  rationale: ' + yaml(task.expectedPlan.rationale));",
    '  }',
    '  const blockers = Array.isArray(task.blockedBy) ? task.blockedBy : (task.blockedBy ? [task.blockedBy] : []);',
    '  if (blockers.length) {',
    "    lines.push('blockedBy:');",
    '    for (const blocker of blockers) {',
    "      if (!blocker || typeof blocker !== 'object') { lines.push('  - ' + yaml(blocker)); continue; }",
    "      lines.push('  - type: ' + yaml(blocker.type || 'task'));",
    '      for (const [key, value] of Object.entries(blocker)) {',
    "        if (key === 'type' || value == null) continue;",
    "        lines.push('    ' + key + ': ' + (typeof value === 'number' || typeof value === 'boolean' ? String(value) : yaml(value)));",
    '      }',
    '    }',
    '  }',
    '  if (task.acceptance) {',
    "    lines.push('acceptance:');",
    "    lines.push('  mode: ' + (task.acceptance.mode || 'guarded'));",
    "    lines.push('  expectedOutcome: ' + yaml(task.acceptance.expectedOutcome || 'fixture expected outcome'));",
    "    writeAcceptanceList(lines, 'requiredChecks', Array.isArray(task.acceptance.requiredChecks) ? task.acceptance.requiredChecks : [], ['command', 'cmd']);",
    "    writeAcceptanceList(lines, 'requiredArtifacts', Array.isArray(task.acceptance.requiredArtifacts) ? task.acceptance.requiredArtifacts : [], ['ref', 'path', 'name']);",
    '  }',
    "  lines.push('---', '# ' + (task.title || task.id), '');",
    "  writeFileSync(join(tasksDir, task.id + '.md'), lines.join('\\n'), 'utf8');",
    '};',
    '',
    "if (kind === 'decompose') {",
    '  const configs = Array.isArray(scenario.decompositions) ? scenario.decompositions : [];',
    '  const config = configs[Math.min(state.decompose - 1, Math.max(0, configs.length - 1))] || { children: [] };',
    "  const now = '2026-08-04T00:00:00.000Z';",
    "  const groupDir = join(workDir, 'task-groups', childTaskGroupId);",
    "  const versionDir = join(groupDir, 'versions', versionId);",
    "  const tasksDir = join(versionDir, 'tasks');",
    '  mkdirSync(tasksDir, { recursive: true });',
    "  mkdirSync(join(versionDir, 'eow'), { recursive: true });",
    "  const versionNumber = (versionId.match(/-v(\\d+)$/) || [])[1] || '1';",
    "  writeFileSync(join(groupDir, 'index.md'), [",
    "    '---', 'taskOpsVersion: v1', 'entityType: taskGroup', 'id: ' + childTaskGroupId,",
    "    'objective: ' + yaml('fixture child task group'), 'createdAt: ' + now, 'status: active',",
    "    'activeVersionId: ' + versionId, '---', '# ' + childTaskGroupId, '',",
    "  ].join('\\n'), 'utf8');",
    "  writeFileSync(join(versionDir, 'index.md'), [",
    "    '---', 'taskOpsVersion: v1', 'entityType: taskGroupVersion', 'id: ' + versionId,",
    "    'taskGroupId: ' + childTaskGroupId, 'version: v' + versionNumber,",
    "    'summary: ' + yaml('fixture decomposition attempt ' + state.decompose),",
    "    'createdAt: ' + now, 'status: active', '---', '# ' + versionId, '',",
    "  ].join('\\n'), 'utf8');",
    "  writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- fake attempt ' + state.decompose + '\\n', 'utf8');",
    '  for (const task of (Array.isArray(config.children) ? config.children : [])) writeTask(tasksDir, task, now);',
    "  console.log('decomposition authored ' + childTaskGroupId + '/' + versionId);",
    '  process.exit(0);',
    '}',
    '',
    "console.log(JSON.stringify(scenario.executeOutput || { executorSummary: 'fixture execution completed', observed: { outcomeSummary: 'fixture success' } }));",
    '',
  ].join('\n');
}

function createFixture({ label, tasks, decompositions, executeOutput = null }) {
  fixtureSequence += 1;
  const safeLabel = String(label).replace(/[^A-Za-z0-9_-]/g, '-');
  const tempRoot = mkdtempSync(join(
    tmpdir(),
    'taskops-convergence-decomposition-quality-' + safeLabel + '-',
  ));
  const workDir = join(tempRoot, 'work');
  const projectId = 'decomposition-quality-' + safeLabel + '-' + fixtureSequence;
  runCli([
    'init',
    workDir,
    '--id',
    projectId,
    '--title',
    projectId,
    '--objective',
    '분해 품질 runner 통합을 검증한다.',
    '--language',
    'ko',
  ]);

  const specPath = join(tempRoot, 'root-spec.json');
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: '분해 품질 통합 fixture',
    selected: true,
    tasks,
  }), 'utf8');
  runCli(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const activeSnapshotPath = snapshotPath(workDir);
  writeFileSync(
    activeSnapshotPath,
    readFileSync(activeSnapshotPath, 'utf8').replace(
      'versionId: tgv-root-v1',
      'versionId: tgv-root-v2',
    ),
    'utf8',
  );

  const scenarioPath = join(tempRoot, 'scenario.json');
  writeFileSync(scenarioPath, JSON.stringify({
    decompositions: decompositions.map((children) => ({ children })),
    executeOutput,
  }), 'utf8');
  const fakePath = join(tempRoot, 'fake-openclaw-decomposition-quality.mjs');
  writeFileSync(fakePath, fakeExecutorSource(), 'utf8');
  chmodSync(fakePath, 0o755);
  return { tempRoot, workDir, scenarioPath, fakePath };
}

function withFixture(options, fn) {
  const fixture = createFixture(options);
  try {
    return fn(fixture);
  } finally {
    rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
}

function runFixture(fixture, options) {
  const previousBin = process.env.TASKOPS_OPENCLAW_BIN;
  const previousWorkDir = process.env.TASKOPS_DECOMPOSITION_QUALITY_WORK_DIR;
  const previousScenario = process.env.TASKOPS_DECOMPOSITION_QUALITY_SCENARIO;
  process.env.TASKOPS_OPENCLAW_BIN = fixture.fakePath;
  process.env.TASKOPS_DECOMPOSITION_QUALITY_WORK_DIR = fixture.workDir;
  process.env.TASKOPS_DECOMPOSITION_QUALITY_SCENARIO = fixture.scenarioPath;
  try {
    const priorEvents = existsSync(join(fixture.workDir, 'runs', 'run-main', 'events.jsonl'))
      ? readEvents(fixture.workDir, 'run-main')
      : [];
    const result = runTaskOps(fixture.workDir, {
      executor: 'openclaw-agent',
      agent: 'main',
      timeout: 30,
      maxStepsExplicit: true,
      continueOnFailure: true,
      ...options,
    });
    const allEvents = readEvents(fixture.workDir, result.runId);
    return {
      result,
      // runTaskOps는 active runId를 재사용하므로 호출별 검증에는 이번 호출에서 추가된 event delta만 돌려준다.
      events: allEvents.slice(priorEvents.length),
      runIndex: readRunIndex(fixture.workDir, result.runId),
    };
  } finally {
    if (previousBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
    else process.env.TASKOPS_OPENCLAW_BIN = previousBin;
    if (previousWorkDir == null) delete process.env.TASKOPS_DECOMPOSITION_QUALITY_WORK_DIR;
    else process.env.TASKOPS_DECOMPOSITION_QUALITY_WORK_DIR = previousWorkDir;
    if (previousScenario == null) delete process.env.TASKOPS_DECOMPOSITION_QUALITY_SCENARIO;
    else process.env.TASKOPS_DECOMPOSITION_QUALITY_SCENARIO = previousScenario;
  }
}

function noPressureConvergence(mode = 'enforce') {
  return {
    mode,
    budget: { soft: 1, hard: 1 },
    depth: { enabled: false },
    debt: { count: 999, ratio: 1 },
    decomposition: { maxRetries: 1 },
    extension: { maxGrants: 0, fraction: 0.5 },
  };
}

function softDebtConvergence() {
  return {
    mode: 'enforce',
    budget: { soft: 1, hard: 1 },
    depth: { enabled: false },
    debt: { count: 1, ratio: 0 },
    decomposition: { maxRetries: 1 },
    extension: { maxGrants: 0, fraction: 0.5 },
  };
}

function hardBudgetConvergence({ soft = 0.2, hard = 0.3 } = {}) {
  return {
    mode: 'enforce',
    budget: { soft, hard },
    depth: { enabled: false },
    debt: { count: 999, ratio: 1 },
    decomposition: { maxRetries: 1 },
    extension: { maxGrants: 0, fraction: 0.5 },
  };
}

const evaluatedPayloadKeys = [
  'timestamp',
  'type',
  'runId',
  'taskId',
  'childTaskGroupId',
  'versionId',
  'attempt',
  'level',
  'mode',
  'childCount',
  'executableChildrenCount',
  'runnableCount',
  'verifiableCount',
  'planningCount',
  'blockedCount',
  'unresolvedBlockerCount',
  'executableChildIds',
].sort();

function assertEvaluatedEvent(event, expected) {
  assert.ok(event, 'decomposition_quality_evaluated 이벤트가 있어야 한다.');
  assert.deepEqual(
    Object.keys(event).sort(),
    evaluatedPayloadKeys,
    '평가 이벤트는 지정된 정수/id payload 외 자유 텍스트를 싣지 않아야 한다.',
  );
  assert.equal(event.type, 'decomposition_quality_evaluated');
  for (const key of [
    'attempt',
    'childCount',
    'executableChildrenCount',
    'runnableCount',
    'verifiableCount',
    'planningCount',
    'blockedCount',
    'unresolvedBlockerCount',
  ]) {
    assert.equal(Number.isInteger(event[key]), true, key + '는 정수여야 한다.');
  }
  assert.equal(Array.isArray(event.executableChildIds), true);
  assert.equal(event.executableChildIds.every((id) => typeof id === 'string'), true);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(event[key], value);
}

function assertDecompositionSummary(runIndex, expected) {
  const summary = runIndex.convergenceDecomposition;
  assert.ok(summary && typeof summary === 'object', 'run index에 convergenceDecomposition 요약이 있어야 한다.');
  const keys = [
    'evaluated',
    'executableZero',
    'rejected',
    'retried',
    'fallbackParentExecute',
    'honestBlocked',
    'lastExecutableChildrenCount',
  ];
  for (const key of keys) {
    assert.equal(Number.isInteger(summary[key]), true, '요약 ' + key + '는 정수여야 한다.');
  }
  for (const [key, value] of Object.entries(expected)) assert.equal(summary[key], value, key);
}

function childTaskFiles(workDir) {
  const taskGroupsDir = join(workDir, 'task-groups');
  const files = [];
  for (const groupEntry of readdirSync(taskGroupsDir, { withFileTypes: true })) {
    if (!groupEntry.isDirectory() || groupEntry.name === 'tg-root') continue;
    const versionsDir = join(taskGroupsDir, groupEntry.name, 'versions');
    if (!existsSync(versionsDir)) continue;
    for (const versionEntry of readdirSync(versionsDir, { withFileTypes: true })) {
      if (!versionEntry.isDirectory()) continue;
      const tasksDir = join(versionsDir, versionEntry.name, 'tasks');
      if (!existsSync(tasksDir)) continue;
      for (const taskEntry of readdirSync(tasksDir, { withFileTypes: true })) {
        if (taskEntry.isFile() && taskEntry.name.endsWith('.md')) {
          files.push(join(tasksDir, taskEntry.name));
        }
      }
    }
  }
  return files.sort();
}

function assertNoUpwardClamps(workDir) {
  const files = childTaskFiles(workDir);
  assert.ok(files.length > 0, 'clamp 회귀 검증용 자식 frontmatter가 있어야 한다.');
  const readinessRaised = [];
  const uncertaintyRaised = [];
  for (const file of files) {
    const child = parseMarkdownFile(file);
    if (
      child.fixtureAuthoredRunReadiness !== 'runnable'
      && child.runReadiness === 'runnable'
    ) readinessRaised.push(child.id);
    if (
      child.fixtureAuthoredUncertaintyState !== 'known'
      && child.uncertaintyState === 'known'
    ) uncertaintyRaised.push(child.id);
  }
  assert.deepEqual(readinessRaised, [], 'runReadiness가 runnable로 상향된 자식이 없어야 한다.');
  assert.deepEqual(uncertaintyRaised, [], 'uncertaintyState가 known으로 상향된 자식이 없어야 한다.');
}

const failures = [];
let passes = 0;

function test(name, fn) {
  try {
    fn();
    passes += 1;
    console.log('ok ' + name);
  } catch (error) {
    failures.push({ name, error });
    console.error('not ok ' + name);
    console.error(error instanceof Error ? error.stack : String(error));
  }
}

// T1 — level=none은 기존 자유도를 보존하되, 모든 mode에서 품질 측정은 항상 남긴다.
test('T1 level=none 자유도와 항상 발화하는 품질 평가', () => {
  for (const mode of ['off', 'observe', 'enforce']) {
    withFixture({
      label: 't1-' + mode,
      tasks: [parentTask()],
      decompositions: [mixedSixChildren()],
    }, (fixture) => {
      const run = runFixture(fixture, {
        maxSteps: 1,
        convergence: noPressureConvergence(mode),
      });
      const parent = parseMarkdownFile(rootTaskPath(fixture.workDir));
      assert.equal(parent.status, 'done', mode + ': level=none 부모는 기존처럼 done이어야 한다.');
      assert.equal(parent.convergenceDecompositionAbandoned, undefined);
      assert.equal(eventsOfType(run.events, 'decomposition_completed').length, 1);
      assert.equal(eventsOfType(run.events, 'decomposition_quality_rejected').length, 0);
      const evaluated = eventsOfType(run.events, 'decomposition_quality_evaluated');
      assert.equal(evaluated.length, 1);
      assertEvaluatedEvent(evaluated[0], {
        runId: run.result.runId,
        taskId: 'task-parent',
        childTaskGroupId: 'tg-parent',
        versionId: 'tgv-parent-v1',
        attempt: 1,
        level: 'none',
        mode,
        childCount: 6,
        executableChildrenCount: 0,
        runnableCount: 1,
        verifiableCount: 4,
        planningCount: 3,
        blockedCount: 2,
        unresolvedBlockerCount: 1,
        executableChildIds: [],
      });
      assertDecompositionSummary(run.runIndex, {
        evaluated: 1,
        executableZero: 1,
        rejected: 0,
        retried: 0,
        fallbackParentExecute: 0,
        honestBlocked: 0,
        lastExecutableChildrenCount: 0,
      });
    });
  }
});

// T2 — 같은 run의 다음 분해 prompt가 직전 0-executable 실측 정수를 받는다.
test('T2 soft 수치 피드백이 다음 decompose prompt에 도달', () => {
  withFixture({
    label: 't2-soft-feedback',
    tasks: [parentTask()],
    decompositions: [lowQualityChildren(6, 'task-soft-child'), lowQualityChildren(2, 'task-soft-grandchild')],
  }, (fixture) => {
    const run = runFixture(fixture, {
      maxSteps: 2,
      convergence: softDebtConvergence(),
    });
    const evaluated = eventsOfType(run.events, 'decomposition_quality_evaluated');
    assert.equal(evaluated.length, 2, '두 분해 모두 평가되어야 한다.');
    assert.equal(evaluated[0].childCount, 6);
    assert.equal(evaluated[0].executableChildrenCount, 0);
    assert.equal(evaluated[0].runnableCount, 0);
    assert.equal(evaluated[0].verifiableCount, 0);
    assert.equal(evaluated[0].blockedCount, 0);
    assert.equal(evaluated[0].unresolvedBlockerCount, 0);
    const secondPrompt = readFileSync(promptPath(fixture.workDir, 'decompose', 2), 'utf8');
    assertFeedbackNumbers(secondPrompt, {
      childCount: 6,
      executableChildrenCount: 0,
      runnableCount: 0,
      verifiableCount: 0,
      blockedCount: 0,
      unresolvedBlockerCount: 0,
    });
    assert.equal(eventsOfType(run.events, 'decomposition_quality_rejected').length, 0);
    const mirrored = run.runIndex.convergenceDecompositionFeedback;
    assert.ok(mirrored, 'run index에 마지막 0-executable 피드백이 미러되어야 한다.');
    assert.equal(mirrored.childCount, 2);
    assert.equal(mirrored.executableChildrenCount, 0);
  });
});

// T3 — 이력이 없거나 직전 분해가 executable=2이면 수치 블록을 만들지 않는다.
test('T3 첫 분해와 executable=2 이력에는 피드백 블록 미발화', () => {
  withFixture({
    label: 't3-no-history',
    tasks: [parentTask()],
    decompositions: [executableTwoChildren()],
  }, (fixture) => {
    const run = runFixture(fixture, {
      maxSteps: 1,
      convergence: softDebtConvergence(),
    });
    const prompt = readFileSync(promptPath(fixture.workDir, 'decompose', 1), 'utf8');
    assert.equal(feedbackLine(prompt), null, '이력 없는 첫 prompt에는 실측 피드백이 없어야 한다.');
    const evaluated = eventsOfType(run.events, 'decomposition_quality_evaluated')[0];
    assert.ok(evaluated, 'executable=2 분해도 평가 이벤트를 남겨야 한다.');
    assert.equal(evaluated.executableChildrenCount, 2);
  });

  withFixture({
    label: 't3-two-executable',
    tasks: [parentTask()],
    decompositions: [executableTwoChildren(), executableTwoChildren()],
  }, (fixture) => {
    const run = runFixture(fixture, {
      maxSteps: 2,
      convergence: softDebtConvergence(),
    });
    const evaluated = eventsOfType(run.events, 'decomposition_quality_evaluated');
    assert.equal(evaluated[0].childCount, 3);
    assert.equal(evaluated[0].executableChildrenCount, 2);
    const secondPrompt = readFileSync(promptPath(fixture.workDir, 'decompose', 2), 'utf8');
    assert.equal(feedbackLine(secondPrompt), null, '직전 executable=2이면 피드백 블록이 없어야 한다.');
  });
});

// T4 — hard에서도 실행 가능한 자식이 하나 있으면 수용하고 snapshot에 연결한다.
test('T4 hard 분해 품질 수용과 activeSnapshot 연결', () => {
  withFixture({
    label: 't4-hard-accept',
    tasks: [primerTask(1), parentTask({ order: 2 })],
    decompositions: [acceptedHardChildren()],
  }, (fixture) => {
    const run = runFixture(fixture, {
      maxSteps: 3,
      verifyChecks: true,
      convergence: hardBudgetConvergence(),
    });
    const parent = parseMarkdownFile(rootTaskPath(fixture.workDir));
    assert.equal(parent.status, 'done');
    const rejected = eventsOfType(run.events, 'decomposition_quality_rejected');
    assert.equal(rejected.length, 0);
    const evaluated = eventsOfType(run.events, 'decomposition_quality_evaluated');
    assert.equal(evaluated.length, 1);
    assert.equal(evaluated[0].level, 'hard');
    assert.equal(evaluated[0].childCount, 3);
    assert.equal(evaluated[0].executableChildrenCount, 1);
    assert.deepEqual(evaluated[0].executableChildIds, ['task-child-exec']);
    const completed = eventsOfType(run.events, 'decomposition_completed')[0];
    assert.deepEqual(completed.decompositionQuality, {
      childCount: 3,
      executableChildrenCount: 1,
      unresolvedBlockerCount: 0,
      attempt: 1,
    });
    assert.equal(hasSelectedVersion(fixture.workDir, 'tg-parent', 'tgv-parent-v1'), true);
    const childAction = run.result.actions.find((action) => action.taskId === 'task-child-exec');
    assert.equal(childAction?.kind, 'execute', 'snapshot에 들어간 실행 가능 자식이 다음 선택 대상이어야 한다.');
    assert.ok(
      eventsOfType(run.events, 'task_selected').some((event) => event.taskId === 'task-child-exec'),
      '자식의 실제 execute 선택 이벤트가 있어야 한다.',
    );
    assertDecompositionSummary(run.runIndex, {
      evaluated: 1,
      executableZero: 0,
      rejected: 0,
      retried: 0,
      fallbackParentExecute: 0,
      honestBlocked: 0,
      lastExecutableChildrenCount: 1,
    });
  });
});

// T5 — 첫 미달은 정상 스텝으로 거부되고, 동일 부모의 다음 target은 v2다.
test('T5 hard 재분해 1회와 v2 target', () => {
  withFixture({
    label: 't5-reject-state',
    tasks: [primerTask(1), parentTask({ order: 2 })],
    decompositions: [clampProbeChildren()],
  }, (fixture) => {
    const run = runFixture(fixture, {
      maxSteps: 2,
      convergence: hardBudgetConvergence({ soft: 0.25, hard: 0.5 }),
    });
    const parent = parseMarkdownFile(rootTaskPath(fixture.workDir));
    assert.equal(parent.status, 'pending', '첫 거부 뒤 부모 status는 pending을 유지해야 한다.');
    assert.notEqual(parent.status, 'done');
    assert.equal(parent.runReadiness, 'needs_decomposition');
    assert.equal(parent.uncertaintyState, 'known_unknown');
    assert.equal(parent.decompositionAttempt, 2);
    assert.equal(typeof parent.lastDecompositionRejection, 'string');
    assert.equal(parent.decompositionQuality.childCount, 3);
    assert.equal(parent.decompositionQuality.executableChildrenCount, 0);
    assert.equal(parent.decompositionQuality.attempt, 1);
    const rejected = eventsOfType(run.events, 'decomposition_quality_rejected');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].nextAction, 'redecompose');
    const action = run.result.actions.find((item) => item.kind === 'decompose');
    assert.equal(action?.status, 'rejected_low_quality');
    assert.notEqual(run.result.stopReason, 'task_failed');
    assert.equal(hasSelectedVersion(fixture.workDir, 'tg-parent', 'tgv-parent-v1'), false);
    assertDecompositionSummary(run.runIndex, {
      evaluated: 1,
      executableZero: 1,
      rejected: 1,
      retried: 1,
      lastExecutableChildrenCount: 0,
    });
  });

  withFixture({
    label: 't5-next-step-v2',
    tasks: [primerTask(1), parentTask({ order: 2 })],
    decompositions: [clampProbeChildren(), clampProbeChildren()],
  }, (fixture) => {
    const run = runFixture(fixture, {
      maxSteps: 3,
      convergence: hardBudgetConvergence(),
    });
    const secondPrompt = readFileSync(promptPath(fixture.workDir, 'decompose', 2), 'utf8');
    assert.equal(
      secondPrompt.includes('Target version id: tgv-parent-v2'),
      true,
      '동일 부모의 다음 decompose target은 tgv-parent-v2여야 한다.',
    );
    assert.equal(
      run.result.actions.filter((action) => action.taskId === 'task-parent' && action.kind === 'decompose').length,
      2,
      '동일 부모가 연속 두 decompose step으로 선택되어야 한다.',
    );
    assert.equal(eventsOfType(run.events, 'decomposition_quality_rejected').length, 2);
    assert.notEqual(run.result.stopReason, 'task_failed');
    assert.equal(hasSelectedVersion(fixture.workDir, 'tg-parent', 'tgv-parent-v1'), false);
  });
});

function exerciseFallbackCase(checkCommand, label, expectDone) {
  withFixture({
    label,
    tasks: [primerTask(1), parentTask({ order: 2, acceptance: guardedCheck(checkCommand) })],
    decompositions: [clampProbeChildren(), clampProbeChildren()],
  }, (fixture) => {
    if (checkCommand.includes('__TASKOPS_WORK_DIR__')) {
      const taskPath = rootTaskPath(fixture.workDir);
      writeFileSync(
        taskPath,
        readFileSync(taskPath, 'utf8').replaceAll('__TASKOPS_WORK_DIR__', fixture.workDir),
        'utf8',
      );
    }
    const before = parseMarkdownFile(rootTaskPath(fixture.workDir));
    const first = runFixture(fixture, {
      maxSteps: 3,
      convergence: hardBudgetConvergence(),
    });
    const afterFallback = parseMarkdownFile(rootTaskPath(fixture.workDir));
    assert.equal(afterFallback.status, 'pending');
    assert.equal(afterFallback.runReadiness, before.runReadiness);
    assert.equal(afterFallback.uncertaintyState, before.uncertaintyState);
    assert.equal(afterFallback.convergenceDecompositionAbandoned.attempts, 2);
    assert.equal(afterFallback.convergenceDecompositionAbandoned.executableChildrenCount, 0);
    assert.equal(typeof afterFallback.convergenceDecompositionAbandoned.reason, 'string');
    assert.equal(eventsOfType(first.events, 'decomposition_quality_rejected').length, 2);
    assert.equal(eventsOfType(first.events, 'decomposition_fallback_parent_execute').length, 1);
    assert.equal(first.result.actions[1].status, 'rejected_low_quality');
    assert.equal(first.result.actions[2].status, 'rejected_low_quality');
    assert.equal(first.result.actions[2].fallback, true);
    assertDecompositionSummary(first.runIndex, {
      evaluated: 2,
      executableZero: 2,
      rejected: 2,
      retried: 1,
      honestBlocked: 0,
      lastExecutableChildrenCount: 0,
    });

    const second = runFixture(fixture, {
      maxSteps: 1,
      convergence: noPressureConvergence('enforce'),
    });
    const allEvents = [...first.events, ...second.events];
    assert.equal(
      eventsOfType(allEvents, 'decomposition_started').length,
      2,
      'fallback 뒤 세 번째 분해를 시작하면 안 된다.',
    );
    const forced = eventsOfType(second.events, 'convergence_forced_execute');
    assert.equal(forced.length, 1);
    assert.equal(forced[0].reason, 'decomposition_abandoned_parent_fallback');
    assert.ok(
      eventsOfType(second.events, 'task_selected').some((event) => event.taskId === 'task-parent'),
      'fallback 부모의 execute 선택 이벤트가 있어야 한다.',
    );
    assert.equal(second.result.actions[0].kind, 'execute');
    assert.equal(second.result.actions[0].taskId, 'task-parent');
    const finalParent = parseMarkdownFile(rootTaskPath(fixture.workDir));
    if (expectDone) {
      assert.equal(finalParent.status, 'done', '통과 체크 뒤 fallback 부모는 done이어야 한다.');
    } else {
      assert.notEqual(finalParent.status, 'done', '실패 체크 뒤 fallback 부모는 done이면 안 된다.');
      assert.equal(finalParent.status, 'blocked');
    }
  });
}

// T6 — 두 번 미달한 검증 가능 부모는 level=none인 후속 step에서도 execute로 폴백한다.
test('T6 폴백 B 부모 execute와 실패 체크 방화벽', () => {
  exerciseFallbackCase(DECOMPOSED_TWICE_CHECK, 't6-fallback-pass', true);
  exerciseFallbackCase(FAIL_CHECK, 't6-fallback-fail', false);
});

// T7 — 검증할 수 없는 부모는 blocked로 정직하게 닫고 blockedBy를 보존한다.
test('T7 retry 소진 뒤 honest blocked와 blockedBy 불변', () => {
  const parentBlockers = [{
    type: 'task',
    id: 'task-primer',
    taskGroupVersionId: 'tgv-root-v2',
  }];
  withFixture({
    label: 't7-honest-block',
    tasks: [
      primerTask(1),
      parentTask({ order: 2, blockedBy: parentBlockers }),
    ],
    decompositions: [honestLowQualityChildren(), honestLowQualityChildren()],
  }, (fixture) => {
    const before = parseMarkdownFile(rootTaskPath(fixture.workDir));
    const run = runFixture(fixture, {
      maxSteps: 3,
      verifyChecks: true,
      convergence: hardBudgetConvergence(),
    });
    const parent = parseMarkdownFile(rootTaskPath(fixture.workDir));
    assert.equal(parent.status, 'blocked');
    assert.notEqual(parent.status, 'done');
    assert.equal(parent.needsManualReview, true);
    assert.equal(typeof parent.manualReviewReason, 'string');
    assert.equal(typeof parent.runReadinessReason, 'string');
    assert.equal(parent.runReadinessReason.includes('2'), true, 'reason은 childCount=2 실측을 포함해야 한다.');
    assert.equal(parent.runReadinessReason.includes('0'), true, 'reason은 executableChildrenCount=0 실측을 포함해야 한다.');
    assert.deepEqual(parent.blockedBy, before.blockedBy, 'honest block은 부모 blockedBy를 변경하면 안 된다.');
    const blocked = eventsOfType(run.events, 'decomposition_quality_blocked_honest');
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].attempts, 2);
    assert.equal(blocked[0].childCount, 2);
    assert.equal(blocked[0].executableChildrenCount, 0);
    assert.equal(blocked[0].unresolvedBlockerCount, 1);
    assert.equal(eventsOfType(run.events, 'convergence_forced_execute').length, 0);
    assert.equal(run.result.actions[2].status, 'blocked_honest');
    assertDecompositionSummary(run.runIndex, {
      evaluated: 2,
      executableZero: 2,
      rejected: 2,
      retried: 1,
      fallbackParentExecute: 0,
      honestBlocked: 1,
      lastExecutableChildrenCount: 0,
    });
  });
});

// T8 — retry/fallback/honest-block 어느 경로도 자식 또는 부모 readiness/uncertainty를 낙관 상향하지 않는다.
test('T8 자식 runnable/known 상향 clamp 금지', () => {
  for (const entry of [
    { label: 't8-redecompose', acceptance: null },
    { label: 't8-fallback', acceptance: guardedCheck(PASS_CHECK) },
    { label: 't8-honest-block', acceptance: null },
  ]) {
    withFixture({
      label: entry.label,
      tasks: [primerTask(1), parentTask({ order: 2, acceptance: entry.acceptance })],
      decompositions: [clampProbeChildren(), clampProbeChildren()],
    }, (fixture) => {
      const beforeParent = parseMarkdownFile(rootTaskPath(fixture.workDir));
      runFixture(fixture, {
        maxSteps: 3,
        convergence: hardBudgetConvergence(),
      });
      assertNoUpwardClamps(fixture.workDir);
      assert.equal(childTaskFiles(fixture.workDir).length, 6, 'v1/v2의 모든 자식 frontmatter를 검사해야 한다.');
      if (entry.acceptance) {
        const afterParent = parseMarkdownFile(rootTaskPath(fixture.workDir));
        assert.equal(afterParent.runReadiness, beforeParent.runReadiness);
        assert.equal(afterParent.uncertaintyState, beforeParent.uncertaintyState);
      }
    });
  }
});

function setupTierTwoFixture(label, childFactory) {
  return {
    label,
    tasks: [
      parentTask({ order: 1, acceptance: guardedCheck(PASS_CHECK) }),
      pressureTask('task-pressure-a', 2),
      pressureTask('task-pressure-b', 3),
    ],
    decompositions: [
      childFactory(PASS_CHECK),
      blockedPressureChildren('pressure-a'),
      blockedPressureChildren('pressure-b'),
    ],
  };
}

// T9 — 열린 자손이 모두 비실행이면 deferred 부모를 tier-2로 한 번 되살리고,
// 실행 가능한 열린 자손이 있으면 tier-1 자식이 우선한다.
test('T9 tier-2 부모 소생과 실행 가능 자손 대조군', () => {
  withFixture(
    setupTierTwoFixture('t9-tier-two-parent', nonExecutableDescendants),
    (fixture) => {
      const initial = runFixture(fixture, {
        maxSteps: 1,
        convergence: noPressureConvergence('enforce'),
      });
      const decomposedParent = parseMarkdownFile(rootTaskPath(fixture.workDir));
      assert.equal(decomposedParent.status, 'done');
      assert.deepEqual(decomposedParent.convergenceDeferredAcceptance?.uncovered, {
        checks: [],
        artifacts: [],
      });
      assert.deepEqual(decomposedParent.convergenceDeferredAcceptance?.full, {
        checks: [PASS_CHECK],
        artifacts: [],
      });
      assert.equal(
        eventsOfType(initial.events, 'convergence_acceptance_descent_gap').length,
        0,
        'uncovered가 비어 있으면 gap 이벤트는 발화하지 않아야 한다.',
      );

      const hard = runFixture(fixture, {
        maxSteps: 2,
        convergence: hardBudgetConvergence({ soft: 0.25, hard: 0.5 }),
      });
      assert.notEqual(hard.result.stopReason, 'convergence_blocked');
      assert.equal(eventsOfType(hard.events, 'convergence_blocked_no_candidate').length, 0);
      const reverify = eventsOfType(hard.events, 'convergence_deferred_acceptance_reverify');
      assert.equal(reverify.length, 1);
      assert.equal(reverify[0].taskId, 'task-parent');
      assert.ok(
        eventsOfType(hard.events, 'convergence_forced_execute').some((event) => event.taskId === 'task-parent'),
        'tier-2 부모의 forced execute 이벤트가 있어야 한다.',
      );
      assert.ok(
        eventsOfType(hard.events, 'task_selected').some((event) => event.taskId === 'task-parent'),
        'tier-2 부모가 실제 execute 경로로 선택되어야 한다.',
      );
      const afterReverify = parseMarkdownFile(rootTaskPath(fixture.workDir));
      assert.equal(afterReverify.status, 'done');
      const firstReverifiedAt = afterReverify.convergenceDeferredAcceptance?.reverifiedAt;
      assert.equal(Number.isNaN(Date.parse(firstReverifiedAt || '')), false);

      const onceOnly = runFixture(fixture, {
        maxSteps: 2,
        convergence: hardBudgetConvergence({ soft: 0.25, hard: 0.5 }),
      });
      assert.equal(eventsOfType(onceOnly.events, 'convergence_deferred_acceptance_reverify').length, 0);
      assert.equal(
        eventsOfType([...hard.events, ...onceOnly.events], 'convergence_deferred_acceptance_reverify').length,
        1,
        'reverifiedAt가 있는 부모는 두 번째로 소생하면 안 된다.',
      );
      const finalParent = parseMarkdownFile(rootTaskPath(fixture.workDir));
      assert.equal(finalParent.convergenceDeferredAcceptance?.reverifiedAt, firstReverifiedAt);
    },
  );

  withFixture(
    setupTierTwoFixture('t9-tier-one-control', executableDescendants),
    (fixture) => {
      runFixture(fixture, {
        maxSteps: 1,
        convergence: noPressureConvergence('enforce'),
      });
      const childPath = join(
        fixture.workDir,
        'task-groups',
        'tg-parent',
        'versions',
        'tgv-parent-v1',
        'tasks',
        'task-child-tier-one.md',
      );
      assert.equal(parseMarkdownFile(childPath).status, 'pending');
      const hard = runFixture(fixture, {
        maxSteps: 2,
        convergence: hardBudgetConvergence({ soft: 0.25, hard: 0.5 }),
      });
      assert.equal(eventsOfType(hard.events, 'convergence_deferred_acceptance_reverify').length, 0);
      assert.ok(
        eventsOfType(hard.events, 'task_selected').some((event) => event.taskId === 'task-child-tier-one'),
        '실행 가능한 열린 자손이 tier-1으로 선택되어야 한다.',
      );
      assert.ok(
        hard.result.actions.some((action) => action.taskId === 'task-child-tier-one' && action.kind === 'execute'),
      );
      const parent = parseMarkdownFile(rootTaskPath(fixture.workDir));
      assert.equal(parent.status, 'done');
      assert.equal(parent.convergenceDeferredAcceptance?.reverifiedAt, undefined);
    },
  );
});

if (failures.length > 0) {
  console.error(
    'convergence decomposition quality failed: '
    + failures.length
    + ' failed, '
    + passes
    + ' passed',
  );
  process.exit(1);
}

console.log('convergence decomposition quality passed');
