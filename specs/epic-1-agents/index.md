## Objective: Match Cursor on Cloud agents (where it counts)

**Principles:**
- Open source self-hosted on Render primitives
- First-class blueprint support
- Clean and minimalist. Feature-rich and production-grade. Foundational and extendible.
- First-class concerns: Observability, cost efficiency, stability and reliability



Epic 1: Agent powers
  - Milestone 1: Parallel agents
      - Each agent operates in its own isolated VM with separate git worktrees
      - Agents don't interfere with each other — each has isolated files and changes
      - Git worktrees
      - Multi-Repo Support
        - Agents work across multiple repositories (frontend, backend, infrastructure, shared libs) in a single task
        - Make coordinated changes and open PRs across repos
        - Configure multi-repo environments that persist for future runs


  - Milestone 2: Dev environments
    - Agents can provision and deploy development environments to work against


    - Secrets Management
      - Three types of secrets:
      - **Environment Variables**: Visible to agent
      - **Runtime Secrets**: Redacted from agent view but visible in terminal output
      - **Build Secrets**: Only available during Docker image builds (scoped to build step)
    - Environment Configuration
      - Three methods for configuring cloud agent environments:
        - **Agent-driven setup (recommended)**: Let the agent configure its own environment from the dashboard. Create a VM snapshot after for reuse.
        - **Dockerfile in `.coding-agents/environment.json`**: Manual configuration with build secrets, layer caching (70% faster cached builds), and optional Cursor-generated Dockerfiles (Enterprise beta).
        - **Saved snapshots**: Team or personal snapshots that include installed packages, system dependencies, and optionally `.env.local` files.


  
<-- Str

### Track 1: Agent Powers — Gaps

#### Milestone 1: Parallel Agents

| Requirement | Current State | Gap Severity |
|-------------|---------------|--------------|
| VM isolation per agent | Single shared Docker container; all sessions share one sandbox instance and disk volume. Isolation is per-session directory, not per-process or per-VM. | **CRITICAL** |
| Git worktrees | Not implemented. Agents clone into flat directories under `/workspace/{sessionId}`. No worktree management, no shared object store. | **HIGH** |
| Agents don't interfere | Directory-scoped path validation exists (`path-security.ts`), but agents share process space, network, and filesystem namespace inside one container. | **HIGH** |
| Multi-repo support | Sessions bind to a single `repoPath`. No multi-repo orchestration, no cross-repo PR coordination, no multi-repo environment config. | **HIGH** |
| Subagent parallelism | Subagents run in-process via nested `agentLoop()` calls — not as separate queued jobs in separate VMs. They share the parent's sandbox session and event stream. | **MEDIUM** |

**Key architectural decisions needed:**
- VM provisioning strategy: ephemeral Render Docker services via API? Firecracker microVMs? Per-session containers?
- Worktree vs full clone: shared git object store with worktrees, or independent clones per agent?
- Multi-repo: single sandbox with multiple clones, or one VM per repo?

#### Milestone 2: Dev Environments

| Requirement | Current State | Gap Severity |
|-------------|---------------|--------------|
| Agent-driven provisioning | `infra_specs`/`infra_resources` schema exists (desired-vs-actual model for Render services). No provisioning workflow or agent tooling to create/manage services. | **HIGH** |
| Deploy dev environments | No preview environment management. Render API key is accepted as env var but no automation uses it for service creation. | **HIGH** |
| Persistent dev env config | No `.coding-agents/environment.json` support. No saved snapshots beyond workspace-level `snapshot/restore`. | **HIGH** |


#### Functional Requirements (Cross-Cutting)

| Requirement | Current State | Gap Severity |
|-------------|---------------|--------------|
| **VM Isolation** | Single shared container. | **CRITICAL** |
| **Network Egress Controls** | No network policy enforcement. Sandbox has unrestricted outbound access. | **HIGH** |
| **Internet Access (configurable)** | Always enabled, no toggle. | **MEDIUM** |
| **MCP Security (creds never in VM)** | MCP endpoint on gateway uses bearer auth. Encryption key for secrets at rest. But no VM-boundary credential isolation since there are no VMs. | **MEDIUM** |
| **`.cursor/rules/` support** | Skills system reads from repos. `.cursor/rules/` loading exists via skill sync. | **LOW** — Mostly done |
| **`AGENTS.md` support** | Not explicitly parsed as a separate format. | **LOW** |
| **Speckit pre-loaded** | Speckit skills exist in `.cursor/skills/speckit-*`. Agent can load them. | **LOW** — Done |
| **3-tier secrets** | Single tier: encrypted at rest, decrypted for agent use. No differentiation between env vars (visible), runtime secrets (redacted), and build secrets (Docker-only). | **HIGH** |
| **Environment config: agent-driven** | No agent tool for self-configuring its environment or creating snapshots. | **HIGH** |
| **Environment config: Dockerfile** | Single static `Dockerfile` for sandbox. No per-repo environment customization. | **HIGH** |
| **Environment config: saved snapshots** | `snapshot/restore` exists for workspace file state. No full VM/environment snapshots (packages, system deps). | **HIGH** |



---


**Key architectural decisions needed:**
- Desktop approach: headless Chrome + Playwright? Full VNC desktop? noVNC for user access?
- Screenshot/video capture pipeline and storage
- Agent tool interface for browser interaction (coordinate-based vs accessibility-tree)
- VM lifecycle management (creation, snapshotting, teardown, cost)
- Credential isolation boundary (what lives in VM vs. what lives in platform)


etch -->
  - Milestone 3: Computer user
    - Each cloud agent has its own desktop environment. They start dev servers, open apps in a browser, click through UI flows. Agents can control mouse and keyboard to interact with software. Verify changes work visually before pushing PRs
    - Users can take remote desktop control to test software without checking out branches locally. Hand control back to the agent at any time to let it continue working

  
  - Milestone 4: Artifacts & Demos
    - Agents produce screenshots, videos, and log references demonstrating their work
    - Artifacts attach to PRs for quick validation without checking out branches
    - Uses long, unguessable public URLs (GitHub proxy requirement)



Functional Requirements
    - Security & Isolation
      - **VM Isolation**: Each agent runs in its own isolated VM/sandbox
      - **Network Egress Controls**: Admins restrict domains at user, team, and environment levels
      - **Internet Access**: Enabled by default but configurable


    - Rules & Context
      - Agents read `.cursor/rules/` markdown files for project-specific instructions
      - Support for `AGENTS.md` format (open standard for guiding coding agents)
      - Cloud agents have access to repo-level skills, commands, and rules
      - Comes pre-loaded (optional) with GitHub speckit and instructions for agents to use speckit to autonomously take idea/request -> specify -> clarify -> plan -> tasks -> Implement -> review -> push
      - With optional check gates
#### Milestone 3: Computer User

| Requirement | Current State | Gap Severity |
|-------------|---------------|--------------|
| Desktop environment per agent | No VNC, no X11, no desktop environment in sandbox. Agent can run shell commands only. | **CRITICAL** |
| Browser automation | No Playwright/Puppeteer/browser automation tooling. No screenshot capture. | **CRITICAL** |
| Mouse/keyboard control | Not implemented. | **CRITICAL** |
| Visual verification before PR | Not possible today. | **CRITICAL** |
| Remote desktop handoff | Not implemented (stretch goal). | **CRITICAL** |

#### Milestone 4: Artifacts & Demos

| Requirement | Current State | Gap Severity |
|-------------|---------------|--------------|
| Screenshot/video capture | No capture tooling or storage. | **HIGH** |
| Attach artifacts to PRs | No artifact system. PR creation exists but no attachment workflow. | **HIGH** |
| Unguessable public URLs | No artifact URL generation or proxy service. | **HIGH** |
| Log references | Observability events exist but no public-facing log permalink system. | **MEDIUM** |


<-- End Stretch --->

