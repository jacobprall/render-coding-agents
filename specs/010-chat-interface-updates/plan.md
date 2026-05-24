# Implementation Plan: Agent Chat Interface Updates

**Branch**: `main` (feature dir `010-chat-interface-updates`) | **Date**: 2026-05-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-chat-interface-updates/spec.md`

## Summary

Four UX fixes on the session workspace: (1) wire real git commit (and optional push via `autoCommitPush`) replacing the stub API; (2) slash-command skill picker in chat with one-shot `turnSkillRefs` per message; (3) narrow collapsed tool-call blocks (~50% width), full column when expanded; (4) remove redundant Git tab on desktop and mobile, routing review/diffs through Files → Changes.

## Technical Context

**Language/Version**: TypeScript 5.x, Bun runtime

**Primary Dependencies**: Next.js 15 (App Router), React 19, Tailwind CSS 4, existing `sandbox-client`, `packages/platform` session service, Drizzle ORM

**Storage**: PostgreSQL (`sessions.activeSkills`, `user_preferences.auto_commit_push`); git state in session sandbox workspace

**Testing**: Vitest for `sandbox-client` commit helper and message skill merge; manual/E2E for UI flows per [quickstart.md](./quickstart.md)

**Target Platform**: Web (desktop session tabs + mobile bottom nav)

**Project Type**: Monorepo web app (`apps/web` + `packages/platform`)

**Performance Goals**: Commit API < 5s p95; slash picker opens < 100ms after `/`; no extra layout thrash on tool expand

**Constraints**: Sandbox-only git (Constitution VI); no new tables; collapsed tool max-height `max-h-128`

**Scale/Scope**: ~15–20 files touched across web UI, one API route, platform `sendMessage`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | PASS | Reuses sandbox git proxy; no new services |
| II. Observability | PASS | Commit route logs stderr; structured errors to client |
| III. Modularity | PASS | Platform change limited to `SendMessageParams`; web-only UI |
| IV. API-First | PASS | Documented API/UI contracts; message + commit endpoints |
| V. Reliability | PASS | Distinct commit vs push failure; no false-success SHA |
| VI. Security | PASS | `requireForgeAuth` + `requireSessionForUser` on routes |
| VII. Testing | PASS | Unit tests for commit helper + skill merge; manual checklist |
| VIII. OSS-Friendly | PASS | No proprietary deps |
| IX. Performance | PASS | Lazy skill list fetch on `/` only; git status refresh post-commit |

*Post-design re-check: PASS — no violations requiring Complexity Tracking.*

## Project Structure

### Documentation (this feature)

```text
specs/010-chat-interface-updates/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md
│   └── ui.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
apps/web/
├── app/api/sessions/[id]/
│   ├── git/commit/route.ts       # Implement real commit + push gate
│   └── message/route.ts          # Accept turnSkillRefs (passthrough)
├── components/
│   ├── session/
│   │   ├── chat-input.tsx        # Slash picker + skill chip
│   │   ├── use-agent-chat.ts     # turnSkillRefs on send
│   │   ├── session-workspace.tsx # Remove git tab; review routing
│   │   └── files-view.tsx        # initialSubView prop
│   ├── tool-call/
│   │   └── tool-layout.tsx       # Width states
│   └── layout/
│       ├── mobile-bottom-nav.tsx # Drop git item
│       └── app-shell.tsx         # MobileShell git removal
├── lib/
│   └── sandbox-client.ts         # commitSessionChanges()
└── hooks/
    └── use-git-status.ts         # Refresh after commit (existing notify)

packages/platform/src/services/
└── session.ts                    # SendMessageParams.turnSkillRefs merge

packages/db/schema/
└── platform.ts                   # user_preferences.autoCommitPush (existing)
```

**Structure Decision**: All implementation in existing `apps/web` and `packages/platform` boundaries. No new packages.

## Implementation Phases

### Phase A — Fix commit (P1, US1)

1. Add `commitSessionChanges(sessionId, opts)` to `sandbox-client.ts`:
   - Stage: `git add -A`
   - Optional: `git checkout -b <branch>` when `createBranch`
   - `git commit -m <message>`
   - Parse SHA from `git rev-parse HEAD` on success
   - If `autoCommitPush`: `git push`; capture push error separately
2. Load `autoCommitPush` from `user_preferences` in commit route.
3. Replace stub in `git/commit/route.ts` with sandbox calls; map stderr to 400/502 responses.
4. Update `session-workspace.tsx` toast copy for pushed / push-failed / local-only.
5. Unit test: mock `sandboxGit` sequence; assert no success on non-zero exit.

### Phase B — Slash skills (P1, US2)

1. Extend `SendMessageParams` with optional `turnSkillRefs?: ActiveSkillRef[]`.
2. In `sendMessage`, merge: `[...sessionActive, ...turnSkillRefs]` deduped by `source:slug`.
3. `chat-input.tsx`: detect `/`, fetch skills (SWR or cached from session props), render picker.
4. `use-agent-chat.ts`: accept optional `turnSkillRefs` param on `sendMessage`; pass in POST body.
5. `chat-panel.tsx`: thread `activeSkills` or fetch for picker source.
6. Keyboard a11y per [contracts/ui.md](./contracts/ui.md).

### Phase C — Tool call width (P2, US3)

1. `tool-layout.tsx`: outer `className` — `max-w-[50%] w-full` when collapsed, `max-w-full` when open.
2. Ensure parent in `assistant-parts.tsx` uses `items-start` so chips align left.
3. Visual check at default chat panel width (SC-004).

### Phase D — Unified files / remove git (P2, US4)

1. `session-workspace.tsx`: `ViewTab = "chat" | "files"`; remove Git tab and `GitPanel`.
2. `handleReviewClick` → `setActiveView("files")` + `setInitialFilesSubView("changes")`.
3. `files-view.tsx`: add `initialSubView` prop; respect on mount.
4. `mobile-bottom-nav.tsx`: remove `git` from `MobileView` and nav items.
5. `app-shell.tsx` `MobileShell`: remove `git` branch; files-only right panel.
6. `right-panel.tsx`: remove git mode toggle (or map consumers to files-only).
7. Grep for `activeView === "git"` / `setRightPanelModeContext("git")` and clean up.

### Phase E — Verification

- Run quickstart manual checklist
- `bun run typecheck` in `apps/web` and `packages/platform`
- Optional Playwright: commit button returns non-stub SHA

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Generated Artifacts

| Artifact | Path |
|----------|------|
| Research | [research.md](./research.md) |
| Data model | [data-model.md](./data-model.md) |
| API contracts | [contracts/api.md](./contracts/api.md) |
| UI contracts | [contracts/ui.md](./contracts/ui.md) |
| Quickstart | [quickstart.md](./quickstart.md) |

**Next command**: `/speckit-tasks` to generate `tasks.md`.
