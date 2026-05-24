"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { usePanelResize } from "@/hooks/use-panel-resize";
import { useLayoutState } from "@/hooks/use-layout-state";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { Sidebar } from "./sidebar";
import { SessionTabs } from "./session-tabs";
import { RightPanel } from "./right-panel";
import { PanelResizer } from "./panel-resizer";
import { useSessionTabsSync } from "./use-session-tabs-sync";
import { RightPanelProvider, useRightPanel } from "./right-panel-context";
import { MobileBottomNav, type MobileView } from "./mobile-bottom-nav";
import { MobileHeader } from "./mobile-header";
import { MobileSessionsView } from "./mobile-sessions-view";
import { HomePanel } from "./home-panel";
import type { HomePanelMode, LayoutState } from "@/hooks/use-layout-state";

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
  setHomePanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setHomePanelMode: (mode: HomePanelMode) => void;
  toggleHomePanelMode: (mode: HomePanelMode) => void;
};

interface AppShellGridProps extends AppShellProps {
  layout: LayoutStateReturn;
  rightPanelResize: ReturnType<typeof usePanelResize>;
}

function MobileShell({ user, children }: AppShellProps) {
  const pathname = usePathname();
  const sessionId = pathname.match(/\/sessions\/([^/]+)/)?.[1] ?? null;
  const [mobileView, setMobileView] = useState<MobileView>(
    sessionId ? "chat" : "sessions",
  );

  useEffect(() => {
    if (sessionId && mobileView === "sessions") {
      setMobileView("chat");
    }
  }, [sessionId]);

  const { mode: rightPanelMode, setMode: setRightPanelModeContext, selectedPath, openFile } =
    useRightPanel();

  function handleViewChange(view: MobileView) {
    setMobileView(view);
    if (view === "files") {
      setRightPanelModeContext("files");
    }
  }

  const showChat = mobileView === "chat";
  const showSessions = mobileView === "sessions";
  const showFiles = mobileView === "files";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {showSessions ? (
        <MobileSessionsView onClose={() => setMobileView("chat")} />
      ) : showFiles && sessionId ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <RightPanel
            mode="files"
            sessionId={sessionId}
            onModeChange={(mode) => {
              if (mode === "closed") {
                setMobileView("chat");
              } else {
                setRightPanelModeContext(mode);
              }
            }}
            width={window.innerWidth}
            selectedPath={selectedPath}
            onClearSelection={() => openFile("")}
            mobile
          />
        </div>
      ) : (
        <main className="relative min-h-0 flex-1 overflow-hidden">{children}</main>
      )}

      <MobileBottomNav
        activeView={mobileView}
        onViewChange={handleViewChange}
        hasSession={!!sessionId}
      />
    </div>
  );
}

function AppShellGrid({ user, children, layout, rightPanelResize }: AppShellGridProps) {
  useSessionTabsSync();
  const pathname = usePathname();
  const isSessionsRoute = pathname.startsWith("/sessions");

  const {
    hydrated,
    sidebarOpen,
    sidebarWidth,
    setSidebarOpen,
    setSidebarWidth,
    toggleSidebar,
    homePanelOpen,
    homePanelMode,
    setHomePanelOpen,
    setHomePanelMode,
  } = layout;

  const toggleHomePanel = useCallback(() => {
    setHomePanelOpen((open) => !open);
  }, [setHomePanelOpen]);

  const showHomePanel = isSessionsRoute && homePanelOpen;

  const {
    setWidth: setContextWidth,
  } = useRightPanel();

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
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o" && isSessionsRoute) {
        e.preventDefault();
        toggleHomePanel();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [toggleSidebar, toggleHomePanel, isSessionsRoute]);

  useEffect(() => {
    if (!hydrated) return;

    function enforceViewportConstraints() {
      const viewport = window.innerWidth;
      const sidebarSpace = sidebarOpen ? sidebarResize.size + 4 : 0;
      const homePanelSpace = showHomePanel ? rightPanelResize.size + 4 : 0;
      const required = sidebarSpace + homePanelSpace + CHAT_MIN_WIDTH;

      if (required <= viewport) return;

      if (showHomePanel) {
        setHomePanelOpen(false);
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
    setSidebarOpen,
    setHomePanelOpen,
    sidebarOpen,
    sidebarResize.size,
    showHomePanel,
    rightPanelResize.size,
  ]);

  const gridTemplateColumns = useMemo(() => {
    const sidebarCol = sidebarOpen ? `${sidebarResize.size}px` : "0px";
    const sidebarHandleCol = sidebarOpen ? "4px" : "0px";
    const mainCol = "minmax(var(--chat-min-width), 1fr)";
    if (!showHomePanel) {
      return `${sidebarCol} ${sidebarHandleCol} ${mainCol}`;
    }
    const homePanelCol = `${rightPanelResize.size}px`;
    return `${sidebarCol} ${sidebarHandleCol} ${mainCol} 4px ${homePanelCol}`;
  }, [sidebarOpen, sidebarResize.size, showHomePanel, rightPanelResize.size]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={
          {
            gridTemplateColumns,
            transition: "grid-template-columns var(--panel-transition)",
            "--sidebar-width": `${sidebarResize.size}px`,
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
            showToolsPanel={isSessionsRoute}
            homePanelOpen={homePanelOpen}
            onToggleHomePanel={toggleHomePanel}
          />
          <main className="relative min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>

        {showHomePanel ? (
          <>
            <PanelResizer handleProps={rightPanelResize.handleProps} />
            <div className="min-h-0 overflow-hidden">
              <HomePanel
                mode={homePanelMode}
                width={rightPanelResize.size}
                onModeChange={setHomePanelMode}
                onClose={() => setHomePanelOpen(false)}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function AppShell(props: AppShellProps) {
  const isMobile = useIsMobile();
  const layout = useLayoutState();
  const [rightPanelMaxSize, setRightPanelMaxSize] = useState(900);

  useEffect(() => {
    function updateMaxSize() {
      const max =
        window.innerWidth -
        (layout.sidebarOpen ? layout.sidebarWidth + 4 : 0) -
        CHAT_MIN_WIDTH -
        8;
      setRightPanelMaxSize(max);
    }

    updateMaxSize();
    window.addEventListener("resize", updateMaxSize);
    return () => window.removeEventListener("resize", updateMaxSize);
  }, [layout.sidebarOpen, layout.sidebarWidth]);

  const rightPanelResize = usePanelResize({
    direction: "horizontal",
    initialSize: layout.rightPanelWidth,
    minSize: RIGHT_PANEL_MIN,
    maxSize: rightPanelMaxSize,
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
      {isMobile ? (
        <MobileShell {...props} />
      ) : (
        <AppShellGrid {...props} layout={layout} rightPanelResize={rightPanelResize} />
      )}
    </RightPanelProvider>
  );
}
