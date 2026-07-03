#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXTERNAL_RESOLUTION_TEMPLATE,
} from '../lib-runner.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(scriptDir, '..');
const repoDir = resolve(cliDir, '..');
const templatePath = resolve(repoDir, 'skill', 'external-resolution-template.md');

assert.equal(
  readFileSync(templatePath, 'utf8'),
  EXTERNAL_RESOLUTION_TEMPLATE,
  'skill/external-resolution-template.md must stay byte-identical to EXTERNAL_RESOLUTION_TEMPLATE',
);
assert.equal(
  Buffer.byteLength(EXTERNAL_RESOLUTION_TEMPLATE, 'utf8'),
  988,
  'EXTERNAL_RESOLUTION_TEMPLATE must be 988 bytes (structural checksum)',
);

for (const heading of ['## QUESTION', '## OPTIONS', '## ESCALATION_BASIS', '## DECISION', '## BASIS']) {
  assert.ok(EXTERNAL_RESOLUTION_TEMPLATE.includes(heading), `template must contain ${heading}`);
}

console.log('OK external resolution template');
