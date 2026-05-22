export const STREAM_EVENT = {
  CONNECTED: "connected",
  ASK_USER: "ask_user",
  FILE_CHANGED: "file_changed",
  DONE: "done",
  ABORTED: "aborted",
  ERROR: "error",
  TASK_START: "task_start",
  TASK_DONE: "task_done",
  TASK_ERROR: "task_error",
  NO_ACTIVE_RUN: "no_active_run",
  SPEC_UPDATE: "spec_update",
  HEARTBEAT: "heartbeat",
  STEP_PERSISTED: "step_persisted",
} as const;

export type StreamEventType = (typeof STREAM_EVENT)[keyof typeof STREAM_EVENT];
