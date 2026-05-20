import type { SandboxProvider, ProvisionOptions, SandboxHealth } from "../provider";
import { HttpSandboxAdapter, type SandboxSessionAuth } from "../adapter";

export class SharedHttpSandboxProvider implements SandboxProvider {
  readonly type = "shared-http";

  private adapter: HttpSandboxAdapter | null = null;

  private baseUrl: string;

  constructor(
    private host: string,
    private sharedSecret?: string,
    private sessionAuth?: SandboxSessionAuth,
  ) {
    if (host.startsWith("http://") || host.startsWith("https://")) {
      this.baseUrl = host.replace(/\/$/, "");
    } else if (host.includes("localhost") || host.match(/^[\d.:]+$/)) {
      this.baseUrl = `http://${host}`;
    } else {
      this.baseUrl = `https://${host}`;
    }
  }

  async provision(_sessionId: string, _opts?: ProvisionOptions): Promise<HttpSandboxAdapter> {
    if (!this.adapter) {
      this.adapter = new HttpSandboxAdapter(this.host, this.sharedSecret, this.sessionAuth);
    }
    return this.adapter;
  }

  async deprovision(sessionId: string): Promise<void> {
    const adapter = await this.provision(sessionId);
    await adapter.cleanup(sessionId);
  }

  async health(_sessionId: string): Promise<SandboxHealth> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { ready: false, type: this.type };

      const body = (await res.json()) as {
        diskUsage?: { totalBytes: number; usedBytes: number; freeBytes: number; percentUsed: number };
      };
      const du = body.diskUsage;
      return {
        ready: true,
        type: this.type,
        diskUsage:
          du && typeof du.usedBytes === "number" && typeof du.totalBytes === "number"
            ? { usedBytes: du.usedBytes, totalBytes: du.totalBytes }
            : undefined,
      };
    } catch {
      return { ready: false, type: this.type };
    }
  }
}
