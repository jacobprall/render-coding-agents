# API Contracts: Automation Engine

## Gateway REST API

Base path: `/api/automations`

---

### List Automations

```
GET /api/automations
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| org_id | string | required | Organization scope |
| enabled | boolean | - | Filter by enabled state |
| trigger_type | string | - | Filter by trigger type |
| limit | number | 20 | Pagination limit (max 100) |
| offset | number | 0 | Pagination offset |

**Response** (200):
```json
{
  "automations": [
    {
      "id": "auto_xxx",
      "name": "Weekly Dependency Audit",
      "description": "Checks for outdated deps every Monday",
      "enabled": true,
      "triggerType": "cron",
      "triggerConfig": { "expression": "0 9 * * 1", "timezone": "UTC" },
      "prompt": "Audit dependencies...",
      "modelId": "anthropic/claude-sonnet-4-5",
      "repos": [{ "repoPath": "org/repo", "isPrimary": true }],
      "nextRunAt": "2026-05-26T09:00:00Z",
      "lastRunAt": "2026-05-19T09:00:00Z",
      "lastRunStatus": "success",
      "runCount": 12,
      "healthStatus": "healthy",
      "createdAt": "2026-05-01T10:00:00Z",
      "updatedAt": "2026-05-19T09:05:00Z"
    }
  ],
  "total": 5,
  "limit": 20,
  "offset": 0
}
```

---

### Get Automation

```
GET /api/automations/:id
```

**Response** (200): Single automation object (same shape as list item plus `activeSkills`, `maxConcurrentRuns`, `coalesceWindowMs`).

**Response** (404): `{ "error": "Automation not found" }`

---

### Create Automation

```
POST /api/automations
```

**Request Body**:
```json
{
  "orgId": "org_xxx",
  "name": "PR Review Bot",
  "description": "Reviews all PRs to main",
  "triggerType": "github_event",
  "triggerConfig": {
    "events": ["pr_opened"],
    "filters": { "branch": "main" }
  },
  "prompt": "Review this PR for bugs and security issues...",
  "modelId": "anthropic/claude-sonnet-4-5",
  "activeSkills": [{ "source": "builtin", "slug": "code-review" }],
  "repos": [{ "repoPath": "org/repo", "forgeType": "github", "defaultBranch": "main" }],
  "maxConcurrentRuns": 1,
  "coalesceWindowMs": 60000
}
```

**Validation**:
- `name`: required, 1-100 chars
- `triggerType`: required, must be valid enum
- `triggerConfig`: required, validated against trigger type schema
- `prompt`: required, 1-10000 chars
- `repos`: required, at least one repo
- Cron expressions validated via parser (reject invalid)

**Response** (201): Created automation object with calculated `nextRunAt` for cron types.

**Response** (400): `{ "error": "...", "details": [...] }`

---

### Update Automation

```
PATCH /api/automations/:id
```

**Request Body**: Partial automation (only fields to update). Same validation as create for provided fields.

**Response** (200): Updated automation object.

**Side effects**: If `triggerConfig` or `enabled` changes for a cron automation, recalculate `nextRunAt` and update the Redis ZSET.

---

### Delete Automation

```
DELETE /api/automations/:id
```

**Response** (204): No content.

**Side effects**: Remove from schedule ZSET, cancel any pending/running automation runs.

---

### Enable/Disable Automation

```
POST /api/automations/:id/enable
POST /api/automations/:id/disable
```

**Response** (200): Updated automation object.

**Side effects (enable)**: If cron, calculate `nextRunAt` and add to ZSET.
**Side effects (disable)**: Remove from ZSET, do NOT cancel already-running sessions.

---

### List Automation Runs

```
GET /api/automations/:id/runs
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| status | string | - | Filter by status |
| limit | number | 20 | Pagination limit (max 100) |
| offset | number | 0 | Pagination offset |

**Response** (200):
```json
{
  "runs": [
    {
      "id": "arun_xxx",
      "automationId": "auto_xxx",
      "sessionId": "ses_yyy",
      "triggerSource": "cron",
      "status": "completed",
      "startedAt": "2026-05-19T09:00:00Z",
      "finishedAt": "2026-05-19T09:03:22Z",
      "durationMs": 202000
    }
  ],
  "total": 12,
  "limit": 20,
  "offset": 0
}
```

---

### Create Automation from Template

```
POST /api/automations/from-template
```

**Request Body**:
```json
{
  "orgId": "org_xxx",
  "template": "bugbot",
  "repos": [{ "repoPath": "org/repo", "forgeType": "github", "defaultBranch": "main" }],
  "overrides": {
    "prompt": "Custom review instructions..."
  }
}
```

**Available Templates**: `bugbot`, `dependency-audit`, `code-health`

**Response** (201): Created automation object with template defaults applied.

---

## Webhook Endpoints (Gateway)

### Slack Events

```
POST /api/webhooks/slack
```

**Headers**: Standard Slack request headers (`x-slack-signature`, `x-slack-request-timestamp`).

**Verification**: HMAC-SHA256 with Slack signing secret.

**Challenge handling**: Responds to `url_verification` challenges automatically.

**Processing**: Normalizes to `InboundEvent` and dispatches through router.

---

### Linear Webhooks

```
POST /api/webhooks/linear
```

**Headers**: `x-linear-signature` (HMAC-SHA256).

**Processing**: Normalizes to `InboundEvent` and dispatches through router.

---

### Generic Webhook (user-defined)

```
POST /api/webhooks/automation/:automation_id
```

**Verification**: HMAC-SHA256 using the automation's configured webhook secret.

**Processing**: Validates payload against automation's `body_jsonpath_filters`, normalizes to `InboundEvent`.

---

## Internal Interfaces (platform package)

### AutomationService

```typescript
interface AutomationService {
  create(auth: AuthContext, params: CreateAutomationParams): Promise<Automation>;
  update(auth: AuthContext, id: string, params: UpdateAutomationParams): Promise<Automation>;
  delete(auth: AuthContext, id: string): Promise<void>;
  enable(auth: AuthContext, id: string): Promise<Automation>;
  disable(auth: AuthContext, id: string): Promise<Automation>;
  get(auth: AuthContext, id: string): Promise<Automation>;
  list(auth: AuthContext, params: ListAutomationsParams): Promise<PaginatedResult<Automation>>;
  listRuns(auth: AuthContext, automationId: string, params: ListRunsParams): Promise<PaginatedResult<AutomationRun>>;
  createFromTemplate(auth: AuthContext, params: TemplateParams): Promise<Automation>;
}
```

### AutomationMatcher

```typescript
interface AutomationMatcher {
  findMatches(event: InboundEvent): Promise<Automation[]>;
}
```

### AutomationScheduler

```typescript
interface AutomationScheduler {
  start(): void;
  stop(): void;
  reschedule(automationId: string, nextRunAt: Date | null): Promise<void>;
  removeFromSchedule(automationId: string): Promise<void>;
}
```

### New RouteAction

```typescript
interface CreateAutomationSessionAction {
  type: "create_automation_session";
  automationId: string;
  prompt: string;
  modelId?: string;
  activeSkills: Array<{ source: string; slug: string }>;
  repos: Array<{ repoPath: string; forgeType: string | null; defaultBranch: string }>;
  triggerContext: string;
}
```
