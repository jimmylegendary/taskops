# Test intent: Expired deadline path

- Case: E: stop-condition deadline
- Example: 2
- Expected stop: deadline_reached
- Suggested command:

```bash
taskops run works/10-deadline-reached-before-work --executor dry-run --max-steps 100 --until 2026-01-01T00:00:00+09:00 --json
```
