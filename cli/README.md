# TaskOps CLI

npm-distributed CLI for canonical md-first TaskOps projects.

## Commands

- `taskops init <dir> --id ... --title ... --objective ...`
- `taskops validate <path>`
- `taskops summary <path> [--write]`
- `taskops show <path> [--json]`
- `taskops decompose <project-dir> --task-group-id <id> --spec <spec.json>`
- `taskops refactor <project-dir> --task-group-id <id> --spec <spec.json> --supersedes <version-id>`

## Install

```bash
npm install -g taskops
```

Or from this monorepo during development:

```bash
cd cli
npm pack
npm install -g ./taskops-0.1.0.tgz
```

## Smoke test

```bash
npm test
```

## Notes

- This CLI targets the TaskOps v1 model from `../docs/CORE_MODEL.md` and `../docs/MD_FIRST_FORMAT.md`.
- The legacy Python script in `../skill/scripts/graph_task.py` remains a migration aid, not the canonical v1 implementation.
