/**
 * 可观测性系统类型定义
 * 包含 Langfuse 集成所需的所有类型
 */
import type { Langfuse } from 'langfuse';

/** 可观测性配置 */
export interface ObservabilityConfig {
  enabled: boolean;
  publicKey: string;
  secretKey: string;
  host: string;
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

export type LangfuseClientType = Langfuse | null;

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
