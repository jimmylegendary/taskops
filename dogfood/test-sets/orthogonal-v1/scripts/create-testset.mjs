import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initProject, writeVersionFromSpec } from '../../../../cli/lib-taskops.js';

const base = resolve(new URL('..', import.meta.url).pathname);
const worksDir = join(base, 'works');
rmSync(worksDir, { recursive: true, force: true });
mkdirSync(worksDir, { recursive: true });

const now = '2026-05-12T15:45:00+09:00';

function replaceInFile(path, replacements) {
  let s = readFileSync(path, 'utf8');
  for (const [from, to] of replacements) s = s.replace(from, to);
  writeFileSync(path, s, 'utf8');
}

function snapshot(workDir, id, title='Selected test snapshot') {
  const path = join(workDir, 'snapshots', 'snapshot-root-v2.md');
  writeFileSync(path, `---\ntaskOpsVersion: v1\nentityType: versionSnapshot\nid: snapshot-root-v2\nrootTaskGroupId: tg-root\ncreatedAt: ${now}\nlabel: ${title}\nstatus: active\nselectedVersions:\n  - taskGroupId: tg-root\n    versionId: tgv-root-v2\n---\n# Snapshot root v2\n`, 'utf8');
  replaceInFile(join(workDir, 'index.md'), [['activeSnapshotId: snapshot-root-v1', 'activeSnapshotId: snapshot-root-v2']]);
  replaceInFile(join(workDir, 'task-groups', 'tg-root', 'index.md'), [['activeVersionId: tgv-root-v1', 'activeVersionId: tgv-root-v2']]);
  replaceInFile(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'index.md'), [['selected: true\n', '']]);
}

function makeWork(def) {
  const dir = join(worksDir, def.id);
  initProject(dir, { id: def.id, title: def.title, objective: def.objective, language: 'en' });
  writeVersionFromSpec(dir, 'tg-root', {
    versionId: 'tgv-root-v2', version: 'v2', selected: true, status: 'active',
    summary: def.summary,
    tasks: def.tasks,
  });
  snapshot(dir, def.id);
  if (def.extra) def.extra(dir);
  writeFileSync(join(dir, 'test-intent.md'), `# Test intent: ${def.title}\n\n- Case: ${def.case}\n- Example: ${def.example}\n- Expected stop: ${def.expectedStop}\n- Suggested command:\n\n\`\`\`bash\n${def.command}\n\`\`\`\n`, 'utf8');
  return def;
}

const task = (id, title, readiness, order, status='pending') => ({
  id, title,
  objective: title,
  responsibility: `Exercise ${readiness} runner behavior for ${title}.`,
  completionCriteria: `Runner records the correct action or stop reason for ${title}.`,
  order, status,
  runReadiness: readiness,
  runReadinessReason: `Orthogonal test fixture: ${readiness}.`,
  understandingLevel: readiness === 'needs_exploration' ? 'unknown' : (readiness === 'needs_decomposition' ? 'partial' : 'known'),
  unknowns: readiness === 'needs_exploration' ? [`Unknown constraints for ${title}`] : undefined,
});

const defs = [
  {
    id: '01-coding-refactor-execution', case: 'A: runnable execution throughput', example: 1,
    title: 'OAuth middleware refactor execution path', objective: 'Verify runner executes a short runnable coding-refactor task chain.',
    summary: 'Runnable implementation tasks only; should consume execute steps until maxSteps.',
    tasks: [task('task-map-auth-middleware','Map current auth middleware touchpoints','runnable',1), task('task-change-token-validation','Change token validation branch','runnable',2), task('task-add-regression-test','Add regression test coverage','runnable',3)],
    maxSteps: 3, until: '2026-05-12T16:30:00+09:00', expectedStop: 'max_steps', expectedActions: ['execute','execute','execute'],
  },
  {
    id: '02-content-pipeline-execution', case: 'A: runnable execution throughput', example: 2,
    title: 'Content pipeline cleanup execution path', objective: 'Verify runner handles several straightforward runnable tasks.',
    summary: 'Five runnable tasks; useful for throughput and event-log density checks.',
    tasks: [task('task-audit-inputs','Audit input documents','runnable',1), task('task-normalize-frontmatter','Normalize frontmatter','runnable',2), task('task-render-summary','Render summary artifact','runnable',3), task('task-run-link-check','Run link check','runnable',4), task('task-write-handoff','Write handoff note','runnable',5)],
    maxSteps: 5, until: '2026-05-12T18:00:00+09:00', expectedStop: 'max_steps', expectedActions: ['execute','execute','execute','execute','execute'],
  },
  {
    id: '03-product-spec-decomposition', case: 'B: decomposition expansion', example: 1,
    title: 'Product spec decomposition path', objective: 'Verify needs_decomposition tasks expand into child task groups.',
    summary: 'Decomposition-only fixture for product planning branches.',
    tasks: [task('task-define-user-model','Define user model','needs_decomposition',1), task('task-define-review-flow','Define review flow','needs_decomposition',2), task('task-define-release-scope','Define release scope','needs_decomposition',3)],
    maxSteps: 3, until: '2026-05-12T17:00:00+09:00', expectedStop: 'max_steps', expectedActions: ['decompose','decompose','decompose'],
  },
  {
    id: '04-platform-migration-decomposition', case: 'B: decomposition expansion', example: 2,
    title: 'Platform migration decomposition path', objective: 'Verify larger decomposition branches remain bounded by maxSteps.',
    summary: 'Four decomposable migration areas.',
    tasks: [task('task-inventory-services','Inventory services','needs_decomposition',1), task('task-plan-data-migration','Plan data migration','needs_decomposition',2), task('task-plan-rollback','Plan rollback','needs_decomposition',3), task('task-plan-observability','Plan observability','needs_decomposition',4)],
    maxSteps: 4, until: '2026-05-12T19:00:00+09:00', expectedStop: 'max_steps', expectedActions: ['decompose','decompose','decompose','decompose'],
  },
  {
    id: '05-flaky-test-exploration', case: 'C: exploration before decomposition', example: 1,
    title: 'Flaky test investigation path', objective: 'Verify needs_exploration creates exploration artifacts before decomposition.',
    summary: 'Exploration-only debugging fixture.',
    tasks: [task('task-reproduce-flake','Reproduce intermittent auth test failure','needs_exploration',1), task('task-identify-race-window','Identify race condition window','needs_exploration',2)],
    maxSteps: 2, until: '2026-05-12T16:10:00+09:00', expectedStop: 'max_steps', expectedActions: ['explore','explore'],
  },
  {
    id: '06-market-research-exploration', case: 'C: exploration before decomposition', example: 2,
    title: 'Market research exploration path', objective: 'Verify exploratory work records unknowns and reflects into future decomposition.',
    summary: 'Research fixture with three exploratory branches.',
    tasks: [task('task-map-competitors','Map competitor positioning','needs_exploration',1), task('task-collect-user-language','Collect user language examples','needs_exploration',2), task('task-test-message-risk','Test positioning risks','needs_exploration',3)],
    maxSteps: 3, until: '2026-05-12T20:00:00+09:00', expectedStop: 'max_steps', expectedActions: ['explore','explore','explore'],
  },
  {
    id: '07-human-approval-waiting', case: 'D: waiting stop', example: 1,
    title: 'Human approval waiting path', objective: 'Verify waiting task pauses runner and surfaces the wait.',
    summary: 'Waiting task should stop before any action.',
    tasks: [task('task-approve-budget','Approve budget before execution','runnable',1,'waiting'), task('task-start-spend','Start spend after approval','runnable',2)],
    maxSteps: 10, until: '2026-05-13T09:00:00+09:00', expectedStop: 'waiting', expectedActions: [],
  },
  {
    id: '08-delegated-review-pending', case: 'D: delegated waiting stop', example: 2,
    title: 'Delegated design review pending path', objective: 'Verify pending delegate run node pauses runner globally.',
    summary: 'Pending delegate run node should stop before task dispatch.',
    tasks: [task('task-apply-design-feedback','Apply design feedback after delegate response','runnable',1)],
    maxSteps: 10, until: '2026-05-13T12:00:00+09:00', expectedStop: 'delegation_pending', expectedActions: [],
    extra(dir) {
      const runDir = join(dir, 'runs', 'run-delegation-probe');
      mkdirSync(join(runDir, 'nodes'), { recursive: true }); mkdirSync(join(runDir, 'edges'), { recursive: true });
      writeFileSync(join(runDir, 'index.md'), `---\ntaskOpsVersion: v1\nentityType: run\nid: run-delegation-probe\nworkId: 08-delegated-review-pending\ncreatedAt: ${now}\nstatus: active\n---\n# Run delegation probe\n`, 'utf8');
      writeFileSync(join(runDir, 'run-log.md'), `# Run log\n\n- Waiting for delegated design review.\n`, 'utf8');
      writeFileSync(join(runDir, 'nodes', 'run-node-design-review.md'), `---\ntaskOpsVersion: v1\nentityType: runNode\nid: run-node-design-review\nrunId: run-delegation-probe\ntype: delegate\ntitle: Ask reviewer to inspect design assumptions\nstatus: pending\nsourceTaskId: task-apply-design-feedback\nsourceTaskGroupVersionId: tgv-root-v2\ndelegateeType: human\ndelegateeRef: reviewer\nrequest: Review design assumptions before execution continues.\nexpectedOutput: Approval or requested changes.\nrequestedAt: ${now}\ntimeoutAt: 2026-05-13T12:00:00+09:00\ncreatedAt: ${now}\n---\n# Delegate design review\n`, 'utf8');
    },
  },
  {
    id: '09-mixed-max-step-budget', case: 'E: stop-condition budget', example: 1,
    title: 'Mixed readiness max-step budget path', objective: 'Verify maxSteps bounds execute plus decompose plus explore actions together.',
    summary: 'Mixed readiness fixture should stop after two actions.',
    tasks: [task('task-quick-implementation','Quick implementation task','runnable',1), task('task-break-down-api','Break down API work','needs_decomposition',2), task('task-investigate-risk','Investigate unknown rollout risk','needs_exploration',3), task('task-finalize-note','Finalize note','runnable',4)],
    maxSteps: 2, until: '2026-05-12T21:00:00+09:00', expectedStop: 'max_steps', expectedActions: ['execute','decompose'],
  },
  {
    id: '10-deadline-reached-before-work', case: 'E: stop-condition deadline', example: 2,
    title: 'Expired deadline path', objective: 'Verify until stops before any action when the deadline is already past.',
    summary: 'Past until timestamp should produce deadline_reached with zero steps.',
    tasks: [task('task-would-run','Would run if deadline allowed','runnable',1), task('task-would-decompose','Would decompose if deadline allowed','needs_decomposition',2)],
    maxSteps: 100, until: '2026-01-01T00:00:00+09:00', expectedStop: 'deadline_reached', expectedActions: [],
  },
];

const manifest = { id: 'taskops-runner-orthogonal-v1', createdAt: now, description: 'Five orthogonal TaskOps runner cases, two examples each.', cases: [] };
for (const d of defs) {
  d.command = `taskops run works/${d.id} --executor dry-run --max-steps ${d.maxSteps} --until ${d.until} --json`;
  makeWork(d);
  manifest.cases.push({ id: d.id, case: d.case, example: d.example, objective: d.objective, maxSteps: d.maxSteps, until: d.until, expectedStop: d.expectedStop, expectedActions: d.expectedActions, command: d.command });
}
writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
