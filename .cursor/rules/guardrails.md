---
description: Hard stops, escalation rules, and safety constraints
globs: ["**/*"]
alwaysApply: true
---

# Guardrails

These rules override all other instructions. When a guardrail triggers, the agent must stop and escalate — regardless of sprint phase, task urgency, or gate configuration.

## Hard Stops — Always Escalate

### New Dependencies
If you need to install a package not listed in `.marathon/inputs/constraints.md` under "Approved Dependencies":
1. Do not install it.
2. State what you need and why.
3. Wait for human approval before proceeding.

### Security-Sensitive Code
When working on any of the following, flag for human review even if no gate is configured:
- Authentication or authorization logic
- Payment processing or financial calculations
- PII handling, encryption, or data anonymization
- API key or secret management
- CORS, CSP, or other security header configuration
- File upload handling
- Admin/elevated privilege endpoints

### Database Migrations
- Never drop a table or column without explicit human approval.
- Destructive migrations (rename, drop, alter type) require a two-step process: create new → migrate data → drop old.
- All migrations must be reversible.

### Test Coverage
- If your changes cause test coverage to drop below the threshold defined in `constraints.md`, stop and write tests before proceeding.
- If you cannot write a meaningful test for your change, document why in the PR description.

### External Service Integration
- Do not call external APIs not listed in `stack.md` without approval.
- Do not store API keys or secrets in code, config files, or environment files committed to git.
- Use environment variables for all external service credentials.

## Soft Limits — Warn and Continue

### File Size
If a single file exceeds 400 lines, consider splitting it. If it exceeds 600 lines, split it before proceeding.

### Function Complexity
If a function exceeds 50 lines or has more than 4 levels of nesting, refactor before proceeding.

### PR Size
If a single PR touches more than 20 files or exceeds 500 lines changed, consider splitting into smaller PRs. If the task definition makes this impossible, note it in the PR description.

## Agent Behavior Limits

### Retry Budget
- If a hook (test, lint, build) fails with the same error 3 consecutive times, stop. Do not retry further. Report the failure pattern and escalate.
- If you've been working on the same task for more than 30 minutes without meaningful progress, stop and report what's blocking you.

### Scope Discipline
- Do not fix issues outside your current task scope unless they directly block your task.
- Do not refactor existing code unless the task explicitly calls for it.
- If you discover a bug or tech debt outside your scope, note it in the PR description for the sprint-close step to capture.

### Cost Awareness
- Prefer smaller, targeted tool calls over broad searches.
- Do not re-read files you've already read in the current session unless the file has changed.
- Keep prompts concise. Do not repeat the full task specification in every message to subagents.
