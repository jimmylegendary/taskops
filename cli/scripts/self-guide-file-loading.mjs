#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAgentExecutionPrompt,
  runTaskOps,
  SELF_RESOLUTION_GUIDE,
} from '../lib-runner.js';
import {
  initProject,
  writeVersionFromSpec,
} from '../lib-taskops.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(scriptDir, '..');
const repoDir = resolve(cliDir, '..');
const runnerPath = resolve(cliDir, 'lib-runner.js');
const binPath = resolve(cliDir, 'bin', 'taskops.js');
const guidePath = resolve(repoDir, 'skill', 'self-resolution-guide.md');

const guideText = readFileSync(guidePath, 'utf8');
assert.equal(guideText, SELF_RESOLUTION_GUIDE, 'skill/self-resolution-guide.md must stay byte-identical to SELF_RESOLUTION_GUIDE');

function createRunnableWork(root) {
  initProject(root, {
    id: 'self-guide-file-work',
    title: 'Self Guide File Work',
    objective: 'Validate file-loaded self-resolution guide threading.',
  });
  writeVersionFromSpec(root, 'tg-root', {
    versionId: 'tgv-root-v2',
    version: 'v2',
    summary: 'Self guide file fixture',
    selected: true,
    tasks: [{
      id: 'task-self-guide-file',
      title: 'Self guide file task',
      objective: 'Check externally loaded self-resolution prompt text.',
      responsibility: 'Own the file-loaded guide fixture.',
      completionCriteria: 'Prompt output uses the provided guide text.',
      order: 1,
      status: 'pending',
      runReadiness: 'runnable',
    }],
  });
  const snapshotPath = join(root, 'snapshots', 'snapshot-root-v1.md');
  writeFileSync(snapshotPath, readFileSync(snapshotPath, 'utf8').replace('versionId: tgv-root-v1', 'versionId: tgv-root-v2'), 'utf8');
}

function fakeClaudeCode({ logPath }) {
  const fakePath = join(mkdtempSync(join(tmpdir(), 'taskops-fake-claude-')), 'claude');
  writeFileSync(fakePath, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

if (process.argv.includes('--version')) {
  console.log('claude fake self-guide-file-loading');
  process.exit(0);
}

const prompt = process.argv[process.argv.length - 1] || '';
appendFileSync(${JSON.stringify(logPath)}, prompt + '\\n---TASKOPS-PROMPT-END---\\n', 'utf8');
console.log('fake claude completed self guide file task');
`, 'utf8');
  chmodSync(fakePath, 0o755);
  return fakePath;
}

const project = {
  id: 'self-guide-file-work',
  title: 'Self Guide File Work',
  objective: 'Validate file-loaded self-resolution guide threading.',
};

const task = {
  id: 'task-self-guide-file',
  title: 'Self guide file task',
  objective: 'Check externally loaded self-resolution prompt text.',
  responsibility: 'Own the file-loaded guide fixture.',
  completionCriteria: 'Prompt output uses the provided guide text.',
};

const prompt = buildAgentExecutionPrompt({
  project,
  task,
  delegationMode: true,
  selfResolutionGuide: '<x>FROMFILE</x>',
});
assert.ok(prompt.includes('<x>FROMFILE</x>'), 'file-loaded selfResolutionGuide text should appear in execute prompt');
assert.equal(prompt.includes(SELF_RESOLUTION_GUIDE), false, 'file-loaded guide text should replace the default guide');

const runRoot = mkdtempSync(join(tmpdir(), 'taskops-self-guide-file-run-'));
createRunnableWork(runRoot);
const promptLogPath = join(runRoot, 'captured-prompts.log');
const priorClaudeBin = process.env.TASKOPS_CLAUDE_BIN;
process.env.TASKOPS_CLAUDE_BIN = fakeClaudeCode({ logPath: promptLogPath });
try {
  const runResult = runTaskOps(runRoot, {
    executor: 'claude-code',
    maxSteps: 1,
    maxStepsExplicit: true,
    delegate: true,
    selfResolutionGuide: '<x>FROMFILE</x>',
  });
  assert.equal(runResult.stepsRun, 1, 'runTaskOps fixture should execute one task');
  assert.equal(runResult.actions[0]?.status, 'completed', 'fake runtime execute task should complete');
} finally {
  if (priorClaudeBin == null) delete process.env.TASKOPS_CLAUDE_BIN;
  else process.env.TASKOPS_CLAUDE_BIN = priorClaudeBin;
}
const capturedPrompt = readFileSync(promptLogPath, 'utf8');
assert.ok(capturedPrompt.includes('<x>FROMFILE</x>'), 'runTaskOps execute path should pass selfResolutionGuide to the runtime prompt');
assert.equal(capturedPrompt.includes(SELF_RESOLUTION_GUIDE), false, 'runTaskOps file-loaded guide should replace the default guide in the runtime prompt');

const runnerSource = readFileSync(runnerPath, 'utf8');
assert.match(
  runnerSource,
  /function invokeExecutor\(\{[^}]*delegationMode = false, selfResolutionGuide = null[^}]*\}\)/,
  'invokeExecutor should accept selfResolutionGuide next to delegationMode',
);
assert.match(
  runnerSource,
  /buildAgentExecutionPrompt\(\{ project, task, budget, inheritedContext, projectDir, artifactWorkspacePath, delegationMode, selfResolutionGuide \}\)/,
  'invokeExecutor should pass selfResolutionGuide into buildAgentExecutionPrompt',
);
assert.match(
  runnerSource,
  /function executeRunnableTask\(\{[^}]*delegationMode = false, selfResolutionGuide = null[^}]*\}\)/,
  'executeRunnableTask should accept selfResolutionGuide next to delegationMode',
);
assert.match(
  runnerSource,
  /const selfResolutionGuide = options\.selfResolutionGuide != null \? String\(options\.selfResolutionGuide\) : null;/,
  'runTaskOps should read options.selfResolutionGuide without file I/O',
);
assert.match(
  runnerSource,
  /delegationMode,\n\s+selfResolutionGuide,\n/,
  'runTaskOps execute path should thread selfResolutionGuide with delegationMode',
);

const binSource = readFileSync(binPath, 'utf8');
assert.match(binSource, /--self-guide-file <path>/, 'run usage should expose --self-guide-file');
assert.match(binSource, /readFileSync\(resolve\(selfGuideFile\), 'utf8'\)/, 'bin should read self-guide-file directly and let failures throw');
assert.match(binSource, /delegate: flags\.delegate,\n\s+selfResolutionGuide,/, 'bin should pass selfResolutionGuide into runTaskOps options');

const missingGuidePath = join(mkdtempSync(join(tmpdir(), 'taskops-missing-guide-')), 'missing.md');
assert.equal(existsSync(missingGuidePath), false, 'missing guide fixture should not exist');
const missingResult = spawnSync(process.execPath, [
  binPath,
  'run',
  mkdtempSync(join(tmpdir(), 'taskops-guide-file-work-')),
  '--self-guide-file',
  missingGuidePath,
  '--executor',
  'dry-run',
], { encoding: 'utf8' });
assert.notEqual(missingResult.status, 0, 'missing --self-guide-file should fail explicitly');
assert.match(`${missingResult.stderr}\n${missingResult.stdout}`, /ENOENT|no such file/i, 'missing guide failure should surface the read error');

console.log('OK self guide file loading');
