import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });

try {
  const [existing] = await sql`SELECT to_regclass('llm_calls') as exists`;
  if (existing.exists) {
    console.log("llm_calls table already exists, skipping CREATE.");
  } else {
    await sql`
      CREATE TABLE "llm_calls" (
        "id" text PRIMARY KEY NOT NULL,
        "run_id" text,
        "session_id" text,
        "user_id" text NOT NULL,
        "provider" text NOT NULL,
        "model" text NOT NULL,
        "input_tokens" integer NOT NULL,
        "output_tokens" integer NOT NULL,
        "cost_usd" numeric(10, 6) NOT NULL,
        "latency_ms" integer NOT NULL,
        "stop_reason" text,
        "error" text,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `;
    console.log("Created llm_calls table.");

    await sql`ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action`;
    await sql`ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action`;
    console.log("Added foreign keys.");

    await sql`CREATE INDEX "llm_calls_user_id_idx" ON "llm_calls" USING btree ("user_id")`;
    await sql`CREATE INDEX "llm_calls_run_id_idx" ON "llm_calls" USING btree ("run_id")`;
    await sql`CREATE INDEX "llm_calls_session_id_idx" ON "llm_calls" USING btree ("session_id")`;
    await sql`CREATE INDEX "llm_calls_user_created_idx" ON "llm_calls" USING btree ("user_id","created_at")`;
    console.log("Created indexes.");
  }

  const [budgets] = await sql`SELECT to_regclass('budgets') as exists`;
  if (budgets.exists) {
    console.log("budgets table already exists, skipping.");
  } else {
    await sql`
      CREATE TABLE "budgets" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text,
        "org_id" text,
        "monthly_limit_usd" numeric(10, 2) NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `;
    await sql`CREATE INDEX "budgets_user_id_idx" ON "budgets" USING btree ("user_id")`;
    await sql`CREATE INDEX "budgets_org_id_idx" ON "budgets" USING btree ("org_id")`;
    console.log("Created budgets table with indexes.");
  }

  console.log("Migration complete.");
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await sql.end();
}
