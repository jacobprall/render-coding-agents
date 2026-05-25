"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { Plus, FileUp, Code2, X, Square, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModelSelector } from "@/components/model-selector";
import { SkillSlashMenu, type SkillOption } from "./skill-slash-menu";

export type TurnSkillRef = { source: string; slug: string };

interface ChatInputProps {
  isStreaming: boolean;
  modelId: string;
  activeSkills?: TurnSkillRef[];
  onModelChange: (modelId: string) => void;
  onSend: (content: string, turnSkillRefs?: TurnSkillRef[]) => void;
  onStop: () => void;
}

export function ChatInput({
  isStreaming,
  modelId,
  activeSkills = [],
  onModelChange,
  onSend,
  onStop,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachedSkill, setAttachedSkill] = useState<TurnSkillRef | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);

  const skillOptions: SkillOption[] = useMemo(
    () =>
      activeSkills.map((s) => ({
        source: s.source,
        slug: s.slug,
        description: `${s.source} skill`,
      })),
    [activeSkills],
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
      if (inputAreaRef.current && !inputAreaRef.current.contains(e.target as Node)) {
        setSlashOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [input]);

  useEffect(() => {
    const slashMatch = input.match(/^\/([^\s]*)$/);
    if (slashMatch && skillOptions.length > 0) {
      setSlashOpen(true);
      setSlashFilter(slashMatch[1] ?? "");
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
      setSlashFilter("");
    }
  }, [input, skillOptions.length]);

  function canSend() {
    return Boolean(input.trim() || attachedSkill);
  }

  function submit() {
    if (!canSend() || isStreaming) return;
    const turnSkillRefs = attachedSkill ? [attachedSkill] : undefined;
    onSend(input.trim(), turnSkillRefs);
    setInput("");
    setAttachedSkill(null);
    setSlashOpen(false);
    textareaRef.current?.focus();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  function selectSkill(skill: SkillOption) {
    setAttachedSkill({ source: skill.source, slug: skill.slug });
    setInput("");
    setSlashOpen(false);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashOpen && skillOptions.length > 0) {
      const q = slashFilter.toLowerCase();
      const filtered = skillOptions.filter(
        (s) =>
          s.slug.toLowerCase().includes(q) ||
          s.source.toLowerCase().includes(q),
      );
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const pick = filtered[slashIndex];
        if (pick) selectSkill(pick);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div
      className="shrink-0 border-t border-stroke-subtle px-(--of-space-md) py-(--of-space-md)"
      style={{ paddingBottom: "max(var(--of-space-md), var(--safe-area-bottom))" }}
    >
      <form onSubmit={handleSubmit} className="mx-auto max-w-4xl">
        {attachedSkill ? (
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-stroke-subtle bg-surface-2 px-2.5 py-0.5 text-[11px] font-mono text-text-primary">
              /{attachedSkill.slug}
              <button
                type="button"
                onClick={() => setAttachedSkill(null)}
                className="rounded p-0.5 text-text-tertiary hover:text-text-primary"
                aria-label={`Remove skill ${attachedSkill.slug}`}
              >
                <X className="size-3" />
              </button>
            </span>
          </div>
        ) : null}
        <div
          ref={inputAreaRef}
          className="relative flex flex-col gap-1.5 border border-stroke-default bg-surface-1 p-2 transition-colors duration-(--of-duration-instant) focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/25"
        >
          {slashOpen ? (
            <SkillSlashMenu
              skills={skillOptions}
              filter={slashFilter}
              selectedIndex={slashIndex}
              onSelect={selectSkill}
              onClose={() => setSlashOpen(false)}
            />
          ) : null}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activeSkills.length > 0 ? "Message the agent… (type / for skills)" : "Message the agent…"}
            aria-label="Send a message"
            rows={1}
            className="max-h-48 w-full resize-none overflow-y-auto bg-transparent px-2 py-2 text-[15px] text-text-primary placeholder-text-tertiary outline-none"
          />

          <div className="flex items-center gap-2">
            <div ref={attachMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setAttachMenuOpen((open) => !open)}
                className={cn(
                  "flex h-10 w-10 items-center justify-center border border-stroke-subtle md:h-8 md:w-8",
                  "text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary",
                  attachMenuOpen && "bg-surface-2 text-text-primary",
                )}
                aria-label="Add attachment"
                aria-expanded={attachMenuOpen}
              >
                <Plus className="size-4" />
              </button>
              {attachMenuOpen ? (
                <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[180px] overflow-hidden rounded-md border border-stroke-default bg-surface-1 py-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => setAttachMenuOpen(false)}
                    className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
                  >
                    <FileUp className="size-3.5 shrink-0" />
                    Attach file
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttachMenuOpen(false)}
                    className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
                  >
                    <Code2 className="size-3.5 shrink-0" />
                    Reference code
                  </button>
                </div>
              ) : null}
            </div>

            <span className="min-w-0 flex-1">
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
                aria-label="Stop generation"
                className={cn(
                  "inline-flex shrink-0 items-center justify-center gap-1.5 bg-surface-3 text-sm font-medium text-text-secondary transition-colors duration-(--of-duration-instant) hover:bg-surface-2",
                  "h-11 min-w-[44px] px-4 md:h-9 md:px-3",
                )}
              >
                <Square className="size-3.5" fill="currentColor" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend()}
                aria-label="Send message"
                className={cn(
                  "inline-flex shrink-0 items-center justify-center gap-1.5 bg-primary text-sm font-semibold text-white transition-colors duration-(--of-duration-instant) hover:bg-primary/60",
                  "h-11 min-w-[44px] px-4 md:h-9 md:px-3",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <Send className="size-3.5" />
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
