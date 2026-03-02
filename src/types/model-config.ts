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
 * 默认配置值
 */
export const DEFAULT_MODEL_CONFIG: Partial<ModelConfig> = {
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-3.5-turbo',
  temperature: 0.7,
  maxTokens: 2048,
};
