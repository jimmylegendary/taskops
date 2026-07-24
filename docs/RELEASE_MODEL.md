# TaskOps release model

There is no active public release pipeline in the current core-stabilization
scope. See [REPOSITORY_SCOPE.md](./REPOSITORY_SCOPE.md) for the active surface
and the explicit review required before any distribution path is restored.

The current local quality gate is:

```bash
npm ci
npm run verify
```
