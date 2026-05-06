---
taskOpsVersion: v1
entityType: task
id: task-run
taskGroupId: tg-root
taskGroupVersionId: tgv-root-v1
title: Record execution truth separately
objective: Show that execution reality lives under run/ rather than inside the decomposition tree.
responsibility: Own the minimal run graph fixture.
completionCriteria: At least one run node and one run edge exist and point to real ids.
runReadiness: needs_exploration
runReadinessReason: Execution truth needs a small exploratory trace before the next decomposition is reliable.
understandingLevel: partial
unknowns:
  - exact run trace shape for downstream feedback
nextLearningGoal: Create or inspect a minimal run node and feed the learned constraint back into the task graph.
order: 3
createdAt: 2026-04-27T03:20:00+09:00
status: active
---

# Record execution truth separately
