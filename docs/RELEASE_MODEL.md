# TaskOps release model

## Source of truth

Use **one GitHub repository** and **GitHub Releases** as the canonical release timeline.

## Distribution targets

### 1. Skill
- source: `skill/`
- distribution channel: ClawHub
- release expectation: packaged and published from GitHub release workflow

### 2. CLI
- source: `cli/`
- distribution channel: npm
- release expectation: published from GitHub release workflow

### 3. Obsidian plugin
- source: `obsidian-plugin/`
- distribution channel: GitHub Release assets
- release expectation: attach built plugin artifacts to the matching GitHub Release

## Version strategy

Initial recommendation:
- keep one shared repo version across all three surfaces during the early co-evolution phase
- only split versioning later if release cadence and compatibility boundaries truly diverge

## Build/release philosophy

- one repo, one release event
- three artifacts
- each artifact may have its own packaging rules
- release pipeline should fail honestly if one artifact is not releasable

## Near-term workflow

1. tag repo version
2. create GitHub Release
3. build skill artifact
4. publish skill to ClawHub
5. build/publish CLI to npm
6. build plugin bundle and attach release assets

## Important implementation note

The first release pipeline should optimize for explicitness over cleverness.
It is better to have a small transparent workflow than a highly abstracted pipeline that obscures failures.
