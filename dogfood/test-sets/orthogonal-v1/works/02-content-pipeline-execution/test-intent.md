# Test intent: Content pipeline cleanup execution path

- Case: A: runnable execution throughput
- Example: 2
- Expected stop: max_steps
- Suggested command:

```bash
taskops run works/02-content-pipeline-execution --executor dry-run --max-steps 5 --until 2026-05-12T18:00:00+09:00 --json
```
