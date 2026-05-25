"use client";

import { useState, useMemo, useEffect, type ReactNode } from "react";
import type { LiveFileChange } from "../session/use-agent-chat";
import {
  FileBrowserContext,
  type FileBrowserContextValue,
  type FileBrowserSubView,
} from "./file-browser-context";

interface FileBrowserRootProps {
  children: ReactNode;
  sessionId: string;
  fileChanges: LiveFileChange[];
  initialFilePath?: string | null;
  initialSubView?: FileBrowserSubView;
}

function FileBrowserRoot({
  children,
  sessionId,
  fileChanges,
  initialFilePath,
  initialSubView,
}: FileBrowserRootProps) {
  const [subView, setSubView] = useState<FileBrowserSubView>(initialSubView ?? "tree");
  const [selectedTreeFile, setSelectedTreeFile] = useState<string | null>(initialFilePath ?? null);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);

  useEffect(() => {
    if (initialFilePath) {
      setSelectedTreeFile(initialFilePath);
      setSubView("tree");
    }
  }, [initialFilePath]);

  useEffect(() => {
    if (initialSubView) setSubView(initialSubView);
  }, [initialSubView]);

  const totalAdded = fileChanges.reduce((s, f) => s + f.additions, 0);
  const totalRemoved = fileChanges.reduce((s, f) => s + f.deletions, 0);

  const value = useMemo<FileBrowserContextValue>(
    () => ({
      sessionId,
      subView,
      setSubView,
      fileChanges,
      changeCount: fileChanges.length,
      totalAdded,
      totalRemoved,
      selectedTreeFile,
      setSelectedTreeFile,
      selectedDiffFile,
      setSelectedDiffFile,
    }),
    [sessionId, subView, fileChanges, totalAdded, totalRemoved, selectedTreeFile, selectedDiffFile],
  );

  return (
    <FileBrowserContext.Provider value={value}>
      {children}
    </FileBrowserContext.Provider>
  );
}
FileBrowserRoot.displayName = "FileBrowser.Root";

export { FileBrowserRoot };
