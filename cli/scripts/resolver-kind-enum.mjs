#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  fmBlock,
  initProject,
  parseProject,
  RESOLVER_KIND_VALUES,
} from '../lib-taskops.js';

const fixedNow = '2026-07-02T00:00:00.000Z';

function writeFm(filePath, frontmatter, body) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, fmBlock(frontmatter) + body, 'utf8');
}

function createWorkWithTask(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'taskops-resolver-kind-'));
  initProject(root, {
    id: 'work-resolver-kind',
    title: 'Resolver kind fixture',
    objective: 'Validate optional task resolverKind.',
  });

  writeFm(
    join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'tasks', 'task-root.md'),
    {
      taskOpsVersion: 'v1',
      entityType: 'task',
      id: 'task-root',
      taskGroupId: 'tg-root',
      taskGroupVersionId: 'tgv-root-v1',
      title: 'Root task',
      objective: 'Validate resolver kind',
      responsibility: 'Own resolverKind schema validation',
      completionCriteria: 'The expected validation result is observed',
      order: 1,
      createdAt: fixedNow,
      status: 'pending',
      runReadiness: 'runnable',
      ...extra,
    },
    '# Root task\n',
  );

  return root;
}

function assertNoErrors(root, message) {
  const parsed = parseProject(root);
  assert.deepEqual(parsed.errors, [], message);
}

assert.deepEqual(RESOLVER_KIND_VALUES, ['human', 'ai', 'self'], 'resolver kind enum values should remain explicit');

{
  const root = createWorkWithTask();
  assertNoErrors(root, 'task without resolverKind should validate');
}

for (const resolverKind of RESOLVER_KIND_VALUES) {
  const root = createWorkWithTask({ resolverKind });
  assertNoErrors(root, `task with resolverKind '${resolverKind}' should validate`);
}

{
  const root = createWorkWithTask({ resolverKind: 'bogus' });
  const parsed = parseProject(root);
  assert.ok(
    parsed.errors.some((error) => error.includes("invalid resolverKind 'bogus'")),
    'invalid resolverKind should emit invalidResolverKind validation error',
  );
}

{
  const root = createWorkWithTask({ runReadiness: 'needs_exploration' });
  assertNoErrors(root, 'base-compatible task fixture should still validate unchanged');
}

console.log('OK resolverKind enum');
