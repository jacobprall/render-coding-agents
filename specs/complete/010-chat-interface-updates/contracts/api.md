# API Contracts: Agent Chat Interface Updates

## Modified: POST `/api/sessions/[id]/message`

Send a user message and start an agent run.

**Request Body** (additions):

```json
{
  "content": "Run the architect review on this module",
  "modelId": "claude-4-sonnet",
  "turnSkillRefs": [
    { "source": "builtin", "slug": "architect-review" }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| content | string | yes | User message text |
| modelId | string | no | Model override |
| turnSkillRefs | ActiveSkillRef[] | no | One-shot skills for this turn only; merged with session `activeSkills` for job enqueue |

**Behavior**:
- `turnSkillRefs` MUST NOT be written to `sessions.activeSkills`
- Duplicate `{source, slug}` pairs between session and turn refs are deduped

**Response** (unchanged): `{ success, messageId, runId, isFirstMessage }`

---

## Modified: POST `/api/sessions/[id]/git/commit`

Commit working tree changes in the session sandbox.

**Request Body**:

```json
{
  "message": "Agent changes: src/foo.ts",
  "branch": "agent/010-chat-updates",
  "createBranch": true
}
```

**Response (200)**:

```json
{
  "commitSha": "a1b2c3d",
  "branch": "agent/010-chat-updates",
  "pushed": false,
  "filesChanged": 3,
  "linesAdded": 42,
  "linesRemoved": 7
}
```

**Response when push enabled but fails** (200 with warning fields):

```json
{
  "commitSha": "a1b2c3d",
  "branch": "main",
  "pushed": false,
  "pushError": "remote rejected: permission denied",
  "filesChanged": 1,
  "linesAdded": 10,
  "linesRemoved": 0
}
```

**Errors**:
- 400: Invalid body / empty message / nothing to commit
- 401/403: Auth
- 404: Session has no repository
- 502: Sandbox unreachable (actionable message, not generic 500)
- 500: Git command failed (include `detail` from stderr when safe)

**Server behavior**:
1. `git add -A` (or equivalent staging)
2. `git commit -m "<message>"`
3. If `createBranch` + `branch`: create/checkout branch before commit as today’s UI expects
4. If `user_preferences.autoCommitPush`: `git push` (set `pushed: true` on success)
5. NEVER return placeholder SHA when git exit code ≠ 0

---

## Unchanged (consumers)

| Endpoint | Use |
|----------|-----|
| GET `/api/sessions/[id]/skills` | Slash picker source list |
| GET `/api/sessions/[id]/git/status` | Changes sub-view refresh after commit |
| GET `/api/sessions/[id]/git/diff?path=` | Per-file diff in Files → Changes |
| GET `/api/sessions/[id]/files` | Explorer |
| GET `/api/sessions/[id]/files/content` | File viewer |

---

## Sandbox (internal, via `sandboxGit`)

Invoked from `sandbox-client.commitSessionChanges()`:

| Step | git argv (conceptual) |
|------|------------------------|
| Stage | `add`, `-A` |
| Branch | `checkout`, `-b`, `<branch>` (if createBranch) |
| Commit | `commit`, `-m`, `<message>` |
| Push | `push` (if preference enabled) |

All calls use existing `POST /git` with `{ args: string[] }` and session id header.
