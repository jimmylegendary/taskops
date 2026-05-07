---
taskOpsVersion: v1
entityType: runNode
id: run-node-human-decision
runId: run-alpha-v1
type: delegate
title: Ask Jimmy to confirm the next execution constraint
status: waiting
sourceTaskId: task-run
sourceTaskGroupVersionId: tgv-root-v1
delegateeType: human
delegateeRef: jimmy
request: Confirm whether the execution trace should wait for a human decision before the next run branch.
expectedOutput: A clear yes/no decision plus any constraint that should update the task graph.
requestedAt: 2026-05-08T04:45:00+09:00
timeoutAt: 2026-05-10T04:45:00+09:00
createdAt: 2026-05-08T04:45:00+09:00
---

# Delegate: ask Jimmy for the next execution constraint
