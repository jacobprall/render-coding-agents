import { loadConfig, getApiHeaders } from "./config";

function getUrl(path: string): string {
  const config = loadConfig();
  return `${config.apiUrl}${path}`;
}

function headers(): Record<string, string> {
  return getApiHeaders(loadConfig());
}

export async function createSession(params: {
  title?: string;
  repoPath?: string;
  branch?: string;
  firstMessage?: string;
  modelId?: string;
}): Promise<{ id: string; chatId?: string; runId?: string }> {
  const res = await fetch(getUrl("/api/sessions"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to create session: ${(err as Record<string, string>).error ?? res.statusText}`);
  }
  return res.json() as Promise<{ id: string; chatId?: string; runId?: string }>;
}

export async function sendMessage(sessionId: string, content: string): Promise<unknown> {
  const res = await fetch(getUrl(`/api/sessions/${sessionId}/message`), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to send message: ${(err as Record<string, string>).error ?? res.statusText}`);
  }
  return res.json();
}

export async function listSessions(params?: {
  status?: string;
  limit?: number;
}): Promise<unknown[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  const url = getUrl(`/api/sessions${qs ? `?${qs}` : ""}`);
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to list sessions: ${(err as Record<string, string>).error ?? res.statusText}`);
  }
  const data = await res.json() as { sessions?: unknown[]; items?: unknown[] };
  return data.sessions ?? data.items ?? [];
}

export async function stopSession(sessionId: string): Promise<unknown> {
  const res = await fetch(getUrl(`/api/sessions/${sessionId}/stop`), {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`Failed to stop session: ${res.statusText}`);
  }
  return res.json();
}

export async function pauseSession(sessionId: string): Promise<unknown> {
  const res = await fetch(getUrl(`/api/sessions/${sessionId}/pause`), {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`Failed to pause session: ${res.statusText}`);
  }
  return res.json();
}

export async function resumeSession(sessionId: string): Promise<unknown> {
  const res = await fetch(getUrl(`/api/sessions/${sessionId}/resume`), {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`Failed to resume session: ${res.statusText}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// SSE stream parser — full spec-compliant implementation
// ---------------------------------------------------------------------------

export interface StreamEvent {
  type: string;
  data: unknown;
  id?: string;
}

/**
 * Robust SSE parser that:
 * - Preserves state across chunks (buffer persists)
 * - Handles multi-line `data:` fields (concatenated with newlines per spec)
 * - Handles `event:`, `id:`, and `retry:` fields
 * - Dispatches on blank-line boundary per the SSE specification
 * - Normalizes v2 event envelopes: extracts `type` from envelope if present
 */
export async function streamSession(
  sessionId: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(getUrl(`/api/stream/sessions/${sessionId}`), {
    headers: { ...headers(), Accept: "text/event-stream" },
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Failed to connect to stream: ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Per-event accumulator (persists across chunk boundaries)
  let eventType = "";
  let dataLines: string[] = [];
  let eventId: string | undefined;

  function dispatchEvent() {
    if (dataLines.length === 0 && !eventType) return;

    const rawData = dataLines.join("\n");
    let parsed: unknown;
    let resolvedType = eventType || "message";

    try {
      parsed = rawData ? JSON.parse(rawData) : {};
    } catch {
      parsed = rawData;
    }

    // Normalize v2 envelopes: { v: 2, type: "agent:message", payload: {...} }
    if (
      parsed &&
      typeof parsed === "object" &&
      "v" in (parsed as Record<string, unknown>) &&
      (parsed as Record<string, unknown>).v === 2 &&
      "type" in (parsed as Record<string, unknown>)
    ) {
      const envelope = parsed as { type: string; payload?: unknown; ts?: string };
      resolvedType = envelope.type;
      parsed = envelope.payload ?? parsed;
    }

    onEvent({ type: resolvedType, data: parsed, id: eventId });

    // Reset for next event
    eventType = "";
    dataLines = [];
    eventId = undefined;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Last element is incomplete unless buffer ended with \n
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line === "") {
        // Blank line = end of event
        dispatchEvent();
      } else if (line.startsWith(":")) {
        // Comment line — ignore (used for keepalive pings)
      } else if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).startsWith(" ") ? line.slice(6) : line.slice(5));
      } else if (line.startsWith("id:")) {
        eventId = line.slice(3).trim();
      } else if (line.startsWith("retry:")) {
        // Ignored — no reconnection logic in CLI
      } else {
        // Per SSE spec: field with no colon — treat field name as everything, value as empty
        const colonIndex = line.indexOf(":");
        if (colonIndex > 0) {
          const field = line.slice(0, colonIndex);
          const val = line.slice(colonIndex + 1).startsWith(" ")
            ? line.slice(colonIndex + 2)
            : line.slice(colonIndex + 1);
          if (field === "data") dataLines.push(val);
          else if (field === "event") eventType = val;
          else if (field === "id") eventId = val;
        }
      }
    }
  }

  // Flush any remaining buffered event at stream end
  if (buffer) {
    const remainingLines = buffer.split("\n");
    for (const line of remainingLines) {
      if (line === "") {
        dispatchEvent();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).startsWith(" ") ? line.slice(6) : line.slice(5));
      } else if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("id:")) {
        eventId = line.slice(3).trim();
      }
    }
  }
  dispatchEvent();
}
