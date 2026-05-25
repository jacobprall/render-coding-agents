import type Redis from "ioredis";
import {
  enqueueJob,
  ensureConsumerGroup,
  type ValidatedAgentJob,
} from "../queue/job-queue";

export type { ValidatedAgentJob as AgentJobPayload };

/**
 * Adapter for the agent job queue.
 * Default implementation uses Redis Streams.
 */
export interface QueueAdapter {
  /** Ensure the consumer group exists. */
  ensureGroup(): Promise<void>;
  /** Enqueue an agent job. */
  enqueue(job: ValidatedAgentJob): Promise<void>;
}

/**
 * Redis Streams implementation of QueueAdapter.
 */
export class RedisQueueAdapter implements QueueAdapter {
  private groupReady: Promise<void> | null = null;

  constructor(private redis: Redis) {}

  async ensureGroup(): Promise<void> {
    if (!this.groupReady) {
      this.groupReady = ensureConsumerGroup(this.redis).catch((err) => {
        this.groupReady = null;
        throw err;
      });
    }
    return this.groupReady;
  }

  async enqueue(job: ValidatedAgentJob): Promise<void> {
    await enqueueJob(this.redis, job as Record<string, unknown>);
  }
}
