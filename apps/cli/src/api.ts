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

export async function sendMessage(sessionId: string, message: string): Promise<unknown> {
  const res = await fetch(getUrl(`/api/sessions/${sessionId}/message`), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ message }),
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
  const url = getUrl(`/api/sessions?${query.toString()}`);
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`Failed to list sessions: ${res.statusText}`);
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

export async function streamSession(
  sessionId: string,
  onEvent: (event: { type: string; data: unknown }) => void,
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    let currentData = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        currentData = line.slice(5).trim();
      } else if (line === "") {
        if (currentEvent || currentData) {
          try {
            const parsed = currentData ? JSON.parse(currentData) : {};
            onEvent({ type: currentEvent || "message", data: parsed });
          } catch {
            onEvent({ type: currentEvent || "message", data: currentData });
          }
        }
        currentEvent = "";
        currentData = "";
      }
    }
  }
}
