"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

export type RightPanelMode = "files" | "git" | "preview" | "closed";

interface RightPanelContextValue {
  mode: RightPanelMode;
  setMode: (mode: RightPanelMode) => void;
  toggleMode: (mode: Exclude<RightPanelMode, "closed" | "preview">) => void;
  selectedPath: string | null;
  openFile: (path: string) => void;
  sessionId: string | null;
  width: number;
  setWidth: (width: number) => void;
}

const RightPanelContext = createContext<RightPanelContextValue | null>(null);

export function RightPanelProvider({
  children,
  width,
  setWidth,
  initialMode = "closed",
}: {
  children: ReactNode;
  width: number;
  setWidth: (width: number) => void;
  initialMode?: RightPanelMode;
}) {
  const pathname = usePathname();
  const sessionId = pathname.startsWith("/sessions/")
    ? (pathname.split("/")[2] ?? null)
    : null;

  const [mode, setModeState] = useState<RightPanelMode>(initialMode);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setModeState(initialMode);
  }, [initialMode]);

  const setMode = useCallback((next: RightPanelMode) => {
    setModeState(next);
    if (next === "closed") {
      setSelectedPath(null);
    }
  }, []);

  const toggleMode = useCallback(
    (target: Exclude<RightPanelMode, "closed" | "preview">) => {
      setModeState((current) => {
        const isActive =
          target === "files"
            ? current === "files" || current === "preview"
            : current === target;
        if (isActive) {
          setSelectedPath(null);
          return "closed";
        }
        return target;
      });
    },
    [],
  );

  const openFile = useCallback((path: string) => {
    if (!path) {
      setSelectedPath(null);
      return;
    }
    setSelectedPath(path);
    setModeState("preview");
  }, []);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      toggleMode,
      selectedPath,
      openFile,
      sessionId,
      width,
      setWidth,
    }),
    [mode, setMode, toggleMode, selectedPath, openFile, sessionId, width, setWidth],
  );

  return (
    <RightPanelContext.Provider value={value}>{children}</RightPanelContext.Provider>
  );
}

export function useRightPanel() {
  const ctx = useContext(RightPanelContext);
  if (!ctx) {
    throw new Error("useRightPanel must be used within RightPanelProvider");
  }
  return ctx;
}

export function useRightPanelOptional() {
  return useContext(RightPanelContext);
}
