"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectNativeProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  className?: string;
  size?: "sm" | "md";
  icon?: React.ReactNode;
}

export function SelectNative({
  options,
  value: controlledValue,
  defaultValue,
  onChange,
  placeholder,
  disabled,
  name,
  className,
  size = "md",
  icon,
}: SelectNativeProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const value = controlledValue !== undefined ? controlledValue : internalValue;

  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption?.label ?? placeholder ?? "Select…";
  const isPlaceholder = !selectedOption;

  const handleSelect = useCallback(
    (optionValue: string) => {
      if (controlledValue === undefined) setInternalValue(optionValue);
      onChange?.(optionValue);
      setOpen(false);
    },
    [controlledValue, onChange],
  );

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setFocusedIndex(idx >= 0 ? idx : 0);
    }
  }, [open, options, value]);

  useEffect(() => {
    if (!open || focusedIndex < 0) return;
    const item = listRef.current?.children[focusedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [open, focusedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case "Enter":
        case " ":
          e.preventDefault();
          if (!open) {
            setOpen(true);
          } else if (focusedIndex >= 0 && !options[focusedIndex]?.disabled) {
            handleSelect(options[focusedIndex].value);
          }
          break;
        case "ArrowDown":
          e.preventDefault();
          if (!open) {
            setOpen(true);
          } else {
            setFocusedIndex((prev) => {
              let next = prev + 1;
              while (next < options.length && options[next]?.disabled) next++;
              return next < options.length ? next : prev;
            });
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (open) {
            setFocusedIndex((prev) => {
              let next = prev - 1;
              while (next >= 0 && options[next]?.disabled) next--;
              return next >= 0 ? next : prev;
            });
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
        case "Tab":
          setOpen(false);
          break;
      }
    },
    [disabled, open, focusedIndex, options, handleSelect],
  );

  const sizeClasses =
    size === "sm"
      ? "min-h-[30px] px-2.5 py-1 text-[13px]"
      : "min-h-[36px] px-3 py-2 text-sm";

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => !disabled && setOpen((p) => !p)}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex w-full items-center gap-2 border border-input bg-muted text-left transition-colors",
          "focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-ring ring-1 ring-ring",
          sizeClasses,
        )}
      >
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
        <span className={cn("flex-1 truncate", isPlaceholder && "text-muted-foreground")}>
          {displayLabel}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute left-0 z-50 mt-1 max-h-60 w-full min-w-[160px] overflow-y-auto border border-border bg-popover py-1 shadow-xl"
        >
          {placeholder && (
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              onClick={() => handleSelect("")}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                value === ""
                  ? "bg-accent/10 text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="flex-1 truncate">{placeholder}</span>
              {value === "" && <Check className="h-3 w-3 shrink-0" />}
            </button>
          )}
          {options.map((option, idx) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              disabled={option.disabled}
              onClick={() => !option.disabled && handleSelect(option.value)}
              onMouseEnter={() => setFocusedIndex(idx)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                option.disabled && "cursor-not-allowed opacity-50",
                value === option.value && "bg-accent/10 text-accent-foreground",
                focusedIndex === idx && value !== option.value && "bg-muted",
                value !== option.value && focusedIndex !== idx && "text-foreground",
                !option.disabled && "hover:bg-muted",
              )}
            >
              <span className="flex-1 truncate">{option.label}</span>
              {value === option.value && <Check className="h-3 w-3 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { SelectNative as Select };
export type { SelectNativeProps as SelectProps };
