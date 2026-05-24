# UX Reviewer

Review an implementation plan against UX principles, design system constraints, and accessibility requirements. Ensure all user-facing states are accounted for before any code is written.

## When This Skill Activates

After architect-review, before task decomposition. The plan has been validated structurally — this step validates it from the user's perspective.

## Inputs

- `plan.md` — the architect-reviewed implementation plan
- `.marathon/inputs/constraints.md` — accessibility standards and UX requirements
- `.marathon/inputs/product.md` — product principles and user personas

## Outputs

- `ux-review.md` — findings, recommendations, and required changes

## Review Checklist

### State Coverage
For every user-facing component or flow in the plan, verify these states are addressed:
- **Empty state** — what does the user see when there's no data?
- **Loading state** — what happens while data is fetching?
- **Error state** — what does the user see when something fails?
- **Partial state** — what about incomplete data, partial failures, pagination boundaries?
- **Success state** — confirmation, feedback, next steps after an action completes
- **Edge cases** — very long text, very short text, special characters, zero items, one item, many items

### Accessibility
- Can every interactive element be reached and operated via keyboard alone?
- Do all form fields have visible labels (not just placeholders)?
- Are color-dependent indicators paired with non-color alternatives (icons, text)?
- Is the heading hierarchy logical (h1 → h2 → h3, no skips)?
- Are ARIA labels provided where semantic HTML is insufficient?
- Does the plan account for screen reader announcements on dynamic content updates?

### Interaction Design
- Is the flow intuitive? Does the user know what to do at every step?
- Are destructive actions (delete, cancel, overwrite) protected with confirmation?
- Is there a way to undo or recover from mistakes?
- Are success and error feedback immediate and visible?
- Do forms validate inline (not just on submit)?

### Responsive Design
- Does the plan address mobile, tablet, and desktop layouts?
- Are touch targets at least 44x44px on mobile?
- Does the navigation adapt to small screens?

### Consistency
- Does the plan use existing components from the design system rather than creating new ones?
- Are interaction patterns consistent with the rest of the product?
- Are naming conventions (button labels, page titles, error messages) consistent?

## Output Format for ux-review.md

```markdown
# UX Review — Sprint {N}

## Critical (Must Fix Before Implementation)
- [Issue]: [What's wrong] — [How to fix it]

## Important (Should Fix)
- [Issue]: [What's wrong] — [How to fix it]

## Suggestions (Nice to Have)
- [Idea]: [Why it would improve UX]

## Missing States
| Component/Flow | Missing State | Recommendation |
|---|---|---|
| ... | ... | ... |

## Accessibility Gaps
| Element | Gap | WCAG Criterion | Fix |
|---|---|---|---|
| ... | ... | ... | ... |
```

## Behavior

1. Read the plan thoroughly, focusing on every user-facing surface.
2. Read `constraints.md` for accessibility standards and UX requirements.
3. Read `product.md` for product principles that should guide UX decisions.
4. Walk through every user flow described in the plan. For each flow, mentally simulate the user experience.
5. Check every item on the review checklist.
6. Write `ux-review.md` with concrete, actionable findings — not vague suggestions.
7. Categorize findings by severity: Critical (blocks implementation), Important (should fix), Suggestions (nice to have).
8. For every issue, provide a specific recommendation, not just a flag.
