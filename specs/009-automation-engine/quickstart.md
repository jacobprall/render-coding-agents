# Quickstart: Automation Engine

## Prerequisites

- Running platform (web, gateway, agent worker, Redis, PostgreSQL)
- At least one GitHub repo connected to a project
- Database migrated to latest schema

## 1. Run the Migration

```bash
bun run db:push
```

This creates the new tables: `automations`, `automation_repos`, `automation_runs`, `integration_credentials`.

## 2. Create Your First Scheduled Automation

```bash
curl -X POST http://localhost:4100/api/automations \
  -H "Authorization: Bearer $GATEWAY_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "YOUR_ORG_ID",
    "name": "Daily Code Health",
    "triggerType": "cron",
    "triggerConfig": {
      "expression": "0 9 * * *",
      "timezone": "UTC"
    },
    "prompt": "Run a code health check on this repository. Check for: unused dependencies, type errors, lint warnings, and test coverage gaps. Report findings as a summary.",
    "repos": [{
      "repoPath": "your-org/your-repo",
      "forgeType": "github",
      "defaultBranch": "main"
    }]
  }'
```

The automation is now scheduled. The agent worker picks it up at the next scheduled time and creates a session.

## 3. Create a GitHub Event-Triggered Automation

```bash
curl -X POST http://localhost:4100/api/automations \
  -H "Authorization: Bearer $GATEWAY_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "YOUR_ORG_ID",
    "name": "PR Review on Main",
    "triggerType": "github_event",
    "triggerConfig": {
      "events": ["pr_opened"],
      "filters": { "branch": "main" }
    },
    "prompt": "Review this pull request for bugs, security issues, and code quality. Post your findings as review comments on the PR.",
    "repos": [{
      "repoPath": "your-org/your-repo",
      "forgeType": "github",
      "defaultBranch": "main"
    }]
  }'
```

Now when a PR is opened targeting `main`, the automation fires and an agent reviews the code.

## 4. Enable BugBot (One-Click Template)

```bash
curl -X POST http://localhost:4100/api/automations/from-template \
  -H "Authorization: Bearer $GATEWAY_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "YOUR_ORG_ID",
    "template": "bugbot",
    "repos": [{
      "repoPath": "your-org/your-repo",
      "forgeType": "github",
      "defaultBranch": "main"
    }]
  }'
```

## 5. Check Automation Status

```bash
# List all automations
curl http://localhost:4100/api/automations?org_id=YOUR_ORG_ID \
  -H "Authorization: Bearer $GATEWAY_API_SECRET"

# View run history
curl http://localhost:4100/api/automations/AUTO_ID/runs \
  -H "Authorization: Bearer $GATEWAY_API_SECRET"
```

## 6. Connect Slack (Optional)

1. Create a Slack app at api.slack.com with required scopes
2. Install to your workspace via OAuth
3. Store the bot token:

```bash
curl -X POST http://localhost:4100/api/integrations/credentials \
  -H "Authorization: Bearer $GATEWAY_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "YOUR_ORG_ID",
    "provider": "slack",
    "label": "Engineering Workspace",
    "token": "xoxb-your-bot-token"
  }'
```

4. Configure your Slack app's Event Subscription URL to: `https://your-gateway.onrender.com/api/webhooks/slack`

5. Create a Slack-triggered automation:

```bash
curl -X POST http://localhost:4100/api/automations \
  -H "Authorization: Bearer $GATEWAY_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "YOUR_ORG_ID",
    "name": "Slack Agent Trigger",
    "triggerType": "slack_message",
    "triggerConfig": {
      "credentialId": "CRED_ID",
      "channelIds": ["C012345"],
      "match": { "mentionBot": true }
    },
    "prompt": "A team member requested help via Slack. Their message: {{trigger_context}}. Help them with their request.",
    "repos": [{
      "repoPath": "your-org/your-repo",
      "forgeType": "github",
      "defaultBranch": "main"
    }]
  }'
```

## Architecture Overview

```
Event Sources → Adapters → InboundRouter → AutomationMatcher → Dispatcher → Redis Streams → Agent Worker
     ↑                                           ↑
     │                                           │
  Webhooks                               automations table
  (GitHub, Slack, Linear)                (trigger configs)
     │
     │
  Scheduler (Redis ZSET poll)
  emits "scheduled_tick" events
```

## Key Files (after implementation)

```
packages/db/schema/automation.ts          — DB schema (automations, runs, repos, credentials)
packages/platform/src/services/automation.ts — AutomationService (CRUD + lifecycle)
packages/platform/src/services/automation-scheduler.ts — Scheduler (ZSET polling)
packages/platform/src/services/automation-matcher.ts   — Event → automation matching
packages/platform/src/inbound/adapters.ts  — Extended with Slack/Linear adapters
packages/platform/src/inbound/types.ts     — Extended InboundSource/Kind enums
packages/platform/src/inbound/default-routes.ts — + automation catchall route
apps/gateway/src/routes/automations.ts     — REST API routes
apps/gateway/src/routes/webhooks.ts        — Extended with /slack, /linear endpoints
apps/web/app/(app)/automations/            — UI pages (list, create, detail)
```
