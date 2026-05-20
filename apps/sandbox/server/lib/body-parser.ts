import { MAX_REQUEST_BODY_BYTES } from "./constants";

export class PayloadTooLargeError extends Error {
  readonly code = "PAYLOAD_TOO_LARGE" as const;
  constructor(maxBytes = MAX_REQUEST_BODY_BYTES) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

/** Parse JSON body with streamed byte caps (Content-Length hint + accumulator). */
export async function parseLimitedJsonBody(
  req: Request,
  maxBytes: number,
): Promise<unknown> {
  const clHdr = req.headers.get("content-length");
  if (clHdr !== null) {
    const n = Number(clHdr);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new PayloadTooLargeError(maxBytes);
    }
  }

  const reader = req.body?.getReader();
  if (!reader) return {};

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new PayloadTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  if (chunks.length === 0) return {};

  let raw: Uint8Array;
  if (chunks.length === 1 && chunks[0] !== undefined) {
    raw = chunks[0];
  } else {
    const buf = Buffer.allocUnsafe(total);
    let offset = 0;
    for (const chunk of chunks) {
      Buffer.from(chunk).copy(buf, offset);
      offset += chunk.byteLength;
    }
    raw = buf;
  }

  let text = new TextDecoder("utf8", { fatal: false }).decode(raw);
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new PayloadTooLargeError(maxBytes);
  }

  text = text.trim();
  if (!text) return {};

  return JSON.parse(text) as unknown;
}
