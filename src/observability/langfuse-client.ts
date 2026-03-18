/**
 * Langfuse 客户端管理模块
 * 负责客户端初始化、配置管理和生命周期
 */
import { Langfuse } from 'langfuse';

import type {
  ObservabilityConfig,
  LangfuseClientType,
  LangfuseClient,
} from './types.js';

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

function createLangfuseInstance(config: {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}): LangfuseClient {
  const langfuseInstance = new Langfuse({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
  });
  return langfuseInstance as LangfuseClient;
}

/** 创建 Langfuse 客户端实例 */
export function createLangfuseClient(config: ObservabilityConfig): {
  wrapped: LangfuseClientType;
  raw: LangfuseClient | null;
} {
  if (!config.enabled) {
    console.log('📊 [Observability] Langfuse 未启用或配置缺失，跳过初始化');
    return { wrapped: null, raw: null };
  }

  try {
    const langfuseClient = createLangfuseInstance({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.host,
    });

    console.log('✅ [Observability] Langfuse 客户端初始化成功');

    const wrappedClient: LangfuseClientType = {
      createPrompt: async (options) => {
        const result = await (
          langfuseClient as unknown as {
            createPrompt(options: unknown): Promise<{ version: number }>;
          }
        ).createPrompt(options);
        return { version: result.version };
      },
      prompt: {
        get: async (name, options) => {
          const result = await (
            langfuseClient as unknown as {
              getPrompt(
                name: string,
                version: unknown,
                options?: unknown
              ): Promise<{ prompt: string; version: number } | null>;
            }
          ).getPrompt(name, undefined, options);
          if (!result) return null;
          return { prompt: result.prompt, version: result.version };
        },
      },
      flushAsync: async () => {
        await (
          langfuseClient as unknown as { flushAsync(): Promise<void> }
        ).flushAsync();
      },
    };

    return { wrapped: wrappedClient, raw: langfuseClient };
  } catch (error) {
    console.error(
      '❌ [Observability] Langfuse 客户端初始化失败:',
      error instanceof Error ? error.message : '未知错误'
    );
    return { wrapped: null, raw: null };
  }
}

/**
 * 可观测性客户端
 * 封装 Langfuse 客户端，提供统一的接口
 */
export class ObservabilityClient {
  private client: LangfuseClientType;
  private rawClient: LangfuseClient | null;
  private config: ObservabilityConfig;

  constructor(config?: ObservabilityConfig) {
    this.config = config ?? createObservabilityConfig();
    const result = createLangfuseClient(this.config);
    this.client = result.wrapped;
    this.rawClient = result.raw;
  }

  /** 检查可观测性是否启用 */
  isEnabled(): boolean {
    return this.config.enabled && this.client !== null;
  }

  /** 获取 Langfuse 客户端实例 */
  getClient(): LangfuseClientType {
    return this.client;
  }

  /** 获取原始 Langfuse 客户端实例（用于 trace/span 操作） */
  getRawClient(): LangfuseClient | null {
    return this.rawClient;
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
