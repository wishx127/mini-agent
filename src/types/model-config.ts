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
}

/**
 * 默认配置值
 */
export const DEFAULT_MODEL_CONFIG: Partial<ModelConfig> = {
  baseUrl: "https://api.openai.com/v1",
  modelName: "gpt-3.5-turbo",
  temperature: 0.7,
  maxTokens: 2048
};