#!/usr/bin/env bun
/**
 * Automated Render deployment script.
 *
 * Handles the full lifecycle:
 *   1. Discovers services provisioned from render.yaml
 *   2. Sets pre-deploy env vars (ANTHROPIC_API_KEY, RENDER_API_KEY)
 *   3. Waits for Forgejo to become healthy
 *   4. Creates the Forgejo admin user via the Render shell API
 *   5. Runs the Forgejo setup (agent token, OAuth app)
 *   6. Wires derived env vars into the correct services
 *   7. Pushes the database schema
 *   8. Triggers redeployments
 *
 * Usage:
 *   RENDER_API_KEY=rnd_xxx ANTHROPIC_API_KEY=sk-ant-xxx bun run scripts/deploy-render.ts
 *
 * Optional env vars:
 *   FORGEJO_ADMIN_USER       (default: forge-admin)
 *   FORGEJO_ADMIN_PASSWORD   (required — password for Forgejo admin)
 *   FORGEJO_ADMIN_EMAIL      (required — email for Forgejo admin)
 *   SKIP_DB_PUSH             (set to "true" to skip schema push)
 */

export {};

const RENDER_API = "https://api.render.com/v1";
const RENDER_API_KEY = requireEnv("RENDER_API_KEY");
const ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");
const FORGEJO_ADMIN_USER = process.env.FORGEJO_ADMIN_USER || "forge-admin";
const FORGEJO_ADMIN_PASSWORD = requireEnv("FORGEJO_ADMIN_PASSWORD");
const FORGEJO_ADMIN_EMAIL = requireEnv("FORGEJO_ADMIN_EMAIL");

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

// ─── Render API helpers ──────────────────────────────────────────────────────

async function renderAPI(path: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${RENDER_API}${path}`, {
    ...opts,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${RENDER_API_KEY}`,
      ...(opts.headers as Record<string, string> || {}),
    },
  });
  return res;
}

interface RenderService {
  id: string;
  name: string;
  type: string;
  serviceDetails?: { url?: string };
}

async function listServices(): Promise<RenderService[]> {
  const services: RenderService[] = [];
  let cursor: string | undefined;

  while (true) {
    const url = cursor
      ? `/services?limit=100&cursor=${cursor}`
      : `/services?limit=100`;
    const res = await renderAPI(url);
    if (!res.ok) throw new Error(`Failed to list services: ${res.status}`);
    const data = (await res.json()) as { service: RenderService; cursor: string }[];
    if (data.length === 0) break;
    for (const item of data) {
      services.push({ ...item.service });
    }
    cursor = data[data.length - 1]?.cursor;
    if (!cursor || data.length < 100) break;
  }
  return services;
}

function findService(services: RenderService[], name: string): RenderService {
  const svc = services.find((s) => s.name === name);
  if (!svc) {
    console.error(`Service "${name}" not found. Available: ${services.map((s) => s.name).join(", ")}`);
    process.exit(1);
  }
  return svc;
}

interface EnvVar {
  key: string;
  value: string;
}

async function getEnvVars(serviceId: string): Promise<EnvVar[]> {
  const res = await renderAPI(`/services/${serviceId}/env-vars`);
  if (!res.ok) throw new Error(`Failed to get env vars: ${res.status}`);
  const data = (await res.json()) as { envVar: EnvVar }[];
  return data.map((d) => d.envVar);
}

async function setEnvVar(serviceId: string, key: string, value: string): Promise<void> {
  const res = await renderAPI(`/services/${serviceId}/env-vars/${key}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to set ${key}: ${res.status} ${body}`);
  }
}

async function deployService(serviceId: string): Promise<void> {
  const res = await renderAPI(`/services/${serviceId}/deploys`, {
    method: "POST",
    body: JSON.stringify({ clearCache: "do_not_clear" }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to deploy: ${res.status} ${body}`);
  }
}

function getServiceUrl(svc: RenderService): string {
  return svc.serviceDetails?.url || `https://${svc.name}.onrender.com`;
}

// ─── Forgejo helpers ─────────────────────────────────────────────────────────

async function waitForForgejo(url: string, maxAttempts = 60): Promise<void> {
  console.log(`Waiting for Forgejo at ${url}...`);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/api/v1/version`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        console.log(`  Forgejo ready (attempt ${i + 1})`);
        return;
      }
    } catch {}
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Forgejo did not become ready");
}

async function createForgejoAdmin(forgejoUrl: string): Promise<void> {
  console.log("Creating Forgejo admin user...");

  const res = await fetch(`${forgejoUrl}/api/v1/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: FORGEJO_ADMIN_USER,
      password: FORGEJO_ADMIN_PASSWORD,
      email: FORGEJO_ADMIN_EMAIL,
      must_change_password: false,
      login_name: FORGEJO_ADMIN_USER,
      source_id: 0,
      visibility: "public",
    }),
  });

  if (res.status === 422) {
    console.log("  Admin user already exists");
    return;
  }

  // Forgejo install API: first user via the install endpoint
  if (!res.ok) {
    console.log("  Direct admin creation failed, trying basic install endpoint...");
    // Fallback: the admin needs to be created via CLI in the container shell.
    // Print instructions but don't fail — the caller (agent) can handle it.
    console.log(`  ⚠ Create admin manually via Render Shell on coding-agents-forgejo:`);
    console.log(`    su -c 'forgejo admin user create --admin --username ${FORGEJO_ADMIN_USER} --password <password> --email ${FORGEJO_ADMIN_EMAIL}' git`);
    throw new Error("Admin user creation requires Render Shell access");
  }

  console.log("  Admin user created");
}

async function createForgejoToken(forgejoUrl: string, username: string, password: string, tokenName: string): Promise<string> {
  const res = await fetch(`${forgejoUrl}/api/v1/users/${username}/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${username}:${password}`)}`,
    },
    body: JSON.stringify({
      name: tokenName,
      scopes: [
        "write:activitypub",
        "write:admin",
        "write:issue",
        "write:misc",
        "write:notification",
        "write:organization",
        "write:package",
        "write:repository",
        "write:user",
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create token for ${username}: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { sha1: string };
  return data.sha1;
}

async function createForgejoUser(
  forgejoUrl: string,
  adminToken: string,
  username: string,
  password: string,
  email: string,
  isAdmin = false,
): Promise<void> {
  const res = await fetch(`${forgejoUrl}/api/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${adminToken}`,
    },
    body: JSON.stringify({
      username,
      password,
      email,
      must_change_password: false,
      login_name: username,
      source_id: 0,
      visibility: "public",
      ...(isAdmin ? { is_admin: true } : {}),
    }),
  });

  if (res.status === 422) {
    console.log(`  User ${username} already exists`);
    if (isAdmin) {
      const patch = await fetch(`${forgejoUrl}/api/v1/admin/users/${username}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `token ${adminToken}`,
        },
        body: JSON.stringify({ is_admin: true, login_name: username, source_id: 0 }),
      });
      if (patch.ok) console.log(`  → Promoted ${username} to admin`);
    }
    return;
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create user ${username}: ${res.status} ${body}`);
  }
  console.log(`  Created user: ${username}`);
}

async function registerOAuth2App(
  forgejoUrl: string,
  adminToken: string,
  redirectUrl: string
): Promise<{ clientId: string; clientSecret: string }> {
  const res = await fetch(`${forgejoUrl}/api/v1/user/applications/oauth2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${adminToken}`,
    },
    body: JSON.stringify({
      name: "coding-agents-web",
      redirect_uris: [`${redirectUrl}/api/auth/callback`],
      confidential_client: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (body.includes("already exists")) {
      console.log("  OAuth2 app already registered (cannot retrieve existing secrets)");
      return { clientId: "existing", clientSecret: "existing" };
    }
    throw new Error(`Failed to register OAuth2 app: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { client_id: string; client_secret: string };
  return { clientId: data.client_id, clientSecret: data.client_secret };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Coding Agents → Render Deploy Script   ║");
  console.log("╚══════════════════════════════════════╝\n");

  // Step 1: Discover services
  console.log("Step 1: Discovering services...");
  const allServices = await listServices();
  const web = findService(allServices, "coding-agents-web");
  const agent = findService(allServices, "coding-agents-agent");
  const gateway = findService(allServices, "coding-agents-gateway");
  const forgejo = findService(allServices, "coding-agents-forgejo");

  const forgejoUrl = getServiceUrl(forgejo);
  const webUrl = getServiceUrl(web);
  console.log(`  Web:     ${webUrl}`);
  console.log(`  Forgejo: ${forgejoUrl}`);
  console.log(`  Found ${allServices.length} services total\n`);

  // Step 2: Set pre-deploy env vars
  console.log("Step 2: Setting pre-deploy env vars...");
  await setEnvVar(web.id, "ANTHROPIC_API_KEY", ANTHROPIC_API_KEY);
  await setEnvVar(agent.id, "ANTHROPIC_API_KEY", ANTHROPIC_API_KEY);
  await setEnvVar(web.id, "RENDER_API_KEY", RENDER_API_KEY);
  await setEnvVar(web.id, "AUTH_URL", webUrl);
  await setEnvVar(web.id, "NEXT_PUBLIC_APP_URL", webUrl);
  await setEnvVar(web.id, "ADMIN_EMAIL", FORGEJO_ADMIN_EMAIL);
  await setEnvVar(web.id, "ADMIN_PASSWORD", FORGEJO_ADMIN_PASSWORD);
  console.log("  ✓ ANTHROPIC_API_KEY → web, agent");
  console.log("  ✓ RENDER_API_KEY → web");
  console.log(`  ✓ AUTH_URL → web (${webUrl})`);
  console.log(`  ✓ NEXT_PUBLIC_APP_URL → web (${webUrl})`);
  console.log(`  ✓ ADMIN_EMAIL → web`);
  console.log(`  ✓ ADMIN_PASSWORD → web\n`);

  // Step 3: Set Forgejo URLs
  console.log("Step 3: Setting Forgejo URLs...");
  await setEnvVar(forgejo.id, "FORGEJO__server__ROOT_URL", forgejoUrl);
  await setEnvVar(web.id, "FORGEJO_EXTERNAL_URL", forgejoUrl);
  console.log(`  ✓ FORGEJO__server__ROOT_URL → forgejo (${forgejoUrl})`);
  console.log(`  ✓ FORGEJO_EXTERNAL_URL → web\n`);

  // Step 4: Set CI callback URL
  console.log("Step 4: Setting CI callback URL...");
  await setEnvVar(web.id, "CI_CALLBACK_URL", `${webUrl}/api/ci/callback`);
  console.log(`  ✓ CI_CALLBACK_URL → web\n`);

  // Step 5: Wait for Forgejo
  console.log("Step 5: Waiting for Forgejo to boot...");
  await waitForForgejo(forgejoUrl);
  console.log();

  // Step 6: Create admin + run Forgejo setup
  console.log("Step 6: Forgejo setup...");
  try {
    await createForgejoAdmin(forgejoUrl);
  } catch (err) {
    console.log(`\n⚠ Admin creation failed via API.`);
    console.log(`  Open the Render Shell for coding-agents-forgejo and run:`);
    console.log(`  su -c 'forgejo admin user create --admin --username ${FORGEJO_ADMIN_USER} --password <password> --email ${FORGEJO_ADMIN_EMAIL}' git`);
    console.log(`\n  Then re-run this script.\n`);
    process.exit(1);
  }

  const adminToken = await createForgejoToken(forgejoUrl, FORGEJO_ADMIN_USER, FORGEJO_ADMIN_PASSWORD, "deploy-script");
  console.log("  ✓ Admin token created");

  const agentPassword = crypto.randomUUID();
  await createForgejoUser(forgejoUrl, adminToken, "coding-agents-agent", agentPassword, "agent@coding-agents.local", true);
  const agentToken = await createForgejoToken(forgejoUrl, "coding-agents-agent", agentPassword, "agent-service");
  console.log(`  ✓ Agent token: ${agentToken}`);

  const oauth = await registerOAuth2App(forgejoUrl, adminToken, webUrl);
  console.log(`  ✓ OAuth2 Client ID: ${oauth.clientId}`);
  console.log(`  ✓ OAuth2 Client Secret: ${oauth.clientSecret}\n`);

  // Step 7: Wire derived env vars
  console.log("Step 7: Setting derived env vars...");
  const tokenTargets = [web, agent, gateway];
  for (const svc of tokenTargets) {
    await setEnvVar(svc.id, "FORGEJO_AGENT_TOKEN", agentToken);
  }
  console.log("  ✓ FORGEJO_AGENT_TOKEN → web, agent, gateway");

  if (oauth.clientId !== "existing") {
    await setEnvVar(web.id, "FORGEJO_OAUTH_CLIENT_ID", oauth.clientId);
    await setEnvVar(web.id, "FORGEJO_OAUTH_CLIENT_SECRET", oauth.clientSecret);
    console.log("  ✓ OAuth credentials → web");
  }

  const webhookSecret = crypto.randomUUID();
  await setEnvVar(gateway.id, "FORGEJO_WEBHOOK_SECRET", webhookSecret);
  console.log(`  ✓ FORGEJO_WEBHOOK_SECRET → gateway (${webhookSecret})\n`);

  // Step 8: Push DB schema (generate + migrate to avoid Forgejo table conflicts)
  if (process.env.SKIP_DB_PUSH !== "true") {
    console.log("Step 8: Pushing database schema...");
    const dbEnvVars = await getEnvVars(web.id);
    const dbUrl = dbEnvVars.find((v) => v.key === "DATABASE_URL")?.value;
    if (dbUrl) {
      const dbEnv = { ...process.env, DATABASE_URL: dbUrl };
      const generate = Bun.spawn(["npx", "drizzle-kit", "generate"], {
        cwd: "apps/web",
        env: dbEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      if ((await generate.exited) !== 0) {
        console.log("  ⚠ drizzle-kit generate failed — run manually from apps/web\n");
      } else {
        const migrate = Bun.spawn(["npx", "drizzle-kit", "migrate"], {
          cwd: "apps/web",
          env: dbEnv,
          stdout: "inherit",
          stderr: "inherit",
        });
        if ((await migrate.exited) !== 0) {
          console.log("  ⚠ drizzle-kit migrate failed — run manually from apps/web\n");
        } else {
          console.log("  ✓ Schema migrated\n");
        }
      }
    } else {
      console.log("  ⚠ Could not find DATABASE_URL — run drizzle-kit generate/migrate manually\n");
    }
  } else {
    console.log("Step 8: Skipping DB push (SKIP_DB_PUSH=true)\n");
  }

  // Step 9: Trigger redeploys
  console.log("Step 9: Triggering redeployments...");
  for (const svc of [web, agent, gateway, forgejo]) {
    try {
      await deployService(svc.id);
      console.log(`  ✓ ${svc.name}`);
    } catch (err) {
      console.log(`  ⚠ ${svc.name}: ${err}`);
    }
  }

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║          Deploy complete!             ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`\nVerify: ${webUrl}/api/health`);
  console.log(`\n⚠ Remember to configure the Forgejo webhook with secret: ${webhookSecret}`);
}

main().catch((err) => {
  console.error("\n✗ Deploy failed:", err);
  process.exit(1);
});
