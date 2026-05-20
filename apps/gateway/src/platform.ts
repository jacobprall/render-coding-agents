import Redis from "ioredis";
import {
  createPlatform,
  type PlatformContainer,
} from "@coding-agents/platform/container";

let _platform: PlatformContainer | undefined;
let _redis: Redis | undefined;

export function getPlatform(): PlatformContainer {
  if (!_platform) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is required");

    const normalized = redisUrl.includes("://")
      ? redisUrl
      : `redis://${redisUrl}`;

    _redis = new Redis(normalized, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      connectionName: "gateway",
    });

    _platform = createPlatform({
      databaseUrl,
      redis: _redis,
    });
  }
  return _platform;
}

export function getRedis(): Redis {
  getPlatform();
  return _redis!;
}
