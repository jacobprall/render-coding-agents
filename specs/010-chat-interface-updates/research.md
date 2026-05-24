# Research: Agent Chat Interface Updates

## Decision 1: Real Git Commit via Existing Sandbox Git Proxy

**Decision**: Implement commit in `apps/web/lib/sandbox-client.ts` using the existing `sandboxGit(sessionId, args)` POST `/git` proxy (same pattern as `getGitStatus` / `getFileDiff`), then wire `POST /api/sessions/[id]/git/commit`.

**Rationale**: `git/status` and `git/diff` routes already use `sandbox-client`; only `git/commit/route.ts` is a stub returning `commitSha: "0000000"`. No new sandbox HTTP surface is required—`git-policy.ts` already allows `commit` and `push` argv.

**Alternatives considered**:
- Dedicated sandbox `POST /git/commit` handler → Rejected: duplicates `git-http.ts` generic proxy; YAGNI
- Platform-layer commit via Forge API → Rejected: commits must land in session workspace sandbox, not remote mirror only

## Decision 2: Push Gated by User Preference

**Decision**: After successful local commit, call `git push` only when `user_preferences.auto_commit_push` is true for the authenticated user. Surface distinct errors if commit succeeds but push fails.

**Rationale**: Clarification session 2026-05-24 option C; field already exists in schema and settings UI.

**Alternatives considered**:
- Always push → Rejected: contradicts clarified behavior and user setting
- Per-commit checkbox → Rejected: out of scope per spec assumptions

## Decision 3: One-Shot Slash Skills via `turnSkillRefs` on Message Send

**Decision**: Extend `POST /api/sessions/[id]/message` body with optional `turnSkillRefs: ActiveSkillRef[]`. Platform `sendMessage` merges them into `activeSkillRefs` for the enqueued job only (dedupe by `source+slug`); does not persist to `sessions.activeSkills`.

**Rationale**: Session skills are stored on the session row; slash attachment must affect a single turn without sticky state. Merging preserves session-configured skills while adding the slash-selected skill for that run.

**Alternatives considered**:
- PATCH session skills before send → Rejected: violates one-shot semantics; racey with concurrent tabs
- Embed skill slug only in message text → Rejected: agent may ignore; not testable against FR-007

## Decision 4: Slash Picker UX in Chat Input

**Decision**: Client-side picker triggered on `/` in `chat-input.tsx` (or small `skill-slash-menu.tsx`), listing `GET /api/sessions/[id]/skills` with filter-as-you-type; selected skill shown as removable chip; send passes `turnSkillRefs` and clears chip.

**Rationale**: Skills API exists; chat input is the natural surface. Keyboard navigation (↑/↓, Enter, Esc) satisfies FR-013.

**Alternatives considered**:
- Global command palette → Rejected: extra scope; slash in composer is industry standard
- Update session skills on pick → Rejected: conflicts with one-shot clarification

## Decision 5: Tool Call Width — Collapsed 50%, Expanded 100%

**Decision**: In `tool-layout.tsx`, apply `w-[min(100%,50%)]` (or `max-w-[50%]`) on the outer container when collapsed; when `open`, use `w-full` within the message column. Keep `max-h-128` scroll on detail body.

**Rationale**: Clarified behavior: width fix only when collapsed; expanded uses full message column for readable output.

**Alternatives considered**:
- CSS container queries on message list → Deferred: parent-based max-width is sufficient
- Fixed pixel width → Rejected: not responsive across panel sizes

## Decision 6: Remove Git Tab — Route Review to Files → Changes

**Decision**: Remove `git` from `ViewTab` in `session-workspace.tsx`, delete lazy `GitPanel` tab, change `handleReviewClick` to open `files` with `initialSubView: "changes"`. Mirror in `mobile-bottom-nav.tsx` and `app-shell.tsx` `MobileShell` (drop `git` view; files-only for repo browsing).

**Rationale**: `FilesView` already has Explorer + Changes sub-tabs with diffs; `GitPanel` duplicates change list. FR-011 and mobile clarification require consistent removal.

**Alternatives considered**:
- Keep git panel as hidden route → Rejected: violates FR-011
- Rename tab to "Changes" only → Rejected: user chose remove Git tab entirely (option A)

## Decision 7: Commit During Active Agent Run

**Decision**: No UI block when `activeRunId` is set; commit uses live `liveFileChanges` / sandbox `git status` snapshot at click time.

**Rationale**: Clarification option A; aligns with FR-004a.

## Decision 8: Expanded Tool Max Height

**Decision**: Retain `max-h-128` (~32rem) on expanded tool body; defer configurable height to planning tasks if usability testing fails.

**Rationale**: Constitution I (simplicity); prevents viewport takeover vertically while meeting FR-009.
