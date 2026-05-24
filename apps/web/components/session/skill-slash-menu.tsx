"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface SkillOption {
  source: string;
  slug: string;
  description?: string;
}

interface SkillSlashMenuProps {
  skills: SkillOption[];
  filter: string;
  selectedIndex: number;
  onSelect: (skill: SkillOption) => void;
  onClose: () => void;
}

export function SkillSlashMenu({
  skills,
  filter,
  selectedIndex,
  onSelect,
  onClose,
}: SkillSlashMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const q = filter.toLowerCase();
  const filtered = skills.filter(
    (s) =>
      s.slug.toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q) ||
      (s.description?.toLowerCase().includes(q) ?? false),
  );

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, filtered.length]);

  if (filtered.length === 0) {
    return (
      <div
        role="listbox"
        aria-label="Skills"
        className="absolute bottom-full left-0 z-50 mb-2 w-full min-w-[240px] max-w-md overflow-hidden rounded-md border border-stroke-default bg-surface-1 py-2 shadow-xl"
      >
        <p className="px-3 py-2 text-sm text-text-tertiary">No matching skills</p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Skills"
      className="absolute bottom-full left-0 z-50 mb-2 max-h-56 w-full min-w-[240px] max-w-md overflow-y-auto rounded-md border border-stroke-default bg-surface-1 py-1 shadow-xl"
    >
      {filtered.map((skill, i) => (
        <button
          key={`${skill.source}:${skill.slug}`}
          type="button"
          role="option"
          data-index={i}
          aria-selected={i === selectedIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(skill);
          }}
          className={cn(
            "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors",
            i === selectedIndex
              ? "bg-surface-2 text-text-primary"
              : "text-text-secondary hover:bg-surface-2/60",
          )}
        >
          <span className="font-medium font-mono text-xs">{skill.slug}</span>
          <span className="text-[11px] text-text-tertiary">
            {skill.description ?? `${skill.source} skill`}
          </span>
        </button>
      ))}
      <button type="button" className="sr-only" onClick={onClose} tabIndex={-1}>
        Close
      </button>
    </div>
  );
}
