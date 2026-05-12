# Composite test intent: Marketing campaign with budget gate

- Scenario: waiting task blocks otherwise actionable tasks
- Expected stop: waiting
- Expected actions: execute
- Suggested command:

```bash
taskops run works/04-campaign-with-human-wait --executor dry-run --max-steps 10 --until 2026-05-13T09:00:00+09:00 --json
```
