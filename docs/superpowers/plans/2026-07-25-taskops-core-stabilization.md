# TaskOps Core Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair TaskOps restart, run-identity, closure, prototype, and JSON-output defects so valid verified work can reach `all_closed` and `claimSafe=true` without weakening negative-path honesty.

**Architecture:** Keep the task graph and run graph independent, add pure helpers at the semantic boundaries, and make persisted action attempts and closure roles explicit. The parser derives completion only from the selected lineage, validates supporting provenance and independent review evidence, and preserves legacy records through fail-closed inference. The CLI keeps one asynchronous process lifecycle so machine output drains completely.

**Tech Stack:** Node.js 22+, plain ESM, Markdown/YAML-style frontmatter, `node:assert/strict`, built-in `node:test`-style script fixtures, npm workspaces, GitHub Actions.

## Global Constraints

- Start execution from the commit that contains this plan, with `d4b6a6b` as its product/design ancestor, in an isolated Git worktree created with `superpowers:using-git-worktrees`; never implement in `/home/jimmy/repos/taskops`.
- Preserve all user-owned files under `eval/results/`, `eval/soak/`, and `test-results/` in the original checkout byte-for-byte.
- Do not bump `0.10.1`, create a release tag, publish an artifact, or add a runtime dependency.
- Keep Node.js support at `>=22`.
- The active verification surface is the CLI, core docs, the TaskOps skill contract, deterministic tests, and CI.
- Exploration, decomposition, and prototype actions may close supporting run work; they may not close the source objective by themselves.
- A runner may not make its own objective claim policy-approved. Approval must resolve to a real independent review node and matching evidence hashes.
- `claimSafe=true` must remain stricter than structural closure.
- Every production change begins with an observed failing regression and ends with focused tests, a review gate, and a focused commit.
- The difficult older-model benchmark campaign is a required separate project after this correctness branch; do not mix benchmark tuning or score claims into these commits.

---

## File and Interface Map

### New focused modules

- `cli/lib-restart.js`
  - Pure restart dependency rebasing and selected restart-lineage stale-reference detection.
- `cli/lib-run-identity.js`
  - Pure allocation of immutable `(task version, task, action, attempt)` run-node identities.
- `cli/lib-artifact-contract.js`
  - Regular-file, fatal UTF-8, and non-whitespace artifact inspection shared by prototype execution and closure validation.
- `cli/lib-run-closure.js`
  - Closure-role inference, selected-lineage classification, supporting-provenance checks, and review-evidence validation.

### New deterministic regressions

- `cli/scripts/restart-blockedby-rebase.mjs`
- `cli/scripts/run-node-action-attempt-identity.mjs`
- `cli/scripts/dynamic-closure-liveness.mjs`
- `cli/scripts/prototype-state-machine.mjs`
- `cli/scripts/json-stdout-lifecycle.mjs`
- `scripts/check-repository-scope.mjs`

### Existing orchestration files

- `cli/lib-taskops.js`
  - Calls restart and closure helpers; computes selected-lineage closure metrics.
- `cli/lib-runner.js`
  - Allocates action attempts, persists roles, normalizes runtimes once, and enforces prototype wait/resume.
- `cli/lib-state-writer.js`
  - Writes immutable run identity and required closure-role metadata.
- `cli/lib-runtime-adapters.js`
  - Owns executor alias/variant normalization.
- `cli/bin/taskops.js`
  - Owns the asynchronous stdout/stderr lifecycle.

### Cross-task interfaces

```js
// cli/lib-restart.js
rebaseBlockedByVersionRefs(blockedBy, { fromVersionId, toVersionId })
// => same scalar/object/array shape, deep-cloned

findSelectedRestartBlockedByIssues({ version, versions })
// => Array<{ taskId, blockedTaskId, referencedVersionId }>

// cli/lib-run-identity.js
allocateRunNodeIdentity({
  taskId,
  taskGroupVersionId,
  actionKind,
  existingNodes,
})
// => { runNodeId, actionKind, attempt, predecessorRunNodeId }

// cli/lib-artifact-contract.js
inspectNonEmptyUtf8File(filePath, { label })
// => { ok: true, artifactPath, text } | { ok: false, artifactPath, message }

// cli/lib-run-closure.js
canonicalSha256(value)
// => "sha256:<hex>" with recursively sorted object keys

classifyRunClosure({
  node,
  eow,
  runNodes,
  runEdges,
  versions,
  selectedVersionIds,
})
// => {
//   role: 'supporting' | 'claim-bearing',
//   selected,
//   schemaValid,
//   supportValid,
//   reviewEvidenceValid,
//   policyApproved,
//   issues,
// }
```

The state writer accepts these exact additions:

```js
ensureRunNodeFile({
  runDir, runId, runNodeId, type, title,
  sourceTaskId, sourceTaskGroupVersionId,
  status, kindLabel,
  actionKind, attempt, predecessorRunNodeId,
}, io)

closeRunNodeWithEowFiles({
  runDir, runId, runNodeId, reason, finishedAt,
  closureRole,
  approvedReview,
  resolvedByTaskGroupId,
}, io)
```

---

## Execution Setup

- [ ] **Step 1: Invoke `superpowers:using-git-worktrees` and create the isolated branch**

Follow the skill's isolation detection, native-tool preference, directory selection, ignore check, and setup sequence. Name a newly created fallback branch `fix/taskops-core-stabilization` and base it on the current commit containing this plan:

```bash
git merge-base --is-ancestor d4b6a6b HEAD
test -f docs/superpowers/plans/2026-07-25-taskops-core-stabilization.md
git branch --show-current
git status --short
```

Expected after entering the skill-owned worktree: both first commands exit 0, the branch is `fix/taskops-core-stabilization`, and `git status --short` has no output.

- [ ] **Step 2: Record the original checkout's protected-path state**

```bash
git -C /home/jimmy/repos/taskops status --porcelain=v1 -- eval/results eval/soak test-results > /tmp/taskops-core-protected.before
find /home/jimmy/repos/taskops/eval/results /home/jimmy/repos/taskops/eval/soak /home/jimmy/repos/taskops/test-results -type f -print0 \
  | sort -z \
  | xargs -0 sha256sum > /tmp/taskops-core-protected.sha256.before
```

Expected: both snapshot files are created outside the repository. Do not modify or stage the listed paths.

- [ ] **Step 3: Install the existing dependency graph and record the baseline**

```bash
npm ci
npm test
node cli/scripts/restart-semantic-contract.mjs
node cli/scripts/exploration-nonclosing.mjs
node cli/scripts/unknown-knowns.mjs
node cli/scripts/navigation-approval-parity.mjs
npm run test:version-sync
```

Expected: `npm test` and the four focused regressions pass. If a product test
fails, report the failure and obtain direction before implementation. The
current version-sync check is the separately observed Task 1 RED because it
still includes inactive package/lock surfaces; Task 1 makes that core check
green.

---

### Task 1: Make the Repository Verification Surface Fail-Closed

**Files:**
- Create: `scripts/check-repository-scope.mjs`
- Create: `.github/workflows/ci.yml`
- Create: `docs/REPOSITORY_SCOPE.md`
- Modify: `package.json`
- Modify: `cli/package.json`
- Modify: `package-lock.json`
- Modify: `scripts/check-version-sync.mjs`
- Modify: `scripts/check-contract-docs.mjs`
- Modify: `README.md`
- Modify: `cli/README.md`
- Modify: `skill/README.md`
- Modify: `docs/RELEASE_MODEL.md`
- Delete: `.github/workflows/release.yml`
- Delete: `scripts/build-release-assets.mjs`
- Delete: `scripts/smoke-publish-artifact.mjs`
- Test: `scripts/check-repository-scope.mjs`

**Interfaces:**
- Consumes: root and CLI `package.json`, npm lockfile v3, workflow files.
- Produces: `npm run test:repository-scope`; root `npm run verify` executes exactly the active core surface.

- [ ] **Step 1: Write the failing repository-scope contract**

Create `scripts/check-repository-scope.mjs` with this complete contract:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'));
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const rootPkg = readJson('package.json');
const cliPkg = readJson('cli/package.json');
const lock = readJson('package-lock.json');

assert.equal(rootPkg.private, true, 'root package must remain private');
assert.equal(cliPkg.private, true, 'CLI package must be non-publishable');
assert.deepEqual(rootPkg.workspaces, ['cli'], 'only the CLI is an active workspace');

for (const name of ['build:release', 'release:preflight', 'smoke:publish-artifact']) {
  assert.equal(rootPkg.scripts[name], undefined, `${name} must not be active`);
}
assert.equal(rootPkg.scripts.verify.startsWith('npm run test:repository-scope'), true);

assert.ok(lock.packages?.cli, 'lockfile must contain the CLI workspace');
assert.equal(lock.packages?.['obsidian-plugin'], undefined);
assert.equal(lock.packages?.['node_modules/taskops-obsidian'], undefined);

assert.equal(existsSync(join(repoRoot, 'obsidian-plugin')), true, 'preserved source must remain present');
assert.equal(existsSync(join(repoRoot, '.github/workflows/release.yml')), false);
assert.equal(existsSync(join(repoRoot, 'scripts/build-release-assets.mjs')), false);
assert.equal(existsSync(join(repoRoot, 'scripts/smoke-publish-artifact.mjs')), false);

const ci = read('.github/workflows/ci.yml');
assert.match(ci, /\bpush:/);
assert.match(ci, /\bpull_request:/);
assert.match(ci, /node-version:\s*['"]?22/);
assert.match(ci, /npm ci/);
assert.match(ci, /npm run verify/);
for (const forbidden of [/npm publish/i, /clawhub/i, /refs\/tags/i, /release asset/i, /obsidian-plugin/i]) {
  assert.equal(forbidden.test(ci), false, `CI contains inactive behavior: ${forbidden}`);
}

console.log('OK repository scope');
```

- [ ] **Step 2: Run the contract and observe RED**

Run:

```bash
node scripts/check-repository-scope.mjs
```

Expected: FAIL first at `CLI package must be non-publishable` or `only the CLI is an active workspace`.

- [ ] **Step 3: Narrow package metadata and verification commands**

Change the root package scripts to this shape while retaining `version`, `description`, and other metadata:

```json
{
  "private": true,
  "workspaces": ["cli"],
  "scripts": {
    "build": "npm run build --workspace cli",
    "typecheck": "npm run typecheck --workspace cli",
    "test": "npm run test --workspace cli",
    "test:repository-scope": "node ./scripts/check-repository-scope.mjs",
    "test:version-sync": "node ./scripts/check-version-sync.mjs",
    "test:contract": "node ./scripts/check-contract-docs.mjs",
    "verify": "npm run test:repository-scope && npm run test:version-sync && npm run test:contract && npm run typecheck && npm run build && npm run test"
  }
}
```

Add this top-level property to `cli/package.json`:

```json
"private": true
```

Reduce `scripts/check-version-sync.mjs` to root, CLI, and active lock entries:

```js
const rootPkg = readJson(join(repoRoot, 'package.json'));
const cliPkg = readJson(join(repoRoot, 'cli', 'package.json'));
const packageLock = readJson(join(repoRoot, 'package-lock.json'));

const expected = rootPkg.version;
const checks = [
  ['root package', rootPkg.version],
  ['cli package', cliPkg.version],
  ['package-lock root', packageLock.version],
  ['package-lock package root', packageLock.packages?.['']?.version],
  ['package-lock cli workspace', packageLock.packages?.cli?.version],
];
```

Remove `obsidian-plugin/README.md` from `userFacingDocs` and delete the three plugin-specific assertion blocks from `scripts/check-contract-docs.mjs`. Do not change semantic readiness checks yet; Task 8 adds those after the implementation exists.

- [ ] **Step 4: Replace release automation with core CI**

Delete the three release/build files listed above and create `.github/workflows/ci.yml`:

```yaml
name: core-ci

on:
  push:
  pull_request:

permissions:
  contents: read

concurrency:
  group: core-ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run verify
```

- [ ] **Step 5: Regenerate the lockfile without scripts**

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected: `package-lock.json` contains the root and `cli` workspace at `0.10.1`, and no active plugin workspace/link.

- [ ] **Step 6: Write the repository policy and remove contradictory active instructions**

Create `docs/REPOSITORY_SCOPE.md`:

```markdown
# Repository scope

TaskOps core currently consists of the CLI, core documentation, the maintained
TaskOps skill contract, deterministic tests, and CI.

The `obsidian-plugin/` tree is preserved source, but it is not an npm workspace,
version-sync participant, verification target, build artifact, or CI path.
The CLI package is private and the repository has no automated publication or
tag-triggered artifact assembly.

Reactivation requires an explicit design review, removal of `private` only for
the intended package, restoration of dedicated verification, and a separately
reviewed publication workflow. A version bump or tag alone is insufficient.
```

Replace `docs/RELEASE_MODEL.md` with:

````markdown
# TaskOps release model

There is no active public release pipeline in the current core-stabilization
scope. See [REPOSITORY_SCOPE.md](./REPOSITORY_SCOPE.md) for the active surface
and the explicit review required before any distribution path is restored.

The current local quality gate is:

```bash
npm ci
npm run verify
```
````

Update the root, CLI, and skill READMEs to describe local workspace execution with `npm ci`, `npm run verify`, and `node cli/bin/taskops.js --help`; remove commands that imply an active public install or release path.

- [ ] **Step 7: Run focused verification**

Run:

```bash
npm run test:repository-scope
npm run test:version-sync
npm run test:contract
npm ci
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json cli/package.json package-lock.json \
  scripts/check-repository-scope.mjs scripts/check-version-sync.mjs scripts/check-contract-docs.mjs \
  .github/workflows docs/REPOSITORY_SCOPE.md docs/RELEASE_MODEL.md \
  README.md cli/README.md skill/README.md
git add -u scripts/build-release-assets.mjs scripts/smoke-publish-artifact.mjs
git commit -m "chore: constrain repository to TaskOps core"
```

---

### Task 2: Rebase Restart Dependencies and Reject Stale Selected References

**Files:**
- Create: `cli/lib-restart.js`
- Create: `cli/scripts/restart-blockedby-rebase.mjs`
- Modify: `cli/lib-taskops.js:1063-1070,3417-3423`
- Modify: `cli/lib-runner.js:2222-2225`
- Modify: `cli/scripts/blockedby-normalization.mjs:265-268`
- Modify: `cli/package.json`
- Test: `cli/scripts/restart-blockedby-rebase.mjs`

**Interfaces:**
- Consumes: parsed version records, `blockedBy` scalar/object/array values.
- Produces: `rebaseBlockedByVersionRefs()` and `findSelectedRestartBlockedByIssues()` as defined in the file map.

- [ ] **Step 1: Write pure RED tests for shape-preserving rebasing**

Start `cli/scripts/restart-blockedby-rebase.mjs` with:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict';
import { rebaseBlockedByVersionRefs } from '../lib-restart.js';

const original = [
  { type: 'task', id: 'foundation', taskGroupVersionId: 'tgv-root-v2' },
  { type: 'task', id: 'external', taskGroupVersionId: 'tgv-external-v1' },
  { type: 'runNode', runId: 'run-old', id: 'run-node-old' },
];
const rebased = rebaseBlockedByVersionRefs(original, {
  fromVersionId: 'tgv-root-v2',
  toVersionId: 'tgv-root-v3',
});
assert.deepEqual(rebased, [
  { type: 'task', id: 'foundation', taskGroupVersionId: 'tgv-root-v3' },
  { type: 'task', id: 'external', taskGroupVersionId: 'tgv-external-v1' },
  { type: 'runNode', runId: 'run-old', id: 'run-node-old' },
]);
assert.deepEqual(original[0], {
  type: 'task',
  id: 'foundation',
  taskGroupVersionId: 'tgv-root-v2',
});
assert.deepEqual(
  rebaseBlockedByVersionRefs(original[0], {
    fromVersionId: 'tgv-root-v2',
    toVersionId: 'tgv-root-v3',
  }),
  { type: 'task', id: 'foundation', taskGroupVersionId: 'tgv-root-v3' },
);
```

- [ ] **Step 2: Run the new test and observe RED**

Run:

```bash
node cli/scripts/restart-blockedby-rebase.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `cli/lib-restart.js`.

- [ ] **Step 3: Implement the pure restart helper**

Create `cli/lib-restart.js`:

```js
function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function rebaseBlockedByVersionRefs(
  blockedBy,
  { fromVersionId, toVersionId } = {},
) {
  if (blockedBy == null || blockedBy === '') return blockedBy;
  if (!fromVersionId || !toVersionId) {
    throw new Error('fromVersionId and toVersionId are required');
  }
  const rewrite = (ref) => {
    const copy = cloneValue(ref);
    if (
      copy
      && typeof copy === 'object'
      && !Array.isArray(copy)
      && copy.type === 'task'
      && copy.taskGroupVersionId === fromVersionId
    ) {
      copy.taskGroupVersionId = toVersionId;
    }
    return copy;
  };
  return Array.isArray(blockedBy) ? blockedBy.map(rewrite) : rewrite(blockedBy);
}

function restartAncestorIds(version, versions) {
  const ids = new Set();
  let cursor = version;
  while (cursor) {
    const parentId = cursor.restartedFromVersionId || cursor.supersedesVersionId;
    if (!parentId || ids.has(parentId)) break;
    ids.add(parentId);
    cursor = versions.get(parentId);
  }
  return ids;
}

export function findSelectedRestartBlockedByIssues({ version, versions } = {}) {
  if (!version?.restartedFromVersionId) return [];
  const ancestorIds = restartAncestorIds(version, versions);
  const issues = [];
  for (const task of version.tasks || []) {
    const refs = Array.isArray(task.blockedBy)
      ? task.blockedBy
      : (task.blockedBy == null || task.blockedBy === '' ? [] : [task.blockedBy]);
    for (const ref of refs) {
      if (!ref || ref.type !== 'task' || !ancestorIds.has(ref.taskGroupVersionId)) continue;
      const referenced = versions.get(ref.taskGroupVersionId);
      if (referenced?.taskGroupId !== version.taskGroupId) continue;
      issues.push({
        taskId: task.id,
        blockedTaskId: ref.id || ref.taskId || '',
        referencedVersionId: ref.taskGroupVersionId,
      });
    }
  }
  return issues;
}
```

- [ ] **Step 4: Wire restart-time rebasing**

Import `rebaseBlockedByVersionRefs` and replace the restart clone assignment in `restartFromTask()`:

```js
if (task.blockedBy !== undefined && task.blockedBy !== null && task.blockedBy !== '') {
  cloned.blockedBy = rebaseBlockedByVersionRefs(task.blockedBy, {
    fromVersionId: sourceVersion.id,
    toVersionId: newVersionId,
  });
}
```

Do not apply the selected-restart validator to all superseded versions; partial promotion has a different semantic path.

- [ ] **Step 5: Add selected restart-lineage validation**

After `activeSnapshot` is available in `parseProject()`, add:

```js
for (const pair of activeSnapshot?.selectedVersions || []) {
  const selectedVersion = versions.get(pair.versionId);
  for (const issue of findSelectedRestartBlockedByIssues({
    version: selectedVersion,
    versions,
  })) {
    errors.push(withPath(
      activeSnapshot.path,
      `selected restart version '${selectedVersion.id}' task '${issue.taskId}' `
      + `depends on superseded internal version '${issue.referencedVersionId}' `
      + `task '${issue.blockedTaskId}'`,
    ));
  }
}
```

At the start of `pickNextAction(parsed, target)`, add:

```js
if (parsed.errors.length > 0) {
  return {
    kind: 'stop',
    reason: STOP_REASONS.NO_RUNNABLE,
    detail: `Work has ${parsed.errors.length} validation error(s); scheduling is disabled.`,
  };
}
```

The snapshot path keeps this hard error from being filtered as an unrelated target-task error.

- [ ] **Step 6: Complete the integration portion of the restart regression**

Append this deterministic fixture setup to `restart-blockedby-rebase.mjs`:

```js
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fmBlock, parseProject, restartFromTask } from '../lib-taskops.js';
import { computeNextAction, runTaskOps } from '../lib-runner.js';

function writeMd(path, fm) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fmBlock(fm) + `# ${fm.id}\n`, 'utf8');
}

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-restart-rebase-'));
const workDir = join(tempRoot, 'work');
const now = '2026-07-25T00:00:00.000Z';
const rootV2 = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v2');
const externalV1 = join(workDir, 'task-groups', 'tg-external', 'versions', 'tgv-external-v1');

writeMd(join(workDir, 'index.md'), {
  taskOpsVersion: 'v1',
  entityType: 'work',
  id: 'restart-rebase',
  title: 'Restart rebase',
  objective: 'Keep restarted dependencies in the selected version.',
  activeRootTaskGroupId: 'tg-root',
  activeSnapshotId: 'snapshot-root-v1',
  createdAt: now,
  status: 'active',
});
writeMd(join(workDir, 'task-groups', 'tg-root', 'index.md'), {
  taskOpsVersion: 'v1',
  entityType: 'taskGroup',
  id: 'tg-root',
  objective: 'Root work.',
  activeVersionId: 'tgv-root-v2',
  createdAt: now,
  status: 'active',
});
writeMd(join(rootV2, 'index.md'), {
  taskOpsVersion: 'v1',
  entityType: 'taskGroupVersion',
  id: 'tgv-root-v2',
  taskGroupId: 'tg-root',
  version: 'v2',
  summary: 'Completed source version.',
  selected: true,
  createdAt: now,
  status: 'active',
});
writeMd(join(workDir, 'task-groups', 'tg-external', 'index.md'), {
  taskOpsVersion: 'v1',
  entityType: 'taskGroup',
  id: 'tg-external',
  objective: 'External prerequisite.',
  activeVersionId: 'tgv-external-v1',
  createdAt: now,
  status: 'active',
});
writeMd(join(externalV1, 'index.md'), {
  taskOpsVersion: 'v1',
  entityType: 'taskGroupVersion',
  id: 'tgv-external-v1',
  taskGroupId: 'tg-external',
  version: 'v1',
  summary: 'External selected version.',
  selected: true,
  createdAt: now,
  status: 'active',
});
writeMd(join(workDir, 'snapshots', 'snapshot-root-v1.md'), {
  taskOpsVersion: 'v1',
  entityType: 'versionSnapshot',
  id: 'snapshot-root-v1',
  rootTaskGroupId: 'tg-root',
  createdAt: now,
  label: 'Root plus external',
  status: 'active',
  selectedVersions: [
    { taskGroupId: 'tg-root', versionId: 'tgv-root-v2' },
    { taskGroupId: 'tg-external', versionId: 'tgv-external-v1' },
  ],
});
writeMd(join(rootV2, 'tasks', 'foundation.md'), {
  taskOpsVersion: 'v1',
  entityType: 'task',
  id: 'foundation',
  taskGroupId: 'tg-root',
  taskGroupVersionId: 'tgv-root-v2',
  title: 'Foundation',
  objective: 'Build the foundation.',
  responsibility: 'Own the foundation.',
  completionCriteria: 'Foundation result exists.',
  order: 1,
  createdAt: now,
  status: 'done',
  runReadiness: 'runnable',
  understandingLevel: 'known',
});
writeMd(join(rootV2, 'tasks', 'dependent.md'), {
  taskOpsVersion: 'v1',
  entityType: 'task',
  id: 'dependent',
  taskGroupId: 'tg-root',
  taskGroupVersionId: 'tgv-root-v2',
  title: 'Dependent',
  objective: 'Build on the foundation and external prerequisite.',
  responsibility: 'Own the dependent result.',
  completionCriteria: 'Dependent result exists.',
  order: 2,
  createdAt: now,
  status: 'done',
  runReadiness: 'runnable',
  understandingLevel: 'known',
  blockedBy: [
    { type: 'task', id: 'foundation', taskGroupVersionId: 'tgv-root-v2' },
    { type: 'task', id: 'external', taskGroupVersionId: 'tgv-external-v1' },
  ],
});
writeMd(join(externalV1, 'tasks', 'external.md'), {
  taskOpsVersion: 'v1',
  entityType: 'task',
  id: 'external',
  taskGroupId: 'tg-external',
  taskGroupVersionId: 'tgv-external-v1',
  title: 'External',
  objective: 'Provide the external prerequisite.',
  responsibility: 'Own the external prerequisite.',
  completionCriteria: 'External prerequisite exists.',
  order: 1,
  createdAt: now,
  status: 'done',
  runReadiness: 'runnable',
  understandingLevel: 'known',
});
for (const [dir, taskId, versionId] of [
  [rootV2, 'foundation', 'tgv-root-v2'],
  [rootV2, 'dependent', 'tgv-root-v2'],
  [externalV1, 'external', 'tgv-external-v1'],
]) {
  writeMd(join(dir, 'eow', `eow-${taskId}.md`), {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: `eow-${taskId}`,
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: taskId,
    taskGroupVersionId: versionId,
    reason: 'manual_close',
    declaredBy: 'fixture',
    declaredAt: now,
    createdAt: now,
    status: 'done',
  });
}

restartFromTask(workDir, {
  fromTaskId: 'foundation',
  instruction: 'Rebuild the foundation before its dependent runs.',
  reason: 'dependency_rebase_regression',
});
```

Import `restartFromTask` with `fmBlock` and `parseProject`, then add these exact assertions:

```js
const restarted = parseProject(workDir);
assert.deepEqual(restarted.errors, []);
const v3Dependent = restarted.tasks.get('tgv-root-v3:dependent');
assert.deepEqual(v3Dependent.blockedBy, [
  { type: 'task', id: 'foundation', taskGroupVersionId: 'tgv-root-v3' },
  { type: 'task', id: 'external', taskGroupVersionId: 'tgv-external-v1' },
]);

const held = runTaskOps(workDir, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
  targetTaskId: 'dependent',
  targetTaskGroupVersionId: 'tgv-root-v3',
  allowConcurrentTarget: true,
});
assert.equal(held.actions.length, 0);
assert.equal(held.stopReason, 'blocked_only');

runTaskOps(workDir, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
  targetTaskId: 'foundation',
  targetTaskGroupVersionId: 'tgv-root-v3',
  allowConcurrentTarget: true,
});
const resumed = runTaskOps(workDir, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
  targetTaskId: 'dependent',
  targetTaskGroupVersionId: 'tgv-root-v3',
  allowConcurrentTarget: true,
});
assert.equal(resumed.actions[0].status, 'completed');
```

Corrupt only the v3 internal ref back to v2 and assert:

```js
const v3DependentPath = join(
  workDir,
  'task-groups',
  'tg-root',
  'versions',
  'tgv-root-v3',
  'tasks',
  'dependent.md',
);
const validDependentText = readFileSync(v3DependentPath, 'utf8');
const blockerNeedle = 'taskGroupVersionId: tgv-root-v3';
const blockerOffset = validDependentText.lastIndexOf(blockerNeedle);
assert.ok(blockerOffset > 0);
writeFileSync(
  v3DependentPath,
  validDependentText.slice(0, blockerOffset)
    + 'taskGroupVersionId: tgv-root-v2'
    + validDependentText.slice(blockerOffset + blockerNeedle.length),
  'utf8',
);
const invalid = parseProject(workDir);
assert.ok(invalid.errors.some((error) => error.includes('depends on superseded internal version')));
const next = computeNextAction(workDir);
assert.equal(next.action, 'no_runnable');
assert.equal(next.target, null);
assert.throws(
  () => runTaskOps(workDir, {
    executor: 'dry-run',
    maxSteps: 1,
    targetTaskId: 'dependent',
    targetTaskGroupVersionId: 'tgv-root-v3',
    allowConcurrentTarget: true,
  }),
  /Cannot start runner|validation error/i,
);
rmSync(tempRoot, { recursive: true, force: true });
console.log('OK restart blockedBy rebase');
```

- [ ] **Step 7: Correct the old preservation assertion and register the test**

In `blockedby-normalization.mjs`, replace the old equality with:

```js
assert.equal(apiTask.blockedBy[0].taskGroupVersionId, 'tgv-blockedby-normal-v1');
assert.equal(restartedApiTask.blockedBy[0].taskGroupVersionId, 'tgv-blockedby-normal-v2');
assert.equal(restartedApiTask.blockedBy[0].id, apiTask.blockedBy[0].id);
```

Add:

```json
"test:restart-blockedby-rebase": "node ./scripts/restart-blockedby-rebase.mjs"
```

Append the script to the default CLI `test` chain and `files` list, and add `lib-restart.js` to `files`.

- [ ] **Step 8: Run focused and adjacent regressions**

Run:

```bash
npm --workspace cli run test:restart-blockedby-rebase
npm --workspace cli run test:blockedby-normalization
node cli/scripts/restart-semantic-contract.mjs
node cli/scripts/version-flow-writer.mjs
node cli/scripts/closure-superseded-blocker-isolation.mjs
node cli/scripts/invalid-graph-not-complete.mjs
```

Expected: all exit 0.

- [ ] **Step 9: Commit**

```bash
git add cli/lib-restart.js cli/lib-taskops.js cli/lib-runner.js \
  cli/scripts/restart-blockedby-rebase.mjs cli/scripts/blockedby-normalization.mjs \
  cli/package.json
git commit -m "fix: rebase restart dependency versions"
```

---

### Task 3: Give Every Action Attempt an Immutable Run Identity

**Files:**
- Create: `cli/lib-run-identity.js`
- Create: `cli/scripts/run-node-action-attempt-identity.mjs`
- Modify: `cli/lib-runner.js:2931-2949,3063-3124,3541-3560,4775-4800,4924-4940,5112-5125`
- Modify: `cli/lib-state-writer.js:61-103`
- Modify: `cli/scripts/exploration-nonclosing.mjs`
- Modify: `cli/scripts/verify-retries.mjs`
- Modify: `cli/scripts/state-writer-run-graph.mjs`
- Modify: `cli/package.json`
- Test: `cli/scripts/run-node-action-attempt-identity.mjs`

**Interfaces:**
- Consumes: parsed existing run nodes for one run.
- Produces: `allocateRunNodeIdentity()` and immutable `actionKind`, `attempt`, `predecessorRunNodeId` node fields.

- [ ] **Step 1: Write the pure identity RED test**

Create `cli/scripts/run-node-action-attempt-identity.mjs`:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict';
import { allocateRunNodeIdentity } from '../lib-run-identity.js';

const first = allocateRunNodeIdentity({
  taskId: 'task-a',
  taskGroupVersionId: 'tgv-a-v1',
  actionKind: 'explore',
  existingNodes: [],
});
assert.deepEqual(first, {
  runNodeId: 'run-node-task-a',
  actionKind: 'explore',
  attempt: 1,
  predecessorRunNodeId: null,
});

const decompose = allocateRunNodeIdentity({
  taskId: 'task-a',
  taskGroupVersionId: 'tgv-a-v1',
  actionKind: 'decompose',
  existingNodes: [{
    id: first.runNodeId,
    sourceTaskId: 'task-a',
    sourceTaskGroupVersionId: 'tgv-a-v1',
    actionKind: 'explore',
    attempt: 1,
  }],
});
assert.equal(decompose.runNodeId, 'run-node-tgv-a-v1-task-a-decompose-a1');
assert.equal(decompose.attempt, 1);
assert.equal(decompose.predecessorRunNodeId, null);

const retry = allocateRunNodeIdentity({
  taskId: 'task-a',
  taskGroupVersionId: 'tgv-a-v1',
  actionKind: 'execute',
  existingNodes: [
    {
      id: 'run-node-task-a',
      sourceTaskId: 'task-a',
      sourceTaskGroupVersionId: 'tgv-a-v1',
      actionKind: 'execute',
      attempt: 1,
    },
  ],
});
assert.equal(retry.runNodeId, 'run-node-tgv-a-v1-task-a-execute-a2');
assert.equal(retry.attempt, 2);
assert.equal(retry.predecessorRunNodeId, 'run-node-task-a');

const sameIdNewVersion = allocateRunNodeIdentity({
  taskId: 'task-a',
  taskGroupVersionId: 'tgv-a-v2',
  actionKind: 'execute',
  existingNodes: [{
    id: 'run-node-task-a',
    sourceTaskId: 'task-a',
    sourceTaskGroupVersionId: 'tgv-a-v1',
    actionKind: 'execute',
    attempt: 1,
  }],
});
assert.equal(
  sameIdNewVersion.runNodeId,
  'run-node-tgv-a-v2-task-a-execute-a1',
);
console.log('OK run node action/attempt identity');
```

- [ ] **Step 2: Run the test and observe RED**

Run:

```bash
node cli/scripts/run-node-action-attempt-identity.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement identity allocation**

Create `cli/lib-run-identity.js`:

```js
function safePart(value) {
  return String(value || 'unknown')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function inferredActionKind(node) {
  if (node.actionKind) return node.actionKind;
  return {
    implementation: 'execute',
    decomposition: 'decompose',
    exploration: 'explore',
    prototype: 'prototype',
    loopback: 'loopback',
    review: 'review',
    delegate: 'delegate',
  }[node.type] || node.type || 'unknown';
}

export function allocateRunNodeIdentity({
  taskId,
  taskGroupVersionId,
  actionKind,
  existingNodes = [],
} = {}) {
  if (!taskId || !taskGroupVersionId || !actionKind) {
    throw new Error('taskId, taskGroupVersionId, and actionKind are required');
  }
  const sameTask = existingNodes.filter((node) => (
    node?.sourceTaskId === taskId
    && node?.sourceTaskGroupVersionId === taskGroupVersionId
  ));
  const sameAction = sameTask
    .filter((node) => inferredActionKind(node) === actionKind)
    .sort((a, b) => Number(a.attempt || 1) - Number(b.attempt || 1));
  const attempt = sameAction.length === 0
    ? 1
    : Math.max(...sameAction.map((node) => Number(node.attempt || 1))) + 1;
  const base = `run-node-${safePart(taskId)}`;
  const runNodeId = !existingNodes.some((node) => node?.id === base)
    ? base
    : `run-node-${safePart(taskGroupVersionId)}-${safePart(taskId)}-${safePart(actionKind)}-a${attempt}`;
  if (existingNodes.some((node) => node?.id === runNodeId)) {
    throw new Error(`Run node identity collision: ${runNodeId}`);
  }
  return {
    runNodeId,
    actionKind,
    attempt,
    predecessorRunNodeId: sameAction.at(-1)?.id || null,
  };
}
```

- [ ] **Step 4: Persist immutable identity fields**

Extend `ensureRunNodeFile()` to write:

```js
nodeFm.actionKind = actionKind;
nodeFm.attempt = attempt;
if (predecessorRunNodeId) nodeFm.predecessorRunNodeId = predecessorRunNodeId;
```

If the file exists, parse it and reject any mismatch before updating status:

```js
const current = parseMarkdownFile(runNodePath);
for (const [field, expected] of Object.entries({
  runId,
  sourceTaskId,
  sourceTaskGroupVersionId,
  actionKind,
  attempt,
})) {
  if (expected != null && current[field] !== expected) {
    throw new Error(`Immutable run-node identity mismatch for ${runNodeId}: ${field}`);
  }
}
```

Add `parseMarkdownFile` to the state-writer test I/O adapter where it is not already present.

- [ ] **Step 5: Replace `runNodeIdForTask()` with an action-aware wrapper**

In `lib-runner.js`, load existing node frontmatter and call the pure allocator:

```js
function runNodeIdentityForTask(runDir, task, actionKind) {
  const nodesDir = join(runDir, 'nodes');
  const existingNodes = existsSync(nodesDir)
    ? readdirSync(nodesDir)
        .filter((name) => name.endsWith('.md') && !name.startsWith('eow-'))
        .map((name) => parseMarkdownFile(join(nodesDir, name)))
    : [];
  return allocateRunNodeIdentity({
    taskId: task.id,
    taskGroupVersionId: task.taskGroupVersionId,
    actionKind,
    existingNodes,
  });
}
```

At execute, decompose, explore, and prototype call sites, destructure the returned identity and pass all fields to `ensureRunNode()`. Use action kinds `execute`, `decompose`, `explore`, and `prototype` exactly. Review node IDs are already unique because they include the reviewed attempt ID; persist `actionKind: 'review'` and the reviewed attempt number on those nodes as well. Existing delegate and loopback IDs remain their own non-task identity schemes.

Update the runner facade so those fields reach the state writer:

```js
function ensureRunNode({
  runDir,
  runId,
  runNodeId,
  type,
  title,
  sourceTaskId,
  sourceTaskGroupVersionId,
  status = 'active',
  kindLabel,
  actionKind,
  attempt,
  predecessorRunNodeId = null,
}) {
  return ensureRunNodeViaStateWriter({
    runDir,
    runId,
    runNodeId,
    type,
    title,
    sourceTaskId,
    sourceTaskGroupVersionId,
    status,
    kindLabel,
    actionKind,
    attempt,
    predecessorRunNodeId,
  }, stateWriterIo());
}
```

- [ ] **Step 6: Preserve execute retry workspace state**

Before creating a new execute workspace, copy the predecessor workspace once:

```js
const artifactWorkspacePath = join(runDir, 'artifacts', runNodeId, 'workspace');
if (predecessorRunNodeId) {
  const predecessorWorkspace = join(runDir, 'artifacts', predecessorRunNodeId, 'workspace');
  if (existsSync(predecessorWorkspace) && !existsSync(artifactWorkspacePath)) {
    cpSync(predecessorWorkspace, artifactWorkspacePath, { recursive: true });
  }
}
ensureDir(artifactWorkspacePath);
```

Import `cpSync`. The new attempt gets its own evidence directory while retaining the work product it is supposed to repair.

- [ ] **Step 7: Assert action separation in the exploration regression**

In variant B, retain the first result and snapshot its node/EoW before running
the second action:

```js
const step1 = runTaskOps(workDir, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
});
const exploreAction = step1.actions[0];
const nodesDir = join(workDir, 'runs', step1.runId, 'nodes');
const exploreNodePath = join(nodesDir, `${exploreAction.runNodeId}.md`);
const exploreEowPath = join(nodesDir, `eow-${exploreAction.runNodeId}.md`);
const exploreNodeBefore = readFileSync(exploreNodePath);
const exploreEowBefore = readFileSync(exploreEowPath);
```

Replace the original unassigned first call with that block. After the second
action, add:

```js
const decomposeAction = step2Actions[0];
assert.notEqual(exploreAction.runNodeId, decomposeAction.runNodeId);
const exploreNode = parseMarkdownFile(exploreNodePath);
const decomposeNode = parseMarkdownFile(join(nodesDir, `${decomposeAction.runNodeId}.md`));
assert.deepEqual(
  [exploreNode.actionKind, exploreNode.attempt, decomposeNode.actionKind, decomposeNode.attempt],
  ['explore', 1, 'decompose', 1],
);
assert.ok(existsSync(exploreEowPath));
assert.ok(existsSync(join(nodesDir, `eow-${decomposeAction.runNodeId}.md`)));
assert.equal(parseMarkdownFile(taskPath(workDir)).runRefs.length, 2);
assert.deepEqual(readFileSync(exploreNodePath), exploreNodeBefore);
assert.deepEqual(readFileSync(exploreEowPath), exploreEowBefore);
```

- [ ] **Step 8: Assert retry/review separation**

Extend the passing-retry case in `verify-retries.mjs`:

```js
const executeActions = res.actions.filter((action) => action.kind === 'execute');
assert.ok(executeActions.length >= 2);
assert.equal(new Set(executeActions.map((action) => action.runNodeId)).size, executeActions.length);
const nodesDir = join(w, 'runs', res.runId, 'nodes');
const executeNodes = executeActions.map((action) => parseMarkdownFile(join(nodesDir, `${action.runNodeId}.md`)));
assert.deepEqual(executeNodes.map((node) => node.attempt), [1, 2]);
const reviewNodes = executeActions.map((action) => parseMarkdownFile(join(nodesDir, `review-${action.runNodeId}.md`)));
assert.notEqual(reviewNodes[0].id, reviewNodes[1].id);
assert.equal(reviewNodes[0].reviewReport.decision, 'rejected');
assert.equal(reviewNodes[1].reviewReport.decision, 'approved');
```

- [ ] **Step 9: Register and run focused tests**

Add `test:run-node-action-attempt-identity`, append it to default `test`, and add the module/script to `files`.

Run:

```bash
npm --workspace cli run test:run-node-action-attempt-identity
npm --workspace cli run test:state-writer-run-graph
node cli/scripts/exploration-nonclosing.mjs
node cli/scripts/verify-retries.mjs
```

Expected: all exit 0 and the old node/EoW byte snapshots remain unchanged.

- [ ] **Step 10: Commit**

```bash
git add cli/lib-run-identity.js cli/lib-runner.js cli/lib-state-writer.js \
  cli/scripts/run-node-action-attempt-identity.mjs \
  cli/scripts/exploration-nonclosing.mjs cli/scripts/verify-retries.mjs \
  cli/scripts/state-writer-run-graph.mjs cli/package.json
git commit -m "fix: isolate run action attempts"
```

---

### Task 4: Separate Supporting and Claim-Bearing Run Closures

**Files:**
- Create: `cli/lib-artifact-contract.js`
- Create: `cli/lib-run-closure.js`
- Create: `cli/scripts/dynamic-closure-liveness.mjs`
- Modify: `cli/lib-state-writer.js:123-164`
- Modify: `cli/lib-runner.js:2891-2906,2955-2965,3104,3127-3265,3386-3401,3521-3525,4718-4719,5070-5079,5152-5155`
- Modify: `cli/lib-taskops.js:1111-1233,1945-1990`
- Modify: `cli/lib-audit.js:417-503`
- Modify: `cli/scripts/closure-summary-policy.mjs`
- Modify: `cli/scripts/eow-resolver-backlink.mjs`
- Modify: `cli/scripts/navigation-approval-parity.mjs`
- Modify: `cli/scripts/policy-approval-evidence.mjs`
- Modify: `cli/package.json`
- Test: `cli/scripts/dynamic-closure-liveness.mjs`

**Interfaces:**
- Consumes: action identity from Task 3 and selected-version IDs from `parseProject()`.
- Produces: explicit EoW `closureRole`, strict selected supporting validation, claim-only approval counts, context-aware review evidence.

- [ ] **Step 1: Write artifact inspection RED tests**

At the top of `dynamic-closure-liveness.mjs`, create regular, empty, directory, and invalid UTF-8 cases:

```js
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectNonEmptyUtf8File } from '../lib-artifact-contract.js';

const artifactRoot = mkdtempSync(join(tmpdir(), 'taskops-artifact-contract-'));
const valid = join(artifactRoot, 'valid.md');
const empty = join(artifactRoot, 'empty.md');
const invalid = join(artifactRoot, 'invalid.md');
const directory = join(artifactRoot, 'directory.md');
writeFileSync(valid, '# Evidence\n', 'utf8');
writeFileSync(empty, ' \n\t', 'utf8');
writeFileSync(invalid, Buffer.from([0xff, 0xfe, 0xfd]));
mkdirSync(directory);
assert.equal(inspectNonEmptyUtf8File(valid, { label: 'evidence' }).ok, true);
assert.match(inspectNonEmptyUtf8File(empty, { label: 'evidence' }).message, /empty/);
assert.match(inspectNonEmptyUtf8File(invalid, { label: 'evidence' }).message, /UTF-8/);
assert.match(inspectNonEmptyUtf8File(directory, { label: 'evidence' }).message, /regular file/);
```

- [ ] **Step 2: Write dynamic positive, unapproved, and invalid-support RED assertions**

Build the positive fixture with this exact sequence:

```js
function writeMd(path, fm, body = `# ${fm.id}\n`) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fmBlock(fm) + body, 'utf8');
}

function seedDynamicWork(tempRoot, id) {
  const workDir = join(tempRoot, id);
  const versionDir = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1');
  const now = '2026-07-25T00:00:00.000Z';
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id,
    title: id,
    objective: 'Complete one bounded verified result after learning and decomposition.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'task-groups', 'tg-root', 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Learn, decompose, and complete the bounded result.',
    activeVersionId: 'tgv-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(versionDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    version: 'v1',
    summary: 'Root task needs learning.',
    selected: true,
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'snapshots', 'snapshot-root-v1.md'), {
    taskOpsVersion: 'v1',
    entityType: 'versionSnapshot',
    id: 'snapshot-root-v1',
    rootTaskGroupId: 'tg-root',
    createdAt: now,
    label: 'Root',
    status: 'active',
    selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }],
  });
  writeMd(join(versionDir, 'tasks', 'root.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'root',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Deliver the bounded result',
    objective: 'Deliver one bounded result.',
    responsibility: 'Own learning, decomposition, and delivery.',
    completionCriteria: 'The selected child passes its runner check.',
    order: 1,
    createdAt: now,
    status: 'pending',
    runReadiness: 'needs_exploration',
    understandingLevel: 'partial',
    uncertaintyState: 'unknown_unknown',
    confidenceScore: 0.2,
    knownList: [],
    unknowns: ['Which bounded child should carry the result?'],
    nextLearningGoal: 'Identify a bounded child.',
  });
  return workDir;
}

function makeGeneratedChildRunnable(workDir, decomposeAction, { policyApproved = true } = {}) {
  const version = parseProject(workDir).versions.get(decomposeAction.versionId);
  assert.ok(version);
  assert.equal(version.tasks.length, 1);
  const child = version.tasks[0];
  writeMd(child.path, {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: child.id,
    taskGroupId: version.taskGroupId,
    taskGroupVersionId: version.id,
    title: 'Produce the checked child result',
    objective: 'Produce the bounded child result.',
    responsibility: 'Own the bounded child result.',
    completionCriteria: 'The runner check exits successfully.',
    order: 1,
    createdAt: child.createdAt,
    status: 'pending',
    runReadiness: 'runnable',
    understandingLevel: 'known',
    uncertaintyState: 'known',
    confidenceScore: 1,
    knownList: [{ id: 'k-check', claim: 'The check is deterministic.', verificationStatus: 'verified' }],
    acceptance: policyApproved
      ? {
          mode: 'runner-managed',
          expectedOutcome: 'A bounded child result.',
          requiredChecks: [{ id: 'check-result', command: 'exit 0' }],
        }
      : {
          mode: 'informational',
          expectedOutcome: 'A bounded child result.',
        },
  });
}

const workDir = seedDynamicWork(tempRoot, 'verified-dynamic');
const exploreRun = runTaskOps(workDir, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
});
const decomposeRun = runTaskOps(workDir, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
});
const decomposeAction = decomposeRun.actions[0];
makeGeneratedChildRunnable(workDir, decomposeAction);
const executeRun = runTaskOps(workDir, {
  executor: 'dry-run',
  maxSteps: 2,
  maxStepsExplicit: true,
  verifyChecks: true,
});
const result = {
  ...executeRun,
  actions: [...exploreRun.actions, ...decomposeRun.actions, ...executeRun.actions],
};
```

Add these assertions:

```js
const parsed = parseProject(workDir);
const audit = auditParsedWork(parsed);
const next = computeNextAction(workDir);
const rootActions = result.actions.map((action) => action.kind);
assert.deepEqual(rootActions.slice(0, 3), ['explore', 'decompose', 'execute']);
assert.deepEqual(parsed.errors, []);
assert.equal(parsed.closure.supportingRunEowClosureCount, 3);
assert.equal(parsed.closure.validSupportingRunEowClosureCount, 3);
assert.equal(parsed.closure.invalidSupportingRunEowClosureCount, 0);
assert.equal(parsed.closure.claimBearingRunEowClosureCount, 1);
assert.equal(parsed.closure.policyApprovedClaimBearingRunEowClosureCount, 1);
assert.equal(parsed.closure.policyApprovedComplete, true);
assert.equal(result.stopReason, 'all_closed');
assert.equal(next.action, 'done');
assert.equal(audit.claimSafe, true);
assert.equal(audit.assurance.externallySafe, true);

const supportingEows = [...parsed.eowNodes.values()]
  .filter((eow) => eow.graphType === 'run' && eow.closureRole === 'supporting');
assert.deepEqual(
  supportingEows.map((eow) => eow.reason).sort(),
  ['decomposition_recorded', 'exploration_recorded', 'review_recorded'],
);
const claimEow = [...parsed.eowNodes.values()]
  .find((eow) => eow.graphType === 'run' && eow.closureRole === 'claim-bearing');
assert.equal(claimEow.reason, 'approved_result');
```

Build the unapproved fixture with informational acceptance so execution closes
structurally without fabricating a policy review:

```js
const unapprovedDir = seedDynamicWork(tempRoot, 'unapproved-dynamic');
runTaskOps(unapprovedDir, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
});
const unapprovedDecompose = runTaskOps(unapprovedDir, {
  executor: 'dry-run',
  maxSteps: 1,
  maxStepsExplicit: true,
});
makeGeneratedChildRunnable(unapprovedDir, unapprovedDecompose.actions[0], {
  policyApproved: false,
});
runTaskOps(unapprovedDir, {
  executor: 'dry-run',
  maxSteps: 2,
  maxStepsExplicit: true,
});
const unapproved = parseProject(unapprovedDir);
assert.equal(unapproved.closure.structuralComplete, true);
assert.equal(unapproved.closure.claimBearingRunEowClosureCount, 1);
assert.equal(unapproved.closure.policyApprovedClaimBearingRunEowClosureCount, 0);
assert.equal(unapproved.closure.policyApprovedComplete, false);
assert.equal(computeNextAction(unapprovedDir).action, 'graph_closed_unapproved');
assert.equal(auditParsedWork(unapproved).claimSafe, false);
```

Copy the completed positive fixture, delete its exploration artifact, and assert:

```js
const invalidSupportDir = join(tempRoot, 'invalid-support-dynamic');
cpSync(workDir, invalidSupportDir, { recursive: true });
const invalidBefore = parseProject(invalidSupportDir);
const explorationNode = [...invalidBefore.runNodes.values()]
  .find((node) => node.actionKind === 'explore');
assert.ok(explorationNode?.result?.artifactPath);
const copiedArtifactPath = String(explorationNode.result.artifactPath)
  .replace(workDir, invalidSupportDir);
rmSync(copiedArtifactPath);
const copiedNodePath = explorationNode.path.replace(workDir, invalidSupportDir);
writeFileSync(
  copiedNodePath,
  readFileSync(copiedNodePath, 'utf8').replace(
    explorationNode.result.artifactPath,
    copiedArtifactPath,
  ),
  'utf8',
);
const invalidSupport = parseProject(invalidSupportDir);
assert.equal(invalidSupport.closure.invalidSupportingRunEowClosureCount, 1);
assert.ok(invalidSupport.errors.some((error) => /missing exploration artifact/i.test(error)));
assert.equal(auditParsedWork(invalidSupport).claimSafe, false);
assert.notEqual(computeNextAction(invalidSupportDir).stopReason, 'all_closed');
```

- [ ] **Step 3: Run the new regression and observe RED**

Run:

```bash
node cli/scripts/dynamic-closure-liveness.mjs
```

Expected: FAIL because the new modules/metrics do not exist and supporting EoWs remain in the approval denominator.

- [ ] **Step 4: Implement shared artifact inspection**

Create `cli/lib-artifact-contract.js`:

```js
import { readFileSync, statSync } from 'node:fs';

export function inspectNonEmptyUtf8File(filePath, { label = 'artifact' } = {}) {
  const artifactPath = filePath == null ? null : String(filePath);
  if (!artifactPath) {
    return { ok: false, artifactPath, message: `Missing ${label} path.` };
  }
  let stat;
  try {
    stat = statSync(artifactPath);
  } catch {
    return { ok: false, artifactPath, message: `Missing ${label} at ${artifactPath}.` };
  }
  if (!stat.isFile()) {
    return { ok: false, artifactPath, message: `${label} must be a regular file: ${artifactPath}.` };
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(artifactPath));
  } catch {
    return { ok: false, artifactPath, message: `${label} is not valid UTF-8: ${artifactPath}.` };
  }
  if (text.trim().length === 0) {
    return { ok: false, artifactPath, message: `${label} is empty: ${artifactPath}.` };
  }
  return { ok: true, artifactPath, text };
}
```

- [ ] **Step 5: Persist closure roles and reject immutable EoW conflicts**

In `closeRunNodeWithEowFiles()`, require `closureRole` to be `supporting` or `claim-bearing` and write it into `eowFm`.

Update the runner facade to consume and forward the same required value:

```js
function closeRunNodeWithEow({
  runDir,
  runId,
  runNodeId,
  reason,
  finishedAt,
  closureRole,
  approvedReview = null,
}) {
  return closeRunNodeWithEowFiles({
    runDir,
    runId,
    runNodeId,
    reason,
    finishedAt,
    closureRole,
    approvedReview,
  }, stateWriterIo());
}
```

If the EoW already exists, parse it and require equality for:

```js
{
  runId,
  attachedToId: runNodeId,
  reason,
  closureRole,
}
```

Throw `Immutable run EoW mismatch for ${runNodeId}: ${field}` on conflict instead of silently returning.

Pass roles at every runner call:

```js
// explore, decompose, prototype, review, loopback, delegate, retry, partial
closureRole: 'supporting'

// only final result-bearing execute closure
closureRole: 'claim-bearing'
```

The manual `closeTarget()` run-node path writes its EoW directly rather than
through the state writer. Add `closureRole: 'supporting'` there unless the
target is an implementation node closed with one of the two claim reasons.
Manual close reasons remain supporting and cannot bypass review.

Update the direct state-writer calls in `state-writer-run-graph.mjs` and
`eow-resolver-backlink.mjs` to pass `closureRole: 'supporting'`; their
`reason: 'completed'` fixtures are provenance, not objective claims.

Before returning `status: 'retry'`, close the old execute attempt as:

```js
closeRunNodeWithEow({
  runDir,
  runId,
  runNodeId,
  reason: 'attempt_retried',
  closureRole: 'supporting',
  finishedAt,
});
```

Do the same for a partial result with reason `partial_recorded`. Keep truly blocked/failed open attempts blocked rather than fabricating successful closure.

- [ ] **Step 6: Implement closure classification**

Create `cli/lib-run-closure.js` with:

```js
import { createHash } from 'node:crypto';
import { inspectNonEmptyUtf8File } from './lib-artifact-contract.js';

const CLAIM_REASONS = new Set(['approved_result', 'execution_path_closed']);
const POLICY_MODES = new Set(['enforced', 'guarded', 'runner-managed']);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value ?? null;
}

export function canonicalSha256(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}`;
}

function inferredRole(node, eow) {
  return node?.type === 'implementation' && CLAIM_REASONS.has(eow?.reason)
    ? 'claim-bearing'
    : 'supporting';
}

function reviewEvidence(node, eow, runNodes, runEdges) {
  if (inferredRole(node, eow) !== 'claim-bearing') return { valid: false, issues: [] };
  const approvalFields = [
    'approvedByReviewNodeId',
    'approvedReviewMode',
    'approvedReviewReportHash',
    'reviewedAcceptanceHash',
    'reviewedResultHash',
  ];
  const hasAnyApprovalStamp = approvalFields.some((field) => eow?.[field]);
  if (eow?.reason !== 'approved_result' && !hasAnyApprovalStamp) {
    return { valid: false, issues: [] };
  }
  const review = runNodes.get(`${eow.runId}:${eow.approvedByReviewNodeId}`);
  const issues = [];
  if (!review || review.type !== 'review' || review.status !== 'done') {
    issues.push('approved review node not found or not done');
    return { valid: false, issues };
  }
  if (review.reviewsRunNodeId !== node.id || review.reviewedRunId !== node.runId) {
    issues.push('review target does not match claim run node');
  }
  const edgeFound = [...runEdges.values()].some((edge) => (
    edge.runId === node.runId
    && edge.fromRunNodeId === node.id
    && edge.toRunNodeId === review.id
    && edge.edgeType === 'reviews'
  ));
  if (!edgeFound) issues.push('review edge does not match claim run node');
  const report = review.reviewReport;
  if (report?.decision !== 'approved') issues.push('review decision is not approved');
  if (!POLICY_MODES.has(report?.mode)) issues.push('review mode is not policy-approving');
  if (eow.approvedReviewMode !== report?.mode) issues.push('EoW review mode mismatch');
  if (review.reviewReportHash !== canonicalSha256(report)) issues.push('review report hash mismatch');
  if (eow.approvedReviewReportHash !== review.reviewReportHash) issues.push('EoW review hash mismatch');
  if (eow.reviewedAcceptanceHash !== report?.reviewedAcceptanceHash) issues.push('acceptance hash mismatch');
  if (eow.reviewedResultHash !== report?.reviewedResultHash) issues.push('result hash mismatch');
  return { valid: issues.length === 0, issues };
}

export function classifyRunClosure({
  node,
  eow,
  runNodes,
  runEdges,
  versions,
  selectedVersionIds,
} = {}) {
  const expectedRole = inferredRole(node, eow);
  const role = eow?.closureRole || expectedRole;
  const selected = !node?.sourceTaskGroupVersionId
    || selectedVersionIds.size === 0
    || selectedVersionIds.has(node.sourceTaskGroupVersionId);
  const issues = [];
  if (!['supporting', 'claim-bearing'].includes(role)) issues.push(`invalid closureRole '${role}'`);
  if (eow?.closureRole && role !== expectedRole) issues.push(`closureRole spoof: expected ${expectedRole}`);
  if (role === 'supporting' && CLAIM_REASONS.has(eow?.reason)) {
    issues.push(`supporting closure cannot use claim reason '${eow.reason}'`);
  }

  if (selected && role === 'supporting' && node?.actionKind) {
    if (node.actionKind === 'explore') {
      const inspected = inspectNonEmptyUtf8File(node.result?.artifactPath, { label: 'exploration artifact' });
      if (!inspected.ok) issues.push(inspected.message);
    }
    if (node.actionKind === 'prototype') {
      const inspected = inspectNonEmptyUtf8File(node.result?.artifactPath, { label: 'prototype options artifact' });
      if (!inspected.ok) issues.push(inspected.message);
    }
    if (node.actionKind === 'decompose') {
      const backlink = [...versions.values()].some((version) => (
        version.decomposedByRunId === node.runId
        && version.decomposedByRunNodeId === node.id
      ));
      if (!backlink) issues.push('decomposition backlink missing for supporting closure');
    }
    if (node.actionKind === 'review') {
      const reviewedNode = runNodes.get(`${node.runId}:${node.reviewsRunNodeId}`);
      const reviewEdge = [...runEdges.values()].some((edge) => (
        edge.runId === node.runId
        && edge.fromRunNodeId === node.reviewsRunNodeId
        && edge.toRunNodeId === node.id
        && edge.edgeType === 'reviews'
      ));
      if (!reviewedNode) issues.push('reviewed run node missing for supporting closure');
      if (!node.reviewReport || typeof node.reviewReport !== 'object') {
        issues.push('review report missing for supporting closure');
      }
      if (!reviewEdge) issues.push('review edge missing for supporting closure');
    }
  }

  const review = reviewEvidence(node, eow, runNodes, runEdges);
  const allIssues = issues.concat(review.issues);
  return {
    role,
    selected,
    schemaValid: allIssues.length === 0,
    supportValid: role !== 'supporting' || issues.length === 0,
    reviewEvidenceValid: review.valid,
    policyApproved: role === 'claim-bearing' && review.valid,
    issues: allIssues,
  };
}
```

Legacy EoWs without `closureRole` are inferred. Strict artifact/backlink validation activates for nodes with Task 3's `actionKind`, so historical fixtures remain readable while every new action is fail-closed.

Import `canonicalSha256` into `lib-runner.js`, remove its duplicate
`stableForHash()`/`sha256Of()` implementation, and replace the runner's
`sha256Of(value)` calls with `canonicalSha256(value)`. The writer and validator
must use one hash algorithm.

- [ ] **Step 7: Recompute selected-lineage closure**

In `parseProject()`:

1. Build `selectedVersionIdSet` before run closure calculation.
2. Count waiting/blocked run nodes only when their source version is selected; nodes without a source version remain in scope.
3. Treat a run node as graph-terminal only when it has no outgoing edge to another `runNode`; a `closes_with` edge to an EoW does not remove it from terminal coverage.
4. Classify each selected run EoW with `classifyRunClosure()`.
5. Add every classification issue to `errors` with the EoW path.
6. Keep `runEowClosureCount` as total telemetry.
7. Add these fields:

```js
supportingRunEowClosureCount
validSupportingRunEowClosureCount
invalidSupportingRunEowClosureCount
claimBearingRunEowClosureCount
policyApprovedClaimBearingRunEowClosureCount
```

Use these predicates:

```js
const structuralComplete = terminalTaskCount > 0
  && terminalTaskCount === terminalTaskEowCount
  && runTerminalNodeCount === runTerminalEowCount
  && invalidSupportingRunEowClosureCount === 0
  && partialCount === 0
  && waitingDelegationCount === 0
  && openBlockerCount === 0;

const policyApprovedComplete = structuralComplete
  && terminalTaskCount === policyApprovedTerminalTaskEowCount
  && claimBearingRunEowClosureCount === policyApprovedClaimBearingRunEowClosureCount;
```

Update `summarizeProject()` to display claim closures with the new denominator and supporting validity as `valid/total`.

- [ ] **Step 8: Make task-EoW approval depend on a matching approved claim**

Replace presence-only task EoW approval counting. For a normal `approved_result` selected terminal task, an EoW is approved only when:

- one of the task's `runRefs` resolves to a selected `implementation` node;
- that node has a `claim-bearing` run EoW;
- `classifyRunClosure(...).policyApproved === true`;
- the task EoW and run EoW share all five approval fields.

Use this exact shared-field list:

```js
const APPROVAL_FIELDS = [
  'approvedByReviewNodeId',
  'approvedReviewMode',
  'approvedReviewReportHash',
  'reviewedAcceptanceHash',
  'reviewedResultHash',
];
```

Preserve restart carry-forward without trusting copied strings blindly. A
`preserved_upstream_after_restart` task EoW is approved only when
`preservedFromVersionId` and `preservedFromEowId` resolve to the original task
EoW, all five approval fields match, and that original EoW resolves to a valid
approved claim/review in its historical run. This keeps verified upstream work
live across restart while preventing a newly fabricated carry-forward stamp.

Change `attachApprovedReviewToExistingEows()` and manual task review selection to update/select only claim-bearing implementation EoWs. Never stamp an exploration, decomposition, prototype, loopback, or retry closure with `approved_result`.

- [ ] **Step 9: Update negative-path audit/navigation contracts**

In `navigation-approval-parity.mjs`, change the unresolved-partial case to:

```js
assert.equal(parsed.closure.structuralComplete, false);
assert.equal(parsed.closure.policyApprovedComplete, false);
assert.equal(auditParsedWork(parsed).claimSafe, false);
assert.equal(computeNextAction(w).action, 'no_runnable');
assert.equal(explainWork(w).complete, false);
```

In `policy-approval-evidence.mjs`, add tamper cases:

```js
assert.equal(parseProject(missingReviewDir).closure.policyApprovedComplete, false);
assert.equal(parseProject(wrongTargetDir).closure.policyApprovedComplete, false);
assert.equal(parseProject(reportHashMismatchDir).closure.policyApprovedComplete, false);
assert.equal(parseProject(resultHashMismatchDir).closure.policyApprovedComplete, false);
```

Update `closure-summary-policy.mjs` fixtures to create a real review node, `reviews` edge, report hash, and matching task/run EoW stamps for the positive case.

- [ ] **Step 10: Run closure regressions**

Register `test:dynamic-closure-liveness`, add the new modules/test to `files` and the default chain, then run:

```bash
npm --workspace cli run test:dynamic-closure-liveness
npm --workspace cli run test:closure-summary-policy
npm --workspace cli run test:policy-approval-evidence
node cli/scripts/navigation-approval-parity.mjs
node cli/scripts/audit-gates.mjs
node cli/scripts/exploration-nonclosing.mjs
node cli/scripts/verify-retries.mjs
```

Expected: the positive dynamic fixture reaches `all_closed` and `claimSafe=true`; each tamper/unapproved/invalid-support fixture remains unsafe.

- [ ] **Step 11: Commit**

```bash
git add cli/lib-artifact-contract.js cli/lib-run-closure.js \
  cli/lib-state-writer.js cli/lib-runner.js cli/lib-taskops.js cli/lib-audit.js \
  cli/scripts/dynamic-closure-liveness.mjs cli/scripts/closure-summary-policy.mjs \
  cli/scripts/eow-resolver-backlink.mjs \
  cli/scripts/navigation-approval-parity.mjs cli/scripts/policy-approval-evidence.mjs \
  cli/package.json
git commit -m "fix: distinguish support and claim closure"
```

---

### Task 5: Repair the Prototype Runtime and Human-Resolution State Machine

**Files:**
- Create: `cli/scripts/prototype-state-machine.mjs`
- Modify: `cli/lib-runtime-adapters.js:289-310`
- Modify: `cli/lib-runner.js:1859-1912,1948-1952,2725,2788,3981,4909,5098-5159`
- Modify: `cli/scripts/runtime-adapters.mjs`
- Modify: `cli/scripts/unknown-knowns.mjs`
- Modify: `cli/package.json`
- Test: `cli/scripts/prototype-state-machine.mjs`

**Interfaces:**
- Consumes: `inspectNonEmptyUtf8File()` from Task 4 and supporting closure role.
- Produces: `normalizeExecutorSpec(value) => { adapterName, variant }`; prototype success is `status: waiting`, `resolverKind: human`.

- [ ] **Step 1: Write alias and artifact RED assertions**

Create a fake executable in `prototype-state-machine.mjs` that handles `--version`, then writes based on `TASKOPS_PROTOTYPE_FIXTURE_MODE`:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fmBlock, parseMarkdownFile, parseProject } from '../lib-taskops.js';
import { pickNextAction, runTaskOps } from '../lib-runner.js';
import { normalizeExecutorSpec } from '../lib-runtime-adapters.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-prototype-state-'));
const fakeOpenClawSource = `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('--version')) {
  console.log('fake-openclaw 1.0');
  process.exit(0);
}
const mode = process.env.TASKOPS_PROTOTYPE_FIXTURE_MODE || 'valid';
const target = join(process.cwd(), 'options.md');
if (mode === 'valid') writeFileSync(target, '# Options\\n\\n- Option A\\n- Option B\\n', 'utf8');
if (mode === 'empty') writeFileSync(target, ' \\n', 'utf8');
if (mode === 'invalid-utf8') writeFileSync(target, Buffer.from([0xff, 0xfe]));
if (mode === 'directory') mkdirSync(target, { recursive: true });
console.log('prototype fixture complete');
`;
const fakeOpenClawPath = join(tempRoot, 'fake-openclaw.mjs');
writeFileSync(fakeOpenClawPath, fakeOpenClawSource, 'utf8');
chmodSync(fakeOpenClawPath, 0o755);
```

Add:

```js
assert.deepEqual(normalizeExecutorSpec('openclaw-agent'), {
  adapterName: 'openclaw-cli',
  variant: null,
});
assert.deepEqual(normalizeExecutorSpec('codex-cli:high'), {
  adapterName: 'codex-cli',
  variant: 'high',
});
```

Seed each prototype case with this exact helper:

```js
function writeMd(path, fm) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fmBlock(fm) + `# ${fm.id}\n`, 'utf8');
}

function seedPrototypeWork(tempRoot, id) {
  const workDir = join(tempRoot, id);
  const now = '2026-07-25T00:00:00.000Z';
  const versionDir = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1');
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id,
    title: id,
    objective: 'Choose a prototype before bounded execution.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'task-groups', 'tg-root', 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Choose and execute one option.',
    activeVersionId: 'tgv-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(versionDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    version: 'v1',
    summary: 'Unknown-known prototype fixture.',
    selected: true,
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'snapshots', 'snapshot-root-v1.md'), {
    taskOpsVersion: 'v1',
    entityType: 'versionSnapshot',
    id: 'snapshot-root-v1',
    rootTaskGroupId: 'tg-root',
    createdAt: now,
    label: 'Root',
    status: 'active',
    selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }],
  });
  const taskPath = join(versionDir, 'tasks', 'prototype.md');
  writeMd(taskPath, {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'prototype',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Choose the dashboard form',
    objective: 'Deliver the selected dashboard form.',
    responsibility: 'Own option generation and the selected result.',
    completionCriteria: 'The selected option passes its deterministic check.',
    order: 1,
    createdAt: now,
    status: 'pending',
    runReadiness: 'runnable',
    understandingLevel: 'known',
    uncertaintyState: 'unknown_known',
    confidenceScore: 0.5,
    knownList: [{
      id: 'k-local',
      claim: 'A local unverified assumption.',
      verificationStatus: 'unverified',
    }],
    unknownKnowns: ['visual form', 'metric density'],
    inheritedFrom: {
      schemaVersion: 'v1',
      inheritedKnownRefs: [{
        id: 'ik-1',
        sourceTaskId: 'parent',
        sourceTaskGroupVersionId: 'tgv-parent-v1',
        sourceKnownId: 'k-parent',
        trust: 'inherited_unverified',
      }],
    },
    expectedPlan: {
      expectedDepth: 0,
      expectedBreadth: 1,
      rationale: 'The post-selection result is atomic.',
    },
    acceptance: {
      mode: 'runner-managed',
      expectedOutcome: 'The selected dashboard form is delivered.',
      requiredChecks: [{ id: 'check-dashboard', command: 'exit 0' }],
    },
  });
  return { workDir, taskPath, versionDir };
}

function readEvents(workDir, runId) {
  return readFileSync(join(workDir, 'runs', runId, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
```

For the valid prototype:

```js
process.env.TASKOPS_OPENCLAW_BIN = fakeOpenClawPath;
process.env.TASKOPS_PROTOTYPE_FIXTURE_MODE = 'valid';
const validCase = seedPrototypeWork(tempRoot, 'prototype-valid');
const workDir = validCase.workDir;
const validRun = runTaskOps(validCase.workDir, {
  executor: 'openclaw-agent',
  maxSteps: 1,
  maxStepsExplicit: true,
});
const action = validRun.actions[0];
const taskPath = validCase.taskPath;
const taskEowPath = join(validCase.versionDir, 'eow', 'eow-prototype.md');
const runEowPath = join(
  validCase.workDir,
  'runs',
  validRun.runId,
  'nodes',
  `eow-${action.runNodeId}.md`,
);
assert.equal(action.kind, 'prototype');
assert.equal(action.status, 'completed');
const task = parseMarkdownFile(taskPath);
assert.equal(task.status, 'waiting');
assert.equal(task.resolverKind, 'human');
assert.equal(existsSync(taskEowPath), false);
const prototypeEow = parseMarkdownFile(runEowPath);
assert.equal(prototypeEow.reason, 'prototype_recorded');
assert.equal(prototypeEow.closureRole, 'supporting');
assert.equal(pickNextAction(parseProject(workDir)).reason, 'delegation_pending');
```

For `missing`, `empty`, `invalid-utf8`, and `directory` modes, run:

```js
for (const mode of ['missing', 'empty', 'invalid-utf8', 'directory']) {
  process.env.TASKOPS_PROTOTYPE_FIXTURE_MODE = mode;
  const failedCase = seedPrototypeWork(tempRoot, `prototype-${mode}`);
  const failedRun = runTaskOps(failedCase.workDir, {
    executor: 'openclaw-agent',
    maxSteps: 1,
    maxStepsExplicit: true,
  });
  const failedAction = failedRun.actions[0];
  const failedTaskPath = failedCase.taskPath;
  const failedRunEowPath = join(
    failedCase.workDir,
    'runs',
    failedRun.runId,
    'nodes',
    `eow-${failedAction.runNodeId}.md`,
  );
assert.equal(failedAction.status, 'failed');
assert.equal(parseMarkdownFile(failedTaskPath).status, 'blocked');
assert.equal(parseMarkdownFile(failedTaskPath).resolverKind, undefined);
assert.equal(existsSync(failedRunEowPath), false);
  assert.equal(
    readEvents(failedCase.workDir, failedRun.runId)
      .some((event) => event.type === 'prototype_failed'),
    true,
  );
}
```

- [ ] **Step 2: Run the prototype test and observe RED**

Run:

```bash
node cli/scripts/prototype-state-machine.mjs
```

Expected: FAIL because the alias is rejected, dry-run lacks `options.md`, and successful tasks are not `waiting`.

- [ ] **Step 3: Centralize executor normalization**

In `lib-runtime-adapters.js`:

```js
const EXECUTOR_ALIASES = Object.freeze({
  'openclaw-agent': 'openclaw-cli',
});

export function normalizeExecutorSpec(value) {
  const { base, variant } = parseExecutorSpec(value);
  const adapterName = normalizeRuntimeAdapter(EXECUTOR_ALIASES[base] || base);
  return { adapterName, variant };
}

export function runtimeAdapterForExecutor(executor) {
  const { adapterName } = normalizeExecutorSpec(executor);
  return ADAPTERS[adapterName];
}
```

In `invokeRuntimeAdapter()`, get both adapter and variant from `normalizeExecutorSpec()` once. Remove all local `executor === 'openclaw-agent' ? 'openclaw-cli' : executor` branches from the runner and use the original executor spec.

Make `runtimeIdentity()` compare `normalizeExecutorSpec(value).adapterName`, so aliases of one runtime cannot pass the independent-resolver gate.

- [ ] **Step 4: Require a valid options artifact on every success path**

Make dry-run write deterministic options:

```js
function performDryRunPrototype({ runDir, runNodeId, task }) {
  const workspace = join(runDir, 'artifacts', runNodeId, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const artifactPath = join(workspace, 'options.md');
  writeFileSync(
    artifactPath,
    `# Prototype options for ${task.id}\n\n- Option A: smallest bounded approach\n- Option B: alternate bounded approach\n`,
    'utf8',
  );
  return inspectNonEmptyUtf8File(artifactPath, { label: 'prototype options artifact' });
}
```

After any external runtime returns success:

```js
const inspected = inspectNonEmptyUtf8File(join(workspace, 'options.md'), {
  label: 'prototype options artifact',
});
if (!inspected.ok) return inspected;
return {
  ok: true,
  artifactPath: inspected.artifactPath,
  message: invocation.message || null,
};
```

Route invalid artifacts through the existing `prototype_failed` branch. Do not write a success EoW or append the external-resolution template.

- [ ] **Step 5: Make external resolution outrank readiness**

Add:

```js
function externalResolutionStateForTask(task) {
  const resolverKind = task?.resolverKind;
  if (resolverKind !== 'human' && resolverKind !== 'ai') {
    return { resolverKind, status: 'none' };
  }
  let body = '';
  try {
    body = task.path ? readBody(task.path) : '';
  } catch {
    body = '';
  }
  return {
    resolverKind,
    status: deriveExternalResolutionStatus({ resolverKind, body }),
  };
}
```

Rewrite `taskPause()`:

```js
function taskPause(task) {
  const external = externalResolutionStateForTask(task);
  if (external.status === 'waiting' || external.status === 'invalid') {
    return {
      reason: STOP_REASONS.DELEGATION_PENDING,
      detail: `Task ${task.id} awaits a valid external ${external.resolverKind} decision.`,
    };
  }
  if (task.status === 'waiting' && external.status !== 'resolved') {
    return {
      reason: STOP_REASONS.WAITING,
      detail: `Task ${task.id} is waiting; resolve before continuing.`,
    };
  }
  return null;
}
```

Handle `DELEGATION_PENDING` from `taskPause()` in both targeted and untargeted selection before classification. A resolved external decision bypasses generic waiting and returns to ordinary readiness.

At the start of `executeRunnableTask()`, after selection has proven the decision resolved:

```js
if (task.status === 'waiting' && externalResolutionStateForTask(task).status === 'resolved') {
  updateMarkdownFrontmatter(task.path, (fm) => {
    fm.status = 'active';
    return fm;
  });
}
```

- [ ] **Step 6: Persist literal human wait on prototype success**

Set:

```js
fm.status = 'waiting';
fm.resolverKind = 'human';
fm.runReadinessReason = sanitizeFmScalar(
  'Prototype options recorded; awaiting a human pick to surface the unknown-known before execution.',
);
```

Keep the source task without a task EoW. Close only the prototype run with `closureRole: 'supporting'`.

- [ ] **Step 7: Assert resolved resume and inherited-known precedence**

In the valid fixture, add inherited-known metadata that would ordinarily downgrade readiness. Fill both template fields, then assert:

```js
function fillDecision(path, { decision, basis }) {
  const raw = readFileSync(path, 'utf8');
  writeFileSync(
    path,
    raw
      .replace(
        '<resolver: the concrete, downstream-consumable choice — a value, not prose>',
        decision,
      )
      .replace('<resolver: the grounds for this decision>', basis),
    'utf8',
  );
}

const pending = pickNextAction(parseProject(workDir));
assert.equal(pending.kind, 'stop');
assert.equal(pending.reason, 'delegation_pending');

fillDecision(taskPath, {
  decision: 'Option B',
  basis: 'The owner selected the bounded alternate.',
});
const resumed = pickNextAction(parseProject(workDir));
assert.equal(resumed.kind, 'execute');
runTaskOps(workDir, {
  executor: 'dry-run',
  maxSteps: 1,
  verifyChecks: true,
});
assert.equal(parseMarkdownFile(taskPath).status, 'done');
delete process.env.TASKOPS_OPENCLAW_BIN;
delete process.env.TASKOPS_PROTOTYPE_FIXTURE_MODE;
rmSync(tempRoot, { recursive: true, force: true });
console.log('OK prototype state machine');
```

Update `unknown-knowns.mjs` to assert `task.status === 'waiting'` before the decision and successful execution after it.

- [ ] **Step 8: Run prototype and runtime regressions**

Register the new test in the default chain and `files`, then run:

```bash
npm --workspace cli run test:runtime-adapters
npm --workspace cli run test:prototype-state-machine
npm --workspace cli run test:unknown-knowns
node cli/scripts/external-resolution-gate.mjs
node cli/scripts/delegation-integrity.mjs
node cli/scripts/delegation-ai-resolver.mjs
```

Expected: all exit 0.

- [ ] **Step 9: Commit**

```bash
git add cli/lib-runtime-adapters.js cli/lib-runner.js \
  cli/scripts/prototype-state-machine.mjs cli/scripts/runtime-adapters.mjs \
  cli/scripts/unknown-knowns.mjs cli/package.json
git commit -m "fix: enforce prototype human resolution"
```

---

### Task 6: Drain JSON Output Before Process Termination

**Files:**
- Create: `cli/scripts/json-stdout-lifecycle.mjs`
- Modify: `cli/bin/taskops.js`
- Modify: `cli/package.json`
- Test: `cli/scripts/json-stdout-lifecycle.mjs`

**Interfaces:**
- Consumes: all existing CLI command payloads and exit codes.
- Produces: exported `writeAll(stream, text)`, `writeJson(value, stream)`, and `main(argv) => Promise<number>`.

- [ ] **Step 1: Write the large-output RED fixture**

Start `json-stdout-lifecycle.mjs` with:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { fmBlock } from '../lib-taskops.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'bin', 'taskops.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-json-lifecycle-'));

function writeMd(path, fm) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fmBlock(fm) + `# ${fm.id}\n`, 'utf8');
}

function seedLargeShowWork() {
  const workDir = join(tempRoot, 'large-work');
  const now = '2026-07-25T00:00:00.000Z';
  const versionDir = join(workDir, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1');
  const runRefs = Array.from({ length: 500 }, (_, index) => ({
    runId: 'run-main',
    runNodeId: `run-node-large-${String(index).padStart(3, '0')}`,
    role: 'execution_observation',
  }));
  writeMd(join(workDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'work',
    id: 'large-work',
    title: 'Large JSON work',
    objective: 'Exercise complete machine output.',
    activeRootTaskGroupId: 'tg-root',
    activeSnapshotId: 'snapshot-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'task-groups', 'tg-root', 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroup',
    id: 'tg-root',
    objective: 'Exercise output.',
    activeVersionId: 'tgv-root-v1',
    createdAt: now,
    status: 'active',
  });
  writeMd(join(versionDir, 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'taskGroupVersion',
    id: 'tgv-root-v1',
    taskGroupId: 'tg-root',
    version: 'v1',
    summary: 'Large output fixture.',
    selected: true,
    createdAt: now,
    status: 'active',
  });
  writeMd(join(workDir, 'snapshots', 'snapshot-root-v1.md'), {
    taskOpsVersion: 'v1',
    entityType: 'versionSnapshot',
    id: 'snapshot-root-v1',
    rootTaskGroupId: 'tg-root',
    createdAt: now,
    label: 'Root',
    status: 'active',
    selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }],
  });
  writeMd(join(versionDir, 'tasks', 'large.md'), {
    taskOpsVersion: 'v1',
    entityType: 'task',
    id: 'large',
    taskGroupId: 'tg-root',
    taskGroupVersionId: 'tgv-root-v1',
    title: 'Large task',
    objective: 'Keep 500 observations visible.',
    responsibility: 'Own the output fixture.',
    completionCriteria: 'Every run node is serialized.',
    order: 1,
    createdAt: now,
    status: 'pending',
    runReadiness: 'runnable',
    understandingLevel: 'known',
    runRefs,
  });
  writeMd(join(workDir, 'runs', 'run-main', 'index.md'), {
    taskOpsVersion: 'v1',
    entityType: 'run',
    id: 'run-main',
    workId: 'large-work',
    createdAt: now,
    status: 'active',
  });
  for (let index = 0; index < 500; index += 1) {
    const id = `run-node-large-${String(index).padStart(3, '0')}`;
    writeMd(join(workDir, 'runs', 'run-main', 'nodes', `${id}.md`), {
      taskOpsVersion: 'v1',
      entityType: 'runNode',
      id,
      runId: 'run-main',
      type: 'implementation',
      actionKind: 'execute',
      attempt: index + 1,
      title: `${id}-${'x'.repeat(256)}`,
      sourceTaskId: 'large',
      sourceTaskGroupVersionId: 'tgv-root-v1',
      status: 'active',
      createdAt: now,
    });
  }
  return workDir;
}

function collectChild(child) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    }));
  });
}

const workDir = seedLargeShowWork();
```

Then add:

```js
const direct = spawnSync(process.execPath, [cli, 'show', workDir, '--json'], {
  encoding: null,
  maxBuffer: 16 * 1024 * 1024,
});
assert.equal(direct.status, 0);
assert.ok(direct.stdout.length > 64 * 1024);
assert.equal(direct.stdout.at(-1), 0x0a);
const directJson = JSON.parse(direct.stdout.toString('utf8'));
assert.equal(directJson.runNodes.length, 500);
```

Redirect to a real file descriptor:

```js
const outputPath = join(tempRoot, 'redirected.json');
const fd = openSync(outputPath, 'w');
const redirected = spawnSync(process.execPath, [cli, 'show', workDir, '--json'], {
  stdio: ['ignore', fd, 'pipe'],
});
closeSync(fd);
assert.equal(redirected.status, 0);
assert.deepEqual(readFileSync(outputPath), direct.stdout);
```

Pipe through a pass-through child:

```js
const producer = spawn(process.execPath, [cli, 'show', workDir, '--json'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const consumer = spawn(process.execPath, ['-e', `
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => process.stdout.write(Buffer.concat(chunks)));
`], { stdio: ['pipe', 'pipe', 'pipe'] });
const producerDone = collectChild(producer);
const consumerDone = collectChild(consumer);
producer.stdout.pipe(consumer.stdin);
const [produced, piped] = await Promise.all([producerDone, consumerDone]);
assert.equal(produced.code, 0);
assert.equal(piped.code, 0);
assert.deepEqual(piped.stdout, direct.stdout);
assert.equal(JSON.parse(piped.stdout.toString('utf8')).runNodes.length, 500);
```

Finally:

```js
const cliSource = readFileSync(cli, 'utf8');
assert.equal(cliSource.includes('process.exit('), false);

const { writeJson } = await import('../bin/taskops.js');
const stream = new PassThrough();
const serialized = [];
stream.on('data', (chunk) => serialized.push(chunk));
await writeJson({ count: 500 }, stream);
stream.end();
assert.equal(Buffer.concat(serialized).toString('utf8'), '{\n  "count": 500\n}\n');

const failure = spawnSync(process.execPath, [cli, 'show', join(tempRoot, 'missing'), '--json'], {
  encoding: 'utf8',
});
assert.notEqual(failure.status, 0);
assert.equal(failure.stdout, '');
assert.match(failure.stderr, /Path not found/);
rmSync(tempRoot, { recursive: true, force: true });
console.log('OK JSON stdout lifecycle');
```

- [ ] **Step 2: Run the regression and observe RED**

Run:

```bash
node cli/scripts/json-stdout-lifecycle.mjs
```

Expected on the current entrypoint: the source assertion fails because it contains immediate `process.exit()` calls; the large pipe case may also produce truncated JSON.

- [ ] **Step 3: Add the asynchronous write lifecycle**

Import `once` and define:

```js
import { once } from 'node:events';

export async function writeAll(stream, text) {
  const value = String(text);
  if (stream.write(value)) return;
  await once(stream, 'drain');
}

export async function writeJson(value, stream = process.stdout) {
  await writeAll(stream, `${JSON.stringify(value, null, 2)}\n`);
}

class CliExitError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'CliExitError';
    this.exitCode = exitCode;
  }
}

function fail(message, code = 1) {
  throw new CliExitError(message, code);
}
```

- [ ] **Step 4: Wrap dispatch in `main()` and remove immediate exits**

Insert this opening immediately before the current argument parsing and parse
the supplied `argv` rather than `process.argv`:

```js
export async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const cmd = positional[0];
  try {
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
      usage();
      return 0;
    }
```

Move the existing help branch inside that `try`, keep every command branch in
its current order, replace all 35 `process.exit(code)` calls with `return code`,
and replace every JSON `console.log(JSON.stringify(value, null, 2))` with
`await writeJson(value)`. Retain plain-text output behavior and existing
nonzero status semantics.

Replace the current bottom catch with this exact function tail:

```js
    fail(`Unknown command: ${cmd}`);
  } catch (error) {
    const exitCode = error instanceof CliExitError ? error.exitCode : 1;
    await writeAll(
      process.stderr,
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return exitCode;
  }
}
```

Import `realpathSync` from `node:fs` and `fileURLToPath` from `node:url`, then
add an import-safe direct-entry guard:

```js
function isDirectEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectEntry()) {
  process.exitCode = await main();
}
```

- [ ] **Step 5: Register and run output regressions**

Add `test:json-stdout-lifecycle`, append it to the default chain, and add the script to `files`.

Run:

```bash
npm --workspace cli run test:json-stdout-lifecycle
node cli/scripts/audit-gates.mjs
node cli/scripts/smoke.mjs
```

Expected: direct, redirect, pipe, and capture outputs are byte-identical and parse to 500 run nodes; CLI failure exits nonzero with complete stderr.

- [ ] **Step 6: Commit**

```bash
git add cli/bin/taskops.js cli/scripts/json-stdout-lifecycle.mjs cli/package.json
git commit -m "fix: drain CLI JSON output"
```

---

### Task 7: Put Workflow E2E and Behavioral Contracts in the Default Gate

**Files:**
- Modify: `cli/scripts/workflow-e2e.mjs`
- Modify: `cli/package.json`
- Modify: `README.md`
- Modify: `cli/README.md`
- Modify: `docs/CORE_MODEL.md`
- Modify: `docs/DECOMPOSITION_PROTOCOL.md`
- Modify: `docs/MD_FIRST_FORMAT.md`
- Modify: `docs/RUN_READINESS.md`
- Modify: `skill/README.md`
- Modify: `skill/SKILL.md`
- Modify: `skill/references/core-model.md`
- Modify: `skill/references/decomposition-protocol.md`
- Modify: `skill/references/md-first-format.md`
- Modify: `skill/references/run-readiness.md`
- Modify: `scripts/check-contract-docs.mjs`
- Test: `cli/scripts/workflow-e2e.mjs`
- Test: `scripts/check-contract-docs.mjs`

**Interfaces:**
- Consumes: the state transitions and closure vocabulary implemented by Tasks 2–6.
- Produces: one default test chain and one machine-checked documentation contract.

- [ ] **Step 1: Make workflow E2E output opt-in**

Add `resolve` to the `node:path` import and replace the hard-coded result path with:

```js
const configuredResultPath = String(process.env.TASKOPS_WORKFLOW_RESULT_PATH || '').trim();
const resultPath = configuredResultPath ? resolve(configuredResultPath) : null;

function emitPayload(payload) {
  if (resultPath) {
    mkdirSync(dirname(resultPath), { recursive: true });
    writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(payload, null, 2));
}
```

Use `emitPayload()` in success and error branches. The default test must only use its temporary directory and stdout; it must not write `test-results/taskops-workflow-loopback-e2e.json`.

- [ ] **Step 2: Keep the workflow's unapproved terminal signal aligned**

Extend TC05's expected and actual payloads:

```js
const tc5Expected = {
  complete: false,
  status: 'active',
  nextAction: 'graph_closed_unapproved',
  reportableStopReason: 'graph_closed_unapproved',
  claimClosures: 1,
  approvedClaims: 0,
  evidence: 'An unapproved claim remains graph_closed_unapproved.',
};
const tc5Actual = {
  complete: tc1Explain.complete,
  status: tc1Explain.status,
  nextAction: tc1Explain.next.action,
  reportableStopReason: tc1Run.stopReason,
  claimClosures: tc1Explain.closure.claimBearingRunEowClosureCount,
  approvedClaims: tc1Explain.closure.policyApprovedClaimBearingRunEowClosureCount,
};
const tc5Pass = Object.entries(tc5Expected)
  .filter(([key]) => key !== 'evidence')
  .every(([key, value]) => tc5Actual[key] === value);
```

Pass `tc5Pass` to `record()`. The verified
dynamic positive remains in `dynamic-closure-liveness.mjs`, which Step 3 puts
in the same default test gate without duplicating its state-machine fixture.

- [ ] **Step 3: Put every core E2E regression in the default CLI chain**

Ensure the default `test` script includes:

```text
restart-blockedby-rebase.mjs
run-node-action-attempt-identity.mjs
dynamic-closure-liveness.mjs
prototype-state-machine.mjs
json-stdout-lifecycle.mjs
workflow-e2e.mjs
```

Keep named aliases for focused execution.

- [ ] **Step 4: Write failing semantic documentation checks**

In `scripts/check-contract-docs.mjs`, add:

```js
const readinessDocs = [
  'README.md',
  'cli/README.md',
  'docs/CORE_MODEL.md',
  'docs/RUN_READINESS.md',
  'skill/SKILL.md',
  'skill/references/core-model.md',
  'skill/references/run-readiness.md',
];
for (const rel of readinessDocs) {
  const text = read(rel);
  if (!text.includes('needs_prototype')) failures.push(`${rel}: missing needs_prototype`);
  if (!text.includes('graph_closed_unapproved')) failures.push(`${rel}: missing graph_closed_unapproved`);
}

for (const rel of ['cli/README.md', 'docs/CORE_MODEL.md', 'docs/MD_FIRST_FORMAT.md', 'skill/SKILL.md', 'skill/references/core-model.md', 'skill/references/md-first-format.md']) {
  const text = read(rel);
  if (!text.includes('closureRole: supporting')) failures.push(`${rel}: missing supporting closure role`);
  if (!text.includes('closureRole: claim-bearing')) failures.push(`${rel}: missing claim-bearing closure role`);
}

for (const rel of ['cli/README.md', 'docs/RUN_READINESS.md', 'skill/SKILL.md', 'skill/references/run-readiness.md']) {
  const text = read(rel);
  if (!text.includes('options.md')) failures.push(`${rel}: missing prototype artifact contract`);
  if (!/exploration[\s\S]{0,240}source task[\s\S]{0,120}open/i.test(text)) {
    failures.push(`${rel}: exploration must say the source task stays open`);
  }
}
```

Run:

```bash
npm run test:contract
```

Expected: FAIL on missing `needs_prototype`, closure roles, and corrected exploration semantics.

- [ ] **Step 5: Reconcile readiness and closure documentation**

Use these exact semantic statements in the active docs and skill mirrors:

```markdown
- `needs_prototype` creates cheap alternatives for an unknown-known requirement.
  Success requires a non-empty UTF-8 `options.md`, closes only a supporting run
  node, and puts the source task in `status: waiting` with `resolverKind: human`.
- Exploration records evidence and closes only its supporting run node; the
  source task stays open and advances to informed decomposition.
- `closureRole: supporting` records provenance and is structurally validated,
  but it is not in the policy-approval denominator.
- `closureRole: claim-bearing` carries an objective result and requires a real,
  matching independent review before policy-approved completion.
- `graph_closed_unapproved` means the graph is structurally closed but at least
  one claim lacks policy-approved evidence. It is not `all_closed`.
```

Update readiness enums from:

```text
runnable | needs_decomposition | needs_exploration | blocked
```

to:

```text
runnable | needs_decomposition | needs_exploration | needs_prototype | blocked
```

Remove every statement that exploration marks the parent/source task done or writes a source task EoW.

- [ ] **Step 6: Run contract and workflow gates**

Run:

```bash
npm run test:contract
npm --workspace cli run test:workflow
git status --short -- test-results
```

Expected: both tests pass and the last command shows no worktree changes.

- [ ] **Step 7: Commit**

```bash
git add cli/scripts/workflow-e2e.mjs cli/package.json \
  README.md cli/README.md docs/CORE_MODEL.md docs/DECOMPOSITION_PROTOCOL.md \
  docs/MD_FIRST_FORMAT.md docs/RUN_READINESS.md \
  skill/README.md skill/SKILL.md skill/references/core-model.md \
  skill/references/decomposition-protocol.md skill/references/md-first-format.md \
  skill/references/run-readiness.md scripts/check-contract-docs.mjs
git commit -m "docs: align TaskOps closure contracts"
```

---

### Task 8: Whole-Branch Review and Fresh Verification

**Files:**
- Review: every file changed by Tasks 1–7
- Test: all root and CLI verification commands

**Interfaces:**
- Consumes: all earlier task outputs.
- Produces: fresh evidence that the branch meets the approved design without changing protected outputs.

- [ ] **Step 1: Run the focused positive and negative matrix**

```bash
npm --workspace cli run test:restart-blockedby-rebase
npm --workspace cli run test:run-node-action-attempt-identity
npm --workspace cli run test:dynamic-closure-liveness
npm --workspace cli run test:prototype-state-machine
npm --workspace cli run test:json-stdout-lifecycle
npm --workspace cli run test:workflow
node cli/scripts/navigation-approval-parity.mjs
node cli/scripts/policy-approval-evidence.mjs
node cli/scripts/invalid-graph-not-complete.mjs
```

Expected: every command exits 0. The matrix contains both `all_closed`/`claimSafe=true` and deliberate unsafe cases that cannot reach those states.

- [ ] **Step 2: Run the full clean quality gate**

Invoke `superpowers:verification-before-completion`, then run:

```bash
npm ci
npm run verify
git diff --check
git status --short
```

Expected: `npm run verify` and `git diff --check` exit 0. `git status --short` shows only intentional committed branch changes, normally no output.

- [ ] **Step 3: Verify the original protected paths are unchanged**

```bash
git -C /home/jimmy/repos/taskops status --porcelain=v1 -- eval/results eval/soak test-results > /tmp/taskops-core-protected.after
find /home/jimmy/repos/taskops/eval/results /home/jimmy/repos/taskops/eval/soak /home/jimmy/repos/taskops/test-results -type f -print0 \
  | sort -z \
  | xargs -0 sha256sum > /tmp/taskops-core-protected.sha256.after
diff -u /tmp/taskops-core-protected.before /tmp/taskops-core-protected.after
diff -u /tmp/taskops-core-protected.sha256.before /tmp/taskops-core-protected.sha256.after
```

Expected: both `diff` commands exit 0.

- [ ] **Step 4: Run two-stage task reviews and a whole-branch review**

Invoke `superpowers:requesting-code-review`.

For each task commit, obtain:

1. a spec-compliance verdict against `docs/superpowers/specs/2026-07-25-taskops-core-stabilization-design.md`;
2. a code-quality verdict covering state-machine honesty, backwards compatibility, test quality, and unintended scope.

Then review the entire branch diff from `d4b6a6b`:

```bash
git diff --stat d4b6a6b...HEAD
git diff --check d4b6a6b...HEAD
git log --oneline d4b6a6b..HEAD
```

Expected: all review findings are either fixed and re-reviewed or explicitly rejected with reproducible technical evidence.

- [ ] **Step 5: Re-run verification after the final review correction**

```bash
npm run verify
npm --workspace cli run test:dynamic-closure-liveness
npm --workspace cli run test:prototype-state-machine
npm --workspace cli run test:json-stdout-lifecycle
git diff --check
```

Expected: all commands exit 0 on the final HEAD.

- [ ] **Step 6: Hand off branch integration and the required benchmark follow-up**

Invoke `superpowers:finishing-a-development-branch` to choose merge/PR/retention with the user. Do not claim the broader TaskOps evaluation goal complete at this point.

After the correctness branch is integrated, start a separate brainstorming/design cycle for the preregistered legacy-model campaign recorded in the approved design: fixed older-model identity including GPT-5.4 when actually available, SWE-bench Verified and SWE-bench Pro where access permits, equal-budget baseline versus TaskOps, declared maximum-score compute envelope, pass@1/resolved/cost/time/retry/failure-class reporting, and no hidden-test tuning or favorable-subset reporting.
