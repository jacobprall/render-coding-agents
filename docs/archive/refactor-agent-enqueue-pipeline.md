# Refactor: Unify Agent Enqueue Pipeline

**Status:** Proposed  
**Smell:** Duplicated Code → Shotgun Surgery (Fowler)  
**Impact:** High — behavioral drift already present, every enqueue-path change requires edits in 3+ files  
**Estimated effort:** 1–2 days

---

## The Problem

The codebase has **three parallel implementations** of the same pipeline: "take a session, assemble chat context, resolve skills, build a job payload, and push it onto the Redis queue." Two of these are explicitly documented as mirrors:

```
// Mirrors the logic in apps/web/lib/agent/enqueue-session-job.ts.
```

```
// Mirrors the logic in apps/web/lib/skills/resolve-for-session.ts.
```

The copies have already started to diverge.

### Where the duplicates live

| Concern | Platform (`packages/platform/`) | Web (`apps/web/`) | CI Service (`packages/platform/`) |
|---------|------|-----|---------|
| **`collectModelMessages`** | `services/session-agent-jobs.ts:32–50` | `lib/agent/enqueue-session-job.ts:26–44` | — (omits modelMessages entirely) |
| **`getOrCreateChatId`** | `services/session-agent-jobs.ts:58–73` | `lib/agent/enqueue-session-job.ts:51–66` | `services/ci.ts:497–508` |
| **`enqueueSessionTriggerJob`** | `services/session-agent-jobs.ts:179–280` | `lib/agent/enqueue-session-job.ts:69–183` | `services/ci.ts:404–495` |
| **`resolveSkillsForSession`** | `services/session-skills.ts:17–53` | `lib/skills/resolve-for-session.ts:22–54` | `services/ci.ts:510–546` (private copy) |
| **`AgentTrigger` type** | `services/session-agent-jobs.ts:15–22` | `lib/agent/enqueue-session-job.ts:18–24` | — |

### Drift that already exists

1. **`AgentTrigger` type mismatch** — The platform version includes `"deploy_failure"`, the web version does not. Adding a new trigger requires updating both, and forgetting one is silent.

2. **`modelMessages` omitted in CI path** — `CIService.enqueueSessionTriggerJob` never calls `collectModelMessages`, so CI-triggered jobs lose conversation continuity that other trigger paths preserve.

3. **`validateSdkModelMessages` only in web** — The web copy wraps `collectModelMessages` with a validation step (currently a no-op) that doesn't exist in the platform copy.

4. **Forge token resolution differs** — Platform uses `getDefaultForgeProvider(FORGEJO_AGENT_TOKEN)`, web resolves via `syncConnections`, and CI uses `getForgeForSession`. Three policies for the same decision.

5. **Skills resolution: three copies** — `session-skills.ts`, `resolve-for-session.ts`, and CI's private `resolveSkillsForSession` are character-for-character identical today, but any change to skill loading must be applied in three places.

### Maintenance cost

Any change to "how we enqueue agent jobs" — adding a field to the payload, changing how conversation history is loaded, adjusting skill resolution, supporting a new trigger type — requires editing **3–5 files** across two packages. The compiler doesn't catch most of the drift because the types are also duplicated. This is textbook **Shotgun Surgery**.

---

## Refactoring Plan

### Step 1: Single `AgentTrigger` type (30 min)

Move `AgentTrigger` to `@openforge/platform` (or `@openforge/shared`). Delete both local copies. All consumers import from one place.

```
packages/platform/src/types/agent-trigger.ts
  → export type AgentTrigger = "user_message" | "ci_failure" | ... | "deploy_failure";
```

### Step 2: Delete duplicate skill resolution (30 min)

`session-skills.ts` and `resolve-for-session.ts` are identical. Keep the platform version (`session-skills.ts`) and delete the web copy. Update web imports:

```diff
- import { resolveSkillsForSessionRow } from "@/lib/skills/resolve-for-session";
+ import { resolveSkillsForSession } from "@openforge/platform";
```

Delete the private `resolveSkillsForSession` in `ci.ts` and import from `session-skills.ts`.

### Step 3: Single `collectModelMessages` + `getOrCreateChatId` (1 hr)

These are pure functions that operate on DB rows. Move them to a shared module in platform:

```
packages/platform/src/services/agent-enqueue.ts
  → export function collectModelMessages(rows) { ... }
  → export function getOrCreateChatId(db, sessionId) { ... }
```

Delete copies in `enqueue-session-job.ts` and `ci.ts`.

### Step 4: Unify `enqueueSessionTriggerJob` (2–3 hrs)

This is the core of the refactor. The three implementations differ mainly in:
- **Queue adapter** — platform uses `QueueAdapter` interface, web uses `enqueueJob(redis, ...)` directly
- **Forge token policy** — different strategies for resolving forge credentials
- **Feature gaps** — CI path missing `modelMessages`

Create a single pipeline function:

```typescript
// packages/platform/src/services/agent-enqueue.ts

interface EnqueueDeps {
  db: PlatformDb;
  queue: QueueAdapter;
  forge: ForgeProvider;
  forgeUsername: string;
}

export async function enqueueTriggerJob(
  deps: EnqueueDeps,
  sessionId: string,
  trigger: AgentTrigger,
  opts?: {
    contextMessage?: string;
    modelId?: string;
    maxAttempts?: number;
  },
): Promise<{ runId: string; chatId: string }> {
  // 1. Load session, validate status
  // 2. getOrCreateChatId
  // 3. Append synthetic user message if contextMessage provided
  // 4. Load chat transcript
  // 5. collectModelMessages (always — fixes CI gap)
  // 6. resolveSkillsForSession
  // 7. Insert agent_runs row
  // 8. Update chat active_run_id
  // 9. queue.enqueue({ consistent payload })
}
```

**Callers adapt by providing the right `EnqueueDeps`:**

- **Web API routes** (`sendMessage`, `attachRepo`): construct deps with web's Redis-backed `QueueAdapter` and user's forge token from `syncConnections`
- **Platform services** (`SessionService.create`, webhooks): construct deps with platform's `QueueAdapter` and agent forge token
- **CI service**: construct deps with CI-specific forge resolution — no more private copy

### Step 5: Thin out `SessionService` (1 hr)

After step 4, `SessionService.create` and `sendMessage` can delegate their "assemble + enqueue" logic to `enqueueTriggerJob`. These methods still own session-level concerns (creating the DB row, validating input, updating status) but the enqueue orchestration is no longer inlined.

### Step 6: Regression coverage (1 hr)

Write snapshot tests for the enqueue payload shape across trigger types:
- `user_message` via `sendMessage`
- `ci_failure` via CI handler
- `deploy_failure` via webhook
- `review_comment` via webhook

Assert that `modelMessages`, `resolvedSkills`, `trigger`, and `forgeType` are always present.

---

## Resulting structure

```
Before (3 algorithms, 5 files):

  apps/web/lib/agent/enqueue-session-job.ts    ← collectModelMessages, getOrCreateChat,
                                                  enqueueSessionTriggerJob, AgentTrigger
  apps/web/lib/skills/resolve-for-session.ts   ← resolveSkillsForSessionRow

  packages/platform/services/session-agent-jobs.ts  ← collectModelMessages, getOrCreateChatId,
                                                       enqueueSessionTriggerJob, AgentTrigger
  packages/platform/services/session-skills.ts      ← resolveSkillsForSession
  packages/platform/services/ci.ts                  ← private copies of all of the above

After (1 algorithm, callers adapt via deps):

  packages/platform/src/services/agent-enqueue.ts
    ├── AgentTrigger (single type)
    ├── collectModelMessages()
    ├── getOrCreateChatId()
    ├── enqueueTriggerJob(deps, sessionId, trigger, opts)
    └── re-exports resolveSkillsForSession from session-skills.ts

  apps/web/lib/agent/enqueue-session-job.ts  → thin wrapper: builds EnqueueDeps, calls enqueueTriggerJob
  packages/platform/services/ci.ts           → calls enqueueTriggerJob directly
  packages/platform/services/session.ts      → calls enqueueTriggerJob directly
```

### What this fixes

| Issue | Before | After |
|-------|--------|-------|
| New trigger type | Edit 2 `AgentTrigger` definitions | Edit 1 |
| Change skill resolution | Edit 3 files | Edit 1 |
| Add field to job payload | Edit 3 `enqueue` functions | Edit 1 |
| CI jobs missing `modelMessages` | Silent behavior gap | Fixed by construction |
| Forge token policy | 3 implicit strategies | Explicit per-caller via `EnqueueDeps` |

