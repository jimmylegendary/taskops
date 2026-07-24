# TaskOps skill

**AI agent work cannot be managed as a flat TODO list.**

TaskOps is a markdown-canonical execution control protocol for keeping human + AI work honest: separate the decomposition truth from execution reality, record blockers and delegation explicitly, and only close work when there is visible evidence.

## Canonical shape

TaskOps v1 separates:
- **work root** at `index.md` with `entityType: work`
- **task graph** under `task-groups/`
- **snapshot selection** under `snapshots/`
- **execution truth** under independent `runs/<run-id>/` graphs
- **EoW terminal nodes** under task-version `eow/` folders and run `nodes/`
- **derived views** under `derived/`

Markdown is canonical.
Derived canvas/views are not.

## Current surfaces

- `../cli/` — private local `taskops` CLI workspace for `init / validate / summary / show / decompose / refactor / run` plus git-backed vault setup/sync
- `../obsidian-plugin/` — preserved source outside the active verification surface
- `scripts/graph_task.py` — legacy graph-task prototype kept only as migration/source material

## Main working references

- `../docs/CORE_MODEL.md`
- `../docs/MD_FIRST_FORMAT.md`
- `../examples/taskops-canonical-minimal-v1/`
- `SKILL.md`

## Local workspace

Run the private CLI from the repository root:

```bash
npm ci
npm run verify
node cli/bin/taskops.js --help
```

## Core operating loop

```bash
taskops init <work-dir> --id <id> --title <title> --objective <objective>
taskops validate <work-dir>
taskops audit <work-dir> --strict
taskops summary <work-dir>
taskops classify-runnable <work-dir> <task-id> --json
taskops run <work-dir> --executor dry-run --max-steps 1 --json
```

Use `dry-run` for smoke tests and graph rehearsals. Use `--executor openclaw-agent --agent <agent-id>` when the user wants real agent execution.

## Good fit

TaskOps is strongest for complex agentic work such as refactors, migrations, research-to-implementation loops, and multi-step investigations where the user needs to know:

- what the goal is
- how it was decomposed
- what actually ran
- what got blocked, delegated, or explored
- why a branch is truly closed

## Validation stance

Prefer the CLI for current validation and summaries:

```bash
taskops validate <work-dir>
taskops audit <work-dir> --strict
taskops summary <work-dir>
```

Use `taskops audit --strict` before treating TaskOps output as a strong paper, benchmark, release, or unattended-work completion claim. It is the work-level claim gate for shallow flat decomposition, manual EoW closure, structural-but-unapproved completion, and queue projection mismatches.

Current execution contracts distinguish `needs_exploration` from
`needs_prototype`: exploration closes only supporting evidence while the source
task stays open; prototype success requires a non-empty UTF-8 `options.md` and
waits for a human resolver. Supporting closures do not enter the policy
denominator, claim-bearing closures require matching independent review, and a
structurally closed graph with an unapproved claim reports
`graph_closed_unapproved` rather than `all_closed`.

Runner action attempts carry immutable action/attempt/predecessor identity.
Restart rebases internal task blockers onto the new selected version and rejects
stale selected references. CLI `--json` output is fully drained before the exit
status is set, so piped and redirected payloads are complete.

For a git-backed Obsidian vault workflow:

```bash
taskops vault-init <vault-dir> --repo-url <github-repo-url> --branch main --auto-sync true
taskops git-sync <vault-dir> --message "Sync vault changes"
```

Only use the legacy Python script when the work is explicitly about old graph-task compatibility or migration.
