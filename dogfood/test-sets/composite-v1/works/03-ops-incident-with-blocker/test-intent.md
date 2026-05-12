# Composite test intent: Ops incident triage with remaining blockers

- Scenario: mixed actionable tasks then blocked_only
- Expected stop: blocked_only
- Expected actions: execute, explore, decompose
- Suggested command:

```bash
taskops run works/03-ops-incident-with-blocker --executor dry-run --max-steps 10 --until 2026-05-12T22:00:00+09:00 --json
```
