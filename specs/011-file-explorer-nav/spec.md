# Feature Specification: File Explorer & Navigation

**Feature Branch**: `011-file-explorer-nav`

**Created**: 2026-05-24

**Status**: Draft

**Input**: User description: "we still don't have a working file explorer/nav experience"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Persistent Split-Pane File Explorer on Desktop (Priority: P1)

On desktop, a user working in a session sees the chat on the left and a file explorer panel on the right — both visible simultaneously without switching tabs. They can browse the file tree and view file contents while the agent's chat messages remain in view. The panel can be opened or collapsed at will.

**Why this priority**: The core gap in the current experience — the tab-based "Chat / Files" switch forces users to lose sight of the conversation whenever they inspect files. A persistent split-pane solves this without any architectural redesign.

**Independent Test**: Open a session with a repository on a desktop-width viewport. Verify that a file explorer panel is accessible alongside the chat without navigating away from the conversation. Select a file and confirm its contents appear in the panel while the chat remains visible.

**Acceptance Scenarios**:

1. **Given** a session with a repository on a viewport wider than 768px, **When** the user opens the session page, **Then** a collapsed file explorer toggle is visible at the edge of the session view
2. **Given** the file explorer is collapsed, **When** the user clicks the toggle, **Then** the panel expands alongside the chat without navigating away from the conversation
3. **Given** the panel is open, **When** the user selects a file, **Then** the file's contents render in the panel while the chat remains fully visible and interactive
4. **Given** the panel is open with a file selected, **When** the agent creates or modifies a file, **Then** the file tree updates automatically to reflect the change
5. **Given** the panel is open, **When** the user drags the resize handle, **Then** the panel resizes fluidly between a minimum width that shows the tree and a maximum that preserves a usable chat area

---

### User Story 2 - Functional File Tree with Hierarchy Navigation (Priority: P1)

A user expands directories in the file tree, seeing nested files and folders rendered hierarchically with icons. They can search/filter to find files quickly in large repos and keyboard-navigate the tree without using a mouse.

**Why this priority**: Without a usable tree, the explorer is not functional at all. The current tree component exists but is not consistently accessible or integrated.

**Independent Test**: Open the file explorer, expand a nested directory three levels deep, verify children load. Type a filename fragment into the filter input and verify only matching entries show. Navigate by arrow keys and open a file with Enter.

**Acceptance Scenarios**:

1. **Given** the file explorer is open, **When** the root loads, **Then** top-level files and directories appear sorted with directories first
2. **Given** a collapsed directory in the tree, **When** the user clicks it, **Then** its children load and display indented beneath it within 500ms
3. **Given** a filter input, **When** the user types a partial filename, **Then** non-matching entries are hidden and matching entries (and their parent directories) remain visible
4. **Given** the tree is focused, **When** the user presses ArrowDown/ArrowUp, **Then** focus moves between items; ArrowRight expands a directory; ArrowLeft collapses it or moves focus to the parent; Enter opens a file
5. **Given** a directory with more than 500 entries, **When** it is expanded, **Then** only the first 500 entries are shown with an indicator that more exist

---

### User Story 3 - File Content Viewer with Syntax Highlighting (Priority: P1)

A user selects a file from the tree and sees its contents with syntax highlighting appropriate to the file type. Markdown files default to a rendered preview with a toggle to the raw source. The breadcrumb path lets them navigate back to the tree without losing their scroll position in the tree.

**Why this priority**: Viewing file contents is the primary reason to open the explorer — without it the tree is merely decorative.

**Independent Test**: Select a `.ts` file and verify syntax-highlighted source. Select a `.md` file and verify rendered markdown, then toggle to raw. Click a breadcrumb segment to return to the tree and verify the tree position is preserved.

**Acceptance Scenarios**:

1. **Given** a code file is selected, **When** the content loads, **Then** it renders with syntax highlighting within 1 second for files up to 500KB
2. **Given** a markdown file is selected, **When** it loads, **Then** it defaults to rendered preview mode with a toggle to show raw source
3. **Given** a file is open in the viewer, **When** the user clicks a breadcrumb segment, **Then** the tree view restores to the state it was in before the file was selected
4. **Given** a file larger than 500KB, **When** it loads, **Then** only the first 500KB renders with a visible truncation notice
5. **Given** a binary file (image, compiled object, etc.) is selected, **When** it loads, **Then** a clear "Binary file — cannot preview" message is shown instead of garbled content

---

### User Story 4 - Mobile File Explorer via Full-Screen Tab (Priority: P2)

On a mobile-width viewport, a user taps the "Files" tab in the session header to open a full-screen file explorer. From there they can browse the tree, select a file to view it, and return to the chat via the "Chat" tab or a back gesture.

**Why this priority**: The tab-based approach is correct on mobile where screen space cannot accommodate a split pane. This story ensures the existing implementation is polished and functional rather than just technically present.

**Independent Test**: Open a session on a mobile viewport (<768px), tap the "Files" tab, browse to and open a file, verify the viewer renders correctly, and tap "Chat" to return without losing chat history.

**Acceptance Scenarios**:

1. **Given** a mobile-width viewport, **When** the user taps the "Files" tab, **Then** a full-screen file explorer opens and the chat is hidden
2. **Given** a file is open in the mobile viewer, **When** the user taps the back button or breadcrumb, **Then** they return to the file tree (not the chat)
3. **Given** the user is in the Files tab, **When** they tap the "Chat" tab, **Then** the chat restores exactly where they left it (scroll position and input preserved)

---

### User Story 5 - Deep-Link File from Chat to Explorer (Priority: P2)

When the agent references a file path in the chat (e.g., via a file chip or a tool-call render), the user can click it to immediately open that file in the explorer panel without manually browsing the tree.

**Why this priority**: Reduces friction in the most common review workflow — the agent produces a file, references it in the message, and the user wants to inspect it immediately.

**Independent Test**: Have the agent write a file. Verify a clickable chip or link for the file path appears in the tool-call output. Click it and verify the file opens in the explorer panel.

**Acceptance Scenarios**:

1. **Given** the agent references a file path in a tool-call output, **When** the user clicks the file reference, **Then** the explorer panel opens (or becomes visible) and navigates directly to that file
2. **Given** the explorer opens via a file reference click, **When** the file loads, **Then** the breadcrumb shows the full path and the tree is expanded to the file's location

---

### Edge Cases

- What happens when a session has no repository (`repoPath` is null)? (Explorer panel is hidden; the file explorer toggle does not appear)
- What happens when the sandbox is unreachable? (Explorer shows a "Sandbox unavailable — cannot browse files" error state with a retry button)
- What happens if a file is deleted while the user has it open in the viewer? (A "File not found" message replaces the content; the breadcrumb still allows returning to the tree)
- What happens with circular symlinks in the directory tree? (Entries are rendered as files with a symlink indicator, no recursive traversal)
- What happens when the filter matches nothing? (Empty state: "No files match" with a clear filter button)
- What happens on viewports between 768px and ~900px where a full split-pane may be too narrow? (Panel defaults to collapsed; user can open it as an overlay or by dragging)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On viewports ≥ 768px, the file explorer MUST be accessible as a panel alongside the chat without replacing the chat view
- **FR-002**: The file explorer panel MUST be collapsible and expandable via a toggle control, with the last-used state persisted across page loads
- **FR-003**: The file explorer panel MUST be resizable by dragging a handle, bounded between a minimum tree-legible width and a maximum that preserves a usable chat area
- **FR-004**: The file tree MUST render directory contents lazily — only expanded directories fetch their children
- **FR-005**: The file tree MUST update in real time when the agent creates, modifies, or deletes files, without requiring a manual refresh
- **FR-006**: The file tree MUST support filtering by filename/path substring, showing only matching entries and their ancestor directories
- **FR-007**: The file tree MUST support full keyboard navigation: ArrowUp/Down to move focus, ArrowRight to expand, ArrowLeft to collapse or go to parent, Enter to open, Escape to deselect
- **FR-008**: The file viewer MUST render code files with syntax highlighting and markdown files with a rendered preview mode
- **FR-009**: The file viewer MUST provide a toggle between rendered preview and raw source for markdown files
- **FR-010**: The file viewer MUST show a breadcrumb path that allows returning to the tree view without losing tree scroll position
- **FR-011**: When a session has no `repoPath`, the file explorer toggle MUST NOT be shown
- **FR-012**: When the sandbox is unreachable, the explorer MUST show an error state with a retry action rather than silently showing an empty tree
- **FR-013**: Binary files MUST show an explicit "cannot preview" message rather than attempting to render their contents
- **FR-014**: Clicking a file reference chip in a chat message MUST open the file explorer and navigate to that file
- **FR-015**: On viewports < 768px, the file explorer MUST be accessible via the existing "Files" tab as a full-screen view

### Key Entities

- **Session**: Has a `repoPath` indicating whether a file system exists to browse; null `repoPath` means explorer is unavailable
- **Directory Node**: A folder entry in the file tree; lazily loads children on first expansion; tracks expanded/collapsed state
- **File Node**: A file entry in the tree; has name, path, file extension, optional git status indicator
- **File Content**: The raw text content of a file, with language metadata for syntax highlighting and a truncated flag
- **Explorer Panel State**: Persisted UI state — open/closed and panel width — restored on page reload

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can open the file explorer alongside the chat and view a file without ever navigating away from the chat on desktop — verified by a zero-navigation-switch path to file content
- **SC-002**: Directory contents load and render within 500ms for directories with up to 500 entries
- **SC-003**: File content appears within 1 second of selection for files up to 500KB
- **SC-004**: File tree updates reflecting agent changes are visible within 2 seconds of the change event firing
- **SC-005**: Users can locate any file in a 500-file repository using the filter input in under 10 seconds
- **SC-006**: 90% of users can navigate from an agent file reference in the chat to the file content in 2 clicks or fewer

## Assumptions

- The sandbox API endpoints for directory listing and file content reading are already implemented and operational (`/api/sessions/[id]/files` and `/api/sessions/[id]/files/content`)
- The SSE event stream already delivers file change events that the file tree hook can consume via `notifyFileTreeChange`
- The existing `file-tree.tsx`, `file-explorer.tsx`, and `file-preview.tsx` components are functionally correct but not consistently integrated into the session layout
- The desktop split-pane layout will reuse the existing `right-panel.tsx` component, which is currently implemented but not wired into the session workspace
- Panel width persistence uses `localStorage` (already used elsewhere in the app for model selection)
- Syntax highlighting is handled client-side based on file extension; no server-side rendering required
- Mobile is defined as viewport width < 768px; desktop as ≥ 768px
- The right panel width cap removal (spec 006) is considered a prerequisite or will be completed in parallel
