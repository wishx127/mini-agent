/**
 * Langfuse 客户端管理模块
 * 负责客户端初始化、配置管理和生命周期
 */
import Langfuse from 'langfuse';

import type { ObservabilityConfig, LangfuseClientType } from './types.js';

const DEFAULT_LANGFUSE_HOST = 'https://cloud.langfuse.com';

/** 从环境变量创建可观测性配置 */
export function createObservabilityConfig(): ObservabilityConfig {
  const enabled = process.env.LANGFUSE_ENABLED !== 'false';
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY || '';
  const secretKey = process.env.LANGFUSE_SECRET_KEY || '';
  const host = process.env.LANGFUSE_HOST || DEFAULT_LANGFUSE_HOST;

  return {
    enabled: enabled && !!publicKey && !!secretKey,
    publicKey,
    secretKey,
    host,
  };
}

/** 创建 Langfuse 客户端实例 */
export function createLangfuseClient(
  config: ObservabilityConfig
): LangfuseClientType {
  if (!config.enabled) {
    console.log('📊 [Observability] Langfuse 未启用或配置缺失，跳过初始化');
    return null;
  }

  try {
    const client = new Langfuse({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.host,
    });

    console.log('✅ [Observability] Langfuse 客户端初始化成功');
    return client;
  } catch (error) {
    console.error(
      '❌ [Observability] Langfuse 客户端初始化失败:',
      error instanceof Error ? error.message : '未知错误'
    );
    return null;
  }
}

/**
 * 可观测性客户端
 * 封装 Langfuse 客户端，提供统一的接口
 */
export class ObservabilityClient {
  private client: LangfuseClientType;
  private config: ObservabilityConfig;

  constructor(config?: ObservabilityConfig) {
    this.config = config ?? createObservabilityConfig();
    this.client = createLangfuseClient(this.config);
  }

  /** 检查可观测性是否启用 */
  isEnabled(): boolean {
    return this.config.enabled && this.client !== null;
  }

  /** 获取 Langfuse 客户端实例 */
  getClient(): LangfuseClientType {
    return this.client;
  }

  /** 获取当前配置 */
  getConfig(): ObservabilityConfig {
    return this.config;
  }

  /** 刷新数据到 Langfuse */
  async flush(): Promise<void> {
    if (this.client) {
      await this.client.flushAsync();
    }
  }

  /** 关闭客户端 */
  async shutdown(): Promise<void> {
    await this.flush();
  }
}

/** 默认客户端实例（单例） */
let defaultClient: ObservabilityClient | null = null;

/** 获取默认可观测性客户端 */
export function getObservabilityClient(): ObservabilityClient {
  if (!defaultClient) {
    defaultClient = new ObservabilityClient();
  }
  return defaultClient;
}

/** 重置默认客户端 */
export function resetObservabilityClient(): void {
  defaultClient = null;
}

/** 创建禁用状态的可观测性客户端（用于降级场景） */
export function createDisabledObservabilityClient(): ObservabilityClient {
  return new ObservabilityClient({
    enabled: false,
    publicKey: '',
    secretKey: '',
    host: '',
  });
}
