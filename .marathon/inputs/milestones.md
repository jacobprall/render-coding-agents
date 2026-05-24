# Milestones

<!-- Groups requirements into coherent releases. Defines sprint order and scope. -->
<!-- Each milestone maps to one or more sprints. -->

## Milestone 2: Automations (Epic 2)

**Target:** Sprints 2–4

**Scope:** Requirements R1–R7

**Description:**
When this milestone ships, users can create event-driven and scheduled automations that trigger agent sessions automatically. Agents respond to GitHub/GitLab events, Slack messages, and Linear issues without manual intervention. A memory system lets agents learn across sessions. BugBot ships as a one-click automation.

**Sprint Mapping:**
- Sprint 2: R1 (cron/schedule), R2 (GitHub/GitLab event triggers), R6 (automation builder UI — create/list scaffold)
- Sprint 3: R3 (Slack triggers), R4 (Linear triggers), R5 (memory tool), R6 (automation builder — full CRUD)
- Sprint 4: R7 (BugBot automation), R5 (memory tool — polish), integration testing across all trigger types

**Dependencies:**
- GitHub/GitLab webhook handlers already exist (InboundRouter/InboundDispatcher) — extend, don't replace
- Slack App registration required (external) — needs Bot Token and Event Subscriptions
- Linear App registration required (external) — needs OAuth credentials
- Automation entity schema must be designed before any trigger work begins

---

## Milestone 3: Integrations (Epic 3)

**Target:** Sprints 5–6

**Scope:** Requirements R8–R12

**Description:**
When this milestone ships, the platform has full bidirectional Slack and Linear integrations. Agents notify in Slack when done, can be triggered and managed from Slack threads, and sync status to Linear issues in real-time. PRs auto-link to Linear issues.

**Sprint Mapping:**
- Sprint 5: R8 (Slack notifications), R9 (Slack bidirectional — OAuth + slash commands), R10 (Linear delegation)
- Sprint 6: R11 (Linear real-time status), R12 (Linear auto-PR linking), polish and cross-integration testing

**Dependencies:**
- Slack OAuth flow and app from Milestone 2 (R3) — reused and extended
- Linear OAuth flow from Milestone 2 (R4) — reused and extended
- `NotificationSink` adapter pattern already exists — extend with Slack implementation

---

## Milestone 4: Interfaces (Epic 4)

**Target:** Sprints 7–8

**Scope:** Requirements R13–R16

**Description:**
When this milestone ships, the web dashboard has a kanban board for at-a-glance agent monitoring, works beautifully on mobile, exposes a versioned REST API at `/v1/agents` for programmatic use, and provides power-user session management features.

**Sprint Mapping:**
- Sprint 7: R13 (Kanban board), R14 (Mobile-optimized dashboard)
- Sprint 8: R15 (REST API v1), R16 (Session management polish)

**Dependencies:**
- Existing web dashboard (Next.js app) is functional — enhance, don't rebuild
- Gateway already exposes session CRUD — versioned API is a facade layer
- Real-time infrastructure (SSE/Redis pub/sub) already exists — wire into kanban

---

## Summary: Sprint Roadmap

| Sprint | Milestone | Key Deliverables |
|--------|-----------|-----------------|
| 2 | Automations | Automation entity, cron scheduler, GitHub/GitLab event binding, builder UI scaffold |
| 3 | Automations | Slack triggers, Linear triggers, memory tool, full builder CRUD |
| 4 | Automations | BugBot automation, memory polish, cross-trigger integration tests |
| 5 | Integrations | Slack notifications, Slack app (OAuth + commands), Linear delegation |
| 6 | Integrations | Linear status sync, auto-PR linking, integration polish |
| 7 | Interfaces | Kanban board, mobile optimization |
| 8 | Interfaces | REST API v1, session management polish |
