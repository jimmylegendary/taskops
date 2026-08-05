#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFrontmatterText, parseMarkdownFile } from '../lib-taskops.js';
import { runTaskOps } from '../lib-runner.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-frontmatter-block-scalar-'));
const failures = [];

function check(name, fn) {
  try {
    fn();
  } catch (err) {
    failures.push(err);
    console.error(`실패: ${name}`);
    console.error(err instanceof Error ? err.stack : String(err));
  }
}

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`taskops ${args.join(' ')} 실패\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function makeDecompositionWork() {
  const workDir = join(tempRoot, 'decomposition-work');
  runCli([
    'init',
    workDir,
    '--id',
    'frontmatter-block-scalar',
    '--title',
    'Frontmatter block scalar',
    '--objective',
    '분해 자식 파싱 실패를 런 실패로 격리한다.',
    '--language',
    'ko',
  ]);
  const specPath = join(tempRoot, 'root-spec.json');
  writeFileSync(specPath, JSON.stringify({
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: '분해 후처리 파싱 실패 회귀 픽스처',
    selected: true,
    tasks: [{
      id: 'task-parser-failure',
      title: '파싱 불가 자식 분해',
      objective: '파싱 불가 자식 파일을 만든 분해를 정직하게 실패시킨다.',
      responsibility: '분해 후처리 예외가 런 전체로 전파되지 않는지 검증한다.',
      completionCriteria: '부모가 blocked이고 분해 스텝이 failed이다.',
      order: 1,
      status: 'pending',
      runReadiness: 'needs_decomposition',
      expectedPlan: {
        expectedDepth: 1,
        expectedBreadth: 1,
        rationale: '자식 파일 하나를 만드는 실제 분해 런루프가 필요하다.',
      },
    }],
  }, null, 2), 'utf8');
  runCli(['decompose', workDir, '--task-group-id', 'tg-root', '--spec', specPath]);
  const snapshotPath = join(workDir, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(
    snapshotPath,
    readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'),
    'utf8',
  );
  return workDir;
}

function makeMalformedChildExecutor() {
  const fakePath = join(tempRoot, 'fake-openclaw-malformed-child.mjs');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) {
  console.log('openclaw fake malformed child');
  process.exit(0);
}

const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
const prompt = messageIndex >= 0 ? args[messageIndex + 1] : args[args.length - 1] || '';
const workDir = process.env.TASKOPS_BLOCK_SCALAR_WORK_DIR;
if (!workDir) {
  console.error('TASKOPS_BLOCK_SCALAR_WORK_DIR가 없다.');
  process.exit(2);
}
const childTaskGroupId = (prompt.match(/Target child task group id: ([^\\n]+)/) || [])[1]?.trim();
const versionId = (prompt.match(/Target version id: ([^\\n]+)/) || [])[1]?.trim();
if (!childTaskGroupId || !versionId) {
  console.error('분해 대상 id를 프롬프트에서 찾지 못했다.');
  process.exit(2);
}

const now = '2026-07-30T00:00:00.000Z';
const groupDir = join(workDir, 'task-groups', childTaskGroupId);
const versionDir = join(groupDir, 'versions', versionId);
const tasksDir = join(versionDir, 'tasks');
mkdirSync(tasksDir, { recursive: true });
writeFileSync(join(groupDir, 'index.md'), [
  '---',
  'taskOpsVersion: v1',
  'entityType: taskGroup',
  'id: ' + childTaskGroupId,
  'objective: 파싱 실패 격리 자식 그룹',
  'activeVersionId: ' + versionId,
  'createdAt: ' + now,
  'status: active',
  '---',
  '# ' + childTaskGroupId,
  '',
].join('\\n'), 'utf8');
writeFileSync(join(versionDir, 'index.md'), [
  '---',
  'taskOpsVersion: v1',
  'entityType: taskGroupVersion',
  'id: ' + versionId,
  'taskGroupId: ' + childTaskGroupId,
  'version: v1',
  'summary: 파싱 실패 격리 자식 버전',
  'createdAt: ' + now,
  'status: active',
  '---',
  '# ' + versionId,
  '',
].join('\\n'), 'utf8');
writeFileSync(join(versionDir, 'decomposition-log.md'), '# 분해 로그\\n\\n- 파싱 불가 자식을 의도적으로 생성했다.\\n', 'utf8');
writeFileSync(join(tasksDir, 'task-malformed.md'), [
  '---',
  'taskOpsVersion: v1',
  'entityType: task',
  'id: task-malformed',
  'taskGroupId: ' + childTaskGroupId,
  'taskGroupVersionId: ' + versionId,
  'title: 파싱 불가 자식',
  'objective: 후처리 파싱 실패를 발생시킨다.',
  'responsibility: 예외 격리 경계를 검증한다.',
  'completionCriteria: 부모가 정직하게 blocked가 된다.',
  'order: 1',
  'createdAt: ' + now,
  'status: pending',
  'runReadiness: runnable',
  'expectedPlan:',
  '  expectedDepth: 0',
  '  expectedBreadth: 0',
  '  rationale: 후처리 파싱 실패 픽스처',
  '콜론 없는 잘못된 frontmatter 줄',
  '---',
  '# 파싱 불가 자식',
  '',
].join('\\n'), 'utf8');
console.log(JSON.stringify({ result: { finalAssistantRawText: '파싱 불가 자식 분해 작성 완료' } }));
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

function readEvents(workDir, runId) {
  const text = readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8').trim();
  return text ? text.split(/\n+/).map((line) => JSON.parse(line)) : [];
}

try {
  check('ALE 실측 같은 들여쓰기 시퀀스와 뒤따르는 루트 필드를 파싱한다', () => {
    const parsed = parseFrontmatterText(`---
taskOpsVersion: v1
entityType: task
id: design-serving-parity-recovery
taskGroupId: tg-recover
taskGroupVersionId: tgv-recover-v1
title: Design generalized serving-parity reconstruction
objective: Convert verified authoritative evidence into a generalized, fail-safe algorithm
  that resolves required shards, validates their actual bytes and metadata, and reconstructs
  the exact feature manifest and report provenance.
purpose: This child protects the parent’s availability objective by defining parity
  from authoritative live state rather than stale manifests, informal notes, cached
  helpers, or hard-coded filenames.
expectedResult: An implementation-ready parity design for required-path resolution,
  no-follow regular-file validation, header/size/hash capture, deterministic manifest
  serialization, provenance, and safe failure behavior.
responsibility: Use the terminal authoritative-contract evidence. Explicitly distinguish
  authoritative inputs, permitted auxiliary log evidence, independently validated
  observations, and rejected non-authoritative operational artifacts.
completionCriteria: Every required manifest field and shard is mapped to validated
  evidence; byte-stability, path-boundary, deterministic output, and failure/publication
  behavior are specified deeply enough for implementation decomposition.
order: 2
createdAt: '2026-07-29T15:25:00.000Z'
status: pending
runReadiness: blocked
runReadinessReason: Parity design depends on the terminal descendant that establishes
  the authoritative recovery contract.
blockedBy:
- type: task
  id: discover-authoritative-recovery-contract
  taskGroupVersionId: tgv-recover-v1
uncertaintyState: known_unknown
confidenceScore: 0.37
knownList: []
expectedPlan:
  expectedDepth: 2
  expectedBreadth: 4
  rationale: Hidden seed and consumer details may require separate path-resolution,
    stable-byte-validation, manifest-schema, and publication/provenance sub-goals.
---
`, 'design-serving-parity-recovery.md');

    assert.ok(Array.isArray(parsed.blockedBy));
    assert.equal(parsed.blockedBy.length, 1);
    assert.equal(parsed.blockedBy[0].type, 'task');
    assert.equal(parsed.blockedBy[0].id, 'discover-authoritative-recovery-contract');
    assert.equal(parsed.blockedBy[0].taskGroupVersionId, 'tgv-recover-v1');
    assert.equal(parsed.uncertaintyState, 'known_unknown');
    assert.equal(parsed.confidenceScore, '0.37');
    assert.deepEqual(parsed.knownList, []);
    assert.equal(parsed.expectedPlan.expectedDepth, 2);
    assert.equal(parsed.expectedPlan.expectedBreadth, 4);
    assert.equal(
      parsed.expectedPlan.rationale,
      'Hidden seed and consumer details may require separate path-resolution, stable-byte-validation, manifest-schema, and publication/provenance sub-goals.',
    );
  });

  check('더 깊게 들여쓴 시퀀스 스타일을 동일하게 파싱한다', () => {
    const parsed = parseFrontmatterText([
      '---',
      'blockedBy:',
      '  - type: task',
      '    id: deeply-indented-dependency',
      '    taskGroupVersionId: tgv-deep-v1',
      'uncertaintyState: known_known',
      '---',
      '',
    ].join('\n'), 'deeply-indented-sequence.md');

    assert.deepEqual(parsed.blockedBy, [{
      type: 'task',
      id: 'deeply-indented-dependency',
      taskGroupVersionId: 'tgv-deep-v1',
    }]);
    assert.equal(parsed.uncertaintyState, 'known_known');
  });

  check('같은 들여쓰기 시퀀스 뒤의 다른 같은 들여쓰기 시퀀스 key를 파싱한다', () => {
    const parsed = parseFrontmatterText([
      '---',
      'blockedBy:',
      '- type: task',
      '  id: first-dependency',
      'relatedTasks:',
      '- type: task',
      '  id: second-dependency',
      'status: pending',
      '---',
      '',
    ].join('\n'), 'adjacent-same-indent-sequences.md');

    assert.deepEqual(parsed.blockedBy, [{ type: 'task', id: 'first-dependency' }]);
    assert.deepEqual(parsed.relatedTasks, [{ type: 'task', id: 'second-dependency' }]);
    assert.equal(parsed.status, 'pending');
  });

  check('ALE 실측 plain multi-line summary와 뒤따르는 필드를 파싱한다', () => {
    const parsed = parseFrontmatterText([
      '---',
      'summary: Recover ranking-node feature parity and capacity through authoritative discovery,',
      '  safety design, implementation, and independent verification.',
      'selected: true',
      'createdAt: 2026-07-30T09:15:00.000Z',
      'status: pending',
      '---',
      '',
    ].join('\n'), 'tg-recover-index.md');

    assert.equal(
      parsed.summary,
      'Recover ranking-node feature parity and capacity through authoritative discovery, safety design, implementation, and independent verification.',
    );
    assert.equal(parsed.selected, true);
    assert.equal(parsed.createdAt, '2026-07-30T09:15:00.000Z');
    assert.equal(parsed.status, 'pending');
  });

  check('리스트 아이템 안의 plain multi-line scalar를 문자열로 파싱한다', () => {
    const parsed = parseFrontmatterText([
      '---',
      'items:',
      '  - summary: true',
      '      remains a string after folding',
      '    selected: false',
      '---',
      '',
    ].join('\n'), 'list-plain-multi-line.md');

    assert.deepEqual(parsed.items, [{
      summary: 'true remains a string after folding',
      selected: false,
    }]);
  });

  check('folded와 literal block scalar를 파싱한다', () => {
    const parsed = parseFrontmatterText([
      '---',
      'rationale: >',
      '  첫 번째 근거',
      '  두 번째 근거',
      '',
      '  다음 문단',
      'notes: |',
      '  첫 번째 줄',
      '  두 번째 줄',
      'stripLiteral: |-',
      '  끝 개행을',
      '  제거한다',
      'stripFolded: >-',
      '  접은 뒤',
      '  끝 개행을 제거한다',
      'keepLiteral: |+',
      '  keep은 현재 clip처럼 처리한다',
      'keepFolded: >+',
      '  keep folded도',
      '  clip처럼 처리한다',
      '---',
      '# 본문',
      '',
    ].join('\n'), 'block-scalars.md');

    assert.equal(parsed.rationale, '첫 번째 근거 두 번째 근거\n다음 문단\n');
    assert.equal(parsed.notes, '첫 번째 줄\n두 번째 줄\n');
    assert.equal(parsed.stripLiteral, '끝 개행을\n제거한다');
    assert.equal(parsed.stripFolded, '접은 뒤 끝 개행을 제거한다');
    assert.equal(parsed.keepLiteral, 'keep은 현재 clip처럼 처리한다\n');
    assert.equal(parsed.keepFolded, 'keep folded도 clip처럼 처리한다\n');
  });

  check('리스트 아이템 안의 block scalar와 뒤따르는 필드를 파싱한다', () => {
    const parsed = parseFrontmatterText([
      '---',
      'items:',
      '  - rationale: >',
      '      리스트 첫 줄',
      '      리스트 둘째 줄',
      '    notes: |-',
      '      보존할 첫 줄',
      '      보존할 둘째 줄',
      '    enabled: true',
      '---',
      '',
    ].join('\n'), 'list-block-scalar.md');

    assert.deepEqual(parsed.items, [{
      rationale: '리스트 첫 줄 리스트 둘째 줄\n',
      notes: '보존할 첫 줄\n보존할 둘째 줄',
      enabled: true,
    }]);
  });

  check('기존 scalar, 배열, 중첩 mapping 파싱 결과를 보존한다', () => {
    const parsed = parseFrontmatterText([
      '---',
      'plain: value',
      'quoted: "콜론: 포함 문자열"',
      'count: 42',
      'negative: -7',
      'enabled: true',
      'disabled: false',
      'emptyList: []',
      'emptyMap: {}',
      'nested:',
      '  label: inner',
      '  count: 3',
      'tags:',
      '  - alpha',
      '  - beta',
      'objects:',
      '  - name: first',
      '    active: true',
      '---',
      '',
    ].join('\n'), 'legacy-frontmatter.md');

    assert.deepEqual(parsed, {
      plain: 'value',
      quoted: '콜론: 포함 문자열',
      count: 42,
      negative: -7,
      enabled: true,
      disabled: false,
      emptyList: [],
      emptyMap: {},
      nested: { label: 'inner', count: 3 },
      tags: ['alpha', 'beta'],
      objects: [{ name: 'first', active: true }],
    });
  });

  check('block scalar 밖의 콜론 없는 줄은 계속 거부한다', () => {
    assert.throws(
      () => parseFrontmatterText([
        '---',
        'valid: value',
        '콜론 없는 진짜 잘못된 줄',
        '---',
        '',
      ].join('\n'), 'invalid-frontmatter.md'),
      /Invalid frontmatter line/,
    );
  });

  check('자식 파싱 실패를 부모 blocked와 failed 스텝으로 격리한다', () => {
    const workDir = makeDecompositionWork();
    const fakeOpenClaw = makeMalformedChildExecutor();
    const previousOpenClawBin = process.env.TASKOPS_OPENCLAW_BIN;
    const previousWorkDir = process.env.TASKOPS_BLOCK_SCALAR_WORK_DIR;
    let runResult;
    try {
      process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClaw;
      process.env.TASKOPS_BLOCK_SCALAR_WORK_DIR = workDir;
      assert.doesNotThrow(() => {
        runResult = runTaskOps(workDir, {
          executor: 'openclaw-agent',
          agent: 'main',
          maxSteps: 2,
          maxStepsExplicit: true,
          timeout: 10,
          targetTaskId: 'task-parser-failure',
          targetTaskGroupVersionId: 'tgv-root-v2',
          allowConcurrentTarget: true,
          continueOnFailure: true,
        });
      }, '분해 후처리의 자식 파싱 예외가 runTaskOps 밖으로 전파되면 안 된다.');
    } finally {
      if (previousOpenClawBin == null) delete process.env.TASKOPS_OPENCLAW_BIN;
      else process.env.TASKOPS_OPENCLAW_BIN = previousOpenClawBin;
      if (previousWorkDir == null) delete process.env.TASKOPS_BLOCK_SCALAR_WORK_DIR;
      else process.env.TASKOPS_BLOCK_SCALAR_WORK_DIR = previousWorkDir;
    }

    assert.equal(runResult.actions[0].status, 'failed');
    const parentPath = join(
      workDir,
      'task-groups',
      'tg-root',
      'versions',
      'tgv-root-v2',
      'tasks',
      'task-parser-failure.md',
    );
    const parent = parseMarkdownFile(parentPath);
    assert.equal(parent.status, 'blocked');
    assert.match(parent.lastRunFailureReason, /Invalid frontmatter line/);
    assert.equal(parent.lastRunFailureReason.includes('\n'), false, '저장된 실패 사유는 frontmatter scalar로 정리되어야 한다.');
    const failureEvent = readEvents(workDir, runResult.runId)
      .find((event) => event.type === 'decomposition_failed' && event.taskId === 'task-parser-failure');
    assert.ok(failureEvent, '분해 후처리 실패 이벤트가 남아야 한다.');
    assert.match(failureEvent.message, /Invalid frontmatter line/);
  });

  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length}개 frontmatter/분해 후처리 회귀 검사가 실패했다.`);
  }
  console.log('frontmatter block scalar 및 분해 후처리 회귀 테스트 통과');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
