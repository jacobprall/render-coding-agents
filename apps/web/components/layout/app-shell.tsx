"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePanelResize } from "@/hooks/use-panel-resize";
import { useLayoutState } from "@/hooks/use-layout-state";
import { Sidebar } from "./sidebar";
import { SessionTabs } from "./session-tabs";
import { RightPanel } from "./right-panel";
import { PanelResizer } from "./panel-resizer";
import { StatusBar } from "./status-bar";
import { useSessionTabsSync } from "./use-session-tabs-sync";
import { RightPanelProvider, useRightPanel } from "./right-panel-context";
import type { LayoutState } from "@/hooks/use-layout-state";

interface AppShellProps {
  user: {
    username: string;
    avatarUrl: string;
  };
  children: React.ReactNode;
}

const CHAT_MIN_WIDTH = 450;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const RIGHT_PANEL_MIN = 300;
const RIGHT_PANEL_MAX = 600;

type LayoutStateReturn = LayoutState & {
  hydrated: boolean;
  setSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setSidebarWidth: (width: number) => void;
  setRightPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setRightPanelWidth: (width: number) => void;
  setRightPanelMode: (mode: import("./right-panel-context").RightPanelMode) => void;
  toggleRightPanelMode: (
    mode: Exclude<import("./right-panel-context").RightPanelMode, "closed">,
  ) => void;
  toggleSidebar: () => void;
};

interface AppShellGridProps extends AppShellProps {
  layout: LayoutStateReturn;
  rightPanelResize: ReturnType<typeof usePanelResize>;
}

function AppShellGrid({ user, children, layout, rightPanelResize }: AppShellGridProps) {
  useSessionTabsSync();

  const {
    hydrated,
    sidebarOpen,
    sidebarWidth,
    setSidebarOpen,
    setSidebarWidth,
    setRightPanelOpen,
    setRightPanelMode,
    toggleSidebar,
  } = layout;

  const {
    mode: rightPanelMode,
    setMode: setRightPanelModeContext,
    sessionId,
    selectedPath,
    openFile,
    setWidth: setContextWidth,
  } = useRightPanel();

  const rightPanelOpen = rightPanelMode !== "closed";

  const sidebarResize = usePanelResize({
    direction: "horizontal",
    initialSize: sidebarWidth,
    minSize: SIDEBAR_MIN,
    maxSize: SIDEBAR_MAX,
    size: sidebarWidth,
    onSizeChange: setSidebarWidth,
  });

  useEffect(() => {
    setContextWidth(rightPanelResize.size);
  }, [rightPanelResize.size, setContextWidth]);

  useEffect(() => {
    if (!hydrated) return;
    setRightPanelMode(rightPanelMode);
  }, [hydrated, rightPanelMode, setRightPanelMode]);

  const handleRightPanelModeChange = useCallback(
    (mode: Parameters<typeof setRightPanelModeContext>[0]) => {
      setRightPanelModeContext(mode);
      setRightPanelMode(mode);
    },
    [setRightPanelMode, setRightPanelModeContext],
  );

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [toggleSidebar]);

  useEffect(() => {
    if (!hydrated) return;

    function enforceViewportConstraints() {
      const viewport = window.innerWidth;
      const sidebarSpace = sidebarOpen ? sidebarResize.size + 4 : 0;
      const rightSpace = rightPanelOpen ? rightPanelResize.size + 4 : 0;
      const required = sidebarSpace + rightSpace + CHAT_MIN_WIDTH;

      if (required <= viewport) return;

      if (rightPanelOpen) {
        handleRightPanelModeChange("closed");
        setRightPanelOpen(false);
        return;
      }

      if (sidebarOpen) {
        setSidebarOpen(false);
      }
    }

    enforceViewportConstraints();
    window.addEventListener("resize", enforceViewportConstraints);
    return () => window.removeEventListener("resize", enforceViewportConstraints);
  }, [
    hydrated,
    handleRightPanelModeChange,
    rightPanelOpen,
    rightPanelResize.size,
    setRightPanelOpen,
    setSidebarOpen,
    sidebarOpen,
    sidebarResize.size,
  ]);

  const gridTemplateColumns = useMemo(() => {
    const sidebarCol = sidebarOpen ? `${sidebarResize.size}px` : "0px";
    const sidebarHandleCol = sidebarOpen ? "4px" : "0px";
    const rightCol = rightPanelOpen ? `${rightPanelResize.size}px` : "0px";
    const rightHandleCol = rightPanelOpen ? "4px" : "0px";
    return `${sidebarCol} ${sidebarHandleCol} minmax(var(--chat-min-width), 1fr) ${rightHandleCol} ${rightCol}`;
  }, [sidebarOpen, sidebarResize.size, rightPanelOpen, rightPanelResize.size]);

  const handleClearSelection = useCallback(() => {
    openFile("");
  }, [openFile]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={
          {
            gridTemplateColumns,
            transition: "grid-template-columns var(--panel-transition)",
            "--sidebar-width": `${sidebarResize.size}px`,
            "--right-panel-width": `${rightPanelResize.size}px`,
          } as React.CSSProperties
        }
      >
        <div className="min-h-0 overflow-hidden">
          <Sidebar user={user} open={sidebarOpen} />
        </div>

        {sidebarOpen ? (
          <PanelResizer handleProps={sidebarResize.handleProps} />
        ) : (
          <div className="w-0" aria-hidden />
        )}

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <SessionTabs
            onToggleSidebar={toggleSidebar}
            sidebarOpen={sidebarOpen}
            rightPanelMode={rightPanelMode}
            onRightPanelModeChange={handleRightPanelModeChange}
          />
          <main className="relative min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>

        {rightPanelOpen ? (
          <PanelResizer handleProps={rightPanelResize.handleProps} />
        ) : (
          <div className="w-0" aria-hidden />
        )}

        <div className="min-h-0 overflow-hidden">
          {sessionId ? (
            <RightPanel
              mode={rightPanelMode}
              sessionId={sessionId}
              onModeChange={handleRightPanelModeChange}
              width={rightPanelResize.size}
              selectedPath={selectedPath}
              onClearSelection={handleClearSelection}
            />
          ) : null}
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

export function AppShell(props: AppShellProps) {
  const layout = useLayoutState();

  const rightPanelResize = usePanelResize({
    direction: "horizontal",
    initialSize: layout.rightPanelWidth,
    minSize: RIGHT_PANEL_MIN,
    maxSize: RIGHT_PANEL_MAX,
    invertDrag: true,
    size: layout.hydrated ? layout.rightPanelWidth : 400,
    onSizeChange: layout.setRightPanelWidth,
  });

  return (
    <RightPanelProvider
      width={rightPanelResize.size}
      setWidth={rightPanelResize.setSize}
      initialMode={layout.hydrated ? layout.rightPanelMode : "closed"}
    >
      <AppShellGrid {...props} layout={layout} rightPanelResize={rightPanelResize} />
    </RightPanelProvider>
  );
}
