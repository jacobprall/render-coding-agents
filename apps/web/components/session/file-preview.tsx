"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { ChevronLeft, FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock } from "@/components/code-block";

const Markdown = dynamic(
  () => import("@/components/markdown").then((m) => ({ default: m.Markdown })),
  { ssr: false, loading: () => <span className="text-xs text-text-tertiary">Loading…</span> },
);

interface FileContentResponse {
  path: string;
  content: string;
  language: string;
  size: number;
  truncated: boolean;
}

type ViewMode = "preview" | "raw";

const fetcher = async (url: string): Promise<FileContentResponse> => {
  const res = await fetch(url);
  if (res.status === 422) {
    const body = (await res.json()) as { binary?: boolean; error?: string };
    if (body.binary) {
      throw new BinaryFileError(url);
    }
  }
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  return res.json() as Promise<FileContentResponse>;
};

class BinaryFileError extends Error {
  constructor(public fileUrl: string) {
    super("Binary file");
    this.name = "BinaryFileError";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".mdx");
}

function breadcrumbSegments(path: string): string[] {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  if (!normalized) return ["/"];
  return normalized.split("/");
}

interface FilePreviewProps {
  sessionId: string;
  filePath: string;
  onBack?: () => void;
}

export function FilePreview({ sessionId, filePath, onBack }: FilePreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    isMarkdownPath(filePath) ? "preview" : "raw",
  );

  const swrKey = sessionId && filePath
    ? `/api/sessions/${sessionId}/files/content?path=${encodeURIComponent(filePath)}`
    : null;

  const { data, error, isLoading } = useSWR<FileContentResponse>(swrKey, fetcher, {
    revalidateOnFocus: false,
  });

  const isBinary = error instanceof BinaryFileError;

  const segments = useMemo(() => breadcrumbSegments(filePath), [filePath]);
  const canPreview = isMarkdownPath(filePath);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-stroke-subtle px-3 py-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded p-1 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary"
            title="Back to tree"
          >
            <ChevronLeft className="size-4" />
          </button>
        ) : null}
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-[11px] font-mono text-text-tertiary">
          {segments.map((seg, i) => (
            <span key={`${seg}-${i}`} className="flex items-center gap-0.5">
              {i > 0 ? <span className="text-text-tertiary/50">/</span> : null}
              <button
                type="button"
                className="truncate transition-colors hover:text-text-secondary"
                onClick={onBack}
              >
                {seg}
              </button>
            </span>
          ))}
        </nav>
        {canPreview ? (
          <div className="flex shrink-0 rounded-md border border-stroke-subtle p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                viewMode === "preview"
                  ? "bg-surface-2 text-text-primary"
                  : "text-text-tertiary hover:text-text-secondary",
              )}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setViewMode("raw")}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                viewMode === "raw"
                  ? "bg-surface-2 text-text-primary"
                  : "text-text-tertiary hover:text-text-secondary",
              )}
            >
              Raw
            </button>
          </div>
        ) : data ? (
          <span className="shrink-0 text-[10px] text-text-tertiary">
            {formatBytes(data.size)}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <p className="text-xs text-text-tertiary">Loading file…</p>
        ) : isBinary ? (
          <div className="flex h-full flex-col items-center justify-center py-12 text-center">
            <FileCode2 className="mb-3 size-8 text-text-tertiary" />
            <p className="text-sm text-text-secondary">Binary file</p>
            <p className="mt-1 max-w-xs text-xs text-text-tertiary">
              This file cannot be previewed as text. Download or open it locally to view.
            </p>
          </div>
        ) : error ? (
          <p className="text-xs text-danger">Failed to load file content</p>
        ) : data ? (
          <>
            {data.truncated ? (
              <p className="mb-2 text-[11px] text-warning">
                File truncated at 500KB
              </p>
            ) : null}
            {viewMode === "preview" && canPreview ? (
              <Markdown>{data.content}</Markdown>
            ) : (
              <CodeBlock
                code={data.content}
                language={data.language}
                filePath={filePath}
                maxHeight="max-h-none"
              />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
