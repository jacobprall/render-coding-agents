# Cursor Agent UI/UX Specification

A comprehensive breakdown of the Cursor coding-agent interface, derived from a live session screenshot. This spec is written so that a coding agent or engineer can implement a faithful reproduction.

---

## 1. Global Layout Architecture

The application uses a **three-column layout** anchored to a native desktop window (Electron/Tauri-style). The right and left panels are toggleable — when closed, the layout collapses to one column.

```
┌────────────────────────────────────────────────────────────────────┐
│  [Traffic Lights]  Title Bar (centered)  [Tab Icons] [⋯] [+] [□] │
├────────────┬────────────────────────┬──────────────────────────────┤
│            │                        │  Right Panel Toolbar         │
│  Sidebar   │   Main Chat Panel      ├──────────────────────────────┤
│  (~220px)  │   (flex: 1, scroll)    │                              │
│            │                        │  Right Panel Content         │
│            │                        │  (file tree / git / preview) │
│            │                        │  (~400px, resizable)         │
│            ├────────────────────────┤                              │
│            │   Input Bar (sticky)   │                              │
├────────────┴────────────────────────┴──────────────────────────────┤
│                        Status Bar (full width)                     │
└────────────────────────────────────────────────────────────────────┘
```

**Key dimensions (approximate):**
- Sidebar width: ~220px, fixed (likely resizable via drag handle)
- Main panel: fills remaining horizontal space, compresses when right panel opens
- Right panel: ~400-500px when open, 0 when closed. Resizable via drag handle on left edge.
- Status bar height: ~28px
- Input bar height: ~44px (single-line idle state)
- Window chrome: native macOS traffic lights (close/minimize/maximize) top-left

**Color foundation:**
- Background: dark charcoal, approximately `#1e1e1e` to `#222222`
- Sidebar background: slightly darker, approximately `#191919` to `#1b1b1b`
- Text primary: `#d4d4d4` (light gray, not pure white)
- Text muted/secondary: `#888888` to `#999999`
- Accent: teal/cyan `#4ec9b0` used sparingly for active indicators
- Borders: very subtle, `#2d2d2d` to `#333333`, 1px

---

## 2. Title Bar

- **Style**: Custom-rendered, not native OS chrome (except for traffic lights)
- **Left**: macOS traffic light buttons (red/yellow/green circles), followed by a sidebar toggle icon and a search/magnifier icon
- **Center**: Conversation title, truncated with ellipsis if too long. White text, ~13px, medium weight. A small icon (bookmark/pin) appears to the right of the title. To the right of center, a `⋯` horizontal dots menu button for conversation-level actions.
- **Right panel tab icons**: A cluster of 4 small icons that toggle different right-panel views. These sit between the center title area and the far-right window controls. Each icon is ~16px, monochrome, and acts as a tab switch:
  1. **Terminal/code icon** (`{}` or bracket icon) — likely opens a terminal or code view
  2. **Globe/web icon** — likely opens a browser or web preview
  3. **Image/media icon** — likely opens an image/media preview
  4. **File/document icon** — opens the file explorer panel (see Section 11)
- **Far right**: `+` button (new tab/panel), and window management icons (maximize/restore). These are separated from the tab icons by a small gap.
- **Active tab indicator**: The currently active right-panel tab icon appears slightly brighter or has a subtle underline/highlight compared to inactive tabs.
- **Height**: ~38px
- **Background**: Same as sidebar, creating a unified top band
- **Keyboard shortcut badge**: `⌘N` shown inline next to "New Agent" in the sidebar header area, rendered in muted small text

---

## 3. Left Sidebar

### 3.1 Structure

The sidebar is a scrollable, vertically stacked list of **projects** and their **conversations**, functioning as a tree-view navigation.

```
[+ New Agent]      ⌘N
[🏪 Marketplace]

── project-slug ──────
  • Conversation title...
  • Conversation title...

── another-project ───
  • Conversation title...
```

### 3.2 Hierarchy

- **Top actions**: "New Agent" button and "Marketplace" link. These sit at the very top of the sidebar, above the project groups. "New Agent" has a `+` icon prefix. "Marketplace" has a store/grid icon.
- **Project groups**: Each group has a header label showing the project slug/name (e.g., `jacobprall/lifesystem`, `render-dynamic-workflows`, `personal-site`). These are rendered in muted gray (~`#777`), ~11px, uppercase or regular-case depending on content, acting as non-interactive section dividers.
- **Conversation items**: Bulleted with a small dot (`•`), indented under their project. Title text is truncated with ellipsis. ~13px, regular weight, `#cccccc`.
- **Active state**: The currently selected conversation has a subtle background highlight — a slightly lighter shade of the sidebar background, approximately `#2a2a2a`, with full-width coverage and possibly a left border accent or brighter text.
- **Activity indicator**: Some conversations show a colored dot (teal/green, ~6px circle) to the left of the bullet, indicating recent activity, unread state, or running status.
- **"More" toggle**: At the bottom of long project groups, a `••• More` link collapses/expands additional conversations.

### 3.3 Footer

- **User profile row**: Bottom-left, showing an avatar (circular, ~24px), username ("Jacob Pr..."), plan label ("Ultra Plan"), and an "Update" badge (green/teal pill button).
- **Action icons**: Filter/sort icon and settings gear icon, inline to the right of the user row.

### 3.4 Design notes

- No visible scrollbar in idle state; likely overlay-style scrollbar on hover/scroll
- Project headers use generous top margin (~16px) to visually separate groups
- The whole sidebar has a monochrome, low-contrast feel — nothing fights for attention except the active item and activity dots

---

## 4. Main Chat Panel

This is the core of the interface: a **scrollable, vertically stacked conversation thread** between the user and the agent.

### 4.1 Message Types

There are four distinct message types, each with different visual treatment:

#### 4.1.1 User Messages

- **Container**: Rounded rectangle with a subtle background fill, darker than the main panel but lighter than a code block. Approximately `#2a2d30` with rounded corners (~8px).
- **Text**: ~14px, `#d4d4d4`, regular weight, left-aligned
- **File attachments**: Rendered as inline pills/chips below the text. Each chip shows a document icon (`📄`) and the filename truncated, with a line count in parentheses like `(1-149)`. Chips have a slightly darker background, ~`#333`, rounded corners, ~12px text. Multiple attachments sit side-by-side in a horizontal row that wraps.
- **Retry/regenerate icon**: A small circular arrow icon (`↻`) at the bottom-right corner of the user message bubble, for re-sending.

#### 4.1.2 Agent Status Lines ("Worked for X")

- **Style**: Plain text, no background container. Muted color (~`#888`), ~13px, regular weight.
- **Format**: `Worked for {duration}` — e.g., "Worked for 1m 43s", "Worked for 16s", "Worked for 52s"
- **Purpose**: Timestamps between agent actions showing compute/work duration. These act as subtle section dividers in the conversation flow.

#### 4.1.3 Agent Response Messages

- **Container**: No visible background — text sits directly on the main panel background, creating visual asymmetry with user messages (user = bubbled, agent = flush).
- **Text**: ~14px, `#d4d4d4`, regular weight. Supports full markdown rendering:
  - **Bold text**: Used for key terms, rendered in `#e0e0e0` or white, font-weight 600
  - **Inline code**: Monospace, slightly different background (`#2a2a2a`), ~13px. Used for file paths like `projects/active/render-onboarding/philosophy-and-strategy.md`
  - **Em dashes**: Used liberally in prose (this is a stylistic detail of the agent's writing, not the UI, but worth noting for content rendering)
  - **Paragraphs**: Standard spacing, ~1.5 line-height, ~12px paragraph gap
- **"Message is too long to display" banner**: When a response exceeds a display threshold, a muted inline banner appears: gray text on a slightly raised background strip, with a small expand/link icon on the right. This is not an error — it's a graceful truncation with an affordance to view the full message.

#### 4.1.4 File Reference Chips (in user messages and agent context)

- **Appearance**: Horizontal pill-shaped badges with a document icon and filename
- **Background**: Dark teal/green tinted background (~`#1a3a35`), clearly distinct from regular UI elements
- **Text**: Teal/cyan colored (~`#4ec9b0`), ~12px
- **Format**: `📄 filename.ext (line_start-line_end)` — shows the file name and the line range being referenced
- **Layout**: Multiple chips in a horizontal flex row with ~8px gap
- **Context**: These appear both inside user message bubbles (as attachments the user provided) and as standalone rows (files the agent is referencing as context for a task)

### 4.2 Conversation Flow Pattern

The visual rhythm of a conversation is:

```
[User message bubble with attachments]
   ↓
"Worked for Xm Xs"
   ↓
Agent response (flush, no bubble)
   ↓
[User message bubble]
   ↓
"Worked for Xs"
   ↓
Agent response (flush)
   ↓
[File reference chips row]
[User message bubble]
   ↓
"Worked for Xs"
   ↓
Agent response with "Review" button
```

This creates a clear visual alternation: **bubbled → plain → bubbled → plain**, with timing markers as dividers.

### 4.3 Collapsible / Interactive Elements

- **"Review" button**: Appears inline at the bottom of certain agent responses. Rendered as a small pill button with a downward arrow, ~`#3a3a3a` background, light text. Suggests expandable content (a diff view, full file output, etc.)
- **Expand/collapse controls**: The "Message is too long" banner and potentially the "Review" button are part of a broader pattern of progressive disclosure — showing summaries with expand affordances.

---

## 5. Input Bar

Pinned to the bottom of the main chat panel, above the status bar.

### 5.1 Layout

```
┌─────────────────────────────────────────────────────┐
│ [+]  "Send follow-up"                    Model ▾ [🎙]│
└─────────────────────────────────────────────────────┘
```

- **Left**: A circular `+` button (add attachments/context)
- **Center**: Text input field with placeholder text "Send follow-up" in muted gray. Single-line idle, likely expands to multiline on input
- **Right cluster**:
  - Model selector: Shows "Opus 4.6" with a settings/lock icon and a "High" label, plus a dropdown chevron (`▾`). This lets the user switch models or quality tiers inline
  - Microphone button: Circular icon button for voice input
- **Background**: Slightly elevated from the main panel, ~`#252525`, with a subtle top border or shadow
- **Border-radius**: Rounded, ~8-12px, giving it a search-bar feel
- **Typography**: Placeholder text ~14px, muted gray

### 5.2 Interaction model

- Pressing Enter sends the message
- The `+` button likely opens a file picker or context menu for attaching files, referencing code, or adding images
- The model selector is a dropdown — the current selection persists across messages

---

## 6. Status Bar

A thin strip at the very bottom of the window.

```
┌─────────────────────────────────────────────────────┐
│ 📁 Local   main                                  ↻ │
└─────────────────────────────────────────────────────┘
```

- **Left**: A folder/project icon, the word "Local", and the git branch name "main" — indicating the active working context
- **Right**: A spinner/loading icon (circular arrows) indicating background activity
- **Height**: ~24-28px
- **Background**: Darkest element, ~`#181818`
- **Text**: ~11px, muted gray
- **Purpose**: Mirrors the VS Code status bar pattern — shows workspace state, git branch, and background process indicators

---

## 7. Typography System

| Role | Size | Weight | Color | Font |
|---|---|---|---|---|
| Sidebar project header | ~11px | 400 | `#777` | System sans-serif |
| Sidebar conversation item | ~13px | 400 | `#ccc` | System sans-serif |
| Title bar | ~13px | 500 | `#ddd` | System sans-serif |
| Message body text | ~14px | 400 | `#d4d4d4` | System sans-serif |
| Bold terms in messages | ~14px | 600 | `#e8e8e8` | System sans-serif |
| Inline code / file paths | ~13px | 400 | `#d4d4d4` | Monospace (likely system mono or Fira Code) |
| Status line ("Worked for") | ~13px | 400 | `#888` | System sans-serif |
| File chip labels | ~12px | 500 | `#4ec9b0` | System sans-serif |
| Status bar | ~11px | 400 | `#888` | System sans-serif |
| Input placeholder | ~14px | 400 | `#666` | System sans-serif |

The overall type system is restrained — likely two font families max (a system sans-serif and a monospace), with hierarchy established through size, weight, and color rather than font variety.

---

## 8. Color Palette Summary

| Token | Hex (approx) | Usage |
|---|---|---|
| `--bg-deepest` | `#181818` | Status bar |
| `--bg-sidebar` | `#1b1b1b` | Sidebar background |
| `--bg-main` | `#1e1e1e` | Main chat panel |
| `--bg-surface` | `#252525` | Input bar, elevated surfaces |
| `--bg-user-msg` | `#2a2d30` | User message bubbles |
| `--bg-hover` | `#2a2a2a` | Sidebar active item, hover states |
| `--bg-chip` | `#333333` | File attachment chips (neutral) |
| `--bg-chip-teal` | `#1a3a35` | File reference chips (teal-tinted) |
| `--border` | `#2d2d2d` | Subtle dividers |
| `--text-primary` | `#d4d4d4` | Body text |
| `--text-bright` | `#e8e8e8` | Bold/emphasized text |
| `--text-muted` | `#888888` | Secondary text, timestamps |
| `--text-dim` | `#666666` | Placeholders, tertiary |
| `--accent-teal` | `#4ec9b0` | Active indicators, file chip text, accents |
| `--accent-green` | `#3fb950` | "Update" badge, success states |

---

## 9. Key Interaction Patterns

### 9.1 Progressive Disclosure
Long content is truncated with a "Message is too long to display" banner rather than rendering thousands of lines. A "Review" button lets users expand diffs or file outputs inline. This keeps the conversation scannable.

### 9.2 Work Duration as Context
Every agent action is bracketed by a "Worked for Xm Xs" timestamp. This serves multiple purposes: it sets user expectations about compute cost, creates visual rhythm between turns, and provides transparency into agent behavior. These are not timestamps — they show elapsed work time, not wall-clock time.

### 9.3 File Context is First-Class
Files aren't hidden in a separate panel. They appear inline as chips in the conversation flow, showing filename and line ranges. This makes it clear what context the agent is working with at each step.

### 9.4 Asymmetric Bubbling
User messages get a background container (bubble). Agent messages do not. This creates immediate visual parsing of "who said what" without needing avatars or name labels. It follows the iMessage/WhatsApp convention but adapted for a code-agent context.

### 9.5 Conversation-as-Workspace
The sidebar organizes conversations under project groups, treating each conversation as a persistent workspace session rather than a disposable chat. The git branch in the status bar reinforces this — the conversation is tied to a specific codebase state.

---

## 10. Implementation Considerations

### 10.1 Rendering Pipeline
- Messages likely use a markdown renderer (e.g., `react-markdown` or `marked`) with custom components for code blocks, bold text, and inline code
- File chips are custom components, not standard markdown
- The "Worked for" lines are metadata attached to message objects, rendered between messages rather than inside them

### 10.2 Scrolling
- The main panel is a single scroll container
- New messages should auto-scroll to bottom, but only if the user is already at the bottom (preserve scroll position if user has scrolled up to read history)
- The sidebar scrolls independently

### 10.3 State Model
Each conversation likely has a structure like:

```
Conversation {
  id: string
  title: string
  project: string
  branch: string
  messages: [
    {
      role: "user" | "agent"
      content: string (markdown)
      attachments: [{ filename, lineRange, type }]
      workDuration?: number (seconds)
      truncated?: boolean
      reviewable?: { type: "diff" | "file", content: string }
    }
  ]
}
```

### 10.4 Responsive Behavior
- Sidebar is collapsible (toggle button in title bar)
- Right panel is collapsible (tab icons in title bar toggle it open/closed)
- Main panel should have a max content width (~700-800px) centered within its container to maintain readable line lengths, even on wide screens. When both side panels are open, the chat compresses but maintains minimum readable width (~450px).
- Input bar stretches full width of the main panel

### 10.5 Accessibility
- Keyboard navigation through sidebar items
- Focus management when sending messages
- Screen reader announcements for "Worked for" status lines
- High contrast between text and backgrounds (the ~`#d4d4d4` on ~`#1e1e1e` provides roughly 10:1 contrast ratio, well above WCAG AA)

---

## 11. Right Panel — File Explorer View

The right panel is a multi-mode drawer that opens to the right of the main chat panel. It has its own toolbar and content area. The file explorer is one of its modes.

### 11.1 Panel Toolbar

```
┌─────────────────────────────────────────────┐
│ [☰] [🔍] [←] [→]                       [⋯] │
└─────────────────────────────────────────────┘
```

- **Left cluster**: Four icon buttons in a row:
  - **List/hamburger icon** (`☰`): Toggles between tree view and some alternate view (flat list, outline, etc.)
  - **Search/magnifier** (`🔍`): Opens a search/filter input for the file tree
  - **Back arrow** (`←`): Navigate backward in file browsing history
  - **Forward arrow** (`→`): Navigate forward in file browsing history
- **Right**: Overflow menu (`⋯`) for additional file-tree actions
- **Height**: ~36px
- **Background**: Same as the panel background, ~`#1e1e1e`
- **Border**: Subtle bottom border separating toolbar from content

### 11.2 File Tree Content

The file tree is a standard hierarchical directory listing.

```
lifesystem                          (repo root label)
  > _archive
  > .cursor
  > 2026
  > areas
  > data
  > inbox
  > misc
  > projects
  > references
  > templates
  · .gitignore
  ♦ inbox.md
  ♦ index.md
  $ push.sh
  ♦ README.md
  ♦ someday.md
```

**Tree mechanics:**
- **Root label**: Shown at the top of the tree, bold or semi-bold, ~14px. This is the repository/project name (e.g., "lifesystem"), not a clickable path.
- **Directories**: Prefixed with a `>` chevron (collapsed) or `v` chevron (expanded). Clicking toggles expansion. Directory names use regular weight, ~13px.
- **Files**: Prefixed with a **colored icon** that indicates file type/status. No chevron since they're leaf nodes. File names use regular weight, ~13px.
- **Indentation**: Each nesting level indents ~16-20px. Lines are not drawn between levels (no tree-line guides), keeping the tree visually clean.
- **Selected file**: Gets a subtle background highlight, ~`#2a2d30`, full-width of the tree column. In the screenshot, `reading-list.md` is selected with this treatment.

**File type icons — a key design detail:**

Files use small colored diamond/dot icons to the left of the filename. The color encodes the file type or git status:

| Icon color | Approximate hex | Meaning |
|---|---|---|
| Teal/cyan diamond `♦` | `#4ec9b0` | Markdown files (`.md`) |
| Green diamond `♦` | `#6a9955` or `#3fb950` | Shell scripts (`.sh`), or git-added files |
| Gray dot `·` | `#888888` | Config/dotfiles (`.gitignore`, `.gitkeep`) |
| Yellow/orange `$` | `#dcdcaa` or `#e5c07b` | Script files or modified status |

This is reminiscent of VS Code's file-icon theming but more minimal — just colored shapes rather than detailed file-type icons. The effect is that you can scan the tree and immediately spot file types by color.

### 11.3 Bottom Action Bar

At the very bottom of the file explorer panel:

```
┌─────────────────────────────────────────────┐
│                    [Open File]  [New File]   │
└─────────────────────────────────────────────┘
```

- Two buttons, right-aligned: "Open File" and "New File"
- Style: Ghost/text buttons, no fill, ~13px, muted text that brightens on hover
- These are contextual actions for the file tree — "Open File" likely opens a file picker dialog, "New File" creates a new file in the currently selected directory
- Positioned at the bottom of the panel, outside the scroll area of the tree

---

## 12. Right Panel — Git Changes View

Toggled via the second or dedicated tab icon in the title bar. This panel shows the state of the local git working tree.

### 12.1 Branch Selector

```
┌─────────────────────────────────────────────┐
│  📁 Local    main                       [⋯] │
└─────────────────────────────────────────────┘
```

- **Left**: A folder/branch icon, followed by the label "Local" (rendered as a pill/badge with a subtle background, ~`#2a2d30`, rounded, indicating the source is the local working copy rather than a remote)
- **Right of pill**: The branch name "main" in regular text, ~14px
- **Far right**: Overflow menu (`⋯`)
- This is likely a dropdown — clicking "Local" or "main" could switch to other branches or show remote tracking info

### 12.2 Changes List

```
┌─────────────────────────────────────────────┐
│  ≡ No Local Changes  ▾                      │
│                                             │
│                                             │
│   No uncommitted changes on your local      │
│   branch                                    │
│                                             │
└─────────────────────────────────────────────┘
```

- **Filter/sort header**: A filter icon (`≡`) followed by "No Local Changes" with a dropdown chevron. This likely filters between staged, unstaged, untracked, etc.
- **Empty state**: When there are no changes, a centered muted message reads "No uncommitted changes on your local branch" — standard empty-state pattern, ~13px, `#888`.
- **When changes exist**: The list would show changed files, likely using the same colored-icon system as the file tree, with added/modified/deleted status indicators.

---

## 13. Right Panel — File Preview View

When a file is selected in the file tree and opened, the right panel transitions to a **split view** with the tree on the left and a file preview on the right. This is the most information-dense state of the right panel.

### 13.1 File Title Bar

When a file is open for preview, a dedicated file title appears in the **window title bar area**, replacing or supplementing the conversation title:

```
┌────────────────────────────────────────────────────────────────────┐
│ [Tab Icons]    ♦ reading-list.md                      [+] [□] [□] │
└────────────────────────────────────────────────────────────────────┘
```

- The filename appears with its colored type icon (e.g., teal diamond for `.md`)
- This sits in the title bar row, indicating the file preview has "focus" or is the active context

### 13.2 Sub-Toolbar (Breadcrumbs + View Toggle)

Below the title bar, the right panel shows a sub-toolbar with navigation and view controls:

```
┌─────────────────────────────────────────────────────────────────┐
│ [☰] [🔍]  [←] references > reading-list.md   [Preview|Markdown] [⋯]│
└─────────────────────────────────────────────────────────────────┘
```

- **Left**: Same hamburger and search icons as the file explorer toolbar
- **Back arrow** (`←`): Returns to the parent view or previous navigation state
- **Breadcrumb path**: `references > reading-list.md` — shows the directory path as clickable breadcrumb segments separated by `>`. Each segment is a link back to that directory level.
- **View toggle** (right side): A segmented control with two options: "Preview" and "Markdown". "Preview" renders the file (e.g., rendered markdown), "Markdown" shows raw source. The active option has a filled/highlighted background (e.g., `#3a3a3a`), the inactive option is a ghost button.
- **Far right**: Overflow menu (`⋯`) and small action icons (possibly edit-in-editor, open-externally)

### 13.3 Split Layout

When a file is open, the right panel splits horizontally:

```
┌──────────────────────┬──────────────────────────┐
│  File Tree (left)    │  File Preview (right)    │
│  (~250px)            │  (flex: 1)               │
│                      │                          │
│  lifesystem          │  title: Reading List     │
│    > _archive        │  type: reference         │
│    > .cursor         │  domain: both            │
│    v references      │  tags: [books, articles] │
│      • reading-list  │  created: 2026-05-18     │
│      • recipes.md    │  updated: 2026-05-18     │
│      • stoic-pass... │                          │
│    > templates       │  ## Reading List         │
│                      │                          │
│                      │  ### Currently Reading   │
│                      │                          │
│                      │  ### To Read             │
│                      │                          │
│                      │  ### Finished            │
└──────────────────────┴──────────────────────────┘
```

**File tree (left sub-panel):**
- Narrower version of the full file tree, same component
- The selected file is highlighted with a background fill
- Tree nodes that are parents of the selected file are auto-expanded
- Small action icons appear top-right of the tree: a new-file icon and an open-externally icon

**File preview (right sub-panel):**
- Renders the file content based on the selected view mode (Preview or Markdown)
- In Preview mode, markdown is rendered with:
  - **YAML frontmatter** displayed as a metadata block at the top — key-value pairs in monospace or slightly styled text, showing fields like `title`, `type`, `domain`, `tags`, `created`, `updated`. This is not hidden — it's rendered as visible structured data.
  - **Headings** rendered at appropriate sizes (H2, H3)
  - Standard markdown rendering for body content
- The preview area scrolls independently from the tree
- Text is ~14px, `#d4d4d4`, with headings in white/brighter text and larger sizes

---

## 14. Review Button & Git Actions (Chat-Inline)

The screenshots reveal more detail about the inline git interaction in the chat panel.

### 14.1 Review Button

When the agent has made file changes, a "Review" button appears at the bottom of the conversation:

```
┌──────────────────────────────────────────┐
│  Review +8 -8    Create Branch & Commit ▾  ↓  │
└──────────────────────────────────────────┘
```

- **"Review" pill**: Shows a diff summary — `+8 -8` in green/red text indicating lines added/removed. The numbers use the conventional git-diff color coding: green for additions, red for deletions. Clicking likely opens a diff view in the right panel.
- **"Create Branch & Commit" button**: A bordered/outlined button with a dropdown chevron (`▾`). This is an inline git action — it lets the user create a new branch and commit the agent's changes without leaving the chat. The dropdown likely offers options like "Commit to current branch", "Create branch & commit", "Create PR", etc.
- **Down arrow** (`↓`): A scroll-to-bottom or "show more" affordance.
- **Layout**: These buttons sit in a horizontal row, left-aligned, below the last agent message. They are part of the conversation flow, not the input bar.

### 14.2 State Interaction

The Review/Commit controls and the right-panel Git Changes view are connected:
- When the agent has made changes, the Review button shows in the chat AND the Git Changes panel would show uncommitted files
- After committing, the Git Changes panel returns to "No uncommitted changes" and the Review button likely disappears or updates
- This creates a workflow: **Agent works → Review diff → Commit** without context-switching

---

## 15. Updated Layout Architecture Summary

The full three-panel layout supports these combinations:

| State | Left | Center | Right |
|---|---|---|---|
| Chat only | Sidebar | Chat + Input | (hidden) |
| Chat + Files | Sidebar | Chat + Input | File Explorer |
| Chat + Git | Sidebar | Chat + Input | Git Changes |
| Chat + Preview | Sidebar | Chat + Input | File Tree + Preview (split) |

The right panel is the most architecturally interesting piece. It's a **single container** that switches between modes via the tab icons in the title bar, and within the file explorer mode, it further splits into a sub-layout (tree + preview) when a file is opened. This is a panel-within-a-panel pattern.

### 15.1 Panel Transition Behavior

- Opening/closing the right panel should animate (slide in/out, ~200ms ease)
- The main chat panel flexes to accommodate — it compresses but doesn't reflow message content (messages keep their max-width, they just get less margin)
- Switching between right-panel modes (file explorer ↔ git ↔ preview) is instant, no animation — the content swaps in place
- Opening a file from the tree transitions the panel from single-column (tree only) to split (tree + preview) with a smooth width animation

### 15.2 Implementation: Right Panel Component Tree

```
RightPanel
├── PanelTabBar (icons in title bar — controls which mode is active)
├── FileExplorerMode
│   ├── ExplorerToolbar (hamburger, search, back/forward, overflow)
│   ├── FileTree (recursive tree component)
│   │   ├── TreeNode (directory — expandable)
│   │   └── TreeLeaf (file — selectable, colored icon)
│   ├── FilePreview (conditionally rendered when a file is selected)
│   │   ├── PreviewToolbar (breadcrumbs, Preview/Markdown toggle)
│   │   └── PreviewContent (markdown renderer or raw text)
│   └── BottomActions ("Open File", "New File")
├── GitChangesMode
│   ├── BranchSelector (Local/main pill + dropdown)
│   ├── ChangesFilter (staged/unstaged/untracked dropdown)
│   ├── ChangesList | EmptyState
│   └── CommitActions (if changes exist)
└── TerminalMode / BrowserMode / MediaMode (other tab contents, not yet observed)
```

---

## 16. Design Principles (Synthesized)

Several design principles emerge from the full UI:

**1. Progressive disclosure everywhere.** Long messages truncate. File trees collapse. The right panel hides entirely. Diffs summarize as `+8 -8` before you expand. Nothing forces information density the user didn't opt into.

**2. Git is a first-class citizen, not an afterthought.** The branch name appears in the status bar. The Review button with diff stats appears inline in the chat. A dedicated git changes panel lives in the right drawer. The "Create Branch & Commit" action is one click from the chat. This treats the agent's output as code-to-be-committed, not just text-to-be-read.

**3. The file system is browsable alongside the conversation.** You don't leave the chat to look at files. The right panel lets you explore the repo, preview files, and understand the codebase context — all while reading the agent's responses. The file reference chips in the chat link these two worlds.

**4. Minimal chrome, maximal content.** Borders are nearly invisible. Backgrounds differ by 2-3 hex values. Icons are monochrome. The visual hierarchy comes from spacing and typography, not from decorative elements. This lets the user's content (code, markdown, conversation) stay in focus.

**5. Asymmetric message design replaces identity markers.** No avatars, no name labels, no colored sidebars. The user's bubble vs. the agent's flush text is enough. This is faster to scan than any avatar-based system.

**6. Tab icons as mode switches, not window multipliers.** The right panel doesn't spawn new windows or tabs. It's a single panel that changes modes. This keeps the spatial model simple: left = navigation, center = conversation, right = context.

ALL ICONS ARE VERY SMALL - TINY