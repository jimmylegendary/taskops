# Composite test intent: Research-to-build product spike

- Scenario: exploration first, then decomposition, then execution
- Expected stop: max_steps
- Expected actions: explore, decompose, execute
- Suggested command:

```bash
taskops run works/02-research-to-build-chain --executor dry-run --max-steps 3 --until 2026-05-12T18:30:00+09:00 --json
```
