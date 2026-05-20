import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import type { GatewayEnv } from "./middleware/auth";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Render Open Forge Gateway API",
    version: "1.0.0",
    description:
      "API gateway for the Render Open Forge platform — agent sessions, repositories, pull requests, organizations, and more.",
  },
  servers: [{ url: "/api", description: "Gateway API" }],
  tags: [
    { name: "Health", description: "Health checks" },
    { name: "Sessions", description: "Agent session management" },
    { name: "Repos", description: "Repository operations" },
    { name: "Pull Requests", description: "Pull request management" },
    { name: "Organizations", description: "Organization and member management" },
    { name: "Inbox", description: "PR event inbox" },
    { name: "Settings", description: "API key management" },
    { name: "Skills", description: "Agent skills" },
    { name: "Mirrors", description: "Repository mirroring" },
    { name: "Invites", description: "User invitations" },
    { name: "Webhooks", description: "Webhook receivers (Forgejo, GitHub, GitLab)" },
    { name: "CI", description: "CI result ingestion" },
    { name: "Models", description: "Available LLM models" },
    { name: "Notifications", description: "User notifications" },
    { name: "Streaming", description: "SSE streaming endpoints" },
    { name: "MCP", description: "Model Context Protocol endpoint" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http" as const,
        scheme: "bearer",
        description: "JWT or API key authentication",
      },
    },
    schemas: {
      OkResponse: {
        type: "object" as const,
        properties: { ok: { type: "boolean" as const, example: true } },
      },
      ErrorResponse: {
        type: "object" as const,
        properties: {
          error: { oneOf: [{ type: "string" as const }, { type: "object" as const }] },
        },
      },
      Skill: {
        type: "object" as const,
        properties: {
          source: { type: "string" as const, enum: ["builtin", "user", "repo"] },
          slug: { type: "string" as const },
        },
      },
    },
  },
  paths: {
    // ---- Health ----
    "/health": {
      get: {
        tags: ["Health"],
        operationId: "getHealth",
        summary: "Health check",
        description: "Returns health status of the gateway and dependent services.",
        responses: {
          "200": {
            description: "Healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object" as const,
                  properties: {
                    status: { type: "string" as const, enum: ["healthy", "degraded"] },
                    checks: {
                      type: "object" as const,
                      additionalProperties: { type: "string" as const, enum: ["ok", "error"] },
                    },
                  },
                },
              },
            },
          },
          "503": { description: "Degraded" },
        },
      },
    },

    // ---- Sessions ----
    "/sessions": {
      post: {
        tags: ["Sessions"],
        operationId: "createSession",
        summary: "Create a new agent session",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["repoPath", "branch"],
                properties: {
                  repoPath: { type: "string" as const, description: "Repository path (owner/repo)" },
                  branch: { type: "string" as const },
                  title: { type: "string" as const },
                  activeSkills: {
                    type: "array" as const,
                    items: { $ref: "#/components/schemas/Skill" },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Session created" },
          "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/sessions/{id}/message": {
      post: {
        tags: ["Sessions"],
        operationId: "sendMessage",
        summary: "Send a message to a session",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["content"],
                properties: {
                  content: { type: "string" as const },
                  modelId: { type: "string" as const },
                  requestId: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Message sent" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/sessions/{id}/reply": {
      post: {
        tags: ["Sessions"],
        operationId: "replyToAgent",
        summary: "Reply to an agent tool call",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["toolCallId", "message"],
                properties: {
                  toolCallId: { type: "string" as const },
                  message: { type: "string" as const },
                  runId: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Reply sent", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
          "400": { description: "Validation error" },
        },
      },
    },
    "/sessions/{id}/stop": {
      post: {
        tags: ["Sessions"],
        operationId: "stopSession",
        summary: "Stop a running session",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: { "200": { description: "Session stopped" } },
      },
    },
    "/sessions/{id}/phase": {
      post: {
        tags: ["Sessions"],
        operationId: "updatePhase",
        summary: "Update session phase",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["phase"],
                properties: { phase: { type: "string" as const } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Phase updated", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
          "400": { description: "Validation error" },
        },
      },
    },
    "/sessions/{id}/config": {
      patch: {
        tags: ["Sessions"],
        operationId: "updateSessionConfig",
        summary: "Update session configuration",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" as const } } },
        },
        responses: { "200": { description: "Config updated" } },
      },
    },
    "/sessions/{id}/skills": {
      get: {
        tags: ["Sessions"],
        operationId: "getSessionSkills",
        summary: "Get skills for a session",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: {
          "200": {
            description: "Skills list",
            content: {
              "application/json": {
                schema: { type: "array" as const, items: { $ref: "#/components/schemas/Skill" } },
              },
            },
          },
        },
      },
      patch: {
        tags: ["Sessions"],
        operationId: "updateSessionSkills",
        summary: "Update active skills for a session",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["skills"],
                properties: {
                  skills: { type: "array" as const, items: { $ref: "#/components/schemas/Skill" } },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Skills updated", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
          "400": { description: "Validation error" },
        },
      },
    },
    "/sessions/{id}/spec": {
      post: {
        tags: ["Sessions"],
        operationId: "handleSpecAction",
        summary: "Approve or reject a spec",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["action", "specId"],
                properties: {
                  action: { type: "string" as const, enum: ["approve", "reject"] },
                  specId: { type: "string" as const },
                  rejectionNote: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Action handled" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/sessions/{id}/auto-title": {
      post: {
        tags: ["Sessions"],
        operationId: "generateAutoTitle",
        summary: "Auto-generate session title",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: { "200": { description: "Title generated" } },
      },
    },
    "/sessions/{id}/ci-events": {
      get: {
        tags: ["Sessions"],
        operationId: "listSessionCiEvents",
        summary: "List CI events for a session",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: { "200": { description: "CI events list" } },
      },
    },
    "/sessions/{id}/review": {
      post: {
        tags: ["Sessions"],
        operationId: "enqueueReviewJob",
        summary: "Enqueue a review job for a session",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                properties: { fixContext: { type: "string" as const } },
              },
            },
          },
        },
        responses: { "200": { description: "Review job enqueued" } },
      },
    },
    "/sessions/{id}": {
      delete: {
        tags: ["Sessions"],
        operationId: "archiveSession",
        summary: "Archive (delete) a session",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: {
          "200": { description: "Session archived", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },

    // ---- Repos ----
    "/repos/import": {
      post: {
        tags: ["Repos"],
        operationId: "importRepo",
        summary: "Import an external repository",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["cloneAddr", "repoName"],
                properties: {
                  cloneAddr: { type: "string" as const, description: "URL to clone from" },
                  repoName: { type: "string" as const },
                  repoOwner: { type: "string" as const },
                  mirror: { type: "boolean" as const },
                  service: { type: "string" as const, enum: ["git", "github"] },
                  authToken: { type: "string" as const },
                  syncConnectionId: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Repository imported" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/repos/{owner}/{repo}/contents/{path}": {
      get: {
        tags: ["Repos"],
        operationId: "getFileContents",
        summary: "Get file contents from a repo",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "path", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "ref", in: "query" as const, schema: { type: "string" as const }, description: "Branch, tag, or SHA" },
        ],
        responses: { "200": { description: "File contents" } },
      },
      put: {
        tags: ["Repos"],
        operationId: "putFileContents",
        summary: "Create or update a file in a repo",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "path", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["content", "message"],
                properties: {
                  content: { type: "string" as const, description: "Base64-encoded file content" },
                  message: { type: "string" as const, description: "Commit message" },
                  sha: { type: "string" as const, description: "Current SHA for updates" },
                  branch: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "File written" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/repos/{owner}/{repo}/agent-config": {
      get: {
        tags: ["Repos"],
        operationId: "getAgentConfig",
        summary: "Get agent configuration for a repo",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: { "200": { description: "Agent config" } },
      },
      post: {
        tags: ["Repos"],
        operationId: "writeAgentConfig",
        summary: "Write agent configuration for a repo",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["content"],
                properties: {
                  content: { type: "string" as const },
                  path: { type: "string" as const },
                  sha: { type: "string" as const },
                  message: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Config written" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/repos/{owner}/{repo}/branch-protection": {
      get: {
        tags: ["Repos"],
        operationId: "listBranchProtections",
        summary: "List branch protection rules",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: { "200": { description: "Branch protection rules" } },
      },
      post: {
        tags: ["Repos"],
        operationId: "setBranchProtection",
        summary: "Create or update a branch protection rule",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["pattern"],
                properties: { pattern: { type: "string" as const } },
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          "200": { description: "Rule created/updated" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/repos/{owner}/{repo}/branch-protection/{branch}": {
      get: {
        tags: ["Repos"],
        operationId: "getBranchProtection",
        summary: "Get branch protection for a specific branch",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "branch", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: { "200": { description: "Branch protection rule" } },
      },
      delete: {
        tags: ["Repos"],
        operationId: "deleteBranchProtection",
        summary: "Delete branch protection for a branch",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "branch", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: {
          "200": { description: "Rule deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },
    "/repos/{owner}/{repo}/secrets": {
      get: {
        tags: ["Repos"],
        operationId: "listRepoSecrets",
        summary: "List repository secrets",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: { "200": { description: "Secrets list" } },
      },
    },
    "/repos/{owner}/{repo}/secrets/{name}": {
      put: {
        tags: ["Repos"],
        operationId: "setRepoSecret",
        summary: "Set a repository secret",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "name", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["value"],
                properties: { value: { type: "string" as const, minLength: 1 } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Secret set", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
          "400": { description: "Validation error" },
        },
      },
      delete: {
        tags: ["Repos"],
        operationId: "deleteRepoSecret",
        summary: "Delete a repository secret",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "name", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: {
          "200": { description: "Secret deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },
    "/repos/{owner}/{repo}/actions/runs/{runId}/test-results": {
      get: {
        tags: ["Repos"],
        operationId: "getTestResults",
        summary: "Get parsed test results for a CI run",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "runId", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: { "200": { description: "Test results" } },
      },
    },
    "/repos/{owner}/{repo}/actions/runs/{runId}/artifacts": {
      get: {
        tags: ["Repos"],
        operationId: "listRunArtifacts",
        summary: "List artifacts for a CI run",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "runId", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: { "200": { description: "Artifacts list" } },
      },
    },
    "/repos/{owner}/{repo}/actions/artifacts/{artifactId}": {
      get: {
        tags: ["Repos"],
        operationId: "downloadArtifact",
        summary: "Download a CI artifact",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "artifactId", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: {
          "200": {
            description: "Artifact binary",
            content: { "application/octet-stream": { schema: { type: "string" as const, format: "binary" } } },
          },
        },
      },
    },
    "/repos/{owner}/{repo}/actions/jobs/{jobId}/logs": {
      get: {
        tags: ["Repos"],
        operationId: "getJobLogs",
        summary: "Get logs for a CI job",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "jobId", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: {
          "200": { description: "Job logs", content: { "text/plain": { schema: { type: "string" as const } } } },
        },
      },
    },

    // ---- Pull Requests ----
    "/pulls/{owner}/{repo}": {
      post: {
        tags: ["Pull Requests"],
        operationId: "createPullRequest",
        summary: "Create a pull request",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["title", "head", "base"],
                properties: {
                  title: { type: "string" as const },
                  body: { type: "string" as const },
                  head: { type: "string" as const, description: "Source branch" },
                  base: { type: "string" as const, description: "Target branch" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Pull request created" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/pulls/{owner}/{repo}/{number}": {
      patch: {
        tags: ["Pull Requests"],
        operationId: "updatePullRequest",
        summary: "Update a pull request",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "number", in: "path" as const, required: true, schema: { type: "integer" as const } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                properties: {
                  state: { type: "string" as const, enum: ["open", "closed"] },
                  title: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Pull request updated" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/pulls/{owner}/{repo}/{number}/merge": {
      post: {
        tags: ["Pull Requests"],
        operationId: "mergePullRequest",
        summary: "Merge a pull request",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "number", in: "path" as const, required: true, schema: { type: "integer" as const } },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                properties: {
                  method: { type: "string" as const, enum: ["merge", "rebase", "squash"] },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Merged", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
          "400": { description: "Validation error" },
        },
      },
    },
    "/pulls/{owner}/{repo}/{number}/comments": {
      get: {
        tags: ["Pull Requests"],
        operationId: "listPrComments",
        summary: "List PR comments",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "number", in: "path" as const, required: true, schema: { type: "integer" as const } },
        ],
        responses: { "200": { description: "Comments list" } },
      },
      post: {
        tags: ["Pull Requests"],
        operationId: "createPrComment",
        summary: "Create a PR comment",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "number", in: "path" as const, required: true, schema: { type: "integer" as const } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["body"],
                properties: {
                  body: { type: "string" as const },
                  path: { type: "string" as const, description: "File path for inline comment" },
                  newLine: { type: "integer" as const },
                  oldLine: { type: "integer" as const },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Comment created" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/pulls/{owner}/{repo}/{number}/comments/{commentId}/resolve": {
      post: {
        tags: ["Pull Requests"],
        operationId: "resolveComment",
        summary: "Resolve or unresolve a PR comment",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "number", in: "path" as const, required: true, schema: { type: "integer" as const } },
          { name: "commentId", in: "path" as const, required: true, schema: { type: "integer" as const } },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                properties: { unresolve: { type: "boolean" as const } },
              },
            },
          },
        },
        responses: { "200": { description: "Comment resolved/unresolved" } },
      },
    },
    "/pulls/{owner}/{repo}/{number}/reviews": {
      get: {
        tags: ["Pull Requests"],
        operationId: "listPrReviews",
        summary: "List PR reviews",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "number", in: "path" as const, required: true, schema: { type: "integer" as const } },
        ],
        responses: { "200": { description: "Reviews list" } },
      },
      post: {
        tags: ["Pull Requests"],
        operationId: "submitPrReview",
        summary: "Submit a PR review",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "number", in: "path" as const, required: true, schema: { type: "integer" as const } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["event"],
                properties: {
                  event: { type: "string" as const, enum: ["approve", "request_changes", "comment"] },
                  body: { type: "string" as const },
                  comments: {
                    type: "array" as const,
                    items: {
                      type: "object" as const,
                      required: ["body", "path"],
                      properties: {
                        body: { type: "string" as const },
                        path: { type: "string" as const },
                        newLine: { type: "integer" as const },
                        oldLine: { type: "integer" as const },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Review submitted" },
          "400": { description: "Validation error" },
        },
      },
    },

    // ---- Organizations ----
    "/orgs": {
      get: {
        tags: ["Organizations"],
        operationId: "listOrgs",
        summary: "List organizations",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Organizations list" } },
      },
      post: {
        tags: ["Organizations"],
        operationId: "createOrg",
        summary: "Create an organization",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["login"],
                properties: {
                  login: { type: "string" as const },
                  fullName: { type: "string" as const },
                  description: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Organization created" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/orgs/{org}": {
      delete: {
        tags: ["Organizations"],
        operationId: "deleteOrg",
        summary: "Delete an organization",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "org", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: {
          "200": { description: "Deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },
    "/orgs/{org}/members": {
      get: {
        tags: ["Organizations"],
        operationId: "listOrgMembers",
        summary: "List organization members",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "org", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: { "200": { description: "Members list" } },
      },
    },
    "/orgs/{org}/members/{username}": {
      put: {
        tags: ["Organizations"],
        operationId: "addOrgMember",
        summary: "Add a member to an organization",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "org", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "username", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: {
          "200": { description: "Member added", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
      delete: {
        tags: ["Organizations"],
        operationId: "removeOrgMember",
        summary: "Remove a member from an organization",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "org", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "username", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: {
          "200": { description: "Member removed", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },
    "/orgs/{org}/secrets": {
      get: {
        tags: ["Organizations"],
        operationId: "listOrgSecrets",
        summary: "List organization secrets",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "org", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: { "200": { description: "Secrets list" } },
      },
      post: {
        tags: ["Organizations"],
        operationId: "setOrgSecret",
        summary: "Create or update an organization secret",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "org", in: "path" as const, required: true, schema: { type: "string" as const } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["name", "value"],
                properties: {
                  name: { type: "string" as const },
                  value: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Secret set", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
          "400": { description: "Validation error" },
        },
      },
    },
    "/orgs/{org}/secrets/{name}": {
      delete: {
        tags: ["Organizations"],
        operationId: "deleteOrgSecret",
        summary: "Delete an organization secret",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "org", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "name", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: {
          "200": { description: "Secret deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },
    "/orgs/{org}/usage": {
      get: {
        tags: ["Organizations"],
        operationId: "getOrgUsage",
        summary: "Get usage metrics",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "org", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: { "200": { description: "Usage data" } },
      },
    },

    // ---- Inbox ----
    "/inbox": {
      get: {
        tags: ["Inbox"],
        operationId: "listInbox",
        summary: "List inbox items",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "filter", in: "query" as const, schema: { type: "string" as const, enum: ["unread", "action_needed", "all"] } },
          { name: "limit", in: "query" as const, schema: { type: "integer" as const, default: 20 } },
          { name: "offset", in: "query" as const, schema: { type: "integer" as const, default: 0 } },
        ],
        responses: { "200": { description: "Inbox items" } },
      },
    },
    "/inbox/count": {
      get: {
        tags: ["Inbox"],
        operationId: "getInboxCount",
        summary: "Get unread inbox count",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Unread count",
            content: {
              "application/json": {
                schema: {
                  type: "object" as const,
                  properties: { unread: { type: "integer" as const } },
                },
              },
            },
          },
        },
      },
    },
    "/inbox/dismiss": {
      post: {
        tags: ["Inbox"],
        operationId: "dismissInbox",
        summary: "Dismiss inbox items",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["eventIds"],
                properties: {
                  eventIds: { type: "array" as const, items: { type: "string" as const }, minItems: 1 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Dismissed", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
          "400": { description: "Validation error" },
        },
      },
    },
    "/inbox/read": {
      post: {
        tags: ["Inbox"],
        operationId: "markInboxRead",
        summary: "Mark inbox items as read",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                properties: {
                  ids: { type: "array" as const, items: { type: "string" as const } },
                  markAll: { type: "boolean" as const },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Marked read", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
          "400": { description: "Validation error" },
        },
      },
    },

    // ---- Settings ----
    "/settings/api-keys": {
      get: {
        tags: ["Settings"],
        operationId: "listApiKeys",
        summary: "List API keys",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "API keys list" } },
      },
      post: {
        tags: ["Settings"],
        operationId: "createOrUpdateApiKey",
        summary: "Create or update an API key",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["provider", "apiKey"],
                properties: {
                  provider: { type: "string" as const, enum: ["anthropic", "openai"] },
                  scope: { type: "string" as const, enum: ["platform", "user"], default: "user" },
                  apiKey: { type: "string" as const, minLength: 1 },
                  label: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Key created/updated" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/settings/api-keys/{id}": {
      patch: {
        tags: ["Settings"],
        operationId: "updateApiKey",
        summary: "Update an API key",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                properties: {
                  label: { type: "string" as const },
                  apiKey: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Key updated", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
          "400": { description: "Validation error" },
        },
      },
      delete: {
        tags: ["Settings"],
        operationId: "deleteApiKey",
        summary: "Delete an API key",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: {
          "200": { description: "Key deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },

    // ---- Skills ----
    "/skills": {
      get: {
        tags: ["Skills"],
        operationId: "listSkills",
        summary: "List available skills",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "repoPath", in: "query" as const, schema: { type: "string" as const }, description: "Include repo-specific skills" },
        ],
        responses: { "200": { description: "Skills list" } },
      },
    },
    "/skills/install": {
      post: {
        tags: ["Skills"],
        operationId: "installSkill",
        summary: "Install a skill from a URL",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["url"],
                properties: {
                  url: { type: "string" as const, minLength: 1 },
                  name: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Skill installed" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/skills/sync": {
      post: {
        tags: ["Skills"],
        operationId: "syncSkills",
        summary: "Synchronize skills from remote sources",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Synced", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },
    "/skills/repo/{owner}/{repo}": {
      get: {
        tags: ["Skills"],
        operationId: "listRepoSkills",
        summary: "List skills for a specific repo",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "owner", in: "path" as const, required: true, schema: { type: "string" as const } },
          { name: "repo", in: "path" as const, required: true, schema: { type: "string" as const } },
        ],
        responses: { "200": { description: "Repo skills" } },
      },
    },

    // ---- Mirrors ----
    "/mirrors": {
      get: {
        tags: ["Mirrors"],
        operationId: "listMirrors",
        summary: "List mirrors",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query" as const, schema: { type: "integer" as const, default: 20 } },
          { name: "offset", in: "query" as const, schema: { type: "integer" as const, default: 0 } },
        ],
        responses: { "200": { description: "Mirrors list" } },
      },
      post: {
        tags: ["Mirrors"],
        operationId: "createMirror",
        summary: "Create a mirror",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["syncConnectionId", "localRepoPath", "remoteRepoUrl", "direction"],
                properties: {
                  syncConnectionId: { type: "string" as const },
                  localRepoPath: { type: "string" as const },
                  remoteRepoUrl: { type: "string" as const },
                  direction: { type: "string" as const, enum: ["pull", "push", "bidirectional"] },
                  remoteToken: { type: "string" as const },
                  sessionId: { type: "string" as const },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Mirror created" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/mirrors/{id}/sync": {
      post: {
        tags: ["Mirrors"],
        operationId: "syncMirror",
        summary: "Trigger mirror sync",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: {
          "200": { description: "Sync triggered", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },
    "/mirrors/{id}": {
      delete: {
        tags: ["Mirrors"],
        operationId: "deleteMirror",
        summary: "Delete a mirror",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: {
          "200": { description: "Mirror deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },
    "/mirrors/{id}/resolve": {
      post: {
        tags: ["Mirrors"],
        operationId: "resolveMirrorConflict",
        summary: "Resolve a mirror conflict",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                properties: {
                  strategy: { type: "string" as const, enum: ["force-push", "manual", "rebase"] },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Conflict resolved" } },
      },
    },

    // ---- Invites ----
    "/invites": {
      get: {
        tags: ["Invites"],
        operationId: "listInvites",
        summary: "List invitations",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Invites list" } },
      },
      post: {
        tags: ["Invites"],
        operationId: "createInvite",
        summary: "Create an invitation",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["username"],
                properties: {
                  username: { type: "string" as const, minLength: 1 },
                  email: { type: "string" as const, format: "email" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Invite created" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/invites/accept": {
      post: {
        tags: ["Invites"],
        operationId: "acceptInvite",
        summary: "Accept an invitation",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["token", "password"],
                properties: {
                  token: { type: "string" as const, minLength: 1 },
                  password: { type: "string" as const, minLength: 1 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Invite accepted" },
          "400": { description: "Validation error" },
        },
      },
    },

    // ---- Webhooks ----
    "/webhooks/github": {
      post: {
        tags: ["Webhooks"],
        operationId: "handleGithubWebhook",
        summary: "Receive GitHub webhook",
        parameters: [
          { name: "x-hub-signature-256", in: "header" as const, schema: { type: "string" as const } },
          { name: "x-github-event", in: "header" as const, schema: { type: "string" as const } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" as const } } },
        },
        responses: {
          "200": { description: "Webhook processed", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
          "401": { description: "Invalid signature" },
          "500": { description: "Processing error" },
        },
      },
    },
    // ---- CI ----
    "/ci/results": {
      post: {
        tags: ["CI"],
        operationId: "submitCiResults",
        summary: "Submit CI run results",
        description: "Receives CI results from runners. Authenticated via x-ci-secret header.",
        parameters: [
          { name: "x-ci-secret", in: "header" as const, required: true, schema: { type: "string" as const } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                required: ["ciEventId", "workflowName", "status", "jobs"],
                properties: {
                  ciEventId: { type: "string" as const, minLength: 1 },
                  workflowName: { type: "string" as const },
                  status: { type: "string" as const, enum: ["success", "failure", "error"] },
                  jobs: {
                    type: "array" as const,
                    items: {
                      type: "object" as const,
                      properties: {
                        name: { type: "string" as const },
                        status: { type: "string" as const },
                        conclusion: { type: "string" as const },
                      },
                    },
                  },
                  testResults: {
                    type: "object" as const,
                    properties: {
                      junitXml: { type: "string" as const },
                      tapOutput: { type: "string" as const },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Results accepted", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
          "400": { description: "Validation error" },
        },
      },
    },

    // ---- Models ----
    "/models": {
      get: {
        tags: ["Models"],
        operationId: "listModels",
        summary: "List available LLM models",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Models list" } },
      },
    },

    // ---- Notifications ----
    "/notifications": {
      get: {
        tags: ["Notifications"],
        operationId: "listNotifications",
        summary: "List notifications",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query" as const, schema: { type: "integer" as const, default: 20 } },
          { name: "offset", in: "query" as const, schema: { type: "integer" as const, default: 0 } },
        ],
        responses: { "200": { description: "Notifications list" } },
      },
    },

    // ---- Streaming ----
    "/stream/sessions/{id}": {
      get: {
        tags: ["Streaming"],
        operationId: "streamSessionEvents",
        summary: "Stream real-time agent run events (SSE)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }],
        responses: {
          "200": {
            description: "SSE event stream",
            content: { "text/event-stream": { schema: { type: "string" as const } } },
          },
          "404": { description: "Session not found" },
        },
      },
    },
    "/stream/inbox": {
      get: {
        tags: ["Streaming"],
        operationId: "streamInboxCount",
        summary: "Stream inbox unread count (SSE)",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "SSE event stream with count updates",
            content: { "text/event-stream": { schema: { type: "string" as const } } },
          },
        },
      },
    },

    // ---- MCP ----
    "/mcp": {
      post: {
        tags: ["MCP"],
        operationId: "mcpRequest",
        summary: "Model Context Protocol endpoint",
        description: "Handles MCP Streamable HTTP transport requests. Supports session management via mcp-session-id header.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "mcp-session-id", in: "header" as const, schema: { type: "string" as const }, description: "MCP session ID for resuming" },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" as const } } },
        },
        responses: {
          "200": { description: "MCP response" },
        },
      },
    },
  },
} as const;

export type OpenAPISpec = typeof spec;

export const docsRoutes = new Hono<GatewayEnv>();

docsRoutes.get("/", (c) => {
  return c.json(spec);
});

docsRoutes.get("/ui", swaggerUI({ url: "/api/docs" }));
