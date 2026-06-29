#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fmBlock,
  parseMarkdownFile,
  readBody,
} from '../lib-taskops.js';
import { updateMarkdownFrontmatter } from '../lib-state-writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'taskops-state-writer-frontmatter-'));

function legacyRewriteFrontmatter(filePath, updater) {
  const fm = parseMarkdownFile(filePath);
  const body = readBody(filePath);
  const next = updater({ ...fm }) ?? fm;
  const text = fmBlock(next) + (body ? body + '\n' : '');
  writeFileSync(filePath, text, 'utf8');
}

function writeViaFacade(filePath, updater) {
  return updateMarkdownFrontmatter(filePath, updater, {
    parseMarkdownFile,
    readBody,
    fmBlock,
    writeTextFile: (targetPath, text) => writeFileSync(targetPath, text, 'utf8'),
  });
}

function seedMarkdown(filePath) {
  writeFileSync(filePath, [
    '---',
    'taskOpsVersion: v1',
    'entityType: task',
    'id: task-state-writer',
    'status: pending',
    'runReadiness: runnable',
    'knownList:',
    '  - id: k1',
    '    claim: Existing claim',
    '---',
    '# Task State Writer',
    '',
    'Body line one.',
    '',
  ].join('\n'), 'utf8');
}

const legacyPath = join(tempRoot, 'legacy.md');
const facadePath = join(tempRoot, 'facade.md');
seedMarkdown(legacyPath);
seedMarkdown(facadePath);

const updater = (fm) => {
  fm.status = 'done';
  fm.runReadiness = 'blocked';
  fm.runReadinessReason = 'state writer parity check';
  fm.knownList = [...(Array.isArray(fm.knownList) ? fm.knownList : []), { id: 'k2', claim: 'Added claim' }];
  return fm;
};

legacyRewriteFrontmatter(legacyPath, updater);
writeViaFacade(facadePath, updater);
assert.equal(readFileSync(facadePath, 'utf8'), readFileSync(legacyPath, 'utf8'), 'facade output should match legacy rewriteFrontmatter output byte-for-byte');

const legacyNoReturnPath = join(tempRoot, 'legacy-no-return.md');
const facadeNoReturnPath = join(tempRoot, 'facade-no-return.md');
seedMarkdown(legacyNoReturnPath);
seedMarkdown(facadeNoReturnPath);

legacyRewriteFrontmatter(legacyNoReturnPath, (fm) => {
  fm.status = 'done';
});
writeViaFacade(facadeNoReturnPath, (fm) => {
  fm.status = 'done';
});
assert.equal(readFileSync(facadeNoReturnPath, 'utf8'), readFileSync(legacyNoReturnPath, 'utf8'), 'facade should preserve legacy nullish-updater semantics');

for (const rel of ['cli/lib-runner.js', 'cli/lib-taskops.js']) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  assert.equal(/\brewriteFrontmatter(?:InPlace)?\s*\(/.test(text), false, `${rel} should not call legacy rewriteFrontmatter helpers directly`);
}

console.log('OK state writer frontmatter facade');
