"use client";

import { createContext, useContext } from "react";
import type { LiveFileChange } from "../session/use-agent-chat";

export type FileBrowserSubView = "tree" | "changes";

export interface FileBrowserContextValue {
  sessionId: string;
  subView: FileBrowserSubView;
  setSubView: (view: FileBrowserSubView) => void;
  fileChanges: LiveFileChange[];
  changeCount: number;
  totalAdded: number;
  totalRemoved: number;
  selectedTreeFile: string | null;
  setSelectedTreeFile: (path: string | null) => void;
  selectedDiffFile: string | null;
  setSelectedDiffFile: (path: string | null) => void;
}

export const FileBrowserContext = createContext<FileBrowserContextValue | null>(null);

export function useFileBrowserContext() {
  const ctx = useContext(FileBrowserContext);
  if (!ctx) throw new Error("Must be used within FileBrowser.Root");
  return ctx;
}
