"use client";

import { cn } from "@/lib/utils";
import { useFileBrowserContext } from "./file-browser-context";

function FileBrowserTabs({ className }: { className?: string }) {
  const { subView, setSubView, changeCount } = useFileBrowserContext();

  return (
    <div className={cn("flex shrink-0 items-center gap-0.5 border-b border-stroke-subtle px-3", className)}>
      <TabButton active={subView === "tree"} onClick={() => setSubView("tree")}>
        Explorer
      </TabButton>
      <TabButton
        active={subView === "changes"}
        onClick={() => setSubView("changes")}
        badge={changeCount > 0 ? changeCount : undefined}
      >
        Changes
      </TabButton>
    </div>
  );
}
FileBrowserTabs.displayName = "FileBrowser.Tabs";

function TabButton({
  active,
  onClick,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-[11px] font-medium transition-colors duration-(--of-duration-instant)",
        active
          ? "border-b-2 border-accent text-text-primary"
          : "border-b-2 border-transparent text-text-tertiary hover:text-text-secondary",
      )}
    >
      {children}
      {badge !== undefined ? (
        <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-surface-3 px-1 text-[9px] tabular-nums text-text-secondary">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export { FileBrowserTabs };
