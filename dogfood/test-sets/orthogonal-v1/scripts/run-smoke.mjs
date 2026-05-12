import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const [root, tmpRoot] = process.argv.slice(2);
if (!root || !tmpRoot) throw new Error('usage: run-smoke.mjs <testset-root> <tmp-root>');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const results = [];
for (const c of manifest.cases) {
  const src = join(root, 'works', c.id);
  const dst = join(tmpRoot, c.id);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
  cpSync(src, dst, { recursive: true });

  const validate = spawnSync('taskops', ['validate', dst], { encoding: 'utf8' });
  if (validate.status !== 0) {
    throw new Error(`validate failed for ${c.id}: ${validate.stderr || validate.stdout}`);
  }

  const run = spawnSync('taskops', ['run', dst, '--executor', 'dry-run', '--max-steps', String(c.maxSteps), '--until', c.until, '--json'], { encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`run command failed for ${c.id}: ${run.stderr || run.stdout}`);
  }
  const out = JSON.parse(run.stdout);
  const actions = (out.actions || out.tasks || []).map((a) => a.kind || 'execute');
  const okStop = out.stopReason === c.expectedStop;
  const okActions = JSON.stringify(actions) === JSON.stringify(c.expectedActions);
  results.push({ id: c.id, stopReason: out.stopReason, expectedStop: c.expectedStop, stepsRun: out.stepsRun, actions, expectedActions: c.expectedActions, okStop, okActions });
  if (!okStop || !okActions) {
    throw new Error(`unexpected result for ${c.id}: ${JSON.stringify(results.at(-1), null, 2)}`);
  }
}
console.log(JSON.stringify({ ok: true, count: results.length, tmpRoot, results }, null, 2));
