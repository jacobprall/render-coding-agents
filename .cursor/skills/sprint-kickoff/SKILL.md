# Sprint Kickoff

Initialize a new sprint by reading the requirements backlog, selecting the next batch of work, creating the sprint directory, and launching the specification pipeline.

## When This Skill Activates

At the start of a new sprint. This is the entry point to the sprint DAG.

## Inputs

- `.marathon/inputs/requirements.md` — the full requirements backlog with status markers
- `.marathon/inputs/milestones.md` — milestone definitions and sprint mapping
- `.marathon/inputs/product.md` — product context
- `.marathon/inputs/stack.md` — tech stack (for Sprint 1 infrastructure tasks)
- `.cursor/rules/sprint-context.md` — what already exists from previous sprints
- `.marathon/memory/` — retrospectives from previous sprints

## Outputs

- Sprint directory created at `.marathon/sprints/{NNN}/`
- Updated `.cursor/rules/sprint-context.md` with new sprint goals
- Triggers the specify → clarify → plan pipeline

## Procedure

### 1. Determine Sprint Number

Read `.marathon/sprints/` to find the highest existing sprint number. The new sprint is N+1. If no sprints exist, this is Sprint 001.

### 2. Select Requirements Batch

Read `requirements.md`. Identify requirements marked `[TODO]` that fall within the next milestone's scope (per `milestones.md`). Select a batch that fits a single sprint — typically 3-8 requirements depending on complexity.

For Sprint 1, also include infrastructure bootstrap tasks:
- Project scaffolding
- CI/CD setup
- Database provisioning
- Authentication setup
- Design system initialization

Mark selected requirements as `[IN SPRINT]` in `requirements.md`.

### 3. Create Sprint Directory

```
.marathon/sprints/{NNN}/
```

### 4. Read Previous Sprint Context

Read `.cursor/rules/sprint-context.md` to understand what exists. Read the most recent entries in `.marathon/memory/` for lessons that might affect this sprint.

### 5. Update Sprint Context

Update `.cursor/rules/sprint-context.md` with:
- Current sprint number
- Phase: "Specification"
- Selected requirements and their IDs
- Sprint goals (1-3 sentence summary)
- Any relevant warnings from previous sprint retrospectives

### 6. Launch Specification Pipeline

Begin the specify step: read the selected requirements and transform them into a structured specification. This activates the `sdd-specify` skill, which produces `spec.md`.

The rest of the sprint DAG follows automatically from the workflow definition in `.marathon/workflows/sprint.yml`.
