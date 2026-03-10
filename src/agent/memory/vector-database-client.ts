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
        console.error('❌ [VectorDatabaseClient] 连接失败:', error.message);
        this.state = 'failed';
        return false;
      }

      this.state = 'connected';
      this.consecutiveFailures = 0;
      console.log('✓ [VectorDatabaseClient] 连接成功');
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error('❌ [VectorDatabaseClient] 初始化错误:', errorMessage);
      this.state = 'failed';
      return false;
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    console.log('🔌 [VectorDatabaseClient] 断开连接...');
    this.client = null;
    this.state = 'disconnected';
    const cacheSize = this.embeddingCache.size;
    this.embeddingCache.clear();
    console.log(
      `✓ [VectorDatabaseClient] 已断开连接，清理了 ${cacheSize} 个缓存项`
    );
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
        console.log('✓ [VectorDatabaseClient] 从降级模式恢复');
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
    console.log(
      `🔄 [VectorDatabaseClient] 批量生成 Embedding，数量: ${texts.length}`
    );

    if (!this.config.embeddingApiKey) {
      console.warn(
        '⚠️ [VectorDatabaseClient] 未配置 embedding API Key，跳过向量生成'
      );
      return texts.map(() => null);
    }

    try {
      console.log('📤 [VectorDatabaseClient] 调用 Embedding API...');
      console.log('📋 [VectorDatabaseClient] API 参数:', {
        url: `${this.config.embeddingApiUrl}/embeddings`,
        model: this.config.embeddingModel,
        dimensions: this.config.embeddingDimension,
        inputCount: texts.length,
      });

      const startTime = Date.now();
      const response = await this.retryOperation(async () => {
        const res = await fetch(`${this.config.embeddingApiUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.embeddingApiKey ? '已配置' : '未配置'}`,
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
      const duration = Date.now() - startTime;
      console.log(`✓ [VectorDatabaseClient] API 调用成功，耗时: ${duration}ms`);

      const embeddings: (number[] | null)[] = texts.map(() => null);

      const typedResponse = response as EmbeddingResponse;
      if (typedResponse.data && Array.isArray(typedResponse.data)) {
        console.log(
          `📊 [VectorDatabaseClient] 收到 ${typedResponse.data.length} 个 Embedding 结果`
        );
        for (const item of typedResponse.data) {
          embeddings[item.index] = item.embedding;
          // 缓存结果
          const cacheKey = this.getCacheKey(texts[item.index]);
          this.embeddingCache.set(cacheKey, {
            embedding: item.embedding,
            timestamp: Date.now(),
          });
        }
        console.log(
          `✓ [VectorDatabaseClient] 已缓存 ${typedResponse.data.length} 个 Embedding`
        );
      }

      return embeddings;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error(
        '❌ [VectorDatabaseClient] Embedding 生成失败:',
        errorMessage
      );
      return texts.map(() => null);
    }
  }

  /**
   * 插入单条向量记录
   */
  async insertVector(input: CreateMemoryInput): Promise<Memory | null> {
    console.log('📥 [VectorDatabaseClient] 开始插入向量记录...');
    console.log('📋 [VectorDatabaseClient] 输入数据:', {
      type: input.type,
      content:
        input.content.substring(0, 50) +
        (input.content.length > 50 ? '...' : ''),
      sessionId: input.sessionId,
      hasMetadata: !!input.metadata,
      hasExpiresAt: !!input.expiresAt,
    });

    if (!this.client || !this.isAvailable()) {
      console.warn('⚠️ [VectorDatabaseClient] 客户端不可用，无法插入');
      return null;
    }

    console.log('🔄 [VectorDatabaseClient] 为内容生成 Embedding...');
    const embedding = await this.generateEmbedding(input.content);
    if (!embedding) {
      console.warn(
        '⚠️ [VectorDatabaseClient] Embedding 生成失败，但继续插入（无向量）'
      );
    }

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
    console.log('📝 [VectorDatabaseClient] 构建记录完成，ID:', record.id);

    try {
      console.log(
        `📤 [VectorDatabaseClient] 执行数据库插入，表: ${this.config.tableName}...`
      );
      const { error } = await this.client
        .from(this.config.tableName!)
        .insert(record);

      if (error) {
        this.handleFailure();
        console.error('❌ [VectorDatabaseClient] 插入失败:', {
          code: error.code,
          message: error.message,
          details: error.details,
        });
        return null;
      }

      this.handleSuccess();
      console.log('✓ [VectorDatabaseClient] 插入成功，记录 ID:', record.id);
      return this.recordToMemory(record);
    } catch (error) {
      this.handleFailure();
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error('❌ [VectorDatabaseClient] 插入异常:', errorMessage);
      return null;
    }
  }

  /**
   * 批量插入向量
   */
  async insertVectors(inputs: CreateMemoryInput[]): Promise<Memory[]> {
    console.log(
      `📥 [VectorDatabaseClient] 开始批量插入向量，数量: ${inputs.length}`
    );

    if (!this.client || !this.isAvailable() || inputs.length === 0) {
      console.warn(
        '⚠️ [VectorDatabaseClient] 客户端不可用或输入为空，无法插入'
      );
      return [];
    }

    // 批量生成 embedding
    console.log('🔄 [VectorDatabaseClient] 批量生成 Embedding...');
    const contents = inputs.map((i) => i.content);
    const embeddings = await this.generateEmbeddings(contents);
    const successCount = embeddings.filter((e) => e !== null).length;
    console.log(
      `📊 [VectorDatabaseClient] Embedding 生成完成: ${successCount}/${inputs.length} 成功`
    );

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
    console.log(`📝 [VectorDatabaseClient] 构建了 ${records.length} 条记录`);

    try {
      console.log(
        `📤 [VectorDatabaseClient] 执行批量插入，表: ${this.config.tableName}...`
      );
      const { error } = await this.client
        .from(this.config.tableName!)
        .insert(records);

      if (error) {
        this.handleFailure();
        console.error('❌ [VectorDatabaseClient] 批量插入失败:', {
          code: error.code,
          message: error.message,
          details: error.details,
        });
        return [];
      }

      this.handleSuccess();
      console.log(
        `✓ [VectorDatabaseClient] 批量插入成功，数量: ${records.length}`
      );
      return records.map((r) => this.recordToMemory(r));
    } catch (error) {
      this.handleFailure();
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error('❌ [VectorDatabaseClient] 批量插入异常:', errorMessage);
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
    console.log('🔍 [VectorDatabaseClient] 开始向量相似度检索...');
    console.log('📋 [VectorDatabaseClient] 检索参数:', {
      topK,
      filters,
      embeddingDimension: queryEmbedding.length,
    });

    if (!this.client || !this.isAvailable()) {
      console.warn('⚠️ [VectorDatabaseClient] 客户端不可用，无法检索');
      return [];
    }

    try {
      // 构建 RPC 调用进行向量搜索
      console.log('📤 [VectorDatabaseClient] 调用 RPC 函数 search_memories...');
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
          console.warn(
            '⚠️ [VectorDatabaseClient] RPC 函数 search_memories 不存在，使用备用检索方法'
          );
          return await this.searchSimilarFallback(
            queryEmbedding,
            topK,
            filters
          );
        }
        this.handleFailure();
        console.error('❌ [VectorDatabaseClient] 检索失败:', {
          code: error.code,
          message: error.message,
        });
        return [];
      }

      this.handleSuccess();

      const typedData = data ?? [];
      const results: MemorySearchResult[] = typedData.map((item) => ({
        memory: this.recordToMemory(item as Record<string, unknown>),
        similarity: item.similarity,
      }));
      console.log(
        `✓ [VectorDatabaseClient] 检索成功，返回 ${results.length} 条结果`
      );
      if (results.length > 0) {
        console.log(
          '📊 [VectorDatabaseClient] 检索结果:',
          results.map((r) => ({
            id: r.memory.id,
            type: r.memory.type,
            similarity: r.similarity.toFixed(3),
            content: r.memory.content.substring(0, 30) + '...',
          }))
        );
      }
      return results;
    } catch (error) {
      this.handleFailure();
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error('❌ [VectorDatabaseClient] 检索异常:', errorMessage);
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
    console.log(
      '🔄 [VectorDatabaseClient] 使用备用检索方法（内存计算相似度）...'
    );
    if (!this.client) return [];

    let query = this.client
      .from(this.config.tableName!)
      .select('*')
      .eq('is_active', true)
      .limit(topK);

    if (filters?.type) {
      console.log(`📋 [VectorDatabaseClient] 应用类型过滤器: ${filters.type}`);
      query = query.eq('type', filters.type);
    }
    if (filters?.sessionId) {
      console.log(
        `📋 [VectorDatabaseClient] 应用会话过滤器: ${filters.sessionId}`
      );
      query = query.eq('session_id', filters.sessionId);
    }

    console.log('📤 [VectorDatabaseClient] 执行数据库查询...');
    const { data, error } = await query;

    if (error || !data) {
      console.error('❌ [VectorDatabaseClient] 备用查询失败:', error?.message);
      return [];
    }

    console.log(`📊 [VectorDatabaseClient] 查询返回 ${data.length} 条记录`);

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
    console.log('🔄 [VectorDatabaseClient] 在内存中计算向量相似度...');
    const typedData = data as DbMemoryRecord[];
    const results: MemorySearchResult[] = typedData
      .filter((item) => item.embedding)
      .map((item) => ({
        memory: this.recordToMemory(item as Record<string, unknown>),
        similarity: this.cosineSimilarity(
          queryEmbedding,
          item.embedding as number[]
        ),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    console.log(
      `✓ [VectorDatabaseClient] 备用检索完成，返回 ${results.length} 条结果`
    );
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
    console.log('🔄 [VectorDatabaseClient] 开始更新向量记录...');
    console.log('📋 [VectorDatabaseClient] 更新参数:', {
      id,
      updates: {
        hasContent: !!updates.content,
        hasMetadata: !!updates.metadata,
        hasExpiresAt: !!updates.expiresAt,
        isActive: updates.isActive,
      },
    });

    if (!this.client || !this.isAvailable()) {
      console.warn('⚠️ [VectorDatabaseClient] 客户端不可用，无法更新');
      return false;
    }

    const updateData: Record<string, unknown> = {};

    if (updates.content) {
      console.log(
        '🔄 [VectorDatabaseClient] 内容有更新，重新生成 Embedding...'
      );
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
      console.log(`📤 [VectorDatabaseClient] 执行数据库更新，ID: ${id}...`);
      const { error } = await this.client
        .from(this.config.tableName!)
        .update(updateData)
        .eq('id', id);

      if (error) {
        this.handleFailure();
        console.error('❌ [VectorDatabaseClient] 更新失败:', {
          code: error.code,
          message: error.message,
        });
        return false;
      }

      this.handleSuccess();
      console.log('✓ [VectorDatabaseClient] 更新成功，ID:', id);
      return true;
    } catch (error) {
      this.handleFailure();
      console.error(
        '❌ [VectorDatabaseClient] 更新异常:',
        error instanceof Error ? error.message : '未知错误'
      );
      return false;
    }
  }

  /**
   * 软删除向量记录
   */
  async deleteVector(id: string): Promise<boolean> {
    console.log('🗑️ [VectorDatabaseClient] 软删除向量记录，ID:', id);
    return this.updateVector(id, { isActive: false });
  }

  /**
   * 永久删除向量记录
   */
  async hardDeleteVector(id: string): Promise<boolean> {
    console.log('🗑️ [VectorDatabaseClient] 永久删除向量记录，ID:', id);

    if (!this.client || !this.isAvailable()) {
      console.warn('⚠️ [VectorDatabaseClient] 客户端不可用，无法删除');
      return false;
    }

    try {
      console.log(`📤 [VectorDatabaseClient] 执行永久删除，ID: ${id}...`);
      const { error } = await this.client
        .from(this.config.tableName!)
        .delete()
        .eq('id', id);

      if (error) {
        this.handleFailure();
        console.error('❌ [VectorDatabaseClient] 删除失败:', {
          code: error.code,
          message: error.message,
        });
        return false;
      }

      this.handleSuccess();
      console.log('✓ [VectorDatabaseClient] 永久删除成功，ID:', id);
      return true;
    } catch {
      this.handleFailure();
      console.error('❌ [VectorDatabaseClient] 删除异常');
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
      console.log('✓ [VectorDatabaseClient] 从降级模式恢复正常');
    }
  }

  /**
   * 处理失败
   */
  private handleFailure(): void {
    this.consecutiveFailures++;
    console.warn(
      `⚠️ [VectorDatabaseClient] 操作失败，连续失败次数: ${this.consecutiveFailures}/${this.maxConsecutiveFailures}`
    );
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.state = 'degraded';
      console.warn('⚠️ [VectorDatabaseClient] 连续失败次数过多，进入降级模式');
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
        if (attempt > 0) {
          console.log(
            `🔄 [VectorDatabaseClient] 重试操作 (第 ${attempt + 1} 次)...`
          );
        }
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('未知错误');
        const delay = Math.pow(2, attempt) * 1000; // 指数退避
        console.warn(
          `⚠️ [VectorDatabaseClient] 操作失败，${delay}ms 后重试 (${attempt + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    console.error(`❌ [VectorDatabaseClient] 重试 ${maxRetries} 次后仍然失败`);
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
