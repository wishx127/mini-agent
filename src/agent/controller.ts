import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
} from '@langchain/core/messages';

import {
  ControlConfig,
  DEFAULT_CONTROL_CONFIG,
  ExecutionMetrics,
  ExecutionState,
  ExecutionStatus,
  FallbackResult,
  TokenStatus,
  ToolExecutionResult,
  ConversationMessage,
  PlanningContext,
  ToolInfo,
} from '../types/agent.js';
import { ToolRegistry } from '../tools/index.js';

import { Planner } from './planner.js';
import { Executor } from './executor.js';

/**
 * 估算文本 Token 数量
 * 使用简单的估算方法：平均每 4 个字符约等于 1 个 token
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Controller - Agent 编排层的控制模块
 *
 * 职责：
 * - Token 上限控制
 * - 超时管理
 * - 调用次数限制
 * - 失败兜底策略
 * - 协调 Planner 和 Executor
 */
export class Controller {
  private config: ControlConfig;
  private metrics: ExecutionMetrics;
  private state: ExecutionState = 'idle';
  private planner: Planner;
  private executor: Executor;
  private llm: ChatOpenAI;
  private toolRegistry: ToolRegistry;

  constructor(
    llm: ChatOpenAI,
    toolRegistry: ToolRegistry,
    config: Partial<ControlConfig> = {}
  ) {
    this.config = this.validateAndMergeConfig(config);
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.planner = new Planner(llm, toolRegistry);
    this.executor = new Executor(toolRegistry, this.config);
    this.metrics = this.initMetrics();
    // 初始化 startTime，避免 checkTimeout() 在 execute() 前调用时返回错误结果
    this.metrics.startTime = Date.now();
  }

  /**
   * 验证并合并配置
   */
  private validateAndMergeConfig(
    config: Partial<ControlConfig>
  ): ControlConfig {
    const merged = { ...DEFAULT_CONTROL_CONFIG, ...config };

    // 验证配置值
    if (merged.maxTokens <= 0) {
      console.warn('⚠️ [Controller] maxTokens 必须大于 0，使用默认值');
      merged.maxTokens = DEFAULT_CONTROL_CONFIG.maxTokens;
    }
    if (merged.maxIterations <= 0) {
      console.warn('⚠️ [Controller] maxIterations 必须大于 0，使用默认值');
      merged.maxIterations = DEFAULT_CONTROL_CONFIG.maxIterations;
    }
    if (merged.timeout <= 0) {
      console.warn('⚠️ [Controller] timeout 必须大于 0，使用默认值');
      merged.timeout = DEFAULT_CONTROL_CONFIG.timeout;
    }
    if (merged.tokenThreshold <= 0 || merged.tokenThreshold > 1) {
      console.warn(
        '⚠️ [Controller] tokenThreshold 必须在 (0, 1] 范围内，使用默认值'
      );
      merged.tokenThreshold = DEFAULT_CONTROL_CONFIG.tokenThreshold;
    }

    return merged;
  }

  /**
   * 初始化执行指标
   */
  private initMetrics(): ExecutionMetrics {
    return {
      startTime: 0,
      iterationCount: 0,
      toolSuccessCount: 0,
      toolFailureCount: 0,
      toolResults: [],
    };
  }

  /**
   * 主入口 - 执行编排流程
   */
  async execute(prompt: string): Promise<string> {
    // 边缘情况处理
    if (!prompt || prompt.trim().length === 0) {
      return '输入不能为空';
    }

    // 初始化执行状态
    this.state = 'running';
    this.metrics = this.initMetrics();
    this.metrics.startTime = Date.now();

    const conversationHistory: ConversationMessage[] = [];
    conversationHistory.push({ role: 'user', content: prompt });

    try {
      // 检查是否有可用工具
      const enabledTools = this.toolRegistry.getEnabledTools();
      if (enabledTools.length === 0) {
        return this.directLLMResponse(prompt, conversationHistory);
      }

      // 工具调用循环
      for (
        let iteration = 0;
        iteration < this.config.maxIterations;
        iteration++
      ) {
        // 检查超时
        if (this.checkTimeout()) {
          return this.fallback(
            'timeout',
            this.buildPartialResult(conversationHistory)
          );
        }

        // 检查 Token 限制
        const tokenStatus = this.checkTokenLimit(conversationHistory);
        if (tokenStatus.exceeded) {
          return this.fallback('token_exceeded');
        }

        this.metrics.iterationCount = iteration + 1;

        // 规划阶段
        const planningContext: PlanningContext = {
          prompt,
          conversationHistory,
          availableTools: this.getAvailableToolsInfo(enabledTools),
        };

        const plan = await this.planner.plan(planningContext);

        // 如果不需要工具，直接获取 LLM 响应
        if (!plan.needsTool || plan.toolCalls.length === 0) {
          return this.directLLMResponse(prompt, conversationHistory);
        }

        // 执行阶段
        const results: ToolExecutionResult[] =
          await this.executor.execute(plan);

        // 更新指标
        this.updateMetrics(results);

        // 处理执行结果
        const allFailed = results.every((r) => !r.success);
        if (allFailed) {
          // 所有工具失败，尝试直接 LLM 响应
          return this.directLLMResponse(prompt, conversationHistory);
        }

        // 将结果添加到对话历史
        this.appendToolResults(conversationHistory, results);

        // 获取最终响应
        return this.finalLLMResponse(prompt, conversationHistory);
      }

      // 达到迭代次数限制
      return this.fallback(
        'iteration_exceeded',
        this.buildPartialResult(conversationHistory)
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error(`❌ [Controller] 执行错误: ${errorMessage}`);
      this.state = 'failed';
      this.metrics.endTime = Date.now();
      this.metrics.totalDuration =
        this.metrics.endTime - this.metrics.startTime;
      return `处理过程中发生错误: ${errorMessage}`;
    }
  }

  /**
   * 检查 Token 限制
   */
  checkTokenLimit(history: ConversationMessage[]): TokenStatus {
    const totalTokens = history.reduce((sum, msg) => {
      return sum + estimateTokenCount(msg.content);
    }, 0);

    const status: TokenStatus = {
      total: totalTokens,
      limit: this.config.maxTokens,
      percentage: totalTokens / this.config.maxTokens,
      exceeded: totalTokens > this.config.maxTokens,
      nearThreshold:
        totalTokens >= this.config.maxTokens * this.config.tokenThreshold,
    };

    this.metrics.tokenStatus = status;

    if (status.nearThreshold && !status.exceeded) {
      console.warn(
        `⚠️ [Controller] Token 接近阈值: ${totalTokens}/${this.config.maxTokens} (${(status.percentage * 100).toFixed(1)}%)`
      );
    }

    return status;
  }

  /**
   * 检查超时
   */
  checkTimeout(): boolean {
    const elapsed = Date.now() - this.metrics.startTime;
    return elapsed >= this.config.timeout;
  }

  /**
   * 检查迭代次数
   */
  checkIterationCount(count: number): boolean {
    return count >= this.config.maxIterations;
  }

  /**
   * 兜底策略
   * @returns 兜底消息，对于 all_tools_failed 返回特殊标记需要调用方处理
   */
  fallback(reason: FallbackResult['reason'], partialResult?: string): string {
    this.state = reason === 'timeout' ? 'timeout' : 'failed';
    this.metrics.endTime = Date.now();
    this.metrics.totalDuration = this.metrics.endTime - this.metrics.startTime;

    const messages: Record<FallbackResult['reason'], string> = {
      token_exceeded: 'Token 限制超出。请尝试简化您的请求或减少对话历史。',
      timeout: `处理超时。${partialResult ? '部分结果：' + partialResult : '请稍后重试。'}`,
      iteration_exceeded: `已达到最大处理次数。${partialResult ? '部分结果：' + partialResult : '请尝试简化您的请求。'}`,
      all_tools_failed: '__FALLBACK_TO_LLM__', // 特殊标记，需要调用方处理
      planner_error: '规划阶段发生错误，请稍后重试。',
      executor_error: '执行阶段发生错误，请稍后重试。',
    };

    return messages[reason];
  }

  /**
   * 追踪执行指标
   */
  trackMetrics(result: ToolExecutionResult): void {
    if (result.success) {
      this.metrics.toolSuccessCount++;
    } else {
      this.metrics.toolFailureCount++;
    }
    this.metrics.toolResults.push(result);
  }

  /**
   * 更新指标
   */
  private updateMetrics(results: ToolExecutionResult[]): void {
    for (const result of results) {
      this.trackMetrics(result);
    }
  }

  /**
   * 获取当前执行状态
   */
  getStatus(): ExecutionStatus {
    return {
      state: this.state,
      phase: this.determinePhase(),
      metrics: { ...this.metrics },
    };
  }

  /**
   * 确定当前执行阶段
   */
  private determinePhase(): ExecutionStatus['phase'] {
    if (this.state === 'idle') return 'planning';
    if (
      this.state === 'completed' ||
      this.state === 'failed' ||
      this.state === 'timeout'
    )
      return 'done';
    if (this.metrics.iterationCount > 0 && this.metrics.toolResults.length > 0)
      return 'finalizing';
    return 'executing';
  }

  /**
   * 获取可用工具信息
   */
  private getAvailableToolsInfo(
    tools: { name: string; description: string; enabled: boolean }[]
  ): ToolInfo[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled,
    }));
  }

  /**
   * 直接 LLM 响应（不使用工具）
   */
  private async directLLMResponse(
    prompt: string,
    conversationHistory: ConversationMessage[]
  ): Promise<string> {
    const messages = this.buildMessages(prompt, conversationHistory);
    const response = await this.llm.invoke(messages);
    this.state = 'completed';
    this.metrics.endTime = Date.now();
    this.metrics.totalDuration = this.metrics.endTime - this.metrics.startTime;

    if (response && typeof response.content === 'string') {
      return response.content;
    }

    throw new Error('模型响应格式不正确');
  }

  /**
   * 最终 LLM 响应
   */
  private async finalLLMResponse(
    prompt: string,
    conversationHistory: ConversationMessage[]
  ): Promise<string> {
    const messages = this.buildMessages(prompt, conversationHistory);
    const response = await this.llm.invoke(messages);
    this.state = 'completed';
    this.metrics.endTime = Date.now();
    this.metrics.totalDuration = this.metrics.endTime - this.metrics.startTime;

    if (response && typeof response.content === 'string') {
      return response.content;
    }

    throw new Error('模型响应格式不正确');
  }

  /**
   * 构建消息列表
   */
  private buildMessages(
    prompt: string,
    conversationHistory: ConversationMessage[]
  ): Array<HumanMessage | SystemMessage | AIMessage | ToolMessage> {
    const messages: Array<
      HumanMessage | SystemMessage | AIMessage | ToolMessage
    > = [];

    // 系统消息
    messages.push(
      new SystemMessage(
        '你是一个智能助手。当用户询问需要实时信息或联网搜索的问题时，你应该使用提供的工具来获取最新信息。'
      )
    );

    // 对话历史
    for (const msg of conversationHistory) {
      if (msg.role === 'user') {
        messages.push(new HumanMessage(msg.content));
      } else if (msg.role === 'assistant') {
        messages.push(new AIMessage(msg.content));
      } else if (msg.role === 'tool') {
        messages.push(
          new ToolMessage(msg.content, msg.toolCallId ?? '', msg.toolName)
        );
      }
    }

    // 当前输入（如果有）
    if (
      prompt &&
      !conversationHistory.some(
        (m) => m.role === 'user' && m.content === prompt
      )
    ) {
      messages.push(new HumanMessage(prompt));
    }

    return messages;
  }

  /**
   * 将工具结果添加到对话历史
   */
  private appendToolResults(
    conversationHistory: ConversationMessage[],
    results: ToolExecutionResult[]
  ): void {
    // 添加助手消息
    conversationHistory.push({
      role: 'assistant',
      content: '我将使用工具来回答这个问题。',
    });

    // 添加工具执行结果
    for (const result of results) {
      conversationHistory.push({
        role: 'tool',
        content: result.result,
        toolCallId: result.toolCallId,
        toolName: result.toolName,
      });
    }

    // 添加上下文提示
    conversationHistory.push({
      role: 'user',
      content: '基于之前的工具调用结果，请回答用户的问题。',
    });
  }

  /**
   * 构建部分结果
   */
  private buildPartialResult(
    conversationHistory: ConversationMessage[]
  ): string {
    const toolMessages = conversationHistory.filter((m) => m.role === 'tool');
    if (toolMessages.length === 0) return '';
    return toolMessages.map((m) => m.content).join('\n');
  }
}
