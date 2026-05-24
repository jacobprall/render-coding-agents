# UI Contracts: Agent Chat Interface Updates

## Chat Input — Slash Skill Picker

| Trigger | Behavior |
|---------|----------|
| User types `/` at start or after whitespace | Open anchored picker above input |
| Continue typing | Filter skills by name/slug (case-insensitive) |
| ↑ / ↓ | Move selection |
| Enter | Attach selected skill as chip; keep focus in textarea |
| Esc | Close picker without attach |
| Backspace on empty input with chip | Remove chip |
| Send | POST message with `turnSkillRefs`; clear chip |

**Empty filter matches**: Show "No matching skills".

**Chip display**: Skill slug or display name + remove (×) control.

## Tool Call Block (`ToolLayout`)

| State | Width | Height |
|-------|-------|--------|
| Collapsed | ~50% of message content column (`max-w-[50%]`, left-aligned) | Single summary row |
| Expanded | 100% of message content column | Body `max-h-128`, `overflow-auto` |

**No** full-viewport height expansion.

## Session Workspace Tabs (desktop)

| Tab | Visible |
|-----|---------|
| Chat | yes |
| Files | yes |
| Git | **removed** |

**Review bar** "Review" → switches to Files tab, Changes sub-view.

## Mobile Bottom Nav

| Item | Visible |
|------|---------|
| Sessions | yes |
| Chat | yes |
| Files | yes |
| Git | **removed** |

## Files Panel

| Sub-tab | Content |
|---------|---------|
| Explorer | File tree + preview (unchanged) |
| Changes | Changed files list + per-file diff (replaces git tab purpose) |

**Prop addition**: `initialSubView?: "tree" | "changes"` for deep links from review bar.

## Commit Feedback

| Outcome | UI |
|---------|-----|
| Success (local only) | Toast: committed on `<branch>`; no push wording |
| Success + pushed | Toast: committed and pushed |
| Push failed after commit | Toast/warning: committed locally; push failed: `<reason>` |
| Failure | Toast: specific error; retry enabled |
