/**
 * SandboxProvider backed by exe.dev VMs.
 *
 * Each provisioned session gets a dedicated workspace directory on a shared VM,
 * or optionally a dedicated VM per session (configurable via `vmStrategy`).
 *
 * The default "shared-vm" strategy creates one VM and isolates sessions by
 * directory, similar to SharedHttpSandboxProvider. The "per-session" strategy
 * creates a new VM per session (better isolation, higher latency on provision).
 */

import type { SandboxProvider, ProvisionOptions, SandboxHealth } from "../provider";
import type { SandboxAdapter } from "../interface";
import { ExeDevSandboxAdapter, type ExeDevAdapterOptions } from "../adapters/exedev";
import { sshExec, sshExeDevCmd, httpsExeDevCmd } from "../lib/exedev-ssh";
import type { ExeDevAuthConfig } from "../lib/exedev-auth";

export type VmStrategy = "shared-vm" | "per-session";

export interface ExeDevProviderConfig {
  auth: ExeDevAuthConfig;
  /** VM allocation strategy. Defaults to "shared-vm". */
  vmStrategy?: VmStrategy;
  /**
   * For "shared-vm" strategy: the VM name to use. If not set, a VM named
   * "openforge-sandbox" is created on first provision.
   */
  sharedVmName?: string;
  /** Custom Docker image for new VMs. */
  vmImage?: string;
  /** Setup script to run on first boot of new VMs. */
  setupScript?: string;
  /** Workspace root on the VM. Defaults to "/home/exedev/workspace". */
  workspaceRoot?: string;
}

interface VmInfo {
  vmName: string;
  vmHost: string;
  adapter: ExeDevSandboxAdapter;
}

const DEFAULT_SETUP_SCRIPT = [
  "#!/bin/bash",
  "set -e",
  "mkdir -p /home/exedev/workspace",
  "which rg >/dev/null 2>&1 || (sudo apt-get update -qq && sudo apt-get install -y -qq ripgrep)",
].join("\n");

export class ExeDevSandboxProvider implements SandboxProvider {
  readonly type = "exedev";

  private readonly config: ExeDevProviderConfig;
  private readonly vmStrategy: VmStrategy;
  private readonly workspaceRoot: string;

  /** For shared-vm strategy: the single shared VM info. */
  private sharedVm: VmInfo | null = null;

  /** For per-session strategy: maps sessionId → VmInfo. */
  private sessionVms = new Map<string, VmInfo>();

  /** Cached bearer token for the exe.dev management API. */
  private bearerToken: string | null = null;

  constructor(config: ExeDevProviderConfig) {
    this.config = config;
    this.vmStrategy = config.vmStrategy ?? "shared-vm";
    this.workspaceRoot = config.workspaceRoot ?? "/home/exedev/workspace";
  }

  async provision(sessionId: string, opts?: ProvisionOptions): Promise<SandboxAdapter> {
    if (this.vmStrategy === "shared-vm") {
      return this.provisionSharedVm(sessionId, opts);
    }
    return this.provisionPerSession(sessionId, opts);
  }

  async deprovision(sessionId: string): Promise<void> {
    if (this.vmStrategy === "per-session") {
      const vm = this.sessionVms.get(sessionId);
      if (vm) {
        await this.destroyVm(vm.vmName);
        this.sessionVms.delete(sessionId);
      }
    }
    // For shared-vm, sessions are just directories — no VM teardown per session.
  }

  async health(sessionId: string): Promise<SandboxHealth> {
    const vm = this.vmStrategy === "shared-vm"
      ? this.sharedVm
      : this.sessionVms.get(sessionId);

    if (!vm) {
      return { ready: false, type: this.type };
    }

    try {
      const result = await sshExec(
        vm.vmHost,
        "df -B1 /home/exedev | tail -1 | awk '{print $2, $3}'",
        { sshKeyPath: this.config.auth.sshKeyPath, timeoutMs: 10_000 },
      );

      if (result.exitCode !== 0) {
        return { ready: false, type: this.type };
      }

      const [totalStr, usedStr] = result.stdout.trim().split(/\s+/);
      const totalBytes = parseInt(totalStr ?? "0", 10);
      const usedBytes = parseInt(usedStr ?? "0", 10);

      return {
        ready: true,
        type: this.type,
        diskUsage: totalBytes > 0 ? { totalBytes, usedBytes } : undefined,
      };
    } catch {
      return { ready: false, type: this.type };
    }
  }

  // ─── Shared VM strategy ──────────────────────────────────────────────────

  private async provisionSharedVm(sessionId: string, opts?: ProvisionOptions): Promise<SandboxAdapter> {
    if (!this.sharedVm) {
      const vmName = this.config.sharedVmName ?? "openforge-sandbox";
      const exists = await this.vmExists(vmName);

      if (!exists) {
        await this.createVm(vmName);
      }

      const vmHost = `${vmName}.exe.xyz`;
      const adapter = new ExeDevSandboxAdapter({
        vmHost,
        workspaceRoot: this.workspaceRoot,
        sshKeyPath: this.config.auth.sshKeyPath,
      });

      this.sharedVm = { vmName, vmHost, adapter };
    }

    await this.ensureSessionWorkspace(this.sharedVm, sessionId, opts);
    return this.sharedVm.adapter;
  }

  // ─── Per-session VM strategy ─────────────────────────────────────────────

  private async provisionPerSession(sessionId: string, opts?: ProvisionOptions): Promise<SandboxAdapter> {
    const existing = this.sessionVms.get(sessionId);
    if (existing) return existing.adapter;

    const safeName = `of-${sessionId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 30)}`;
    await this.createVm(safeName);

    const vmHost = `${safeName}.exe.xyz`;
    const adapter = new ExeDevSandboxAdapter({
      vmHost,
      workspaceRoot: this.workspaceRoot,
      sshKeyPath: this.config.auth.sshKeyPath,
    });

    const vm: VmInfo = { vmName: safeName, vmHost, adapter };
    this.sessionVms.set(sessionId, vm);

    await this.ensureSessionWorkspace(vm, sessionId, opts);
    return adapter;
  }

  // ─── VM lifecycle helpers ────────────────────────────────────────────────

  private async ensureSessionWorkspace(vm: VmInfo, sessionId: string, opts?: ProvisionOptions): Promise<void> {
    const sessionDir = `${this.workspaceRoot}/${sessionId}`;

    await sshExec(
      vm.vmHost,
      `mkdir -p '${sessionDir}'`,
      { sshKeyPath: this.config.auth.sshKeyPath, timeoutMs: 15_000 },
    );

    if (opts?.cloneUrl) {
      const branchFlag = opts.branch ? `--branch '${opts.branch}'` : "";
      let cloneCmd = `git clone ${branchFlag} '${opts.cloneUrl}' '${sessionDir}'`;

      if (opts.gitToken) {
        const urlWithToken = opts.cloneUrl.replace(
          /^https:\/\//,
          `https://x-access-token:${opts.gitToken}@`,
        );
        cloneCmd = `git clone ${branchFlag} '${urlWithToken}' '${sessionDir}'`;
      }

      const existingCheck = await sshExec(
        vm.vmHost,
        `test -d '${sessionDir}/.git' && echo exists || echo empty`,
        { sshKeyPath: this.config.auth.sshKeyPath, timeoutMs: 10_000 },
      );

      if (existingCheck.stdout.trim() !== "exists") {
        await sshExec(
          vm.vmHost,
          `rm -rf '${sessionDir}' && ${cloneCmd}`,
          { sshKeyPath: this.config.auth.sshKeyPath, timeoutMs: opts.timeoutMs ?? 120_000 },
        );
      }
    }
  }

  private async vmExists(vmName: string): Promise<boolean> {
    const result = await sshExeDevCmd(
      `stat ${vmName}`,
      { sshKeyPath: this.config.auth.sshKeyPath, timeoutMs: 15_000 },
    );
    return result.exitCode === 0;
  }

  private async createVm(vmName: string): Promise<void> {
    const setupScript = this.config.setupScript ?? DEFAULT_SETUP_SCRIPT;
    const imageFlag = this.config.vmImage ? `--image=${this.config.vmImage}` : "";

    const token = await this.getBearerToken();
    if (token) {
      const cmd = `new --name=${vmName} ${imageFlag} --setup-script="${setupScript.replace(/"/g, '\\"')}"`;
      const result = await httpsExeDevCmd(cmd, token);
      if (!result.ok) {
        throw new Error(`exe.dev VM creation failed (${result.status}): ${result.body}`);
      }
    } else {
      const result = await sshExeDevCmd(
        `new --name=${vmName} ${imageFlag}`,
        { sshKeyPath: this.config.auth.sshKeyPath, timeoutMs: 60_000 },
      );
      if (result.exitCode !== 0) {
        throw new Error(`exe.dev VM creation failed: ${result.stderr}`);
      }
    }

    await this.waitForVm(vmName);
  }

  private async destroyVm(vmName: string): Promise<void> {
    const token = await this.getBearerToken();
    if (token) {
      await httpsExeDevCmd(`rm ${vmName}`, token).catch(() => {});
    } else {
      await sshExeDevCmd(
        `rm ${vmName}`,
        { sshKeyPath: this.config.auth.sshKeyPath },
      ).catch(() => {});
    }
  }

  private async waitForVm(vmName: string, maxWaitMs = 60_000): Promise<void> {
    const start = Date.now();
    const vmHost = `${vmName}.exe.xyz`;

    while (Date.now() - start < maxWaitMs) {
      const result = await sshExec(
        vmHost,
        "echo ready",
        { sshKeyPath: this.config.auth.sshKeyPath, timeoutMs: 10_000 },
      );
      if (result.exitCode === 0 && result.stdout.includes("ready")) {
        return;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }

    throw new Error(`exe.dev VM ${vmName} did not become reachable within ${maxWaitMs}ms`);
  }

  private async getBearerToken(): Promise<string | null> {
    if (this.bearerToken) return this.bearerToken;

    if (this.config.auth.bearerToken) {
      this.bearerToken = this.config.auth.bearerToken;
      return this.bearerToken;
    }

    // No explicit bearer token -- fall through to SSH command path.
    return null;
  }
}

/**
 * Build an ExeDevSandboxProvider from environment variables.
 */
export function exeDevProviderFromEnv(): ExeDevSandboxProvider {
  return new ExeDevSandboxProvider({
    auth: {
      bearerToken: process.env.EXEDEV_BEARER_TOKEN,
      sshKeyPath: process.env.EXEDEV_SSH_KEY_PATH,
    },
    vmStrategy: (process.env.EXEDEV_VM_STRATEGY as VmStrategy) ?? "shared-vm",
    sharedVmName: process.env.EXEDEV_SHARED_VM_NAME ?? "openforge-sandbox",
    vmImage: process.env.EXEDEV_VM_IMAGE,
    setupScript: process.env.EXEDEV_SETUP_SCRIPT,
    workspaceRoot: process.env.EXEDEV_WORKSPACE_ROOT ?? "/home/exedev/workspace",
  });
}
