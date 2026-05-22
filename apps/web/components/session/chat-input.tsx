"use client";

import { useRef, useState, useEffect } from "react";
import { Plus, FileUp, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModelSelector } from "@/components/model-selector";

interface ChatInputProps {
  isStreaming: boolean;
  modelId: string;
  onModelChange: (modelId: string) => void;
  onSend: (content: string) => void;
  onStop: () => void;
}

export function ChatInput({ isStreaming, modelId, onModelChange, onSend, onStop }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    onSend(input);
    setInput("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() || isStreaming) return;
      onSend(input);
      setInput("");
      textareaRef.current?.focus();
    }
  }

  return (
    <div className="shrink-0 border-t border-stroke-subtle px-(--of-space-md) py-(--of-space-md)" style={{ paddingBottom: "max(var(--of-space-md), var(--safe-area-bottom))" }}>
      <form onSubmit={handleSubmit} className="mx-auto max-w-4xl">
        <div className="flex items-end gap-2 border border-stroke-default bg-surface-1 p-2 transition-colors duration-(--of-duration-instant) focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/25">
          <div ref={attachMenuRef} className="relative hidden shrink-0 md:block">
            <button
              type="button"
              onClick={() => setAttachMenuOpen((open) => !open)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border border-stroke-subtle",
                "text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary",
                attachMenuOpen && "bg-surface-2 text-text-primary",
              )}
              aria-label="Add attachment"
            >
              <Plus className="size-4" />
            </button>
            {attachMenuOpen ? (
              <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[160px] overflow-hidden rounded-md border border-stroke-default bg-surface-1 py-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => setAttachMenuOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
                >
                  <FileUp className="size-3.5 shrink-0" />
                  Attach file
                </button>
                <button
                  type="button"
                  onClick={() => setAttachMenuOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
                >
                  <Code2 className="size-3.5 shrink-0" />
                  Reference code
                </button>
              </div>
            ) : null}
          </div>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message the agent…"
            aria-label="Send a message"
            rows={1}
            className="max-h-36 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-text-primary placeholder-text-tertiary outline-none"
          />

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden md:block">
              <ModelSelector
                value={modelId}
                onChange={onModelChange}
                compact
                inline
                dropUp
              />
            </span>
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="flex items-center gap-1.5 bg-surface-3 px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors duration-(--of-duration-instant) hover:bg-surface-2"
              >
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="0" />
                </svg>
                <span className="hidden md:inline">Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex items-center gap-1.5 bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors duration-(--of-duration-instant) hover:bg-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                  />
                </svg>
                <span className="hidden md:inline">Send</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
