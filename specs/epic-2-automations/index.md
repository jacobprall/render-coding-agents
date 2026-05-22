## Objective: Match Cursor on Cloud agents (where it counts)

**Principles:**
- Open source self-hosted on Render primitives
- First-class blueprint support
- Clean and minimalist. Feature-rich and production-grade. Foundational and extendible.
- First-class concerns: Observability, cost efficiency, stability and reliability



Track 2: Automations 
  - Run agents on schedules (preset or cron) or event triggers
  - Triggers: GitHub/GitLab events (PR opened, pushed, merged, commented, CI completion), Slack messages, Linear events, webhooks
  - Include a memory tool for learning from past runs
  - Create via Agents Window, cursor.com/automations, or Cursor Marketplace
  - Choose trigger → write prompt → select tools → specify repos
  - BugBoy out of the box (equivalent to Cursor agents bugbot)

### Track 2: Automations — Gaps

| Requirement | Current State | Gap Severity |
|-------------|---------------|--------------|
| Schedule/cron triggers | Not implemented. All runs are user-initiated or webhook-triggered. | **HIGH** |
| Event triggers (GitHub/GitLab) | Webhook handlers exist for push, PR opened/merged/commented, CI completion. `InboundRouter` + `InboundDispatcher` provide extensible trigger routing. `agentRuns.trigger` enum supports `ci_failure`, `review_comment`, `pr_opened`, `pr_merged`, `workflow_run`, `deploy_failure`. | **LOW** — Partially done |
| Slack/Linear event triggers | Not implemented. No Slack or Linear webhook ingestion. | **HIGH** |
| Memory tool (learning from past runs) | No cross-session memory, RAG, or learning system. Each session is stateless relative to prior sessions. | **HIGH** |
| Automation creation UI | No builder interface. No marketplace concept. | **HIGH** |
| Automation config (trigger → prompt → tools → repos) | No automation entity in schema. No stored trigger-prompt-repo binding. | **HIGH** |
| BugBot out of the box | Review jobs can be enqueued (`POST /sessions/:id/review`). No standalone BugBot automation that auto-triggers on PRs. | **MEDIUM** |

**Extensibility note:** The `InboundRouter`/`InboundDispatcher` + `default-routes.ts` pattern was designed for exactly this. Adding new trigger sources (Slack, Linear, cron) would plug into this routing layer. The gap is the automation entity/config, scheduler, and integrations — not the dispatch architecture.
