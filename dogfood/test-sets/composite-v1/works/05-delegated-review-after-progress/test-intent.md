# Composite test intent: Design review delegation after initial work

- Scenario: first run progresses, second run sees delegate pending
- Expected stop: delegation_pending
- Expected actions: (none)
- Suggested command:

```bash
taskops run works/05-delegated-review-after-progress --executor dry-run --max-steps 10 --until 2026-05-13T12:00:00+09:00 --json
```
