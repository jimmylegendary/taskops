> This decision was escalated to an external resolver because it could not be
> settled during execution. It is kept as an independent, reviewable node so the
> question, the options weighed, and the final decision all stay traceable —
> rather than being folded silently into a result. The escalating agent fills
> QUESTION / OPTIONS / ESCALATION_BASIS. The resolver fills DECISION / BASIS, then saves.

## QUESTION
<agent: the single decision that could not be settled — one decision unit, crisp>

## OPTIONS
<agent: candidate answers with trade-offs; if you cannot enumerate them, add an
explicit "open:" line naming what is unknown — do not leave this empty>

## ESCALATION_BASIS
<agent: why this could not be self-resolved into a defensible assumption — the
specific information, authority, or judgement that was missing (required)>

## DECISION
<resolver: the concrete, downstream-consumable choice — a value, not prose>

## BASIS
<resolver: the grounds for this decision>