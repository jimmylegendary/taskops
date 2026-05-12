# Test intent: Delegated design review pending path

- Case: D: delegated waiting stop
- Example: 2
- Expected stop: delegation_pending
- Suggested command:

```bash
taskops run works/08-delegated-review-pending --executor dry-run --max-steps 10 --until 2026-05-13T12:00:00+09:00 --json
```
