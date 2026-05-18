"use client";

import { GitBranch } from "lucide-react";
import { ToolLayout, type ToolStatus } from "./tool-layout";

interface GitArgs {
  args?: string[];
  command?: string;
}

interface GitResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  output?: string;
  error?: string;
}

interface Props {
  args?: GitArgs;
  result?: GitResult;
  status?: ToolStatus;
}

export function GitRenderer({ args, result, status = "idle" }: Props) {
  const cmd = args?.args?.join(" ") ?? args?.command ?? "";
  const output = result?.stdout ?? result?.output ?? "";
  const stderr = result?.stderr ?? "";
  const exitCode = result?.exitCode;
  const derivedStatus: ToolStatus =
    result?.error || (exitCode !== undefined && exitCode !== 0)
      ? "error"
      : result !== undefined
        ? "success"
        : status;

  return (
    <ToolLayout
      icon={<GitBranch className="size-3" />}
      title="git"
      subtitle={cmd.length > 60 ? cmd.slice(0, 60) + "…" : cmd}
      status={derivedStatus}
    >
      {cmd && (
        <pre className="text-xs text-foreground whitespace-pre-wrap mb-2">
          <span className="text-muted-foreground select-none">git </span>
          {cmd}
        </pre>
      )}
      {output && (
        <pre className="text-xs whitespace-pre-wrap text-foreground">
          {output.length > 2000 ? output.slice(0, 2000) + "\n…" : output}
        </pre>
      )}
      {stderr && (
        <pre className="text-xs whitespace-pre-wrap text-muted-foreground mt-1">
          {stderr}
        </pre>
      )}
      {result?.error && (
        <span className="text-xs text-danger">{result.error}</span>
      )}
    </ToolLayout>
  );
}
