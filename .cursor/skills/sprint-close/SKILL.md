# Sprint Close

Finalize a completed sprint: merge to main, update requirements status, write the retrospective, capture tech debt, and prepare context for the next sprint.

## When This Skill Activates

After all implementation, review, testing, and follow-up loops are complete (or the follow-up loop limit has been reached).

## Inputs

- All sprint artifacts in `.marathon/sprints/{NNN}/`:
  - `spec.md`, `plan.md`, `tasks.md` — what was planned
  - `test-report.md`, `ux-test-report.md`, `ux-feedback.md` — what was tested
  - `follow-up-tasks.md` — any remaining issues from the follow-up loop
- `.marathon/inputs/requirements.md` — to update status markers
- `.cursor/rules/sprint-context.md` — to update for next sprint
- Git history of the sprint branch

## Outputs

- `.marathon/sprints/{NNN}/sprint-report.md` — the sprint summary
- `.marathon/memory/sprint-{NNN}-retro.md` — the retrospective
- Updated `requirements.md` with `[DONE]` markers and new backlog items
- Updated `sprint-context.md` reflecting post-sprint state
- Sprint branch merged to main

## Procedure

### 1. Merge Sprint Branch

Merge the sprint branch into main. If there are conflicts, resolve them. If conflicts are non-trivial, flag for human review.

### 2. Update Requirements

In `.marathon/inputs/requirements.md`:
- Mark all fully completed requirements as `[DONE]`
- Mark partially completed requirements as `[TODO]` with a note about what remains
- Add any new backlog items discovered during the sprint (bugs found, tech debt identified, scope items deferred)

### 3. Write Sprint Report

Create `.marathon/sprints/{NNN}/sprint-report.md`:

```markdown
# Sprint {NNN} Report

## Summary
<!-- 2-3 sentences: what this sprint accomplished -->

## Completed
- [Requirement ID]: [Brief description of what was built]

## Partially Completed
- [Requirement ID]: [What was done, what remains]

## Deferred
- [Item]: [Why it was deferred, which future sprint should pick it up]

## Key Metrics
- Tasks planned: X
- Tasks completed: Y
- Follow-up iterations used: Z/2
- PRs merged: N

## Notable Decisions
- [Decision]: [Rationale and impact on future sprints]
```

### 4. Write Retrospective

Create `.marathon/memory/sprint-{NNN}-retro.md`:

```markdown
# Sprint {NNN} Retrospective

## What Worked
- [Pattern, approach, or decision that produced good results]

## What Didn't Work
- [Problem encountered, why it happened, how it was resolved or worked around]

## Lessons for Future Sprints
- [Specific, actionable lesson that future agents should know]

## Technical Debt Introduced
- [Item]: [Why, and what would be needed to fix it]

## Agent Performance Notes
- [Observation about which task types went smoothly vs. struggled]
- [Hook failures that recurred — what caused them]
```

### 5. Update Sprint Context

Update `.cursor/rules/sprint-context.md`:
- Sprint number: {NNN} (completed)
- What exists now (brief description of what was built)
- Active decisions (any new architectural decisions made during the sprint)
- Known tech debt (accumulated from this and previous sprints)
- Clear the sprint goals section (will be filled by next sprint-kickoff)

### 6. Commit All Artifacts

Stage and commit:
- All files in `.marathon/sprints/{NNN}/`
- `.marathon/memory/sprint-{NNN}-retro.md`
- Updated `.marathon/inputs/requirements.md`
- Updated `.cursor/rules/sprint-context.md`

Commit message: `chore(marathon): close sprint {NNN} — [brief summary]`
