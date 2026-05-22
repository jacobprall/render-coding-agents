#!/usr/bin/env node
/**
 * Render Coding Agents CLI — interact with the gateway from the terminal.
 *
 * Usage:
 *   rca config set apiUrl http://localhost:4100
 *   rca config set apiKey sk-...
 *   rca chat "Fix the failing tests in src/utils.ts"
 *   rca list
 *   rca stop <session-id>
 *   rca pause <session-id>
 *   rca resume <session-id>
 */

import { Command } from "commander";
import { loadConfig, saveConfig } from "./config";
import {
  createSession,
  sendMessage,
  listSessions,
  stopSession,
  pauseSession,
  resumeSession,
  streamSession,
} from "./api";
import type { StreamEvent } from "./api";

const program = new Command();

program
  .name("rca")
  .description("Render Coding Agents CLI — interact with agent sessions from the terminal")
  .version("0.1.0");

// ─────────────────────────────────────────────────────────────────────────────
// Event rendering — maps v2 stream event types to terminal output
// ─────────────────────────────────────────────────────────────────────────────

function renderStreamEvent(event: StreamEvent, controller: AbortController): void {
  const data = (event.data ?? {}) as Record<string, unknown>;

  switch (event.type) {
    // Agent streaming tokens
    case "agent:message": {
      const text = String(data.text ?? data.token ?? data.content ?? "");
      if (text) process.stdout.write(text);
      break;
    }

    // Tool invocations
    case "agent:tool_call": {
      const name = String(data.toolName ?? data.name ?? "unknown");
      const args = data.args ?? data.input ?? "";
      const preview = typeof args === "string" ? args.slice(0, 100) : JSON.stringify(args).slice(0, 100);
      console.log(`\n[tool] ${name}(${preview})`);
      break;
    }
    case "agent:tool_result": {
      const result = String(data.result ?? data.output ?? "").slice(0, 200);
      if (result) console.log(`[result] ${result}`);
      break;
    }

    // Terminal events
    case "session:completed":
      console.log("\n\n--- Session completed ---");
      controller.abort();
      break;
    case "session:failed":
      console.error(`\n\n--- Session failed ---${data.message ? ` ${data.message}` : ""}`);
      controller.abort();
      break;
    case "session:aborted":
      console.log("\n\n--- Session aborted ---");
      controller.abort();
      break;

    // Phase/step events
    case "session:phase_changed":
      console.log(`\n[phase] ${data.phase ?? "unknown"}`);
      break;
    case "step:started":
      break;
    case "step:completed":
      break;
    case "step:failed":
      console.error(`\n[step:failed] ${data.error ?? data.message ?? ""}`);
      break;

    // Planner events
    case "planner:started":
      console.log("\n[planner] Planning...");
      break;
    case "planner:thinking": {
      const thought = String(data.text ?? data.content ?? "");
      if (thought) process.stdout.write(thought);
      break;
    }
    case "planner:completed":
      console.log("\n[planner] Plan complete.");
      break;
    case "plan:generated":
      console.log("\n[plan] Plan generated.");
      break;

    // Agent lifecycle
    case "agent:heartbeat":
      break;
    case "agent:file_changed":
      if (process.env.RCA_DEBUG) {
        console.log(`\n[file] ${data.path ?? ""} (${data.action ?? "changed"})`);
      }
      break;
    case "agent:ask_user":
      console.log(`\n[question] ${data.question ?? data.message ?? JSON.stringify(data)}`);
      break;
    case "agent:verification":
      if (process.env.RCA_DEBUG) {
        console.log(`\n[verify] ${JSON.stringify(data).slice(0, 200)}`);
      }
      break;

    // User events (echoed back)
    case "user:message":
    case "user:interrupt":
    case "user:plan_approved":
    case "user:plan_rejected":
      break;

    // Ping keepalive
    case "ping":
      break;

    // No active run (edge case from server)
    case "no_active_run":
      console.log("No active run for this session.");
      controller.abort();
      break;

    // Error from stream
    case "error": {
      const msg = data.message ?? data.error ?? JSON.stringify(data);
      console.error(`\n[error] ${msg}`);
      if (data.retryable !== true) controller.abort();
      break;
    }

    default:
      if (process.env.RCA_DEBUG) {
        console.log(`[${event.type}]`, JSON.stringify(data).slice(0, 200));
      }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// rca config
// ─────────────────────────────────────────────────────────────────────────────

const configCmd = program.command("config").description("Manage CLI configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a config value (apiUrl, apiKey, defaultModel)")
  .action((key: string, value: string) => {
    const valid = ["apiUrl", "apiKey", "defaultModel"];
    if (!valid.includes(key)) {
      console.error(`Invalid key "${key}". Valid keys: ${valid.join(", ")}`);
      process.exit(1);
    }
    saveConfig({ [key]: value });
    console.log(`Set ${key} = ${key === "apiKey" ? "***" : value}`);
  });

configCmd
  .command("show")
  .description("Show current configuration (env overrides: RCA_API_URL, RCA_API_KEY, RCA_MODEL)")
  .action(() => {
    const config = loadConfig();
    console.log(JSON.stringify({ ...config, apiKey: config.apiKey ? "***" : undefined }, null, 2));
  });

// ─────────────────────────────────────────────────────────────────────────────
// rca chat
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("chat <message>")
  .description("Start a new session with an initial message and stream the response")
  .option("-r, --repo <repoPath>", "Repository path (owner/repo)")
  .option("-b, --branch <branch>", "Branch name")
  .option("-m, --model <model>", "Model ID to use")
  .option("--no-stream", "Don't stream the response")
  .action(async (message: string, opts: { repo?: string; branch?: string; model?: string; stream?: boolean }) => {
    try {
      const config = loadConfig();
      const result = await createSession({
        firstMessage: message,
        repoPath: opts.repo,
        branch: opts.branch,
        modelId: opts.model ?? config.defaultModel,
        title: message.slice(0, 80),
      });

      console.log(`Session: ${result.id}`);
      if (result.runId) console.log(`Run: ${result.runId}`);

      if (opts.stream !== false) {
        console.log("\n--- Streaming events ---\n");
        const controller = new AbortController();
        process.on("SIGINT", () => controller.abort());

        await streamSession(
          result.id,
          (event) => renderStreamEvent(event, controller),
          controller.signal,
        ).catch((err) => {
          if ((err as Error).name !== "AbortError") throw err;
        });
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// rca send
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("send <sessionId> <message>")
  .description("Send a follow-up message to an existing session")
  .option("-s, --stream", "Stream the response after sending")
  .action(async (sessionId: string, message: string, opts: { stream?: boolean }) => {
    try {
      await sendMessage(sessionId, message);
      console.log("Message sent.");

      if (opts.stream) {
        const controller = new AbortController();
        process.on("SIGINT", () => controller.abort());

        await streamSession(
          sessionId,
          (event) => renderStreamEvent(event, controller),
          controller.signal,
        ).catch((err) => {
          if ((err as Error).name !== "AbortError") throw err;
        });
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// rca list
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List agent sessions")
  .option("-s, --status <status>", "Filter by status (running, completed, failed)")
  .option("-n, --limit <n>", "Max results", "20")
  .action(async (opts: { status?: string; limit?: string }) => {
    try {
      const sessions = await listSessions({
        status: opts.status,
        limit: opts.limit ? Number(opts.limit) : undefined,
      });
      if (sessions.length === 0) {
        console.log("No sessions found.");
        return;
      }
      for (const s of sessions) {
        const row = s as Record<string, unknown>;
        const status = String(row.status ?? "unknown").padEnd(10);
        const title = String(row.title ?? "").slice(0, 60);
        console.log(`  ${row.id}  ${status}  ${title}`);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// rca stop / pause / resume
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("stop <sessionId>")
  .description("Stop (abort) an active session")
  .action(async (sessionId: string) => {
    try {
      const result = await stopSession(sessionId);
      console.log("Stopped:", JSON.stringify(result));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("pause <sessionId>")
  .description("Request pause of an active session (advisory — agent may not honor immediately)")
  .action(async (sessionId: string) => {
    try {
      console.warn("Note: pause is advisory. The agent worker may not honor the signal until the current step completes, and it may not be enforced at all in the current version.");
      const result = await pauseSession(sessionId);
      console.log("Pause requested:", JSON.stringify(result));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("resume <sessionId>")
  .description("Resume a paused session")
  .action(async (sessionId: string) => {
    try {
      const result = await resumeSession(sessionId);
      console.log("Resumed:", JSON.stringify(result));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// rca stream
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("stream <sessionId>")
  .description("Attach to a session's event stream")
  .action(async (sessionId: string) => {
    try {
      console.log(`Streaming session ${sessionId}...\n`);
      const controller = new AbortController();
      process.on("SIGINT", () => {
        console.log("\nDetached.");
        controller.abort();
      });

      await streamSession(
        sessionId,
        (event) => renderStreamEvent(event, controller),
        controller.signal,
      ).catch((err) => {
        if ((err as Error).name !== "AbortError") throw err;
      });
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program.parse();
