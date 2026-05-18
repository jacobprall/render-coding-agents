import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".openforge");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface CliConfig {
  apiUrl: string;
  apiKey?: string;
  defaultModel?: string;
}

const DEFAULT_CONFIG: CliConfig = {
  apiUrl: "http://localhost:4100",
};

export function loadConfig(): CliConfig {
  if (!existsSync(CONFIG_FILE)) return DEFAULT_CONFIG;
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: Partial<CliConfig>): void {
  const current = loadConfig();
  const merged = { ...current, ...config };
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + "\n");
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
