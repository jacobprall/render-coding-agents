"use client";

import { Search, Files } from "lucide-react";
import { ToolLayout, type ToolStatus } from "./tool-layout";

interface GlobArgs {
  pattern?: string;
  glob_pattern?: string;
  directory?: string;
}

interface GlobResult {
  files?: string[];
  count?: number;
  error?: string;
}

interface GrepArgs {
  pattern?: string;
  path?: string;
  glob?: string;
}

interface GrepResult {
  matches?: Array<{ file: string; line: number; text: string }>;
  output?: string;
  count?: number;
  error?: string;
}

export function GlobRenderer({
  args,
  result,
  status = "idle",
}: {
  args?: GlobArgs;
  result?: GlobResult;
  status?: ToolStatus;
}) {
  const pattern = args?.pattern ?? args?.glob_pattern ?? "";
  const files = result?.files ?? [];
  const derivedStatus: ToolStatus = result?.error
    ? "error"
    : result?.files !== undefined
      ? "success"
      : status;

  return (
    <ToolLayout
      icon={<Files className="size-3" />}
      title="glob"
      subtitle={pattern}
      status={derivedStatus}
    >
      {result?.error ? (
        <span className="text-danger">{result.error}</span>
      ) : files.length > 0 ? (
        <div className="space-y-0.5">
          <div className="text-text-tertiary mb-1">
            {files.length} file{files.length !== 1 ? "s" : ""}
          </div>
          {files.slice(0, 50).map((f, i) => (
            <div key={i} className="text-foreground text-xs">
              {f}
            </div>
          ))}
          {files.length > 50 && (
            <div className="text-text-tertiary">… {files.length - 50} more</div>
          )}
        </div>
      ) : result?.files !== undefined ? (
        <span className="text-text-tertiary">No matches</span>
      ) : null}
    </ToolLayout>
  );
}

export function GrepRenderer({
  args,
  result,
  status = "idle",
}: {
  args?: GrepArgs;
  result?: GrepResult;
  status?: ToolStatus;
}) {
  const pattern = args?.pattern ?? "";
  const output = result?.output ?? "";
  const matches = result?.matches ?? [];
  const derivedStatus: ToolStatus = result?.error
    ? "error"
    : result !== undefined
      ? "success"
      : status;

  return (
    <ToolLayout
      icon={<Search className="size-3" />}
      title="grep"
      subtitle={pattern}
      status={derivedStatus}
    >
      {result?.error ? (
        <span className="text-danger">{result.error}</span>
      ) : output ? (
        <pre className="text-xs whitespace-pre-wrap text-foreground">
          {output.length > 2000 ? output.slice(0, 2000) + "\n…" : output}
        </pre>
      ) : matches.length > 0 ? (
        <div className="space-y-0.5">
          {matches.slice(0, 30).map((m, i) => (
            <div key={i} className="text-xs">
              <span className="text-muted-foreground">
                {m.file}:{m.line}
              </span>
              <span className="text-foreground ml-1">{m.text}</span>
            </div>
          ))}
          {matches.length > 30 && (
            <div className="text-text-tertiary">… {matches.length - 30} more</div>
          )}
        </div>
      ) : (
        <span className="text-text-tertiary">No matches</span>
      )}
    </ToolLayout>
  );
}
