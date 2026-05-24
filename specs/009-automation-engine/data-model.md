# Data Model: Automation Engine

## Entity Relationship Overview

```
┌─────────────┐       ┌─────────────────┐       ┌──────────────────┐
│    orgs     │──1:N──│  automations    │──1:N──│ automation_runs  │
└─────────────┘       └─────────────────┘       └──────────────────┘
                              │                         │
                              │                         │ 1:1
                              │                         ▼
                              │                  ┌──────────────┐
                              │                  │   sessions   │ (existing)
                              │                  └──────────────┘
                              │
                              │ N:M (via automation_repos)
                              ▼
                      ┌───────────────────┐
                      │  automation_repos │
                      └───────────────────┘
                              │
                              │ N:1
                              ▼
                      ┌───────────────────┐
                      │   project_repos   │ (existing)
                      └───────────────────┘

┌─────────────────────────┐
│  integration_credentials│ (new — Slack/Linear tokens)
└─────────────────────────┘
```

---

## New Tables

### automations

The core entity representing a configured trigger-to-agent binding.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | text | PK | UUID |
| org_id | text | FK → orgs.id, NOT NULL | Owning organization |
| user_id | text | NOT NULL | Creator/owner |
| name | text | NOT NULL | Human-readable name |
| description | text | nullable | Optional longer description |
| enabled | boolean | NOT NULL, DEFAULT true | Whether automation actively fires |
| trigger_type | enum | NOT NULL | One of: `cron`, `github_event`, `slack_message`, `linear_issue`, `webhook` |
| trigger_config | jsonb | NOT NULL | Polymorphic config (see below) |
| prompt | text | NOT NULL | The prompt template sent to the agent |
| model_id | text | nullable | LLM model override (null = org default) |
| active_skills | jsonb | nullable | Array of `{ source, slug }` skill refs |
| max_concurrent_runs | integer | NOT NULL, DEFAULT 1 | Prevent runaway parallel sessions |
| coalesce_window_ms | integer | NOT NULL, DEFAULT 60000 | Deduplication window for rapid-fire events |
| next_run_at | timestamp(tz) | nullable | Next scheduled execution (cron only) |
| last_run_at | timestamp(tz) | nullable | Last execution time |
| last_run_status | enum | nullable | `success`, `failed`, `error` |
| run_count | integer | NOT NULL, DEFAULT 0 | Total executions |
| health_status | enum | NOT NULL, DEFAULT 'healthy' | `healthy`, `degraded`, `error` |
| health_message | text | nullable | Human-readable health issue |
| created_at | timestamp(tz) | NOT NULL, DEFAULT now() | |
| updated_at | timestamp(tz) | NOT NULL, DEFAULT now() | |

**Indexes**:
- `automations_org_id_idx` on (org_id)
- `automations_enabled_next_run_idx` on (enabled, next_run_at) WHERE trigger_type = 'cron'
- `automations_trigger_type_idx` on (trigger_type, enabled)

---

### automation_repos

Links automations to their target repositories (many-to-many).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | text | PK | UUID |
| automation_id | text | FK → automations.id (CASCADE) | |
| repo_path | text | NOT NULL | `owner/repo` format |
| forge_type | enum | nullable | `github`, `gitlab` |
| is_primary | boolean | NOT NULL, DEFAULT true | Primary repo for workspace creation |
| default_branch | text | NOT NULL, DEFAULT 'main' | |

**Indexes**:
- `automation_repos_automation_idx` on (automation_id)
- UNIQUE on (automation_id, repo_path)

---

### automation_runs

Audit trail linking automation executions to trigger events and resulting sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | text | PK | UUID |
| automation_id | text | FK → automations.id (CASCADE) | |
| session_id | text | FK → sessions.id, nullable | Resulting agent session (null if creation failed) |
| trigger_event_id | text | nullable | Reference to webhook_deliveries.id or internal event ID |
| trigger_source | text | NOT NULL | `cron`, `github`, `slack`, `linear`, `webhook` |
| trigger_payload | jsonb | nullable | Snapshot of the triggering event payload |
| status | enum | NOT NULL, DEFAULT 'pending' | `pending`, `running`, `completed`, `failed`, `skipped` |
| skip_reason | text | nullable | Why run was skipped (coalesced, disabled, rate-limited) |
| started_at | timestamp(tz) | nullable | |
| finished_at | timestamp(tz) | nullable | |
| duration_ms | integer | nullable | |
| error_message | text | nullable | |
| created_at | timestamp(tz) | NOT NULL, DEFAULT now() | |

**Indexes**:
- `automation_runs_automation_idx` on (automation_id, created_at DESC)
- `automation_runs_session_idx` on (session_id)
- `automation_runs_status_idx` on (status) WHERE status IN ('pending', 'running')

---

### integration_credentials

Encrypted storage for third-party service credentials (Slack bot tokens, Linear API keys).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | text | PK | UUID |
| org_id | text | FK → orgs.id (CASCADE) | |
| provider | enum | NOT NULL | `slack`, `linear`, `custom_webhook` |
| label | text | NOT NULL | Human-readable label ("Engineering workspace") |
| credentials_encrypted | text | NOT NULL | AES-256-GCM encrypted JSON blob |
| metadata | jsonb | nullable | Non-sensitive metadata (workspace name, team ID) |
| status | enum | NOT NULL, DEFAULT 'active' | `active`, `expired`, `revoked` |
| expires_at | timestamp(tz) | nullable | Token expiry (for refresh scheduling) |
| last_verified_at | timestamp(tz) | nullable | Last successful credential check |
| created_at | timestamp(tz) | NOT NULL, DEFAULT now() | |
| updated_at | timestamp(tz) | NOT NULL, DEFAULT now() | |

**Indexes**:
- `integration_credentials_org_provider_idx` on (org_id, provider)
- UNIQUE on (org_id, provider, label)

---

## Trigger Configuration Schemas (jsonb polymorphism)

### trigger_type = "cron"

```json
{
  "expression": "0 9 * * 1",
  "timezone": "America/New_York",
  "preset": null
}
```

Or with a preset:

```json
{
  "expression": null,
  "timezone": "UTC",
  "preset": "daily"
}
```

Presets expand to: `hourly` → `0 * * * *`, `daily` → `0 9 * * *`, `weekly` → `0 9 * * 1`

### trigger_type = "github_event"

```json
{
  "events": ["pr_opened", "pr_synchronize"],
  "filters": {
    "branch": "main",
    "workflow_name": null,
    "path_pattern": null,
    "actor_exclude": ["dependabot[bot]"]
  }
}
```

### trigger_type = "slack_message"

```json
{
  "credential_id": "cred_xxx",
  "channel_ids": ["C012345"],
  "match": {
    "keywords": ["agent", "fix"],
    "mention_bot": true
  }
}
```

### trigger_type = "linear_issue"

```json
{
  "credential_id": "cred_yyy",
  "events": ["issue_assigned", "label_added"],
  "filters": {
    "assignee": "agent-bot",
    "labels": ["auto-implement"],
    "team_id": "TEAM_xxx"
  }
}
```

### trigger_type = "webhook"

```json
{
  "secret": "whsec_xxx",
  "headers_match": {},
  "body_jsonpath_filters": [
    { "path": "$.action", "equals": "created" }
  ]
}
```

---

## State Transitions

### Automation Lifecycle

```
┌─────────┐     enable     ┌─────────┐
│ disabled │──────────────▶│ enabled │
└─────────┘◀──────────────└─────────┘
               disable            │
                                  │ credential error / repeated failures
                                  ▼
                           ┌─────────┐
                           │  error  │
                           └─────────┘
                                  │
                                  │ user fixes credential / re-enables
                                  ▼
                           ┌─────────┐
                           │ enabled │
                           └─────────┘
```

### Automation Run Lifecycle

```
pending → running → completed
                  → failed
        → skipped (coalesced, rate-limited, disabled mid-flight)
```

---

## Extended Existing Types

### InboundSource (extend enum)

Add: `"slack"`, `"linear"`, `"scheduler"`

### InboundKind (extend enum)

Add: `"scheduled_tick"`, `"slack_message"`, `"linear_issue_update"`, `"generic_webhook"`

### AgentTriggerKind (extend enum)

Add: `"scheduled"`, `"slack_message"`, `"linear_issue"`, `"automation_webhook"`

### agentRuns.trigger (extend enum)

Add: `"scheduled"`, `"slack_message"`, `"linear_issue"`, `"automation_webhook"`

---

## Redis Data Structures

### Schedule ZSET

- Key: `automation:schedule`
- Members: automation IDs
- Scores: Unix timestamp (ms) of next_run_at
- Operations: `ZADD`, `ZRANGEBYSCORE`, `ZREM`

### Deduplication Keys

- Key pattern: `automation:dedup:{automation_id}:{repo}:{pr_number|branch}`
- Value: latest automation_run ID
- TTL: `coalesce_window_ms` from automation config
