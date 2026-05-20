import postgres from "postgres";
import bcrypt from "bcryptjs";

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });

const email = "admin@test.com";
const password = "admin123";

try {
  const existing = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  if (existing.length > 0) {
    console.log("Admin user already exists, updating password...");
    const passwordHash = await bcrypt.hash(password, 12);
    await sql`UPDATE users SET password_hash = ${passwordHash}, is_admin = true WHERE email = ${email}`;
    console.log("Password updated.");
  } else {
    console.log("Creating admin user...");
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = crypto.randomUUID();

    // Use existing org or create one
    const [existingOrg] = await sql`SELECT id FROM orgs LIMIT 1`;
    const orgId = existingOrg?.id ?? crypto.randomUUID();
    if (!existingOrg) {
      await sql`INSERT INTO orgs (id, name, slug) VALUES (${orgId}, 'My Organization', 'my-organization')`;
    }

    await sql`INSERT INTO users (id, name, email, org_id, password_hash, is_admin) VALUES (${userId}, 'Admin', ${email}, ${orgId}, ${passwordHash}, true)`;

    const [existingScratch] = await sql`SELECT id FROM projects WHERE org_id = ${orgId} AND is_scratch = true LIMIT 1`;
    if (!existingScratch) {
      await sql`INSERT INTO projects (id, org_id, name, slug, is_scratch, created_by) VALUES (${crypto.randomUUID()}, ${orgId}, 'Scratch', ${'scratch-' + userId}, true, ${userId})`;
    }

    console.log(`Admin created: ${email}`);
  }
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await sql.end();
}
