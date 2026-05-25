"use client";

import type { LiveFileChange } from "./use-agent-chat";
import { FileBrowser } from "@/components/file-browser";

type FilesSubView = "tree" | "changes";

interface FilesViewProps {
  sessionId: string;
  fileChanges: LiveFileChange[];
  initialFilePath?: string | null;
  initialSubView?: FilesSubView;
}

export function FilesView({
  sessionId,
  fileChanges,
  initialFilePath,
  initialSubView,
}: FilesViewProps) {
  return (
    <FileBrowser.Root
      sessionId={sessionId}
      fileChanges={fileChanges}
      initialFilePath={initialFilePath}
      initialSubView={initialSubView}
    >
      <div className="flex h-full flex-col">
        <FileBrowser.Tabs />
        <div className="min-h-0 flex-1 overflow-hidden">
          <FileBrowser.Explorer />
          <FileBrowser.Changes />
        </div>
      </div>
    </FileBrowser.Root>
  );
}
