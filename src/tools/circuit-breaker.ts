/**
 * 熔断器状态枚举
 */
export const CircuitBreakerState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
} as const;

export type CircuitBreakerState =
  (typeof CircuitBreakerState)[keyof typeof CircuitBreakerState];

/**
 * 熔断器配置接口
 */
export interface CircuitBreakerConfig {
  /**
   * 失败阈值 - 达到此数量后熔断器打开
   */
  failureThreshold: number;
  /**
   * 恢复超时（毫秒）- 熔断器打开后等待此时间后进入半开状态
   */
  resetTimeout: number;
  /**
   * 半开状态下允许的测试请求数
   */
  halfOpenAttempts: number;
  /**
   * 时间窗口大小（毫秒）- 用于计算失败率
   */
  windowSize: number;
}

/**
 * 熔断器打开错误
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly state: CircuitBreakerState,
    public readonly resetTime?: number
  ) {
    super(
      `Circuit breaker is ${state} for tool '${toolName}'. ` +
        (resetTime
          ? `Will retry after ${resetTime}ms`
          : 'Please try again later.')
    );
    this.name = 'CircuitOpenError';
  }
}

/**
 * 熔断器类 - 实现状态机模式的熔断保护
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenAttempts: number = 0;
  private lastStateChangeTime: number = Date.now();
  private failureTimestamps: number[] = [];

  private readonly toolName: string;
  private readonly config: CircuitBreakerConfig;

  // 默认配置
  private static readonly DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeout: 30000, // 30秒
    halfOpenAttempts: 3,
    windowSize: 60000, // 1分钟时间窗口
  };

  constructor(toolName: string, config?: Partial<CircuitBreakerConfig>) {
    this.toolName = toolName;
    this.config = { ...CircuitBreaker.DEFAULT_CONFIG, ...config };
    this.logStateChange(CircuitBreakerState.CLOSED, CircuitBreakerState.CLOSED);
  }

  /**
   * 获取当前状态
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * 获取工具名称
   */
  getToolName(): string {
    return this.toolName;
  }

  /**
   * 获取熔断器配置
   */
  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  /**
   * 获取执行统计
   */
  getStats(): {
    state: CircuitBreakerState;
    failureCount: number;
    successCount: number;
    totalAttempts: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalAttempts: this.failureCount + this.successCount,
    };
  }

  /**
   * 执行受保护的函数
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // 检查状态转换
    this.checkStateTransition();

    // 如果处于 OPEN 状态，直接拒绝
    if (this.state === CircuitBreakerState.OPEN) {
      const remainingTime = this.getRemainingResetTime();
      this.logRejected();
      throw new CircuitOpenError(
        this.toolName,
        this.state,
        remainingTime > 0 ? remainingTime : undefined
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * 检查并执行状态转换
   */
  private checkStateTransition(): void {
    const now = Date.now();

    // CLOSED -> OPEN: 检查是否达到失败阈值
    if (this.state === CircuitBreakerState.CLOSED) {
      this.cleanupOldFailures(now);
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo(CircuitBreakerState.OPEN);
      }
    }

    // OPEN -> HALF_OPEN: 检查是否超时
    if (this.state === CircuitBreakerState.OPEN) {
      const elapsed = now - this.lastStateChangeTime;
      if (elapsed >= this.config.resetTimeout) {
        this.transitionTo(CircuitBreakerState.HALF_OPEN);
      }
    }
  }

  /**
   * 成功回调
   */
  private onSuccess(): void {
    this.successCount++;
    this.failureCount = 0; // 重置失败计数

    // HALF_OPEN -> CLOSED: 成功时关闭熔断器
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.config.halfOpenAttempts) {
        this.transitionTo(CircuitBreakerState.CLOSED);
      }
    }

    this.logStats();
  }

  /**
   * 失败回调
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.failureTimestamps.push(this.lastFailureTime);

    // HALF_OPEN -> OPEN: 失败时重新打开熔断器
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.transitionTo(CircuitBreakerState.OPEN);
    }

    // CLOSED -> OPEN: 检查是否立即达到阈值（快速失败）
    if (
      this.state === CircuitBreakerState.CLOSED &&
      this.failureCount >= this.config.failureThreshold
    ) {
      this.transitionTo(CircuitBreakerState.OPEN);
    }

    this.logStats();
  }

  /**
   * 转换到新状态
   */
  private transitionTo(newState: CircuitBreakerState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChangeTime = Date.now();

    // 重置相关计数器
    if (newState === CircuitBreakerState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenAttempts = 0;
      this.failureTimestamps = [];
    } else if (newState === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenAttempts = 0;
    }

    this.logStateChange(oldState, newState);
  }

  /**
   * 清理超过时间窗口的失败记录
   */
  private cleanupOldFailures(now: number): void {
    const cutoff = now - this.config.windowSize;
    this.failureTimestamps = this.failureTimestamps.filter((ts) => ts > cutoff);
    this.failureCount = this.failureTimestamps.length;
  }

  /**
   * 获取剩余恢复时间
   */
  private getRemainingResetTime(): number {
    if (this.state !== CircuitBreakerState.OPEN) {
      return 0;
    }
    const elapsed = Date.now() - this.lastStateChangeTime;
    return Math.max(0, this.config.resetTimeout - elapsed);
  }

  /**
   * 打印状态转换日志
   */
  private logStateChange(
    oldState: CircuitBreakerState,
    newState: CircuitBreakerState
  ): void {
    console.log(
      `[CircuitBreaker] ${this.toolName}: ${oldState} -> ${newState} ` +
        `| Stats: success=${this.successCount}, failures=${this.failureCount} ` +
        `| ${new Date().toISOString()}`
    );
  }

  /**
   * 打印执行统计
   */
  private logStats(): void {
    console.log(
      `[CircuitBreaker] ${this.toolName} stats: ` +
        `success=${this.successCount}, failures=${this.failureCount}`
    );
  }

  /**
   * 打印拒绝日志
   */
  private logRejected(): void {
    const remaining = this.getRemainingResetTime();
    console.log(
      `[CircuitBreaker] ${this.toolName} REJECTED (OPEN state): ` +
        `remaining=${remaining}ms | ${new Date().toISOString()}`
    );
  }

  /**
   * 重置熔断器
   */
  reset(): void {
    this.transitionTo(CircuitBreakerState.CLOSED);
  }
}
