"use client";

import { Terminal } from "lucide-react";
import { ToolLayout, type ToolStatus } from "./tool-layout";

interface BashArgs {
  command?: string;
  cmd?: string;
}

interface BashResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  output?: string;
}

interface Props {
  args?: BashArgs;
  result?: BashResult;
  status?: ToolStatus;
}

export function BashRenderer({ args, result, status = "idle" }: Props) {
  const cmd = args?.command ?? args?.cmd ?? "";
  const output = result?.stdout ?? result?.output ?? "";
  const stderr = result?.stderr ?? "";
  const exitCode = result?.exitCode;

  const isError = exitCode !== undefined && exitCode !== 0;
  const derivedStatus: ToolStatus =
    status === "running"
      ? "running"
      : result !== undefined
        ? isError
          ? "error"
          : "success"
        : status;

  return (
    <ToolLayout
      icon={<Terminal className="size-3" />}
      title="bash"
      subtitle={cmd.length > 60 ? cmd.slice(0, 60) + "…" : cmd}
      status={derivedStatus}
      defaultOpen={isError}
    >
      {cmd && (
        <pre className="text-xs text-foreground whitespace-pre-wrap mb-2">
          <span className="text-muted-foreground select-none">$ </span>
          {cmd}
        </pre>
      )}
      {output && (
        <pre className="text-xs whitespace-pre-wrap text-foreground">{output}</pre>
      )}
      {stderr && (
        <pre className="text-xs whitespace-pre-wrap text-danger mt-1">
          {stderr}
        </pre>
      )}
      {isError && (
        <div className="text-xs text-danger mt-1">Exit code: {exitCode}</div>
      )}
    </ToolLayout>
  );
}
