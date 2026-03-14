import type { ChatOpenAI } from '@langchain/openai';

import type {
  Memory,
  CreateMemoryInput,
  MemorySearchResult,
  LongTermMemoryConfig,
  MemoryExtractionResult,
  MemoryType,
} from '../../types/memory.js';
import { DEFAULT_LONG_TERM_MEMORY_CONFIG } from '../../types/memory.js';

import { VectorDatabaseClient } from './vector-database-client.js';
import { MemoryExtractor } from './memory-extractor.js';
import { MemoryJobQueue } from './memory-job-queue.js';

/**
 * 记忆统计信息
 */
export interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  active: number;
  expired: number;
}

/**
 * LongTermMemoryManager - 长期记忆管理器
 *
 * 职责：
 * - 记忆的 CRUD 操作
 * - 向量检索
 * - 记忆合并
 * - 过期管理
 * - 统计查询
 */
export class LongTermMemoryManager {
  private dbClient: VectorDatabaseClient;
  private extractor: MemoryExtractor;
  private config: LongTermMemoryConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private queue: MemoryJobQueue;
  private queueWorkerRunning = false;
  private queueWorkerStopped = false;
  private queuePoller: ReturnType<typeof setInterval> | null = null;

  constructor(
    dbClient: VectorDatabaseClient,
    llm: ChatOpenAI,
    config?: Partial<LongTermMemoryConfig>
  ) {
    this.dbClient = dbClient;
    this.config = { ...DEFAULT_LONG_TERM_MEMORY_CONFIG, ...config };
    this.extractor = new MemoryExtractor(llm, {
      confidenceThreshold: this.config.extractionThreshold,
      maxExtractionsPerTurn: this.config.maxExtractionsPerTurn,
    });
    this.queue = new MemoryJobQueue(this.config.queueDir);
  }

  /**
   * 初始化管理器
   */
  async initialize(): Promise<boolean> {
    const connected = await this.dbClient.initialize();
    if (connected) {
      await this.queue.initialize();
      // 启动过期清理定时任务
      this.startCleanupTask();
      if (this.config.queueWorkerEnabled) {
        this.startQueueConsumer(this.config.queuePollIntervalMs);
      }
    }
    return connected;
  }

  /**
   * 关闭管理器
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.queuePoller) {
      clearInterval(this.queuePoller);
      this.queuePoller = null;
    }
    this.queueWorkerStopped = true;
    this.dbClient.disconnect();
  }

  /**
   * 创建新记忆
   */
  async create(input: CreateMemoryInput): Promise<Memory | null> {
    if (!this.config.enabled) {
      return null;
    }

    // 检查是否需要设置默认过期时间
    if (!input.expiresAt && this.config.defaultExpirationMs) {
      const expiresAt = new Date(Date.now() + this.config.defaultExpirationMs);
      input.expiresAt = expiresAt;
    }

    const memory = await this.dbClient.insertVector(input);

    // 检查是否需要合并相似记忆
    if (memory) {
      await this.checkAndMergeSimilar(memory);
    }

    return memory;
  }

  /**
   * 将记忆提取任务入队（持久化到磁盘）
   */
  async enqueueExtraction(
    userMessage: string,
    aiResponse: string,
    sessionId?: string
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    await this.queue.enqueue({ userMessage, aiResponse, sessionId });
  }

  /**
   * 基于查询文本检索记忆
   */
  async search(query: string, topK?: number): Promise<MemorySearchResult[]> {
    if (!this.config.enabled || !this.dbClient.isAvailable()) {
      console.warn('⚠️ [LongTermMemoryManager] 功能未启用或数据库不可用');
      return [];
    }

    const k = topK || this.config.topK;
    const embedding = await this.dbClient.generateEmbedding(query);

    if (!embedding) {
      return [];
    }

    const results = await this.dbClient.searchSimilar(embedding, k);

    // 更新访问记录
    if (results.length > 0) {
      for (const result of results) {
        await this.dbClient.updateAccessRecord(result.memory.id);
      }
    }

    return results;
  }

  /**
   * 更新记忆内容
   */
  async update(memoryId: string, newContent: string): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    return this.dbClient.updateVector(memoryId, { content: newContent });
  }

  /**
   * 更新记忆元数据
   */
  async updateMetadata(
    memoryId: string,
    metadata: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    return this.dbClient.updateVector(memoryId, { metadata });
  }

  /**
   * 软删除记忆
   */
  async delete(memoryId: string): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    return this.dbClient.deleteVector(memoryId);
  }

  /**
   * 按类型查询记忆
   */
  async getByType(type: MemoryType, limit: number = 10): Promise<Memory[]> {
    if (!this.config.enabled || !this.dbClient.isAvailable()) {
      return [];
    }

    // 使用搜索功能，传入空 embedding 进行过滤查询
    const dummyEmbedding = new Array(1024).fill(0) as number[];
    const results = await this.dbClient.searchSimilar(dummyEmbedding, limit, {
      type,
    });

    return results.map((r) => r.memory);
  }

  /**
   * 按会话查询记忆
   */
  async getBySession(sessionId: string, limit: number = 10): Promise<Memory[]> {
    if (!this.config.enabled || !this.dbClient.isAvailable()) {
      return [];
    }

    const dummyEmbedding = new Array(1024).fill(0) as number[];
    const results = await this.dbClient.searchSimilar(dummyEmbedding, limit, {
      sessionId,
    });

    return results.map((r) => r.memory);
  }

  /**
   * 获取记忆统计
   */
  getStats(): MemoryStats {
    const stats: MemoryStats = {
      total: 0,
      byType: {
        user_preference: 0,
        fact: 0,
        experience: 0,
        task: 0,
        context: 0,
      },
      active: 0,
      expired: 0,
    };

    // 注意：这是一个简化实现，实际应该使用 SQL 聚合查询
    // 由于 Supabase 客户端限制，这里使用内存计算

    return stats;
  }

  /**
   * 从对话中提取并存储记忆
   */
  async extractAndStore(
    userMessage: string,
    aiResponse: string,
    sessionId?: string
  ): Promise<MemoryExtractionResult> {
    if (!this.config.enabled) {
      return { memories: [], success: false, error: '长期记忆未启用' };
    }

    const result = await this.extractor.extract(userMessage, aiResponse);

    if (!result.success) {
      throw new Error(result.error || '记忆提取失败');
    }

    if (result.memories.length === 0) {
      return result;
    }

    // 存储提取的记忆
    const storedMemories: Memory[] = [];
    for (let i = 0; i < result.memories.length; i++) {
      const extracted = result.memories[i];

      const memory = await this.create({
        type: extracted.type,
        content: extracted.content,
        metadata: {
          ...extracted.metadata,
          confidence: extracted.confidence,
          sourceSessionId: sessionId,
        },
        sessionId,
      });

      if (memory) {
        storedMemories.push(memory);
      }
    }

    if (storedMemories.length !== result.memories.length) {
      throw new Error('记忆存储未完全成功');
    }

    return {
      ...result,
      memories: storedMemories.map((m) => ({
        type: m.type,
        content: m.content,
        confidence: m.metadata.confidence || 0,
        metadata: m.metadata,
      })),
    };
  }

  /**
   * 检查并合并相似记忆
   */
  private async checkAndMergeSimilar(memory: Memory): Promise<void> {
    if (!memory.embedding) {
      return;
    }

    // 搜索相似记忆
    const similar = await this.dbClient.searchSimilar(memory.embedding, 5, {
      type: memory.type,
    });

    // 找到高度相似的记忆（排除自身）
    const toMerge = similar.filter(
      (r) =>
        r.memory.id !== memory.id &&
        r.similarity >= this.config.mergeSimilarityThreshold
    );

    if (toMerge.length > 0) {
      // 合并到最相似的记忆，删除其他
      const mostSimilar = toMerge[0];

      // 更新最相似记忆的内容
      const mergedContent = `${mostSimilar.memory.content}\n[补充] ${memory.content}`;
      await this.dbClient.updateVector(mostSimilar.memory.id, {
        content: mergedContent,
      });

      // 删除新创建的记忆
      await this.dbClient.hardDeleteVector(memory.id);
    }
  }

  /**
   * 启动后台队列处理器（单实例）
   */
  private startQueueWorker(): void {
    if (this.queueWorkerRunning || this.queueWorkerStopped) {
      return;
    }
    this.queueWorkerRunning = true;
    void this.runQueueWorker();
  }

  /**
   * 启动队列消费器（定时拉起队列处理）
   */
  startQueueConsumer(pollIntervalMs?: number): void {
    if (this.queuePoller) {
      return;
    }
    const interval = pollIntervalMs ?? this.config.queuePollIntervalMs ?? 2000;
    this.startQueueWorker();
    this.queuePoller = setInterval(() => {
      this.startQueueWorker();
    }, interval);
  }

  private async runQueueWorker(): Promise<void> {
    try {
      while (!this.queueWorkerStopped) {
        if (!this.dbClient.isAvailable()) {
          break;
        }
        const jobs = await this.queue.take(1);
        if (jobs.length === 0) {
          break;
        }

        for (const job of jobs) {
          try {
            await this.extractAndStore(
              job.userMessage,
              job.aiResponse,
              job.sessionId
            );
            await this.queue.ack(job);
          } catch (error) {
            await this.queue.retryOrFail(
              job,
              error,
              this.config.queueMaxAttempts || 3,
              this.config.queueRetryBackoffMs || 30_000
            );
          }
        }
      }
    } finally {
      this.queueWorkerRunning = false;
    }
  }

  async getPendingJobCount(): Promise<number> {
    return this.queue.getPendingCount();
  }

  /**
   * 标记过期记忆
   */
  markExpiredMemories(): number {
    if (!this.config.enabled || !this.dbClient.isAvailable()) {
      return 0;
    }

    // 注意：这是一个简化实现
    // 实际应该使用 SQL 更新：UPDATE memories SET is_active = false WHERE expires_at < NOW() AND is_active = true

    return 0;
  }

  /**
   * 启动过期清理定时任务
   */
  private startCleanupTask(): void {
    // 每小时执行一次过期清理
    this.cleanupInterval = setInterval(
      () => {
        void this.markExpiredMemories();
      },
      60 * 60 * 1000
    );
  }

  /**
   * 格式化记忆为 prompt 文本
   */
  formatMemoriesForPrompt(results: MemorySearchResult[]): string {
    if (results.length === 0) {
      return '';
    }

    const lines = ['以下是可能与当前对话相关的历史记忆：'];

    for (let i = 0; i < results.length; i++) {
      const { memory, similarity } = results[i];
      const typeLabel = this.getTypeLabel(memory.type);
      lines.push(
        `${i + 1}. [${typeLabel}] ${memory.content} (相关度: ${(similarity * 100).toFixed(0)}%)`
      );
    }

    const result = lines.join('\n');
    return result;
  }

  /**
   * 获取类型标签
   */
  private getTypeLabel(type: MemoryType): string {
    const labels: Record<MemoryType, string> = {
      user_preference: '用户偏好',
      fact: '事实',
      experience: '经验',
      task: '任务',
      context: '上下文',
    };
    return labels[type] || type;
  }
}
