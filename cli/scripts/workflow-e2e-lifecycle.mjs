#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const workflowScript = join(here, 'workflow-e2e.mjs');
const harnessRoot = mkdtempSync(join(tmpdir(), 'taskops-workflow-lifecycle-'));
const preloadPath = join(harnessRoot, 'stdout-backpressure.cjs');
const optInResultPath = join(harnessRoot, 'opt-in', 'workflow.json');

writeFileSync(preloadPath, `
const originalWrite = process.stdout.write.bind(process.stdout);
let delayed = false;
process.stdout.write = function writeWithBackpressure(chunk, encoding, callback) {
  if (delayed) return originalWrite(chunk, encoding, callback);
  delayed = true;
  setTimeout(() => {
    originalWrite(chunk, encoding, callback);
    process.stdout.emit('drain');
  }, 25);
  return false;
};
`, 'utf8');

function runWorkflow({ backpressure = false, resultPath = null } = {}) {
  const env = { ...process.env };
  delete env.TASKOPS_WORKFLOW_RESULT_PATH;
  if (backpressure) env.NODE_OPTIONS = [env.NODE_OPTIONS, `--require=${preloadPath}`].filter(Boolean).join(' ');
  if (resultPath) env.TASKOPS_WORKFLOW_RESULT_PATH = resultPath;
  return spawnSync(process.execPath, [workflowScript], {
    encoding: 'utf8',
    env,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function parseCompletePayload(result, label) {
  assert.equal(result.status, 0, `${label}: workflow failed\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.equal(result.signal, null, `${label}: workflow terminated by signal`);
  assert.ok(result.stdout.endsWith('\n'), `${label}: stdout must end with a newline`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.summary.allPassed, true, `${label}: workflow payload reports failure`);
  return payload;
}

const failures = [];
function check(label, fn) {
  try {
    fn();
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  check('default cleanup', () => {
    const payload = parseCompletePayload(runWorkflow(), 'default cleanup');
    assert.equal(existsSync(payload.tempRoot), false, `tempRoot leaked: ${payload.tempRoot}`);
    assert.equal(existsSync(optInResultPath), false, 'default workflow unexpectedly wrote an opt-in result');
  });

  check('default backpressure', () => {
    const payload = parseCompletePayload(runWorkflow({ backpressure: true }), 'default backpressure');
    assert.equal(existsSync(payload.tempRoot), false, `tempRoot leaked: ${payload.tempRoot}`);
  });

  check('opt-in backpressure', () => {
    const result = runWorkflow({ backpressure: true, resultPath: optInResultPath });
    const payload = parseCompletePayload(result, 'opt-in backpressure');
    assert.equal(existsSync(payload.tempRoot), false, `tempRoot leaked: ${payload.tempRoot}`);
    assert.equal(existsSync(optInResultPath), true, 'opt-in result was not written');
    assert.deepEqual(JSON.parse(readFileSync(optInResultPath, 'utf8')), payload, 'opt-in result differs from stdout');
  });

  check('lifecycle exit contract', () => {
    const source = readFileSync(workflowScript, 'utf8');
    assert.equal(source.includes('process.exit('), false, 'workflow must set process.exitCode after cleanup instead of calling process.exit()');
  });

  if (failures.length) {
    throw new Error(`Workflow lifecycle check failed:\n- ${failures.join('\n- ')}`);
  }
  console.log('OK workflow E2E lifecycle');
} finally {
  rmSync(harnessRoot, { recursive: true, force: true });
}
