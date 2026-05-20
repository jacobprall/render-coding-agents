import type { SandboxAdapter } from "./interface";

export interface ProvisionOptions {
  cloneUrl?: string;
  branch?: string;
  gitToken?: string;
  templateId?: string;
  timeoutMs?: number;
}

export interface SandboxHealth {
  ready: boolean;
  type: string;
  diskUsage?: { usedBytes: number; totalBytes: number };
}

export interface SandboxProvider {
  readonly type: string;
  provision(sessionId: string, opts?: ProvisionOptions): Promise<SandboxAdapter>;
  deprovision(sessionId: string): Promise<void>;
  health(sessionId: string): Promise<SandboxHealth>;
}

const providers = new Map<string, SandboxProvider>();

export function registerSandboxProvider(provider: SandboxProvider): void {
  providers.set(provider.type, provider);
}

export function getSandboxProvider(type: string): SandboxProvider {
  const provider = providers.get(type);
  if (!provider) throw new Error(`Sandbox provider not registered: ${type}`);
  return provider;
}
