import { createClient, SupabaseClient } from '@supabase/supabase-js';

import type {
  VectorDatabaseConfig,
  Memory,
  MemorySearchResult,
  CreateMemoryInput,
} from '../../types/memory.js';

/**
 * 向量数据库客户端配置
 */
interface VectorClientConfig extends VectorDatabaseConfig {
  /** embedding 模型 API URL */
  embeddingApiUrl?: string;
  /** embedding 模型名称 */
  embeddingModel?: string;
  /** embedding API Key */
  embeddingApiKey?: string;
}

/**
 * 客户端状态
 */
type ClientState = 'disconnected' | 'connected' | 'degraded' | 'failed';

/**
 * Embedding API 响应
 */
interface EmbeddingResponse {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
}

/**
 * Embedding 缓存项
 */
interface EmbeddingCacheItem {
  embedding: number[];
  timestamp: number;
}

/**
 * VectorDatabaseClient - Supabase 向量数据库客户端封装
 *
 * 职责：
 * - Supabase 连接管理
 * - Embedding 生成（调用 Qwen text-embedding-v3）
 * - 向量存储和检索
 * - 失败重试和降级机制
 */
export class VectorDatabaseClient {
  private client: SupabaseClient | null = null;
  private config: VectorClientConfig;
  private state: ClientState = 'disconnected';
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 3;
  private embeddingCache = new Map<string, EmbeddingCacheItem>();
  private readonly cacheMaxAge = 60 * 60 * 1000; // 1 hour

  constructor(config: VectorClientConfig) {
    this.config = {
      tableName: 'memories',
      embeddingDimension: 1024,
      embeddingApiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      embeddingModel: 'text-embedding-v3',
      ...config,
    };
    if (!this.config.tableName) {
      this.config.tableName = 'memories';
    }
    if (!this.config.embeddingDimension) {
      this.config.embeddingDimension = 1024;
    }
    if (!this.config.embeddingApiUrl) {
      this.config.embeddingApiUrl =
        'https://dashscope.aliyuncs.com/compatible-mode/v1';
    }
    if (!this.config.embeddingModel) {
      this.config.embeddingModel = 'text-embedding-v3';
    }
  }

  /**
   * 初始化客户端连接
   */
  async initialize(): Promise<boolean> {
    try {
      this.client = createClient(
        this.config.supabaseUrl,
        this.config.supabaseApiKey
      );

      // 验证连接
      const { error } = await this.client
        .from(this.config.tableName!)
        .select('id')
        .limit(1);

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows returned, which is fine
        this.state = 'failed';
        return false;
      }

      this.state = 'connected';
      this.consecutiveFailures = 0;
      return true;
    } catch {
      this.state = 'failed';
      return false;
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.client = null;
    this.state = 'disconnected';
    this.embeddingCache.clear();
  }

  /**
   * 获取当前状态
   */
  getState(): ClientState {
    return this.state;
  }

  /**
   * 是否可用
   */
  isAvailable(): boolean {
    return this.state === 'connected' || this.state === 'degraded';
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      const { error } = await this.client
        .from(this.config.tableName!)
        .select('id')
        .limit(1);

      const healthy = !error || error.code === 'PGRST116';

      if (healthy && this.state === 'degraded') {
        this.state = 'connected';
        this.consecutiveFailures = 0;
      }

      return healthy;
    } catch {
      return false;
    }
  }

  /**
   * 生成单个文本的 embedding
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    // 检查缓存
    const cacheKey = this.getCacheKey(text);
    const cached = this.embeddingCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
      return cached.embedding;
    }

    const embeddings = await this.generateEmbeddings([text]);
    return embeddings[0] || null;
  }

  /**
   * 批量生成 embedding
   */
  async generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.config.embeddingApiKey) {
      return texts.map(() => null);
    }

    try {
      const response = await this.retryOperation(async () => {
        const res = await fetch(`${this.config.embeddingApiUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.embeddingApiKey}`,
          },
          body: JSON.stringify({
            model: this.config.embeddingModel,
            input: texts,
            dimensions: this.config.embeddingDimension,
          }),
        });

        if (!res.ok) {
          throw new Error(`Embedding API 错误: ${res.status}`);
        }

        return res.json();
      });

      const embeddings: (number[] | null)[] = texts.map(() => null);

      const typedResponse = response as EmbeddingResponse;
      if (typedResponse.data && Array.isArray(typedResponse.data)) {
        for (const item of typedResponse.data) {
          embeddings[item.index] = item.embedding;
          // 缓存结果
          const cacheKey = this.getCacheKey(texts[item.index]);
          this.embeddingCache.set(cacheKey, {
            embedding: item.embedding,
            timestamp: Date.now(),
          });
        }
      }

      return embeddings;
    } catch {
      return texts.map(() => null);
    }
  }

  /**
   * 插入单条向量记录
   */
  async insertVector(input: CreateMemoryInput): Promise<Memory | null> {
    if (!this.client || !this.isAvailable()) {
      return null;
    }

    const embedding = await this.generateEmbedding(input.content);

    const record = {
      id: crypto.randomUUID(),
      type: input.type,
      content: input.content,
      embedding: embedding,
      metadata: input.metadata || {},
      session_id: input.sessionId,
      created_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString(),
      access_count: 0,
      expires_at: input.expiresAt?.toISOString(),
      is_active: true,
    };

    try {
      const { error } = await this.client
        .from(this.config.tableName!)
        .insert(record);

      if (error) {
        this.handleFailure();
        return null;
      }

      this.handleSuccess();
      return this.recordToMemory(record);
    } catch {
      this.handleFailure();
      return null;
    }
  }

  /**
   * 批量插入向量
   */
  async insertVectors(inputs: CreateMemoryInput[]): Promise<Memory[]> {
    if (!this.client || !this.isAvailable() || inputs.length === 0) {
      return [];
    }

    // 批量生成 embedding
    const contents = inputs.map((i) => i.content);
    const embeddings = await this.generateEmbeddings(contents);

    const records = inputs.map((input, index) => ({
      id: crypto.randomUUID(),
      type: input.type,
      content: input.content,
      embedding: embeddings[index],
      metadata: input.metadata || {},
      session_id: input.sessionId,
      created_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString(),
      access_count: 0,
      expires_at: input.expiresAt?.toISOString(),
      is_active: true,
    }));

    try {
      const { error } = await this.client
        .from(this.config.tableName!)
        .insert(records);

      if (error) {
        this.handleFailure();
        return [];
      }

      this.handleSuccess();
      return records.map((r) => this.recordToMemory(r));
    } catch {
      this.handleFailure();
      return [];
    }
  }

  /**
   * 向量相似度检索
   */
  async searchSimilar(
    queryEmbedding: number[],
    topK: number = 5,
    filters?: { type?: string; sessionId?: string }
  ): Promise<MemorySearchResult[]> {
    if (!this.client || !this.isAvailable()) {
      return [];
    }

    try {
      // 构建 RPC 调用进行向量搜索
      const query = this.client.rpc('search_memories', {
        query_embedding: queryEmbedding,
        match_count: topK,
        filter_type: filters?.type || null,
        filter_session_id: filters?.sessionId || null,
      });

      // 定义 RPC 返回的数据类型
      interface RpcSearchResult {
        id: string;
        type: Memory['type'];
        content: string;
        embedding?: number[];
        metadata: Memory['metadata'];
        session_id?: string;
        created_at: string;
        last_accessed_at: string;
        access_count: number;
        expires_at?: string;
        is_active: boolean;
        similarity: number;
      }

      // 定义 RPC 返回结果类型
      type RpcQueryResult = {
        data: RpcSearchResult[] | null;
        error: { code: string; message: string } | null;
      };

      const { data, error } = (await query) as RpcQueryResult;

      if (error) {
        // 如果 RPC 不存在，尝试直接查询
        if (error.code === 'PGRST202') {
          return await this.searchSimilarFallback(
            queryEmbedding,
            topK,
            filters
          );
        }
        this.handleFailure();
        return [];
      }

      this.handleSuccess();

      const typedData = data ?? [];
      const results: MemorySearchResult[] = typedData.map((item) => ({
        memory: this.recordToMemory(item as unknown as Record<string, unknown>),
        similarity: item.similarity,
      }));
      return results;
    } catch {
      this.handleFailure();
      return [];
    }
  }

  /**
   * 备用的向量搜索方法（直接查询）
   */
  private async searchSimilarFallback(
    queryEmbedding: number[],
    topK: number,
    filters?: { type?: string; sessionId?: string }
  ): Promise<MemorySearchResult[]> {
    if (!this.client) return [];

    let query = this.client
      .from(this.config.tableName!)
      .select('*')
      .eq('is_active', true)
      .limit(topK);

    if (filters?.type) {
      query = query.eq('type', filters.type);
    }
    if (filters?.sessionId) {
      query = query.eq('session_id', filters.sessionId);
    }

    const { data, error } = await query;

    if (error || !data) {
      return [];
    }

    // 定义数据库记录类型
    interface DbMemoryRecord {
      id: string;
      type: Memory['type'];
      content: string;
      embedding?: number[];
      metadata: Memory['metadata'];
      session_id?: string;
      created_at: string;
      last_accessed_at: string;
      access_count: number;
      expires_at?: string;
      is_active: boolean;
    }

    // 在内存中计算相似度
    const typedData = data as DbMemoryRecord[];
    const results: MemorySearchResult[] = typedData
      .filter((item) => item.embedding)
      .map((item) => ({
        memory: this.recordToMemory(item as unknown as Record<string, unknown>),
        similarity: this.cosineSimilarity(
          queryEmbedding,
          item.embedding as number[]
        ),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return results;
  }

  /**
   * 更新向量记录
   */
  async updateVector(
    id: string,
    updates: Partial<
      Pick<Memory, 'content' | 'metadata' | 'expiresAt' | 'isActive'>
    >
  ): Promise<boolean> {
    if (!this.client || !this.isAvailable()) {
      return false;
    }

    const updateData: Record<string, unknown> = {};

    if (updates.content) {
      updateData.content = updates.content;
      updateData.embedding = await this.generateEmbedding(updates.content);
    }
    if (updates.metadata) {
      updateData.metadata = updates.metadata;
    }
    if (updates.expiresAt) {
      updateData.expires_at = updates.expiresAt.toISOString();
    }
    if (updates.isActive !== undefined) {
      updateData.is_active = updates.isActive;
    }

    try {
      const { error } = await this.client
        .from(this.config.tableName!)
        .update(updateData)
        .eq('id', id);

      if (error) {
        this.handleFailure();
        return false;
      }

      this.handleSuccess();
      return true;
    } catch {
      this.handleFailure();
      return false;
    }
  }

  /**
   * 软删除向量记录
   */
  async deleteVector(id: string): Promise<boolean> {
    return this.updateVector(id, { isActive: false });
  }

  /**
   * 永久删除向量记录
   */
  async hardDeleteVector(id: string): Promise<boolean> {
    if (!this.client || !this.isAvailable()) {
      return false;
    }

    try {
      const { error } = await this.client
        .from(this.config.tableName!)
        .delete()
        .eq('id', id);

      if (error) {
        this.handleFailure();
        return false;
      }

      this.handleSuccess();
      return true;
    } catch {
      this.handleFailure();
      return false;
    }
  }

  /**
   * 更新访问记录
   */
  async updateAccessRecord(id: string): Promise<void> {
    if (!this.client || !this.isAvailable()) {
      return;
    }

    try {
      await this.client
        .from(this.config.tableName!)
        .update({
          last_accessed_at: new Date().toISOString(),
          access_count: this.client.rpc('increment_access_count', {
            row_id: id,
          }),
        })
        .eq('id', id);
    } catch {
      // 静默失败，访问记录更新不影响主流程
    }
  }

  /**
   * 处理成功
   */
  private handleSuccess(): void {
    const wasDegraded = this.state === 'degraded';
    this.consecutiveFailures = 0;
    if (wasDegraded) {
      this.state = 'connected';
    }
  }

  /**
   * 处理失败
   */
  private handleFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.state = 'degraded';
    }
  }

  /**
   * 带重试的操作执行
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('未知错误');
        const delay = Math.pow(2, attempt) * 1000; // 指数退避
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError ?? new Error('重试操作失败');
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(text: string): string {
    // 简单的文本哈希
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `${hash}_${text.length}`;
  }

  /**
   * 将数据库记录转换为 Memory 对象
   */
  private recordToMemory(record: Record<string, unknown>): Memory {
    return {
      id: record.id as string,
      type: record.type as Memory['type'],
      content: record.content as string,
      embedding: record.embedding as number[] | undefined,
      metadata: (record.metadata as Memory['metadata']) || {},
      sessionId: record.session_id as string | undefined,
      createdAt: new Date(record.created_at as string),
      lastAccessedAt: new Date(record.last_accessed_at as string),
      accessCount: (record.access_count as number) || 0,
      expiresAt: record.expires_at
        ? new Date(record.expires_at as string)
        : undefined,
      isActive: (record.is_active as boolean) ?? true,
    };
  }
}
