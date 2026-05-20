/**
 * exe.dev authentication via SSH key signatures.
 *
 * Tokens are signed locally with an ed25519 private key and follow the
 * exe.dev token format:  PAYLOAD.SIGNATURE  where PAYLOAD is base64url-encoded
 * JSON permissions and SIGNATURE is the base64url-encoded SSH signature.
 *
 * Alternatively, if a pre-signed bearer token is provided via env, we skip
 * local signing and use it directly (simpler for CI / single-key setups).
 */

import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface ExeDevAuthConfig {
  /** Pre-signed bearer token. If set, key-based signing is skipped. */
  bearerToken?: string;
  /** Path to the SSH private key file for signing tokens. */
  sshKeyPath?: string;
  /** Namespace for the token signature (default: "v0@exe.dev"). */
  namespace?: string;
}

function b64ToB64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function execFileAsync(
  cmd: string,
  args: string[],
  opts?: { input?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = execFile(cmd, args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
    if (opts?.input && proc.stdin) {
      proc.stdin.write(opts.input);
      proc.stdin.end();
    }
  });
}

/**
 * Sign a permissions JSON payload with an SSH key, producing an exe.dev API token.
 *
 * Equivalent to the shell sequence:
 *   PAYLOAD=$(printf '%s' "$PERMISSIONS" | base64 | b64url)
 *   SIG=$(printf '%s' "$PERMISSIONS" | ssh-keygen -Y sign -f key -n v0@exe.dev)
 *   TOKEN="exedev.${PAYLOAD}.${SIG_B64URL}"
 */
export async function signExeDevToken(
  permissions: Record<string, unknown>,
  sshKeyPath: string,
  namespace = "v0@exe.dev",
): Promise<string> {
  const json = JSON.stringify(permissions);
  const payload = b64ToB64Url(Buffer.from(json).toString("base64"));

  // ssh-keygen -Y sign writes the signature to a file, so we use a temp file
  const tmpSig = join(tmpdir(), `exedev-sig-${randomUUID()}`);
  const tmpData = join(tmpdir(), `exedev-data-${randomUUID()}`);

  try {
    await writeFile(tmpData, json, "utf8");

    await execFileAsync("ssh-keygen", [
      "-Y", "sign",
      "-f", sshKeyPath,
      "-n", namespace,
      tmpData,
    ]);

    // ssh-keygen writes to tmpData + ".sig"
    const { readFile } = await import("node:fs/promises");
    const sigPem = await readFile(`${tmpData}.sig`, "utf8");

    // Strip PEM armor and convert to base64url
    const sigB64 = sigPem
      .split("\n")
      .filter((line) => !line.startsWith("-----") && line.trim() !== "")
      .join("");
    const sig = b64ToB64Url(sigB64);

    return `exedev.${payload}.${sig}`;
  } finally {
    await unlink(tmpData).catch(() => {});
    await unlink(`${tmpData}.sig`).catch(() => {});
    await unlink(tmpSig).catch(() => {});
  }
}

/**
 * Resolve an exe.dev bearer token from config.
 * Prefers a static token if set; otherwise signs one with the SSH key.
 */
export async function resolveExeDevToken(config: ExeDevAuthConfig): Promise<string> {
  if (config.bearerToken) {
    return config.bearerToken;
  }

  if (!config.sshKeyPath) {
    throw new Error(
      "exe.dev auth requires either EXEDEV_BEARER_TOKEN or EXEDEV_SSH_KEY_PATH",
    );
  }

  const permissions: Record<string, unknown> = {
    cmds: ["new", "rm", "ls", "stat", "cp", "restart", "whoami"],
  };

  return signExeDevToken(permissions, config.sshKeyPath, config.namespace);
}

/**
 * Build auth config from environment variables.
 */
export function exeDevAuthFromEnv(): ExeDevAuthConfig {
  return {
    bearerToken: process.env.EXEDEV_BEARER_TOKEN,
    sshKeyPath: process.env.EXEDEV_SSH_KEY_PATH,
    namespace: process.env.EXEDEV_TOKEN_NAMESPACE ?? "v0@exe.dev",
  };
}
