/**
 * Span 管理模块
 * 负责操作级别的追踪管理（LLM 调用、工具调用）
 */
import type { Langfuse } from 'langfuse';

import type { ObservabilityClient } from './langfuse-client.js';
import type { SpanType, LLMUsage, CostCalculation } from './types.js';
import { TraceManager } from './trace-manager.js';

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
    ReturnType<ReturnType<Langfuse['trace']>['span']>
  > = new Map();
  private spanStartTimes: Map<string, number> = new Map();

  constructor(client: ObservabilityClient, traceManager: TraceManager) {
    this.client = client;
    this.traceManager = traceManager;
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

    const langfuseClient = this.client.getClient() as Langfuse;
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

    this.activeSpans.set(spanId, span);
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

    const span = this.activeSpans.get(spanId);
    if (!span) {
      return;
    }

    const startTime = this.spanStartTimes.get(spanId) || Date.now();
    const duration = Date.now() - startTime;

    const metadata: Record<string, unknown> = {
      ...(options.metadata || {}),
      durationMs: duration,
    };

    // 记录 Token 使用量
    if (options.usage) {
      metadata.usage = options.usage;
    }

    // 记录成本
    if (options.cost) {
      metadata.cost = options.cost;
    }

    // 处理错误情况
    if (options.error) {
      metadata.error = options.error.message;
      metadata.errorStack = options.error.stack;
      span.update({
        output: options.output,
        metadata,
        level: 'ERROR',
        statusMessage: options.error.message,
      });
    } else {
      span.update({
        output: options.output,
        metadata,
      });
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
    return this.createSpan({
      name,
      type: 'llm',
      input,
      metadata: {
        model,
      },
    });
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
