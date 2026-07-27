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

function markdownSectionsMatching(text, titlePattern) {
  const lines = text.split('\n');
  const sections = [];
  const excludedTitlePattern = /deprecated|incorrect|obsolete/i;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(lines[index]);
    if (
      !heading
      || !titlePattern.test(heading[2])
      || excludedTitlePattern.test(heading[2])
    ) {
      continue;
    }
    const level = heading[1].length;
    let end = index + 1;
    while (end < lines.length) {
      const nextHeading = /^(#{1,6})\s+(.+)$/.exec(lines[end]);
      if (nextHeading && nextHeading[1].length <= level) break;
      end += 1;
    }
    const activeLines = [lines[index]];
    let cursor = index + 1;
    while (cursor < end) {
      const nestedHeading = /^(#{1,6})\s+(.+)$/.exec(lines[cursor]);
      if (
        nestedHeading
        && excludedTitlePattern.test(nestedHeading[2])
      ) {
        const excludedLevel = nestedHeading[1].length;
        cursor += 1;
        while (cursor < end) {
          const followingHeading = /^(#{1,6})\s+(.+)$/.exec(lines[cursor]);
          if (
            followingHeading
            && followingHeading[1].length <= excludedLevel
          ) {
            break;
          }
          cursor += 1;
        }
        continue;
      }
      activeLines.push(lines[cursor]);
      cursor += 1;
    }
    sections.push(activeLines.join('\n'));
    index = end - 1;
  }
  return sections.join('\n\n');
}

function identityContractFailures(text, rel) {
  const scopedFailures = [];
  const eowScope = markdownSectionsMatching(
    text,
    /(?:^|\s)EoW(?:\s|$)|Legacy compatibility/i,
  );
  const witnessScope = markdownSectionsMatching(
    text,
    /RunNode|Policy-aware closure/i,
  );
  const requireText = (scope, needle, message) => {
    if (!scope.includes(needle)) scopedFailures.push(`${rel}: ${message}`);
  };
  const requirePattern = (scope, pattern, message) => {
    if (!pattern.test(scope)) scopedFailures.push(`${rel}: ${message}`);
  };

  requireText(
    eowScope,
    'eow-v2-t.<base64url(taskId UTF-8)>.<base64url(taskGroupVersionId UTF-8)>',
    'missing canonical task EoW v2 identity',
  );
  requireText(
    eowScope,
    'eow-v2-r.<base64url(runNodeId UTF-8)>.<base64url(runId UTF-8)>',
    'missing canonical run EoW v2 identity',
  );
  requirePattern(
    eowScope,
    /canonical(?:-v2| v2)[\s\S]{0,120}qualified(?:-v1| v1)[\s\S]{0,120}unqualified(?:-v0| v0)/i,
    'missing canonical-v2, qualified-v1, unqualified-v0 resolver order',
  );
  requirePattern(
    eowScope,
    /qualified-v1 and unqualified-v0[\s\S]{0,160}(?:readable|remain readable)[\s\S]{0,120}(?:immutable|never renamed|never rewritten)/i,
    'missing immutable qualified-v1 and unqualified-v0 compatibility',
  );
  requirePattern(
    eowScope,
    /(?:exact ownership|ownership tuple|complete ownership tuple)[\s\S]{0,180}(?:graphType|requested graph tuple)/i,
    'missing exact full-tuple EoW ownership requirement',
  );
  requirePattern(
    eowScope,
    /qualified(?:-v1| v1)[\s\S]{0,400}(?:lossy collision|recomputes to (?:that|the) same\s+lossy)/i,
    'missing proven qualified-v1 collision rule',
  );
  requirePattern(
    eowScope,
    /(?:byte-identical|byte-for-byte)/i,
    'missing byte-identical legacy EoW reuse rule',
  );
  requirePattern(
    eowScope,
    /255[\s\S]{0,80}UTF-8[\s\S]{0,100}(?:filename|\.md)/i,
    'missing complete-filename UTF-8 byte budget',
  );
  requirePattern(
    eowScope,
    /(?:fatal UTF-8|UTF-8 decoding is fatal)[\s\S]{0,180}(?:canonical base64url|base64url token must re-encode exactly)/i,
    'missing strict canonical v2 decoding rule',
  );
  requirePattern(
    eowScope,
    /(?:edge|edges)[\s\S]{0,120}target[\s\S]{0,160}actual[\s\S]{0,80}EoW ID/i,
    'missing exact reused/created EoW edge-target rule',
  );
  requirePattern(
    witnessScope,
    /actionKind[\s\S]{0,100}attempt[\s\S]{0,100}predecessorRunNodeId[\s\S]{0,140}closureRole[\s\S]{0,100}all absent as properties/i,
    'missing four-witness legacy-only rule',
  );
  requirePattern(
    witnessScope,
    /(?:four|4)[\s\S]{0,80}(?:cohort|modern-cohort)[\s\S]{0,80}own-propert/i,
    'missing own-property witness rule',
  );
  requirePattern(
    witnessScope,
    /any one[\s\S]{0,80}own-property[\s\S]{0,80}selects the modern contract/i,
    'missing any-one-witness modern selection rule',
  );
  requirePattern(
    witnessScope,
    /null or blank[\s\S]{0,120}malformed/i,
    'missing malformed null/blank modern witness rule',
  );
  requirePattern(
    witnessScope,
    /historical\s+malformed[\s\S]{0,180}(?:not\s+policy-approved|cannot remain\s+policy-approved)[\s\S]{0,120}(?:restart|carry-forward)/i,
    'missing historical malformed-claim policy/restart exclusion',
  );
  return scopedFailures;
}

for (const rel of [
  'docs/CORE_MODEL.md',
  'docs/MD_FIRST_FORMAT.md',
  'skill/references/core-model.md',
  'skill/references/md-first-format.md',
]) {
  failures.push(...identityContractFailures(read(rel), rel));
}

const identityScopeSource = read('docs/CORE_MODEL.md');
const identityScopeMutations = [
  {
    start: '### 2.5 EoW',
    end: '### 2.5.1 Partial',
    needle: 'eow-v2-t.<base64url(taskId UTF-8)>.<base64url(taskGroupVersionId UTF-8)>',
    replacement: 'task EoW ids are implementation-defined',
    expectedFailure: 'missing canonical task EoW v2 identity',
  },
  {
    start: '### 2.5 EoW',
    end: '### 2.5.1 Partial',
    needle: 'canonical-v2, lossy qualified-v1, then\noriginal unqualified-v0',
    replacement: 'canonical-v2 only',
    expectedFailure: 'missing canonical-v2, qualified-v1, unqualified-v0 resolver order',
  },
  {
    start: '### 2.5 EoW',
    end: '### 2.5.1 Partial',
    needle: 'exact ownership of the requested graph tuple',
    replacement: 'approximate ownership',
    expectedFailure: 'missing exact full-tuple EoW ownership requirement',
  },
  {
    start: '### 2.5 EoW',
    end: '### 2.5.1 Partial',
    needle: 'recomputes to that same\nlossy ID',
    replacement: 'looks similar',
    expectedFailure: 'missing proven qualified-v1 collision rule',
  },
  {
    start: '### 2.5 EoW',
    end: '### 2.5.1 Partial',
    needle: 'byte-identical',
    replacement: 'rewritten',
    expectedFailure: 'missing byte-identical legacy EoW reuse rule',
  },
  {
    start: '### 2.5 EoW',
    end: '### 2.5.1 Partial',
    needle: '255 UTF-8-byte',
    replacement: 'platform-sized',
    expectedFailure: 'missing complete-filename UTF-8 byte budget',
  },
  {
    start: '### 2.5 EoW',
    end: '### 2.5.1 Partial',
    needle: 'uses fatal UTF-8 decoding',
    replacement: 'uses replacement UTF-8 decoding',
    expectedFailure: 'missing strict canonical v2 decoding rule',
  },
  {
    start: '### 2.5 EoW',
    end: '### 2.5.1 Partial',
    needle: 'actual reused or created EoW ID',
    replacement: 'reconstructed canonical EoW ID',
    expectedFailure: 'missing exact reused/created EoW edge-target rule',
  },
  {
    start: '### 2.8 RunNode',
    end: '### 2.9 RunEdge',
    needle: 'all absent as properties',
    replacement: 'individually optional',
    expectedFailure: 'missing four-witness legacy-only rule',
  },
  {
    start: '### 2.8 RunNode',
    end: '### 2.9 RunEdge',
    needle: 'The four cohort witnesses are own-properties.',
    replacement: 'Inherited witnesses are accepted.',
    expectedFailure: 'missing own-property witness rule',
  },
  {
    start: '### 2.8 RunNode',
    end: '### 2.9 RunEdge',
    needle: 'Any one present own-property\nselects the modern contract',
    replacement: 'Only a complete witness set selects the modern contract',
    expectedFailure: 'missing any-one-witness modern selection rule',
  },
  {
    start: '### 2.8 RunNode',
    end: '### 2.9 RunEdge',
    needle: 'Null or blank modern fields are\nmalformed',
    replacement: 'Null or blank modern fields are legacy',
    expectedFailure: 'missing malformed null/blank modern witness rule',
  },
  {
    start: '### 2.8 RunNode',
    end: '### 2.9 RunEdge',
    needle: 'Historical\nmalformed claims',
    replacement: 'Historical claims',
    expectedFailure: 'missing historical malformed-claim policy/restart exclusion',
  },
];
for (const mutation of identityScopeMutations) {
  const start = identityScopeSource.indexOf(mutation.start);
  const end = identityScopeSource.indexOf(mutation.end, start + 1);
  if (start === -1 || end === -1) {
    failures.push(`identity scope fixture: missing section ${mutation.start}`);
    continue;
  }
  const section = identityScopeSource.slice(start, end);
  if (!section.includes(mutation.needle)) {
    failures.push(`identity scope fixture: missing mutation token ${mutation.needle.replaceAll('\n', ' ')}`);
    continue;
  }
  const mutated = [
    identityScopeSource.slice(0, start),
    section.replace(mutation.needle, mutation.replacement),
    identityScopeSource.slice(end),
    mutation.start.includes('RunNode')
      ? '## Deprecated incorrect RunNode'
      : '## Deprecated incorrect EoW',
    mutation.needle,
  ].join('\n');
  const mutationFailures = identityContractFailures(
    mutated,
    'identity-scope-fixture.md',
  );
  if (
    !mutationFailures.some((failure) => (
      failure.includes(mutation.expectedFailure)
    ))
  ) {
    failures.push(
      `identity scope fixture: moving ${mutation.needle.replaceAll('\n', ' ')} outside its active section must fail`,
    );
  }
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
