# Feature Specification: Agent Chat Interface Updates

**Feature Branch**: `010-chat-interface-updates`

**Created**: 2026-05-24

**Status**: Draft

**Input**: User description: "Slash commands for skills in chat; improve agent chat message formatting (collapsed tool call boxes should not span full chat width—about half width while closed; expanding can use more space); consolidate file nav and file viewer and remove redundant git panel since diff view exists; fix commit buttons that fail with 'Failed to commit changes'."

## Clarifications

### Session 2026-05-24

- Q: When a user picks a skill via `/` in chat, how long should that skill apply? → A: Next message only — skill applies to the single outgoing message; attachment clears after send (inline slash is one-shot; session-level skill configuration remains separate).
- Q: If the user commits while an agent run is still in progress, what should happen? → A: Allow commit — persist the current working-tree snapshot immediately with no blocking dialog or warning.
- Q: When a tool call is expanded, how wide should the detail panel be? → A: Full message column width when expanded (bounded height with internal scroll); collapsed state remains ~50% width.
- Q: When the user commits from the session review UI, should that include push to remote? → A: Local commit always; push to remote only when the user/org "auto commit & push" preference is enabled.
- Q: On mobile, what happens to the Git bottom-nav tab when the standalone git panel is removed? → A: Remove the Git tab on mobile; file review (including changes/diffs) is only via the Files destination and inline chat review, consistent with desktop.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Commit Agent Changes Successfully 

After an agent run modifies files, a user reviews the inline diff summary in the conversation and commits their work using the review actions. The commit completes successfully, the UI reflects the new repository state, and the user receives clear confirmation or actionable error guidance if something goes wrong.

**Why this priority**: Committing agent output is the primary handoff from conversation to version control. A broken commit flow blocks the entire review-and-ship workflow and is reported as a production defect.

**Independent Test**: Run an agent session that changes at least one file, open the review bar, trigger commit with a valid message, and verify success feedback plus cleared or updated change indicators. Repeat with a failure scenario (e.g., no changes, invalid message) and verify error handling.

**Acceptance Scenarios**:

1. **Given** a session with uncommitted file changes from the agent, **When** the user clicks the primary commit action with a valid commit message, **Then** changes are persisted to the repository, the user sees a success confirmation, and uncommitted change counts update to reflect the new state
2. **Given** a commit cannot be completed (no changes, repository unavailable, permission denied, or validation error), **When** the user attempts to commit, **Then** the action does not claim success and the user sees a specific, recoverable error message with a retry or corrective next step
3. **Given** a successful commit, **When** the user opens the file changes view, **Then** previously listed uncommitted changes are cleared or marked as committed
4. **Given** the user has optional commit settings (branch name, create branch), **When** they choose those options and commit, **Then** the outcome matches their selection and is reflected in confirmation details
5. **Given** an agent run is still in progress, **When** the user commits from the review UI, **Then** the system commits the current working-tree snapshot immediately without blocking or requiring confirmation; any later agent edits appear as new uncommitted changes
6. **Given** "auto commit & push" is disabled, **When** the user commits successfully, **Then** changes are recorded locally only and confirmation does not imply a remote push occurred
7. **Given** "auto commit & push" is enabled, **When** the user commits successfully, **Then** the system pushes to the remote branch after a successful local commit and confirmation reflects both outcomes (or a distinct push failure if local commit succeeded but push did not)

---

### User Story 2 - Invoke Skills via Slash Commands in Chat 

A user types a slash command in the chat input to attach or invoke a skill without leaving the conversation. They discover available skills through autocomplete, see what each skill does before selecting it, and send a message that applies the chosen skill context to the agent.

**Why this priority**: Skills are a core way to steer agent behavior. Making them reachable from chat reduces friction compared to separate settings screens and aligns with how developers expect to work in agent products.

**Independent Test**: Enable at least two skills on a session, type `/` in the chat input, select a skill from the picker, send a message, and verify the agent run reflects the skill attachment. Verify unknown or disabled commands are handled gracefully.

**Acceptance Scenarios**:

1. **Given** a session with one or more enabled skills, **When** the user types `/` in the chat input, **Then** a searchable list of available skills appears with name and short description
2. **Given** the skill picker is open, **When** the user selects a skill, **Then** the input shows the chosen skill (e.g., as a chip or prefixed command) for the pending message only, and the user can add an optional message before sending
3. **Given** the user sends a message with an attached skill via slash command, **When** the agent run starts, **Then** that run uses the selected skill context for that turn only, and the input no longer shows the skill attachment after send
4. **Given** the user attached a skill via slash but has not sent yet, **When** they clear the input or remove the skill chip, **Then** the next send proceeds without that skill unless they attach it again
5. **Given** the user types a partial or unknown slash command, **When** no match exists, **Then** the UI indicates no matches and does not send a broken command silently
6. **Given** keyboard-focused users, **When** navigating the skill picker, **Then** they can move selection and confirm with keyboard alone

---

### User Story 3 - Appropriately Sized Tool Call Blocks (Priority: P2)

A user reads an agent response that includes tool activity alongside prose. Tool calls already collapse by default; the issue is layout width. Collapsed tool call blocks should read as compact chips along the left side of the message—about half the width of the chat content area—not stretched edge-to-edge across the full column. The user expands a block when they need full arguments or output.

**Why this priority**: Full-width collapsed tool rows make the thread feel heavy and compete visually with narrative text even when content is hidden. A narrower default width restores balance and matches how auxiliary actions are shown in comparable agent products.

**Independent Test**: Trigger an agent run with multiple tool calls. Verify each collapsed block is roughly half the message column width (not full width), still shows icon, tool name, and status, and expands to full message-column width with scrollable content area (not unbounded viewport height).

**Acceptance Scenarios**:

1. **Given** an agent message containing one or more tool calls in the collapsed state, **When** the message renders, **Then** each tool call block uses approximately half the width of the chat message content area (target ~50%, acceptable range ~40–60%) and does not span the full column width
2. **Given** a collapsed tool call block, **When** the user has not expanded it, **Then** it remains a single summary row (title, optional subtitle, status) at that reduced width—existing collapse behavior is unchanged
3. **Given** a collapsed tool call row, **When** the user expands it, **Then** the detail panel grows to the full width of the chat message content area (100% of message column) while collapsed width stays ~50%, and overflow content scrolls inside a bounded max-height panel—not unbounded vertical growth
4. **Given** a tool call is still running, **When** it updates, **Then** the summary row reflects in-progress state at the same reduced width without layout jumps
5. **Given** a message mixes text and tool calls, **When** rendered, **Then** prose uses the normal message width while tool blocks stay visually distinct at the narrower width
6. **Given** a narrow viewport (mobile), **When** half-width tool chips would be unreadable, **Then** blocks may use more of the available width while still avoiding unnecessary full-bleed stretching on tablet/desktop sizes

---

### User Story 4 - Unified File Navigation and Review 

A user explores repository files and reviews agent-made changes from a single files experience. They browse the tree, open file contents, and inspect diffs without switching to a separate git-focused panel, because change review is already available inline in chat and within the files area.

**Why this priority**: A dedicated git tab duplicates diff functionality and adds mode-switching overhead. Consolidation simplifies the right-hand workspace and matches the mental model: files for exploration, changes for review.

**Independent Test**: Open the files panel, switch between explorer and changes sub-views, open a file and a diff, and confirm no separate git tab is required to complete review. Verify chat "review" actions open the changes view, not a removed git mode.

**Acceptance Scenarios**:

1. **Given** the session workspace right area, **When** the user opens files, **Then** they can browse the directory tree and open file contents in a viewer within the same panel
2. **Given** the agent has modified files, **When** the user switches to the changes sub-view within files, **Then** they see a list of changed files with status and line statistics and can open per-file diffs
3. **Given** the user clicks a file reference in chat or "review changes" from the review bar, **When** the action completes, **Then** the files panel opens to the relevant file or changes list—not a separate git mode
4. **Given** the prior git-only panel existed, **When** this feature ships, **Then** navigation no longer exposes a redundant git tab on desktop or mobile; diff and change-list capabilities remain reachable through files and inline chat review
5. **Given** no uncommitted changes, **When** the user views the changes sub-view, **Then** an empty state explains there is nothing to review
6. **Given** a user on mobile (<768px) in the session shell, **When** they view bottom navigation, **Then** there is no Git tab—only Files (and other non-git destinations) for exploring the tree, viewing file contents, and reviewing changes

---

### Edge Cases

- What happens when the user invokes a slash command for a skill that was disabled mid-session? (Show clear error; do not start a run with stale skill context.)
- What happens when two skills share similar names? (Disambiguate in the picker with path or description.)
- What happens when a tool call has extremely large output? (Expanded panel scrolls internally; optional "copy" or truncation notice for very large payloads.)
- What happens when commit succeeds on the server but the UI refresh fails? (Show success with manual refresh affordance; avoid duplicate commits on blind retry.)
- What happens when the user commits while the agent is still running and modifying files? (Commit proceeds immediately against the current snapshot; subsequent agent edits show as new uncommitted changes.)
- What happens on mobile when the files panel and chat compete for space? (Files open as full-screen or sheet overlay; back navigation returns to chat without losing selection; there is no separate Git bottom-nav item—use Files → Changes.)
- What happens when the repository has no working tree for the session? (Commit and file views show actionable empty or setup states.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist agent-produced changes when the user confirms a commit from the session review UI, using the user-provided commit message and optional branch options; local commit MUST always occur on success
- **FR-001a**: System MUST push to the remote repository after a successful local commit only when the user/org "auto commit & push" preference is enabled; when disabled, commit MUST NOT push and confirmation MUST NOT imply a push occurred
- **FR-002**: System MUST return explicit success confirmation including enough detail for the user to verify the outcome (e.g., branch name, summary of files affected) without exposing internal implementation identifiers
- **FR-003**: System MUST surface specific, user-actionable error messages when commit fails, and MUST NOT display a generic failure while silently succeeding or returning placeholder success
- **FR-004**: System MUST refresh change indicators across chat review, files changes list, and related summaries within a few seconds of a successful commit
- **FR-004a**: System MUST allow commit while an agent run is active, persisting the working-tree state at commit time without blocking or confirmation dialogs; changes made by the agent after commit MUST appear as new uncommitted changes
- **FR-005**: Chat input MUST support slash-command invocation of skills available to the current session, with discoverable autocomplete when the user types `/`
- **FR-006**: The skill picker MUST show skill name and human-readable description for each option and MUST support filtering as the user continues typing after `/`
- **FR-007**: Messages sent with a slash-selected skill MUST attach that skill only to the corresponding single agent turn; the attachment MUST clear from the chat input after send and MUST NOT persist to subsequent messages unless the user selects it again via slash or session skill settings
- **FR-008**: Collapsed tool call blocks MUST NOT span the full width of the chat message column; they MUST default to approximately half the message content width (~50%, acceptable ~40–60%) while preserving existing collapsed summary presentation
- **FR-009**: When expanded, tool call detail panels MUST use the full width of the chat message content column; when collapsed, width MUST remain ~50% per FR-008. Expanded content MUST use internal scrolling within a bounded max height—not unbounded vertical expansion that consumes the viewport
- **FR-010**: The session workspace MUST provide a single files experience combining directory navigation, file content viewing, and change/diff review
- **FR-011**: System MUST remove the standalone git panel/tab as a separate navigation target on desktop and mobile (including mobile bottom-nav Git destination) while preserving diff and changed-file list capabilities within the files experience and inline chat review
- **FR-012**: Deep links from chat (file chips, review actions) MUST route to the consolidated files experience at the correct file or changes context
- **FR-013**: System MUST preserve accessibility basics for new interactive elements: keyboard operability for slash picker and tool expand/collapse, visible focus states, and appropriate labels for icon-only controls

### Key Entities

- **Skill**: A named, describable capability the user can attach to an agent turn. Attributes include display name, description, availability for the session, and attachment state for a pending message.
- **Slash Command Selection**: The user's in-input choice binding a skill (or command alias) to the next outgoing message before send.
- **Tool Call Summary**: A compact, collapsed-by-default representation of an agent tool invocation in the message thread at ~half message-column width; expandable to full message-column width for argument and result detail in a bounded, scrollable panel.
- **File Change**: A repository file differing from the last committed state, with path, change type, and line add/remove counts; linkable from chat and listed in the files changes sub-view.
- **Commit Request**: User-initiated action to record current uncommitted changes with message, optional target branch, and optional branch-creation flag; produces success or failure outcome consumed by the UI.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 95% of commit attempts with valid input and pending changes complete successfully on first try in acceptance testing (zero placeholder or false-success responses)
- **SC-002**: Users can discover and attach a skill via slash command in under 10 seconds without leaving the chat input
- **SC-003**: In usability review, at least 80% of participants describe collapsed tool call blocks as visually subordinate to message text (not dominating the thread), without expanding
- **SC-004**: On desktop-width chat at default panel size, collapsed tool call blocks measure between 40% and 60% of the message content column width in acceptance testing (not 100%); expanded tool call panels measure 100% of the message content column width
- **SC-005**: Users can browse files, view content, and open a per-file diff without using any removed git-only navigation—verified by completing the file review task flow in under 60 seconds in test scenarios
- **SC-006**: Support or internal bug reports for "Failed to commit changes" with no underlying error drop to zero for scenarios where the repository and permissions are valid

## Assumptions

- Skills available for slash commands are the same set already configured for the session (or organization defaults); authoring new skills is out of scope for this feature.
- Commit operations run against the session's linked repository workspace; users without a linked repository see setup guidance rather than a broken button.
- Remote push after commit is governed by the existing "auto commit & push" user/org preference—not a per-commit checkbox in this feature.
- Inline diff in the chat review bar and the files changes sub-view remain the canonical diff surfaces; this feature removes duplicate git navigation rather than removing diff capability.
- Slash command syntax follows a single leading `/` prefix with skill name or alias; custom argument parsing per skill is limited to optional trailing user message text unless extended in a future release.
- Slash-selected skills are one-shot per message (industry-standard inline composer behavior); persistent skill enablement for a session uses existing session skill configuration, not slash stickiness.
- Mobile layouts may use full-screen overlays for files, but functional requirements are the same as desktop, including removal of the mobile Git bottom-nav tab.
- Existing agent message streaming, markdown rendering, file-reference chips, and collapsed-by-default tool call behavior remain in place; this feature adjusts tool call **width** and related layout, not whether tool calls start collapsed.

## Dependencies

- Session must have a resolvable repository context for file browsing, diffs, and commits.
- Skills must be listable per session (or account) for slash autocomplete population.
- Commit backend must perform real version-control operations; stub or no-op responses are explicitly out of scope.
