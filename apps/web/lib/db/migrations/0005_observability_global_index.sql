-- Cross-session query index for the observability dashboard.
-- Supports the global events view (all events across all user-accessible sessions)
-- with cursor-based pagination ordered by creation time descending.

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_events_created_desc_idx
  ON agent_events (created_at DESC, id DESC);
