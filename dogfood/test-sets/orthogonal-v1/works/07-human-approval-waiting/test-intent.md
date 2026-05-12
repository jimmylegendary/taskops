# Test intent: Human approval waiting path

- Case: D: waiting stop
- Example: 1
- Expected stop: waiting
- Suggested command:

```bash
taskops run works/07-human-approval-waiting --executor dry-run --max-steps 10 --until 2026-05-13T09:00:00+09:00 --json
```
