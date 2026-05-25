"use client";

import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSessionsListState } from "./sessions-list-context";
import { STATUS_DOT } from "./sessions-list-utils";
import type { SessionItem } from "./sessions-list-context";

interface SessionsListItemProps {
  session: SessionItem;
  index?: number;
  active?: boolean;
  focused?: boolean;
  disabled?: boolean;
  actions?: ReactNode;
  className?: string;
  onClick?: () => void;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

const SessionsListItem = forwardRef<HTMLButtonElement, SessionsListItemProps>(
  function SessionsListItem(
    {
      session,
      active,
      focused,
      disabled,
      actions,
      className,
      onClick,
      onFocus,
      onKeyDown,
      onContextMenu,
    },
    ref,
  ) {
    const { selectSession, pendingId } = useSessionsListState();
    const isPending = disabled || pendingId === session.id;

    return (
      <button
        ref={ref}
        type="button"
        tabIndex={focused ? 0 : -1}
        onClick={onClick ?? (() => selectSession(session.id))}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        disabled={isPending}
        className={cn(
          "group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
          isPending && "pointer-events-none opacity-40",
          active
            ? "bg-primary/10 text-foreground"
            : focused
              ? "bg-muted/50 text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          className,
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            STATUS_DOT[session.status] ?? "bg-muted-foreground",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {session.title || "Untitled"}
        </span>
        {actions}
      </button>
    );
  },
);
SessionsListItem.displayName = "SessionsList.Item";

export { SessionsListItem };
