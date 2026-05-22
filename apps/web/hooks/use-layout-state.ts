"use client";

import { useCallback, useEffect, useState } from "react";
import type { RightPanelMode } from "@/components/layout/right-panel-context";

const LAYOUT_KEY = "layout:v1";

export interface LayoutState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanelMode: RightPanelMode;
}

const DEFAULTS: LayoutState = {
  sidebarOpen: true,
  sidebarWidth: 260,
  rightPanelOpen: false,
  rightPanelWidth: 400,
  rightPanelMode: "closed",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function loadLayoutState(): LayoutState {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return {
      sidebarOpen: parsed.sidebarOpen ?? DEFAULTS.sidebarOpen,
      sidebarWidth: clamp(
        parsed.sidebarWidth ?? DEFAULTS.sidebarWidth,
        200,
        400,
      ),
      rightPanelOpen: parsed.rightPanelOpen ?? DEFAULTS.rightPanelOpen,
      rightPanelWidth: clamp(
        parsed.rightPanelWidth ?? DEFAULTS.rightPanelWidth,
        300,
        600,
      ),
      rightPanelMode: parsed.rightPanelMode ?? DEFAULTS.rightPanelMode,
    };
  } catch {
    return DEFAULTS;
  }
}

export function useLayoutState() {
  const [state, setState] = useState<LayoutState>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadLayoutState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  const setSidebarOpen = useCallback((open: boolean | ((prev: boolean) => boolean)) => {
    setState((prev) => ({
      ...prev,
      sidebarOpen: typeof open === "function" ? open(prev.sidebarOpen) : open,
    }));
  }, []);

  const setSidebarWidth = useCallback((width: number) => {
    setState((prev) => ({
      ...prev,
      sidebarWidth: clamp(width, 200, 400),
    }));
  }, []);

  const setRightPanelOpen = useCallback((open: boolean | ((prev: boolean) => boolean)) => {
    setState((prev) => {
      const nextOpen = typeof open === "function" ? open(prev.rightPanelOpen) : open;
      return {
        ...prev,
        rightPanelOpen: nextOpen,
        rightPanelMode: nextOpen
          ? prev.rightPanelMode === "closed"
            ? "files"
            : prev.rightPanelMode
          : "closed",
      };
    });
  }, []);

  const setRightPanelWidth = useCallback((width: number) => {
    setState((prev) => ({
      ...prev,
      rightPanelWidth: clamp(width, 300, 600),
    }));
  }, []);

  const setRightPanelMode = useCallback((mode: RightPanelMode) => {
    setState((prev) => ({
      ...prev,
      rightPanelMode: mode,
      rightPanelOpen: mode !== "closed",
    }));
  }, []);

  const toggleRightPanelMode = useCallback((mode: Exclude<RightPanelMode, "closed">) => {
    setState((prev) => {
      if (prev.rightPanelOpen && prev.rightPanelMode === mode) {
        return { ...prev, rightPanelOpen: false, rightPanelMode: "closed" };
      }
      return { ...prev, rightPanelOpen: true, rightPanelMode: mode };
    });
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open);
  }, [setSidebarOpen]);

  return {
    ...state,
    hydrated,
    setSidebarOpen,
    setSidebarWidth,
    setRightPanelOpen,
    setRightPanelWidth,
    setRightPanelMode,
    toggleRightPanelMode,
    toggleSidebar,
  };
}
