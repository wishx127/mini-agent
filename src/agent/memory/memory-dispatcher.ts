import type { MemoryJobPayload } from './memory-job-queue.js';
import { MemoryJobQueue } from './memory-job-queue.js';

export interface MemoryDispatcherConfig {
  enabled: boolean;
  queueDir?: string;
}

/**
 * MemoryDispatcher - 仅负责入队，不做任何消费或 LLM 提取
 */
export class MemoryDispatcher {
  private queue: MemoryJobQueue;
  private enabled: boolean;

  constructor(config: MemoryDispatcherConfig) {
    this.enabled = config.enabled;
    this.queue = new MemoryJobQueue(config.queueDir);
  }

  async enqueue(payload: MemoryJobPayload): Promise<void> {
    if (!this.enabled) {
      return;
    }
    await this.queue.enqueue(payload);
  }
}
