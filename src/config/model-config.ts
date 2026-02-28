import * as fs from 'fs';
import * as path from 'path';

import * as dotenv from 'dotenv';

import { ModelConfig, DEFAULT_MODEL_CONFIG } from '../types/model-config.js';

/**
 * 配置管理器类
 */
export class ModelConfigManager {
  private config: ModelConfig;

  constructor(configPath?: string) {
    // 加载环境变量
    dotenv.config();

    // 按优先级合并配置：环境变量 > 配置文件 > 默认值
    const envConfig = this.loadFromEnv();
    const fileConfig = configPath ? this.loadFromFile(configPath) : {};

    this.config = {
      ...DEFAULT_MODEL_CONFIG,
      ...fileConfig,
      ...envConfig,
    } as ModelConfig;

    this.validateConfig();
  }

  /**
   * 从环境变量加载配置
   */
  private loadFromEnv(): Partial<ModelConfig> {
    const config: Partial<ModelConfig> = {};

    if (process.env.MODEL_BASE_URL) {
      config.baseUrl = process.env.MODEL_BASE_URL;
    }

    if (process.env.MODEL_NAME) {
      config.modelName = process.env.MODEL_NAME;
    }

    if (process.env.MODEL_API_KEY) {
      config.apiKey = process.env.MODEL_API_KEY;
    }

    if (process.env.MODEL_TEMPERATURE) {
      const temp = parseFloat(process.env.MODEL_TEMPERATURE);
      if (!isNaN(temp)) {
        config.temperature = temp;
      }
    }

    if (process.env.MODEL_MAX_TOKENS) {
      const maxTokens = parseInt(process.env.MODEL_MAX_TOKENS, 10);
      if (!isNaN(maxTokens)) {
        config.maxTokens = maxTokens;
      }
    }

    return config;
  }

  /**
   * 从.env配置文件加载配置
   */
  private loadFromFile(configPath: string): Partial<ModelConfig> {
    try {
      const fullPath = path.resolve(process.cwd(), configPath);

      if (!fs.existsSync(fullPath)) {
        console.warn(`.env配置文件不存在: ${fullPath}`);
        return {};
      }

      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      return this.parseEnvFile(fileContent);
    } catch (error) {
      console.error(`读取.env配置文件失败:`, error);
      return {};
    }
  }

  /**
   * 解析.env格式的配置文件
   */
  private parseEnvFile(content: string): Partial<ModelConfig> {
    const config: Partial<ModelConfig> = {};
    const envConfig = dotenv.parse(content);

    if (envConfig.MODEL_BASE_URL) {
      config.baseUrl = envConfig.MODEL_BASE_URL;
    }

    if (envConfig.MODEL_NAME) {
      config.modelName = envConfig.MODEL_NAME;
    }

    if (envConfig.MODEL_API_KEY) {
      config.apiKey = envConfig.MODEL_API_KEY;
    }

    if (envConfig.MODEL_TEMPERATURE) {
      const temp = parseFloat(envConfig.MODEL_TEMPERATURE);
      if (!isNaN(temp)) {
        config.temperature = temp;
      }
    }

    if (envConfig.MODEL_MAX_TOKENS) {
      const maxTokens = parseInt(envConfig.MODEL_MAX_TOKENS, 10);
      if (!isNaN(maxTokens)) {
        config.maxTokens = maxTokens;
      }
    }

    return config;
  }

  /**
   * 验证配置的有效性
   */
  private validateConfig(): void {
    if (!this.config.baseUrl) {
      throw new Error('模型baseUrl不能为空');
    }

    if (!this.config.modelName) {
      throw new Error('模型名称不能为空');
    }

    // 验证URL格式
    try {
      new URL(this.config.baseUrl);
    } catch {
      throw new Error(`无效的baseUrl格式: ${this.config.baseUrl}`);
    }

    // 验证温度参数范围
    if (this.config.temperature !== undefined) {
      if (this.config.temperature < 0 || this.config.temperature > 2) {
        throw new Error('温度参数必须在0-2之间');
      }
    }

    // 验证最大token数量
    if (this.config.maxTokens !== undefined) {
      if (this.config.maxTokens <= 0) {
        throw new Error('最大token数量必须大于0');
      }
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): ModelConfig {
    return { ...this.config };
  }
}
