import type Redis from "ioredis";
import {
  publishRunEvent,
  readRunEventHistory,
  readRunEventHistoryDetailed,
  readRunEventPayloadsAfterId,
  publishSteeringEvent,
  consumeSteeringEvents,
} from "../events/run-stream";

/**
 * Adapter for agent run event streaming (publish/subscribe).
 * Default implementation uses Redis pub/sub + streams.
 */
export interface EventBus {
  /** Publish an event payload to a run's event stream. */
  publish(runId: string, payload: string): Promise<void>;
  /** Read full event history for a run. */
  readHistory(runId: string): Promise<string[]>;
  /** Read event history with stream IDs for gap detection. */
  readHistoryDetailed(
    runId: string,
  ): Promise<{ payloads: string[]; lastStreamId: string | null }>;
  /** Read events after a given stream ID. */
  readAfter(runId: string, afterStreamId: string): Promise<string[]>;
  /** Set a Redis key (for abort flags, status, etc.). */
  setKey(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Get a Redis key value. */
  getKey(key: string): Promise<string | null>;
  /** Push to a Redis list (for ask_user reply queue). */
  listPush(key: string, value: string): Promise<void>;
  /** Publish a steering event (user message/interrupt) to an active run. */
  publishSteering(runId: string, event: { type: string; content?: string; reason?: string }): Promise<void>;
  /** Consume queued steering events for a run (drains the queue). */
  consumeSteering(runId: string): Promise<Array<{ type: string; content?: string; reason?: string; ts: string }>>;
}

/**
 * Redis implementation of EventBus.
 */
export class RedisEventBus implements EventBus {
  constructor(private redis: Redis) {}

  async publish(runId: string, payload: string): Promise<void> {
    await publishRunEvent(this.redis, runId, payload);
  }

  async readHistory(runId: string): Promise<string[]> {
    return readRunEventHistory(this.redis, runId);
  }

  async readHistoryDetailed(
    runId: string,
  ): Promise<{ payloads: string[]; lastStreamId: string | null }> {
    return readRunEventHistoryDetailed(this.redis, runId);
  }

  async readAfter(runId: string, afterStreamId: string): Promise<string[]> {
    return readRunEventPayloadsAfterId(this.redis, runId, afterStreamId);
  }

  async setKey(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, "EX", ttlSeconds);
  }

  async getKey(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async listPush(key: string, value: string): Promise<void> {
    await this.redis.rpush(key, value);
  }

  async publishSteering(runId: string, event: { type: string; content?: string; reason?: string }): Promise<void> {
    await publishSteeringEvent(this.redis, runId, event);
  }

  async consumeSteering(runId: string): Promise<Array<{ type: string; content?: string; reason?: string; ts: string }>> {
    return consumeSteeringEvents(this.redis, runId);
  }
}
