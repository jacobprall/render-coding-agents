export const STREAM_EVENT = {
  CONNECTED: "connected",
  NO_ACTIVE_RUN: "no_active_run",
  MESSAGE: "agent:message",
  TOOL_CALL: "agent:tool_call",
  TOOL_RESULT: "agent:tool_result",
  ASK_USER: "agent:ask_user",
  FILE_CHANGED: "agent:file_changed",
  HEARTBEAT: "agent:heartbeat",
  STEP_PERSISTED: "agent:step_persisted",
  COMPLETED: "session:completed",
  FAILED: "session:failed",
  ABORTED: "session:aborted",
  STEP_STARTED: "step:started",
  STEP_COMPLETED: "step:completed",
  STEP_FAILED: "step:failed",
  PHASE_CHANGED: "session:phase_changed",
  PLAN_GENERATED: "plan:generated",
} as const;

export type StreamEventType = (typeof STREAM_EVENT)[keyof typeof STREAM_EVENT];
