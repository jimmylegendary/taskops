#!/usr/bin/env node
import assert from 'node:assert/strict';
import { summarizeAleSteps } from './ale_step_accounting.mjs';

{
  const summary = summarizeAleSteps([
    { type: 'task_selected' },
    { type: 'exploration_started' },
    { type: 'runner_stopped', stepsRun: '7' },
  ]);
  assert.deepEqual(
    summary,
    { stepsUsed: 7, estimated: false },
    'runner_stopped가 있으면 이벤트 합이 아니라 stepsRun 정본을 사용해야 한다',
  );
}

{
  const summary = summarizeAleSteps([
    { type: 'runner_started' },
    { type: 'task_selected' },
    { type: 'task_started' },
    { type: 'exploration_started' },
    { type: 'decomposition_started' },
    { type: 'prototype_started' },
    { type: 'loopback_started' },
    { type: 'exploration_completed' },
  ]);
  assert.deepEqual(
    summary,
    { stepsUsed: 5, estimated: true },
    'runner_stopped가 없으면 중복 task_started가 아닌 실제 dispatch 시작 이벤트만 합산해야 한다',
  );
}

{
  const summary = summarizeAleSteps([
    { type: 'task_selected' },
    { type: 'runner_stopped', stepsRun: 'not-a-number' },
  ]);
  assert.deepEqual(
    summary,
    { stepsUsed: null, estimated: false },
    'runner_stopped가 존재하면 손상된 정본을 추정치로 조용히 대체하면 안 된다',
  );
}

console.log('ale-step-accounting smoke passed');
