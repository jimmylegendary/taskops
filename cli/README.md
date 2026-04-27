# TaskOps CLI

npm-distributed CLI for canonical md-first TaskOps projects.

## Commands

- `taskops init <dir> --id ... --title ... --objective ... [--language en|ko]`
- `taskops vault-init <vault-dir> [--repo-url ...] [--branch main] [--auto-sync true] [--language en|ko] [--debounce-ms 5000] [--commit-message ...]`
- `taskops validate <path>`
- `taskops summary <path> [--write]`
- `taskops show <path> [--json]`
- `taskops decompose <project-dir> --task-group-id <id> --spec <spec.json>`
- `taskops refactor <project-dir> --task-group-id <id> --spec <spec.json> --supersedes <version-id>`
- `taskops git-status <vault-dir>`
- `taskops git-sync <vault-dir> [--message ...]`
- `taskops watch-sync <vault-dir> [--debounce-ms 5000] [--message ...]`

## Install

```bash
npm install -g taskops
```

Or from this monorepo during development:

```bash
cd cli
npm pack
npm install -g ./taskops-0.2.0.tgz
```

## Smoke test

```bash
npm test
```

## Vault ↔ GitHub sync

To make an Obsidian vault the git-backed source of truth for TaskOps work:

```bash
taskops vault-init ~/vaults/my-taskops-vault \
  --repo-url git@github.com:ORG/my-taskops-vault.git \
  --branch main \
  --auto-sync true \
  --language en
```

If you also want newly scaffolded TaskOps project values/log lines to follow a language while keeping field names and section labels in English, initialize the project with:

```bash
taskops init ./my-project \
  --id my-project \
  --title "My Project" \
  --objective "Ship the MVP" \
  --language ko
```

This writes `.taskops/taskops-sync.json` in the vault root.

Example config:

```json
{
  "version": 1,
  "enabled": true,
  "language": "en",
  "repoUrl": "git@github.com:ORG/my-taskops-vault.git",
  "branch": "main",
  "debounceMs": 5000,
  "commitMessage": "TaskOps auto-sync",
  "ignorePaths": [
    ".git/",
    ".obsidian/workspace",
    ".obsidian/workspace-mobile"
  ]
}
```

After that you can:

```bash
taskops git-status ~/vaults/my-taskops-vault
taskops git-sync ~/vaults/my-taskops-vault --message "Sync vault changes"
taskops watch-sync ~/vaults/my-taskops-vault --debounce-ms 5000
```

If the Obsidian plugin is installed on desktop, it will also look for `.taskops/taskops-sync.json` and debounce-push vault changes automatically.

## Notes

- This CLI targets the TaskOps v1 model from `../docs/CORE_MODEL.md` and `../docs/MD_FIRST_FORMAT.md`.
- The legacy Python script in `../skill/scripts/graph_task.py` remains a migration aid, not the canonical v1 implementation.
