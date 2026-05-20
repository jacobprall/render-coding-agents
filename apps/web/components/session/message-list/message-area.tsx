"use client";

import { useState } from "react";
import type { AssistantPart } from "@/lib/ui";
import type { Message, LiveFileChange } from "../chat-reducer";
import { AskUserCard } from "../ask-user-card";
import { AssistantParts } from "./assistant-parts";
import { MessageBubble } from "./message-bubble";

export function MessageArea({
  messages,
  streamingParts,
  isStreaming,
  liveFileChanges,
  askResolved,
  onAskUserResponse,
  onViewFiles,
  error,
}: {
  messages: Message[];
  streamingParts: AssistantPart[];
  isStreaming: boolean;
  liveFileChanges: LiveFileChange[];
  askResolved: { question?: string; options?: string[] } | null;
  onAskUserResponse: (answer: string) => void;
  onViewFiles?: () => void;
  error: string | null;
}) {
  const [filesPanelOpen, setFilesPanelOpen] = useState(true);

  return (
    <>
      {liveFileChanges.length > 0 && (
        <div className="border border-stroke-subtle bg-surface-1 overflow-hidden">
          <div className="flex items-center justify-between px-(--of-space-md) py-(--of-space-sm)">
            <button
              type="button"
              className="flex items-center gap-1.5 text-left text-xs font-medium text-text-secondary transition-colors duration-(--of-duration-instant) hover:text-text-primary"
              onClick={() => setFilesPanelOpen((o) => !o)}
            >
              <span>Files changed — {liveFileChanges.length}</span>
              <svg
                className={`h-3.5 w-3.5 text-text-tertiary transition-transform duration-(--of-duration-fast) ${filesPanelOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {onViewFiles && (
              <button
                type="button"
                onClick={onViewFiles}
                className="text-[11px] text-accent-text transition-colors duration-(--of-duration-instant) hover:text-text-primary"
              >
                View all
              </button>
            )}
          </div>
          {filesPanelOpen ? (
            <ul className="divide-y divide-stroke-subtle/50 border-t border-stroke-subtle max-h-48 overflow-y-auto text-xs font-mono px-(--of-space-md) py-1 contain-content">
              {liveFileChanges.map((f) => (
                <li key={f.path} className="py-1.5 flex justify-between gap-2">
                  <span className="truncate text-text-tertiary">{f.path}</span>
                  <span className="shrink-0 tabular-nums">
                    <span className="text-accent-text">+{f.additions}</span>
                    <span className="text-text-tertiary mx-1">/</span>
                    <span className="text-danger">-{f.deletions}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {messages.length === 0 && !isStreaming ? (
        <div className="flex flex-col items-center justify-center py-32 text-center gap-(--of-space-md)">
          <div className="flex h-12 w-12 items-center justify-center bg-accent-bg">
            <svg
              className="h-6 w-6 text-accent-text"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"
              />
            </svg>
          </div>
          <p className="font-medium text-text-primary">Start a conversation</p>
          <p className="text-[15px] text-text-tertiary">Ask the agent to help with your codebase.</p>
        </div>
      ) : (
        messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
      )}

      {isStreaming && streamingParts.length > 0 ? (
        <div className="[content-visibility:auto]">
          <AssistantParts parts={streamingParts} streaming />
        </div>
      ) : null}

      {isStreaming && streamingParts.length === 0 ? (
        <div className="flex items-center gap-2.5 text-xs text-text-tertiary">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-accent/70 animate-[bounce_1.4s_ease-in-out_infinite]" />
            <span className="h-1.5 w-1.5 rounded-full bg-accent/70 animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
            <span className="h-1.5 w-1.5 rounded-full bg-accent/70 animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
          </span>
          Thinking…
        </div>
      ) : null}

      {askResolved ? (
        <AskUserCard ask={askResolved} onRespond={onAskUserResponse} />
      ) : null}

      {error ? (
        <div className="border border-danger/20 bg-danger/5 p-(--of-space-md)">
          <p className="text-[15px] text-danger">{error}</p>
        </div>
      ) : null}
    </>
  );
}
