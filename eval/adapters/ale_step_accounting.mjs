const STEP_STARTED_EVENT_TYPES = new Set([
  'task_selected',
  'exploration_started',
  'decomposition_started',
  'prototype_started',
  'loopback_started',
]);

export function summarizeAleSteps(events = []) {
  const stream = Array.isArray(events) ? events : [];
  const runnerStopped = [...stream].reverse().find((event) => event?.type === 'runner_stopped') || null;
  if (runnerStopped) {
    const stepsRun = Number(runnerStopped.stepsRun);
    return {
      stepsUsed: Number.isFinite(stepsRun) ? stepsRun : null,
      estimated: false,
    };
  }

  // runner_stopped 전에 프로세스가 죽으면 정본은 없다. 이때만 실제 dispatch 시작 이벤트를 세며,
  // execute 한 건에 함께 발화하는 task_started 는 task_selected 와 중복이므로 의도적으로 제외한다.
  return {
    stepsUsed: stream.filter((event) => STEP_STARTED_EVENT_TYPES.has(event?.type)).length,
    estimated: true,
  };
}
