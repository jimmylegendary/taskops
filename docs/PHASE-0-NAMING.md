# TaskOps Phase 0 — naming, glossary, and monorepo decisions

## Decisions

### Product / framework name
- **TaskOps**

### Repo strategy
- use **one monorepo** for skill, CLI, and Obsidian plugin
- keep shared docs/examples in the same repo
- release artifacts separately per surface

### Distribution channels
- `skill/` → ClawHub
- `cli/` → npm
- `obsidian-plugin/` → GitHub Release assets
- all three still roll up under GitHub Releases for canonical release history

## Naming map

| old | new | notes |
| --- | --- | --- |
| graph-task | TaskOps | umbrella concept/framework |
| graph-task skill | TaskOps skill | OpenClaw skill package |
| graph-task obsidian | TaskOps Obsidian plugin | Obsidian surface |
| graph-task md-first protocol | TaskOps md-first protocol | canonical storage contract |

## Canonical glossary

### Objective
The goal a decomposition unit is trying to fully accomplish.

### Task
A child responsibility unit inside a decomposition.
A task exists in the **task graph**, not as a generic execution event.

### Task group
A decomposition unit composed of:
- one objective
- its directly attached child tasks
- the structural rules that make that decomposition valid

This is the main versioned unit.

### Task group version
A specific decomposition of a task group.
Refactor creates a new version instead of overwriting the old one.

### Task graph
The graph that represents decomposition truth.
Its purpose is to guarantee:
- coverage
- responsibility orthogonality
- closure

Allowed operations are intentionally narrow:
- `decompose`
- `refactor`

### Run graph
The graph that represents execution truth.
It may contain multiple task levels, overlaps, shared work, and cross-links.

### Snapshot
A selected version path across relevant task groups.
Snapshots should represent chosen structure states, not all possible combinatorial states.

### Responsibility orthogonality
Two sibling tasks may influence each other in reality, but they must not have overlapping primary responsibility or overlapping completion judgment.

### Coverage
The child tasks of a task group must be sufficient to fully accomplish the parent objective.

### Closure
Each task must have a clear local notion of what completion means.

## Initial monorepo layout

```text
/taskops
  /docs
  /examples
  /skill
  /cli
  /obsidian-plugin
```

## Migration posture

This reset should preserve learning, not preserve every old file path.

Immediate rule:
- preserve useful code, examples, and tests
- rename user-facing concepts first
- normalize internal filenames incrementally when it improves clarity

## Immediate next docs
- `CORE_MODEL.md`
- `MD_FIRST_FORMAT.md`
