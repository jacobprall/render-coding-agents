CREATE TABLE "event_series" (
	"id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"event_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_series_session_type_uidx" UNIQUE("session_id","event_type")
);
--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"session_id" text NOT NULL,
	"series_id" integer NOT NULL,
	"parent_event_id" text,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"duration_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "event_series_session_id_idx" ON "event_series" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX "agent_events_session_created_idx" ON "agent_events" USING btree ("session_id","created_at");
--> statement-breakpoint
CREATE INDEX "agent_events_series_created_idx" ON "agent_events" USING btree ("series_id","created_at");
--> statement-breakpoint
CREATE INDEX "agent_events_run_created_idx" ON "agent_events" USING btree ("run_id","created_at");
--> statement-breakpoint
CREATE INDEX "agent_events_status_idx" ON "agent_events" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "agent_events_parent_idx" ON "agent_events" USING btree ("parent_event_id");
--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_series_id_event_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."event_series"("id") ON DELETE cascade ON UPDATE no action;
