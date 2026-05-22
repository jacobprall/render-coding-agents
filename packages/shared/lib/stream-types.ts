export interface StreamEvent {
  type:
    | "token"
    | "tool_call"
    | "tool_result"
    | "spec"
    | "verification"
    | "verify_failed"
    | "done"
    | "error"
    | "aborted"
    | "ask_user"
    | "task_start"
    | "task_done"
    | "task_error"
    | "file_changed"
    | "heartbeat"
    | "step_persisted";
  token?: string;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  spec?: unknown;
  results?: unknown[];
  message?: string;
  code?: string;
  requestId?: string;
  retryable?: boolean;
  question?: string;
  options?: string[];
  task?: string;
  taskId?: string;
  assistantMessageId?: string;
  assistantParts?: unknown[];
  nextRunId?: string;
  fixAttempt?: number;
  maxFixAttempts?: number;
  path?: string;
  additions?: number;
  deletions?: number;
  unifiedDiffPreview?: string;
  // Heartbeat fields
  timestamp?: string;
  activity?: string;
  step?: number;
  // Step persisted fields
  partCount?: number;
  // Terminal reason field
  terminalReason?: string;
}
