# `apps/web/` Comprehensive Audit Remediation Plan

> Generated: 2026-05-24
> Status: Draft
> Scope: All security, bug, performance, and architecture findings from the full audit of `apps/web/`

---

## Table of Contents

1. [Phase 1: Critical Security Fixes](#phase-1-critical-security-fixes)
2. [Phase 2: Critical Bug Fixes](#phase-2-critical-bug-fixes)
3. [Phase 3: Critical Performance Fixes](#phase-3-critical-performance-fixes)
4. [Phase 4: High-Severity Security](#phase-4-high-severity-security)
5. [Phase 5: High-Severity Bugs](#phase-5-high-severity-bugs)
6. [Phase 6: High-Severity Performance](#phase-6-high-severity-performance)
7. [Phase 7: Medium Security & Hardening](#phase-7-medium-security--hardening)
8. [Phase 8: Medium Bugs](#phase-8-medium-bugs)
9. [Phase 9: Medium Performance](#phase-9-medium-performance)
10. [Phase 10: Architecture & Code Smells](#phase-10-architecture--code-smells)
11. [Phase 11: Low-Severity & Cleanup](#phase-11-low-severity--cleanup)

---

## Phase 1: Critical Security Fixes

### 1.1 Remove `forgeToken` from Client-Readable Session

**File:** `apps/web/lib/auth/index.ts` (lines 175–181)
**Problem:** The NextAuth `session` callback exposes the decrypted GitHub OAuth token (with `repo` scope) to the browser via `/api/auth/session`. Any XSS or malicious browser extension can exfiltrate it.

**Plan:**
1. Remove `session.forgeToken = token.forgeToken ?? ""` from the `session` callback.
2. Remove `forgeToken` from the `Session` type declaration (lines 18–30).
3. Audit all client-side references to `session.forgeToken` — there should be none; if any exist, replace with a server-side proxy call.
4. Verify that server-only paths (`requireForgeAuth` in `lib/platform.ts`) still function because they read the JWT token directly, not the session response.
5. Remove the `forgeToken` field from `AuthSessionProvider` props if passed.

**Validation:** After change, `GET /api/auth/session` must not include `forgeToken` in the response JSON. Write a test or manually verify.

---

### 1.2 Fix Shell Command Injection in `listDirectory`

**File:** `apps/web/lib/sandbox-client.ts` (lines 145–149)
**Called from:** `apps/web/app/api/sessions/[id]/files/route.ts` (lines 28–32)
**Problem:** User-controlled `path` query param is interpolated into a shell `find` command string. Payloads like `"; malicious-cmd; echo "` execute arbitrary commands.

**Plan:**
1. Add a strict path validation function at the top of `sandbox-client.ts`:
   ```typescript
   const SAFE_PATH_RE = /^[a-zA-Z0-9/._ -]+$/;
   function validateSandboxPath(path: string): string {
     const normalized = path.replace(/^\//, "");
     if (!normalized || normalized.includes("..") || !SAFE_PATH_RE.test(normalized)) {
       throw new Error(`Invalid path: ${path}`);
     }
     return normalized;
   }
   ```
2. Call `validateSandboxPath(dirPath)` at the top of `listDirectory` before any shell interpolation.
3. Apply the same validation in `readFileContent`, `writeFileContent`, and any other sandbox functions that accept paths.
4. Long-term: Replace the shell `find` command with a structured sandbox `/list` API endpoint that accepts path as a JSON field (no shell involved). Track this as a separate task under Phase 10.
5. Add path validation in the API route handler as defense-in-depth:
   ```typescript
   // apps/web/app/api/sessions/[id]/files/route.ts
   const path = url.searchParams.get("path") ?? "/";
   if (path.includes("..") || /[";`$|]/.test(path)) {
     return NextResponse.json({ error: "Invalid path" }, { status: 400 });
   }
   ```

**Validation:** Attempt `GET /api/sessions/{id}/files?path=/foo";id;echo"` — must return 400.

---

## Phase 2: Critical Bug Fixes

### 2.1 Ask-User Reply Misrouting After Failed Submit

**Files:** `apps/web/components/session/use-agent-chat.ts` (line 267), `apps/web/components/session/chat-panel.tsx` (lines 124–132)
**Problem:** `submitAskUserReply` clears `askUserPrompt` optimistically before the API call. On failure, `askUserPrompt` is null but `pendingAsk` (scanned from parts) still renders the card. The next click goes through `sendMessage(answer)` — sending it as a new turn instead of a tool reply.

**Plan:**
1. In `submitAskUserReply`, do NOT clear `askUserPrompt` optimistically. Only clear it on success.
2. Add a `submittingReply` state (or ref) to disable the card while in flight.
3. On failure, keep `askUserPrompt` intact and surface the error on the card itself.
4. In `handleAskUserResponse` (`chat-panel.tsx`), change the routing logic to check **both** `chat.askUserPrompt?.toolCallId` and `pendingAsk?.toolCallId` before deciding the action:
   ```typescript
   function handleAskUserResponse(answer: string) {
     const ask = chat.askUserPrompt ?? pendingAsk;
     if (ask?.toolCallId && (activeRunId || chat.activeRunId)) {
       void chat.submitAskUserReply(answer);
       return;
     }
     void chat.sendMessage(answer);
   }
   ```
5. Remove the separate `pendingAsk` scan entirely — trust the reducer to be the single source of truth (see also Phase 10.14).

**Validation:** Simulate a network error on `/api/sessions/[id]/reply` → retry from the ask card → verify it hits `/reply` not `/message`.

---

### 2.2 Double-Submit Race Creates Duplicate Messages

**Files:** `apps/web/components/session/use-agent-chat.ts` (lines 208–218), `apps/web/components/session/chat-input.tsx` (lines 84–91)
**Problem:** `isActive` is React state; two rapid Enter presses both pass the guard before re-render applies `START_STREAMING`.

**Plan:**
1. Add a `sendingRef = useRef(false)` in `useAgentChat`.
2. At the top of `sendMessage`, check `if (sendingRef.current) return;` then immediately `sendingRef.current = true`.
3. Reset `sendingRef.current = false` in the `finally` block (after both success and error paths).
4. Additionally, disable the submit button immediately in `chat-input.tsx`'s `submit()`:
   ```typescript
   function submit() {
     if (!canSend() || isStreaming || sendingRef.current) return;
     // ...
   }
   ```
5. Consider adding an `X-Idempotency-Key` header to `POST /api/sessions/[id]/message` (use the client-generated message ID).

**Validation:** Rapidly double-click Send or double-tap Enter → only one message appears.

---

## Phase 3: Critical Performance Fixes

### 3.1 Split Streaming from Message History Rendering

**Files:** `apps/web/components/session/message-list/message-area.tsx` (lines 180–201), `apps/web/components/session/chat-panel.tsx` (lines 99–103), `apps/web/components/markdown.tsx`
**Problem:** Every SSE token re-renders the full message list and re-parses markdown for all historical messages.

**Plan:**
1. Create `components/session/message-list/message-history.tsx`:
   - Accepts `messages: Message[]` and `onFileSelect`.
   - Wrapped in `React.memo` — only re-renders when `messages` array reference or length changes.
   - Renders the `.map()` of historical `MessageBubble` components.
2. Create `components/session/message-list/streaming-message.tsx`:
   - Accepts `streamingParts` and renders only the in-progress assistant message.
   - While streaming, renders text parts as plain `<pre>` or lightweight incremental renderer.
   - On stream end (part finalized), switches to full `<Markdown>` rendering.
3. In `message-area.tsx`, compose:
   ```tsx
   <MessageHistory messages={messages} onFileSelect={onFileSelect} />
   <StreamingMessage parts={streamingParts} />
   ```
4. `React.memo` on `MessageBubble` with comparator: `(prev, next) => prev.message.id === next.message.id && prev.message.parts === next.message.parts`.
5. Memoize `coerceLooseListParagraphs` inside `<Markdown>` with `useMemo([children])`.
6. Fix scroll-to-bottom in `chat-panel.tsx` (line 99–103):
   - Use `behavior: "instant"` while streaming.
   - Debounce via `requestAnimationFrame`.
   - Depend on `streamingParts.length` or a counter, not the full array reference.

**Validation:** Open React DevTools profiler, stream a message with 50+ existing messages → only `StreamingMessage` re-renders per token, not historical rows.

---

### 3.2 Add Database Index and Paginate Messages

**Files:** `packages/db/schema/session.ts` (lines 148–160), `apps/web/app/(authenticated)/sessions/[id]/page.tsx` (lines 98–109)
**Problem:** No index on `chat_messages.chat_id`; unbounded message hydration ships entire conversation in RSC payload.

**Plan:**
1. Add index in schema:
   ```typescript
   // packages/db/schema/session.ts
   export const chatMessagesIndexes = {
     chatIdCreatedAt: index("chat_messages_chat_id_created_idx")
       .on(chatMessages.chatId, chatMessages.createdAt),
   };
   ```
2. Generate migration: `pnpm --filter @coding-agents/web db:generate`
3. Apply: `pnpm --filter @coding-agents/web db:push`
4. Add pagination to the session page query:
   ```typescript
   const PAGE_SIZE = 100;
   const messages = chatRow
     ? await db
         .select({ id, role, parts, createdAt })
         .from(chatMessages)
         .where(eq(chatMessages.chatId, chatRow.id))
         .orderBy(desc(chatMessages.createdAt))
         .limit(PAGE_SIZE)
     : [];
   messages.reverse(); // chronological order for display
   ```
5. Add a "Load earlier messages" button/trigger in `MessageArea` that fetches the next page via API.
6. Create `GET /api/sessions/[id]/messages?before={cursor}` endpoint for pagination.

**Validation:** Session with 500+ messages loads in <500ms TTFB; only last 100 messages in initial payload.

---

## Phase 4: High-Severity Security

### 4.1 Sign OAuth State Parameter

**File:** `apps/web/app/api/oauth/github/route.ts` (lines 15–31), `apps/web/app/api/oauth/github/callback/route.ts` (lines 22–31)
**Problem:** OAuth `state` is unsigned base64 JSON; `csrf` field is never validated server-side.

**Plan:**
1. Create `lib/auth/oauth-state.ts`:
   ```typescript
   import crypto from "crypto";
   const SECRET = process.env.AUTH_SECRET!;
   
   export function createSignedState(payload: object): string {
     const json = JSON.stringify(payload);
     const data = Buffer.from(json).toString("base64url");
     const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
     return `${data}.${sig}`;
   }
   
   export function verifySignedState<T>(state: string): T | null {
     const [data, sig] = state.split(".");
     if (!data || !sig) return null;
     const expected = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
     if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
     try { return JSON.parse(Buffer.from(data, "base64url").toString()); }
     catch { return null; }
   }
   ```
2. In the GitHub OAuth initiation route, use `createSignedState({ userId, csrf, ts })`.
3. Set `csrf` as a `__Host-oauth_csrf` cookie (httpOnly, sameSite=lax, secure, path=/).
4. In the callback route, use `verifySignedState` (reject if null) and compare `statePayload.csrf` against the cookie value. Delete the cookie after use.
5. Reject states older than 10 minutes (`ts` check).
6. Repeat for GitLab OAuth if applicable.

**Validation:** Tamper with the state param in the OAuth redirect URL → callback returns error.

---

### 4.2 Require Production Secrets (Fail Closed)

**Files:** `apps/web/lib/api/observability-auth.ts` (lines 3–8), `apps/web/lib/sandbox-client.ts` (line 3, 36–38), `apps/web/lib/gateway.ts` (line 11)
**Problem:** If env vars are unset, auth is skipped entirely — internal endpoints become public.

**Plan:**
1. In `observability-auth.ts`, change line 5:
   ```typescript
   if (!secret) {
     if (process.env.NODE_ENV === "production") return false;
     return true; // allow in dev
   }
   ```
2. In `sandbox-client.ts`, add startup check:
   ```typescript
   if (process.env.NODE_ENV === "production" && !SANDBOX_SECRET) {
     throw new Error("SANDBOX_SHARED_SECRET is required in production");
   }
   ```
3. In `gateway.ts`, same pattern:
   ```typescript
   if (process.env.NODE_ENV === "production" && !GATEWAY_SECRET) {
     throw new Error("GATEWAY_API_SECRET is required in production");
   }
   ```
4. In `sandbox-client.ts` `sandboxRequest()`, always include the auth header (even if empty string) so requests fail clearly when the sandbox expects auth.

**Validation:** Set `NODE_ENV=production` without secrets → app crashes on startup with clear error message.

---

### 4.3 Refresh `isAdmin` and `forgeToken` on JWT Refresh

**File:** `apps/web/lib/auth/index.ts` (lines 153–171)
**Problem:** `isAdmin` captured at sign-in only; `forgeToken` stale after disconnect.

**Plan:**
1. In the JWT `jwt` callback, always re-read from DB when the token is being refreshed (not just on initial sign-in):
   ```typescript
   async jwt({ token, user, trigger }) {
     const userId = user?.id ?? token.sub;
     if (userId) {
       // Always reconcile on refresh
       const [dbUser] = await db
         .select({ isAdmin: users.isAdmin })
         .from(users)
         .where(eq(users.id, userId))
         .limit(1);
       token.isAdmin = dbUser?.isAdmin ?? false;
       
       const forgeInfo = await loadForgeAccessTokenForUser(userId);
       token.forgeToken = forgeInfo?.token ?? "";
       token.forgeUsername = forgeInfo?.username ?? "";
       token.forgeType = forgeInfo?.provider ?? "github";
     }
     return token;
   }
   ```
2. Cache the DB reads with a 60-second TTL to avoid hitting DB on every request.
3. When `DELETE /api/oauth/github/status` disconnects, call `unstable_update()` on the session or set a short JWT max-age to force refresh.

**Validation:** Demote an admin via DB → within 60s, admin routes return 403 without re-login.

---

### 4.4 Fix `ensureSyncConnection` Read-Then-Write Race

**File:** `apps/web/lib/auth/index.ts` (lines 83–105)
**Problem:** Two concurrent OAuth callbacks can both insert, causing duplicate rows or constraint violations.

**Plan:**
1. Replace the `if (existing) update else insert` with `onConflictDoUpdate`:
   ```typescript
   await db
     .insert(syncConnections)
     .values({
       id: crypto.randomUUID(),
       userId,
       provider,
       remoteUsername: username,
       encryptedAccessToken: encryptedAccess,
       createdAt: new Date(),
       updatedAt: new Date(),
     })
     .onConflictDoUpdate({
       target: [syncConnections.userId, syncConnections.provider],
       set: {
         remoteUsername: username,
         encryptedAccessToken: encryptedAccess,
         updatedAt: new Date(),
       },
     });
   ```
2. Ensure a unique constraint exists on `(userId, provider)` in the schema. If not, add it.

**Validation:** Simulate concurrent OAuth callbacks with the same user/provider → only one row exists.

---

### 4.5 Protect `/api/health/workers` Endpoint

**File:** `apps/web/app/api/health/workers/route.ts`
**Problem:** Unauthenticated, uses Redis `KEYS *` (DoS-prone), exposes worker count.

**Plan:**
1. Add `isAuthorizedObservabilityRequest(req)` check at the top.
2. Replace `redis.keys("worker:heartbeat:*")` with `redis.scan(0, { match: "worker:heartbeat:*", count: 100 })` loop.
3. Return 401 for unauthorized requests.

---

## Phase 5: High-Severity Bugs

### 5.1 Stop Endpoint Masks Failures as 200

**File:** `apps/web/app/api/sessions/[id]/stop/route.ts` (lines 13–16)
**Problem:** All non-`Response` errors return 200 `{ acknowledged: true }`.

**Plan:**
1. Change the catch to return 500:
   ```typescript
   } catch (err) {
     if (err instanceof Response) return err;
     console.error("[sessions/stop]", err);
     return NextResponse.json(
       { acknowledged: false, error: "Failed to stop session" },
       { status: 500 }
     );
   }
   ```
2. Update the client (`use-agent-chat.ts` `stopStreaming`) to handle non-200 and surface the failure. Retry once on 5xx.

---

### 5.2 Redis Rate Limiter Fails Open

**File:** `apps/web/lib/auth/rate-limit-async.ts` (lines 39–41)
**Problem:** Any Redis error returns `allowed: true`.

**Plan:**
1. Change to fail closed in production:
   ```typescript
   } catch (err) {
     console.error("[rate-limit] Redis error:", err);
     if (process.env.NODE_ENV === "production") {
       return { allowed: false, remaining: 0, resetAt: now + windowMs };
     }
     return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
   }
   ```
2. Actually wire `checkRateLimitAsync` into sensitive routes (see Phase 10.1).

---

### 5.3 Stale JWT Forge Token After Disconnect

**File:** `apps/web/app/api/oauth/github/status/route.ts` (lines 36–47)
**Problem:** After deleting the sync connection, the JWT still has the old `forgeToken`.

**Plan:**
1. After the DELETE operation in the status route, force session invalidation. NextAuth v5 supports `unstable_update`:
   ```typescript
   // After deleting sync connection
   // This forces the jwt callback to re-run and find no forge token
   ```
2. Alternatively, return a response header that tells the client to call `update()` on the session.
3. Combined with Phase 4.3 (always reconcile `forgeToken` from DB), this is resolved within the JWT refresh interval (60s max).

---

### 5.4 Optimistic User Message Never Rolled Back

**File:** `apps/web/components/session/use-agent-chat.ts` (lines 216–241)
**Problem:** On API failure, the optimistic message stays; retry creates duplicates.

**Plan:**
1. Store the pending message ID before dispatch:
   ```typescript
   const pendingId = userMessage.id;
   dispatch({ type: "ADD_USER_MESSAGE", message: userMessage });
   ```
2. In the catch block, dispatch a new `REMOVE_MESSAGE` action:
   ```typescript
   dispatch({ type: "REMOVE_MESSAGE", messageId: pendingId });
   dispatch({ type: "SET_ERROR", error: "..." });
   ```
3. Add `REMOVE_MESSAGE` to the reducer that filters `messages` by id.
4. Add idempotency key to the POST request to prevent server-side duplicates on retry.

---

### 5.5 SSE Error Doesn't Finish Stream Cleanly

**File:** `apps/web/components/session/use-agent-chat.ts` (lines 174–178)
**Problem:** Sets error but doesn't `FINISH_STREAMING` or close the source.

**Plan:**
1. When SSE enters terminal error state, dispatch both:
   ```typescript
   useEffect(() => {
     if (es.status === "error" && isActive) {
       dispatch({ type: "SET_ERROR", error: "Lost connection to server" });
       dispatch({ type: "FINISH_STREAMING" });
       es.close();
     }
   }, [es.status, isActive]);
   ```
2. Clear retry timer on terminal error.
3. Add an explicit "Reconnect" button in the error state UI rather than auto-reconnecting into a confused state.

---

## Phase 6: High-Severity Performance

### 6.1 Add Virtualization for Message List

**File:** `apps/web/components/session/message-list/message-area.tsx`
**Problem:** All messages are in the DOM; no windowing.

**Plan:**
1. Install `@tanstack/react-virtual`.
2. Replace the `messages.map()` with a virtualized list:
   ```typescript
   const rowVirtualizer = useVirtualizer({
     count: messages.length,
     getScrollElement: () => scrollContainerRef.current,
     estimateSize: () => 120, // estimated avg message height
     overscan: 5,
   });
   ```
3. Render only visible rows + overscan.
4. Keep `content-visibility: auto` as a CSS fallback for non-JS scenarios.
5. Ensure scroll-to-bottom still works by calling `rowVirtualizer.scrollToIndex(messages.length - 1)`.

---

### 6.2 Virtualize File Tree

**File:** `apps/web/components/session/file-tree.tsx`
**Problem:** Recursive `TreeNode` renders all visible nodes to DOM.

**Plan:**
1. The `visibleItems` array is already computed (line ~237). Use it as input to a flat virtualized list.
2. Each row renders with appropriate left padding based on depth.
3. Replace recursive `TreeNode` with a flat `VirtualFileNode` that receives `{ item, depth, isExpanded, onToggle }`.
4. Keep keyboard navigation working by mapping virtual index ↔ item.

---

### 6.3 Per-SSE Redis Connection → Share Client

**File:** `apps/web/app/api/sessions/[id]/stream/route.ts` (lines 78–86)
**Problem:** Each browser tab opens a new Redis command client.

**Plan:**
1. Replace `newRedisCmd(sessionId)` usage for history reads with `getSharedRedisClient()` from `lib/redis.ts`.
2. Keep the dedicated pub/sub subscriber (required by Redis protocol).
3. Remove the per-connection client factory or limit its use to pub/sub only.
4. Add `maxRetriesPerRequest: 3` and `enableReadyCheck: false` to the shared client config if not present.

**Validation:** Monitor Redis connection count under 10 concurrent SSE streams → should remain constant (1 shared + 1 pub/sub).

---

### 6.4 Shiki Singleton Highlighter with Cache

**File:** `apps/web/components/code-block.tsx` (lines 63–80)
**Problem:** Each `CodeBlock` independently calls `import("shiki")` and `codeToHtml()` with no shared instance or cache.

**Plan:**
1. Create `lib/shiki.ts`:
   ```typescript
   import { createHighlighter } from "shiki";
   
   let highlighter: Awaited<ReturnType<typeof createHighlighter>> | null = null;
   const cache = new Map<string, string>();
   
   export async function highlight(code: string, lang: string): Promise<string> {
     const key = `${lang}:${hashCode(code)}`;
     if (cache.has(key)) return cache.get(key)!;
     if (!highlighter) {
       highlighter = await createHighlighter({
         themes: ["github-dark-default"],
         langs: [/* subset of common langs */],
       });
     }
     const html = highlighter.codeToHtml(code, { lang, theme: "github-dark-default" });
     cache.set(key, html);
     if (cache.size > 500) { /* evict oldest */ }
     return html;
   }
   ```
2. Update `code-block.tsx` to call `highlight(code, lang)` instead of inline `import("shiki")`.

---

## Phase 7: Medium Security & Hardening

### 7.1 Add Security Headers

**File:** `apps/web/next.config.ts`
**Problem:** No CSP, X-Frame-Options, HSTS, or other security headers.

**Plan:**
1. Add `headers()` to `next.config.ts`:
   ```typescript
   async headers() {
     return [{
       source: "/(.*)",
       headers: [
         { key: "X-Frame-Options", value: "DENY" },
         { key: "X-Content-Type-Options", value: "nosniff" },
         { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
         { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
         { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com data:; connect-src 'self'; frame-ancestors 'none';" },
       ],
     }];
   }
   ```
2. Tune CSP iteratively — start with `report-only` mode, then enforce.

---

### 7.2 Fix CSRF Substring Match Weakness

**File:** `apps/web/middleware.ts` (lines 107–111)
**Problem:** Non-API CSRF uses `origin.includes(host)` — a malicious origin containing the host string as a substring passes.

**Plan:**
1. Replace with the same `originMatchesHost()` helper used for API routes, or extract a shared function:
   ```typescript
   function originMatchesHost(origin: string, host: string): boolean {
     try {
       const originHost = new URL(origin).host;
       return originHost === host;
     } catch {
       return false;
     }
   }
   ```
2. Apply to both API and non-API CSRF checks.

---

### 7.3 Standardize All Client Fetches via `apiFetch`

**Problem:** ~5 SWR fetchers bypass `apiFetch`, missing the `X-Requested-With` CSRF header.

**Plan:**
1. Export a `swrFetcher` from `lib/api-fetch.ts`:
   ```typescript
   export async function swrFetcher<T>(url: string): Promise<T> {
     const { ok, data } = await apiFetch<T>(url);
     if (!ok) throw new Error("Fetch failed");
     return data;
   }
   ```
2. Update all SWR hooks to use `swrFetcher`:
   - `components/layout/sidebar.tsx` (lines 48–53)
   - `components/layout/use-session-tabs-sync.tsx` (lines 14–18)
   - `hooks/use-file-tree.ts` (lines 22–26)
   - `hooks/use-git-status.ts` (lines 21–25)
   - `app/(authenticated)/observability/use-events.ts` (lines 25–28)

---

### 7.4 Project IDOR on Session Creation

**File:** `apps/web/app/api/sessions/route.ts` (lines 123–128)
**Problem:** Unvalidated `projectId` can reference another org's project.

**Plan:**
1. In `packages/platform/src/services/session.ts` `create()`, add ownership check:
   ```typescript
   if (params.projectId) {
     const [proj] = await this.db
       .select({ orgId: projects.orgId })
       .from(projects)
       .where(and(eq(projects.id, params.projectId), eq(projects.orgId, auth.orgId)))
       .limit(1);
     if (!proj) throw new SessionNotFoundError();
   }
   ```
2. Validate request body with Zod in the route handler (see Phase 10.6).

---

### 7.5 Webhook Signature Verification at Web Layer

**Files:** `apps/web/app/api/webhooks/github/route.ts`, `gitlab/route.ts`, `render/route.ts`
**Problem:** Signatures are forwarded but not verified before proxying.

**Plan:**
1. For GitHub: verify `x-hub-signature-256` using `GITHUB_WEBHOOK_SECRET` before forwarding.
2. For GitLab: verify `X-Gitlab-Token`.
3. For Render: verify signature per Render docs.
4. Reject invalid signatures with 401.
5. If the web app doesn't have access to webhook secrets, at minimum require `GATEWAY_API_SECRET` in production (Phase 4.2 handles this).

---

### 7.6 Rate-Limit IP Trust

**File:** `apps/web/middleware.ts` (lines 13–16)
**Problem:** Trusts `X-Forwarded-For` without validating it's from a known proxy.

**Plan:**
1. When deployed behind a known load balancer, use the rightmost untrusted IP:
   ```typescript
   function getRateLimitKey(request: NextRequest): string {
     const forwarded = request.headers.get("x-forwarded-for");
     const ips = forwarded?.split(",").map(s => s.trim()) || [];
     // Trust only the last hop (closest to our infra)
     const ip = ips.length > 0 ? ips[ips.length - 1] : request.ip || "unknown";
     return `rl:${ip}`;
   }
   ```
2. Alternatively, use Render's `X-Real-IP` header which is set by the platform LB.

---

### 7.7 Sanitize Shiki HTML Output

**File:** `apps/web/components/code-block.tsx` (lines 112–116)
**Problem:** `dangerouslySetInnerHTML={{ __html: html }}` with Shiki output — if agent-generated code triggers a Shiki bug, XSS is possible.

**Plan:**
1. Use Shiki's React renderer (`@shikijs/react`) which outputs React elements instead of raw HTML.
2. Alternatively, sanitize with DOMPurify before setting innerHTML:
   ```typescript
   import DOMPurify from "isomorphic-dompurify";
   const sanitized = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
   ```

---

### 7.8 Admin UI Server-Side Gate

**Problem:** `/settings/team` page is accessible to non-admins (API enforces, but UI doesn't).

**Plan:**
1. In the team page server component, check session and redirect:
   ```typescript
   const session = await auth();
   if (!session?.isAdmin) redirect("/settings");
   ```

---

### 7.9 Invite Token Enumeration

**File:** `apps/web/app/api/invite/route.ts` (lines 10–21)
**Problem:** Different error messages for invalid/expired/redeemed tokens enable enumeration.

**Plan:**
1. Return a generic error for all invalid states:
   ```typescript
   if (!invite || invite.redeemedAt || invite.expiresAt < new Date()) {
     return NextResponse.json({ error: "Invalid or expired invite" }, { status: 404 });
   }
   ```
2. Tokens are 256-bit, so practical risk is low. This is defense-in-depth.

---

## Phase 8: Medium Bugs

### 8.1 Stale Closure in `no_active_run` Retry Logic

**File:** `apps/web/components/session/use-agent-chat.ts` (lines 132–141)
**Problem:** Retry decision reads stale `state.noRunRetries`.

**Plan:**
1. Add a `noRunRetriesRef = useRef(0)` synced from reducer state:
   ```typescript
   const noRunRetriesRef = useRef(state.noRunRetries);
   noRunRetriesRef.current = state.noRunRetries;
   ```
2. Use `noRunRetriesRef.current` in the callback instead of `state.noRunRetries`.
3. Alternatively, move retry decision into the reducer by returning a `shouldReconnect` flag from `NO_ACTIVE_RUN` action.

---

### 8.2 `useEventSource` Multiple Reconnect Timers

**File:** `apps/web/hooks/use-event-source.ts` (lines 92–122)
**Problem:** Multiple `onerror` events can schedule overlapping reconnects.

**Plan:**
1. Add a `reconnectingRef = useRef(false)` guard:
   ```typescript
   if (reconnectingRef.current) return;
   reconnectingRef.current = true;
   ```
2. Clear the guard when connection succeeds or is explicitly closed.
3. Always clear existing `reconnectTimer` before scheduling a new one.
4. Remove the `fetch(HEAD)` probe — it doubles request count. Instead, just schedule reconnect with exponential backoff.

---

### 8.3 Stop Safety Timer Reuses `retryTimerRef`

**File:** `apps/web/components/session/use-agent-chat.ts` (lines 293–304)
**Problem:** Safety timer and `no_active_run` retry share `retryTimerRef` — they clobber each other.

**Plan:**
1. Create a separate `stopSafetyTimerRef = useRef<NodeJS.Timeout | null>(null)`.
2. Use it for the 10s safety timeout in `stopStreaming`.
3. Clear `stopSafetyTimerRef` when a terminal SSE event arrives.
4. Keep `retryTimerRef` exclusively for `no_active_run` retries.

---

### 8.4 Model ID Overridden by Stale localStorage

**File:** `apps/web/components/session/session-workspace.tsx` (lines 94–98)
**Problem:** localStorage always wins over server `initialModelId`.

**Plan:**
1. Prefer server value on initial load; only use localStorage as fallback when server doesn't specify:
   ```typescript
   useEffect(() => {
     if (!initialModelId) {
       const stored = readStoredModelId(session.id);
       if (stored) setModelId(stored);
     }
   }, [session.id, initialModelId]);
   ```
2. When user explicitly changes model, write to localStorage AND update via API.
3. Add a version/timestamp to localStorage model entries to detect stale data.

---

### 8.5 Sandbox Unreachable Returns Empty Entries

**File:** `apps/web/app/api/sessions/[id]/files/route.ts` (lines 34–38)
**Problem:** Returns `{ entries: [] }` with 200 when sandbox is down.

**Plan:**
1. Return a proper error response:
   ```typescript
   if (msg.includes("unreachable") || msg.includes("ECONNREFUSED")) {
     return NextResponse.json(
       { error: "Workspace unavailable", code: "SANDBOX_UNREACHABLE" },
       { status: 503 }
     );
   }
   ```
2. Update the file tree UI to show a "Workspace starting..." or error state when 503.

---

### 8.6 New-User Bootstrap Not Atomic

**File:** `apps/web/lib/auth/index.ts` (lines 130–148)
**Problem:** Org assignment + scratch project insert are separate statements with no transaction.

**Plan:**
1. Wrap in a transaction:
   ```typescript
   await db.transaction(async (tx) => {
     // create org membership
     // insert scratch project
   });
   ```
2. Use idempotent upserts so partial retries don't create duplicates.

---

### 8.7 Multi-Tab Session Tabs Last-Write-Wins

**Files:** `apps/web/components/layout/session-tabs.tsx` (lines 79–83, 118–123)
**Problem:** Concurrent tabs overwrite each other's tab lists in localStorage.

**Plan:**
1. Listen for `storage` events to sync between tabs:
   ```typescript
   useEffect(() => {
     const handler = (e: StorageEvent) => {
       if (e.key === "coding-agents-session-tabs") {
         setTabs(JSON.parse(e.newValue || "[]"));
       }
     };
     window.addEventListener("storage", handler);
     return () => window.removeEventListener("storage", handler);
   }, []);
   ```
2. On write, merge (union) current tabs with stored tabs instead of overwriting.
3. Long-term: derive open tabs from URL state + server, not localStorage.

---

### 8.8 `externalRunId` Not Cleared When Prop Becomes Null

**File:** `apps/web/components/session/use-agent-chat.ts` (lines 85–89)
**Problem:** When parent passes `activeRunId={null}`, client `activeRunId` remains stale.

**Plan:**
1. Dispatch on null too:
   ```typescript
   useEffect(() => {
     dispatch({
       type: "SET_ACTIVE_RUN_ID",
       runId: externalRunId ?? null,
     });
   }, [externalRunId]);
   ```
2. Update reducer to handle `null` for `SET_ACTIVE_RUN_ID`.

---

### 8.9 Duplicate React Keys in Ask-User Options

**File:** `apps/web/components/session/ask-user-card.tsx` (line 21)
**Problem:** `key={opt}` collides when options repeat.

**Plan:**
1. Use index-based key:
   ```typescript
   {options.map((opt: string, index: number) => (
     <button key={`${toolCallId}-${index}`} ...>
   ```

---

### 8.10 GET Routes Missing Try/Catch Around Auth

**Files:** `apps/web/app/api/sessions/route.ts` (75–76), `apps/web/app/api/admin/invites/route.ts` (16–20), `apps/web/app/api/invite/route.ts` (4–26)
**Problem:** Auth helpers throw `Response` objects; GET handlers don't catch them → unhandled rejections.

**Plan:**
1. Wrap each GET handler in try/catch that handles `instanceof Response`:
   ```typescript
   export async function GET(req: NextRequest) {
     try {
       const auth = await requireForgeAuth();
       // ...
     } catch (err) {
       if (err instanceof Response) return err;
       return NextResponse.json({ error: "Internal error" }, { status: 500 });
     }
   }
   ```
2. Long-term: use the `withForgeAuth` wrapper (Phase 10.6) which handles this universally.

---

### 8.11 Dispatch After Unmount

**File:** `apps/web/components/session/use-agent-chat.ts` (throughout async handlers)
**Problem:** Async handlers can dispatch after component unmounts → React warnings.

**Plan:**
1. Add a mounted ref:
   ```typescript
   const mountedRef = useRef(true);
   useEffect(() => () => { mountedRef.current = false; }, []);
   ```
2. Guard all dispatches in async handlers: `if (mountedRef.current) dispatch(...)`.
3. Abort in-flight fetches on cleanup via `AbortController`.

---

## Phase 9: Medium Performance

### 9.1 Debounce File-Tree Invalidation

**Files:** `apps/web/hooks/use-file-tree.ts` (lines 135–145), `apps/web/components/session/use-agent-chat.ts` (lines 147–151)
**Problem:** Each `agent:file_changed` event triggers immediate directory refetch.

**Plan:**
1. In `use-file-tree.ts`, debounce the `notifyFileTreeChange` listener with 300ms:
   ```typescript
   const pendingDirs = useRef(new Set<string>());
   const debounceTimer = useRef<NodeJS.Timeout>();
   
   function onFileChanged(dir: string) {
     pendingDirs.current.add(dir);
     clearTimeout(debounceTimer.current);
     debounceTimer.current = setTimeout(() => {
       mutate(); // single refetch covers all pending dirs
       pendingDirs.current.clear();
     }, 300);
   }
   ```
2. Coalesce by parent directory — don't refetch same dir twice.

---

### 9.2 Fix SWR Key Strategy for File Tree

**File:** `apps/web/hooks/use-file-tree.ts` (lines 69–79)
**Problem:** Any expand/collapse changes the SWR key → refetches ALL expanded directories.

**Plan:**
1. Change to per-directory SWR keys:
   ```typescript
   // For each expanded path, maintain a separate SWR entry
   // Merge results into a unified DirectoryCache
   ```
2. Alternatively, keep single key but use `mutate` with optimistic data (only fetch the newly expanded directory and merge).
3. When collapsing, don't refetch — just hide the children locally.

---

### 9.3 Fix Middleware SSE Rate-Limit Mismatch

**File:** `apps/web/middleware.ts` (line 11)
**Problem:** `STREAM_PATHS` doesn't include the actual SSE route.

**Plan:**
1. Update:
   ```typescript
   const STREAM_PATHS = ["/api/sessions/"];
   // and check:
   function isStreamPath(pathname: string): boolean {
     return pathname.match(/^\/api\/sessions\/[^/]+\/stream$/) !== null;
   }
   ```
2. Exempt stream endpoints from the 100/min IP rate limit (they're long-lived connections, not repeated requests).

---

### 9.4 Consolidate `liveFileChanges` State

**Files:** `apps/web/components/session/use-agent-chat.ts` (lines 91–93), `apps/web/components/session/session-workspace.tsx` (lines 88, 121–123, 200–205)
**Problem:** State duplicated in reducer AND parent, causing extra renders.

**Plan:**
1. Remove the `onFileChanges` callback pattern.
2. Expose `state.liveFileChanges` directly from `useAgentChat` return value.
3. Pass it to `ReviewBar` and `MessageArea` as a prop.
4. Remove `setLiveFileChanges` state from `session-workspace.tsx`.
5. The `clearFileChanges` action stays in the reducer (dispatched on commit success).

---

### 9.5 Hidden Tabs — Pause When Inactive

**File:** `apps/web/components/session/session-workspace.tsx` (lines 246–294)
**Problem:** Both ChatPanel and FilesView stay mounted with active SWR/SSE.

**Plan:**
1. Pass `isActive={activeView === "chat"}` to ChatPanel.
2. Pass `isActive={activeView === "files"}` to FilesView / file tree hooks.
3. In `use-file-tree.ts`, gate SWR enabled on `isActive`:
   ```typescript
   const { data } = useSWR(isActive ? swrKey : null, fetcher, ...);
   ```
4. Keep DOM mounted (avoid re-mount cost) but pause data fetching.

---

### 9.6 Inline Props Defeating Memoization

**Files:** `apps/web/components/session/session-workspace.tsx` (lines 200–205, 261–283), `apps/web/components/session/chat-panel.tsx` (lines 182–183)
**Problem:** Inline objects/lambdas create new references every render.

**Plan:**
1. `useMemo` for `reviewFileChanges`:
   ```typescript
   const reviewFileChanges = useMemo(() =>
     liveFileChanges.map(f => ({ path: f.path, linesAdded: f.additions, ... })),
     [liveFileChanges]
   );
   ```
2. `useCallback` for handlers:
   ```typescript
   const handleSend = useCallback(
     (content, turnSkillRefs) => void chat.sendMessage(content, turnSkillRefs),
     [chat.sendMessage]
   );
   const handleStop = useCallback(() => void chat.stopStreaming(), [chat.stopStreaming]);
   ```
3. Extract `aboveInput` JSX to a memoized child component.

---

### 9.7 `no_active_run` Reconnect Loop + Backoff

**File:** `apps/web/components/session/use-agent-chat.ts` (lines 132–141)
**Problem:** Up to 30 retries every 2s, each calling `es.reconnect()`.

**Plan:**
1. Add exponential backoff: `delay = Math.min(2000 * 2^retries, 30000)`.
2. Cap at 10 retries instead of 30.
3. On 404/403 from the HEAD probe, don't reconnect — show error state.
4. Combined with 9.3 (SSE rate-limit fix), reconnects won't hit 429.

---

### 9.8 Chat Reducer O(n) Operations

**File:** `apps/web/components/session/chat-reducer.ts` (lines 74–84, 107–111), `apps/web/lib/ui/lib/chat-parts.ts` (lines 104–111)
**Problem:** `mergeLiveChange` filters/sorts entire list; `appendStreamEvent` maps all parts for tool_result.

**Plan:**
1. For tool results, maintain a `Map<toolCallId, number>` index to directly update without full scan:
   ```typescript
   const idx = toolCallIndex.get(toolCallId);
   if (idx !== undefined) {
     const updated = [...parts];
     updated[idx] = { ...updated[idx], result: p.result };
     return updated;
   }
   ```
2. For `mergeLiveChange`, use a `Map<path, LiveFileChange>` instead of array filter+sort.

---

### 9.9 Git Status Polling Interval

**File:** `apps/web/hooks/use-git-status.ts` (lines 41–47)
**Problem:** Polls every 5s unconditionally when `GitPanel` is mounted.

**Plan:**
1. Increase interval to 15s by default.
2. Only poll when the panel is actually visible (pass `isVisible` prop).
3. On `agent:file_changed` events, trigger an immediate refetch via `notifyGitStatusRefresh()` (already exists but debounce it).
4. Stop polling when no file changes are happening (idle detection).

---

### 9.10 Large Client Shell

**File:** `apps/web/app/(authenticated)/layout.tsx`
**Problem:** Entire authenticated shell is client-rendered; heavy JS boundary.

**Plan:**
1. Identify which parts of `AppShell` can be server components (e.g., static navigation chrome, user avatar).
2. Pass session list as RSC props with client hydration for interactive parts only.
3. Keep sidebar + session tabs as client components but render the outer layout server-side.
4. This is a larger refactor — schedule as a follow-up milestone.

---

## Phase 10: Architecture & Code Smells

### 10.1 Wire or Delete `rate-limit-async.ts`

**File:** `apps/web/lib/auth/rate-limit-async.ts`
**Problem:** Never imported anywhere.

**Plan:**
1. Wire into sensitive mutation routes: `/api/sessions/[id]/message`, `/api/auth/*`, `/api/admin/invites`, `/api/invite/accept`.
2. Use alongside in-memory middleware limiter as a second layer.
3. If decision is not to use it: delete the file and update comments in `rate-limit.ts`.

---

### 10.2 Delete or Use `lib/stream-events.ts`

**File:** `apps/web/lib/stream-events.ts`
**Problem:** Constants never imported.

**Plan:**
1. Replace magic strings in `use-agent-chat.ts` and `chat-reducer.ts` with imports from this file.
2. Or delete the file if we prefer the `@coding-agents/shared/client` types.

---

### 10.3 Fix Middleware `STREAM_PATHS`

**File:** `apps/web/middleware.ts` (line 11)
**Problem:** Lists `/api/chat` and `/api/agent/stream` which don't exist.

**Plan:** (Covered in Phase 9.3 — update to match actual SSE routes.)

---

### 10.4 Delete or Implement Skills API Stubs

**Files:** `apps/web/app/api/skills/route.ts`, `sync/route.ts`, `install/route.ts`, `repo/[...path]/route.ts`
**Problem:** No-op routes that return empty data.

**Plan:**
1. If skills feature is on the roadmap, add a `// TODO: implement in sprint X` comment and gate behind feature flag.
2. If not on roadmap, delete the routes and remove UI references (`skill-slash-menu.tsx` attachment flows).
3. If keeping stubs, return 501 consistently instead of fake 200s.

---

### 10.5 Extract Shared `listUserRepos`

**Files:** `apps/web/app/(authenticated)/sessions/page.tsx` (45–63), `apps/web/app/api/sessions/repos/route.ts` (8–45)
**Problem:** Duplicate forge repo fetch logic.

**Plan:**
1. Create `packages/platform/src/services/repos.ts` (or `apps/web/lib/repos.ts`):
   ```typescript
   export async function listUserRepos(userId: string): Promise<Repo[]> {
     const connections = await db.select(...)...;
     const repos = await Promise.all(connections.map(async conn => {
       const token = decryptTokenSafe(conn.encryptedAccessToken);
       const provider = createForgeProvider(conn.provider, token);
       return provider.repos.list();
     }));
     return repos.flat();
   }
   ```
2. Call from both the RSC page and the API route.

---

### 10.6 Create Shared `apiHandler` / Route Wrapper

**Problem:** Every route hand-rolls try/catch/Response-check/error-logging.

**Plan:**
1. Create `apps/web/lib/api/route-handler.ts`:
   ```typescript
   type HandlerFn = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<NextResponse>;
   
   export function withForgeAuth(fn: (auth: ForgeAuthContext, req: NextRequest, ctx: any) => Promise<NextResponse>): HandlerFn {
     return async (req, ctx) => {
       try {
         const auth = await requireForgeAuth();
         return await fn(auth, req, ctx);
       } catch (err) {
         if (err instanceof Response) return err;
         console.error("[api]", err);
         return NextResponse.json({ error: "Internal error" }, { status: 500 });
       }
     };
   }
   
   export function parseBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
     const body = await req.json();
     const result = schema.safeParse(body);
     if (!result.success) {
       throw new Response(JSON.stringify({ error: "Validation failed", details: result.error.flatten() }), { status: 400 });
     }
     return result.data;
   }
   ```
2. Standardize response envelope: `{ ok: true, data: T } | { ok: false, error: { code, message } }`.
3. Migrate routes incrementally, starting with the most-touched ones.

---

### 10.7 Add Zod Validation to All Mutation Routes

**Problem:** Only 4 routes use Zod; the rest spread raw `req.json()`.

**Plan:**
1. Create `apps/web/lib/api/schemas/` directory.
2. Define schemas per route group:
   - `sessions.ts`: `CreateSessionSchema`, `SendMessageSchema`, `SteerSchema`, `ApprovePlanSchema`, `ReplySchema`
   - `settings.ts`: `CreateApiKeySchema`, `UpdatePreferencesSchema`
   - `admin.ts`: `CreateInviteSchema`
3. Validate URL params too (`id` as UUID: `z.string().uuid()`).
4. Apply via `parseBody(req, schema)` from the route wrapper.

---

### 10.8 Extract Steering Publish Helper

**Files:** `apps/web/app/api/sessions/[id]/steer/route.ts`, `approve-plan/route.ts`
**Problem:** Same publish pattern duplicated.

**Plan:**
1. Create `apps/web/lib/api/session-events.ts`:
   ```typescript
   export async function publishUserSteerEvent(
     sessionId: string,
     auth: ForgeAuthContext,
     event: { type: string; [key: string]: unknown }
   ) {
     const chat = await db.select(...)...;
     const platform = getPlatform();
     await platform.events.publishSteering(chat.activeRunId, event);
     await platform.events.publish(sessionId, JSON.stringify(event));
   }
   ```
2. Call from both routes.

---

### 10.9 Move Sandbox Cleanup into `sandbox-client.ts`

**File:** `apps/web/app/(authenticated)/sessions/actions.ts` (lines 9–29)
**Problem:** Inline `fetch` to sandbox `/cleanup` duplicates the HTTP pattern in `sandbox-client.ts`.

**Plan:**
1. Add to `sandbox-client.ts`:
   ```typescript
   export async function cleanupSession(sessionId: string): Promise<void> {
     await sandboxRequest(sessionId, "/cleanup", { method: "POST" });
   }
   ```
2. Call `cleanupSession(sessionId)` from the server action.

---

### 10.10 Replace `window.__sessionTabs` with React Context

**Files:** `apps/web/components/layout/session-tabs.tsx` (118–122), `session-workspace.tsx` (110–131), `sessions-home.tsx` (155–163), `use-session-tabs-sync.tsx` (33–43)
**Problem:** Untyped imperative global registry, untestable, race conditions.

**Plan:**
1. Create `components/layout/session-tabs-context.tsx`:
   ```typescript
   interface SessionTabsContextValue {
     tabs: SessionTab[];
     addTab: (tab: SessionTab) => void;
     updateTab: (id: string, updates: Partial<SessionTab>) => void;
     removeTab: (id: string) => void;
     activeTabId: string | null;
     setActiveTabId: (id: string) => void;
   }
   ```
2. Provide from `AppShell` (wraps both sidebar and content).
3. Consume in `SessionWorkspace`, `SessionsHome`, and `SessionTabs`.
4. Remove all `window.__sessionTabs` references.
5. Delete `use-session-tabs-sync.tsx` (its logic moves into the context provider).

---

### 10.11 Split God Components

#### Sidebar (573 lines)
1. Extract `hooks/use-sidebar-sessions.ts` (SWR + invalidation + grouping).
2. Extract `components/layout/session-context-menu.tsx`.
3. Extract `components/layout/rename-session-input.tsx`.
4. Extract `components/layout/delete-session-dialog.tsx`.
5. Keep `sidebar.tsx` as a ~100-line layout shell.

#### FileTree (362 lines)
1. Extract `hooks/use-tree-keyboard-nav.ts`.
2. Extract `lib/tree-filter.ts` (pure `directoryHasMatch` → precomputed Set).
3. Extract `components/session/file-tree-node.tsx` (presentation).

#### SessionsHome (329 lines)
1. Extract `components/session/session-composer.tsx` (create + first message form).
2. Extract `components/session/session-filters.tsx`.
3. Remove the inline ChatPanel branch — after create, navigate to `[id]/page`.

#### DiffViewer (431 lines)
1. Extract `lib/diff/parse-unified-diff.ts` (parser logic).
2. Keep `diff-viewer.tsx` as the render component (~150 lines).

#### SessionWorkspace (303 lines)
1. Extract `hooks/use-session-model.ts` (localStorage model persistence).
2. Use context for file changes (Phase 9.4).
3. Remove tab registration globals (Phase 10.10).

---

### 10.12 Consolidate Dialog Implementations

**Files:** `components/ui/dialog.tsx`, `components/primitives/dialog.tsx`
**Problem:** Two dialog systems.

**Plan:**
1. Audit usage: `primitives/dialog` is dominant (~12 files), `ui/dialog` used by sidebar + preferences-form.
2. Migrate sidebar and preferences-form to `primitives/dialog`.
3. Delete `components/ui/dialog.tsx` (or keep as a thin re-export if shadcn is still needed).
4. Fix `primitives/dialog.tsx` to import `cn` from `@/lib/utils` instead of re-implementing.

---

### 10.13 Unify Session Mutations Through Platform

**File:** `apps/web/app/(authenticated)/sessions/actions.ts` (lines 51–155)
**Problem:** Server actions bypass platform, using raw Drizzle for restore/rename/delete.

**Plan:**
1. Add `platform.sessions.rename(auth, sessionId, title)` if not exists.
2. Add `platform.sessions.restore(auth, sessionId)` if not exists.
3. Call platform methods from server actions instead of direct DB.
4. Keeps the data access pattern consistent with gateway/worker.

---

### 10.14 Single Source of Truth for Ask-User State

**Files:** `chat-reducer.ts` (231–238), `chat-panel.tsx` (107–132)
**Problem:** Two sources: `askUserPrompt` in reducer + `pendingAsk` scanned from parts.

**Plan:**
1. Trust the reducer's `askUserPrompt` as the sole source.
2. Remove the `pendingAsk` scan from `chat-panel.tsx`.
3. Ensure the reducer correctly sets `askUserPrompt` on `ask_user` stream events.
4. Ensure terminal events and `FINISH_STREAMING` clear it.

---

### 10.15 Move `sandbox-client.ts` to Platform Package

**File:** `apps/web/lib/sandbox-client.ts` (359 lines)
**Problem:** Can't be reused by gateway/workers.

**Plan:**
1. Create `packages/platform/src/adapters/sandbox-http.ts`.
2. Move HTTP client logic there with a `SandboxAdapter` interface.
3. `apps/web/lib/sandbox-client.ts` becomes a thin re-export or adapter initialization.
4. Gateway and workers import from platform package.

---

### 10.16 Extract Shared Types

**Problem:** `Message`, `LiveFileChange` types imported from various paths.

**Plan:**
1. Create `apps/web/components/session/types.ts`:
   ```typescript
   export type { Message } from "./chat-reducer";
   export type { LiveFileChange } from "@coding-agents/shared/client";
   export type { StreamEvent } from "@coding-agents/shared/client";
   ```
2. All session components import from this barrel file.

---

### 10.17 Import Session Status Enum from DB

**Files:** `app/api/sessions/route.ts` (7–8), `sidebar.tsx` (61–68), `session-tabs.tsx` (41–53)
**Problem:** Stringly-typed status compared across files.

**Plan:**
1. Export `SessionStatus` enum/union from `@coding-agents/db`:
   ```typescript
   export const SESSION_STATUSES = ["active", "waiting", "completed", "error", "archived"] as const;
   export type SessionStatus = (typeof SESSION_STATUSES)[number];
   ```
2. Import and use across web app.
3. Use `satisfies Record<SessionStatus, string>` for status maps.

---

### 10.18 Move Observability Hook to `hooks/`

**File:** `apps/web/app/(authenticated)/observability/use-events.ts`
**Problem:** Inconsistent location vs `hooks/use-*`.

**Plan:**
1. Move to `apps/web/hooks/use-observability-events.ts`.
2. Update import in `observability/page.tsx`.

---

### 10.19 Fix `apiFetch` Silent JSON Parse Failure

**File:** `apps/web/lib/api-fetch.ts` (lines 37–38)
**Problem:** Non-JSON responses become empty object typed as `T`.

**Plan:**
1. Check Content-Type before parsing:
   ```typescript
   const contentType = res.headers.get("content-type");
   const data = contentType?.includes("application/json")
     ? await res.json().catch(() => null)
     : null;
   return { ok: res.ok, status: res.status, data: data as T | null, parseError: data === null };
   ```
2. Update consumers to handle `null` data.

---

### 10.20 Direct DB Access in API Routes → Platform

**Files:** `app/api/sessions/route.ts` (88–114), `stream/route.ts` (111–125), `steer/route.ts` (29–34), `approve-plan/route.ts` (29–34)
**Problem:** Boundary violation — web routes access DB directly instead of through platform.

**Plan:**
1. For session listing: add `platform.sessions.listGrouped(auth, filter)`.
2. For stream ownership check: use `platform.sessions.verifyOwnership(auth, sessionId)`.
3. For steer/approve-plan: use the extracted helper (Phase 10.8).
4. Migrate incrementally — start with new routes using the pattern.

---

### 10.21 Reducer State Cleanup

**File:** `apps/web/components/session/chat-reducer.ts`
**Problem:** `stepLimitReached` is derivable; `_seqCounter` is an implementation detail.

**Plan:**
1. Remove `stepLimitReached` from state; compute in a selector:
   ```typescript
   export const selectStepLimitReached = (state: ChatState) => state.terminalReason === "step_limit";
   ```
2. Move `_seqCounter` to a module-level variable or ref outside the reducer.

---

### 10.22 Layout State vs Right-Panel Context Overlap

**Files:** `hooks/use-layout-state.ts`, `components/layout/right-panel-context.tsx`
**Problem:** Two layers for "right panel open" can desync.

**Plan:**
1. Context reads initial values from layout state.
2. Context writes back to layout state on changes.
3. Or collapse into one: context IS the source of truth, persists to localStorage on change.

---

### 10.23 Consistent Response Envelope

**Problem:** Different routes return `{ error }`, `{ success }`, `{ ok }`, raw platform data, Zod flattened errors.

**Plan:**
1. Define standard envelope in `lib/api/response.ts`:
   ```typescript
   export function apiSuccess<T>(data: T, status = 200) {
     return NextResponse.json({ ok: true, data }, { status });
   }
   export function apiError(code: string, message: string, status: number, details?: unknown) {
     return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
   }
   ```
2. Migrate routes to use these helpers.
3. Update client `apiFetch` to understand the envelope.

---

### 10.24 Pick One File-Changes UI

**Files:** `message-area.tsx` (97–157), `review-bar.tsx` (25–50)
**Problem:** Same data rendered in two places.

**Plan:**
1. Keep `ReviewBar` (above input) as the primary file-changes surface — it has commit action.
2. Remove the inline collapsible file list from `MessageArea` OR make it a summary that links to ReviewBar.
3. This reduces state subscriptions and component count.

---

### 10.25 Remove Unused `reviewBar.sessionId` Prop

**File:** `apps/web/components/session/review-bar.tsx` (line 33)
**Problem:** Prop is accepted but `void`'d.

**Plan:**
1. Remove `sessionId` from props interface.
2. Update callers to stop passing it.
3. If it's needed for the commit API call later, actually use it instead of voiding.

---

## Phase 11: Low-Severity & Cleanup

### 11.1 Brute-Force Protection on Auth Endpoints

**Problem:** Global 100/min rate limit may be insufficient for credential stuffing.

**Plan:**
1. Add per-email rate limiting (5 attempts/5 min) on the credentials login path.
2. Use `checkRateLimitAsync` with key `auth:${email}`.
3. Implement progressive delay or account lockout after 10 failures.

---

### 11.2 Delete Orphaned `lib/stream-events.ts`

(Covered in 10.2.)

---

### 11.3 In-Memory Rate Limit Not Shared Across Instances

**File:** `apps/web/lib/auth/rate-limit.ts`
**Problem:** Per-process Map in multi-instance deployment gives N × limit.

**Plan:**
1. Accept this limitation for development/single-instance.
2. In production, layer Redis rate limiting (Phase 10.1) on top.
3. Document the limitation in the file.

---

### 11.4 `apiFetch` Always Parses JSON

(Covered in 10.19.)

---

### 11.5 `decryptTokenSafe` Placeholder String

**File:** `packages/shared/lib/encryption.ts`
**Problem:** Returns `"DECRYPTION_FAILED"` which could leak into logs/URLs.

**Plan:**
1. Return empty string or `null` instead.
2. Ensure callers handle the failure case explicitly.
3. Log the failure with context (userId, connectionId) for debugging.

---

### 11.6 Bootstrap Admin Credential Hardening

**File:** `apps/web/lib/auth/bootstrap.ts` (lines 15–19)
**Problem:** Weak `ADMIN_PASSWORD` env var creates persistent admin.

**Plan:**
1. Add minimum password length check (12+ chars).
2. In production, require a one-time setup token instead of env-var bootstrap.
3. Log a warning if bootstrap runs in production.
4. Consider disabling auto-bootstrap entirely in production (`ALLOW_BOOTSTRAP=true` flag).

---

### 11.7 `EventSource` HEAD Probe on Every Error

**File:** `apps/web/hooks/use-event-source.ts` (lines 111–122)
**Problem:** Doubles request count during flaky connections.

**Plan:**
1. Remove the HEAD probe entirely.
2. Schedule reconnect with exponential backoff directly.
3. If 401/403 is detectable from EventSource error (it's not always), handle that case specifically.

---

### 11.8 SSE Unbounded Buffer During History Replay

**File:** `apps/web/app/api/sessions/[id]/stream/route.ts` (lines 145–158)
**Problem:** `pubsubBuffer` grows without cap during slow history reads.

**Plan:**
1. Cap buffer at 1000 events.
2. If cap is reached, drop oldest events and send a `reconnect_hint` to the client.
3. Or start draining concurrently with history reads (interleave).

---

### 11.9 `mobile-sessions-view.tsx` Refetches on Focus

**Problem:** `revalidateOnFocus: true` causes unnecessary network on tab switch.

**Plan:** Set `revalidateOnFocus: false` (consistent with other SWR hooks).

---

### 11.10 File Tree Filter — Precompute Matching Set

**File:** `apps/web/components/session/file-tree.tsx` (lines 46–58)
**Problem:** `directoryHasMatch` recurses the full subtree per node per render.

**Plan:**
1. Precompute once when `filter` changes:
   ```typescript
   const matchingPaths = useMemo(() => {
     const set = new Set<string>();
     function walk(node: TreeNode) {
       if (node.name.includes(filter)) set.add(node.path);
       node.children?.forEach(walk);
     }
     root?.children?.forEach(walk);
     return set;
   }, [root, filter]);
   ```
2. O(1) lookup per node instead of recursive walk.

---

### 11.11 SSE Client Backpressure

**Problem:** Synchronous JSON parse + dispatch per event can backlog the main thread.

**Plan:**
1. Batch incoming events in a microtask queue:
   ```typescript
   const pending: StreamEvent[] = [];
   let scheduled = false;
   function enqueue(event: StreamEvent) {
     pending.push(event);
     if (!scheduled) {
       scheduled = true;
       requestAnimationFrame(() => {
         const batch = pending.splice(0);
         startTransition(() => {
           batch.forEach(e => dispatch(eventToAction(e)));
         });
         scheduled = false;
       });
     }
   }
   ```
2. This naturally batches React updates per frame.

---

### 11.12 Duplicate Session Title Query in `generateMetadata`

**File:** `apps/web/app/(authenticated)/sessions/[id]/page.tsx` (lines 16–26 vs 40–58)
**Problem:** Metadata and page both query sessions by ID.

**Plan:**
1. Use React `cache()` wrapper:
   ```typescript
   const getSessionRow = cache(async (id: string, userId: string) => {
     return db.select(...)...where(and(eq(sessions.id, id), eq(sessions.userId, userId)));
   });
   ```
2. Call from both `generateMetadata` and the page function.

---

### 11.13 Sequential Queries After Initial `Promise.all`

**File:** `apps/web/app/(authenticated)/sessions/[id]/page.tsx` (lines 85–109)
**Problem:** `latestRun` and `messages` run sequentially after the parallel block.

**Plan:**
1. Parallelize:
   ```typescript
   const [latestRun, messages] = chatRow
     ? await Promise.all([fetchLatestRun(chatRow.id), fetchMessages(chatRow.id)])
     : [undefined, []];
   ```

---

### 11.14 Extract `loadSessionPageData` Loader

**File:** `apps/web/lib/db/loaders.ts`
**Problem:** Session page does 4+ inline queries; `loaders.ts` only has `getUserPreferences`.

**Plan:**
1. Add `loadSessionPageData(sessionId: string, userId: string)` that returns `{ session, chat, latestRun, messages, prefs }`.
2. Use React `cache()` for dedup with `generateMetadata`.
3. Keeps page component thin (~30 lines).

---

---

## Implementation Schedule

| Week | Phases | Focus |
|------|--------|-------|
| 1 | 1, 2 | Critical security + critical bugs |
| 2 | 3, 4 | Critical perf + high security |
| 3 | 5, 6 | High bugs + high perf |
| 4 | 7, 8 | Medium security + medium bugs |
| 5 | 9 | Medium performance |
| 6–8 | 10 | Architecture refactors (incremental) |
| Ongoing | 11 | Low-severity cleanup |

---

## Success Criteria

- Zero Critical/High findings remaining after Phase 6
- Lighthouse performance score ≥ 90 on session page
- SSE streaming with 100 historical messages: <16ms per-frame in React profiler
- All mutation routes validated with Zod
- All secrets required in production startup check
- Consistent API response envelope across all routes
- No `window.__sessionTabs` references
- `sandbox-client.ts` path injection test passes
- OAuth state tampering test returns error
- Session with 500+ messages loads <500ms TTFB
