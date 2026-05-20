import type { SandboxProvider, ProvisionOptions, SandboxHealth } from "../provider";
import { HttpSandboxAdapter, type SandboxSessionAuth } from "../adapter";

export class SharedHttpSandboxProvider implements SandboxProvider {
  readonly type = "shared-http";

  private adapter: HttpSandboxAdapter | null = null;

  constructor(
    private host: string,
    private sharedSecret?: string,
    private sessionAuth?: SandboxSessionAuth,
  ) {}

  async provision(_sessionId: string, _opts?: ProvisionOptions): Promise<HttpSandboxAdapter> {
    if (!this.adapter) {
      this.adapter = new HttpSandboxAdapter(this.host, this.sharedSecret, this.sessionAuth);
    }
    return this.adapter;
  }

  async deprovision(_sessionId: string): Promise<void> {}

  async health(_sessionId: string): Promise<SandboxHealth> {
    try {
      const res = await fetch(`http://${this.host}/health`, {
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
