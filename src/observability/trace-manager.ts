/**
 * Trace 管理模块
 * 负责对话级别的追踪生命周期管理
 */
import type { Langfuse } from 'langfuse';

import type { ObservabilityClient } from './langfuse-client.js';
import type { TraceContext } from './types.js';

/**
 * Trace 管理器
 * 管理每次对话的完整追踪链
 */
export class TraceManager {
  private client: ObservabilityClient;
  private currentTraceId: string | null = null;
  private traceStartTime: number | null = null;

  constructor(client: ObservabilityClient) {
    this.client = client;
  }

  /**
   * 创建新的 Trace
   * @param context Trace 上下文信息
   * @returns Trace ID，如果可观测性未启用则返回 null
   */
  createTrace(context: TraceContext): string | null {
    if (!this.client.isEnabled()) {
      return null;
    }

    const langfuseClient = this.client.getClient() as Langfuse;

    const trace = langfuseClient.trace({
      id: context.traceId,
      name: context.name,
      sessionId: context.sessionId,
      userId: context.userId,
      metadata: context.metadata,
      input: context.input,
    });

    this.currentTraceId = context.traceId;
    this.traceStartTime = Date.now();

    return trace.id;
  }

  /**
   * 结束当前 Trace
   * @param output 输出内容
   * @param metadata 额外元数据
   */
  endTrace(output?: string, metadata?: Record<string, unknown>): void {
    if (!this.currentTraceId || !this.client.isEnabled()) {
      return;
    }

    const duration = this.traceStartTime ? Date.now() - this.traceStartTime : 0;

    const langfuseClient = this.client.getClient() as Langfuse;
    const trace = langfuseClient.trace({ id: this.currentTraceId });

    trace.update({
      output,
      metadata: {
        ...metadata,
        durationMs: duration,
      },
    });

    this.currentTraceId = null;
    this.traceStartTime = null;
  }

  /** 获取当前活跃的 Trace ID */
  getCurrentTraceId(): string | null {
    return this.currentTraceId;
  }

  /** 生成唯一的 Trace ID */
  generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
