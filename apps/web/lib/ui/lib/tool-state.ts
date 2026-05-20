export type ToolRenderState = {
  running: boolean;
  interrupted: boolean;
  error?: string;
  denied: boolean;
  denialReason?: string;
  approvalRequested: boolean;
  approvalId?: string;
  isActiveApproval: boolean;
};

export type GenericToolPart = {
  state: string;
  approval?: {
    id?: string;
    approved?: boolean;
    reason?: string;
  };
  errorText?: string;
  input?: unknown;
  output?: unknown;
};

export function extractRenderState(
  part: GenericToolPart,
  activeApprovalId: string | null,
  isStreaming: boolean,
): ToolRenderState {
  const isRunningState =
    part.state === "input-streaming" || part.state === "input-available";
  const approval = part.approval;
  const denied = part.state === "output-denied" || approval?.approved === false;
  const denialReason = denied ? approval?.reason : undefined;
  const approvalRequested = part.state === "approval-requested" && !denied;
  const error = part.state === "output-error" ? part.errorText : undefined;
  const approvalId = approvalRequested ? approval?.id : undefined;
  const isActiveApproval = approvalId != null && approvalId === activeApprovalId;

  const interrupted = isRunningState && !isStreaming;
  const running = isRunningState && isStreaming;

  return {
    running,
    interrupted,
    error,
    denied,
    denialReason,
    approvalRequested,
    approvalId,
    isActiveApproval,
  };
}

export function getStatusColor(state: ToolRenderState): "red" | "yellow" | "green" {
  if (state.denied) return "red";
  if (state.interrupted) return "yellow";
  if (state.approvalRequested) return "yellow";
  if (state.running) return "yellow";
  if (state.error) return "red";
  return "green";
}

const MAX_ERROR_DISPLAY_LENGTH = 80;

export function getStatusLabel(state: ToolRenderState): string | undefined {
  if (state.denied) {
    return state.denialReason ? `Denied: ${state.denialReason}` : "Denied";
  }
  if (state.interrupted) return "Interrupted";
  if (state.approvalRequested) return "Waiting for approval…";
  if (state.running) return "Running…";
  if (state.error) return `Error: ${state.error.slice(0, MAX_ERROR_DISPLAY_LENGTH)}`;
  return undefined;
}

export function toRelativePath(filePath: string, cwd: string): string {
  const cwdPrefix = cwd.endsWith("/") ? cwd : cwd + "/";
  if (filePath.startsWith(cwdPrefix)) return filePath.slice(cwdPrefix.length);
  if (filePath === cwd) return ".";
  return filePath;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 999_950_000_000) return `${(tokens / 1_000_000_000_000).toFixed(1)}t`;
  if (tokens >= 999_950_000) return `${(tokens / 1_000_000_000).toFixed(1)}b`;
  if (tokens >= 999_950) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return tokens.toLocaleString();
}
