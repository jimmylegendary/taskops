# TaskOps Dogfood Evidence Log

Purpose: collect real usage evidence before public promotion.

This is not marketing copy. It is the raw product proof log: where TaskOps helped, where it failed, what changed because of the failure, and whether the run graph was useful after the fact.

## Evidence criteria

For each real work, record:

- **Work**: objective and path
- **Context**: what kind of work it was
- **TaskOps usage**: commands/features used
- **Observed value**: what TaskOps made clearer, safer, or easier
- **Observed friction**: what felt confusing, too heavy, wrong, or missing
- **Runner behavior**: stop reasons, readiness dispatch, run graph quality
- **Recovery/review value**: whether the logs were useful later
- **Outcome**: completed, open, blocked, abandoned, or converted into product change
- **Product lesson**: what to keep/change in TaskOps
- **Evidence strength**: weak / medium / strong

## Summary dashboard

| Date | Work | Type | Outcome | Evidence strength | Main lesson |
|---|---|---|---|---|---|
| 2026-05-12 | healthy-weight-loss-3mo | non-code planning / runner semantics test | open / blocked honestly | medium | Runner needed to dispatch `needs_decomposition` and `needs_exploration`, not only `runnable`. |
| 2026-05-12 | TaskOps 0.4.2–0.4.4 release | code/product/release | completed | strong | TaskOps dogfood exposed runner semantics, reuse edge case, and positioning gaps before broader promotion. |

---

## 2026-05-12 — healthy-weight-loss-3mo

- **Work**: `healthy-weight-loss-3mo`
- **Path**: `/home/jimmy/.openclaw/workspace/taskops/projects/healthy-weight-loss-3mo`
- **Objective**: `3개월 안에 10kg을 건강하게 감량한다.`
- **Context**: non-code behavior-change planning; used as a TaskOps runner semantics exercise.
- **TaskOps usage**:
  - created md-first work root
  - ran `taskops validate`
  - ran `taskops summary`
  - ran `taskops run --executor dry-run --max-steps 100`
- **Observed value**:
  - made it clear that the work should remain open rather than fake-completed
  - `blocked_only` was an honest stop once only baseline/human-input tasks remained
  - summary made visible which branches had EoW and which remained open
- **Observed friction / bug found**:
  - initial runner only consumed `runnable`; it stopped before decomposing `needs_decomposition`
  - Jimmy corrected the semantics: blocked should be excluded, but decomposable/explorable tasks are actions
- **Runner behavior**:
  - after fix, `task-food-system`, `task-movement-system`, and `task-risk-plateau-handling` decomposed into child groups
  - stopped with `blocked_only`
- **Recovery/review value**: medium; run log and summary explained why the work was open and what user input was required.
- **Outcome**: open, intentionally blocked on real baseline/human health input.
- **Product lesson**: readiness is dispatch, not filtering. Runner must perform the task's action according to readiness.
- **Evidence strength**: medium.

## 2026-05-12 — TaskOps 0.4.2–0.4.4 release cycle

- **Work**: TaskOps runner/README/release improvement
- **Path**: `/home/jimmy/.openclaw/workspace/taskops`
- **Objective**: make the runner semantics usable, publish, then sharpen public README positioning after feedback.
- **Context**: real code/product/release work.
- **TaskOps usage**:
  - used the healthy-weight-loss work as a runner test fixture
  - used release verification commands: `npm run verify`, `npm run release:preflight`
  - used published smoke checks after npm/ClawHub install
- **Observed value**:
  - dogfood caught a real conceptual bug before promotion: `needs_decomposition`/`needs_exploration` must be active runner actions
  - dogfood caught an edge bug in `0.4.2`: dry-run decomposition failed when the child group already existed; fixed in `0.4.3`
  - product-positioning feedback led to `0.4.4` README rewrite around execution graphs rather than TODO lists
- **Observed friction**:
  - publish workflow appeared successful but npm/ClawHub jobs skipped due missing GitHub Actions secrets; manual publish was needed
  - ClawHub old CLI had timeout/license-prompt friction; `npx clawhub@latest` solved publish
- **Runner behavior**:
  - published `0.4.3/0.4.4` smoke showed `decompose:completed` and `explore:completed`
  - `taskops validate` passed after smoke
- **Recovery/review value**: strong; release sequence and post-publish checks produced clear proof of what changed and why.
- **Outcome**: completed; latest public release `0.4.4`.
- **Product lesson**: TaskOps needs not only correct mechanics, but proof-oriented release/dogfood records and sharper onboarding language.
- **Evidence strength**: strong.
