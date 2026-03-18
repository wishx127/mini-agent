/**
 * 可观测性系统类型定义
 * 包含 Langfuse 集成所需的所有类型
 */

/** 可观测性配置 */
export interface ObservabilityConfig {
  enabled: boolean;
  publicKey: string;
  secretKey: string;
  host: string;
}

export interface CreatePromptOptions {
  name: string;
  prompt: string;
  labels?: string[];
  config?: { model: string };
}

export interface CreatePromptResult {
  version: number;
}

export interface LangfusePromptGetOptions {
  label?: string;
  cacheTtlSeconds?: number;
  fallback?: string;
  maxRetries?: number;
  type?: 'text';
  fetchTimeoutMs?: number;
}

export interface LangfusePromptResult {
  prompt: string;
  version: number;
}

export interface LangfusePromptApi {
  get(
    name: string,
    options: LangfusePromptGetOptions
  ): Promise<LangfusePromptResult | null>;
}

export interface LangfuseCreatePromptApi {
  createPrompt(options: CreatePromptOptions): Promise<CreatePromptResult>;
}

export interface LangfusePromptClient {
  createPrompt(options: CreatePromptOptions): Promise<CreatePromptResult>;
  prompt: LangfusePromptApi;
  flushAsync(): Promise<void>;
}

/** Trace 上下文信息 */
export interface TraceContext {
  traceId: string;
  name: string;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  input?: string;
}

/** Span 上下文信息 */
export interface SpanContext {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  type: SpanType;
  startTime: number;
  metadata?: Record<string, unknown>;
  input?: unknown;
}

/** Span 类型：LLM 调用或工具调用 */
export type SpanType = 'llm' | 'tool';

/** LLM Token 使用量 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** 成本计算结果 */
export interface CostCalculation {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

/** 模型定价配置 */
export interface ModelPricing {
  inputCostPer1k: number;
  outputCostPer1k: number;
  currency: string;
}

/** 用户自定义模型定价表 */
export interface ModelPricingConfig {
  pricing: Record<string, ModelPricing>;
  defaultPricing?: ModelPricing;
}

/** JSON 定价配置文件路径配置 */
export interface PricingFileConfig {
  filePath: string;
}

export type LangfuseClientType = LangfusePromptClient | null;

/** 可观测性上下文 */
export interface ObservabilityContext {
  client: LangfuseClientType;
  enabled: boolean;
  currentTrace: TraceContext | null;
  currentSpan: SpanContext | null;
}

/** Prompt 模板定义 */
export interface PromptTemplate {
  name: string;
  content: string;
  version?: string;
  labels?: string[];
}

/** Trace 方法接口 */
export interface LangfuseTrace {
  id: string;
  span(params: {
    id?: string;
    name?: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  }): LangfuseSpanClient;
  generation(params: {
    id?: string;
    name?: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
    model?: string;
  }): LangfuseGenerationClient;
  update(params: {
    output?: string;
    metadata?: Record<string, unknown>;
    level?: string;
    statusMessage?: string;
  }): void;
}

/** Span 方法接口 */
export interface LangfuseSpanClient {
  update(params: {
    output?: unknown;
    metadata?: Record<string, unknown>;
    level?: string;
    statusMessage?: string;
  }): void;
  end(params?: {
    output?: unknown;
    metadata?: Record<string, unknown>;
    level?: string;
    statusMessage?: string;
  }): void;
  id: string;
  traceId: string;
}

/** Generation 方法接口（支持 usage/cost 详情） */
export interface LangfuseGenerationClient {
  update(params: {
    output?: unknown;
    metadata?: Record<string, unknown>;
    level?: string;
    statusMessage?: string;
    usageDetails?: Record<string, number>;
    costDetails?: Record<string, number>;
    model?: string;
  }): void;
  end(params?: {
    output?: unknown;
    metadata?: Record<string, unknown>;
    level?: string;
    statusMessage?: string;
    usageDetails?: Record<string, number>;
    costDetails?: Record<string, number>;
    model?: string;
  }): void;
  id: string;
  traceId: string;
}

/** Langfuse 客户端只读接口 - 只包含实际使用的方法 */
export interface LangfuseClient {
  trace(params: {
    id: string;
    name?: string;
    sessionId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
    input?: unknown;
  }): LangfuseTrace;
}
