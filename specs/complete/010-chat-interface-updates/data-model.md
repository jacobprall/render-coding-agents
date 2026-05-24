# Data Model: Agent Chat Interface Updates

## Overview

This feature is primarily UI and API-wiring over existing session, sandbox, and preference stores. No new database tables are required.

## Entities

### ActiveSkillRef (existing)

| Field | Type | Notes |
|-------|------|-------|
| source | `"builtin" \| "user" \| "repo"` | Skill origin |
| slug | string | Skill identifier |

**Storage**: `sessions.activeSkills` (JSON), optional per-message `turnSkillRefs` (transient, request body only).

**Validation**: Same rules as `SessionService.updateSkills` — invalid refs return 400.

### SlashCommandSelection (transient, client)

| Field | Type | Notes |
|-------|------|-------|
| skillRef | ActiveSkillRef | Selected from picker |
| filterText | string | Text after `/` while picking |
| attachedAt | timestamp | When user confirmed pick |

**Lifecycle**: Created in chat input → sent as `turnSkillRefs` on POST message → cleared from input after successful send.

### CommitRequest (API body)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| message | string | yes | Commit message |
| branch | string | no | Target branch name |
| createBranch | boolean | no | Create branch before commit |

**Response** (success):

| Field | Type | Notes |
|-------|------|-------|
| commitSha | string | Short or full SHA |
| branch | string | Branch committed on |
| pushed | boolean | Whether remote push ran |
| pushError | string? | Present if push failed after commit |
| filesChanged | number | Count of files in commit |
| linesAdded | number | Optional aggregate |
| linesRemoved | number | Optional aggregate |

### ToolCallPresentation (UI state, per message part)

| Field | Type | Notes |
|-------|------|-------|
| toolCallId | string | From stream |
| collapsed | boolean | Default true |
| widthMode | `"narrow" \| "full"` | narrow when collapsed; full when expanded |

No persistence.

### FilesPanelContext (UI routing)

| Field | Type | Notes |
|-------|------|-------|
| subView | `"tree" \| "changes"` | Active sub-tab in FilesView |
| selectedPath | string? | File path for tree/preview |
| selectedChangePath | string? | Path for inline diff in changes list |

**Transitions**:
- Review bar "Review" → `subView: changes`
- File chip click → `subView: tree`, `selectedPath: path`
- Mobile Files tab → default `tree` or last subView in session memory (optional)

## User Preferences (existing)

### user_preferences

| Field | Type | Default | Used by |
|-------|------|---------|---------|
| autoCommitPush | boolean | false | Commit route — gate `git push` |

## State Transitions

### Commit flow

```text
idle → committing → success | failed
success → refresh git status + clear live file changes (chat) + toast
failed → toast with sandbox stderr snippet (no false success)
```

### Slash skill attachment

```text
typing → picker open (on "/") → skill selected (chip visible) → send → cleared
send error → chip may remain for retry
```

## Relationships

- **Session** 1—N **Chat messages**; session has **activeSkills** (persistent).
- **Message send** optionally carries **turnSkillRefs** → merged into **agent run job** only.
- **Commit** operates on **session sandbox workspace** keyed by `sessionId`.
- **User** 1—1 **user_preferences** controls push behavior.
