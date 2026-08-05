#!/usr/bin/env node
// 분해 실패의 원자성 + 재시도 훅.
//
// 병리: adapter 가 task-groups/<cid>/index.md 를 activeVersionId=<vid> 로 써놓고
// versions/<vid>/index.md 를 만들지 못하면, 롤백이 없어서 work 그래프가 영구 무효화된다
// (lib-taskops.js 의 activeVersionNotFound 검증). 그러면 이후 모든 런이 스케줄링 불가로 즉사한다.
//
// 이 테스트가 지키는 계약:
//  1) 분해가 실패해도 그래프는 유효하게 남는다(전부 성공 or 전부 롤백).
//  2) 실패하면 정확히 1회 재시도하고, 재시도 프롬프트에 직전 실패 진단이 실린다.
//  3) 재시도도 실패하면 task 는 정직하게 blocked 이고 그래프는 여전히 유효하다.
//  4) 스키마 위반(blockedBy JSON 문자열 / expectedPlan non-object)도 롤백+재시도 대상이다.
//  5) 재시도 산출물에 스키마 위반이 남아도 그래프가 유효하고 자식이 있으면 수용하되 부채로 기록한다.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { pendingBacklinkErrorPatterns, runTaskOps } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-decomposition-atomicity-'));

function run(args, options = {}) {
  const result = spawnSync('node', [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== (options.expectStatus ?? 0)) {
    throw new Error(`taskops ${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function makeWork(id, { decompositionTaskId = 'task-open-depth' } = {}) {
  const workDir = join(tempRoot, id);
  run(['init', workDir, '--id', id, '--title', id, '--objective', 'Verify decomposition atomicity', '--language', 'en']);
  const specPath = join(tempRoot, `${id}-root-spec.json`);
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Root atomicity fixture',
    selected: true,
    tasks: [
      {
        id: decompositionTaskId,
        title: 'Open depth',
        objective: 'Decompose into one child group.',
        responsibility: 'Exercise decomposition atomicity for agent-authored decomposition.',
        completionCriteria: 'A child group is accepted only when the graph stays valid.',
        order: 1,
        status: 'pending',
        runReadiness: 'needs_decomposition',
        uncertaintyState: 'known_unknown',
        confidenceScore: 0.5,
        decompositionConfidence: 0.8,
      },
      {
        id: 'task-sibling',
        title: 'Sibling that must survive',
        objective: 'Stay schedulable even when the sibling decomposition fails.',
        responsibility: 'Prove other tasks keep progressing after a failed decomposition.',
        completionCriteria: 'Sibling remains selectable.',
        order: 2,
        status: 'pending',
        runReadiness: 'needs_exploration',
        uncertaintyState: 'unknown_unknown',
        confidenceScore: 0.2,
      },
    ],
  }), 'utf8');
  run(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
  return workDir;
}

// adapter 대역. TASKOPS_ATOMICITY_MODE 에 따라 attempt 별로 다른 산출물을 쓴다.
// attempt 카운터와 프롬프트는 TASKOPS_ATOMICITY_TRACE_DIR 에 남겨 호출 횟수/프롬프트 내용을 검증한다.
function makeFakeOpenClaw() {
  const fakePath = join(tempRoot, 'fake-openclaw-atomicity.mjs');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) {
  console.log('openclaw fake decomposition atomicity');
  process.exit(0);
}

const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const workDir = process.env.TASKOPS_ATOMICITY_WORK_DIR;
const traceDir = process.env.TASKOPS_ATOMICITY_TRACE_DIR;
const mode = process.env.TASKOPS_ATOMICITY_MODE || 'half';
if (!workDir || !traceDir) {
  console.error('missing TASKOPS_ATOMICITY_WORK_DIR / TASKOPS_ATOMICITY_TRACE_DIR');
  process.exit(2);
}
mkdirSync(traceDir, { recursive: true });
const attempt = readdirSync(traceDir).filter((n) => n.startsWith('prompt-')).length + 1;
writeFileSync(join(traceDir, 'prompt-' + attempt + '.txt'), prompt, 'utf8');

const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
if (!childTaskGroupId || !versionId) {
  console.error('missing target ids in prompt');
  process.exit(2);
}
const now = '2026-06-28T00:00:00.000Z';
const groupDir = join(workDir, 'task-groups', childTaskGroupId);
const versionDir = join(groupDir, 'versions', versionId);

function writeGroupIndex() {
  mkdirSync(groupDir, { recursive: true });
  writeFileSync(join(groupDir, 'index.md'), [
    '---',
    'taskOpsVersion: v1',
    'entityType: taskGroup',
    'id: ' + childTaskGroupId,
    'objective: Atomicity child group',
    'createdAt: ' + now,
    'status: active',
    'activeVersionId: ' + versionId,
    '---',
    '# ' + childTaskGroupId,
    '',
  ].join('\\n'), 'utf8');
}

function writeVersionIndex() {
  mkdirSync(join(versionDir, 'tasks'), { recursive: true });
  mkdirSync(join(versionDir, 'eow'), { recursive: true });
  writeFileSync(join(versionDir, 'index.md'), [
    '---',
    'taskOpsVersion: v1',
    'entityType: taskGroupVersion',
    'id: ' + versionId,
    'taskGroupId: ' + childTaskGroupId,
    'version: v1',
    'summary: Atomicity child version',
    'createdAt: ' + now,
    'status: active',
    '---',
    '# Atomicity child version',
    '',
  ].join('\\n'), 'utf8');
  writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- Authored by atomicity fake.\\n', 'utf8');
}

function writeChildren({ badSchema }) {
  for (const [id, order] of [['task-child-a', 1], ['task-child-b', 2]]) {
    const lines = [
      '---',
      'taskOpsVersion: v1',
      'entityType: task',
      'id: ' + id,
      'taskGroupId: ' + childTaskGroupId,
      'taskGroupVersionId: ' + versionId,
      'title: Child ' + order,
      'objective: Complete child slice ' + order + '.',
      'responsibility: Own child slice ' + order + '.',
      'completionCriteria: Child slice ' + order + ' is ready for future work.',
      'purpose: Serve the parent open-depth goal, slice ' + order + '.',
      'expectedResult: Slice ' + order + ' artifact exists.',
      'order: ' + order,
      'createdAt: ' + now,
      'status: pending',
      'runReadiness: needs_exploration',
      'uncertaintyState: unknown_unknown',
      'confidenceScore: 0.2',
    ];
    if (badSchema) {
      // 관측된 병리: blockedBy 를 JSON 배열 '문자열' 로 통째 뱉고 expectedPlan 을 객체가 아닌 스칼라로 쓴다.
      lines.push("blockedBy: '[{\\"type\\":\\"task\\",\\"taskId\\":\\"task-nowhere-" + order + "\\"}]'");
      lines.push('expectedPlan: depth 1 breadth 2');
    }
    lines.push('---', '# Child ' + order, '');
    writeFileSync(join(versionDir, 'tasks', id + '.md'), lines.join('\\n'), 'utf8');
  }
}

function writePostprocessThrowChild() {
  // closeDecomposeSuccess 의 expectedPlan 보정은 원본 파일명 뒤에 임시 suffix 를 붙인다.
  // 원본은 허용되지만 임시 파일만 NAME_MAX 를 넘게 만들어, adapter 성공 뒤의 postprocess throw 를
  // 실제 파일 I/O로 재현한다. 디렉터리 권한을 망가뜨리지 않으므로 롤백 자체는 정상 수행 가능하다.
  const id = 'task-child-' + 'x'.repeat(220);
  writeFileSync(join(versionDir, 'tasks', id + '.md'), [
    '---',
    'taskOpsVersion: v1',
    'entityType: task',
    'id: ' + id,
    'taskGroupId: ' + childTaskGroupId,
    'taskGroupVersionId: ' + versionId,
    'title: Postprocess throw child',
    'objective: Trigger a postprocess-only write failure.',
    'responsibility: Keep the pre-commit graph valid until closeDecomposeSuccess runs.',
    'completionCriteria: The parent stays blocked and the invalidating child group is rolled back.',
    'purpose: Exercise postprocess decomposition atomicity.',
    'expectedResult: The work graph remains schedulable.',
    'order: 1',
    'createdAt: ' + now,
    'status: pending',
    'runReadiness: needs_exploration',
    'uncertaintyState: unknown_unknown',
    'confidenceScore: 0.2',
    '---',
    '# Postprocess throw child',
    '',
  ].join('\\n'), 'utf8');
}

if (mode === 'half') {
  // 항상 반쪽: taskGroup index 만 쓰고 version index 는 안 쓴다.
  writeGroupIndex();
} else if (mode === 'half_then_complete') {
  writeGroupIndex();
  if (attempt >= 2) { writeVersionIndex(); writeChildren({ badSchema: false }); }
} else if (mode === 'complete') {
  writeGroupIndex();
  writeVersionIndex();
  writeChildren({ badSchema: false });
} else if (mode === 'schema_then_complete') {
  writeGroupIndex();
  writeVersionIndex();
  writeChildren({ badSchema: attempt < 2 });
} else if (mode === 'schema_always') {
  writeGroupIndex();
  writeVersionIndex();
  writeChildren({ badSchema: true });
} else if (mode === 'postprocess_throw') {
  writeGroupIndex();
  writeVersionIndex();
  writePostprocessThrowChild();
} else if (mode === 'realistic_backlink') {
  // 실제 경로 재현: taskops decompose CLI 는 자식 version index 에 decomposedFrom*/decomposedBy* 를 심는다.
  // 이때 부모의 childTaskGroupId 는 아직 비어 있으므로(게이트 뒤에 쓰인다) parseProject 가
  // "parent task ... points to childTaskGroupId ''" 를 낸다 — 산출물 결함이 아니라 쓰기 순서 인공물이다.
  writeGroupIndex();
  mkdirSync(join(versionDir, 'tasks'), { recursive: true });
  mkdirSync(join(versionDir, 'eow'), { recursive: true });
  const nodesDir = join(workDir, 'runs');
  let runId = null; let runNodeId = null;
  for (const rid of readdirSync(nodesDir)) {
    const dir = join(nodesDir, rid, 'nodes');
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const text = readFileSync(join(dir, name), 'utf8');
      if (/^type: decomposition$/m.test(text) && /^sourceTaskId: task-open-depth$/m.test(text)) {
        runId = rid;
        runNodeId = (text.match(/^id: ([^\\n]+)$/m) || [])[1]?.trim() || null;
      }
    }
  }
  writeFileSync(join(versionDir, 'index.md'), [
    '---',
    'taskOpsVersion: v1',
    'entityType: taskGroupVersion',
    'id: ' + versionId,
    'taskGroupId: ' + childTaskGroupId,
    'version: v1',
    'summary: Atomicity child version',
    'createdAt: ' + now,
    'status: active',
    'decomposedFromTaskId: task-open-depth',
    'decomposedFromTaskGroupId: tg-root',
    'decomposedFromTaskGroupVersionId: tgv-root-v2',
    'decomposedByRunId: ' + runId,
    'decomposedByRunNodeId: ' + runNodeId,
    '---',
    '# Atomicity child version',
    '',
  ].join('\\n'), 'utf8');
  writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\\n\\n- Authored by atomicity fake.\\n', 'utf8');
  writeChildren({ badSchema: false });
} else if (mode === 'no_children') {
  writeGroupIndex();
  writeVersionIndex();
} else if (mode === 'dangling_active_version') {
  // 기대 version 과 자식은 온전히 쓰지만 activeVersionId 를 존재하지 않는 version 으로 가리킨다.
  // = missing_version_index / no_child_tasks 를 통과하고 graph_invalid 게이트만 잡을 수 있는 형태.
  mkdirSync(groupDir, { recursive: true });
  writeFileSync(join(groupDir, 'index.md'), [
    '---',
    'taskOpsVersion: v1',
    'entityType: taskGroup',
    'id: ' + childTaskGroupId,
    'objective: Atomicity child group',
    'createdAt: ' + now,
    'status: active',
    'activeVersionId: ' + versionId + '-ghost',
    '---',
    '# ' + childTaskGroupId,
    '',
  ].join('\\n'), 'utf8');
  writeVersionIndex();
  writeChildren({ badSchema: false });
} else {
  console.error('unknown mode ' + mode);
  process.exit(2);
}
console.log('fake adapter attempt ' + attempt + ' mode ' + mode);
process.exit(0);
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function readEvents(workDir, runId) {
  return readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8')
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function taskPath(workDir, taskId = 'task-open-depth') {
  return join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2', 'tasks', `${taskId}.md`);
}

function promptCount(traceDir) {
  return existsSync(traceDir) ? readdirSync(traceDir).filter((n) => n.startsWith('prompt-')).length : 0;
}

function promptText(traceDir, attempt) {
  return readFileSync(join(traceDir, `prompt-${attempt}.txt`), 'utf8');
}

function runDecompose(workDir, mode, traceDir, targetTaskId = 'task-open-depth') {
  process.env.TASKOPS_ATOMICITY_WORK_DIR = workDir;
  process.env.TASKOPS_ATOMICITY_TRACE_DIR = traceDir;
  process.env.TASKOPS_ATOMICITY_MODE = mode;
  return runTaskOps(workDir, {
    executor: 'openclaw-agent',
    agent: 'main',
    maxSteps: 1,
    maxStepsExplicit: true,
    timeout: 60,
    targetTaskId,
    targetTaskGroupVersionId: 'tgv-root-v2',
    allowConcurrentTarget: true,
  });
}

try {
  const fakeOpenClaw = makeFakeOpenClaw();
  const previousOpenClawBin = process.env.TASKOPS_OPENCLAW_BIN;
  process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClaw;

  // ---------------------------------------------------------------------
  // 0) 병리 실증: 반쪽 자식 group 은 실제로 그래프를 무효화한다.
  //    (이 assert 는 구현 전후 모두 성립해야 한다 — 무엇을 막으려는지의 근거)
  // ---------------------------------------------------------------------
  {
    const poisonDir = makeWork('atomicity-poison-baseline');
    assert.deepEqual(parseProject(poisonDir).errors, []);
    const groupDir = join(poisonDir, 'task-groups', 'tg-orphan');
    mkdirSync(groupDir, { recursive: true });
    writeFileSync(join(groupDir, 'index.md'), [
      '---',
      'taskOpsVersion: v1',
      'entityType: taskGroup',
      'id: tg-orphan',
      'objective: Half-written child group',
      'createdAt: 2026-06-28T00:00:00.000Z',
      'status: active',
      'activeVersionId: tgv-orphan-v1',
      '---',
      '# tg-orphan',
      '',
    ].join('\n'), 'utf8');
    const poisoned = parseProject(poisonDir);
    assert.ok(
      poisoned.errors.some((e) => /activeVersionId/.test(String(e)) && /tgv-orphan-v1/.test(String(e))),
      `expected activeVersionNotFound poisoning, got ${JSON.stringify(poisoned.errors)}`,
    );
  }

  // ---------------------------------------------------------------------
  // 1) 항상 반쪽인 adapter: 재시도 1회 후에도 실패하지만 그래프는 유효해야 한다.
  // ---------------------------------------------------------------------
  {
    const workDir = makeWork('atomicity-half-always');
    const traceDir = join(tempRoot, 'trace-half-always');
    const result = runDecompose(workDir, 'half', traceDir);

    assert.equal(result.actions[0].status, 'failed', 'half decomposition must not be reported as success');

    // (a) 원자성: 반쪽 산출물이 남지 않는다.
    assert.equal(
      existsSync(join(workDir, 'task-groups', 'tg-open-depth')),
      false,
      'failed decomposition must roll back the half-written child task group',
    );

    // (b) 그래프 유효성: 이것이 execute=0 의 진짜 원인이었다.
    assert.deepEqual(
      parseProject(workDir).errors,
      [],
      'failed decomposition must leave the work graph valid',
    );

    // (c) 정직한 blocked.
    const parentTask = parseMarkdownFile(taskPath(workDir));
    assert.equal(parentTask.status, 'blocked');
    assert.equal(parentTask.childTaskGroupId, undefined);
    assert.notEqual(parentTask.runReadiness, 'runnable');

    // (d) 재시도 훅: 정확히 2회 호출(1회 재시도).
    assert.equal(promptCount(traceDir), 2, 'adapter must be retried exactly once');

    // (e) 재시도 프롬프트에 실패 진단이 실려야 한다.
    const retryPrompt = promptText(traceDir, 2);
    assert.match(retryPrompt, /PREVIOUS DECOMPOSITION ATTEMPT FAILED/);
    assert.match(retryPrompt, /missing_version_index/);
    assert.match(retryPrompt, /tgv-open-depth-v1/);

    // (f) 이벤트 계측.
    const events = readEvents(workDir, result.runId);
    const retryEvent = events.find((e) => e.type === 'decomposition_retry_after_rollback');
    assert.ok(retryEvent, 'decomposition_retry_after_rollback must be emitted');
    assert.equal(retryEvent.failureKind, 'missing_version_index');
    assert.equal(retryEvent.attempt, 1);
    assert.equal(events.some((e) => e.type === 'decomposition_failed'), true);
    assert.equal(events.some((e) => e.type === 'decomposition_completed'), false);

    // (g) 다른 task 는 계속 진행 가능해야 한다.
    const nextRun = runTaskOps(workDir, {
      executor: 'dry-run', agent: 'main', maxSteps: 1, maxStepsExplicit: true,
      targetTaskId: 'task-sibling', targetTaskGroupVersionId: 'tgv-root-v2', allowConcurrentTarget: true,
    });
    assert.equal(nextRun.stepsRun, 1, 'sibling task must remain schedulable after a failed decomposition');
  }

  // ---------------------------------------------------------------------
  // 2) 1회차 반쪽 → 2회차 정상: 재시도가 실제로 성공을 만들어낸다.
  // ---------------------------------------------------------------------
  {
    const workDir = makeWork('atomicity-half-then-complete');
    const traceDir = join(tempRoot, 'trace-half-then-complete');
    const result = runDecompose(workDir, 'half_then_complete', traceDir);

    assert.equal(result.actions[0].status, 'completed', 'retry must be able to succeed');
    assert.equal(promptCount(traceDir), 2);
    assert.match(promptText(traceDir, 2), /PREVIOUS DECOMPOSITION ATTEMPT FAILED/);
    assert.deepEqual(parseProject(workDir).errors, []);
    assert.equal(existsSync(join(workDir, 'task-groups', 'tg-open-depth', 'versions', 'tgv-open-depth-v1', 'index.md')), true);
    const children = readdirSync(join(workDir, 'task-groups', 'tg-open-depth', 'versions', 'tgv-open-depth-v1', 'tasks'));
    assert.equal(children.length, 2);
    const events = readEvents(workDir, result.runId);
    assert.equal(events.some((e) => e.type === 'decomposition_retry_after_rollback'), true);
    assert.equal(events.some((e) => e.type === 'decomposition_completed'), true);
  }

  // ---------------------------------------------------------------------
  // 3) 자식 0개: 검증 불가한 빈 분해도 실패로 롤백된다(거짓 완료 금지).
  // ---------------------------------------------------------------------
  {
    const workDir = makeWork('atomicity-no-children');
    const traceDir = join(tempRoot, 'trace-no-children');
    const result = runDecompose(workDir, 'no_children', traceDir);
    assert.equal(result.actions[0].status, 'failed');
    assert.equal(existsSync(join(workDir, 'task-groups', 'tg-open-depth')), false);
    assert.deepEqual(parseProject(workDir).errors, []);
    assert.equal(promptCount(traceDir), 2);
    const retryEvent = readEvents(workDir, result.runId).find((e) => e.type === 'decomposition_retry_after_rollback');
    assert.ok(retryEvent);
    assert.equal(retryEvent.failureKind, 'no_child_tasks');
  }

  // ---------------------------------------------------------------------
  // 3b) 그래프 무효화 백스톱: version 과 자식은 온전한데 activeVersionId 가 유령 version 을 가리키는 경우.
  //     이것이 3차 런을 즉사시킨 정확한 형태(activeVersionId ... not found)다.
  // ---------------------------------------------------------------------
  {
    const workDir = makeWork('atomicity-dangling-active-version');
    const traceDir = join(tempRoot, 'trace-dangling-active-version');
    const result = runDecompose(workDir, 'dangling_active_version', traceDir);
    assert.equal(result.actions[0].status, 'failed');
    assert.equal(existsSync(join(workDir, 'task-groups', 'tg-open-depth')), false);
    assert.deepEqual(parseProject(workDir).errors, []);
    const retryEvent = readEvents(workDir, result.runId).find((e) => e.type === 'decomposition_retry_after_rollback');
    assert.ok(retryEvent);
    assert.equal(retryEvent.failureKind, 'graph_invalid');
    assert.match(retryEvent.diagnosis, /activeVersionId/);
  }

  // ---------------------------------------------------------------------
  // 4) 스키마 위반(blockedBy JSON 문자열 + expectedPlan non-object): 롤백 후 재시도.
  //    좀비 blocker 를 남기느니 롤백 후 재시도가 낫다.
  // ---------------------------------------------------------------------
  {
    const workDir = makeWork('atomicity-schema-then-complete');
    const traceDir = join(tempRoot, 'trace-schema-then-complete');
    const result = runDecompose(workDir, 'schema_then_complete', traceDir);

    assert.equal(result.actions[0].status, 'completed');
    assert.equal(promptCount(traceDir), 2, 'schema violations must trigger exactly one retry');
    const retryPrompt = promptText(traceDir, 2);
    assert.match(retryPrompt, /PREVIOUS DECOMPOSITION ATTEMPT FAILED/);
    assert.match(retryPrompt, /schema_violation/);
    assert.match(retryPrompt, /blockedBy/);
    assert.match(retryPrompt, /expectedPlan/);
    assert.deepEqual(parseProject(workDir).errors, []);

    // 롤백이 실제로 일어났는지: 최종 자식에는 좀비 blocker 원본이 남아 있으면 안 된다.
    const childA = parseMarkdownFile(join(workDir, 'task-groups', 'tg-open-depth', 'versions', 'tgv-open-depth-v1', 'tasks', 'task-child-a.md'));
    assert.equal(typeof childA.blockedBy === 'string', false, 'retried decomposition must not keep a JSON-string blockedBy');

    const events = readEvents(workDir, result.runId);
    const retryEvent = events.find((e) => e.type === 'decomposition_retry_after_rollback');
    assert.ok(retryEvent);
    assert.equal(retryEvent.failureKind, 'schema_violation');
    assert.ok(Array.isArray(retryEvent.violations) && retryEvent.violations.length > 0);
    // 두 병리를 각각 잡았는지 명시적으로 확인한다(하나만 잡고 통과하는 vacuous 성립 방지).
    assert.ok(
      retryEvent.violations.some((v) => v.field === 'blockedBy' && v.kind === 'json_string'),
      `expected a blockedBy json_string violation, got ${JSON.stringify(retryEvent.violations)}`,
    );
    assert.ok(
      retryEvent.violations.some((v) => v.field === 'expectedPlan' && v.kind === 'not_an_object'),
      `expected an expectedPlan not_an_object violation, got ${JSON.stringify(retryEvent.violations)}`,
    );
  }

  // ---------------------------------------------------------------------
  // 5) 재시도에도 스키마 위반이 남으면: 그래프가 유효하고 자식이 있으므로 수용하되 부채로 기록.
  //    (여기서 또 롤백하면 자식을 전부 잃고 부모가 죽는다. 좀비 blocker 자식은 정직하게 blocked 로
  //     분류되므로 거짓 완료가 아니다.)
  // ---------------------------------------------------------------------
  {
    const workDir = makeWork('atomicity-schema-always');
    const traceDir = join(tempRoot, 'trace-schema-always');
    const result = runDecompose(workDir, 'schema_always', traceDir);

    assert.equal(promptCount(traceDir), 2);
    assert.deepEqual(parseProject(workDir).errors, [], 'schema debt must never invalidate the graph');
    assert.equal(existsSync(join(workDir, 'task-groups', 'tg-open-depth', 'versions', 'tgv-open-depth-v1', 'index.md')), true);
    const events = readEvents(workDir, result.runId);
    assert.equal(events.some((e) => e.type === 'decomposition_schema_debt_accepted'), true);
    const debtEvent = events.find((e) => e.type === 'decomposition_schema_debt_accepted');
    assert.equal(debtEvent.attempt, 2);
    assert.ok(Array.isArray(debtEvent.violations) && debtEvent.violations.length > 0);
    // 거짓 완료 금지: 좀비 blocker 를 가진 자식이 runnable 로 승격되면 안 된다.
    const childA = parseMarkdownFile(join(workDir, 'task-groups', 'tg-open-depth', 'versions', 'tgv-open-depth-v1', 'tasks', 'task-child-a.md'));
    assert.notEqual(childA.runReadiness, 'runnable');
  }

  // ---------------------------------------------------------------------
  // 6) adapter 성공 뒤 postprocess throw: 커밋되지 않은 backlink 가 그래프를 무효화하면
  //    자식 그룹을 롤백하고 부모는 blocked 로 남겨야 한다. 다른 task 는 계속 실행 가능해야 한다.
  // ---------------------------------------------------------------------
  {
    const workDir = makeWork('atomicity-postprocess-throw');
    const traceDir = join(tempRoot, 'trace-postprocess-throw');
    const result = runDecompose(workDir, 'postprocess_throw', traceDir);

    assert.equal(result.actions[0].status, 'failed', 'postprocess throw must not report decomposition completion');
    assert.match(result.actions[0].message, /ENAMETOOLONG/, 'fixture must fail in the intended postprocess write');
    assert.equal(promptCount(traceDir), 1, 'postprocess failure happens after adapter success and must not retry the adapter');
    assert.equal(
      existsSync(join(workDir, 'task-groups', 'tg-open-depth')),
      false,
      'graph-invalidating postprocess failure must roll back the child task group',
    );

    const parentTask = parseMarkdownFile(taskPath(workDir));
    assert.equal(parentTask.status, 'blocked', 'rollback must leave the parent honestly blocked');
    assert.equal(parentTask.childTaskGroupId, undefined, 'rollback must not leave the failed child backlink on the parent');
    assert.deepEqual(parseProject(workDir).errors, [], 'postprocess rollback must restore the baseline-valid graph');

    const events = readEvents(workDir, result.runId);
    const failure = events.find((e) => e.type === 'decomposition_failed' && e.phase === 'postprocess');
    assert.ok(failure, 'postprocess decomposition_failed event must be emitted');
    assert.equal(failure.graphInvalidated, true);
    assert.equal(failure.rolledBack, true);
    assert.equal(failure.rollbackMode, 'removed_group');
    assert.deepEqual(failure.residualErrors, []);
    assert.equal(events.some((e) => e.type === 'decomposition_completed'), false, 'rollback must never create false completion');

    const nextRun = runTaskOps(workDir, {
      executor: 'dry-run', agent: 'main', maxSteps: 1, maxStepsExplicit: true,
      targetTaskId: 'task-sibling', targetTaskGroupVersionId: 'tgv-root-v2', allowConcurrentTarget: true,
    });
    assert.equal(nextRun.stepsRun, 1, 'sibling task must remain schedulable after postprocess rollback');
  }

  // ---------------------------------------------------------------------
  // 6b) 부모 backlink 기록 뒤 postprocess throw: task EoW 생성이 실패하면 catch 진입 시점에는
  //     부모가 이미 done + childTaskGroupId 상태다. 그래프 무효화를 롤백하면서 둘 다 정직하게 되돌려야 한다.
  // ---------------------------------------------------------------------
  {
    const longParentId = 'task-' + 'p'.repeat(170);
    const workDir = makeWork('atomicity-postprocess-parent-backlink', { decompositionTaskId: longParentId });
    const traceDir = join(tempRoot, 'trace-postprocess-parent-backlink');
    const result = runDecompose(workDir, 'complete', traceDir, longParentId);

    assert.equal(result.actions[0].status, 'failed');
    assert.match(result.actions[0].message, /EoW filename exceeds 255/, 'fixture must throw after the parent backlink write');
    assert.equal(existsSync(join(workDir, 'task-groups', `tg-${'p'.repeat(170)}`)), false);

    const parentTask = parseMarkdownFile(taskPath(workDir, longParentId));
    assert.equal(parentTask.status, 'blocked', 'postprocess rollback must reverse the transient done state');
    assert.equal(parentTask.childTaskGroupId, undefined, 'postprocess rollback must remove the newly written parent backlink');
    assert.deepEqual(parseProject(workDir).errors, []);

    const failure = readEvents(workDir, result.runId)
      .find((e) => e.type === 'decomposition_failed' && e.phase === 'postprocess');
    assert.ok(failure);
    // 이 시나리오의 핵심: 부모 backlink 까지 이미 써진 뒤 throw 했으므로 parseProject 는 **오류를 못 본다**
    // (graphInvalidated=false). 그래도 롤백은 일어나야 한다 — 원자성 계약은 "전부 성공 or 전부 롤백"이고,
    // EoW/closure 기록이 빠진 반쪽 커밋을 "검증기가 못 보니 괜찮다"고 남기면 그게 바로 반쪽 자식이다.
    // 따라서 graphInvalidated 는 롤백의 조건이 아니라 계측값일 뿐임을 여기서 못박는다.
    assert.equal(failure.graphInvalidated, false, 'backlink 까지 써진 뒤라 검증기는 무효를 못 본다');
    assert.equal(failure.rolledBack, true, '그래도 롤백은 무조건 일어나야 한다(전부 성공 or 전부 롤백)');
    assert.equal(failure.rollbackMode, 'removed_group');
    assert.deepEqual(failure.residualErrors, []);
  }

  // 6-실측) 커밋 게이트의 위양성 방지 (end-to-end).
  //    ALE conv4 실측: codex-cli 가 온전한 자식 그룹을 만들었는데도 graph_invalid 로 롤백되어 런이
  //    blocked_only 로 끝났다. 원인은 산출물이 아니라 **쓰기 순서**였다 — 부모의 childTaskGroupId 는
  //    커밋 게이트를 통과한 뒤 closeDecomposeSuccess 가 쓴다. 실제 CLI 처럼 backlink 를 심은 분해는
  //    반드시 수용되어야 한다(롤백 금지, 재시도 금지).
  {
    const workDir = makeWork('atomicity-realistic-backlink');
    const traceDir = join(tempRoot, 'trace-realistic-backlink');
    const result = runDecompose(workDir, 'realistic_backlink', traceDir);
    const events = readEvents(workDir, result.runId);
    assert.equal(promptCount(traceDir), 1, '6-실측: 정상 분해는 재시도되면 안 된다');
    assert.equal(
      events.some((e) => e.type === 'decomposition_failed'), false,
      '6-실측: backlink 를 심은 정상 분해가 실패로 처리되면 안 된다',
    );
    assert.equal(events.some((e) => e.type === 'decomposition_completed'), true, '6-실측: 분해가 커밋되어야 한다');
    assert.equal(
      existsSync(join(workDir, 'task-groups', 'tg-open-depth', 'versions', 'tgv-open-depth-v1', 'tasks', 'task-child-a.md')),
      true,
      '6-실측: 자식이 롤백되면 안 된다',
    );
    assert.deepEqual(parseProject(workDir).errors, [], '6-실측: 커밋 후 그래프는 유효해야 한다');
  }

  // 6) 커밋 게이트의 위양성 방지 — 부모 backlink 는 게이트 **뒤**에 쓰인다.
  //    ALE conv4 실측: codex-cli 가 온전한 자식 그룹을 만들었는데도 graph_invalid 로 롤백되어 런이
  //    blocked_only 로 끝났다. 원인은 산출물이 아니라 쓰기 순서였다(fm.childTaskGroupId 는
  //    closeDecomposeSuccess 가 쓴다). 이 분해가 곧 채울 backlink 한 쌍만 예외로 두고,
  //    다른 값을 가리키는 진짜 불일치는 그대로 잡아야 한다.
  {
    const patterns = pendingBacklinkErrorPatterns('recover', 'tg-recover');
    const matches = (line) => patterns.some((pattern) => line.includes(pattern));
    // ALE conv4 에서 실제로 관측된 줄.
    const observed = "/tmp/w/task-groups/tg-recover/versions/tgv-recover-v1/index.md: decomposition backlink parent task 'recover' points to childTaskGroupId '', expected 'tg-recover'";
    assert.equal(matches(observed), true, '6-(a): 아직 쓰이지 않은 backlink 는 게이트에서 제외되어야 한다');
    assert.equal(
      matches("/tmp/w/x/index.md: decomposition backlink parent task 'recover' points to childTaskGroupId 'tg-other', expected 'tg-recover'"),
      false,
      '6-(b): 다른 그룹을 가리키는 진짜 불일치는 절대 면제되면 안 된다',
    );
    assert.equal(
      matches("/tmp/w/task-groups/tg-recover/index.md: activeVersionId 'tgv-recover-v1' not found"),
      false,
      '6-(c): 그래프 무효화(activeVersionId 유령)는 절대 면제되면 안 된다',
    );
    assert.equal(pendingBacklinkErrorPatterns(null, 'tg-recover').length, 0, '6-(d): 부모 id 가 없으면 면제도 없다');

    // ALE conv4b 실측: 같은 '쓰기 순서' 부류의 세 번째 줄. DECOMPOSITION_BACKLINK_FIELDS 5개는 전부
    // closeDecomposeSuccess 의 backlink 적용 단계가 게이트 **뒤**에 채우므로, 게이트 시점의 누락은
    // 산출물 결함이 아니다. 루트 분해는 adapter 가 우연히 써서 통과했고 자식 분해는 쓰지 않아 롤백됐다.
    const vPatterns = pendingBacklinkErrorPatterns('recover', 'tg-recover', 'tgv-recover-v1');
    const vMatches = (line) => vPatterns.some((pattern) => line.includes(pattern));
    assert.equal(
      vMatches('/tmp/w/task-groups/tg-recover/versions/tgv-recover-v1/index.md: incomplete decomposition backlink; missing decomposedByRunId, decomposedByRunNodeId'),
      true,
      '6-(e): 아직 쓰이지 않은 decomposedByRunId/RunNodeId 누락은 게이트에서 제외되어야 한다',
    );
    assert.equal(
      vMatches('/tmp/w/task-groups/tg-recover/versions/tgv-recover-v1/index.md: decomposition backlink가 불완전함; 누락: decomposedByRunId'),
      true,
      '6-(f): 한국어 로케일 메시지도 동일하게 제외되어야 한다',
    );
    assert.equal(
      vMatches('/tmp/w/task-groups/tg-other/versions/tgv-other-v1/index.md: incomplete decomposition backlink; missing decomposedByRunId'),
      false,
      '6-(g): 이 분해가 아닌 다른 version 의 불완전 backlink 는 절대 면제되면 안 된다',
    );
    assert.equal(
      vMatches("/tmp/w/task-groups/tg-recover/versions/tgv-recover-v1/index.md: decomposition backlink run node 'r1'/'x' not found"),
      false,
      '6-(h): 값이 틀린 backlink(RunNodeNotFound)는 절대 면제되면 안 된다',
    );
    assert.equal(
      vMatches("/tmp/w/task-groups/tg-recover/versions/tgv-recover-v1/index.md: decomposition backlink taskGroupId mismatch; expected 'a', found 'b'"),
      false,
      '6-(i): 값 불일치(mismatch)는 절대 면제되면 안 된다',
    );
    assert.equal(
      pendingBacklinkErrorPatterns('recover', 'tg-recover').length + 2,
      vPatterns.length,
      '6-(j): versionId 를 주지 않으면 version 스코프 면제는 추가되지 않는다',
    );
  }

  if (previousOpenClawBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
  else process.env.TASKOPS_OPENCLAW_BIN = previousOpenClawBin;
  delete process.env.TASKOPS_ATOMICITY_WORK_DIR;
  delete process.env.TASKOPS_ATOMICITY_TRACE_DIR;
  delete process.env.TASKOPS_ATOMICITY_MODE;

  console.log('decomposition-atomicity smoke passed');
} catch (err) {
  console.error(err);
  process.exit(1);
}
