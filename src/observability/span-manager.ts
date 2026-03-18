/**
 * Span 管理模块
 * 负责操作级别的追踪管理（LLM 调用、工具调用）
 */
import type { LangfuseSpanClient, LangfuseGenerationClient } from './types.js';
import type { ObservabilityClient } from './langfuse-client.js';
import type { SpanType, LLMUsage, CostCalculation } from './types.js';
import { TraceManager } from './trace-manager.js';

function buildUsageDetails(
  usage?: LLMUsage
): Record<string, number> | undefined {
  if (!usage) return undefined;
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    total: usage.totalTokens,
  };
}

function buildCostDetails(
  cost?: CostCalculation
): Record<string, number> | undefined {
  if (!cost) return undefined;
  return {
    input: cost.inputCost,
    output: cost.outputCost,
    total: cost.totalCost,
  };
}

/** 创建 Span 的选项 */
export interface CreateSpanOptions {
  name: string;
  type: SpanType;
  input?: unknown;
  metadata?: Record<string, unknown>;
}

/** 结束 Span 的选项 */
export interface EndSpanOptions {
  output?: unknown;
  usage?: LLMUsage;
  cost?: CostCalculation;
  metadata?: Record<string, unknown>;
  error?: Error;
}

/**
 * Span 管理器
 * 管理 LLM 调用和工具调用的追踪
 */
export class SpanManager {
  private client: ObservabilityClient;
  private traceManager: TraceManager;
  private activeSpans: Map<
    string,
    | { kind: 'span'; client: LangfuseSpanClient }
    | { kind: 'generation'; client: LangfuseGenerationClient }
  > = new Map();
  private spanStartTimes: Map<string, number> = new Map();

  constructor(client: ObservabilityClient, traceManager: TraceManager) {
    this.client = client;
    this.traceManager = traceManager;
  }

  getObservabilityClient(): ObservabilityClient {
    return this.client;
  }

  /**
   * 创建新的 Span
   * @param options Span 创建选项
   * @returns Span ID，如果可观测性未启用则返回 null
   */
  createSpan(options: CreateSpanOptions): string | null {
    if (!this.client.isEnabled()) {
      return null;
    }

    const traceId = this.traceManager.getCurrentTraceId();
    if (!traceId) {
      return null;
    }

    const langfuseClient = this.client.getRawClient();
    if (!langfuseClient) {
      return null;
    }

    const trace = langfuseClient.trace({ id: traceId });

    const spanId = this.generateSpanId(options.type);
    const startTime = Date.now();

    const span = trace.span({
      id: spanId,
      name: options.name,
      input: options.input,
      metadata: {
        ...options.metadata,
        type: options.type,
      },
    });

    this.activeSpans.set(spanId, { kind: 'span', client: span });
    this.spanStartTimes.set(spanId, startTime);

    return spanId;
  }

  /**
   * 结束 Span
   * @param spanId Span ID
   * @param options 结束选项
   */
  endSpan(spanId: string, options: EndSpanOptions = {}): void {
    if (!this.client.isEnabled()) {
      return;
    }

    const active = this.activeSpans.get(spanId);
    if (!active) {
      return;
    }

    const startTime = this.spanStartTimes.get(spanId) || Date.now();
    const duration = Date.now() - startTime;

    const metadata: Record<string, unknown> = {
      ...(options.metadata || {}),
      durationMs: duration,
    };

    // 记录 Token 使用量（作为元数据保留，便于排查）
    if (options.usage) {
      metadata.usage = options.usage;
    }

    // 记录成本（作为元数据保留，便于排查）
    if (options.cost) {
      metadata.cost = options.cost;
    }

    // 处理错误情况
    if (options.error) {
      metadata.error = options.error.message;
      metadata.errorStack = options.error.stack;
      if (active.kind === 'generation') {
        active.client.end({
          output: options.output,
          metadata,
          level: 'ERROR',
          statusMessage: options.error.message,
          usageDetails: buildUsageDetails(options.usage),
          costDetails: buildCostDetails(options.cost),
        });
      } else {
        active.client.end({
          output: options.output,
          metadata,
          level: 'ERROR',
          statusMessage: options.error.message,
        });
      }
    } else {
      if (active.kind === 'generation') {
        active.client.end({
          output: options.output,
          metadata,
          usageDetails: buildUsageDetails(options.usage),
          costDetails: buildCostDetails(options.cost),
        });
      } else {
        active.client.end({
          output: options.output,
          metadata,
        });
      }
    }

    this.activeSpans.delete(spanId);
    this.spanStartTimes.delete(spanId);
  }

  /**
   * 创建 LLM 调用 Span
   * @param name Span 名称
   * @param input 输入内容
   * @param model 模型名称
   */
  createLLMSpan(name: string, input: unknown, model?: string): string | null {
    if (!this.client.isEnabled()) {
      return null;
    }

    const traceId = this.traceManager.getCurrentTraceId();
    if (!traceId) {
      return null;
    }

    const langfuseClient = this.client.getRawClient();
    if (!langfuseClient) {
      return null;
    }

    const trace = langfuseClient.trace({ id: traceId });

    const spanId = this.generateSpanId('llm');
    const startTime = Date.now();

    if (typeof trace.generation === 'function') {
      const generation = trace.generation({
        id: spanId,
        name,
        input,
        model,
        metadata: {
          type: 'llm',
        },
      });
      this.activeSpans.set(spanId, { kind: 'generation', client: generation });
      this.spanStartTimes.set(spanId, startTime);
      return spanId;
    }

    // fallback: 旧版本 SDK 不支持 generation 时，退回到普通 span
    const span = trace.span({
      id: spanId,
      name,
      input,
      metadata: {
        model,
        type: 'llm',
      },
    });

    this.activeSpans.set(spanId, { kind: 'span', client: span });
    this.spanStartTimes.set(spanId, startTime);
    return spanId;
  }

  /**
   * 结束 LLM 调用 Span
   * @param spanId Span ID
   * @param output 输出内容
   * @param usage Token 使用量
   * @param cost 成本计算结果
   * @param model 模型名称
   */
  endLLMSpan(
    spanId: string,
    output: unknown,
    usage?: LLMUsage,
    cost?: CostCalculation,
    model?: string
  ): void {
    this.endSpan(spanId, {
      output,
      usage,
      cost,
      metadata: model ? { model } : undefined,
    });
  }

  /**
   * 创建工具调用 Span
   * @param name Span 名称
   * @param toolName 工具名称
   * @param input 输入参数
   */
  createToolSpan(
    name: string,
    toolName: string,
    input: unknown
  ): string | null {
    return this.createSpan({
      name,
      type: 'tool',
      input,
      metadata: {
        toolName,
      },
    });
  }

  /**
   * 结束工具调用 Span
   * @param spanId Span ID
   * @param output 输出结果
   * @param success 是否成功
   * @param executionTime 执行时间
   * @param error 错误信息
   */
  endToolSpan(
    spanId: string,
    output: unknown,
    success: boolean,
    executionTime?: number,
    error?: Error
  ): void {
    this.endSpan(spanId, {
      output,
      metadata: {
        success,
        executionTime,
      },
      error,
    });
  }

  /** 生成唯一的 Span ID */
  private generateSpanId(type: SpanType): string {
    return `span_${type}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /** 获取活跃 Span 数量 */
  getActiveSpanCount(): number {
    return this.activeSpans.size;
  }
}
