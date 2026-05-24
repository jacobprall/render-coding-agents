"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { Plus, FileUp, Code2, X } from "lucide-react";
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
    <div className="shrink-0 border-t border-stroke-subtle px-(--of-space-md) py-(--of-space-md)" style={{ paddingBottom: "max(var(--of-space-md), var(--safe-area-bottom))" }}>
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
          className="relative flex items-end gap-2 border border-stroke-default bg-surface-1 p-2 transition-colors duration-(--of-duration-instant) focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/25"
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
            placeholder={activeSkills.length > 0 ? "Message the agent… (type / for skills)" : "Message the agent…"}
            aria-label="Send a message"
            rows={1}
            className="max-h-48 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-[15px] text-text-primary placeholder-text-tertiary outline-none"
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
                disabled={!canSend()}
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
