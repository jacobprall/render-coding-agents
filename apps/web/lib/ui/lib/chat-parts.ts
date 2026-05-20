import type { StreamEvent } from "@openforge/shared";

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

export type AssistantPart =
  | AssistantTextPart
  | AssistantToolCallPart
  | AssistantAskUserPart
  | AssistantTaskPart
  | AssistantFileChangedPart;

export function appendStreamEvent(
  parts: AssistantPart[],
  event: StreamEvent,
  seqCounter?: { current: number },
): AssistantPart[] {
  const seq = seqCounter ?? { current: 0 };
  switch (event.type) {
    case "token": {
      if (!event.token) return parts;
      const last = parts[parts.length - 1];
      if (last?.type === "text") {
        return [...parts.slice(0, -1), { ...last, text: last.text + event.token }];
      }
      return [
        ...parts,
        { type: "text", text: event.token, id: `text-${seq.current++}` },
      ];
    }

    case "tool_call": {
      if (!event.toolCallId) return parts;
      if (
        parts.some(
          (p) =>
            p.type === "tool_call" &&
            (p.toolCallId === event.toolCallId || p.id === event.toolCallId),
        )
      ) {
        return parts;
      }
      return [
        ...parts,
        {
          type: "tool_call",
          toolName: event.toolName ?? "tool",
          toolCallId: event.toolCallId,
          args: event.args,
          id: event.toolCallId,
        },
      ];
    }

    case "tool_result": {
      if (!event.toolCallId) return parts;
      return parts.map((p) =>
        p.type === "tool_call" && p.toolCallId === event.toolCallId
          ? { ...p, result: event.result }
          : p,
      );
    }

    case "ask_user": {
      const toolCallId = event.toolCallId;
      if (
        toolCallId &&
        parts.some(
          (p) =>
            p.type === "ask_user" &&
            (p.toolCallId === toolCallId || p.id === `ask-${toolCallId}`),
        )
      ) {
        return parts;
      }
      const id = toolCallId ? `ask-${toolCallId}` : `ask-${seq.current++}`;
      return [
        ...parts,
        {
          type: "ask_user",
          question: event.question ?? "",
          options: event.options,
          toolCallId,
          id,
        },
      ];
    }

    case "task_start": {
      const taskId = event.taskId;
      if (
        taskId &&
        parts.some(
          (p) => p.type === "task" && (p.taskId === taskId || p.id === `task-${taskId}`),
        )
      ) {
        return parts;
      }
      const id = taskId ? `task-${taskId}` : `task-${seq.current++}`;
      return [
        ...parts,
        {
          type: "task",
          task: event.task ?? "",
          taskId,
          status: "running" as const,
          id,
        },
      ];
    }

    case "task_done": {
      return parts.map((p) =>
        p.type === "task" &&
        (event.taskId ? p.taskId === event.taskId : !p.taskId && p.task === event.task)
          ? {
              ...p,
              status: "done" as const,
              result: typeof event.result === "string" ? event.result : undefined,
            }
          : p,
      );
    }

    case "task_error": {
      return parts.map((p) =>
        p.type === "task" &&
        (event.taskId ? p.taskId === event.taskId : !p.taskId && p.task === event.task)
          ? { ...p, status: "error" as const, error: event.message }
          : p,
      );
    }

    case "file_changed": {
      if (!event.path) return parts;
      return [
        ...parts,
        {
          type: "file_changed" as const,
          path: event.path,
          additions: event.additions ?? 0,
          deletions: event.deletions ?? 0,
          unifiedDiffPreview: event.unifiedDiffPreview,
          id: `file-${seq.current++}`,
        },
      ];
    }

    default:
      return parts;
  }
}
