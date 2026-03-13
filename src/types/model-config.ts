export interface ModelConfig {
  /**
   * LLM模型的base URL
   */
  baseUrl: string;

  /**
   * 模型名称
   */
  modelName: string;

  /**
   * API密钥（可选，某些提供商需要）
   */
  apiKey?: string;

  /**
   * 温度参数，控制响应的随机性 (0-2)
   */
  temperature?: number;

  /**
   * 最大token数量
   */
  maxTokens?: number;

  /**
   * 工具配置 - 插件化配置
   */
  tools?: ToolsConfig;

  /**
   * 编排层控制配置
   */
  orchestration?: OrchestrationConfig;

  /**
   * 长期记忆配置
   */
  longTermMemory?: LongTermMemoryOptions;
}

/**
 * 工具配置接口 - 支持任意工具
 *
 * 默认加载所有工具，可通过 disabled 禁用指定工具
 */
export interface ToolsConfig {
  /**
   * 禁用的工具列表（默认加载所有工具）
   */
  disabled?: string[];

  /**
   * 各工具的详细配置
   */
  configs?: Record<string, Record<string, unknown>>;
}

/**
 * 编排层控制配置
 */
export interface OrchestrationConfig {
  /**
   * 最大迭代次数（默认 3）
   */
  maxIterations?: number;

  /**
   * 总超时时间，毫秒（默认 30000）
   */
  timeout?: number;

  /**
   * Token 预警阈值（默认 0.9，即 90%）
   */
  tokenThreshold?: number;

  /**
   * 单个工具执行超时，毫秒（默认 30000）
   */
  toolTimeout?: number;

  /**
   * 结果最大长度（默认 4000）
   */
  maxResultLength?: number;
}

/**
 * 长期记忆配置选项
 */
export interface LongTermMemoryOptions {
  /**
   * 是否启用长期记忆（默认 false）
   */
  enabled?: boolean;

  /**
   * Supabase URL
   */
  supabaseUrl?: string;

  /**
   * Supabase API Key
   */
  supabaseApiKey?: string;

  /**
   * Embedding API Key（用于生成向量）
   */
  embeddingApiKey?: string;

  /**
   * Embedding API URL（可选，默认使用阿里云 dashscope）
   */
  embeddingApiUrl?: string;

  /**
   * Embedding 模型名称（可选，默认 text-embedding-v3）
   */
  embeddingModel?: string;

  /**
   * 检索 top-k 数量（默认 5）
   */
  topK?: number;

  /**
   * 记忆提取置信度阈值（默认 0.7）
   */
  extractionThreshold?: number;

  /**
   * 向量数据库表名（默认 memories）
   */
  tableName?: string;

  /**
   * Embedding 维度（默认 1536）
   */
  embeddingDimension?: number;

  /**
   * 是否启用队列 worker（默认 true）
   */
  queueWorkerEnabled?: boolean;

  /**
   * 队列最大重试次数（默认 3）
   */
  queueMaxAttempts?: number;

  /**
   * 队列重试退避时间（毫秒，默认 30000）
   */
  queueRetryBackoffMs?: number;

  /**
   * 队列轮询间隔（毫秒，默认 5000）
   */
  queuePollIntervalMs?: number;
}

/**
 * 默认配置值
 */
export const DEFAULT_MODEL_CONFIG: Partial<ModelConfig> = {
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-3.5-turbo',
  temperature: 0.7,
  maxTokens: 2048,
};
