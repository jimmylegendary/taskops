# Composite test intent: Composite work with expired deadline

- Scenario: deadline has priority before action dispatch
- Expected stop: deadline_reached
- Expected actions: (none)
- Suggested command:

```bash
taskops run works/06-deadline-cuts-composite-work --executor dry-run --max-steps 10 --until 2026-01-01T00:00:00+09:00 --json
```
