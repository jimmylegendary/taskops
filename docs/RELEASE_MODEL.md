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

Current repo wiring: `.github/workflows/release.yml` now provides the first transparent release skeleton for verify + artifact build + GitHub Release asset upload, with npm/ClawHub publish hooks intentionally kept explicit and lightly gated.
The npm publish job now downloads and publishes the already-built CLI tarball artifact, so npm publication follows the same assembled release payload instead of taking a separate source-path shortcut.
The repo-level `npm run verify` path now also checks shared version sync across the root package, CLI package, Obsidian plugin package, and plugin manifest so the single-version release assumption fails early if those surfaces drift.
For local preflight, `npm run release:preflight` now wraps the full release rehearsal (`build:release` plus the artifact-based npm dry-run), while `npm run build:release` still assembles the same three release artifacts under `dist/release/v<version>/` after running the full verify gate.
The GitHub Actions release workflow now delegates artifact assembly to that same script, reducing drift between local preflight and tagged-release behavior.
That script also accepts `TASKOPS_RELEASE_VERSION`; when CI passes the tag-derived version through, the script checks it against `package.json` and fails early on tag/package mismatch instead of silently building inconsistent release artifacts.
The same script now also asserts that the final release directory contains exactly the expected three versioned files (CLI tarball, plugin zip, skill package), so partial/extra artifact output fails before upload.
It now checks for required local commands up front as well (`node`, `npm`, `python3`, `zip`) so preflight failures are immediate and readable instead of surfacing later as half-built releases.
The artifact-based npm publish path also has a local smoke confirmation now: `npm run smoke:publish-artifact` dry-runs `npm publish` against `dist/release/v<version>/taskops-<version>.tgz`, which gives a low-risk sanity check before relying on the workflow job to publish that same artifact.
The GitHub Actions release workflow now calls the same `npm run release:preflight` wrapper used locally, so the CI path performs the full release rehearsal (artifact build plus tarball publish dry-run) before the real publish job is allowed to use the downloaded artifact.
When `CLAWHUB_TOKEN` is configured, the workflow also installs the ClawHub CLI, logs in non-interactively, and publishes the repo's `skill/` folder as the matching TaskOps skill version with `--no-input`, replacing the earlier placeholder job.
Automated publishing expects two repository secrets: `NPM_TOKEN` for the npm tarball publish job and `CLAWHUB_TOKEN` for the ClawHub skill publish job.
A manual `workflow_dispatch` run still executes verify/build/release-asset assembly, but the actual publish jobs remain gated to `v*` tag refs so ad-hoc rehearsals cannot publish by accident.

## Important implementation note

The first release pipeline should optimize for explicitness over cleverness.
It is better to have a small transparent workflow than a highly abstracted pipeline that obscures failures.
