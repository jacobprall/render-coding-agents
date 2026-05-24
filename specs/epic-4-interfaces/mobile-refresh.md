# Mobile Experience Refresh

## Context

The web UI is a Next.js 15 / React 19 app styled with Tailwind v4 and shadcn/Radix primitives. A dedicated `MobileShell` already swaps in at `<768px` with a bottom nav and view state machine (`sessions | chat | files | git`). `MobileHeader` exists but is unused. Most pages inside the shell still assume desktop layout — responsive Tailwind usage is sparse outside the shell swap.

**Goal**: Make the mobile experience feel deliberate and native-quality — not just "responsive enough."

---

## 1. Industry Landscape: How Peers Handle Mobile

Understanding what developers already use on mobile sets the bar.

| Platform | Mobile Strategy | Key Patterns |
|----------|----------------|--------------|
| **Cursor** (cloud agents) | PWA — install `cursor.com/agents` to home screen for native feel | Agent list → chat stream → merge PR, all from phone |
| **GitHub Mobile** | Native iOS/Android app + `/remote on` for Copilot sessions | Remote-control agents from mobile, follow-up messages, approve/deny, review PRs, merge — full lifecycle without a laptop |
| **Vercel** | Web dashboard + floating bottom bar for one-handed use | Resizable sidebar collapses on mobile; third-party native apps (Rev, Vero) fill the gap |
| **Railway** | Native iOS app (TestFlight) with built-in AI agent | Create projects via agent chat, view metrics/logs, receive notifications at project/service level |
| **Devin** | Async delegation via Slack/Jira | Fire-and-forget model — assign task, check back for PR. Mobile interaction is through Slack, not a custom UI |

**Takeaway**: The bar is rising fast. GitHub ships remote agent control on mobile. Railway built a native app with agent chat. Cursor uses a PWA. "Responsive" is no longer sufficient — mobile must be a first-class surface for monitoring, steering, and acting on agents.

---

## 2. Core Mobile UX Principles

### 2.1 Progressive Disclosure (3 Layers)

Mobile screens can't show everything at once. Organize information in layers:

- **Layer 1 — Glance**: 5–7 KPIs visible without scrolling. Active sessions count, running/queued/failed badges, last activity timestamp.
- **Layer 2 — Detail**: Tap to expand. Session chat stream, file diffs, log tail. Bottom sheets or full-screen transitions, not inline expansion.
- **Layer 3 — Configuration**: Settings, automation config, API key management. Reachable but never in the way.

This respects working memory limits (4–7 chunks) and matches how mobile users actually consume dashboards: scan first, dig in only when something stands out.

### 2.2 Task-Driven Layout

Organize the mobile experience around what developers actually do on their phone:

1. **Monitor** — "Are my agents healthy? Did anything fail?"
2. **Triage** — "This one needs attention. Let me read the output."
3. **Act** — "Send a follow-up message. Approve this PR. Cancel that run."

Each task should be completable in 1–3 taps from the home screen. Avoid "information buffet" layouts that require hunting.

### 2.3 Minimize Chrome, Maximize Content

- Hide non-essential UI until needed. On mobile, the content (chat stream, logs, code) is the interface.
- Persistent global state (auth, org, notification count) should live in compact tokens, not full menus.
- Use the status bar and bottom nav for persistent navigation — everything else should be content.

---

## 3. Key Areas to Strengthen

### 3.1 Session List (Home Screen)

**Current**: Flat session list/cards, no mobile-specific optimization inside `MobileSessionsView`.

**Target**:
- Card-based list with status badges (running, completed, failed, queued) using color-coded indicators
- Pull-to-refresh with haptic feedback
- Swipe actions: swipe-left to cancel, swipe-right to open
- Sticky filter bar (status, repo, date) that collapses on scroll
- Empty states with clear CTAs ("Start your first agent")
- Inline "time ago" timestamps, not absolute dates
- Skeleton loading states that match card dimensions

### 3.2 Chat / Agent Interaction View

**Current**: Chat UI exists but `chat-input.tsx` hides the attach menu on mobile and shows icon-only Send/Stop buttons.

**Target**:
- Full-width message bubbles with assistant/user differentiation
- Streaming output with auto-scroll and a "scroll to bottom" FAB when the user scrolls up
- Quick-action chips above the input: "Cancel", "Send follow-up", "View PR"
- Expandable tool-call/code blocks — collapsed by default with a "Show N files changed" summary
- Image/screenshot attachments viewable with pinch-to-zoom
- Long-press on messages for copy/share actions
- Keyboard-aware input that stays above the soft keyboard with safe-area-inset-bottom padding

### 3.3 Code & Diff Viewing

**Current**: No mobile-specific code viewing optimization.

**Target**:
- Horizontal scroll for code blocks (not wrapping — preserve readability)
- Syntax highlighting with a monospace font sized for readability (13–14px minimum)
- Diff view: unified diff only on mobile (no side-by-side — not enough width)
- Virtualized rendering for large diffs (TanStack Virtual — GitHub saw 10x heap reduction and INP drop from 275–700ms to 40–80ms with this approach)
- File-level accordion: show changed files list, tap to expand individual diffs
- Pinch-to-zoom on code blocks for fine reading

### 3.4 Log & Terminal Output

**Current**: No touch-optimized log viewing.

**Target**:
- Native scrollable log viewer (avoid fighting xterm.js scrollback on mobile — use a structured overlay instead)
- `-webkit-overflow-scrolling: touch` and `touch-action: pan-y` for smooth momentum scrolling
- Auto-scroll toggle: streaming logs should follow tail by default, pause when user scrolls up
- Search within logs (sticky search bar, highlight matches)
- Monospace font at 12–13px with `pre-wrap` and `word-break: break-word`
- Level-based coloring (error=red, warn=yellow, info=default) for quick scanning
- Tap-to-expand for long log entries

### 3.5 Notifications & Async Status

Agents are long-running async tasks. Mobile users need to stay informed without keeping the app open.

**In-app status**:
- Badge counts on bottom nav tabs (sessions tab shows running count)
- Session cards show real-time status with step progress ("Installing dependencies", "Running tests", "Creating PR")
- Restore latest status when user returns — never show stale info or restart from scratch
- Toast notifications for state transitions (started → running → completed/failed)

**Push notifications** (PWA):
- Agent completed / failed / needs approval
- Permission prompt timed after the user sees value (not on first visit)
- Notification click deep-links to the relevant session
- Frequency controls — don't over-notify; batch non-urgent updates
- Fallback chain: push → email → in-app badge

**Limitations to design around**:
- iOS PWA push only works when installed to home screen (not in Safari tabs)
- Permission grant rates are 10–20% across platforms — don't rely on push as the only channel
- Silent push on iOS is throttled to 2–3/hour and may be delayed

### 3.6 One-Handed Use & Thumb Zone

Most mobile interactions happen with one thumb. Design for the natural thumb arc:

```
┌─────────────────────┐
│                     │  ← Hard to reach
│                     │
│   ┌─────────────┐   │
│   │  Comfortable │   │  ← Primary actions here
│   │    Zone      │   │
│   └─────────────┘   │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  ← Bottom nav / action bar
└─────────────────────┘
```

- Primary actions (new session, send message, filter) anchored to bottom half of screen
- Floating action buttons (FAB) in the bottom-right thumb zone
- Pull-down actions from the top (refresh, filter) — don't require tapping top corners
- Bottom sheets for detail views instead of full-page navigations (maintain context)
- Vercel's pattern: floating bottom bar for the most common actions

---

## 4. PWA vs Native App

**Recommendation**: PWA-first, evaluate native wrapper later.

| Factor | PWA | Native |
|--------|-----|--------|
| **Development cost** | Uses existing Next.js codebase | Separate iOS/Android codebase or React Native |
| **Iteration speed** | Deploy instantly, no app store review | 1–7 day review cycles |
| **Push notifications** | Supported (iOS requires home screen install) | Full control, reliable delivery |
| **Offline support** | Service Worker caching | Full native offline |
| **App store discovery** | Not available (direct URL/link) | Available |
| **OS integration** | Limited (no background fetch, limited haptics) | Full access |
| **Our audience** | Developers — comfortable with URLs, not app-store-first | — |

**For v1**: Invest in PWA quality. Add a web app manifest, service worker for offline shell caching, and prompt users to install. This matches Cursor's approach and avoids the overhead of native development.

**For v2** (if needed): Consider a thin native wrapper (Capacitor/Expo) for better push reliability and app store presence. Railway's TestFlight approach is a good model.

### PWA Implementation Checklist

- [ ] Web app manifest with icons, theme color, display: standalone
- [ ] Service worker: cache app shell, fonts, and critical assets
- [ ] Offline fallback page ("You're offline — last synced 5 min ago")
- [ ] Install prompt: show custom banner after 2+ sessions
- [ ] Push notification setup with VAPID keys
- [ ] `viewport-fit: cover` (already done) + safe area CSS variables (partially done)

---

## 5. Accessibility & Interaction Standards

### Touch Targets

- All interactive elements: **minimum 44x44 CSS pixels** (WCAG 2.5.5 enhanced)
- Preferred size: **48x48px** with **8px minimum spacing** between adjacent targets
- Bottom nav icons should be at least 48px tap targets
- Inline text links are exempt, but icon buttons are not

### Gestures

- All functionality must be operable with **single-pointer, non-path-based gestures** (WCAG 2.5.1)
- Swipe gestures should have tap-based alternatives (swipe-to-cancel also has a cancel button)
- No pinch/multi-touch required for core functionality
- Support both left-to-right and right-to-left swipe directions

### Visual

- Dark mode as default for developer audience (already supported via `next-themes`)
- Minimum text contrast ratio: 4.5:1 (WCAG AA)
- Respect `prefers-reduced-motion` — disable animations/transitions for users who set this
- Monospace font minimum 12px for code, 14px for body text
- Clear focus indicators for keyboard/switch-control users

### Safe Areas

- Bottom nav already accounts for `safe-area-inset-bottom` — extend this to all fixed/sticky elements
- Notch/Dynamic Island: ensure no content is clipped behind `safe-area-inset-top`
- Landscape orientation: account for `safe-area-inset-left/right` on devices with notches

---

## 6. Technical Considerations

### Performance

- **Virtualize all lists**: Session list, log viewer, diff lines. Use TanStack Virtual.
- **Lazy-load routes**: Only load chat/files/git views when the user navigates to them
- **Image optimization**: Next.js `<Image>` with responsive `sizes` for avatars, screenshots
- **Bundle splitting**: Mobile users are often on cellular — minimize initial JS payload
- **SWR/stale-while-revalidate**: Show cached data immediately, refresh in background

### Responsive Strategy

The current JS-driven shell swap at 768px is sound. Augment it with:

- More Tailwind responsive utilities inside page content (currently sparse — most pages assume desktop layout within the shell)
- Tablet breakpoint (768–1024px): Consider a simplified desktop layout rather than full mobile
- Test on actual devices, not just Chrome DevTools — touch behavior, scroll physics, keyboard interactions differ significantly

### State Management

- Persist mobile view state (`sessions | chat | files | git`) across navigations
- Restore scroll positions when returning to a view
- Session chat auto-scroll state should survive tab switches
- Use `sessionStorage` for ephemeral mobile state, `localStorage` for preferences

---

## 7. Priority Breakdown

| Priority | Area | Impact | Effort |
|----------|------|--------|--------|
| **P0** | Session list cards with status badges + pull-to-refresh | High | Low |
| **P0** | Chat view: streaming, auto-scroll, keyboard-aware input | High | Medium |
| **P0** | Touch target audit (44px minimum) | High | Low |
| **P1** | Push notifications (PWA) for agent completion/failure | High | Medium |
| **P1** | Bottom sheet pattern for detail views | Medium | Medium |
| **P1** | Log viewer: native scroll, auto-tail, search | Medium | Medium |
| **P1** | Diff viewing: unified, virtualized, file accordion | Medium | High |
| **P2** | PWA manifest + service worker + install prompt | Medium | Low |
| **P2** | Swipe gestures on session cards | Low | Low |
| **P2** | Activate `MobileHeader` with back nav + streaming status | Low | Low |
| **P3** | Offline shell caching | Low | Medium |
| **P3** | Native wrapper evaluation (Capacitor/Expo) | Low | High |

---

## 8. Reference Implementations

- **Cursor cloud agents PWA**: `cursor.com/agents` — install to home screen for native feel
- **GitHub Mobile**: Remote control for Copilot sessions, PR review, merge from phone
- **Railway iOS app**: Agent-powered project creation, metrics, logs, notifications
- **Mobitty**: Open-source touch-first web terminal for AI agents (soft keys, gestures, adaptive rendering, PWA)
- **Vercel dashboard**: Floating bottom bar for one-handed use, resizable sidebar collapse

---

## Gap Summary (Updated)

| Requirement | Current State | Gap Severity |
|-------------|---------------|--------------|
| **Session list mobile UX** | `MobileSessionsView` exists, basic card layout | **MEDIUM** |
| **Chat view mobile polish** | Functional but hides features on mobile, no auto-scroll FAB | **MEDIUM** |
| **Code/diff viewing** | No mobile optimization, no virtualization | **HIGH** |
| **Log/terminal viewing** | No touch-optimized log viewer | **HIGH** |
| **Push notifications** | Not implemented — no service worker, no VAPID | **HIGH** |
| **PWA install experience** | Viewport meta set, no manifest/service worker | **MEDIUM** |
| **Touch target compliance** | Not audited — likely failing 44px minimum in many places | **MEDIUM** |
| **One-handed use patterns** | Bottom nav exists, but actions not anchored to thumb zone | **MEDIUM** |
| **Offline support** | None | **LOW** |
