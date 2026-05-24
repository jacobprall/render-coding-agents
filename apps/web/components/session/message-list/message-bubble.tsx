"use client";

import { FileText } from "lucide-react";
import type { AssistantFileAttachmentPart } from "@/lib/ui";
import type { Message } from "../chat-reducer";
import { AssistantParts } from "./assistant-parts";
import { cn } from "@/lib/utils";

function formatTimestamp(createdAt?: string | null) {
  if (!createdAt) return null;
  return new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function truncateFilename(name: string, maxLen = 28) {
  if (name.length <= maxLen) return name;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const base = name.slice(0, name.length - ext.length);
  const keep = maxLen - ext.length - 1;
  return `${base.slice(0, Math.max(keep, 8))}…${ext}`;
}

function formatLineRange(start?: number, end?: number) {
  if (start == null && end == null) return null;
  if (start != null && end != null) return `(${start}-${end})`;
  if (start != null) return `(${start}-)`;
  return `(1-${end})`;
}

function resolveAttachmentPath(attachment: AssistantFileAttachmentPart): string {
  if (attachment.path) return attachment.path;
  return attachment.filename.startsWith("/")
    ? attachment.filename
    : `/${attachment.filename}`;
}

function FileAttachmentChip({
  attachment,
  onFileSelect,
}: {
  attachment: AssistantFileAttachmentPart;
  onFileSelect?: (path: string) => void;
}) {
  const lineRange = formatLineRange(attachment.lineStart, attachment.lineEnd);
  const path = resolveAttachmentPath(attachment);

  const content = (
    <>
      <FileText className="size-3 shrink-0 opacity-80" />
      <span className="truncate">{truncateFilename(attachment.filename)}</span>
      {lineRange ? <span className="shrink-0 opacity-80">{lineRange}</span> : null}
    </>
  );

  if (!onFileSelect) {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[hsl(163,40%,12%)] px-2.5 py-1 text-[12px] text-[#4ec9b0]">
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onFileSelect(path)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[hsl(163,40%,12%)] px-2.5 py-1 text-[12px] text-[#4ec9b0] transition-colors hover:bg-[hsl(163,40%,16%)]"
    >
      {content}
    </button>
  );
}

export function MessageBubble({
  message,
  onFileSelect,
}: {
  message: Message;
  onFileSelect?: (path: string) => void;
}) {
  const isUser = message.role === "user";
  const timestamp = formatTimestamp(message.createdAt);
  const attachments = message.parts.filter(
    (p): p is AssistantFileAttachmentPart => p.type === "file_attachment",
  );

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1 [content-visibility:auto]">
        <div
          className={cn(
            "max-w-[80%] rounded-lg bg-[hsl(220,8%,16%)] px-4 py-2.5",
            "text-[15px] leading-relaxed text-text-primary",
          )}
        >
          {message.parts
            .filter((p) => p.type === "text")
            .map((p, i) => (
              <p key={"id" in p && p.id ? p.id : `text-${i}`} className="whitespace-pre-wrap">
                {p.text}
              </p>
            ))}
          {attachments.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((attachment, i) => (
                <FileAttachmentChip
                  key={attachment.id ?? `${attachment.filename}-${i}`}
                  attachment={attachment}
                  onFileSelect={onFileSelect}
                />
              ))}
            </div>
          ) : null}
        </div>
        {timestamp ? (
          <span className="mr-1 text-[11px] text-text-tertiary">{timestamp}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 [content-visibility:auto]">
      <AssistantParts parts={message.parts} createdAt={message.createdAt} onFileSelect={onFileSelect} />
    </div>
  );
}
