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
    console.log('🔧 [LongTermMemoryManager] 初始化长期记忆管理器...');
    this.dbClient = dbClient;
    this.config = { ...DEFAULT_LONG_TERM_MEMORY_CONFIG, ...config };
    console.log('📋 [LongTermMemoryManager] 配置:', {
      enabled: this.config.enabled,
      topK: this.config.topK,
      extractionThreshold: this.config.extractionThreshold,
      maxExtractionsPerTurn: this.config.maxExtractionsPerTurn,
      mergeSimilarityThreshold: this.config.mergeSimilarityThreshold,
      defaultExpirationMs: this.config.defaultExpirationMs,
      queueWorkerEnabled: this.config.queueWorkerEnabled,
      queuePollIntervalMs: this.config.queuePollIntervalMs,
    });
    this.extractor = new MemoryExtractor(llm, {
      confidenceThreshold: this.config.extractionThreshold,
      maxExtractionsPerTurn: this.config.maxExtractionsPerTurn,
    });
    this.queue = new MemoryJobQueue(this.config.queueDir);
    console.log('✓ [LongTermMemoryManager] 初始化完成');
  }

  /**
   * 初始化管理器
   */
  async initialize(): Promise<boolean> {
    console.log('🔧 [LongTermMemoryManager] 开始初始化管理器...');
    const connected = await this.dbClient.initialize();
    if (connected) {
      console.log('✓ [LongTermMemoryManager] 数据库连接成功');
      await this.queue.initialize();
      // 启动过期清理定时任务
      console.log('🔄 [LongTermMemoryManager] 启动过期清理定时任务...');
      this.startCleanupTask();
      if (this.config.queueWorkerEnabled) {
        this.startQueueConsumer(this.config.queuePollIntervalMs);
      }
      console.log('✓ [LongTermMemoryManager] 初始化完成');
    } else {
      console.error('❌ [LongTermMemoryManager] 数据库连接失败');
    }
    return connected;
  }

  /**
   * 关闭管理器
   */
  shutdown(): void {
    console.log('🔌 [LongTermMemoryManager] 关闭管理器...');
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('✓ [LongTermMemoryManager] 清理任务已停止');
    }
    if (this.queuePoller) {
      clearInterval(this.queuePoller);
      this.queuePoller = null;
      console.log('✓ [LongTermMemoryManager] 队列轮询已停止');
    }
    this.queueWorkerStopped = true;
    this.dbClient.disconnect();
    console.log('✓ [LongTermMemoryManager] 管理器已关闭');
  }

  /**
   * 创建新记忆
   */
  async create(input: CreateMemoryInput): Promise<Memory | null> {
    console.log('📝 [LongTermMemoryManager] 创建新记忆...');
    console.log('📋 [LongTermMemoryManager] 输入数据:', {
      type: input.type,
      content:
        input.content.substring(0, 50) +
        (input.content.length > 50 ? '...' : ''),
      sessionId: input.sessionId,
      hasMetadata: !!input.metadata,
      hasExpiresAt: !!input.expiresAt,
    });

    if (!this.config.enabled) {
      console.warn('⚠️ [LongTermMemoryManager] 长期记忆功能未启用，跳过创建');
      return null;
    }

    // 检查是否需要设置默认过期时间
    if (!input.expiresAt && this.config.defaultExpirationMs) {
      const expiresAt = new Date(Date.now() + this.config.defaultExpirationMs);
      input.expiresAt = expiresAt;
      console.log(
        `📅 [LongTermMemoryManager] 设置默认过期时间: ${expiresAt.toISOString()}`
      );
    }

    console.log('🔄 [LongTermMemoryManager] 调用数据库客户端插入向量...');
    const memory = await this.dbClient.insertVector(input);

    // 检查是否需要合并相似记忆
    if (memory) {
      console.log('🔍 [LongTermMemoryManager] 检查是否需要合并相似记忆...');
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
      console.warn('⚠️ [LongTermMemoryManager] 长期记忆未启用，跳过入队');
      return;
    }
    await this.queue.enqueue({ userMessage, aiResponse, sessionId });
  }

  /**
   * 基于查询文本检索记忆
   */
  async search(query: string, topK?: number): Promise<MemorySearchResult[]> {
    console.log('🔍 [LongTermMemoryManager] 开始检索记忆...');
    console.log('📋 [LongTermMemoryManager] 检索参数:', {
      query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
      topK: topK || this.config.topK,
    });

    if (!this.config.enabled || !this.dbClient.isAvailable()) {
      console.warn('⚠️ [LongTermMemoryManager] 功能未启用或数据库不可用');
      return [];
    }

    const k = topK || this.config.topK;
    console.log('🔄 [LongTermMemoryManager] 生成查询 Embedding...');
    const embedding = await this.dbClient.generateEmbedding(query);

    if (!embedding) {
      console.warn('⚠️ [LongTermMemoryManager] Embedding 生成失败，无法检索');
      return [];
    }

    console.log('🔍 [LongTermMemoryManager] 执行相似度检索...');
    const results = await this.dbClient.searchSimilar(embedding, k);
    console.log(`📊 [LongTermMemoryManager] 检索到 ${results.length} 条结果`);

    // 更新访问记录
    if (results.length > 0) {
      console.log('🔄 [LongTermMemoryManager] 更新访问记录...');
      for (const result of results) {
        await this.dbClient.updateAccessRecord(result.memory.id);
      }
      console.log('✓ [LongTermMemoryManager] 访问记录更新完成');
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
    console.log('🧠 [LongTermMemoryManager] 开始提取并存储记忆...');
    console.log('📋 [LongTermMemoryManager] 输入:', {
      userMessageLength: userMessage.length,
      aiResponseLength: aiResponse.length,
      sessionId,
    });

    if (!this.config.enabled) {
      console.warn('⚠️ [LongTermMemoryManager] 长期记忆未启用');
      return { memories: [], success: false, error: '长期记忆未启用' };
    }

    console.log('🔄 [LongTermMemoryManager] 调用记忆提取器...');
    const result = await this.extractor.extract(userMessage, aiResponse);

    if (!result.success) {
      throw new Error(result.error || '记忆提取失败');
    }

    if (result.memories.length === 0) {
      console.log('ℹ️ [LongTermMemoryManager] 未提取到有效记忆');
      return result;
    }

    console.log(
      `📊 [LongTermMemoryManager] 提取到 ${result.memories.length} 条记忆，开始存储...`
    );

    // 存储提取的记忆
    const storedMemories: Memory[] = [];
    for (let i = 0; i < result.memories.length; i++) {
      const extracted = result.memories[i];
      console.log(
        `📝 [LongTermMemoryManager] 存储第 ${i + 1}/${result.memories.length} 条记忆...`
      );

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
        console.log(
          `✓ [LongTermMemoryManager] 第 ${i + 1} 条记忆存储成功，ID: ${memory.id}`
        );
      } else {
        console.warn(`⚠️ [LongTermMemoryManager] 第 ${i + 1} 条记忆存储失败`);
      }
    }

    console.log(
      `✓ [LongTermMemoryManager] 记忆提取和存储完成，成功存储 ${storedMemories.length}/${result.memories.length} 条`
    );

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
    console.log('🔍 [LongTermMemoryManager] 检查相似记忆...');
    if (!memory.embedding) {
      console.log('ℹ️ [LongTermMemoryManager] 记忆无 Embedding，跳过合并检查');
      return;
    }

    console.log('🔍 [LongTermMemoryManager] 搜索同类型相似记忆...');
    // 搜索相似记忆
    const similar = await this.dbClient.searchSimilar(memory.embedding, 5, {
      type: memory.type,
    });
    console.log(
      `📊 [LongTermMemoryManager] 找到 ${similar.length} 条同类型记忆`
    );

    // 找到高度相似的记忆（排除自身）
    const toMerge = similar.filter(
      (r) =>
        r.memory.id !== memory.id &&
        r.similarity >= this.config.mergeSimilarityThreshold
    );

    console.log(
      `📊 [LongTermMemoryManager] 相似度 >= ${this.config.mergeSimilarityThreshold} 的记忆: ${toMerge.length} 条`
    );

    if (toMerge.length > 0) {
      // 合并到最相似的记忆，删除其他
      const mostSimilar = toMerge[0];
      console.log('🔄 [LongTermMemoryManager] 发现高度相似记忆，执行合并...');
      console.log('📋 [LongTermMemoryManager] 合并信息:', {
        sourceId: memory.id,
        targetId: mostSimilar.memory.id,
        similarity: mostSimilar.similarity.toFixed(3),
        sourceContent: memory.content.substring(0, 30),
        targetContent: mostSimilar.memory.content.substring(0, 30),
      });

      // 更新最相似记忆的内容
      const mergedContent = `${mostSimilar.memory.content}\n[补充] ${memory.content}`;
      console.log('🔄 [LongTermMemoryManager] 更新目标记忆内容...');
      await this.dbClient.updateVector(mostSimilar.memory.id, {
        content: mergedContent,
      });

      // 删除新创建的记忆
      console.log('🗑️ [LongTermMemoryManager] 删除源记忆...');
      await this.dbClient.hardDeleteVector(memory.id);

      console.log(
        `✓ [LongTermMemoryManager] 合并相似记忆成功: ${memory.id} -> ${mostSimilar.memory.id}`
      );
    } else {
      console.log('ℹ️ [LongTermMemoryManager] 未发现需要合并的相似记忆');
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
          console.warn('⚠️ [LongTermMemoryManager] 数据库不可用，暂停队列处理');
          break;
        }
        const jobs = await this.queue.take(1);
        if (jobs.length === 0) {
          break;
        }

        for (const job of jobs) {
          try {
            const startedAt = Date.now();
            await this.extractAndStore(
              job.userMessage,
              job.aiResponse,
              job.sessionId
            );
            await this.queue.ack(job);
            const elapsedMs = Date.now() - startedAt;
            console.log(
              `✅ [LongTermMemoryManager] 队列任务完成: ${job.id} (${elapsedMs}ms)`
            );
          } catch (error) {
            console.warn('⚠️ [LongTermMemoryManager] 队列任务处理失败:', error);
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
    console.log('📝 [LongTermMemoryManager] 格式化记忆为 Prompt...');
    if (results.length === 0) {
      console.log('ℹ️ [LongTermMemoryManager] 无记忆需要格式化');
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
    console.log(
      `✓ [LongTermMemoryManager] 格式化完成，共 ${results.length} 条记忆`
    );
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
