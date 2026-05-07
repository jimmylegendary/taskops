---
taskOpsVersion: v1
entityType: task
id: task-run
taskGroupId: tg-root
taskGroupVersionId: tgv-root-v1
title: Record execution truth separately
objective: Show that execution reality lives under runs/<run-id>/ rather than inside the decomposition tree.
responsibility: Own the minimal run graph fixture.
completionCriteria: At least one run node and one run edge exist and point to real ids.
order: 3
runRefs:
  - runId: run-alpha-v1
    runNodeId: run-node-human-decision
    role: delegation
createdAt: 2026-04-27T03:10:00+09:00
status: active
---

# Record execution truth separately
