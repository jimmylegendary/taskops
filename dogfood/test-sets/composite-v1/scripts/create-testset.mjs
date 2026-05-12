import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initProject, writeVersionFromSpec } from '../../../../cli/lib-taskops.js';

const base = resolve(new URL('..', import.meta.url).pathname);
const worksDir = join(base, 'works');
rmSync(worksDir, { recursive: true, force: true });
mkdirSync(worksDir, { recursive: true });
const now = '2026-05-12T15:50:00+09:00';

function replaceInFile(path, replacements) {
  let s = readFileSync(path, 'utf8');
  for (const [from, to] of replacements) s = s.replace(from, to);
  writeFileSync(path, s, 'utf8');
}
function snapshot(workDir) {
  writeFileSync(join(workDir, 'snapshots', 'snapshot-root-v2.md'), `---\ntaskOpsVersion: v1\nentityType: versionSnapshot\nid: snapshot-root-v2\nrootTaskGroupId: tg-root\ncreatedAt: ${now}\nlabel: Composite scenario selected snapshot\nstatus: active\nselectedVersions:\n  - taskGroupId: tg-root\n    versionId: tgv-root-v2\n---\n# Snapshot root v2\n`, 'utf8');
  replaceInFile(join(workDir, 'index.md'), [['activeSnapshotId: snapshot-root-v1', 'activeSnapshotId: snapshot-root-v2']]);
  replaceInFile(join(workDir, 'task-groups', 'tg-root', 'index.md'), [['activeVersionId: tgv-root-v1', 'activeVersionId: tgv-root-v2']]);
  replaceInFile(join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'index.md'), [['selected: true\n', '']]);
}
const task = (id, title, readiness, order, status='pending', extra={}) => ({
  id, title,
  objective: extra.objective || title,
  responsibility: extra.responsibility || `Exercise composite runner behavior for ${title}.`,
  completionCriteria: extra.completionCriteria || `Runner records expected composite behavior for ${title}.`,
  order, status,
  runReadiness: readiness,
  runReadinessReason: extra.reason || `Composite fixture: ${readiness}.`,
  understandingLevel: extra.understandingLevel || (readiness === 'needs_exploration' ? 'unknown' : readiness === 'needs_decomposition' ? 'partial' : 'known'),
  unknowns: extra.unknowns || (readiness === 'needs_exploration' ? [`Unknowns for ${title}`] : undefined),
});
function makeWork(def) {
  const dir = join(worksDir, def.id);
  initProject(dir, { id: def.id, title: def.title, objective: def.objective, language: 'en' });
  writeVersionFromSpec(dir, 'tg-root', { versionId: 'tgv-root-v2', version: 'v2', selected: true, status: 'active', summary: def.summary, tasks: def.tasks });
  snapshot(dir);
  if (def.extra) def.extra(dir);
  def.command = `taskops run works/${def.id} --executor dry-run --max-steps ${def.maxSteps} --until ${def.until} --json`;
  writeFileSync(join(dir, 'test-intent.md'), `# Composite test intent: ${def.title}\n\n- Scenario: ${def.scenario}\n- Expected stop: ${def.expectedStop}\n- Expected actions: ${def.expectedActions.join(', ') || '(none)'}\n- Suggested command:\n\n\`\`\`bash\n${def.command}\n\`\`\`\n`, 'utf8');
  return def;
}
function addDelegateRun(dir, { id='run-human-review', status='pending', sourceTaskId='task-apply-feedback', sourceTaskGroupVersionId='tgv-root-v2', timeoutAt='2026-05-13T18:00:00+09:00' } = {}) {
  const runDir = join(dir, 'runs', id);
  mkdirSync(join(runDir, 'nodes'), { recursive: true }); mkdirSync(join(runDir, 'edges'), { recursive: true });
  writeFileSync(join(runDir, 'index.md'), `---\ntaskOpsVersion: v1\nentityType: run\nid: ${id}\nworkId: ${dir.split('/').pop()}\ncreatedAt: ${now}\nstatus: active\n---\n# ${id}\n`, 'utf8');
  writeFileSync(join(runDir, 'run-log.md'), `# Run log\n\n- Delegation probe initialized.\n`, 'utf8');
  writeFileSync(join(runDir, 'nodes', 'run-node-human-review.md'), `---\ntaskOpsVersion: v1\nentityType: runNode\nid: run-node-human-review\nrunId: ${id}\ntype: delegate\ntitle: Human review gate\nstatus: ${status}\nsourceTaskId: ${sourceTaskId}\nsourceTaskGroupVersionId: ${sourceTaskGroupVersionId}\ndelegateeType: human\ndelegateeRef: jimmy\nrequest: Review and approve before downstream execution.\nexpectedOutput: Approval, rejection, or constraints.\nrequestedAt: ${now}\ntimeoutAt: ${timeoutAt}\ncreatedAt: ${now}\n---\n# Human review gate\n`, 'utf8');
}

const defs = [
  {
    id: '01-refactor-full-chain', scenario: 'execute + decompose + explore in one bounded run',
    title: 'AI-assisted OAuth refactor full chain', objective: 'Exercise a realistic refactor path that executes, decomposes, explores, then stops by maxSteps.',
    summary: 'Composite refactor chain with mixed readiness.',
    tasks: [
      task('task-read-current-flow','Read current OAuth flow','runnable',1),
      task('task-decompose-token-layer','Decompose token validation layer','needs_decomposition',2),
      task('task-explore-session-risk','Explore session invalidation risk','needs_exploration',3),
      task('task-write-migration-note','Write migration note','runnable',4),
    ],
    maxSteps: 4, until: '2026-05-20T17:30:00+09:00', expectedStop: 'max_steps', expectedActions: ['execute','decompose','explore','execute'],
  },
  {
    id: '02-research-to-build-chain', scenario: 'exploration first, then decomposition, then execution',
    title: 'Research-to-build product spike', objective: 'Exercise unknown-first work where exploration and decomposition both happen before execution.',
    summary: 'Research-to-build chain.',
    tasks: [
      task('task-explore-user-language','Explore user language and constraints','needs_exploration',1),
      task('task-decompose-mvp-scope','Decompose MVP scope from learned constraints','needs_decomposition',2),
      task('task-build-demo-brief','Build demo brief artifact','runnable',3),
      task('task-prepare-review','Prepare review checklist','runnable',4),
    ],
    maxSteps: 3, until: '2026-05-20T18:30:00+09:00', expectedStop: 'max_steps', expectedActions: ['explore','decompose','execute'],
  },
  {
    id: '03-ops-incident-with-blocker', scenario: 'mixed actionable tasks then blocked_only',
    title: 'Ops incident triage with remaining blockers', objective: 'Exercise mixed work that honestly stops when only blocked follow-ups remain.',
    summary: 'Incident triage with blocked-only ending.',
    tasks: [
      task('task-capture-symptoms','Capture incident symptoms','runnable',1),
      task('task-explore-root-cause','Explore possible root cause','needs_exploration',2),
      task('task-decompose-remediation','Decompose remediation plan','needs_decomposition',3),
      task('task-wait-vendor-response','Wait for vendor response','blocked',4,'pending',{reason:'External vendor answer required.'}),
      task('task-run-prod-change','Run production change after approval','blocked',5,'pending',{reason:'Needs human production approval.'}),
    ],
    maxSteps: 10, until: '2026-05-20T22:00:00+09:00', expectedStop: 'blocked_only', expectedActions: ['execute','explore','decompose'],
  },
  {
    id: '04-campaign-with-human-wait', scenario: 'waiting task blocks otherwise actionable tasks',
    title: 'Marketing campaign with budget gate', objective: 'Verify a waiting task pauses before later executable tasks.',
    summary: 'Human gate should pause the whole run.',
    tasks: [
      task('task-collect-brief','Collect campaign brief','runnable',1),
      task('task-approve-budget','Approve campaign budget','runnable',2,'waiting'),
      task('task-build-landing-copy','Build landing copy','runnable',3),
      task('task-decompose-channel-plan','Decompose channel plan','needs_decomposition',4),
    ],
    maxSteps: 10, until: '2026-05-21T09:00:00+09:00', expectedStop: 'waiting', expectedActions: ['execute'],
  },
  {
    id: '05-delegated-review-after-progress', scenario: 'first run progresses, second run sees delegate pending',
    title: 'Design review delegation after initial work', objective: 'Fixture includes a pending delegate; runner must stop before dispatching new work.',
    summary: 'Pending delegate run node globally pauses execution.',
    tasks: [
      task('task-apply-feedback','Apply feedback after delegated review','runnable',1),
      task('task-update-spec','Update spec after approval','runnable',2),
    ],
    maxSteps: 10, until: '2026-05-21T12:00:00+09:00', expectedStop: 'delegation_pending', expectedActions: [],
    extra: (dir) => addDelegateRun(dir),
  },
  {
    id: '06-deadline-cuts-composite-work', scenario: 'deadline has priority before action dispatch',
    title: 'Composite work with expired deadline', objective: 'Verify expired until prevents execute/decompose/explore from starting.',
    summary: 'Past deadline with otherwise actionable mixed work.',
    tasks: [
      task('task-ready-execute','Ready execution task','runnable',1),
      task('task-ready-decompose','Ready decomposition task','needs_decomposition',2),
      task('task-ready-explore','Ready exploration task','needs_exploration',3),
    ],
    maxSteps: 10, until: '2026-01-01T00:00:00+09:00', expectedStop: 'deadline_reached', expectedActions: [],
  },
];
const manifest = { id: 'taskops-runner-composite-v1', createdAt: now, description: 'Composite TaskOps runner scenarios mixing multiple readiness and stop-condition behaviors.', cases: [] };
for (const d of defs) {
  makeWork(d);
  manifest.cases.push({ id: d.id, scenario: d.scenario, objective: d.objective, maxSteps: d.maxSteps, until: d.until, expectedStop: d.expectedStop, expectedActions: d.expectedActions, command: d.command });
}
writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
