# Quickstart: Agent Chat Interface Updates

## Prerequisites

- Bun ≥ 1.0, `bun install`
- `bun run infra:up` + `bun run db:push`
- `bun run dev` (web + sandbox reachable)
- `SANDBOX_URL` / `SANDBOX_SHARED_SECRET` configured
- Session linked to a repository with uncommitted agent changes

## Key Files

### Commit (fix stub)

- `apps/web/app/api/sessions/[id]/git/commit/route.ts` — Wire to sandbox; read `autoCommitPush`
- `apps/web/lib/sandbox-client.ts` — Add `commitSessionChanges()`
- `apps/web/components/session/session-workspace.tsx` — Error handling / push-aware toasts

### Slash skills

- `apps/web/components/session/chat-input.tsx` — Picker + chip
- `apps/web/components/session/use-agent-chat.ts` — Pass `turnSkillRefs` on send
- `packages/platform/src/services/session.ts` — Merge `turnSkillRefs` in `sendMessage`

### Tool call width

- `apps/web/components/tool-call/tool-layout.tsx` — Collapsed ~50%, expanded full width

### Remove git tab

- `apps/web/components/session/session-workspace.tsx` — Drop git tab; review → files/changes
- `apps/web/components/session/files-view.tsx` — `initialSubView` prop
- `apps/web/components/layout/mobile-bottom-nav.tsx` — Remove git item
- `apps/web/components/layout/app-shell.tsx` — MobileShell git routing removal
- `apps/web/components/layout/right-panel.tsx` — Remove git mode (if still referenced)

## Manual Test Checklist

1. **Commit**: Agent modifies a file → Review bar → Create Branch & Commit → real SHA in network response; changes clear.
2. **Commit during run**: Start agent → commit mid-stream → succeeds; further edits show as new changes.
3. **Push pref off**: Settings → disable auto commit & push → commit → toast does not claim push.
4. **Push pref on**: Enable → commit → push attempted; handle failure message if remote rejects.
5. **Slash skill**: Type `/` → pick skill → chip visible → send → chip clears; run includes skill (verify job/logs).
6. **Tool width**: Collapsed tools ~half column; expand → full column, scrollable body.
7. **No git tab**: Desktop + mobile — no Git nav; Review opens Files → Changes.
8. **Regression**: Explorer still opens files; diffs render in Changes sub-view.

## Environment

| Variable | Purpose |
|----------|---------|
| SANDBOX_URL | Sandbox git/exec proxy |
| SANDBOX_SHARED_SECRET | Auth to sandbox |
