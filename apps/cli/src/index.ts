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

const program = new Command();

program
  .name("rca")
  .description("Render Coding Agents CLI — interact with agent sessions from the terminal")
  .version("0.1.0");

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
  .description("Show current configuration")
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
          (event) => {
            const data = event.data as Record<string, unknown>;
            switch (event.type) {
              case "token":
                process.stdout.write(String(data.token ?? data.text ?? ""));
                break;
              case "tool_call":
                console.log(`\n[tool] ${data.toolName ?? data.name}(${JSON.stringify(data.args ?? data.input ?? "").slice(0, 100)})`);
                break;
              case "tool_result":
                console.log(`[result] ${String(data.result ?? data.output ?? "").slice(0, 200)}`);
                break;
              case "done":
                console.log("\n\n--- Done ---");
                controller.abort();
                break;
              case "error":
                console.error(`\n[error] ${data.message ?? data.error ?? JSON.stringify(data)}`);
                controller.abort();
                break;
              case "aborted":
                console.log("\n\n--- Aborted ---");
                controller.abort();
                break;
              case "paused":
                console.log("\n\n--- Paused ---");
                break;
              case "resumed":
                console.log("\n--- Resumed ---\n");
                break;
              default:
                // Show other events in debug mode
                if (process.env.RCA_DEBUG) {
                  console.log(`[${event.type}]`, JSON.stringify(data).slice(0, 200));
                }
            }
          },
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
  .action(async (sessionId: string, message: string) => {
    try {
      await sendMessage(sessionId, message);
      console.log("Message sent.");
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
  .description("Pause an active session")
  .action(async (sessionId: string) => {
    try {
      const result = await pauseSession(sessionId);
      console.log("Paused:", JSON.stringify(result));
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
        (event) => {
          const data = event.data as Record<string, unknown>;
          switch (event.type) {
            case "token":
              process.stdout.write(String(data.token ?? data.text ?? ""));
              break;
            case "tool_call":
              console.log(`\n[tool] ${data.toolName ?? data.name}`);
              break;
            case "done":
              console.log("\n\n--- Done ---");
              controller.abort();
              break;
            case "error":
              console.error(`\n[error] ${data.message ?? JSON.stringify(data)}`);
              controller.abort();
              break;
            case "aborted":
              console.log("\n--- Aborted ---");
              controller.abort();
              break;
            default:
              console.log(`[${event.type}]`, JSON.stringify(data).slice(0, 200));
          }
        },
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
