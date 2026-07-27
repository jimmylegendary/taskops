# TaskOps Residual Identity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make modern claim approval fail closed on missing action identity and make every newly written task/run EoW ID an injective, reversible, compatibility-safe v2 identity.

**Architecture:** Resolve claim action identity once, before role-specific closure checks, using explicit schema-era witnesses to distinguish modern from genuinely legacy records. Encode new EoW tuples with strict UTF-8/base64url framing, validate v2 tuples at parse time, and centralize immutable legacy-candidate discovery for idempotent writers while leaving manual close semantics unchanged.

**Tech Stack:** Node.js `>=22`, plain ESM, `node:test`, `node:assert/strict`, Markdown/YAML frontmatter, npm workspaces.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-07-25-taskops-residual-identity-hardening-design.md`.
- Work only in `/home/jimmy/repos/taskops/.worktrees/taskops-core-stabilization` on `fix/taskops-core-stabilization`.
- Preserve `/home/jimmy/repos/taskops/eval/results`, `/home/jimmy/repos/taskops/eval/soak`, and `/home/jimmy/repos/taskops/test-results` byte-for-byte.
- Keep package version `0.10.1`; do not add dependencies, create tags, publish artifacts, or change release configuration.
- Keep Node.js engine floor exactly `>=22`.
- Modern action-identity witnesses are own-properties `node.actionKind`, `node.attempt`, `node.predecessorRunNodeId`, and `eow.closureRole`.
- Legacy action inference is allowed only when all four witnesses are absent; present-but-null or present-but-blank is modern malformed data.
- Canonical run IDs are `eow-v2-r.<base64url(runNodeId UTF-8)>.<base64url(runId UTF-8)>`.
- Canonical task IDs are `eow-v2-t.<base64url(taskId UTF-8)>.<base64url(taskGroupVersionId UTF-8)>`.
- Constructors accept primitive, non-empty, well-formed strings only and never coerce other values with `String()`.
- New `<eow-id>.md` names must fit within 255 UTF-8 bytes; enforce the limit immediately before a write.
- Candidate order is canonical v2, current lossy qualified ID, then original unqualified ID.
- Never rename or rewrite existing EoWs, historical `closes_with` targets, or `preservedFromEowId`.
- Manual close keeps its parsed logical “already closed” error; it is not converted into an idempotent reuse operation.
- Keep work-wide duplicate EoW rejection strict.
- Literal historical fixtures remain literal; only generated-ID expectations use the canonical helper.

## Scope Check

Claim identity and EoW identity are independently testable, but both feed the
same closure classifier/parser and the same repository verification gate.
They therefore remain one implementation plan with separate task/commit
boundaries rather than two branches that would need to be reconciled later.

## File Responsibility Map

- `cli/lib-run-closure.js`: modern-versus-legacy action identity and closure approval classification.
- `cli/lib-run-identity.js`: pure EoW codec, strict decoder, legacy-qualified compatibility IDs, candidate order, and filename budget.
- `cli/lib-state-writer.js`: filesystem candidate ownership resolution and idempotent task/run closure writes.
- `cli/lib-taskops.js`: canonical v2 parser validation, carry-forward generation, version materialization, and promoted-partial source closure.
- `cli/lib-runner.js`: manual task/run close, exploration non-closing guard, and direct writer budget checks.
- `cli/scripts/policy-approval-evidence.mjs`: claim identity RED/GREEN controls.
- `cli/scripts/eow-identity-codec.mjs`: focused pure codec and candidate-contract tests.
- `cli/scripts/eow-global-identity.mjs`: real automatic/review/manual/restart collision regressions and parser corruption tests.
- `cli/scripts/state-writer-run-graph.mjs`: central writer reuse, collision-owner, immutable mismatch, and edge-target tests.
- `cli/scripts/partial-promotion-plan.mjs`: promoted-source legacy reuse and carry-forward provenance.
- Existing lifecycle scripts: replace generated v1 ID assumptions with helper-derived v2 IDs without changing intentional legacy fixtures.
- `docs/MD_FIRST_FORMAT.md`: persisted v2 format and legacy-read/canonical-write rules.
- `docs/CORE_MODEL.md`: global injectivity and modern action identity invariants.
- `cli/package.json`: register the focused codec test in the default gate and packaged file list.

## Execution Preflight

- [ ] **Step 1: Reconfirm the isolated worktree**

Run:

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
git merge-base HEAD main
```

Expected:

```text
/home/jimmy/repos/taskops/.worktrees/taskops-core-stabilization
fix/taskops-core-stabilization
```

The worktree must be clean before Task 1.

- [ ] **Step 2: Create a fresh protected-path baseline in the plan-owned SDD workspace**

Run after the execution skill creates:
`.superpowers/sdd/2026-07-27-taskops-residual-identity-hardening/`.

```bash
find /home/jimmy/repos/taskops/eval/results \
  /home/jimmy/repos/taskops/eval/soak \
  /home/jimmy/repos/taskops/test-results \
  -type f -print0 \
  | sort -z \
  | xargs -0 sha256sum \
  > .superpowers/sdd/2026-07-27-taskops-residual-identity-hardening/protected.sha256.before

git -C /home/jimmy/repos/taskops status \
  --porcelain=v1 --untracked-files=all -- \
  eval/results eval/soak test-results \
  > .superpowers/sdd/2026-07-27-taskops-residual-identity-hardening/protected.status.before
```

Expected: both manifests exist; do not stage them.

- [ ] **Step 3: Run the focused pre-change baseline**

Run:

```bash
npm --workspace cli run test:policy-approval-evidence
npm --workspace cli run test:eow-global-identity
npm --workspace cli run test:state-writer-run-graph
npm --workspace cli run test:partial-promotion-plan
```

Expected: all commands exit 0.

---

### Task 1: Fail Closed on Modern Claim Action Identity

**Files:**
- Modify: `cli/lib-run-closure.js:44-62,133-211`
- Modify: `cli/scripts/policy-approval-evidence.mjs:8-12,129-209`

**Interfaces:**
- Consumes: run node/EoW own-properties and `validateRunNodeActionIdentity({ type, actionKind, requireActionKind })`.
- Produces: `resolveRunNodeActionIdentity({ node, eow }) -> { mode, actionKind, valid, issues }`.

- [ ] **Step 1: Write the missing-action and cohort RED tests**

Import the classifier and resolver:

```js
import {
  classifyRunClosure,
  resolveRunNodeActionIdentity,
} from '../lib-run-closure.js';
```

After the existing unknown/mismatched action cases, add a fixture that removes
only `actionKind`:

```js
const missingClaimActionDir = join(tempRoot, 'missing-claim-action');
cpSync(tamperSource, missingClaimActionDir, { recursive: true });
const missingClaimNodePath = join(
  missingClaimActionDir,
  'runs/run-main/nodes/run-node-review.md',
);
const missingClaimBefore = readFileSync(missingClaimNodePath, 'utf8');
const missingClaimAfter = missingClaimBefore.replace(
  /^actionKind: execute\n/m,
  '',
);
assert.notEqual(
  missingClaimAfter,
  missingClaimBefore,
  'missing-action fixture must remove only the live actionKind',
);
assert.match(missingClaimAfter, /^attempt: 1$/m);
writeFileSync(missingClaimNodePath, missingClaimAfter, 'utf8');

const missingClaim = parseProject(missingClaimActionDir);
const missingNode = missingClaim.runNodes.get('run-main:run-node-review');
const missingEow = [...missingClaim.eowNodes.values()].find((eow) => (
  eow.runId === 'run-main'
  && eow.attachedToId === 'run-node-review'
));
const missingClassification = classifyRunClosure({
  node: missingNode,
  task: missingClaim.tasks.get('tgv-root-v1:task-review'),
  eow: missingEow,
  runNodes: missingClaim.runNodes,
  runEdges: missingClaim.runEdges,
  versions: missingClaim.versions,
  selectedVersionIds: new Set(['tgv-root-v1']),
});

assert.equal(missingClassification.reviewEvidenceValid, true);
assert.equal(missingClassification.policyApproved, false);
assert.ok(
  missingClassification.issues.some((issue) => /actionKind is required/i.test(issue)),
);
assert.equal(missingClaim.closure.policyApprovedComplete, false);
assert.ok(
  missingClaim.errors.some((error) => /actionKind is required/i.test(error)),
);

const historicalMissingClassification = classifyRunClosure({
  node: missingNode,
  task: missingClaim.tasks.get('tgv-root-v1:task-review'),
  eow: missingEow,
  runNodes: missingClaim.runNodes,
  runEdges: missingClaim.runEdges,
  versions: missingClaim.versions,
  selectedVersionIds: new Set(['tgv-other-v1']),
});
assert.equal(historicalMissingClassification.selected, false);
assert.equal(historicalMissingClassification.reviewEvidenceValid, true);
assert.equal(historicalMissingClassification.policyApproved, false);
```

Add direct cohort controls:

```js
assert.deepEqual(
  resolveRunNodeActionIdentity({
    node: { type: 'implementation' },
    eow: { reason: 'approved_result' },
  }),
  {
    mode: 'legacy-inferred',
    actionKind: 'execute',
    valid: true,
    issues: [],
  },
);

for (const node of [
  { type: 'implementation', actionKind: null },
  { type: 'implementation', actionKind: '' },
  { type: 'implementation', attempt: 1 },
  { type: 'implementation', predecessorRunNodeId: 'run-node-prior' },
]) {
  const resolved = resolveRunNodeActionIdentity({
    node,
    eow: { reason: 'approved_result' },
  });
  assert.equal(resolved.mode, 'explicit');
  assert.equal(resolved.valid, false);
  assert.ok(resolved.issues.some((issue) => /actionKind is required/i.test(issue)));
}
```

Change the existing legacy fixture so it removes `actionKind`, `attempt`, and
`closureRole`, asserting every replacement is non-vacuous.

- [ ] **Step 2: Run the RED test**

Run:

```bash
npm --workspace cli run test:policy-approval-evidence
```

Expected: FAIL because `resolveRunNodeActionIdentity` is not exported and the
explicit claim still remains approved when only `actionKind` is removed.

- [ ] **Step 3: Implement one action-identity resolver**

Add beside `validateRunNodeActionIdentity`:

```js
const hasOwn = (value, key) => (
  value != null
  && Object.prototype.hasOwnProperty.call(value, key)
);

export function resolveRunNodeActionIdentity({ node, eow } = {}) {
  const hasModernWitness = (
    hasOwn(node, 'actionKind')
    || hasOwn(node, 'attempt')
    || hasOwn(node, 'predecessorRunNodeId')
    || hasOwn(eow, 'closureRole')
  );

  if (!hasModernWitness) {
    const actionKind = LEGACY_ACTION_KIND_BY_TYPE.get(node?.type) || null;
    const issues = actionKind
      ? []
      : [`legacy run closure cannot infer actionKind from type '${node?.type}'`];
    return {
      mode: 'legacy-inferred',
      actionKind,
      valid: issues.length === 0,
      issues,
    };
  }

  const validated = validateRunNodeActionIdentity({
    type: node?.type,
    actionKind: node?.actionKind,
    requireActionKind: true,
  });
  return {
    mode: 'explicit',
    actionKind: validated.actionKind,
    valid: validated.valid,
    issues: validated.issues,
  };
}
```

At the start of `classifyRunClosure`, resolve identity for every closure,
regardless of `selected`:

```js
const actionIdentity = resolveRunNodeActionIdentity({ node, eow });
issues.push(...actionIdentity.issues);
const actionKind = actionIdentity.actionKind;
```

Delete the old “validate only a non-empty selected action” block and the
supporting-only missing-action fallback. Keep exploration/prototype/decompose/
review artifact checks inside:

```js
if (selected && role === 'supporting') {
  // existing action-specific support checks, using resolved actionKind
}
```

Return approval with the explicit identity condition:

```js
policyApproved: (
  role === 'claim-bearing'
  && actionIdentity.valid
  && review.valid
  && allIssues.length === 0
),
```

- [ ] **Step 4: Run focused and adjacent GREEN tests**

Run:

```bash
npm --workspace cli run test:policy-approval-evidence
npm --workspace cli run test:closure-summary-policy
npm --workspace cli run test:dynamic-closure-liveness
node cli/scripts/restart-semantic-contract.mjs
```

Expected: all exit 0. The explicit missing action is unapproved; the
all-witnesses-absent legacy control remains approved.

- [ ] **Step 5: Commit Task 1**

```bash
git add cli/lib-run-closure.js cli/scripts/policy-approval-evidence.mjs
git commit -m "fix: fail closed on modern claim identity"
```

---

### Task 2: Add the Canonical EoW v2 Codec

**Files:**
- Modify: `cli/lib-run-identity.js:1-65`
- Create: `cli/scripts/eow-identity-codec.mjs`
- Modify: `cli/package.json:13-18,92-225`

**Interfaces:**
- Consumes: primitive non-empty well-formed strings.
- Produces:
  - `runEowId({ runId, runNodeId }) -> string`
  - `taskEowId({ taskGroupVersionId, taskId }) -> string`
  - `decodeCanonicalEowId(id) -> decoded tuple | null`
  - `runEowIdCandidates(...) -> string[]`
  - `taskEowIdCandidates(...) -> string[]`
  - `legacyQualifiedRunEowId(...) -> string`
  - `legacyQualifiedTaskEowId(...) -> string`
  - `assertEowFilenameBudget(id) -> id | throws`

- [ ] **Step 1: Write the focused codec RED test**

Create `cli/scripts/eow-identity-codec.mjs`:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  assertEowFilenameBudget,
  decodeCanonicalEowId,
  legacyQualifiedRunEowId,
  legacyQualifiedTaskEowId,
  runEowId,
  runEowIdCandidates,
  taskEowId,
  taskEowIdCandidates,
} from '../lib-run-identity.js';

const runNormalizationA = runEowId({
  runId: 'run-main',
  runNodeId: 'run-node+a',
});
const runNormalizationB = runEowId({
  runId: 'run-main',
  runNodeId: 'run-node-a',
});
assert.notEqual(runNormalizationA, runNormalizationB);

const runBoundaryA = runEowId({ runId: 'c', runNodeId: 'a-b' });
const runBoundaryB = runEowId({ runId: 'b-c', runNodeId: 'a' });
assert.notEqual(runBoundaryA, runBoundaryB);

const taskNormalizationA = taskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task+a',
});
const taskNormalizationB = taskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task-a',
});
assert.notEqual(taskNormalizationA, taskNormalizationB);

const taskBoundaryA = taskEowId({
  taskGroupVersionId: 'c',
  taskId: 'a-b',
});
const taskBoundaryB = taskEowId({
  taskGroupVersionId: 'b-c',
  taskId: 'a',
});
assert.notEqual(taskBoundaryA, taskBoundaryB);
assert.notEqual(
  runEowId({ runId: 'same', runNodeId: 'same' }),
  taskEowId({ taskGroupVersionId: 'same', taskId: 'same' }),
);

assert.deepEqual(decodeCanonicalEowId(runNormalizationA), {
  graphType: 'run',
  attachedToType: 'runNode',
  attachedToId: 'run-node+a',
  runId: 'run-main',
});
assert.deepEqual(decodeCanonicalEowId(taskNormalizationA), {
  graphType: 'task',
  attachedToType: 'task',
  attachedToId: 'task+a',
  taskGroupVersionId: 'tgv-root-v1',
});

const unicodeRunId = runEowId({
  runId: '실행-α',
  runNodeId: '노드-β',
});
assert.equal(decodeCanonicalEowId(unicodeRunId).runId, '실행-α');

assert.deepEqual(
  runEowIdCandidates({
    runId: 'run-main',
    runNodeId: 'run-node+a',
  }),
  [
    runNormalizationA,
    'eow-run-node-a-run-main',
    'eow-run-node+a',
  ],
);
assert.deepEqual(
  taskEowIdCandidates({
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task+a',
  }),
  [
    taskNormalizationA,
    'eow-task-a-tgv-root-v1',
    'eow-task+a',
  ],
);

assert.equal(
  legacyQualifiedRunEowId({
    runId: 'run-main',
    runNodeId: 'run-node+a',
  }),
  'eow-run-node-a-run-main',
);
assert.equal(
  legacyQualifiedTaskEowId({
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task+a',
  }),
  'eow-task-a-tgv-root-v1',
);

assert.equal(decodeCanonicalEowId('eow-run-node-a'), null);
assert.throws(
  () => decodeCanonicalEowId('eow-v2-r.A.A'),
  /malformed canonical EoW id/i,
);
assert.throws(
  () => runEowId({ runId: 1, runNodeId: 'node' }),
  /runId must be a primitive string/i,
);
assert.throws(
  () => taskEowId({
    taskGroupVersionId: 'version',
    taskId: '\uD800',
  }),
  /well-formed Unicode/i,
);

const overBudget = runEowId({
  runId: 'r'.repeat(120),
  runNodeId: 'n'.repeat(120),
});
assert.throws(
  () => assertEowFilenameBudget(overBudget),
  /255 UTF-8 bytes/i,
);

console.log('eow identity codec checks passed');
```

Register it before `eow-global-identity.mjs` in `scripts.test`, add
`test:eow-identity-codec`, and add the script to `files`.

- [ ] **Step 2: Run the codec RED test**

Run:

```bash
npm --workspace cli run test:eow-identity-codec
```

Expected: FAIL because the new exports do not exist and old IDs still collide.

- [ ] **Step 3: Implement strict components and reversible framing**

Keep `safePart()` unchanged for run-node allocation. Add:

```js
const EOW_FILENAME_LIMIT_BYTES = 255;

function requireEowComponent(value, name) {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a primitive string`);
  }
  if (value.length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
  if (!value.isWellFormed()) {
    throw new Error(`${name} must be well-formed Unicode`);
  }
  return value;
}

function encodeEowComponent(value, name) {
  return Buffer
    .from(requireEowComponent(value, name), 'utf8')
    .toString('base64url');
}

function decodeEowComponent(token, name) {
  if (!token) throw new Error(`malformed canonical EoW id: empty ${name}`);
  const bytes = Buffer.from(token, 'base64url');
  let value;
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`malformed canonical EoW id: invalid UTF-8 ${name}`);
  }
  if (
    value.length === 0
    || !value.isWellFormed()
    || Buffer.from(value, 'utf8').toString('base64url') !== token
  ) {
    throw new Error(`malformed canonical EoW id: non-canonical ${name}`);
  }
  return value;
}
```

Implement constructors and decoder with these exact return shapes:

```js
export function runEowId({ runId, runNodeId } = {}) {
  const node = encodeEowComponent(runNodeId, 'runNodeId');
  const run = encodeEowComponent(runId, 'runId');
  return `eow-v2-r.${node}.${run}`;
}

export function taskEowId({ taskGroupVersionId, taskId } = {}) {
  const task = encodeEowComponent(taskId, 'taskId');
  const version = encodeEowComponent(
    taskGroupVersionId,
    'taskGroupVersionId',
  );
  return `eow-v2-t.${task}.${version}`;
}

export function decodeCanonicalEowId(id) {
  if (typeof id !== 'string') {
    throw new TypeError('EoW id must be a primitive string');
  }
  if (!id.startsWith('eow-v2-')) return null;
  const match = /^eow-v2-([rt])\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(id);
  if (!match) throw new Error(`malformed canonical EoW id '${id}'`);
  if (match[1] === 'r') {
    return {
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: decodeEowComponent(match[2], 'runNodeId'),
      runId: decodeEowComponent(match[3], 'runId'),
    };
  }
  return {
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: decodeEowComponent(match[2], 'taskId'),
    taskGroupVersionId: decodeEowComponent(
      match[3],
      'taskGroupVersionId',
    ),
  };
}
```

Add the two old qualified constructors, ordered de-duplicated candidate arrays,
and write-time budget check:

```js
const unique = (values) => [...new Set(values)];

export function assertEowFilenameBudget(id) {
  const bytes = Buffer.byteLength(`${id}.md`, 'utf8');
  if (bytes > EOW_FILENAME_LIMIT_BYTES) {
    throw new Error(
      `EoW filename exceeds 255 UTF-8 bytes (${bytes}): ${id}`,
    );
  }
  return id;
}
```

Do not call `assertEowFilenameBudget()` inside candidate construction; a long
existing legacy ID must remain discoverable. Call it only immediately before
new file writes in later tasks.

- [ ] **Step 4: Run codec GREEN and allocation regression tests**

Run:

```bash
npm --workspace cli run test:eow-identity-codec
npm --workspace cli run test:run-node-action-attempt-identity
```

Expected: both exit 0. Run-node allocation keeps its current `safePart()`
behavior; only EoW IDs change.

- [ ] **Step 5: Commit Task 2**

```bash
git add cli/lib-run-identity.js cli/scripts/eow-identity-codec.mjs cli/package.json
git commit -m "feat: add canonical eow identity codec"
```

---

### Task 3: Validate Canonical EoW Tuples in the Parser

**Files:**
- Modify: `cli/lib-taskops.js:1-10,806-809,892-909,971-986`
- Modify: `cli/scripts/eow-global-identity.mjs:1-620`

**Interfaces:**
- Consumes: `decodeCanonicalEowId(id)` from Task 2 and parsed EoW frontmatter.
- Produces: canonical parser errors for malformed, wrong-kind, and tuple-inconsistent v2 IDs; legacy IDs remain opaque.

- [ ] **Step 1: Write parser-validation RED tests**

Import `runEowId` and `taskEowId` into
`cli/scripts/eow-global-identity.mjs`. Before adding the parser cases, replace
all existing generated-ID expectations with these helper results:

```js
runEowId({ runId: 'run-one', runNodeId: 'run-node-task' })
runEowId({ runId: 'run-two', runNodeId: 'run-node-task' })
runEowId({ runId: 'run-worker-one', runNodeId: 'review-run-node-task' })
runEowId({ runId: 'run-worker-restarted', runNodeId: 'review-run-node-task' })
runEowId({ runId: 'run-review-one', runNodeId: 'review-run-node-task' })
runEowId({ runId: 'run-review-two', runNodeId: 'review-run-node-task' })
taskEowId({ taskGroupVersionId: 'tgv-root-v2', taskId: 'task' })
runEowId({ runId: 'run-manual', runNodeId: 'run-node-manual' })
```

Use the helpers in filenames, expected arrays, and edge assertions. Keep the
hand-written claim/task/history EoWs literal so they continue exercising
legacy parsing.

Then add:

```js
test('parser rejects malformed and tuple-inconsistent canonical EoWs', () => {
  const fixture = seedSingleTaskWork('canonical-parser-errors');

  const malformedId = 'eow-v2-r.A.A';
  writeMd(
    join(
      fixture.workDir,
      'runs/run-main/nodes',
      `${malformedId}.md`,
    ),
    {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: malformedId,
      runId: 'run-main',
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'run-node-missing',
      reason: 'manual_close',
      closureRole: 'supporting',
      declaredBy: 'fixture',
      declaredAt: now,
      createdAt: now,
      status: 'done',
    },
  );

  const wrongTupleId = runEowId({
    runId: 'run-other',
    runNodeId: 'run-node-missing',
  });
  writeMd(
    join(
      fixture.workDir,
      'runs/run-main/nodes',
      `${wrongTupleId}.md`,
    ),
    {
      taskOpsVersion: 'v1',
      entityType: 'eow',
      id: wrongTupleId,
      runId: 'run-main',
      graphType: 'run',
      attachedToType: 'runNode',
      attachedToId: 'run-node-missing',
      reason: 'manual_close',
      closureRole: 'supporting',
      declaredBy: 'fixture',
      declaredAt: now,
      createdAt: now,
      status: 'done',
    },
  );

  const parsed = parseProject(fixture.workDir);
  assert.ok(parsed.errors.some((error) => (
    /malformed canonical EoW id/i.test(error)
  )));
  assert.ok(parsed.errors.some((error) => (
    /canonical run EoW tuple does not match frontmatter/i.test(error)
  )));
});
```

Insert this task-kind mismatch inside the same test immediately before
`const parsed = parseProject(...)`:

```js
const wrongKindId = runEowId({
  runId: 'tgv-root-v1',
  runNodeId: 'task',
});
writeMd(
  join(fixture.versionDir, 'eow', `${wrongKindId}.md`),
  {
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id: wrongKindId,
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: 'task',
    taskGroupVersionId: 'tgv-root-v1',
    reason: 'manual_close',
    declaredBy: 'fixture',
    declaredAt: now,
    createdAt: now,
    status: 'done',
  },
);
```

Then assert:

```js
assert.ok(parsed.errors.some((error) => (
  /canonical EoW graph kind does not match frontmatter/i.test(error)
)));
```

- [ ] **Step 2: Run the parser RED test**

Run:

```bash
npm --workspace cli run test:eow-global-identity
```

Expected: FAIL because malformed/wrong-tuple v2 names are still treated as
opaque IDs.

- [ ] **Step 3: Add one canonical identity issue function and call it from `addEow`**

Import `decodeCanonicalEowId`. Add before `parseProject()`:

```js
function canonicalEowIdentityIssues(eow) {
  if (typeof eow?.id !== 'string' || !eow.id.startsWith('eow-v2-')) {
    return [];
  }

  let decoded;
  try {
    decoded = decodeCanonicalEowId(eow.id);
  } catch (error) {
    return [error.message];
  }

  const issues = [];
  if (
    decoded.graphType !== eow.graphType
    || decoded.attachedToType !== eow.attachedToType
  ) {
    issues.push('canonical EoW graph kind does not match frontmatter');
    return issues;
  }
  if (decoded.attachedToId !== eow.attachedToId) {
    issues.push(
      `canonical ${decoded.graphType} EoW tuple does not match frontmatter`,
    );
  }
  if (
    decoded.graphType === 'run'
    && decoded.runId !== eow.runId
  ) {
    issues.push('canonical run EoW tuple does not match frontmatter');
  }
  if (
    decoded.graphType === 'task'
    && decoded.taskGroupVersionId !== eow.taskGroupVersionId
  ) {
    issues.push('canonical task EoW tuple does not match frontmatter');
  }
  return [...new Set(issues)];
}
```

Extend `addEow`:

```js
const addEow = (eow, filePath) => {
  for (const issue of canonicalEowIdentityIssues(eow)) {
    errors.push(withPath(filePath, issue));
  }
  if (eowNodes.has(eow.id)) {
    errors.push(withPath(filePath, `duplicate EoW id '${eow.id}'`));
  }
  eowNodes.set(eow.id, { ...eow, path: filePath });
};
```

Do not alter existing filename equality, graph relation, or duplicate checks.

- [ ] **Step 4: Run parser and closure GREEN tests**

Run:

```bash
npm --workspace cli run test:eow-global-identity
npm --workspace cli run test:dynamic-closure-liveness
npm --workspace cli run test:invalid-graph-not-complete
```

Expected: all exit 0; legacy fixtures still parse under their existing rules.

- [ ] **Step 5: Commit Task 3**

```bash
git add cli/lib-taskops.js cli/scripts/eow-global-identity.mjs
git commit -m "fix: validate canonical eow tuples"
```

---

### Task 4: Make Central State Writers Reuse Legacy EoWs Safely

**Files:**
- Modify: `cli/lib-state-writer.js:1-4,164-282`
- Modify: `cli/scripts/state-writer-run-graph.mjs:1-24,150-235`

**Interfaces:**
- Consumes: Task 2 constructors/candidates, legacy-qualified constructors, strict decoder, and write-time budget.
- Produces:
  - `resolveExistingRunEowFile({ runDir, runId, runNodeId }, io) -> { id, path, frontmatter, format } | null`
  - `resolveExistingTaskEowFile({ versionDir, taskGroupVersionId, taskId }, io) -> { id, path, frontmatter, format } | null`

- [ ] **Step 1: Write central-writer compatibility RED tests**

Import canonical and legacy-qualified helpers into
`state-writer-run-graph.mjs`. Add four run cases:

1. Existing current-qualified EoW is reused and becomes the edge target.
2. Existing original-unqualified EoW is reused.
3. A valid current-qualified EoW owned by `run-node+a` does not suppress a
   fresh v2 closure for `run-node-a`.
4. A v2 candidate path whose frontmatter owns another tuple throws.

Seed exact legacy files with the existing `fmBlock()` helper:

```js
function seedRunEow(path, {
  id,
  runId,
  runNodeId,
  reason = 'manual_close',
  closureRole = 'supporting',
}) {
  writeFileSync(path, fmBlock({
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id,
    runId,
    graphType: 'run',
    attachedToType: 'runNode',
    attachedToId: runNodeId,
    reason,
    closureRole,
    declaredBy: 'fixture',
    declaredAt: fixedNow,
    createdAt: fixedNow,
    status: 'done',
  }) + `# EoW: ${runNodeId}\n`, 'utf8');
}
```

The exact-reuse assertion is:

```js
const qualifiedRunDir = seedTree(
  join(tempRoot, 'qualified-run-reuse'),
).runDir;
const qualifiedId = legacyQualifiedRunEowId({
  runId: 'run-qualified',
  runNodeId: 'run-node-qualified',
});
seedRunEow(join(qualifiedRunDir, 'nodes', `${qualifiedId}.md`), {
  id: qualifiedId,
  runId: 'run-qualified',
  runNodeId: 'run-node-qualified',
});
closeRunNodeWithEowFiles({
  runDir: qualifiedRunDir,
  runId: 'run-qualified',
  runNodeId: 'run-node-qualified',
  reason: 'manual_close',
  closureRole: 'supporting',
  finishedAt: fixedNow,
}, stateWriterIo());
assert.equal(
  parseMarkdownFile(
    join(
      qualifiedRunDir,
      'edges',
      'edge-run-node-qualified-to-eow.md',
    ),
  ).toRunNodeId,
  qualifiedId,
);
assert.equal(
  existsSync(join(
    qualifiedRunDir,
    'nodes',
    `${runEowId({
      runId: 'run-qualified',
      runNodeId: 'run-node-qualified',
    })}.md`,
  )),
  false,
);
```

The original-unqualified case is:

```js
const unqualifiedRunDir = seedTree(
  join(tempRoot, 'unqualified-run-reuse'),
).runDir;
const unqualifiedId = 'eow-run-node-unqualified';
seedRunEow(
  join(unqualifiedRunDir, 'nodes', `${unqualifiedId}.md`),
  {
    id: unqualifiedId,
    runId: 'run-unqualified',
    runNodeId: 'run-node-unqualified',
  },
);
closeRunNodeWithEowFiles({
  runDir: unqualifiedRunDir,
  runId: 'run-unqualified',
  runNodeId: 'run-node-unqualified',
  reason: 'manual_close',
  closureRole: 'supporting',
  finishedAt: fixedNow,
}, stateWriterIo());
assert.equal(
  parseMarkdownFile(join(
    unqualifiedRunDir,
    'edges',
    'edge-run-node-unqualified-to-eow.md',
  )).toRunNodeId,
  unqualifiedId,
);
```

The collision case must make these exact assertions:

```js
const canonicalCollisionId = runEowId({
  runId: collisionRunId,
  runNodeId: 'run-node-a',
});
closeRunNodeWithEowFiles({
  runDir: collisionRunDir,
  runId: collisionRunId,
  runNodeId: 'run-node-a',
  reason: 'manual_close',
  closureRole: 'supporting',
  finishedAt: fixedNow,
}, io);
assert.equal(
  existsSync(join(collisionRunDir, 'nodes', `${canonicalCollisionId}.md`)),
  true,
);
assert.equal(
  parseMarkdownFile(
    join(collisionRunDir, 'edges', 'edge-run-node-a-to-eow.md'),
  ).toRunNodeId,
  canonicalCollisionId,
);
assert.equal(
  parseMarkdownFile(legacyCollisionPath).attachedToId,
  'run-node+a',
);
```

For canonical corruption, place the requested canonical filename on disk with
`attachedToId: 'run-node-other'` and assert:

```js
const corruptRunDir = seedTree(
  join(tempRoot, 'corrupt-canonical-run'),
).runDir;
const corruptCanonicalId = runEowId({
  runId: 'run-corrupt',
  runNodeId: 'run-node-corrupt',
});
seedRunEow(
  join(corruptRunDir, 'nodes', `${corruptCanonicalId}.md`),
  {
    id: corruptCanonicalId,
    runId: 'run-corrupt',
    runNodeId: 'run-node-other',
  },
);
assert.throws(
  () => closeRunNodeWithEowFiles({
    runDir: corruptRunDir,
    runId: 'run-corrupt',
    runNodeId: 'run-node-corrupt',
    reason: 'manual_close',
    closureRole: 'supporting',
    finishedAt: fixedNow,
  }, stateWriterIo()),
  /canonical EoW candidate.*owned by another tuple/i,
);
```

Add equivalent task cases with this task helper:

```js
function seedTaskEow(path, {
  id,
  taskGroupVersionId,
  taskId,
  reason = 'completed',
}) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fmBlock({
    taskOpsVersion: 'v1',
    entityType: 'eow',
    id,
    graphType: 'task',
    attachedToType: 'task',
    attachedToId: taskId,
    taskGroupVersionId,
    reason,
    declaredBy: 'fixture',
    declaredAt: fixedNow,
    createdAt: fixedNow,
    status: 'done',
  }) + `# EoW: ${taskId}\n`, 'utf8');
}
```

Exercise exact current-qualified reuse:

```js
const qualifiedTask = seedTree(join(tempRoot, 'qualified-task-reuse'));
const qualifiedVersionDir = dirname(dirname(qualifiedTask.taskPath));
const qualifiedTaskId = legacyQualifiedTaskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task-a',
});
seedTaskEow(
  join(qualifiedVersionDir, 'eow', `${qualifiedTaskId}.md`),
  {
    id: qualifiedTaskId,
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
  },
);
closeTaskWithEowFile({
  task: { id: 'task-a', path: qualifiedTask.taskPath },
  reason: 'completed',
  finishedAt: fixedNow,
}, stateWriterIo());
assert.equal(
  existsSync(join(
    qualifiedVersionDir,
    'eow',
    `${taskEowId({
      taskGroupVersionId: 'tgv-root-v1',
      taskId: 'task-a',
    })}.md`,
  )),
  false,
);
```

The original-unqualified task case is:

```js
const unqualifiedTask = seedTree(join(tempRoot, 'unqualified-task-reuse'));
const unqualifiedVersionDir = dirname(dirname(unqualifiedTask.taskPath));
seedTaskEow(
  join(unqualifiedVersionDir, 'eow', 'eow-task-a.md'),
  {
    id: 'eow-task-a',
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
  },
);
closeTaskWithEowFile({
  task: { id: 'task-a', path: unqualifiedTask.taskPath },
  reason: 'completed',
  finishedAt: fixedNow,
}, stateWriterIo());
assert.equal(
  existsSync(join(
    unqualifiedVersionDir,
    'eow',
    `${taskEowId({
      taskGroupVersionId: 'tgv-root-v1',
      taskId: 'task-a',
    })}.md`,
  )),
  false,
);
```

The lossy task collision case is:

```js
const collisionTask = seedTree(join(tempRoot, 'task-collision-owner'));
const collisionVersionDir = dirname(dirname(collisionTask.taskPath));
const collisionLegacyId = 'eow-task-a-tgv-root-v1';
const collisionLegacyPath = join(
  collisionVersionDir,
  'eow',
  `${collisionLegacyId}.md`,
);
seedTaskEow(collisionLegacyPath, {
  id: collisionLegacyId,
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task+a',
});
closeTaskWithEowFile({
  task: { id: 'task-a', path: collisionTask.taskPath },
  reason: 'completed',
  finishedAt: fixedNow,
}, stateWriterIo());
const collisionCanonicalId = taskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task-a',
});
assert.equal(parseMarkdownFile(collisionLegacyPath).attachedToId, 'task+a');
assert.equal(
  parseMarkdownFile(join(
    collisionVersionDir,
    'eow',
    `${collisionCanonicalId}.md`,
  )).attachedToId,
  'task-a',
);
```

For immutable mismatch, seed the exact qualified candidate with
`reason: other`, call `closeTaskWithEowFile(... reason: 'completed')`, and
assert:

```js
const mismatchTask = seedTree(join(tempRoot, 'task-immutable-mismatch'));
const mismatchVersionDir = dirname(dirname(mismatchTask.taskPath));
const mismatchTaskId = legacyQualifiedTaskEowId({
  taskGroupVersionId: 'tgv-root-v1',
  taskId: 'task-a',
});
seedTaskEow(
  join(mismatchVersionDir, 'eow', `${mismatchTaskId}.md`),
  {
    id: mismatchTaskId,
    taskGroupVersionId: 'tgv-root-v1',
    taskId: 'task-a',
    reason: 'other',
  },
);
const mismatchTaskPath = mismatchTask.taskPath;

assert.throws(
  () => closeTaskWithEowFile({
    task: { id: 'task-a', path: mismatchTaskPath },
    reason: 'completed',
    finishedAt: fixedNow,
  }, stateWriterIo()),
  /Immutable task EoW mismatch.*reason/,
);
```

Finally, update the existing `legacyCloseRunNodeWithEow()` and
`legacyCloseTaskWithEow()` reference functions to derive their generated IDs
with `runEowId()` and `taskEowId()`. They are byte-parity reference writers,
not historical fixtures; leaving old generated IDs there would make the
facade snapshot fail for the intended v2 behavior change.

- [ ] **Step 2: Run the central-writer RED test**

Run:

```bash
npm --workspace cli run test:state-writer-run-graph
```

Expected: FAIL because candidate order/ownership resolution does not exist and
the current task writer silently accepts mismatched existing paths.

- [ ] **Step 3: Implement ownership-aware candidate resolution**

Import from `lib-run-identity.js`:

```js
import {
  assertEowFilenameBudget,
  legacyQualifiedRunEowId,
  legacyQualifiedTaskEowId,
  runEowId,
  runEowIdCandidates,
  taskEowId,
  taskEowIdCandidates,
} from './lib-run-identity.js';
```

Implement exported resolvers that:

1. iterate ordered candidate IDs;
2. parse only existing paths;
3. require `frontmatter.id === candidateId`;
4. return exact tuple ownership;
5. skip a nonmatching current-qualified candidate only when recomputing the
   old qualified ID from its stored, relationally valid tuple reproduces the
   candidate ID; and
6. throw on canonical or original-unqualified ownership mismatch.

Use these exact immutable ownership fields:

```js
const runOwnerMatches = (
  fm.graphType === 'run'
  && fm.attachedToType === 'runNode'
  && fm.runId === runId
  && fm.attachedToId === runNodeId
);

const taskOwnerMatches = (
  fm.graphType === 'task'
  && fm.attachedToType === 'task'
  && fm.taskGroupVersionId === taskGroupVersionId
  && fm.attachedToId === taskId
);
```

Return `format` as one of `canonical-v2`, `qualified-v1`, or
`unqualified-v0`.

- [ ] **Step 4: Route both central writers through the resolvers**

For a fresh run EoW:

```js
const canonicalId = runEowId({ runId, runNodeId });
const existing = resolveExistingRunEowFile({
  runDir,
  runId,
  runNodeId,
}, io);
let eowRunNodeId = existing?.id || canonicalId;

if (!existing) {
  assertEowFilenameBudget(canonicalId);
  // existing atomic write with id/path set to canonicalId
}
```

When reusing, verify existing immutable closure fields `reason`,
`closureRole`, and non-empty expected `resolvedByTaskGroupId`. Do not rewrite
approval stamps or historical content.

For task EoWs, use the task resolver and verify `reason` plus non-empty expected
`resolvedByTaskGroupId`. Remove the current path-exists silent success. Before
a fresh task write, call `assertEowFilenameBudget(canonicalId)`.

The run `closes_with` edge must use `eowRunNodeId`, not a recomputed canonical
ID.

- [ ] **Step 5: Run central writer and closure GREEN tests**

Run:

```bash
npm --workspace cli run test:state-writer-run-graph
npm --workspace cli run test:execute-closure-writer
npm --workspace cli run test:decompose-closure-writer
npm --workspace cli run test:semantic-acceptance
```

Expected: all exit 0; exact legacy records are reused, collision owners are
preserved, and every new edge points to the actual closure ID.

- [ ] **Step 6: Commit Task 4**

```bash
git add cli/lib-state-writer.js cli/scripts/state-writer-run-graph.mjs
git commit -m "fix: reuse legacy eow identities safely"
```

---

### Task 5: Route Auxiliary Writers and Guards Through v2

**Files:**
- Modify: `cli/lib-taskops.js:1-10,2487-2553,2926-2948,3245-3322`
- Modify: `cli/lib-runner.js:17-27,5148-5160,5610-5823`
- Modify: `cli/scripts/partial-promotion-plan.mjs:1-20,390-435,700-890`
- Modify: `cli/scripts/exploration-nonclosing.mjs:1-20,92-185`
- Modify: `cli/scripts/eow-resolver-decompose-wiring.mjs:1-105`

**Interfaces:**
- Consumes: Task 2 budget/helper APIs and Task 4 ownership resolvers.
- Produces: v2 materialized/manual EoWs, exact legacy promoted-source reuse, ownership-aware exploration closure discovery, and unchanged manual “already closed” behavior.

- [ ] **Step 1: Write the promoted-source legacy-reuse RED test**

In `partial-promotion-plan.mjs`, seed one promoted source run with a
current-qualified v1 EoW and an edge to it. Promote the partial, then assert:

```js
const closedSource = applied.appliedVersionPlans[0].closedSourceRunNodes[0];
assert.equal(closedSource.wroteEow, false);
assert.equal(
  closedSource.eowRunNodeId,
  legacyQualifiedRunEowId({ runId: sourceRunId, runNodeId: sourceRunNodeId }),
);
assert.equal(
  parseMarkdownFile(sourceCloseEdgePath).toRunNodeId,
  closedSource.eowRunNodeId,
);
assert.equal(
  existsSync(join(
    sourceRunDir,
    'nodes',
    `${runEowId({ runId: sourceRunId, runNodeId: sourceRunNodeId })}.md`,
  )),
  false,
);
```

Before running the RED test, convert existing generated task/run EoW
expectations in `partial-promotion-plan.mjs`,
`exploration-nonclosing.mjs`, and
`eow-resolver-decompose-wiring.mjs` to `taskEowId()`/`runEowId()`.
This includes negative “must not exist” paths. Do not convert literal source
fixtures deliberately seeded as legacy IDs.

- [ ] **Step 2: Run the auxiliary RED tests**

Run:

```bash
npm --workspace cli run test:partial-promotion-plan
```

Expected: FAIL because promoted-source lookup does not yet discover all three
candidate generations with ownership-aware reuse.

- [ ] **Step 3: Update promoted-source and version materialization**

Import Task 4’s `resolveExistingRunEowFile` into `lib-taskops.js`.

In `closePromotedPartialSourceRunNode()`:

```js
const canonicalId = runEowId({ runId, runNodeId });
const existing = resolveExistingRunEowFile({
  runDir,
  runId,
  runNodeId,
}, {
  exists: existsSync,
  parseMarkdownFile,
});
let eowRunNodeId = existing?.id || canonicalId;
```

Call `assertEowFilenameBudget(canonicalId)` only before a fresh write. Keep the
edge ID unchanged and set `toRunNodeId: eowRunNodeId`.

`carriedForwardTaskEow()` already calls `taskEowId()`: retain source
`preservedFromEowId` verbatim. In `writeVersionFromSpec()`, require and write
the canonical destination ID:

```js
const canonicalId = taskEowId({
  taskGroupVersionId: versionId,
  taskId: eow.attachedToId,
});
if (eow.id !== canonicalId) {
  throw new Error(
    `Version materializer requires canonical task EoW id '${canonicalId}', found '${eow.id}'`,
  );
}
assertEowFilenameBudget(canonicalId);
```

Use `canonicalId` for both frontmatter and filename. Do not alter
`preservedFromEowId`.

- [ ] **Step 4: Update exploration and manual close paths**

Import `resolveExistingTaskEowFile` into `lib-runner.js`. Replace the two-path
exploration guard with:

```js
const sourceTaskVersionDir = dirname(dirname(task.path));
const sourceTaskEow = resolveExistingTaskEowFile({
  versionDir: sourceTaskVersionDir,
  taskGroupVersionId: task.taskGroupVersionId,
  taskId: task.id,
}, {
  exists: existsSync,
  parseMarkdownFile,
});
if (postExplorationFm.status === 'done' || sourceTaskEow) {
  throw new Error(
    `P0#2 invariant violated: exploration must not close acceptance-bearing task ${task.id} (acceptance requires verified/reviewed closure, not an exploration pass)`,
  );
}
```

In both manual task and run-node fresh-write branches, call
`assertEowFilenameBudget(eowId)` before writing. Keep the existing parsed
logical closure checks and their “already closed” errors unchanged. Keep the
manual run edge target equal to the newly generated `eowId`.

- [ ] **Step 5: Run auxiliary GREEN tests**

Run:

```bash
npm --workspace cli run test:partial-promotion-plan
node cli/scripts/exploration-nonclosing.mjs
npm --workspace cli run test:manual-close-partial-guard
node cli/scripts/restart-semantic-contract.mjs
npm --workspace cli run test:eow-resolver-decompose-wiring
```

Expected: all exit 0. Carry-forward destinations use v2; source provenance
remains unchanged; manual close still rejects an already closed tuple.

- [ ] **Step 6: Commit Task 5**

```bash
git add cli/lib-taskops.js cli/lib-runner.js \
  cli/scripts/partial-promotion-plan.mjs \
  cli/scripts/exploration-nonclosing.mjs \
  cli/scripts/eow-resolver-decompose-wiring.mjs
git commit -m "fix: route all eow writers through v2 identities"
```

---

### Task 6: Prove Real Collision-Safe Lifecycle Paths

**Files:**
- Modify: `cli/scripts/eow-global-identity.mjs:1-620`
- Modify generated-ID expectations in:
  - `cli/scripts/smoke.mjs`
  - `cli/scripts/decomposition-timeout-recovery.mjs`
  - `cli/scripts/exploration-acceptance-guard.mjs`
  - `cli/scripts/external-resolver-emit.mjs`
  - `cli/scripts/inherited-known-nonclosing.mjs`
  - `cli/scripts/oracle-access.mjs`
  - `cli/scripts/partial-completion.mjs`
  - `cli/scripts/partial-request-runner.mjs`
  - `cli/scripts/prototype-state-machine.mjs`
  - `cli/scripts/uncertainty-live-observability.mjs`
  - `cli/scripts/eow-resolver-backlink.mjs`

**Interfaces:**
- Consumes: production constructors/decoder and all writer paths from Tasks 2–5.
- Produces: real run/task/review/manual/restart collision evidence and helper-derived generated-ID expectations across the default test gate.

- [ ] **Step 1: Turn the existing helper-based global identity cases into adversarial tuples**

Import:

```js
import {
  decodeCanonicalEowId,
  runEowId,
  taskEowId,
} from '../lib-run-identity.js';
import { restartFromTask } from '../lib-taskops.js';
```

Task 3 already replaced generated expectations with helpers. Change the
existing run IDs to the sanitizer-colliding values and retain helper-based
expected arrays:

```js
assert.deepEqual(actionEows, [
  runEowId({ runId: 'run+one', runNodeId: 'run-node-task' }),
  runEowId({ runId: 'run-one', runNodeId: 'run-node-task' }),
].sort());
```

Keep hand-authored historical fixture IDs literal.

- [ ] **Step 2: Add automatic run and task collision tests**

Change the separate-run fixture to use `run+one` and `run-one`, which collide
under the old sanitizer. Assert:

```js
assert.equal(new Set(actionEows).size, 2);
assert.ok(actionEows.every((id) => id.startsWith('eow-v2-r.')));
assert.deepEqual(duplicateEowErrors(parsed), []);
```

Add two tasks `task+a` and `task-a` to one selected version, run both through
`runTaskOps()`, and assert:

```js
const taskEows = [...parsed.eowNodes.values()].filter((eow) => (
  eow.graphType === 'task'
  && eow.taskGroupVersionId === 'tgv-root-v1'
));
assert.equal(taskEows.length, 2);
assert.deepEqual(
  new Set(taskEows.map((eow) => eow.attachedToId)),
  new Set(['task+a', 'task-a']),
);
assert.equal(parsed.closure.terminalTaskEowCount, 2);
assert.deepEqual(duplicateEowErrors(parsed), []);
```

- [ ] **Step 3: Add review and manual collision tests**

Use review runs `run-review+one` and `run-review-one`. Assert each review EoW
equals `runEowId({ runId, runNodeId: 'review-run-node-task' })` and each
`closes_with` edge targets its own ID.

For manual task close, seed a historical closure for `task+manual`, then close
open `task-manual` in the same version. For manual run close, seed
`run-node+manual`, then close `run-node-manual` in the same run. Assert:

```js
assert.equal(closed.eowId, taskEowId({
  taskGroupVersionId: 'tgv-root-v2',
  taskId: 'task-manual',
}));
assert.equal(runEdge.toRunNodeId, runClosed.eowId);
assert.equal(decodeCanonicalEowId(runClosed.eowId).attachedToId, 'run-node-manual');
assert.deepEqual(duplicateEowErrors(parseProject(workDir)), []);
```

- [ ] **Step 4: Add a real restart carry-forward collision test**

Use `restartFromTask()` rather than simulating a restarted worker. Seed an
unselected historical version `tgv-root+v3` containing task `task-a` and EoW
`eow-task-a-tgv-root-v3`. Its current-qualified v1 ID collides with the
restart destination tuple `(task+a, tgv-root-v3)`. In selected
`tgv-root-v2`, seed completed upstream task `task+a`, its source EoW, and later
open task `task-restart`. Restart from `task-restart`, and assert:

```js
const restarted = restartFromTask(workDir, {
  fromTaskId: 'task-restart',
  instruction: 'Retry the downstream task with preserved upstream proof.',
  reason: 'identity collision regression',
});
const parsed = parseProject(workDir);
const carried = [...parsed.eowNodes.values()].find((eow) => (
  eow.graphType === 'task'
  && eow.taskGroupVersionId === restarted.toVersionId
  && eow.attachedToId === 'task+a'
));
assert.equal(
  carried.id,
  taskEowId({
    taskGroupVersionId: restarted.toVersionId,
    taskId: 'task+a',
  }),
);
assert.equal(carried.preservedFromEowId, sourceEowId);
assert.deepEqual(duplicateEowErrors(parsed), []);
```

- [ ] **Step 5: Run the expanded lifecycle RED/GREEN gate**

Run after writing each test before adjusting any remaining expectation:

```bash
npm --workspace cli run test:eow-global-identity
```

Expected after Tasks 2–5: PASS. If a new test fails, fix the production path
named by that test before changing its assertion.

- [ ] **Step 6: Replace generated-ID assumptions throughout existing tests**

For positive generated paths:

```js
const generatedTaskEowPath = join(
  versionDir,
  'eow',
  `${taskEowId({ taskGroupVersionId, taskId })}.md`,
);
const generatedRunEowPath = join(
  runDir,
  'nodes',
  `${runEowId({ runId, runNodeId })}.md`,
);
```

For negative “must not close” assertions, also use the canonical helper; do not
leave an old v1 path that would be absent even after an incorrect v2 close.
For summary/edge assertions, interpolate the helper result.

Apply this only to generated outputs in the exact file list above. Preserve
literal files explicitly seeded as legacy compatibility records, including
unqualified `eow-<attached-id>` fixtures and current qualified v1 fixtures.

- [ ] **Step 7: Run every directly affected script**

Run:

```bash
npm --workspace cli run test:eow-identity-codec
npm --workspace cli run test:eow-global-identity
npm --workspace cli run test:state-writer-run-graph
npm --workspace cli run test:partial-promotion-plan
npm --workspace cli run test:policy-approval-evidence
npm --workspace cli run test:closure-summary-policy
npm --workspace cli run test:workflow-lifecycle
node cli/scripts/smoke.mjs
node cli/scripts/decomposition-timeout-recovery.mjs
node cli/scripts/eow-resolver-decompose-wiring.mjs
node cli/scripts/exploration-nonclosing.mjs
node cli/scripts/exploration-acceptance-guard.mjs
node cli/scripts/external-resolver-emit.mjs
node cli/scripts/inherited-known-nonclosing.mjs
node cli/scripts/oracle-access.mjs
node cli/scripts/partial-completion.mjs
node cli/scripts/partial-request-runner.mjs
node cli/scripts/prototype-state-machine.mjs
node cli/scripts/uncertainty-live-observability.mjs
node cli/scripts/eow-resolver-backlink.mjs
```

Expected: every command exits 0.

- [ ] **Step 8: Commit Task 6**

```bash
git add cli/scripts cli/package.json
git commit -m "test: prove collision-safe eow lifecycle"
```

---

### Task 7: Document the Contract and Run the Repository Gate

**Files:**
- Modify: `docs/MD_FIRST_FORMAT.md:206-238,274-335,416-445`
- Modify: `docs/CORE_MODEL.md:110-135,176-213,363-385`
- Verify only: root and CLI package scripts

**Interfaces:**
- Consumes: the implemented v2 codec, cohort rules, and compatibility behavior.
- Produces: user-facing persistence contract plus fresh full-gate/protected-path evidence.

- [ ] **Step 1: Document canonical EoW v2 identities**

Add to both task and run EoW sections:

```text
New TaskOps writers use deterministic v2 EoW IDs:

- task: eow-v2-t.<base64url(taskId UTF-8)>.<base64url(taskGroupVersionId UTF-8)>
- run:  eow-v2-r.<base64url(runNodeId UTF-8)>.<base64url(runId UTF-8)>

The dot-framed base64url components are reversible and make the work-wide EoW
namespace injective across graph kind and tuple components. Consumers must
treat the complete ID as opaque rather than infer semantics by splitting it.
Existing qualified-v1 and unqualified-v0 IDs remain readable and immutable.
New writes never rename or rewrite them.
```

Document candidate order, exact tuple ownership, write-time 255-byte budget,
strict v2 parser matching, unchanged duplicate rejection, and manual close’s
unchanged “already closed” behavior.

- [ ] **Step 2: Document modern action identity**

Replace generally optional wording for `actionKind?` with:

```text
`actionKind` is required on every modern run node. It is legacy-optional only
when actionKind, attempt, predecessorRunNodeId, and the attached EoW's
closureRole are all absent as properties. Null or blank modern fields are
malformed and cannot contribute policy-approved claim evidence.
```

State that historical malformed claims remain parse-readable but cannot be
used as approved restart carry-forward evidence.

- [ ] **Step 3: Run documentation and repository verification**

Run:

```bash
npm run test:contract
npm run test:repository-scope
npm run test:version-sync
npm run verify
```

Expected: every command exits 0. `npm run verify` must include the new codec
test through the default CLI test chain.

- [ ] **Step 4: Verify protected paths against the preflight baseline**

Run:

```bash
sha256sum -c \
  .superpowers/sdd/2026-07-27-taskops-residual-identity-hardening/protected.sha256.before

git -C /home/jimmy/repos/taskops status \
  --porcelain=v1 --untracked-files=all -- \
  eval/results eval/soak test-results \
  > .superpowers/sdd/2026-07-27-taskops-residual-identity-hardening/protected.status.after

cmp \
  .superpowers/sdd/2026-07-27-taskops-residual-identity-hardening/protected.status.before \
  .superpowers/sdd/2026-07-27-taskops-residual-identity-hardening/protected.status.after
```

Expected: every checksum reports `OK`; `cmp` exits 0 with no output. If external
user activity changed a protected path during execution, stop and report the
exact drift rather than modifying or restoring it.

- [ ] **Step 5: Inspect the pending documentation diff**

Run:

```bash
git status --short --branch
git diff --check
git diff --stat
```

Expected: only the two intended documentation files are unstaged and there are
no whitespace errors.

- [ ] **Step 6: Commit Task 7**

```bash
git add docs/MD_FIRST_FORMAT.md docs/CORE_MODEL.md
git commit -m "docs: define canonical eow identity contract"
```

- [ ] **Step 7: Re-run the final gate at the committed HEAD**

Run:

```bash
npm run verify
git diff --check main...HEAD
git diff --stat main...HEAD
git log --oneline --decorate main..HEAD
git status --short --branch
```

Expected: `npm run verify` exits 0, the committed branch diff contains only
TaskOps core/test/docs plus approved design/plan history, and the worktree is
clean.

## Completion Evidence

The implementation report must include:

- commit IDs for Tasks 1–7;
- the explicit-claim missing-action RED failure and GREEN result;
- codec normalization and boundary collision results;
- parser malformed/wrong-tuple rejection;
- central writer qualified-v1 and unqualified-v0 reuse evidence;
- exact manual/review/restart edge and provenance targets;
- the final `npm run verify` exit code; and
- protected checksum/status comparison results.
