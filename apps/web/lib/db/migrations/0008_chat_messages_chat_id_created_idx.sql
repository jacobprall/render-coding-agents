-- Speed up message hydration for a chat ordered by created_at.
CREATE INDEX IF NOT EXISTS chat_messages_chat_id_created_idx
  ON chat_messages (chat_id, created_at);
