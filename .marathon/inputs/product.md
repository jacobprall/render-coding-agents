# Product

## Vision

An open-source, self-hosted cloud coding agents platform — deployed on Render primitives — that matches Cursor's cloud agent capabilities while giving teams full ownership and control.

## Who It's For

- **Engineering teams** running self-hosted infrastructure on Render who want autonomous AI coding agents without vendor lock-in.
- **Platform engineers** who need to configure, monitor, and govern AI agents operating in their repositories.
- **Solo developers and small teams** who want Cursor-quality agent automation without per-seat SaaS pricing.

## Core Value Propositions

- **Self-hosted on Render**: Deploy the entire platform with a single `render.yaml` blueprint — no external orchestration required.
- **Full agent lifecycle**: Agents clone repos, create branches, write code, run tests, open PRs, and respond to review feedback autonomously.
- **Multi-repo coordination**: Agents can work across frontend, backend, and infrastructure repos in a single task.
- **Event-driven automations**: Trigger agents from GitHub/GitLab events, Slack messages, Linear issues, schedules, or webhooks.
- **Integrations-first**: Slack notifications, Linear status sync, and bidirectional communication out of the box.

## Key Differentiators

- **Blueprint-native**: First-class `render.yaml` support — the platform itself and dev environments are defined as Render Blueprints.
- **Open source**: Full source visibility, community contributions, no vendor lock-in.
- **Observability built-in**: Real-time agent traces, cost tracking, and tool usage dashboards — not bolted on.
- **Spec-driven development**: Built-in spec → plan → tasks → implement → review pipeline for autonomous multi-sprint execution.

## Product Principles

- **Data density over chrome** — show information, not decoration. Tables over cards where appropriate.
- **Keyboard-first** — every action reachable without a mouse.
- **Agents are observable** — never hide what an agent is doing. Stream logs, traces, and tool calls in real time.
- **Fail loud, fail bounded** — agents surface errors immediately and stop after bounded retries rather than spiraling.
- **Convention over configuration** — sensible defaults for everything, escape hatches for power users.
