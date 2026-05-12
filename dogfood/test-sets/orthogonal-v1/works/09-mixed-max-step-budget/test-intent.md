# Test intent: Mixed readiness max-step budget path

- Case: E: stop-condition budget
- Example: 1
- Expected stop: max_steps
- Suggested command:

```bash
taskops run works/09-mixed-max-step-budget --executor dry-run --max-steps 2 --until 2026-05-12T21:00:00+09:00 --json
```
