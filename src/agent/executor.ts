import {
  ControlConfig,
  DEFAULT_CONTROL_CONFIG,
  DEFAULT_RETRY_STRATEGIES,
  ExecutionPlan,
  NetworkError,
  ParameterError,
  TimeoutError,
  ToolExecutionResult,
  UnknownError,
  AgentError,
  ToolCallDetail,
} from '../types/agent.js';
import { ToolRegistry, CircuitOpenError } from '../tools/index.js';

/**
 * Executor - Agent 编排层的执行模块
 *
 * 职责：
 * - 工具调用执行
 * - 异常处理和分类
 * - 重试机制
 * - 结果格式化和截断
 * - 执行时间追踪
 */
export class Executor {
  private toolRegistry: ToolRegistry;
  private config: ControlConfig;

  constructor(toolRegistry: ToolRegistry, config: Partial<ControlConfig>) {
    this.toolRegistry = toolRegistry;
    this.config = { ...DEFAULT_CONTROL_CONFIG, ...config };
  }

  /**
   * 执行执行计划
   */
  async execute(plan: ExecutionPlan): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const toolCall of plan.toolCalls) {
      const result = await this.executeWithRetry(toolCall);
      results.push(result);
    }

    return results;
  }

  /**
   * 执行单个工具（带重试机制）
   */
  private async executeWithRetry(
    toolCall: ToolCallDetail
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    let retryCount = 0;

    // 获取工具信息
    const tool = this.toolRegistry.getTool(toolCall.toolName);
    if (!tool) {
      return this.createFailureResult(
        toolCall,
        `未找到工具: ${toolCall.toolName}`,
        startTime
      );
    }

    if (!tool.enabled) {
      return this.createFailureResult(
        toolCall,
        `工具未启用: ${toolCall.toolName}`,
        startTime
      );
    }

    // 验证参数
    const validationError = this.validateParams(toolCall);
    if (validationError) {
      return this.createFailureResult(toolCall, validationError, startTime);
    }

    // 初始执行
    let result = await this.executeTool(toolCall, startTime);

    // 如果失败，尝试重试
    if (!result.success && result.lastError) {
      const error = this.classifyError(result.lastError);
      const strategy = DEFAULT_RETRY_STRATEGIES[error.type];

      while (retryCount < strategy.maxRetries) {
        const delay = strategy.delays[retryCount] || 1000;
        console.log(
          `🔄 [Executor] 重试 ${toolCall.toolName} (第 ${retryCount + 1} 次)，延迟 ${delay}ms`
        );

        await this.sleep(delay);
        retryCount++;

        result = await this.executeTool(toolCall, startTime);
        if (result.success) {
          result.retryCount = retryCount;
          break;
        }
      }
    }

    return result;
  }

  /**
   * 执行单个工具
   */
  private async executeTool(
    toolCall: ToolCallDetail,
    startTime: number
  ): Promise<ToolExecutionResult> {
    const toolCallId = toolCall.toolCallId || `tool_${Date.now()}`;
    const tool = this.toolRegistry.getTool(toolCall.toolName);

    console.log(`⚡ [Executor] 执行工具: ${toolCall.toolName}`);
    console.log(`   参数: ${JSON.stringify(toolCall.arguments)}`);

    // 获取工具级超时或使用默认超时
    const timeout = tool?.timeout || this.config.toolTimeout;

    // 获取熔断器
    const breaker = this.toolRegistry.getToolBreaker(toolCall.toolName);
    const circuitStateBefore = breaker.getState();

    try {
      // 使用熔断器包装执行
      const result = await breaker.execute(async () => {
        // 使用 Promise.race 实现超时控制
        return Promise.race([
          this.toolRegistry.executeTool(toolCall.toolName, toolCall.arguments),
          this.createTimeout(timeout),
        ]);
      });

      const executionTime = Date.now() - startTime;
      const formattedResult = this.formatResult(result);
      const truncatedResult = this.truncateResult(formattedResult);

      console.log(`✅ [Executor] 执行完成 (耗时 ${executionTime}ms)`);

      return {
        success: true,
        result: truncatedResult,
        toolCallId,
        toolName: toolCall.toolName,
        executionTime,
        circuitBreakerState: breaker.getState(),
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      // 处理熔断器打开错误
      if (error instanceof CircuitOpenError) {
        console.error(`🛡️ [Executor] 熔断器已打开: ${error.message}`);
        return {
          success: false,
          result: `工具执行被熔断器拦截: ${error.message}`,
          toolCallId,
          toolName: toolCall.toolName,
          executionTime,
          lastError: error.message,
          circuitBreakerState: circuitStateBefore,
        };
      }

      const errorMessage = error instanceof Error ? error.message : '未知错误';

      console.error(`❌ [Executor] 执行失败: ${errorMessage}`);

      return {
        success: false,
        result: `工具执行失败: ${errorMessage}`,
        toolCallId,
        toolName: toolCall.toolName,
        executionTime,
        lastError: errorMessage,
        circuitBreakerState: breaker.getState(),
      };
    }
  }

  /**
   * 错误分类
   */
  handleError(error: Error): AgentError {
    return this.classifyError(error);
  }

  /**
   * 分类错误类型
   */
  private classifyError(error: Error | string): AgentError {
    const message = typeof error === 'string' ? error : error.message;
    const lowerMessage = message.toLowerCase();

    // 网络错误
    if (
      lowerMessage.includes('network') ||
      lowerMessage.includes('fetch') ||
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('enotfound') ||
      lowerMessage.includes('网络')
    ) {
      return new NetworkError(
        message,
        typeof error === 'object' ? error : undefined
      );
    }

    // 超时错误
    if (
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('超时') ||
      lowerMessage.includes('timed out')
    ) {
      return new TimeoutError(message, this.config.toolTimeout);
    }

    // 参数错误
    if (
      lowerMessage.includes('invalid parameter') ||
      lowerMessage.includes('参数') ||
      lowerMessage.includes('argument') ||
      lowerMessage.includes('required')
    ) {
      return new ParameterError(message);
    }

    // 未知错误
    return new UnknownError(
      message,
      typeof error === 'object' ? error : undefined
    );
  }

  /**
   * 验证工具参数
   */
  private validateParams(toolCall: ToolCallDetail): string | null {
    if (!toolCall.arguments || typeof toolCall.arguments !== 'object') {
      return '参数必须是一个对象';
    }

    // 基础验证可以根据工具 schema 扩展
    return null;
  }

  /**
   * 格式化结果
   */
  formatResult(result: unknown): string {
    if (typeof result === 'string') {
      return result;
    }

    if (result === null || result === undefined) {
      return '无结果';
    }

    try {
      return JSON.stringify(result, null, 2);
    } catch {
      // 如果 JSON.stringify 失败，返回占位符
      return '[无法序列化的结果]';
    }
  }

  /**
   * 截断结果
   */
  truncateResult(result: string): string {
    if (result.length <= this.config.maxResultLength) {
      return result;
    }

    const truncated = result.substring(0, this.config.maxResultLength);
    console.log(
      `✂️ [Executor] 结果过长，已截断 ${result.length} → ${this.config.maxResultLength} 字符`
    );

    return `${truncated}\n\n[结果已截断...]`;
  }

  /**
   * 创建超时 Promise
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('工具执行超时')), ms);
    });
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 创建失败结果
   */
  private createFailureResult(
    toolCall: ToolCallDetail,
    errorMessage: string,
    startTime: number
  ): ToolExecutionResult {
    const executionTime = Date.now() - startTime;
    return {
      success: false,
      result: `工具执行失败: ${errorMessage}`,
      toolCallId: toolCall.toolCallId || `tool_${Date.now()}`,
      toolName: toolCall.toolName,
      executionTime,
      lastError: errorMessage,
    };
  }
}
