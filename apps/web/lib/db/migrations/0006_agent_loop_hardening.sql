-- Agent Loop Hardening: add columns for incremental persistence, terminal classification, and liveness
ALTER TABLE chat_messages ADD COLUMN run_id TEXT REFERENCES agent_runs(id);
CREATE INDEX idx_chat_messages_run_id ON chat_messages(run_id);

ALTER TABLE agent_runs ADD COLUMN terminal_reason TEXT;
ALTER TABLE agent_runs ADD COLUMN last_heartbeat_at TIMESTAMPTZ;
