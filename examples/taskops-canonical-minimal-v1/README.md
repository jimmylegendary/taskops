# TaskOps canonical minimal v1 example

This is the canonical minimal `TaskOps` v1 example referenced by the main docs.

It demonstrates:
- one work root
- one root task group with a selected version
- one child task group with its own selected version
- one explicit snapshot that materializes the chosen version path
- one separate run graph under `runs/<run-id>/` that records execution reality
- explicit task/run EoW terminal nodes
- bidirectional task↔run references on the executed/verified tasks
- one clearly non-canonical `derived/` area
