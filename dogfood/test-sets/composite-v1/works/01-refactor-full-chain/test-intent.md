# Composite test intent: AI-assisted OAuth refactor full chain

- Scenario: execute + decompose + explore in one bounded run
- Expected stop: max_steps
- Expected actions: execute, decompose, explore, execute
- Suggested command:

```bash
taskops run works/01-refactor-full-chain --executor dry-run --max-steps 4 --until 2026-05-12T17:30:00+09:00 --json
```
