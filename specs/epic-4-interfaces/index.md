## Objective: Match Cursor on Cloud agents (where it counts)

**Principles:**
- Open source self-hosted on Render primitives
- First-class blueprint support
- Clean and minimalist. Feature-rich and production-grade. Foundational and extendible.
- First-class concerns: Observability, cost efficiency, stability and reliability

Track 4: Interfaces
  - Web (cursor.com/agents)
    - Full browser-based management interface for cloud agents
    - Kanban-style view for monitoring agent progress
    - Works on any device including mobile
    - Native-feeling mobile experience for monitoring agents on the go
  - REST API at `/v1/agents` for programmatic agent launching and management
    - Basic or Bearer authentication
    - Create, list, send follow-up messages, cancel agents


### Track 4: Interfaces — Gaps

| Requirement | Current State | Gap Severity |
|-------------|---------------|--------------|
| **Web UI (management)** | Next.js app with sessions list, chat UI, repo browser, settings, observability dashboard. Functional but not Kanban-style. | **MEDIUM** |
| **Kanban view** | Not implemented. Sessions list is a flat table/card view. | **MEDIUM** |
| **Mobile experience** | No mobile-specific optimization. Responsive but not native-feeling. | **MEDIUM** |
| **REST API `/v1/agents`** | Gateway exposes full session CRUD at `/api/sessions/*`. Functionally equivalent but not versioned under `/v1/agents`. | **LOW** |
| **Basic or Bearer auth** | Bearer auth via `GATEWAY_API_SECRET` or per-user API keys (hashed, stored in `api_keys` table). | **LOW** — Done |
| **Create, list, send messages, cancel** | All implemented via gateway REST + MCP. | **DONE** |
| **CLI** | `rca` CLI with config, chat, list, stop, pause, resume, stream. | **DONE** |
| **MCP integration** | MCP Streamable HTTP at `/mcp` with 30+ tools. Works with Claude Desktop, Cursor. | **DONE** |

