#!/usr/bin/env node
// Regression (ultrareview C3): a worker's full ASSUMPTION->DECISION->BASIS disclosure must not be lost to
// the 1000-char single-line run-node summary. When the raw output would be truncated/collapsed it is
// persisted verbatim as a durable evidence file (the training-data record).
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistExecutorDisclosure } from '../lib-runner.js';

const dir = mkdtempSync(join(tmpdir(), 'taskops-disclosure-'));

// A long, multi-line disclosure whose tail sits well past the 1000-char summary cutoff.
const long = `ASSUMPTION: the API is stable -> DECISION: use v2 -> BASIS: changelog\n${'detail line to pad past the cutoff\n'.repeat(60)}FINAL_DECISION_MARKER: chose Postgres over MySQL for CTE support`;
assert.ok(long.length > 1000, 'fixture must exceed the cutoff');

const ref = persistExecutorDisclosure({ projectDir: dir, runId: 'run-main', runNodeId: 'run-node-1', message: long });
assert.equal(ref, 'runs/run-main/artifacts/run-node-1/executor-output.md', 'C3: returns a project-relative disclosure ref');
const saved = readFileSync(join(dir, ref), 'utf8');
assert.ok(saved.includes('DECISION: use v2') && saved.includes('BASIS: changelog'), 'C3: DECISION/BASIS preserved');
assert.ok(saved.includes('FINAL_DECISION_MARKER: chose Postgres'), 'C3: content past the 1000-char cutoff is preserved verbatim');

// Short single-line output (e.g. dry-run) needs no separate file and is unaffected.
const shortRef = persistExecutorDisclosure({ projectDir: dir, runId: 'run-main', runNodeId: 'run-node-2', message: 'dry-run executor synthetically completed task X' });
assert.equal(shortRef, null, 'C3: short single-line output needs no separate disclosure file');
assert.equal(existsSync(join(dir, 'runs/run-main/artifacts/run-node-2/executor-output.md')), false, 'C3: no file for short output');

rmSync(dir, { recursive: true, force: true });
console.log('OK executor disclosure (C3)');
