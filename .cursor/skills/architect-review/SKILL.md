# Architect Review

Review an implementation plan against the tech stack, architectural constraints, and the existing codebase. Revise the plan to fix structural violations. Define interfaces between parallel tasks to prevent conflicts.

## When This Skill Activates

When reviewing a `plan.md` before task decomposition. This is the last checkpoint before code is written — mistakes here cascade into every implementation agent.

## Inputs

- `plan.md` — the implementation plan from the planning step
- `.marathon/inputs/stack.md` — authoritative tech stack
- `.marathon/inputs/constraints.md` — architectural constraints and patterns
- The existing codebase (read via semantic search and file exploration)
- `.marathon/memory/` — lessons from previous sprints

## Outputs

- `plan.md` (revised) — the plan with structural issues fixed
- `arch-notes.md` — decisions made, rationale, interface contracts between parallel tasks

## Review Checklist

### Stack Compliance
- Does the plan use the framework, ORM, and patterns specified in `stack.md`?
- Are all proposed dependencies on the approved list in `constraints.md`?
- Does the plan follow the directory structure established in the codebase?

### Structural Integrity
- Does the data model make sense? Are relationships correct? Are there missing tables or fields?
- Do API contracts follow existing patterns in the codebase? Are there naming inconsistencies?
- Are there missing error handling paths, edge cases, or failure modes?

### Existing Code Integration
- Read the relevant parts of the existing codebase. Does the plan conflict with existing patterns?
- Are there existing utilities, components, or services the plan should reuse instead of recreating?
- Will the plan's changes break existing functionality? If so, how is that handled?

### Parallel Task Safety
- For tasks that will run in parallel, are the file boundaries clear? Can two agents touch the same file?
- Define explicit interface contracts: if Task A creates an API endpoint and Task B consumes it, document the contract in `arch-notes.md` so both agents agree.
- Shared types, schemas, and constants should be created by a sequential task that runs before the parallel tasks that depend on them.

### Performance & Security
- Does the plan introduce N+1 query patterns, unbounded list fetches, or missing pagination?
- Are there security concerns? Auth checks, input validation, injection risks?
- Does the plan respect performance budgets from `constraints.md`?

## Output Format for arch-notes.md

```markdown
# Architecture Notes — Sprint {N}

## Decisions
- [Decision]: [Rationale]

## Interface Contracts
### [Contract Name]
- **Provider:** Task {X}
- **Consumer:** Task {Y}
- **Contract:** [Exact type/API signature]

## Warnings
- [Issue]: [Why it matters] — [What to watch for during implementation]

## Codebase Observations
- [Pattern found]: [How to align with it]
```

## Behavior

1. Read the plan thoroughly.
2. Read `stack.md` and `constraints.md`.
3. Explore the existing codebase to understand current patterns, directory structure, and conventions.
4. Read `.marathon/memory/` for relevant learnings from past sprints.
5. Evaluate the plan against every item on the review checklist.
6. Revise `plan.md` in place — fix problems, don't just flag them.
7. Write `arch-notes.md` with decisions, interface contracts, and warnings.
8. If the plan has fundamental structural issues that require re-planning, say so explicitly rather than patching around them.
