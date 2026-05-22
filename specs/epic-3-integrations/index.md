## Objective: Match Cursor on Cloud agents (where it counts)

**Principles:**
- Open source self-hosted on Render primitives
- First-class blueprint support
- Clean and minimalist. Feature-rich and production-grade. Foundational and extendible.
- First-class concerns: Observability, cost efficiency, stability and reliability


Track 3: Integrations
  - Slack integration
    - Receive notifications when agents complete
    - Trigger automations on new messages in connected channels
  - Linear integration
    - Delegate issues with command
    - Agents show real-time status in Linear
    - Create PRs automatically from Linear issues

### Track 3: Integrations — Gaps

| Requirement | Current State | Gap Severity |
|-------------|---------------|--------------|
| **Slack: completion notifications** | `NotificationSink` adapter interface exists (console, webhook, composite, noop implementations). No Slack-specific sink. | **MEDIUM** |
| **Slack: trigger from messages** | Not implemented. No Slack app, no OAuth, no event subscription. | **HIGH** |
| **Linear: delegate issues** | Not implemented. No Linear API integration. | **HIGH** |
| **Linear: real-time status** | Not implemented. | **HIGH** |
| **Linear: auto-create PRs from issues** | Not implemented. | **HIGH** |

**Extensibility note:** The `NotificationSink` adapter pattern makes Slack notifications straightforward to add. The deeper integration (bidirectional Slack/Linear with triggers and status sync) requires new OAuth flows, webhook endpoints, and entity mappings.
