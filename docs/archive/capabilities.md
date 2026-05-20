# Capabilities

## Agent tools

The agent includes file I/O, pull request, review, and CI tools:

| Tool | Description |
|---|---|
| `bash` | Shell execution in the sandbox |
| `read_file`, `write_file`, `edit` | Filesystem operations |
| `glob`, `grep` | Code search |
| `git` | Git operations (clone, commit, push, branch, rebase) with automatic forge authentication |
| `create_pull_request` | Open PRs against the forge |
| `merge_pr`, `close_pr` | PR lifecycle management |
| `review_pr`, `approve_pr` | Submit code reviews with inline comments |
| `add_pr_comment`, `resolve_comment` | PR discussion and thread resolution |
| `request_review` | Request reviewers on a PR |
| `pull_request_diff` | Fetch unified diffs for review |
| `read_build_log` | Diagnose CI failures from GitHub Actions job logs |
| `create_repo` | Provision new repositories on the forge |
| `submit_spec` | Structured technical specifications (goal, approach, files, risks, verification plan) |
| `web_fetch` | HTTP requests for documentation/APIs |
| `task` | Subagents: focused sub-runs with a reduced tool set and 20-step budget |
| `todo_write` | Structured task tracking across tool steps |
| `ask_user_question` | Synchronous user clarification. Worker blocks on Redis BLPOP and resumes when the user answers |

## Skills

See [architecture.md](architecture.md#skill-system) for the resolution model and design rationale.

Built-in skills: Implementation, Verification, PR Delivery, Code Quality, Spec-first, Thorough Understanding, React/Next.js Best Practices, Postgres Optimization, Refactoring.

Skill files use YAML frontmatter (`name`, `description`, `default`) with a markdown body injected into the agent's system prompt. Framework builtins (React, Next.js) are automatically synced to the user's Forgejo skills repo.

## Repository mirroring and external sync

Connect GitHub and GitLab accounts via OAuth, browse remote repos, and import them into Forgejo. Imported repos can be linked as mirrors:

- **Pull mirrors** keep Forgejo in sync with an external origin (default: every 8 hours + on-demand)
- **Push mirrors** push Forgejo commits back to GitHub/GitLab on every push
- **Bidirectional** mirrors combine both
- Conflict resolution strategies (force-push, rebase, manual) are configurable per-mirror
- A background cron scheduler syncs all active mirrors automatically

This supports incremental adoption: mirror GitHub repos in, ship PRs internally, and push changes back if needed.

## Webhook-driven CI reactions

GitHub (and other forge) webhooks drive CI awareness and the agent:

- **CI failure → auto-fix:** when a run reports failure—via **`POST /api/ci/results`** and/or GitHub **`workflow_run`** events—on a session's branch, the agent can be enqueued with step output context (capped at configurable `maxCiFixAttempts`, default 3).
- **CI success + auto-merge:** if a session has `autoMerge` enabled and CI passes (`workflow_run` **completed** successfully), the forge merges the open PR automatically.
- **PR events:** new PRs, merges, and closures update session state; review comments trigger agent runs to address feedback
- **Push tracking:** file change counts roll up to the session for activity dashboards

## Web UI

- **Repositories:** file tree, blob viewer with syntax highlighting, inline editor, commit history and diffs
- **Pull requests:** create, review, merge/close; per-repo and global dashboard with filtering
- **Actions:** GitHub Actions run logs and test results
- **Sessions:** chat with SSE streaming, skill and model selection, spec review
- **Settings:** skill management, API key management, GitHub/GitLab connections, mirrors, preferences (default model)
- **Organizations:** member management, usage dashboards (tokens, sandbox minutes, storage)
- **Search:** cross-repo code search
- **Activity:** global activity feed

## Persistence and streaming

- All state in Postgres: sessions, chats, messages, runs, specs, CI events, mirrors, sync connections, skill cache, verification results, PR events, usage events
- Real-time SSE streaming backed by Redis Pub/Sub for live events and a capped Redis Stream for replay
- Page reload mid-run rebuilds the UI from persisted state (see [architecture.md](architecture.md#message-persistence))
- Run cancellation via an abort flag polled on every LLM step

## Organization quotas and usage tracking

Built-in per-org resource limits (configurable, no external billing service):

| Resource | Default limit |
|---|---|
| Model tokens | 10,000,000 |
| Sandbox minutes | 1,000 |
| Storage | 50 GB |
| Concurrent sessions | 5 |

Usage is tracked per-user via `usage_events` in Postgres (input/output/cached tokens, tool call counts, provider, model) and surfaced through the org usage API.

## Operations

- At-least-once job delivery via Redis Streams with periodic `XPENDING` + `XCLAIM` reclaim of stale entries; dead-letter handling after max retries
- Worker heartbeat key in Redis; `/api/health/workers` exposes liveness
- Bounded per-worker concurrency (`MAX_CONCURRENT_RUNS`, default 5)
- Sandbox snapshots/restore with disk-pressure-aware garbage collection
- Path-jailed sandbox workspaces, bearer-secret authentication, runs as a non-root user
- Graceful drain on SIGTERM/SIGINT. Worker finishes active runs before exiting
