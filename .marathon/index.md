# Marathon

## In-Repo Autonomous Sprint System for Cursor Cloud Agents

---

## 1. What Marathon Is

Marathon is a `.marathon/` directory you add to any repo. It contains the configuration — skills, rules, hooks, workflows, and input documents — that enables Cursor Cloud Agents to execute autonomous development sprints against that repo.

There is no external service. No SaaS platform. No orchestration layer outside the repo. You drop `.marathon/` into your project, write your product requirements, and Cursor Cloud Agents do the rest — decomposing requirements into specs, plans, and tasks, fanning out parallel agents to implement, review, test, and iterate, sprint after sprint.

The system composes existing Cursor primitives:

- **Rules** (`.cursor/rules/`) — always-on project conventions and constraints
- **Skills** (`.cursor/skills/`) — dynamically loaded domain knowledge via `SKILL.md` files
- **Hooks** (`.cursor/hooks.json`) — scripts that run before/after agent actions
- **Subagents** — scoped child agents with their own prompts and models
- **BugBot** (`.cursor/BUGBOT.md`) — automated PR review with autofix
- **Spec Kit** (`.specify/`) — spec-driven development: specify → plan → tasks → implement
- **Cursor SDK** (`@cursor/sdk`) — programmatic agent orchestration

Marathon doesn't invent new abstractions. It wires these together into a repeatable sprint loop.

---

## 2. Design Principles

### The repo is the system

All configuration is version-controlled alongside the code. Every Cloud Agent spawned against the repo inherits the full harness automatically. Nothing lives outside the repo.

### Agents are specialized by context, not by role

There are no separate "agent types." Every Cloud Agent reads the same rules, discovers the same skills, and runs the same hooks. Behavior varies because skills load dynamically based on what the agent is doing — a specify step activates the specify skill, an implementation step activates stack-specific skills.

### Sequential where leverage is high, parallel where throughput matters

Specification and planning are single-threaded because these decisions cascade into everything downstream. Implementation fans out maximally because tasks are independent by design (enforced by the architect-review step that runs before any code is written).

### Bounded iteration

Follow-up loops run a maximum of 2 times. Unresolved issues become backlog items for future sprints. Unbounded loops are how autonomous systems get stuck.

---

## 3. Inputs

These documents live in `.marathon/inputs/` and are the seed material for the entire system. They are written by humans and refined over time.

### product.md
What the product is, who it's for, core value propositions, key differentiators. The north star that every sprint references.

### stack.md
Framework, language, runtime, infrastructure, deployment target, design system references, third-party services. Tells agents what to build with.

### constraints.md
Performance budgets, security requirements, compliance obligations, accessibility standards, architectural patterns to follow or avoid. The boundaries agents must stay within.

### requirements.md
The full product requirements — features, user stories, acceptance criteria. This is the backlog. Each sprint pulls from this document. As sprints complete, requirements are marked done and remaining items feed forward.

### milestones.md
Delivery targets that group requirements into coherent releases. Defines the order and scope of sprints.

---

## 4. The Sprint DAG

Each sprint is a directed acyclic graph. Nodes are agent steps with defined inputs and outputs. Edges are data dependencies. The full system is this DAG executed N times, with each sprint's output feeding into the next.

### Phase 1: Specification (Sequential)

Deliberately single-threaded. One agent with full context making high-leverage decisions.

```
requirements.md (next unstarted batch)
 │
 ▼
speckit-specify ──→ spec.md
 │
 ▼
speckit-clarify ──→ clarifications.md (appended to spec)
 │
 ▼
speckit-plan ──→ plan.md (architecture, components, APIs, data models)
 │
 ▼
architect-review ──→ plan.md (revised) + arch-notes.md
 │
 ▼
ux-reviewer ──→ ux-review.md (fed back into plan)
 │
 ▼
speckit-tasks ──→ tasks.md (ordered, [P] markers, dependencies, acceptance criteria)
```

**speckit-specify** — Transforms the next batch of requirements into a structured specification.

**speckit-clarify** — Identifies ambiguities, gaps, contradictions, unstated assumptions. Resolves them against `product.md` and `constraints.md`.

**speckit-plan** — Generates an implementation plan: component breakdown, API contracts, data models, file paths.

**architect-review** — Reviews the plan against `stack.md`, `constraints.md`, and the existing codebase. Catches structural violations. Revises the plan. Defines interfaces between parallel tasks so they can't conflict.

**ux-reviewer** — Reviews the plan against design system and UX principles. Flags missing states, accessibility gaps, flow issues.

**speckit-tasks** — Decomposes the reviewed plan into an ordered task list. Tasks marked `[P]` can run in parallel. Unmarked tasks have dependencies and run sequentially. Each task has file paths, acceptance criteria, and a clear scope.

### Phase 2: Implementation (Parallel Fan-Out)

Every `[P]`-marked task spawns its own Cloud Agent. Each gets its own branch via git worktree, its own VM, and the full repo harness. Sequential tasks wait for their dependencies to merge.

```
tasks.md
 │
 ├──[P]──→ Agent 1 (branch, VM, worktree) ──→ PR
 ├──[P]──→ Agent 2 (branch, VM, worktree) ──→ PR
 ├──[P]──→ Agent 3 (branch, VM, worktree) ──→ PR
 └──[seq]─→ Agent 4 (waits for 1+2)       ──→ PR
```

Hooks enforce quality at the implementation level: tests must pass, lint must be clean. Post-action hooks loop the agent back if anything fails. There is no separate QA agent — hooks handle this.

Up to 8 parallel agents.

### Phase 3: Review (Automated, Multi-Layer)

Two separate review steps with distinct purposes.

**Code review** — Subagent (or parallel read-only subagents: security, performance, correctness, readability) analyzes each PR diff. Produces review comments and suggested fixes.

**BugBot PR review** — Fires automatically on PR creation. Uses different models than the implementation agent to avoid blind-spot overlap. Project-specific rules from `.cursor/BUGBOT.md`. Autofix spawns its own Cloud Agents to resolve flagged issues. 70%+ of flags get resolved before merge.

### Phase 4: Integration & Testing

**Integration test** — Runs full test suite on the merged sprint branch. Builds the app end-to-end. Runs e2e tests.

**UX testing** — Agent drives the built app using Cursor's browser integration. Navigates flows defined in the spec. Takes screenshots. Checks against design system expectations.

**UX feedback** — Compares test results against original spec and UX review. Identifies gaps: missing states, accessibility failures, visual regressions, flow deviations. Outputs follow-up tasks if needed.

### Phase 5: Follow-Up (Bounded, Max 2 Iterations)

If UX feedback generates follow-up tasks, they go through a compressed cycle:

```
follow-up tasks → implementation → code review → PR review → UX test → UX feedback
```

Maximum 2 iterations. Remaining issues after 2 loops become backlog items in `requirements.md` for future sprints.

### Phase 6: Sprint Close

- Merge sprint branch → main
- Mark completed requirements as done in `requirements.md`
- Write sprint retrospective → `.marathon/memory/`
- Log any remaining follow-up items as backlog
- Commit all artifacts
- Output: `sprint-report.md` → feeds next sprint's context

---

## 5. Sprint DAG (Visual)

```
requirements.md (next batch)
 │
 ▼
speckit-specify ──→ spec.md
 │
 ▼
speckit-clarify ──→ spec.md (clarified)
 │
 ▼
speckit-plan ──→ plan.md
 │
 ▼
architect-review ──→ plan.md (revised) + arch-notes.md
 │
 ▼
ux-reviewer ──→ ux-review.md
 │
 ▼
speckit-tasks ──→ tasks.md
 │
 ▼
┌─────── Fan-out [P] tasks ───────┐
│          │          │           │
▼          ▼          ▼           ▼
Impl 1   Impl 2   Impl 3     Impl N
(branch) (branch) (branch)   (branch)
│          │          │           │
▼          ▼          ▼           ▼
Code     Code     Code        Code
Review   Review   Review     Review
│          │          │           │
▼          ▼          ▼           ▼
BugBot   BugBot   BugBot     BugBot
│          │          │           │
└──────────┼──────────┘           │
           │ (all PRs merged)     │
           ▼                      │
    Integration Test ◄────────────┘
           │
           ▼
      UX Testing (browser)
           │
           ▼
      UX Feedback
           │
      ┌────┴────┐
      │Follow-  │
      │ups?     │── No ──→ Sprint Close ──→ Next Sprint
      └────┬────┘
           │ Yes (max 2x)
           ▼
      Mini-cycle: impl → review → UX test
           │
           ▼
      Sprint Close ──→ Next Sprint
```

---

## 6. Repo Structure

```
your-project/
├── .marathon/
│   ├── inputs/
│   │   ├── product.md                     # What the product is
│   │   ├── stack.md                       # Tech stack declaration
│   │   ├── constraints.md                 # Architectural + quality constraints
│   │   ├── requirements.md                # Full requirements backlog
│   │   └── milestones.md                  # Delivery targets and sprint scoping
│   ├── memory/                            # Sprint retrospectives, accumulated learnings
│   │   ├── sprint-001-retro.md
│   │   └── ...
│   ├── sprints/                           # Sprint artifacts (generated)
│   │   ├── 001/
│   │   │   ├── spec.md
│   │   │   ├── clarifications.md
│   │   │   ├── plan.md
│   │   │   ├── arch-notes.md
│   │   │   ├── ux-review.md
│   │   │   ├── tasks.md
│   │   │   ├── test-report.md
│   │   │   ├── ux-test-report.md
│   │   │   ├── ux-feedback.md
│   │   │   └── sprint-report.md
│   │   └── ...
│   └── workflows/
│       └── sprint.yml                     # Spec Kit workflow: the sprint DAG as YAML
├── .cursor/
│   ├── rules/
│   │   ├── architecture.md                # Always-on: patterns, structure, stack rules
│   │   ├── code-style.md                  # Always-on: conventions, naming, formatting
│   │   ├── sprint-context.md              # Always-on: current sprint goals and status
│   │   └── guardrails.md                  # Always-on: escalation rules, stop conditions
│   ├── skills/
│   │   ├── sdd-specify/SKILL.md           # Spec Kit: spec generation
│   │   ├── sdd-clarify/SKILL.md           # Spec Kit: ambiguity resolution
│   │   ├── sdd-plan/SKILL.md              # Spec Kit: plan generation
│   │   ├── sdd-tasks/SKILL.md             # Spec Kit: task decomposition
│   │   ├── sdd-implement/SKILL.md         # Spec Kit: implementation
│   │   ├── sdd-verify/SKILL.md            # Spec Kit: verification
│   │   ├── architect-review/SKILL.md      # Reviews plan against codebase + constraints
│   │   ├── ux-reviewer/SKILL.md           # Reviews plan against design system + UX
│   │   ├── sprint-kickoff/SKILL.md        # Reads requirements, runs the specify pipeline
│   │   ├── sprint-close/SKILL.md          # Retro, update requirements, prep next sprint
│   │   └── [stack-specific]/SKILL.md      # Stack patterns (nextjs, prisma, etc.)
│   ├── hooks.json                         # Test enforcement, lint, build verification
│   ├── mcp.json                           # MCP servers (GitHub, Slack, Linear, etc.)
│   └── BUGBOT.md                          # Project-specific PR review rules
├── .specify/
│   ├── templates/                         # Spec Kit templates
│   ├── memory/                            # Spec Kit memory (constitution)
│   ├── extensions.yml                     # Spec Kit extensions and presets
│   └── workflows/                         # (symlink or copy of .marathon/workflows/)
├── AGENTS.md                              # Root-level agent instructions
└── src/                                   # Product codebase (built by sprint agents)
    └── ...
```

---

## 7. Infrastructure Bootstrap (Sprint 1)

The first sprint is unique. Its task list includes infrastructure tasks alongside any initial feature work:

- Project scaffolding (framework setup, directory structure)
- CI/CD pipeline
- Deployment configuration
- Database provisioning
- Authentication setup
- Design system / component library initialization

These are treated identically to feature tasks — same pipeline, same review, same PRs. Marked `[P]` where independent, sequential where they have dependencies.

Subsequent sprints inherit and extend the infrastructure. `hooks.json` evolves with the project: Sprint 1 might have lint + type-check. Sprint 3 adds e2e test hooks as the test suite grows.

---

## 8. Sprint-to-Sprint Continuity

Each sprint feeds the next:

- `sprint-report.md` captures what was built, what worked, what didn't
- Retrospective notes accumulate in `.marathon/memory/`
- `requirements.md` gets updated — completed items marked done, follow-up items added to backlog
- `sprint-context.md` (in `.cursor/rules/`) is updated with current state so every agent in the next sprint knows what exists
- The codebase itself grows — agents in Sprint N+1 read and build on Sprint N's code

The system improves over time because `.marathon/memory/` gives agents access to accumulated learnings. Sprint 5's architect-review can reference patterns that worked in Sprint 2 and mistakes made in Sprint 3.

---

## 9. Human Checkpoints (Configurable)

Gates are configurable per step. Early sprints might require human approval at:

- **spec gate** — approve the specification before planning begins
- **plan gate** — approve the plan before implementation begins
- **PR gate** — approve PRs before merge

As confidence builds, gates can be removed progressively. The Cursor Agents kanban view (web/mobile) provides monitoring without requiring intervention — you can watch sprints execute and intervene only when needed.

Guardrails in `.cursor/rules/guardrails.md` define hard stops: when to pause and escalate to a human regardless of gate configuration. Examples:

- New third-party dependency not in the approved list
- Test coverage drops below a threshold
- Security-sensitive code paths (auth, payments, PII handling)
- Cost thresholds for agent compute

---

## 10. What Needs to Be Built

To make Marathon operational, these files need to be authored:

1. **Input documents** — `product.md`, `stack.md`, `constraints.md`, `requirements.md`, `milestones.md` for the target project

2. **Sprint workflow** — `.marathon/workflows/sprint.yml` encoding the DAG as a Spec Kit workflow with steps, gates, fan-out, conditions, and loop bounds

3. **Rules** — `.cursor/rules/` files: `architecture.md`, `code-style.md`, `sprint-context.md`, `guardrails.md`

4. **Custom skills** — `SKILL.md` files for `architect-review`, `ux-reviewer`, `sprint-kickoff`, `sprint-close`

5. **Hooks** — `.cursor/hooks.json` for test enforcement, lint, build checks

6. **BugBot rules** — `.cursor/BUGBOT.md` with project-specific review standards

7. **AGENTS.md** — root-level agent instructions tying it all together

8. **SDK driver** (optional) — TypeScript script using `@cursor/sdk` for fully programmatic sprint execution