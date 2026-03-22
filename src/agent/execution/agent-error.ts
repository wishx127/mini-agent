import { AgentError } from './types.js';

export type AgentErrorType = AgentError['type'];

export interface AgentErrorConfig {
  maxRetries: Record<AgentErrorType, number>;
  severityThresholds: {
    retryable: number;
    critical: number;
  };
}

export const DEFAULT_AGENT_ERROR_CONFIG: AgentErrorConfig = {
  maxRetries: {
    tool_error: 3,
    planner_error: 2,
    system_error: 1,
    timeout_error: 3,
    validation_error: 2,
  },
  severityThresholds: {
    retryable: 3,
    critical: 4,
  },
};

export class AgentErrorHandler {
  private config: AgentErrorConfig;
  private errorHistory: AgentError[] = [];

  constructor(config: Partial<AgentErrorConfig> = {}) {
    this.config = { ...DEFAULT_AGENT_ERROR_CONFIG, ...config };
  }

  /**
   * 创建 AgentError 实例
   */
  createError(
    type: AgentErrorType,
    message: string,
    options: {
      originalError?: unknown;
      severity?: AgentError['severity'];
      context?: Record<string, unknown>;
      iteration?: number;
    } = {}
  ): AgentError {
    const severity = options.severity ?? this.inferSeverity(type);
    const retryable = this.isRetryable(type, severity);

    const error: AgentError = {
      type,
      retryable,
      severity,
      message,
      originalError: options.originalError,
      timestamp: Date.now(),
      iteration: options.iteration ?? 0,
      context: options.context,
    };

    this.errorHistory.push(error);
    return error;
  }

  /**
   * 从原始错误推断错误类型
   */
  inferErrorType(error: unknown): AgentErrorType {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('timeout') || message.includes('timed out')) {
        return 'timeout_error';
      }

      if (
        message.includes('validation') ||
        message.includes('invalid') ||
        message.includes('required')
      ) {
        return 'validation_error';
      }

      if (
        message.includes('network') ||
        message.includes('connection') ||
        message.includes('fetch')
      ) {
        return 'tool_error';
      }

      if (message.includes('plan') || message.includes('planner')) {
        return 'planner_error';
      }
    }

    return 'system_error';
  }

  /**
   * 推断错误严重程度
   */
  private inferSeverity(type: AgentErrorType): AgentError['severity'] {
    switch (type) {
      case 'timeout_error':
        return 2;
      case 'validation_error':
        return 2;
      case 'tool_error':
        return 3;
      case 'planner_error':
        return 3;
      case 'system_error':
        return 4;
      default:
        return 3;
    }
  }

  /**
   * 判断错误是否可重试
   */
  isRetryable(type: AgentErrorType, severity: AgentError['severity']): boolean {
    if (severity >= this.config.severityThresholds.critical) {
      return false;
    }

    return severity <= this.config.severityThresholds.retryable;
  }

  /**
   * 获取错误类型的重试次数
   */
  getMaxRetries(type: AgentErrorType): number {
    return this.config.maxRetries[type] ?? 1;
  }

  /**
   * 检查是否应该重试
   */
  shouldRetry(error: AgentError, currentRetryCount: number): boolean {
    if (!error.retryable) {
      return false;
    }

    const maxRetries = this.getMaxRetries(error.type);
    return currentRetryCount < maxRetries;
  }

  /**
   * 格式化错误信息
   */
  formatError(error: AgentError): string {
    const parts: string[] = [];

    parts.push(`[${error.type.toUpperCase()}]`);
    parts.push(error.message);

    if (error.severity >= this.config.severityThresholds.critical) {
      parts.push('(严重)');
    }

    if (error.retryable) {
      parts.push('(可重试)');
    }

    if (error.context) {
      const contextStr = Object.entries(error.context)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(', ');
      parts.push(`上下文: ${contextStr}`);
    }

    return parts.join(' ');
  }

  /**
   * 获取错误统计
   */
  getErrorStats(): {
    total: number;
    byType: Record<AgentErrorType, number>;
    bySeverity: Record<number, number>;
    retryableCount: number;
  } {
    const stats = {
      total: this.errorHistory.length,
      byType: {} as Record<AgentErrorType, number>,
      bySeverity: {} as Record<number, number>,
      retryableCount: 0,
    };

    for (const error of this.errorHistory) {
      // 按类型统计
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;

      // 按严重程度统计
      stats.bySeverity[error.severity] =
        (stats.bySeverity[error.severity] || 0) + 1;

      // 可重试统计
      if (error.retryable) {
        stats.retryableCount++;
      }
    }

    return stats;
  }

  /**
   * 获取最近的错误
   */
  getRecentErrors(count: number = 5): AgentError[] {
    return this.errorHistory.slice(-count);
  }

  /**
   * 清除错误历史
   */
  clearHistory(): void {
    this.errorHistory = [];
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<AgentErrorConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取当前配置
   */
  getConfig(): AgentErrorConfig {
    return { ...this.config };
  }
}

/**
 * 工具函数：将普通错误转换为 AgentError
 */
export function wrapError(
  error: unknown,
  type?: AgentErrorType,
  context?: Record<string, unknown>
): AgentError {
  const handler = new AgentErrorHandler();
  const inferredType = type ?? handler.inferErrorType(error);
  const message = error instanceof Error ? error.message : String(error);

  return handler.createError(inferredType, message, {
    originalError: error,
    context,
  });
}

/**
 * 工具函数：创建工具错误
 */
export function createToolError(
  message: string,
  originalError?: unknown,
  context?: Record<string, unknown>
): AgentError {
  const handler = new AgentErrorHandler();
  return handler.createError('tool_error', message, {
    originalError,
    context,
  });
}

/**
 * 工具函数：创建规划器错误
 */
export function createPlannerError(
  message: string,
  originalError?: unknown,
  context?: Record<string, unknown>
): AgentError {
  const handler = new AgentErrorHandler();
  return handler.createError('planner_error', message, {
    originalError,
    context,
  });
}

/**
 * 工具函数：创建超时错误
 */
export function createTimeoutError(
  message: string,
  context?: Record<string, unknown>
): AgentError {
  const handler = new AgentErrorHandler();
  return handler.createError('timeout_error', message, {
    context,
  });
}

/**
 * 工具函数：创建验证错误
 */
export function createValidationError(
  message: string,
  context?: Record<string, unknown>
): AgentError {
  const handler = new AgentErrorHandler();
  return handler.createError('validation_error', message, {
    context,
  });
}
