# Test intent: Flaky test investigation path

- Case: C: exploration before decomposition
- Example: 1
- Expected stop: max_steps
- Suggested command:

```bash
taskops run works/05-flaky-test-exploration --executor dry-run --max-steps 2 --until 2026-05-12T16:10:00+09:00 --json
```
