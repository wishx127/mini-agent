/**
 * 记忆类型枚举
 */
export type MemoryType =
  | 'user_preference' // 用户偏好
  | 'fact' // 事实信息
  | 'experience' // 经验记录
  | 'task' // 任务相关
  | 'context'; // 上下文信息

/**
 * 记忆元数据接口
 */
export interface MemoryMetadata {
  /** 来源会话ID */
  sourceSessionId?: string;
  /** 置信度 (0-1) */
  confidence?: number;
  /** 标签列表 */
  tags?: string[];
  /** 自定义字段 */
  [key: string]: unknown;
}

/**
 * 记忆记录接口
 */
export interface Memory {
  /** 唯一标识 */
  id: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 记忆内容 */
  content: string;
  /** 向量嵌入 */
  embedding?: number[];
  /** 元数据 */
  metadata: MemoryMetadata;
  /** 会话ID */
  sessionId?: string;
  /** 创建时间 */
  createdAt: Date;
  /** 最后访问时间 */
  lastAccessedAt: Date;
  /** 访问次数 */
  accessCount: number;
  /** 过期时间 */
  expiresAt?: Date;
  /** 是否激活 */
  isActive: boolean;
}

/**
 * 创建记忆的输入参数
 */
export interface CreateMemoryInput {
  /** 记忆类型 */
  type: MemoryType;
  /** 记忆内容 */
  content: string;
  /** 元数据 */
  metadata?: MemoryMetadata;
  /** 会话ID */
  sessionId?: string;
  /** 过期时间 */
  expiresAt?: Date;
}

/**
 * 记忆搜索结果
 */
export interface MemorySearchResult {
  /** 记忆记录 */
  memory: Memory;
  /** 相似度分数 (0-1) */
  similarity: number;
}

/**
 * 记忆提取结果
 */
export interface MemoryExtractionResult {
  /** 提取的记忆 */
  memories: ExtractedMemory[];
  /** 提取是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 提取的单条记忆
 */
export interface ExtractedMemory {
  /** 记忆类型 */
  type: MemoryType;
  /** 记忆内容 */
  content: string;
  /** 置信度 */
  confidence: number;
  /** 元数据 */
  metadata?: MemoryMetadata;
}

/**
 * 向量数据库配置
 */
export interface VectorDatabaseConfig {
  /** Supabase URL */
  supabaseUrl: string;
  /** Supabase API Key */
  supabaseApiKey: string;
  /** 表名 */
  tableName?: string;
  /** embedding 维度 */
  embeddingDimension?: number;
  /** embedding API URL */
  embeddingApiUrl?: string;
  /** embedding 模型名称 */
  embeddingModel?: string;
  /** embedding API Key */
  embeddingApiKey?: string;
}

/**
 * 长期记忆配置
 */
export interface LongTermMemoryConfig {
  /** 是否启用长期记忆 */
  enabled: boolean;
  /** 检索 top-k 数量 */
  topK: number;
  /** 记忆提取置信度阈值 */
  extractionThreshold: number;
  /** 单次提取最大数量 */
  maxExtractionsPerTurn: number;
  /** 默认过期时间（毫秒） */
  defaultExpirationMs?: number;
  /** 相似度合并阈值 */
  mergeSimilarityThreshold: number;
  /** 持久化队列目录 */
  queueDir?: string;
  /** 队列最大重试次数 */
  queueMaxAttempts?: number;
  /** 队列重试退避时间（毫秒） */
  queueRetryBackoffMs?: number;
}

/**
 * 默认长期记忆配置
 */
export const DEFAULT_LONG_TERM_MEMORY_CONFIG: LongTermMemoryConfig = {
  enabled: false,
  topK: 5,
  extractionThreshold: 0.7,
  maxExtractionsPerTurn: 3,
  defaultExpirationMs: 30 * 24 * 60 * 60 * 1000, // 30 天
  mergeSimilarityThreshold: 0.95,
  queueMaxAttempts: 3,
  queueRetryBackoffMs: 30_000,
};
