#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const requiredPaths = [
  'examples/taskops-canonical-minimal-v1/index.md',
  'examples/taskops-canonical-minimal-v1/task-groups',
  'examples/taskops-canonical-minimal-v1/snapshots',
  'examples/taskops-canonical-minimal-v1/runs',
  'examples/taskops-canonical-minimal-v1/derived/canvases',
  'examples/taskops-minimal-v1/index.md',
];

const failures = [];
for (const rel of requiredPaths) {
  if (!existsSync(join(repoRoot, rel))) failures.push(`missing canonical path: ${rel}`);
}

const userFacingDocs = [
  'README.md',
  'cli/README.md',
  'docs/CORE_MODEL.md',
  'docs/DECOMPOSITION_PROTOCOL.md',
  'docs/MD_FIRST_FORMAT.md',
  'docs/RUN_READINESS.md',
  'skill/README.md',
  'skill/SKILL.md',
  'skill/references/core-model.md',
  'skill/references/decomposition-protocol.md',
  'skill/references/md-first-format.md',
  'skill/references/run-readiness.md',
];

const banned = [
  [/missing `task-groups\/`, `snapshots\/`, or `run\/`/, 'canonical layout must say runs/, not run/'],
  [/taskops-canonical-minimal-v1\/canvases\//, 'canonical canvas docs must point to derived/canvases/'],
  [/<project-dir>/, 'CLI docs should use <work-dir> for canonical v1 wording'],
  [/Open project explorer/, 'Obsidian command docs should say Open work explorer'],
  [/active project/, 'Obsidian command docs should say active work'],
  [/all projects/, 'Obsidian command docs should say all work roots'],
  [/projects=1/, 'smoke docs should say works=1'],
  [/runEdges=1/, 'smoke docs should match canonical fixture runEdges=2'],
];

for (const rel of userFacingDocs) {
  const text = read(rel);
  for (const [pattern, message] of banned) {
    if (pattern.test(text)) failures.push(`${rel}: ${message}`);
  }
  for (const line of text.split('\n')) {
    if (line.includes('entityType: project') && !/(legacy|readable|migration|old)/i.test(line)) {
      failures.push(`${rel}: entityType: project must be described as legacy-readable, not canonical`);
      break;
    }
  }
}

const readinessDocs = [
  'README.md',
  'cli/README.md',
  'docs/CORE_MODEL.md',
  'docs/RUN_READINESS.md',
  'skill/SKILL.md',
  'skill/references/core-model.md',
  'skill/references/run-readiness.md',
];
const readinessContract = 'runnable | needs_decomposition | needs_exploration | needs_prototype | blocked';
for (const rel of readinessDocs) {
  const text = read(rel);
  if (!text.includes(readinessContract)) failures.push(`${rel}: missing exhaustive readiness contract`);
  if (!text.includes('graph_closed_unapproved')) failures.push(`${rel}: missing graph_closed_unapproved`);
  for (const line of text.split('\n')) {
    const normalized = line
      .toLowerCase()
      .replaceAll('needs decomposition', 'needs_decomposition')
      .replaceAll('needs exploration', 'needs_exploration')
      .replaceAll('needs prototype', 'needs_prototype');
    const exhaustive = ['runnable', 'needs_decomposition', 'needs_exploration', 'blocked']
      .every((value) => normalized.includes(value));
    const declaresExhaustiveSet = /classif(?:y|ies).*task|decides whether each task|runreadiness\?|run readiness.* as /.test(normalized);
    if (declaresExhaustiveSet && exhaustive && !normalized.includes('needs_prototype')) {
      failures.push(`${rel}: stale exhaustive readiness list omits needs_prototype`);
      break;
    }
  }
}
if (/handles three task readiness states/i.test(read('skill/SKILL.md'))) {
  failures.push('skill/SKILL.md: actionable readiness count must be four');
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

for (const rel of ['cli/README.md', 'skill/SKILL.md']) {
  const text = read(rel);
  if (!text.includes('## DECISION') || !text.includes('## BASIS') || !/resume execution/i.test(text)) {
    failures.push(`${rel}: prototype resolution must require DECISION and BASIS to resume execution`);
  }
}

const liveHashPattern = /reviewed\s+acceptance\/result\s+hashes[\s\S]{0,240}current\s+source\s+task\s+acceptance[\s\S]{0,160}current\s+claim-bearing\s+run-node\s+result/i;

for (const rel of ['docs/CORE_MODEL.md', 'docs/MD_FIRST_FORMAT.md']) {
  const text = read(rel);
  if (!/real independent review node/i.test(text)) {
    failures.push(`${rel}: missing real independent review-node contract`);
  }
  if (!liveHashPattern.test(text)) {
    failures.push(`${rel}: missing live current acceptance/result hash contract`);
  }
}

function mirrorPolicyFailures(text, rel) {
  const scopedFailures = [];
  const policyParagraph = text
    .split(/\n\s*\n/)
    .find((paragraph) => /policy-approved EoW records require/i.test(paragraph)) || '';
  if (!/real independent review node/i.test(policyParagraph)) {
    scopedFailures.push(`${rel}: missing real independent review-node contract`);
  }
  if (!liveHashPattern.test(policyParagraph)) {
    scopedFailures.push(`${rel}: missing live current acceptance/result hash contract`);
  }
  if (!/approved review node\/report hash evidence/i.test(policyParagraph)) {
    scopedFailures.push(`${rel}: policy-approved EoW contract must require approved review node/report hash evidence`);
  }
  if (!/policy-bearing review mode\s+\(\s*`enforced`,\s*`guarded`,\s*or\s*`runner-managed`\s*\)/i.test(policyParagraph)) {
    scopedFailures.push(`${rel}: policy-approved EoW contract must require a policy-bearing review mode`);
  }
  return scopedFailures;
}

for (const rel of ['skill/references/core-model.md', 'skill/references/md-first-format.md']) {
  failures.push(...mirrorPolicyFailures(read(rel), rel));
}

const policyScopeFixture = [
  'Policy-approved EoW records require a real independent review node. They must',
  'carry approved review node/report hash evidence, reviewed acceptance/result',
  'hashes that match the current source task acceptance and the current',
  'claim-bearing run-node result, and a policy-bearing review mode (`enforced`,',
  '`guarded`, or `runner-managed`); copied or stale hashes do not approve closure.',
].join('\n');
const policyScopeMutations = [
  ['real independent review node', 'review node', 'real independent review node', 'missing real independent review-node contract'],
  [
    'approved review node/report hash evidence',
    'approved review evidence',
    'approved review node/report hash evidence',
    'must require approved review node/report hash evidence',
  ],
  [
    'reviewed acceptance/result\nhashes that match the current source task acceptance and the current\nclaim-bearing run-node result',
    'reviewed hashes',
    'reviewed acceptance/result hashes match the current source task acceptance and the current claim-bearing run-node result',
    'missing live current acceptance/result hash contract',
  ],
  [
    'policy-bearing review mode (`enforced`,\n`guarded`, or `runner-managed`)',
    'review mode',
    'policy-bearing review mode (`enforced`, `guarded`, or `runner-managed`)',
    'must require a policy-bearing review mode',
  ],
];
for (const [label, replacement, movedToken, expectedFailure] of policyScopeMutations) {
  const mutated = `${policyScopeFixture.replace(label, replacement)}\n\nMoved elsewhere: ${movedToken}.`;
  const mutationFailures = mirrorPolicyFailures(mutated, 'policy-scope-fixture.md');
  if (!mutationFailures.some((failure) => failure.includes(expectedFailure))) {
    failures.push(`policy scope fixture: moving ${label.replaceAll('\n', ' ')} outside the approved EoW paragraph must fail`);
  }
}

if (failures.length) {
  console.error('Contract doc check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('OK: contract docs align with v1 terminology and paths');
