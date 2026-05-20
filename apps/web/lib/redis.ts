import Redis from "ioredis";

export function getRedisUrl(): string | null {
  return process.env.REDIS_URL?.trim() ?? null;
}

export function isRedisConfigured(): boolean {
  return getRedisUrl() !== null;
}

function normalizeRedisUrl(raw: string): string {
  return raw.includes("://") ? raw : `redis://${raw}`;
}

function newRedisConnection(connectionName: string): Redis {
  const url = getRedisUrl();
  if (!url) throw new Error("REDIS_URL environment variable is required");

  const client = new Redis(normalizeRedisUrl(url), {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    connectionName,
  });
  client.on("error", (err) => {
    console.error(`[redis] ${connectionName} connection error:`, err.message);
  });
  return client;
}

let _sharedClient: Redis | null = null;
let _sharedRealQuit: (() => Promise<void>) | null = null;

/** Lazily created singleton for Redis commands (GET, SET, streams, etc.). */
export function getSharedRedisClient(): Redis {
  if (!_sharedClient) {
    const client = newRedisConnection("web-shared");
    const realQuit = client.quit.bind(client);
    _sharedRealQuit = async () => {
      await realQuit().catch(() => {});
    };
    client.disconnect = () => {};
    client.quit = () => Promise.resolve("OK");
    _sharedClient = client;
  }
  return _sharedClient;
}

/** Graceful shutdown for tests or process exit hooks. */
export async function disconnectAll(): Promise<void> {
  if (_sharedRealQuit) {
    await _sharedRealQuit();
    _sharedRealQuit = null;
  }
  _sharedClient = null;
}
