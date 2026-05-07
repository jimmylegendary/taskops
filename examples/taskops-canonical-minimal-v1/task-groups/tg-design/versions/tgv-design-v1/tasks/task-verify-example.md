---
taskOpsVersion: v1
entityType: task
id: task-verify-example
taskGroupId: tg-design
taskGroupVersionId: tgv-design-v1
title: Verify example reachability
objective: Ensure the chosen snapshot and run graph can be inspected directly from disk.
responsibility: Own the example-level coherence check.
completionCriteria: A human can trace selected versions and run references without hidden state.
runReadiness: runnable
runReadinessReason: Objective, responsibility, and completion criteria define one checkable run.
understandingLevel: known
order: 2
runRefs:
  - runId: run-alpha-v1
    runNodeId: run-node-verify
    role: verification
createdAt: 2026-04-27T03:20:00+09:00
status: done
---

# Verify example reachability
