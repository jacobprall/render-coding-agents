"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import type { AssistantPart } from "@/lib/ui";
import { cn } from "@/lib/utils";

const ToolCallLazy = dynamic(
  () => import("@/components/tool-call").then((m) => ({ default: m.ToolCall })),
  { ssr: false, loading: () => <span className="text-xs text-text-tertiary">…</span> },
);

const TRUNCATE_CHAR_LIMIT = 4000;
const TRUNCATE_LINE_LIMIT = 80;

/** Bubble wrapper for assistant prose only — tool calls render outside. */
export function AssistantMessageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-[80%] rounded-lg bg-[hsl(220,8%,13%)] px-4 py-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

type TextSegment = { kind: "text"; parts: AssistantPart[] };
type InlineSegment = { kind: "inline"; part: AssistantPart; index: number };
type PartSegment = TextSegment | InlineSegment;

function isInlinePart(part: AssistantPart): boolean {
  return (
    part.type === "tool_call" ||
    part.type === "file_changed" ||
    part.type === "task"
  );
}

function segmentParts(parts: AssistantPart[]): PartSegment[] {
  const segments: PartSegment[] = [];
  let textBuffer: AssistantPart[] = [];

  const flushText = () => {
    const nonEmpty = textBuffer.filter(
      (p) => p.type !== "text" || p.text.trim().length > 0,
    );
    if (nonEmpty.length > 0) {
      segments.push({ kind: "text", parts: nonEmpty });
    }
    textBuffer = [];
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.type === "text") {
      textBuffer.push(part);
    } else if (part.type === "ask_user") {
      continue;
    } else if (isInlinePart(part)) {
      flushText();
      segments.push({ kind: "inline", part, index: i });
    }
  }

  flushText();
  return segments;
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function partKey(part: AssistantPart, index: number): string {
  if ("id" in part && part.id) return part.id;
  if (part.type === "tool_call" && part.toolCallId) return part.toolCallId;
  if (part.type === "task" && part.taskId) return `task-${part.taskId}`;
  return `${part.type}-${index}`;
}

function shouldTruncateText(text: string): boolean {
  if (text.length > TRUNCATE_CHAR_LIMIT) return true;
  return text.split("\n").length > TRUNCATE_LINE_LIMIT;
}

function truncateText(text: string): string {
  const lines = text.split("\n");
  if (lines.length > TRUNCATE_LINE_LIMIT) {
    return lines.slice(0, TRUNCATE_LINE_LIMIT).join("\n");
  }
  return text.slice(0, TRUNCATE_CHAR_LIMIT);
}

function TruncatedAgentText({ text, streaming }: { text: string; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = !streaming && shouldTruncateText(text);

  if (!needsTruncation) {
    return (
      <div className="min-w-0 text-[15px] leading-relaxed text-text-primary">
        <Markdown>{text}</Markdown>
      </div>
    );
  }

  const displayText = expanded ? text : truncateText(text);

  return (
    <div className="min-w-0">
      {!expanded ? (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-stroke-subtle bg-muted/20 px-3 py-2">
          <span className="text-[13px] text-muted-foreground">Message is too long to display</span>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="shrink-0 text-[13px] font-medium text-accent-text transition-colors hover:text-text-primary"
          >
            Expand
          </button>
        </div>
      ) : null}
      <div className={cn("min-w-0 text-[15px] leading-relaxed text-text-primary", !expanded && "opacity-90")}>
        <Markdown>{displayText}</Markdown>
      </div>
      {expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-2 text-[13px] font-medium text-accent-text transition-colors hover:text-text-primary"
        >
          Collapse
        </button>
      ) : null}
    </div>
  );
}

function InlinePart({
  part,
  index,
  streaming,
  onFileSelect,
}: {
  part: AssistantPart;
  index: number;
  streaming?: boolean;
  onFileSelect?: (path: string) => void;
}) {
  const key = partKey(part, index);

  switch (part.type) {
    case "tool_call":
      return (
        <div key={key} className="flex w-full min-w-0 justify-start self-start">
          <ToolCallLazy
            toolName={part.toolName ?? "tool"}
            args={part.args as Record<string, unknown> | undefined}
            result={part.result as Record<string, unknown> | undefined}
            status={part.result !== undefined ? "success" : streaming ? "running" : "idle"}
          />
        </div>
      );

    case "file_changed":
      return onFileSelect ? (
        <button
          key={key}
          type="button"
          onClick={() => onFileSelect(part.path)}
          className="inline-flex items-center gap-1.5 text-[11px] border border-stroke-subtle px-2 py-1 bg-surface-1 transition-colors hover:bg-surface-2 hover:border-stroke-default"
        >
          <span className="text-accent-text/80 tabular-nums font-mono">+{part.additions}</span>
          <span className="text-text-tertiary">/</span>
          <span className="text-danger/80 tabular-nums font-mono">-{part.deletions}</span>
          <span className="ml-1 font-mono text-text-tertiary break-all">{part.path}</span>
        </button>
      ) : (
        <div
          key={key}
          className="inline-flex items-center gap-1.5 text-[11px] border border-stroke-subtle px-2 py-1 bg-surface-1"
        >
          <span className="text-accent-text/80 tabular-nums font-mono">+{part.additions}</span>
          <span className="text-text-tertiary">/</span>
          <span className="text-danger/80 tabular-nums font-mono">-{part.deletions}</span>
          <span className="ml-1 font-mono text-text-tertiary break-all">{part.path}</span>
        </div>
      );

    case "task":
      return (
        <div
          key={key}
          className="flex items-center gap-1.5 text-[11px] border border-stroke-subtle px-2.5 py-1.5 bg-surface-1"
        >
          {part.status === "running" ? (
            <span className="inline-flex animate-spin text-warning/80">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </span>
          ) : null}
          {part.status === "done" ? (
            <svg className="h-3 w-3 text-accent-text/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : null}
          {part.status === "error" ? (
            <svg className="h-3 w-3 text-danger/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : null}
          <span className="text-text-secondary">{part.task}</span>
          {part.result != null && String(part.result).length > 0 ? (
            <span className="ml-auto text-text-tertiary">{String(part.result)}</span>
          ) : null}
          {part.error != null && String(part.error).length > 0 ? (
            <span className="ml-auto text-danger/80">{String(part.error)}</span>
          ) : null}
        </div>
      );

    default:
      return null;
  }
}

export function AssistantParts({
  parts,
  streaming,
  createdAt,
  onFileSelect,
}: {
  parts: AssistantPart[];
  streaming?: boolean;
  createdAt?: string | null;
  onFileSelect?: (path: string) => void;
}) {
  const segments = segmentParts(parts);

  let lastTextIndex = -1;
  for (let j = parts.length - 1; j >= 0; j--) {
    if (parts[j]?.type === "text") {
      lastTextIndex = j;
      break;
    }
  }

  return (
    <div className="flex w-full flex-col items-start gap-2">
      {segments.map((segment, segIndex) => {
        if (segment.kind === "text") {
          return (
            <AssistantMessageShell key={`text-${segIndex}`}>
              <div className="flex flex-col gap-1.5">
                {segment.parts.map((part, i) => {
                  if (part.type !== "text") return null;
                  const globalIndex = parts.indexOf(part);
                  const showTime =
                    Boolean(createdAt) && !streaming && lastTextIndex === globalIndex;
                  const key = partKey(part, globalIndex >= 0 ? globalIndex : i);
                  return (
                    <div key={key} className="flex w-full min-w-0 flex-col items-start gap-1">
                      <TruncatedAgentText text={part.text} streaming={streaming} />
                      {showTime && createdAt ? (
                        <span className="ml-1 text-[11px] text-text-tertiary">
                          {formatTimestamp(createdAt)}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </AssistantMessageShell>
          );
        }

        return (
          <InlinePart
            key={partKey(segment.part, segment.index)}
            part={segment.part}
            index={segment.index}
            streaming={streaming}
            onFileSelect={onFileSelect}
          />
        );
      })}
      {streaming ? (
        <span className="inline-flex items-center gap-0.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-[orb-float_1.4s_ease-in-out_infinite]" />
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-[orb-float_1.4s_ease-in-out_0.2s_infinite]" />
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-[orb-float_1.4s_ease-in-out_0.4s_infinite]" />
        </span>
      ) : null}
    </div>
  );
}
