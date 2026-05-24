# Feature Specification: Right Panel File Operations

**Feature Branch**: `006-right-panel-file-ops`

**Created**: 2026-05-22

**Status**: Draft

**Input**: User description: "Remove the max expandable width lock on the right-hand nav panel. Implement the actual file tree (live directory browsing), file viewer (syntax-highlighted content display), and file diff (git change visualization) inside the right panel drawer. The panel opens via a collapse/expand toggle in the title bar; mode-switching icons (files, git) live only inside the open panel."

## Clarifications

### Session 2026-05-22

- Q: How should the panel split when a file is selected (tree vs preview layout)? → A: Tree collapses to a narrow icon rail (~40px), preview takes full panel width, breadcrumb path allows returning to full tree view.
- Q: What diff display format should the viewer use? → A: Unified inline diff — single column with context lines, additions (+green), and deletions (-red) interleaved (GitHub-style).
- Q: Should the file viewer include a built-in search/find-in-file feature? → A: No custom search for this iteration — rely on browser native Cmd+F. Defer custom find to a future release.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Live File Tree Browsing (Priority: P1)

A user opens the right panel and browses the agent's working directory in real time. They expand folders, see files organized hierarchically with color-coded icons, and observe the tree update live as the agent creates or modifies files.

**Why this priority**: The file tree is the entry point to all file operations — without it, neither file viewing nor diffing is accessible.

**Independent Test**: Open the right panel, expand a directory, verify children load. Have the agent create a file and verify it appears in the tree without manual refresh.

**Acceptance Scenarios**:

1. **Given** a session with a repository, **When** the user opens the right panel in files mode, **Then** the root directory listing loads showing folders and files with appropriate icons
2. **Given** a collapsed directory, **When** the user clicks the expand chevron, **Then** the directory's children load and render indented below it
3. **Given** the agent creates a new file during a response, **When** the file change event fires, **Then** the parent directory in the tree refreshes automatically to show the new file
4. **Given** a repository with 1000+ files, **When** the user navigates the tree, **Then** only expanded directories fetch their contents (lazy loading) with no perceptible delay

---

### User Story 2 - File Content Viewer (Priority: P1)

A user selects a file from the tree and sees its contents rendered in a preview pane alongside the tree. Markdown files render as formatted prose; code files show syntax-highlighted source. The user can toggle between rendered preview and raw source.

**Why this priority**: Viewing file content is the primary action after browsing the tree — it's what gives the file tree its utility.

**Independent Test**: Select a .md file, verify rendered markdown. Select a .ts file, verify syntax-highlighted code. Toggle between preview and raw mode.

**Acceptance Scenarios**:

1. **Given** a file is selected in the tree, **When** it loads, **Then** the tree collapses to a narrow icon rail (~40px) and the preview takes the full panel width, with a breadcrumb path showing the file location and allowing return to full tree view
2. **Given** a markdown file is selected, **When** in preview mode, **Then** the content renders as formatted markdown with headings, lists, and code blocks
3. **Given** a code file is selected, **When** in raw/code mode, **Then** the content displays with syntax highlighting appropriate to the language
4. **Given** a file larger than 500KB, **When** it loads, **Then** a truncation notice appears with only the first portion shown
5. **Given** a user clicks a file reference chip in the chat, **When** the action completes, **Then** the right panel opens to that file at the referenced location

---

### User Story 3 - File Diff Viewer (Priority: P2)

A user views git changes in the right panel's git mode. They see a list of changed files with status indicators, and can expand any file to see an inline diff showing added/removed lines with standard green/red highlighting.

**Why this priority**: Diff viewing enables the code review workflow that makes the agent's output actionable — but requires the file tree and viewer infrastructure first.

**Independent Test**: Have the agent modify files, switch to git mode, verify changed files list with +/- stats, expand a file to see inline diff.

**Acceptance Scenarios**:

1. **Given** the agent has modified files, **When** the user opens the git mode panel, **Then** changed files are listed with their status (added/modified/deleted) and line change counts
2. **Given** a changed file in the list, **When** the user clicks it, **Then** a unified inline diff expands showing context lines, added lines in green (+), and removed lines in red (-) in a single column
3. **Given** no uncommitted changes exist, **When** the git panel renders, **Then** an empty state message reads "No uncommitted changes"
4. **Given** the user commits changes via the review bar, **When** the commit succeeds, **Then** the git panel refreshes to show a clean state

---

### User Story 4 - Unconstrained Panel Width (Priority: P2)

The right panel has no hard maximum width — users can drag it to any width that still preserves the minimum chat area width. This allows power users to give more space to file content or diffs when needed.

**Why this priority**: Removing the width cap is a simple but important UX improvement that makes the file viewer and diff viewer more usable for wide content.

**Independent Test**: Drag the right panel resize handle to the left until the chat area reaches its minimum width. Verify the panel doesn't stop at an arbitrary maximum before that point.

**Acceptance Scenarios**:

1. **Given** the user drags the right panel's resize handle, **When** they pull it wider than the previous 600px cap, **Then** the panel continues to expand until the chat area reaches its minimum width (~450px)
2. **Given** a wide panel showing a file diff, **When** the window is resized smaller, **Then** the panel contracts to maintain the chat minimum width rather than overflowing
3. **Given** the user releases the resize handle at any valid width, **When** they reload the page, **Then** the panel restores to that width

---

### Edge Cases

- What happens when a file is deleted while the user is viewing it? (Show "File not found" state, offer to close)
- How does the tree handle symlinks or circular references? (Render as files, don't follow)
- What happens with binary files (images, compiled assets)? (Show "Binary file" notice, no preview)
- How does the diff handle very large file changes (1000+ lines)? (Collapse by default with "Show full diff" affordance)
- What happens when the API returns an error for a directory? (Show error state with retry button)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The right panel MUST have no hard maximum width — its maximum extent is limited only by the chat area's minimum width constraint
- **FR-002**: System MUST render a hierarchical file tree by fetching directory contents on demand (lazy loading per expanded directory)
- **FR-003**: System MUST update the file tree in real time when the agent creates, modifies, or deletes files (event-driven refresh of affected directories)
- **FR-004**: System MUST display file contents with syntax highlighting for code files and rendered formatting for markdown files
- **FR-005**: System MUST provide a toggle between "Preview" (rendered) and "Raw" (source) view modes for file content
- **FR-006**: When a file is selected, the tree MUST collapse to a narrow icon rail (~40px) and the preview MUST take the full panel width, with a breadcrumb path for navigation back to the full tree view
- **FR-007**: System MUST display a list of changed files in git mode with status indicators (added/modified/deleted) and line change statistics
- **FR-008**: System MUST render unified inline diffs (single column) for changed files showing context lines, additions (+green), and deletions (-red) interleaved
- **FR-009**: System MUST handle the "panel open" toggle exclusively from the title bar collapse/expand button — mode switching (files/git) icons appear only inside the open panel
- **FR-010**: System MUST gracefully handle error states (file not found, API errors, binary files) with informative messages and recovery actions
- **FR-011**: File viewer MUST NOT include custom search/find-in-file functionality in this iteration — browser native Cmd+F is sufficient

### Key Entities

- **Directory Node**: A folder in the repository tree. Lazily loads children on expand. Tracks expanded/collapsed state.
- **File Node**: A file in the repository tree. Has name, path, extension, and optional git status. Selectable to trigger preview.
- **File Content**: The textual contents of a file with associated language/type metadata for rendering decisions.
- **Git Change**: A file that differs from the committed state. Includes path, change type (added/modified/deleted), and line statistics (added/removed counts).
- **Inline Diff**: A visual representation of changes within a single file, showing context lines, additions, and deletions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Directory contents load and render within 500ms for directories with up to 500 entries
- **SC-002**: File content appears within 1 second of selection for files up to 500KB
- **SC-003**: File tree updates reflect agent changes within 2 seconds of the change event
- **SC-004**: Users can resize the panel to any width between 300px and (viewport width minus 450px) without encountering hard stops
- **SC-005**: Diff rendering for files with up to 500 changed lines completes within 1 second
- **SC-006**: 90% of users can successfully navigate from tree → file → diff without assistance

## Assumptions

- The backend sandbox provides API endpoints for directory listing, file content retrieval, and git status (these API routes exist as stubs from the prior implementation)
- The file tree operates on the agent's working directory within the session sandbox
- Syntax highlighting is handled client-side based on file extension detection
- Git diff data is computed server-side and returned as structured unified diff hunks (context + additions + deletions)
- The existing streaming infrastructure (SSE) delivers file change notifications to the client
- The panel collapse/expand toggle button already exists in the title bar from the prior UI overhaul
- In-file search is explicitly out of scope for this iteration (browser Cmd+F covers the need)
