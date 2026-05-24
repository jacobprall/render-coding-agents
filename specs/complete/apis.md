## Objective: Match Cursor on Cloud agents (where it counts)

**Principles:**
- Open source self-hosted on Render primitives
- First-class blueprint support
- Clean and minimalist. Feature-rich and production-grade. Foundational and extendible.
- First-class concerns: Observability, cost efficiency, stability and reliability

Track 4: Interfaces
REST API at `/v1/agents` for programmatic agent launching and management
- Basic or Bearer authentication
- Create, list, send follow-up messages, cancel agents


### Track 4: Interfaces — Gaps

| Requirement | Current State | Gap Severity |
|-------------|---------------|--------------|
| **REST API `/v1/agents`** | Gateway exposes full session CRUD at `/api/sessions/*`. Functionally equivalent but not versioned under `/v1/agents`. | **LOW** |


