"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { LiveFileChange } from "./chat-panel";
import { SingleFileDiffViewer } from "@/components/diff-viewer";
import { FileExplorer } from "@/components/session/file-explorer";

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
  const [subView, setSubView] = useState<FilesSubView>(
    initialSubView ?? "tree",
  );
  const [selectedTreeFile, setSelectedTreeFile] = useState<string | null>(
    initialFilePath ?? null,
  );
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);

  useEffect(() => {
    if (initialFilePath) {
      setSelectedTreeFile(initialFilePath);
      setSubView("tree");
    }
  }, [initialFilePath]);

  useEffect(() => {
    if (initialSubView) {
      setSubView(initialSubView);
    }
  }, [initialSubView]);

  const handleTreeFileSelect = useCallback((path: string) => {
    setSelectedTreeFile(path);
  }, []);

  const handleTreeDeselect = useCallback(() => {
    setSelectedTreeFile(null);
  }, []);

  const totalAdded = fileChanges.reduce((s, f) => s + f.additions, 0);
  const totalRemoved = fileChanges.reduce((s, f) => s + f.deletions, 0);

  const selectedMeta = useMemo(
    () => (selectedDiffFile ? fileChanges.find((x) => x.path === selectedDiffFile) : undefined),
    [fileChanges, selectedDiffFile],
  );

  const changeCount = fileChanges.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-stroke-subtle px-3">
        <SubTabButton
          active={subView === "tree"}
          onClick={() => setSubView("tree")}
        >
          Explorer
        </SubTabButton>
        <SubTabButton
          active={subView === "changes"}
          onClick={() => setSubView("changes")}
          badge={changeCount > 0 ? changeCount : undefined}
        >
          Changes
        </SubTabButton>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {subView === "tree" ? (
          <FileExplorer
            sessionId={sessionId}
            selectedPath={selectedTreeFile}
            onFileSelect={handleTreeFileSelect}
            onDeselect={handleTreeDeselect}
            treeWidth="w-64"
          />
        ) : (
          <ChangesView
            fileChanges={fileChanges}
            selectedFile={selectedDiffFile}
            onSelectFile={setSelectedDiffFile}
            totalAdded={totalAdded}
            totalRemoved={totalRemoved}
            selectedMeta={selectedMeta}
          />
        )}
      </div>
    </div>
  );
}

function ChangesView({
  fileChanges,
  selectedFile,
  onSelectFile,
  totalAdded,
  totalRemoved,
  selectedMeta,
}: {
  fileChanges: LiveFileChange[];
  selectedFile: string | null;
  onSelectFile: (path: string | null) => void;
  totalAdded: number;
  totalRemoved: number;
  selectedMeta: LiveFileChange | undefined;
}) {
  if (fileChanges.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2/50">
            <svg className="h-5 w-5 text-text-tertiary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          </div>
          <p className="text-sm text-text-tertiary">No files changed yet</p>
          <p className="mt-1 text-xs text-text-tertiary">
            File changes will appear here as the agent works.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 border-r border-stroke-subtle overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-stroke-subtle/50">
          <span className="text-[11px] font-medium text-text-tertiary">
            {fileChanges.length} file{fileChanges.length !== 1 ? "s" : ""}
          </span>
          <span className="text-[11px] font-mono tabular-nums">
            <span className="text-accent-text/70">+{totalAdded}</span>
            <span className="text-text-tertiary mx-0.5">/</span>
            <span className="text-danger/70">-{totalRemoved}</span>
          </span>
        </div>
        <div className="py-1">
          {fileChanges.map((file) => {
            const filename = file.path.split("/").pop() ?? file.path;
            const dir = file.path.includes("/")
              ? file.path.slice(0, file.path.lastIndexOf("/"))
              : "";
            const isSelected = selectedFile === file.path;

            return (
              <button
                key={file.path}
                type="button"
                onClick={() => onSelectFile(isSelected ? null : file.path)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-(--of-duration-instant) ${
                  isSelected
                    ? "bg-surface-2/80 text-text-primary"
                    : "text-text-tertiary hover:bg-surface-2/40 hover:text-text-secondary"
                }`}
              >
                <svg className="h-3.5 w-3.5 shrink-0 text-text-tertiary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <span className="block text-xs font-mono truncate">{filename}</span>
                  {dir ? (
                    <span className="block text-[10px] text-text-tertiary font-mono truncate">{dir}</span>
                  ) : null}
                </div>
                <span className="shrink-0 text-[10px] font-mono tabular-nums">
                  <span className="text-accent-text/60">+{file.additions}</span>
                  {" "}
                  <span className="text-danger/60">-{file.deletions}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedFile ? (
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs font-mono text-text-tertiary">{selectedFile}</span>
              {selectedMeta ? (
                <span className="text-[11px] font-mono tabular-nums">
                  <span className="text-accent-text/70">+{selectedMeta.additions}</span>
                  <span className="text-text-tertiary mx-0.5">/</span>
                  <span className="text-danger/70">-{selectedMeta.deletions}</span>
                </span>
              ) : null}
            </div>
            {selectedMeta?.unifiedDiffPreview ? (
              <SingleFileDiffViewer diff={selectedMeta.unifiedDiffPreview} />
            ) : (
              <div className="border border-stroke-subtle bg-surface-1/50 p-6 text-center">
                <p className="text-xs text-text-tertiary">
                  No diff preview available. File was modified with{" "}
                  {selectedMeta
                    ? `${selectedMeta.additions} additions and ${selectedMeta.deletions} deletions`
                    : "changes"}
                  .
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-text-tertiary">Select a file to view changes</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SubTabButton({
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
      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-(--of-duration-instant) ${
        active
          ? "border-b-2 border-accent text-text-primary"
          : "border-b-2 border-transparent text-text-tertiary hover:text-text-secondary"
      }`}
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
