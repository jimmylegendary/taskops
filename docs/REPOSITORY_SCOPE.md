# Repository scope

TaskOps core currently consists of the CLI, core documentation, the maintained
TaskOps skill contract, deterministic tests, and CI.

The `obsidian-plugin/` tree is preserved source, but it is not an npm workspace,
version-sync participant, verification target, build artifact, or CI path.
The CLI package is private and the repository has no automated publication or
tag-triggered artifact assembly.

Reactivation requires an explicit design review, removal of `private` only for
the intended package, restoration of dedicated verification, and a separately
reviewed publication workflow. A version bump or tag alone is insufficient.
