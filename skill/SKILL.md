---
name: taskops
description: "Manage TaskOps md-first work roots built around versioned task groups, explicit snapshots, and a separate run graph. Use when you need to inspect or author the canonical markdown layout, validate project structure, summarize project state, or work with the TaskOps CLI / Obsidian plugin surfaces."
---

# TaskOps

## Canonical rule

TaskOps v1 is **md-first**.

Canonical state lives in markdown files arranged around:
- `task-groups/`
- `snapshots/`
- `runs/<run-id>/`
- non-canonical `derived/`

Do **not** treat `graph.json` as durable canonical state.
That older path is legacy source material only.

## Read these first

- `references/core-model.md`
- `references/md-first-format.md`
- `references/decomposition-protocol.md`
- `references/run-readiness.md`
- `../examples/taskops-canonical-minimal-v1/`

## Current operating model

- Task graph = decomposition truth
- Run graph = execution truth
- Work = top-level objective container (`entityType: work`; legacy `project` can still be read)
- Task groups are versioned
- Snapshots materialize selected version paths
- EoW (End of Work) is an explicit terminal node, not just a status field
- Run graphs are independent under `runs/<run-id>/` and may reference external runs/tasks without being merged
- Task↔run traceability is bidirectional: task `runRefs` plus run-node `sourceTaskId` / `sourceTaskGroupVersionId`
- Delegation/waiting belongs in the run graph as `type: delegate` / `status: waiting` with delegatee, request, expected output, and optional timeout metadata
- Markdown is canonical; canvas/views are derived
- Shared status vocabulary: `pending | active | done | blocked | waiting | cancelled`
- Before execution, classify task run readiness as `runnable | needs_decomposition | needs_exploration | blocked`
- Use `needs_exploration` when the objective is meaningful but the system does not yet know enough to decompose honestly; exploratory runs may search, try, debug, prototype, and reflect to learn constraints for the next graph update

## Decomposition discipline

- Start with a one-line objective.
- Decompose depth 1 by default.
- Do not turn decomposition into an activity checklist.
- A task can be large but not decomposable yet; if the missing knowledge blocks honest decomposition, create an exploratory run and feed the result back into the task graph.
- A terminal selected branch is not closed until an EoW node is attached.
- Do not continue past a delegated/waiting run node until it resolves, is cancelled, or times out into an explicit follow-up.

## Preferred CLI

Use the npm CLI first:

```bash
taskops validate <path>
taskops summary <path>
taskops show <path> --json
taskops classify-runnable <work-dir> <task-id> --json
taskops init <dir> --id <id> --title <title> --objective <objective>
taskops vault-init <vault-dir> --repo-url <url> --branch <branch> --auto-sync true
taskops git-status <vault-dir>
taskops git-sync <vault-dir> --message <message>
taskops watch-sync <vault-dir> --debounce-ms 5000
taskops decompose <work-dir> --task-group-id <id> --spec <spec.json>
taskops refactor <work-dir> --task-group-id <id> --spec <spec.json> --supersedes <version-id>
```

## Git-backed vault rule

If the user is working in an Obsidian vault that should stay aligned with a GitHub repo, prefer:

1. `taskops vault-init ... --repo-url ... --auto-sync true`
2. keep `.taskops/taskops-sync.json` in the vault root
3. use the desktop Obsidian plugin or `taskops watch-sync`/`taskops git-sync` so local vault edits are pushed back to GitHub instead of drifting

## Legacy note

`python3 scripts/graph_task.py ...` still exists as a migration aid for the earlier graph-task prototype.
Only use it when the task is explicitly about legacy behavior or migration.

## Minimum validation before claiming success

Run:

```bash
taskops validate <work-dir>
taskops summary <work-dir>
```

If you changed the skill itself, also run:

```bash
python3 /home/jimmy/.npm-global/lib/node_modules/openclaw/skills/skill-creator/scripts/package_skill.py <skill-dir> <output-dir>
```
