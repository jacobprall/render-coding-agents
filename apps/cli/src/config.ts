import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".coding-agents");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const CONFIG_FILE_MODE = 0o600;

export interface CliConfig {
  apiUrl: string;
  apiKey?: string;
  defaultModel?: string;
}

const DEFAULT_CONFIG: CliConfig = {
  apiUrl: "http://localhost:4100",
};

/**
 * Load config with env var overrides taking priority:
 *   RCA_API_URL  → apiUrl
 *   RCA_API_KEY  → apiKey
 *   RCA_MODEL    → defaultModel
 */
export function loadConfig(): CliConfig {
  let fileConfig: CliConfig = DEFAULT_CONFIG;

  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      fileConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      fileConfig = DEFAULT_CONFIG;
    }
  }

  return {
    apiUrl: process.env.RCA_API_URL || fileConfig.apiUrl,
    apiKey: process.env.RCA_API_KEY || fileConfig.apiKey,
    defaultModel: process.env.RCA_MODEL || fileConfig.defaultModel,
  };
}

export function saveConfig(config: Partial<CliConfig>): void {
  const current = loadConfig();
  const merged = { ...current, ...config };

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + "\n", { mode: CONFIG_FILE_MODE });

  try {
    chmodSync(CONFIG_FILE, CONFIG_FILE_MODE);
  } catch {
    // Best-effort on platforms where chmod is unsupported
  }
}

export function getApiHeaders(config: CliConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }
  return headers;
}
