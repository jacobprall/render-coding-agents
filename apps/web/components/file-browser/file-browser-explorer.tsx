"use client";

import { useCallback } from "react";
import { FileExplorer } from "@/components/session/file-explorer";
import { useFileBrowserContext } from "./file-browser-context";

function FileBrowserExplorer({ className }: { className?: string }) {
  const { sessionId, subView, selectedTreeFile, setSelectedTreeFile } =
    useFileBrowserContext();

  const handleDeselect = useCallback(() => setSelectedTreeFile(null), [setSelectedTreeFile]);

  if (subView !== "tree") return null;

  return (
    <FileExplorer
      sessionId={sessionId}
      selectedPath={selectedTreeFile}
      onFileSelect={setSelectedTreeFile}
      onDeselect={handleDeselect}
      treeWidth="w-64"
      className={className}
    />
  );
}
FileBrowserExplorer.displayName = "FileBrowser.Explorer";

export { FileBrowserExplorer };
