-- T001: Workspace model extensions to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS environment_config JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS secrets_config JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS compute_defaults JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_skills JSONB DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_mirror_status JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_mirror_synced_at TIMESTAMPTZ;

-- T002: Session extensions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_env_overrides JSONB DEFAULT '{}';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_skills_overrides JSONB DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS repos_used JSONB DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS summary JSONB;

-- T003: Mirror sync log table
CREATE TABLE IF NOT EXISTS mirror_sync_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_path TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mirror_sync_log_project_idx ON mirror_sync_log(project_id);
CREATE INDEX IF NOT EXISTS mirror_sync_log_created_idx ON mirror_sync_log(created_at);
