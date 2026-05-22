## Objective: Match Cursor on Cloud agents (where it counts)

**Principles:**
- Open source self-hosted on Render primitives
- First-class blueprint support
- Clean and minimalist. Feature-rich and production-grade. Foundational and extendible.
- First-class concerns: Observability, cost efficiency, stability and reliability

Track 1: Agent powers
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
  - Milestone 3: Computer user
    - Each cloud agent has its own desktop environment. They start dev servers, open apps in a browser, click through UI flows. Agents can control mouse and keyboard to interact with software. Verify changes work visually before pushing PRs
    - Stretch: Users can take remote desktop control to test software without checking out branches locally. Hand control back to the agent at any time to let it continue working
  - Milestone 4: Artifacts & Demos
    - Agents produce screenshots, videos, and log references demonstrating their work
    - Artifacts attach to PRs for quick validation without checking out branches
    - Uses long, unguessable public URLs (GitHub proxy requirement)
  - Fucntional Requirements
    - Security & Isolation
      - **VM Isolation**: Each agent runs in its own isolated VM/sandbox
      - **Network Egress Controls**: Admins restrict domains at user, team, and environment levels
      - **Internet Access**: Enabled by default but configurable
      - **MCP Security**: HTTP transport preferred (credentials never in VM); sensitive fields encrypted and cannot be read back
    - Rules & Context
      - Agents read `.cursor/rules/` markdown files for project-specific instructions
      - Support for `AGENTS.md` format (open standard for guiding coding agents)
      - Cloud agents have access to repo-level skills, commands, and rules
      - Comes pre-loaded (optional) with GitHub speckit and instructions for agents to use speckit to autonomously take idea/request -> specify -> clarify -> plan -> tasks -> Implement -> review -> push
      - With optional check gates
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





Track 2: Automations 
  - Run agents on schedules (preset or cron) or event triggers
  - Triggers: GitHub/GitLab events (PR opened, pushed, merged, commented, CI completion), Slack messages, Linear events, webhooks
  - Include a memory tool for learning from past runs
  - Create via Agents Window, cursor.com/automations, or Cursor Marketplace
  - Choose trigger → write prompt → select tools → specify repos
  - BugBoy out of the box (equivalent to Cursor agents bugbot)


Track 3: Integrations
  - Slack integration
    - Receive notifications when agents complete
    - Trigger automations on new messages in connected channels
  - Linear integration
    - Delegate issues with command
    - Agents show real-time status in Linear
    - Create PRs automatically from Linear issues

Track 4: Interfaces
  - Web (cursor.com/agents)
    - Full browser-based management interface for cloud agents
    - Kanban-style view for monitoring agent progress
    - Works on any device including mobile
    - Native-feeling mobile experience for monitoring agents on the go
  - REST API at `/v1/agents` for programmatic agent launching and management
    - Basic or Bearer authentication
    - Create, list, send follow-up messages, cancel agents



