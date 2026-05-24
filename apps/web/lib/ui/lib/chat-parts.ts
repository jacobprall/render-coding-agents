import type { StreamEvent } from "@coding-agents/shared/client";

export type AssistantTextPart = {
  type: "text";
  text: string;
  id?: string;
};

export type AssistantToolCallPart = {
  type: "tool_call";
  toolName: string;
  toolCallId: string;
  args?: unknown;
  result?: unknown;
  status?: "interrupted";
  id?: string;
};

export type AssistantAskUserPart = {
  type: "ask_user";
  question: string;
  options?: string[];
  toolCallId?: string;
  id?: string;
};

export type AssistantTaskPart = {
  type: "task";
  task: string;
  taskId?: string;
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
  id?: string;
};

export type AssistantFileChangedPart = {
  type: "file_changed";
  path: string;
  additions: number;
  deletions: number;
  unifiedDiffPreview?: string;
  id?: string;
};

export type AssistantFileAttachmentPart = {
  type: "file_attachment";
  filename: string;
  lineStart?: number;
  lineEnd?: number;
  path?: string;
  id?: string;
};

export type AssistantPart =
  | AssistantTextPart
  | AssistantToolCallPart
  | AssistantAskUserPart
  | AssistantTaskPart
  | AssistantFileChangedPart
  | AssistantFileAttachmentPart;

/**
 * Append a v2 StreamEvent to the running assistant parts list.
 * The event's `payload` contains all relevant fields.
 */
export function appendStreamEvent(
  parts: AssistantPart[],
  event: StreamEvent,
  seqCounter?: { current: number },
): AssistantPart[] {
  const seq = seqCounter ?? { current: 0 };
  const p = event.payload;

  switch (event.type) {
    case "agent:message": {
      const text = p.content as string | undefined;
      if (!text) return parts;
      const last = parts[parts.length - 1];
      if (last?.type === "text") {
        return [...parts.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...parts, { type: "text", text, id: `text-${seq.current++}` }];
    }

    case "agent:tool_call": {
      const toolCallId = p.toolCallId as string | undefined;
      if (!toolCallId) return parts;
      if (parts.some((x) => x.type === "tool_call" && x.toolCallId === toolCallId)) {
        return parts;
      }
      return [
        ...parts,
        {
          type: "tool_call",
          toolName: (p.tool ?? p.toolName ?? "tool") as string,
          toolCallId,
          args: p.args,
          id: toolCallId,
        },
      ];
    }

    case "agent:tool_result": {
      const toolCallId = p.toolCallId as string | undefined;
      if (!toolCallId) return parts;
      return parts.map((x) =>
        x.type === "tool_call" && x.toolCallId === toolCallId
          ? { ...x, result: p.result }
          : x,
      );
    }

    case "agent:ask_user": {
      const toolCallId = p.toolCallId as string | undefined;
      if (toolCallId && parts.some((x) => x.type === "ask_user" && x.toolCallId === toolCallId)) {
        return parts;
      }
      const id = toolCallId ? `ask-${toolCallId}` : `ask-${seq.current++}`;
      return [
        ...parts,
        {
          type: "ask_user",
          question: (p.question ?? "") as string,
          options: p.options as string[] | undefined,
          toolCallId,
          id,
        },
      ];
    }

    case "step:started": {
      const taskId = (p.stepId ?? p.taskId) as string | undefined;
      if (taskId && parts.some((x) => x.type === "task" && x.taskId === taskId)) {
        return parts;
      }
      const id = taskId ? `task-${taskId}` : `task-${seq.current++}`;
      return [
        ...parts,
        {
          type: "task",
          task: (p.task ?? "") as string,
          taskId,
          status: "running" as const,
          id,
        },
      ];
    }

    case "step:completed": {
      const taskId = (p.stepId ?? p.taskId) as string | undefined;
      return parts.map((x) =>
        x.type === "task" && (taskId ? x.taskId === taskId : !x.taskId && x.task === (p.task as string))
          ? { ...x, status: "done" as const, result: typeof p.result === "string" ? p.result : undefined }
          : x,
      );
    }

    case "step:failed": {
      const taskId = (p.stepId ?? p.taskId) as string | undefined;
      return parts.map((x) =>
        x.type === "task" && (taskId ? x.taskId === taskId : !x.taskId && x.task === (p.task as string))
          ? { ...x, status: "error" as const, error: (p.error ?? p.message) as string | undefined }
          : x,
      );
    }

    case "agent:file_changed": {
      const path = p.path as string | undefined;
      if (!path) return parts;
      return [
        ...parts,
        {
          type: "file_changed" as const,
          path,
          additions: (p.additions ?? 0) as number,
          deletions: (p.deletions ?? 0) as number,
          unifiedDiffPreview: p.unifiedDiffPreview as string | undefined,
          id: `file-${seq.current++}`,
        },
      ];
    }

    case "agent:heartbeat":
    case "agent:step_persisted":
      return parts;

    default:
      return parts;
  }
}
