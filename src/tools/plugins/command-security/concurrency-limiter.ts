/**
 * 并发限制器
 * 限制同时执行的命令数量
 */

import { ErrorCode, ErrorType, ToolError } from './types.js';

/**
 * 并发限制器配置
 */
interface ConcurrencyLimiterConfig {
  maxConcurrent: number;
}

/**
 * 并发限制器
 */
export class ConcurrencyLimiter {
  private config: ConcurrencyLimiterConfig;
  private runningCount: number = 0;

  constructor(config: ConcurrencyLimiterConfig = { maxConcurrent: 3 }) {
    this.config = config;
  }

  /**
   * 尝试获取执行许可
   */
  acquire(): { allowed: boolean; error?: ToolError } {
    if (this.runningCount >= this.config.maxConcurrent) {
      return {
        allowed: false,
        error: {
          code: ErrorCode.CONCURRENCY_LIMIT_EXCEEDED,
          message: `Too many commands running (max: ${this.config.maxConcurrent})`,
          type: ErrorType.RESOURCE,
          retryable: true,
          details: {
            running: this.runningCount,
            max: this.config.maxConcurrent,
          },
        },
      };
    }

    this.runningCount++;
    return { allowed: true };
  }

  /**
   * 释放执行许可
   */
  release(): void {
    if (this.runningCount > 0) {
      this.runningCount--;
    }
  }

  /**
   * 获取当前运行数量
   */
  getRunningCount(): number {
    return this.runningCount;
  }

  /**
   * 获取最大并发数
   */
  getMaxConcurrent(): number {
    return this.config.maxConcurrent;
  }
}

// 导出单例实例
export const concurrencyLimiter = new ConcurrencyLimiter({ maxConcurrent: 3 });
