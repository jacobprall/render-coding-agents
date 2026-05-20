# Mobile Optimization Audit

> Audit date: May 20, 2026

## Executive Summary

The authenticated app is built around a **desktop shell** (`h-screen`, fixed side rail, horizontal session tabs, multi-column file/diff views). Tailwind responsive utilities are barely used outside settings and a few isolated spots. The core session experience — chat, files, session list, global nav — is difficult or broken on phones without a mobile header, bottom nav, or stacked layouts.

**Settings** is the only section with a deliberate mobile-first navigation pattern. The rest of the app needs significant work to be usable on mobile.

---

## What's Already Done Well

| Area | Details |
|------|---------|
| Settings navigation | Horizontal scroll tabs on small screens, sidebar grid from `md:` breakpoint |
| Sessions drawer pattern | Overlay + `max-w-[85vw]` on mobile, inline panel on `md:` (exists but not wired up) |
| Dropdown width caps | `ModelSelector` and `RepoBranchPicker` use `max-w-[calc(100vw-2rem)]` |
| Text truncation | `min-w-0` used widely on list rows, breadcrumbs, tool headers, session cards |
| Markdown tables | `overflow-x-auto` with responsive cell padding at `sm:` |
| Form grids | API keys / access tokens use `sm:grid-cols-2` |
| Sessions home controls | Repo + model row stacks on small screens |
| Auth flows | Centered `max-w-sm` / `max-w-xs` layouts work well on mobile |

---

## High Priority Issues

### 1. No Mobile Global Navigation

**Files:** `components/layout/app-shell.tsx`, `components/layout/icon-rail.tsx`

The `IconRail` is hidden below `md:` with no mobile replacement:

```tsx
<div className="hidden md:flex">
  <IconRail user={user} onSessionsClick={toggleDrawer} />
</div>
```

Users on mobile lose access to:
- Sessions drawer trigger (only bound to IconRail)
- Theme toggle, sign out, settings avatar
- Session search (only via Cmd+K — not discoverable on touch)

**Recommendation:** Add a mobile app bar (top) or bottom nav with session menu, new session, and settings links.

---

### 2. Session Drawer Positioned for Desktop Rail

**File:** `components/layout/session-drawer.tsx` (line 143)

```tsx
className="fixed left-12 top-0 z-40 flex h-screen w-72 flex-col ..."
```

`left-12` assumes the 48px `IconRail` is present. On mobile the rail is hidden, so the drawer should be `left-0` or render as a full-width overlay.

**Recommendation:** Use `left-0 md:left-12` or switch to a full-screen sheet pattern on mobile.

---

### 3. Files View: Fixed 256px Sidebar

**File:** `components/session/files-view.tsx` (lines 43–44)

```tsx
<div className="flex h-full">
  <div className="w-64 shrink-0 border-r ...">
```

On a ~375px device, the file tree consumes ~68% of the width, leaving the diff pane cramped and unusable.

**Recommendation:** Stack file tree above diff content on mobile, or use a collapsible drawer/sheet pattern for the file list.

---

### 4. Session Tabs: Hover-Only Close, Small Targets

**File:** `components/layout/session-tabs.tsx`

| Issue | Details |
|-------|---------|
| Tab bar height | `h-9` / tabs `h-8` — too small for touch |
| Close button | `h-4 w-4`, hidden until `group-hover` — unusable on touch |
| New session button | `w-8 h-8` — below 44px minimum |
| No mobile alternative | `overflow-x-auto` only, no tab menu or swipe |

**Recommendation:** On mobile, replace tabs with a dropdown/sheet selector. Make close buttons always visible or use swipe-to-dismiss.

---

### 5. Archive/Delete Actions Hidden Behind Hover

**Files:**
- `sessions/session-card.tsx` (lines 87–88): `opacity-0 group-hover:opacity-100`
- `components/layout/session-drawer.tsx` (lines 226–236): `hidden … group-hover:inline-flex`

Touch users cannot discover these actions without accidental long-press or hover emulation.

**Recommendation:** Show actions always, use swipe-to-reveal, or add a "..." overflow menu visible on touch.

---

### 6. `h-screen` Causes Clipping on Mobile Safari

**Files:** `app-shell.tsx`, `session-drawer.tsx`, `icon-rail.tsx`

`h-screen` on iOS Safari doesn't account for the dynamic URL bar, causing content to be clipped behind browser chrome.

**Recommendation:** Use `min-h-dvh` or `h-[100dvh]` and add `viewport-fit=cover` to the root layout with appropriate safe-area padding.

---

### 7. Horizontal Layouts That Don't Wrap

**Files:**
- `sessions-home.tsx` (lines 287–297): GitHub warning banner + CTA button
- `pr-summary-panel.tsx` (lines 87–124): PR action buttons cluster
- `github-connection.tsx` (lines 63–109): Connect/disconnect button row
- `settings/connections/page.tsx` (lines 71–109): Same pattern

These use `flex items-center justify-between` without wrapping — long text + buttons squeeze or overflow on narrow screens.

**Recommendation:** Add `flex-wrap` or switch to `flex-col gap-3 sm:flex-row` patterns.

---

## Medium Priority Issues

### 8. Touch Targets Below 44px Minimum

| Component | Size | File |
|-----------|------|------|
| Button `sm` variant | `h-7` (28px) | `primitives/button.tsx` |
| Button default | `h-9` (36px) | `primitives/button.tsx` |
| Select `sm` | `min-h-[30px]` | `primitives/select.tsx` |
| Input default | `h-9` (36px) | `primitives/input.tsx` |
| Drawer plus/close icons | `h-6 w-6` (24px) | `session-drawer.tsx` |
| Sessions drawer close | `p-1` only (~16px) | `sessions-drawer.tsx` |
| Dialog close | `p-1` + `h-4 w-4` icon | `primitives/dialog.tsx` |
| Token copy button | `p-2` + 16px icon | `access-tokens-manager.tsx` |
| Chat/Files tabs | `py-2 text-xs` (~32px) | `session-workspace.tsx` |
| Send/Start button | `py-1.5` (~30px) | `chat-input.tsx`, `sessions-home.tsx` |

**Recommendation:** Enforce `min-h-11` (44px) on all interactive elements on mobile. Use padding to expand hit areas without changing visual size.

---

### 9. Tool Call Cards: 33% Max Width When Collapsed

**File:** `components/tool-call/tool-layout.tsx` (line 45)

```tsx
open ? "flex flex-col w-full min-w-0" : "inline-flex flex-col max-w-[33%] min-w-0 self-start"
```

On mobile, 33% of ~375px = ~125px — too narrow for tool names. Should be full-width on mobile.

**Recommendation:** Use `max-w-full md:max-w-[33%]` for collapsed state.

---

### 10. Dense Session Metadata Bar

**File:** `components/session/session-workspace.tsx` (lines 164–198)

`text-[11px]` monospace with multiple inline chips (repo, status, PR, +/- lines) + model selector in one `flex-wrap` row. Crowded and hard to read on phones.

**Recommendation:** Stack metadata into two rows on mobile, or collapse into a expandable summary chip.

---

### 11. Dialog Missing Mobile Margins

**File:** `primitives/dialog.tsx` (lines 43–51)

`w-full max-w-lg` with `p-6` but no horizontal margin or max-height constraint — can go edge-to-edge on small devices and tall content can clip.

**Recommendation:** Add `mx-4` (or `max-w-[calc(100vw-2rem)]`) and `max-h-[90vh] overflow-y-auto`.

---

### 12. Team Invite Form Doesn't Stack

**File:** `settings/team/page.tsx` (lines 94–109)

Email input + button side-by-side with no responsive stacking — button shrinks or causes horizontal scroll on phones.

**Recommendation:** Use `flex-col gap-3 sm:flex-row`.

---

### 13. Landing Page Hero Typography

**File:** `app/page.tsx` (line 149)

`text-6xl` with `sm:text-6xl` — no mobile reduction. Hero title dominates or overflows on narrow screens.

**Recommendation:** Use `text-3xl sm:text-5xl md:text-6xl`.

---

### 14. Fixed `px-6` Horizontal Padding

**Files:** `settings/layout.tsx`, `primitives/page-shell.tsx`, loading skeletons

Fixed `px-6` wastes 48px of precious horizontal space on 320px devices (15% of width).

**Recommendation:** Use `px-4 md:px-6` throughout.

---

### 15. Diff Tables: Tiny Text, No Mobile Mode

**File:** `components/diff-viewer.tsx` (lines 327–404)

`text-[11px]` with fixed `w-10` line-number columns. Horizontal scroll works but reading/panning is painful on phones.

**Recommendation:** Hide line numbers on mobile, bump to `text-xs`, or offer a unified-diff-only view on small screens.

---

## Low Priority Issues

| Issue | File | Notes |
|-------|------|-------|
| `SessionsDrawer` built but unused | `sessions-drawer.tsx` | Good mobile overlay pattern exists — wire it up |
| Breadcrumbs component unused | `components/layout/breadcrumbs.tsx` | Could help mobile navigation hierarchy |
| Invite accept page padding | `invite/accept/page.tsx` | Add `px-4` to container |
| 404/error pages `text-6xl` | `not-found.tsx`, `error.tsx` | Minor typographic overflow |
| No `prefers-reduced-motion` | Global | Animations on route progress/loaders |
| Message bubbles | `message-bubble.tsx` | `max-w-[80%]` is reasonable on mobile |

---

## Global Recommendations

### CSS & Viewport Setup

1. Add `viewport-fit=cover` to root layout `<meta name="viewport">`
2. Replace `h-screen` with `min-h-dvh` or `h-[100dvh]` in shell components
3. Add safe-area-inset padding for notched devices: `env(safe-area-inset-bottom)`
4. Consider bumping base font from 14px to 16px on mobile (prevents iOS zoom on input focus)

### Design Patterns to Adopt

1. **Bottom sheet** — for session drawer, file tree, and tab management on mobile
2. **Mobile app bar** — persistent top bar with hamburger/session toggle + settings
3. **Swipe actions** — for archive/delete on session cards and drawer items
4. **Responsive stacking** — `flex-col sm:flex-row` on all side-by-side CTAs
5. **Touch-first sizing** — `min-h-11` (44px) on all interactive elements

### Implementation Priority

| # | Task | Impact | Effort |
|---|------|--------|--------|
| 1 | Mobile app bar / bottom nav | Critical | Medium |
| 2 | Files view stacking/sheet | High | Medium |
| 3 | Touch-visible actions (remove hover-only) | High | Low |
| 4 | Session tabs → dropdown/sheet on mobile | High | Medium |
| 5 | Bump touch targets to 44px minimum | Medium | Low |
| 6 | Flex-wrap/stack horizontal layouts | Medium | Low |
| 7 | Wire up `SessionsDrawer` properly | Medium | Low |
| 8 | Global: `dvh`, safe-area, padding, font size | Medium | Low |

---

## Key Files to Modify

These are the highest-ROI files for mobile improvements:

1. `components/layout/app-shell.tsx` — add mobile nav
2. `components/layout/session-drawer.tsx` — fix positioning, full-width mobile
3. `components/layout/session-tabs.tsx` — touch targets, mobile tab management
4. `components/session/files-view.tsx` — responsive layout
5. `components/session/session-workspace.tsx` — metadata density
6. `app/(authenticated)/sessions/sessions-home.tsx` — layout wrapping
7. `app/(authenticated)/settings/layout.tsx` — reference pattern for other sections
