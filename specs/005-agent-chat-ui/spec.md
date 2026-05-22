# Feature Specification: Agent Chat UI

**Feature Branch**: `005-agent-chat-ui`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "Cursor Agent UI/UX — a three-panel coding agent interface with sidebar navigation, main chat panel, and context-aware right panel supporting file exploration, git changes, and file preview. Dark theme with progressive disclosure, inline git actions, and conversation-as-workspace paradigm."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conversational Agent Interaction (Priority: P1)

A user opens the agent interface and conducts a multi-turn coding conversation. They send messages with file attachments, receive agent responses with markdown formatting, and can see work duration between turns. The conversation displays with clear visual distinction between user and agent messages.

**Why this priority**: The chat experience is the core product surface — without a functional, readable conversation thread, no other features matter.

**Independent Test**: Can be fully tested by sending a message with file attachments, receiving an agent response, and verifying the alternating message display renders correctly with timing markers between turns.

**Acceptance Scenarios**:

1. **Given** a user has an active session, **When** they type a message and press Enter, **Then** the message appears as a visually distinct bubble with any attached files shown as inline chips
2. **Given** the agent is processing a request, **When** it begins generating, **Then** tokens stream into the conversation in real-time, rendering flush (no bubble) with full markdown support, followed by a "Worked for X" duration marker once complete
3. **Given** an agent response exceeds the display threshold, **When** the response renders, **Then** it is truncated with a "Message is too long to display" banner and an expand affordance
4. **Given** a user attaches files to a message, **When** the message is sent, **Then** each file appears as a pill/chip showing filename and line range

---

### User Story 2 - Project-Based Sidebar Navigation (Priority: P1)

A user navigates between multiple coding agent conversations organized by project. They can create new agents, see which conversations have recent activity, and switch between sessions without losing context.

**Why this priority**: Navigation and session management are essential for users working across multiple projects — without this, users can only access one conversation.

**Independent Test**: Can be tested by creating multiple conversations under different projects, switching between them, and verifying active state indicators and conversation grouping.

**Acceptance Scenarios**:

1. **Given** a user has conversations across multiple projects, **When** they view the sidebar, **Then** conversations are grouped under project headers with clear visual hierarchy
2. **Given** a conversation has recent activity, **When** the sidebar renders, **Then** an activity indicator dot appears next to that conversation
3. **Given** a user clicks "New Agent", **When** the action completes, **Then** a new conversation is created and becomes the active session
4. **Given** a user selects a different conversation, **When** they click it, **Then** the main panel updates to show that conversation's history and the sidebar highlights the active item

---

### User Story 3 - File Explorer Context Panel (Priority: P2)

A user browses the repository file tree alongside their conversation. They can expand directories, select files, preview file contents (rendered markdown or raw source), and understand the codebase context while reading agent responses.

**Why this priority**: File context alongside the conversation eliminates the need to switch between tools — it directly supports the "conversation as workspace" paradigm and helps users validate agent work.

**Independent Test**: Can be tested by opening the file explorer panel, navigating a directory tree, selecting a file, toggling between preview and raw modes, and verifying the split layout renders correctly.

**Acceptance Scenarios**:

1. **Given** the right panel is in file explorer mode, **When** a user expands a directory, **Then** child items appear indented with file-type icons color-coded by type
2. **Given** a user selects a file in the tree, **When** the file opens, **Then** the panel splits into tree (left) and preview (right) with breadcrumb navigation
3. **Given** a file is open in preview, **When** the user toggles "Markdown" view, **Then** the raw source is displayed instead of the rendered version
4. **Given** a user clicks a file reference chip in the chat, **When** the action completes, **Then** the right panel opens to that file at the referenced line range

---

### User Story 4 - Inline Git Review and Commit (Priority: P2)

After the agent makes changes, a user reviews the diff summary inline in the chat and can create a branch and commit without leaving the conversation. The git changes panel shows the current working tree state.

**Why this priority**: Treating the agent's output as code-to-be-committed (not just text) is a key differentiator. Inline git actions eliminate context-switching for the most common post-agent workflow.

**Independent Test**: Can be tested by having the agent make file changes, verifying the Review button appears with diff stats (+/-), clicking to expand the diff, and using "Create Branch & Commit" to commit changes.

**Acceptance Scenarios**:

1. **Given** the agent has made file changes, **When** the response completes, **Then** a "Review" button appears showing diff summary (lines added/removed in green/red)
2. **Given** a user clicks "Create Branch & Commit", **When** the action completes, **Then** the changes are committed and the git changes panel updates to show no uncommitted changes
3. **Given** the right panel is in git changes mode, **When** there are uncommitted changes, **Then** modified files are listed with status indicators
4. **Given** no changes exist, **When** the git panel renders, **Then** an empty state message reads "No uncommitted changes on your local branch"

---

### User Story 5 - Responsive Multi-Panel Layout (Priority: P2)

A user adjusts the interface layout by toggling the sidebar and right panel open/closed, resizing panels via drag handles, and working across different screen sizes while maintaining readable content.

**Why this priority**: A flexible layout accommodates different workflows (focused chat vs. context-heavy exploration) and screen sizes without degrading the experience.

**Independent Test**: Can be tested by toggling panels open/closed, resizing via drag handles, and verifying the main chat panel flexes appropriately with minimum width constraints.

**Acceptance Scenarios**:

1. **Given** all panels are open, **When** the user closes the right panel, **Then** the main chat panel expands smoothly to fill the space
2. **Given** the user drags the right panel's left edge, **When** released, **Then** the panel resizes and the layout reflows without content reflow or overflow
3. **Given** a narrow viewport, **When** both side panels are open, **Then** the chat maintains a minimum readable width and panels can be collapsed
4. **Given** the user toggles the sidebar, **When** it closes, **Then** the layout animates to a two-column or single-column state

---

### User Story 6 - Model Selection and Input Controls (Priority: P3)

A user configures which AI model to use for their next message, attaches files via the input bar, and can use voice input. The model selection persists across messages.

**Why this priority**: Model selection and input flexibility are important for power users but not blocking for core functionality.

**Independent Test**: Can be tested by switching models via the dropdown, verifying the selection persists across messages, and using the attachment button to add files.

**Acceptance Scenarios**:

1. **Given** the input bar is visible, **When** the user clicks the model selector, **Then** a dropdown shows available models and quality tiers
2. **Given** a user selects a different model, **When** they send the next message, **Then** the agent uses the selected model and the selection persists
3. **Given** a user clicks the "+" button, **When** the action triggers, **Then** a file picker or context menu appears for attaching files

---

### Edge Cases

- What happens when a conversation has hundreds of messages? (virtualized scrolling, performance)
- How does the system handle loss of connection mid-agent-response? (graceful reconnection, partial message display)
- What happens when the user scrolls up during an agent response? (scroll position preserved, "scroll to bottom" affordance appears)
- How does the file tree handle repositories with thousands of files? (lazy loading, search/filter)
- What happens when a git commit fails? (error state in the inline commit UI, retry affordance)
- How does the system handle very long file names in the sidebar and file tree? (truncation with ellipsis, tooltip on hover)

## Clarifications

### Session 2026-05-21

- Q: How are agent responses delivered to the UI? → A: Streaming token-by-token (words appear as the agent generates them)
- Q: Is this single-user or multi-user? → A: Multi-user with private conversations (users authenticate, each sees only their own conversations grouped by their projects)
- Q: What does the user see while the agent is working? → A: Streaming text plus visible tool calls (file edits, shell commands shown as collapsible inline blocks alongside streaming text)
- Q: What conversation lifecycle actions are available? → A: Standard — rename, archive (soft-hide with filter to restore), and delete with confirmation
- Q: Does the file tree update in real-time as the agent works? → A: Yes — live updates driven by file-change events, reflecting creates/modifies/deletes as they happen

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST render a three-panel layout (sidebar, main chat, right context panel) with independently scrollable regions
- **FR-002**: System MUST display user messages in visually distinct containers (bubbles) and agent messages flush (no container) to create asymmetric message identification
- **FR-003**: System MUST show elapsed work duration markers ("Worked for Xm Xs") between agent turns
- **FR-004**: System MUST render agent responses with full markdown support (bold, inline code, headings, paragraphs, code blocks) and stream tokens in real-time as the agent generates them
- **FR-004a**: System MUST display intermediate tool calls (file edits, shell commands, searches) as collapsible inline blocks within the agent response stream, showing the tool name and a summary of the action
- **FR-005**: System MUST display file attachments as inline pill/chip components showing filename and line range
- **FR-006**: System MUST organize sidebar conversations under project group headers with activity indicators, scoped to the authenticated user's own conversations only
- **FR-006a**: System MUST support renaming, archiving (soft-hide), and deleting conversations from the sidebar with a confirmation step for destructive actions
- **FR-006b**: System MUST provide a filter/toggle to show archived conversations, allowing users to restore them
- **FR-007**: System MUST support toggling the right panel between file explorer, git changes, and file preview modes via tab icons
- **FR-008**: System MUST render a hierarchical file tree with expand/collapse directories and color-coded file type icons, updating in real-time as the agent creates, modifies, or deletes files (event-driven, not polling)
- **FR-009**: System MUST provide a split view (tree + preview) when a file is selected, with breadcrumb navigation and Preview/Markdown toggle
- **FR-010**: System MUST display inline git review controls (Review button with +/- stats, "Create Branch & Commit" action) after the agent makes file changes
- **FR-011**: System MUST show current git branch and workspace context in a persistent status bar
- **FR-012**: System MUST truncate long agent responses with a progressive disclosure pattern ("Message is too long to display" with expand affordance)
- **FR-013**: System MUST support panel resizing via drag handles and panel toggling via sidebar/title-bar controls with smooth transitions
- **FR-014**: System MUST maintain readable content width (max ~700-800px for chat) regardless of window size
- **FR-015**: System MUST provide a model selector in the input bar that persists selection across messages
- **FR-016**: System MUST auto-scroll to the latest message when the user is at the bottom, but preserve scroll position when the user has scrolled up
- **FR-017**: System MUST use a dark color theme as the default with high-contrast text (meeting WCAG AA standards)
- **FR-018**: System MUST support keyboard navigation through sidebar items and focus management when sending messages

### Key Entities

- **Conversation**: A persistent multi-turn exchange between a user and an agent, tied to a project and git branch. Private to the owning user — not visible to other team members. States: active, archived, deleted. Contains messages, metadata (title, duration), and associated file changes.
- **Project**: A grouping mechanism for conversations, typically corresponding to a code repository. Contains multiple conversations.
- **Message**: A single turn in a conversation — either user-authored (with optional file attachments) or agent-generated (with optional review actions and inline tool call blocks). Includes role, content (markdown), attachments, tool invocations, work duration, and truncation state.
- **File Reference**: A pointer to a specific file and line range within the workspace, rendered as an interactive chip that can open the file in the right panel.
- **Agent Work Session**: Represents the compute time between user input and agent output, displayed as "Worked for X" duration markers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can send a message and see the agent's response within the conversation in under 1 second (excluding agent compute time)
- **SC-002**: Users can switch between conversations in under 500ms with no visible layout shift
- **SC-003**: The interface renders correctly and remains responsive with conversations containing 200+ messages
- **SC-004**: Users can review agent-generated file changes and commit them without leaving the chat in 3 clicks or fewer
- **SC-005**: Panel toggle and resize operations complete with smooth animation (no jank above 16ms frame budget)
- **SC-006**: File tree navigation (expand/collapse/select) responds in under 100ms for repositories with up to 10,000 files
- **SC-007**: 90% of first-time users can identify user vs. agent messages without any onboarding
- **SC-008**: The interface maintains WCAG AA contrast ratios (4.5:1 minimum) across all text elements

## Assumptions

- The existing backend chat/session infrastructure (conversations, messages, agent runs) is already in place and provides WebSocket or streaming APIs for real-time updates
- The dark theme is the primary (and initially only) supported theme — light mode is out of scope for v1
- The application is a web application accessed via modern browsers (Chrome, Firefox, Safari, Edge — latest 2 versions)
- File system access for the file explorer and git operations relies on existing backend sandbox/session APIs
- The right panel's terminal and browser preview modes (referenced in the architecture) are out of scope for this specification — only file explorer, git changes, and file preview are included
- Voice input (microphone button) is a placeholder for v1 — the button appears but functionality may be deferred
- The existing database schema for sessions, chats, chat_messages, and agent_runs provides the data model for conversations
