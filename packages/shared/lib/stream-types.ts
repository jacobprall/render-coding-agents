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

export interface StreamEventV2 {
  v: 2
  type: string
  ts: string
  requestId?: string
  payload: Record<string, unknown>
}

const V1_TO_V2_TYPE_MAP: Record<string, string> = {
  token: "agent:message",
  tool_call: "agent:tool_call",
  tool_result: "agent:tool_result",
  heartbeat: "agent:heartbeat",
  file_changed: "agent:file_changed",
  done: "session:completed",
  error: "session:failed",
  aborted: "session:aborted",
  ask_user: "agent:ask_user",
  task_start: "step:started",
  task_done: "step:completed",
  task_error: "step:failed",
  spec: "plan:generated",
  step_persisted: "agent:step_persisted",
  phase_changed: "session:phase_changed",
  verification: "agent:verification",
  verify_failed: "agent:verify_failed",
}

export function normalizeEvent(raw: StreamEvent | StreamEventV2): StreamEventV2 {
  if ("v" in raw && raw.v === 2) return raw as StreamEventV2

  const v1 = raw as StreamEvent
  const type = V1_TO_V2_TYPE_MAP[v1.type] ?? v1.type

  const { type: _type, ...rest } = v1
  const payload: Record<string, unknown> = {}

  switch (v1.type) {
    case "token":
      if (v1.token !== undefined) payload.content = v1.token
      break
    case "tool_call":
      if (v1.toolName !== undefined) payload.tool = v1.toolName
      if (v1.toolCallId !== undefined) payload.toolCallId = v1.toolCallId
      if (v1.args !== undefined) payload.args = v1.args
      break
    case "tool_result":
      if (v1.toolCallId !== undefined) payload.toolCallId = v1.toolCallId
      if (v1.result !== undefined) payload.result = v1.result
      break
    case "heartbeat":
      if (v1.activity !== undefined) payload.activity = v1.activity
      if (v1.step !== undefined) payload.step = v1.step
      if (v1.timestamp !== undefined) payload.timestamp = v1.timestamp
      break
    case "file_changed":
      if (v1.path !== undefined) payload.path = v1.path
      if (v1.additions !== undefined) payload.additions = v1.additions
      if (v1.deletions !== undefined) payload.deletions = v1.deletions
      if (v1.unifiedDiffPreview !== undefined) payload.unifiedDiffPreview = v1.unifiedDiffPreview
      break
    case "done":
      if (v1.assistantMessageId !== undefined) payload.assistantMessageId = v1.assistantMessageId
      if (v1.assistantParts !== undefined) payload.assistantParts = v1.assistantParts
      if (v1.terminalReason !== undefined) payload.terminalReason = v1.terminalReason
      break
    case "error":
      if (v1.message !== undefined) payload.message = v1.message
      if (v1.code !== undefined) payload.code = v1.code
      if (v1.retryable !== undefined) payload.retryable = v1.retryable
      if (v1.terminalReason !== undefined) payload.terminalReason = v1.terminalReason
      break
    case "aborted":
      if (v1.terminalReason !== undefined) payload.terminalReason = v1.terminalReason
      break
    case "ask_user":
      if (v1.question !== undefined) payload.question = v1.question
      if (v1.options !== undefined) payload.options = v1.options
      if (v1.toolCallId !== undefined) payload.toolCallId = v1.toolCallId
      break
    case "task_start":
      if (v1.task !== undefined) payload.task = v1.task
      if (v1.taskId !== undefined) payload.stepId = v1.taskId
      break
    case "task_done":
      if (v1.taskId !== undefined) payload.stepId = v1.taskId
      break
    case "task_error":
      if (v1.taskId !== undefined) payload.stepId = v1.taskId
      if (v1.message !== undefined) payload.error = v1.message
      break
    case "spec":
      if (v1.spec !== undefined) payload.spec = v1.spec
      break
    case "step_persisted":
      if (v1.step !== undefined) payload.step = v1.step
      if (v1.partCount !== undefined) payload.partCount = v1.partCount
      if (v1.assistantMessageId !== undefined) payload.assistantMessageId = v1.assistantMessageId
      break
    default:
      Object.assign(payload, rest)
  }

  return {
    v: 2,
    type,
    ts: v1.timestamp ?? new Date().toISOString(),
    requestId: v1.requestId,
    payload,
  }
}

export function isTerminalEventV2(event: StreamEventV2): boolean {
  return event.type === "session:completed"
    || event.type === "session:failed"
    || event.type === "session:aborted"
}

export function isTerminalEvent(event: StreamEvent | StreamEventV2): boolean {
  if ("v" in event && event.v === 2) {
    return isTerminalEventV2(event as StreamEventV2)
  }
  const v1 = event as StreamEvent
  return v1.type === "done" || v1.type === "error" || v1.type === "aborted"
}
