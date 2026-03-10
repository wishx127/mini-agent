import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import {
  Runnable,
  RunnableLambda,
  RunnableWithMessageHistory,
} from '@langchain/core/runnables';
import type { ChatPromptValueInterface } from '@langchain/core/prompt_values';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';

import {
  ControlConfig,
  DEFAULT_CONTROL_CONFIG,
  ExecutionMetrics,
  ExecutionState,
  ExecutionStatus,
  FallbackResult,
  ToolExecutionResult,
  PlanningContext,
  ToolInfo,
  TokenStatus,
} from '../types/agent.js';
import type { VectorDatabaseConfig } from '../types/memory.js';
import { ToolRegistry } from '../tools/index.js';

import { Planner } from './planner.js';
import { Executor } from './executor.js';
import {
  SessionStore,
  CostTracker,
  createTrimmer,
  runTokenPreflight,
  getTokenStatus,
  VectorDatabaseClient,
  LongTermMemoryManager,
} from './memory/index.js';

/**
 * Controller - Agent 编排层的控制模块
 *
 * 职责：
 * - 跨请求会话记忆（通过 RunnableWithMessageHistory）
 * - 长期记忆管理（通过 LongTermMemoryManager）
 * - Token 上限控制（预检 + 链内裁剪）
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
  private sessionStore: SessionStore;
  private costTracker: CostTracker;
  private longTermMemoryManager: LongTermMemoryManager | null = null;
  private readonly sessionId: string = 'default';
  private chainWithHistory: Runnable<{ input: string }, AIMessage>;
  private chainWithLongTermMemory: Runnable<
    { input: string; long_term_memory: BaseMessage[] },
    AIMessage
  >;

  constructor(
    llm: ChatOpenAI,
    toolRegistry: ToolRegistry,
    config: Partial<ControlConfig> = {},
    vectorDbConfig?: VectorDatabaseConfig
  ) {
    this.config = this.validateAndMergeConfig(config);
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.planner = new Planner(llm, toolRegistry);
    this.executor = new Executor(toolRegistry, this.config);
    this.metrics = this.initMetrics();
    // 初始化 startTime，避免 checkTimeout() 在 execute() 前调用时返回错误结果
    this.metrics.startTime = Date.now();
    // 初始化记忆组件
    this.sessionStore = new SessionStore();
    this.costTracker = new CostTracker();

    // 初始化长期记忆管理器（如果配置了向量数据库）
    console.log('🔧 [Controller] 检查长期记忆配置...');
    console.log('📋 [Controller] 配置信息:', {
      enableLongTermMemory: this.config.enableLongTermMemory,
      hasVectorDbConfig: !!vectorDbConfig,
      longTermMemoryTopK: this.config.longTermMemoryTopK,
      memoryExtractionThreshold: this.config.memoryExtractionThreshold,
    });

    if (this.config.enableLongTermMemory && vectorDbConfig) {
      console.log('✓ [Controller] 长期记忆已启用，开始初始化...');
      console.log('📋 [Controller] 向量数据库配置:', {
        supabaseUrl: vectorDbConfig.supabaseUrl ? '已配置' : '未配置',
        supabaseApiKey: vectorDbConfig.supabaseApiKey ? '已配置' : '未配置',
        tableName: vectorDbConfig.tableName || 'memories',
      });

      const dbClient = new VectorDatabaseClient(vectorDbConfig);
      this.longTermMemoryManager = new LongTermMemoryManager(dbClient, llm, {
        enabled: true,
        topK: this.config.longTermMemoryTopK || 5,
        extractionThreshold: this.config.memoryExtractionThreshold || 0.7,
      });
      console.log('✓ [Controller] LongTermMemoryManager 实例创建成功');

      // 异步初始化，不阻塞构造函数
      console.log('🔄 [Controller] 异步初始化向量数据库连接...');
      this.longTermMemoryManager.initialize().catch((err) => {
        console.warn(
          '⚠️ [Controller] 长期记忆初始化失败，降级为仅短期记忆模式:',
          err
        );
        this.longTermMemoryManager = null;
      });
    } else {
      console.log(
        'ℹ️ [Controller] 长期记忆未启用或未配置向量数据库，跳过初始化'
      );
    }

    // 构建 prompt 模板：system + long_term_memory + history 占位符 + human
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', '你是一个智能助手，使用工具来回答需要实时信息的问题。'],
      new MessagesPlaceholder('long_term_memory'),
      new MessagesPlaceholder('history'),
      ['human', '{input}'],
    ]);

    // 创建 token 裁剪器
    const trimmer = createTrimmer({ maxTokens: this.config.maxTokens });

    // 构建 Runnable 链：prompt → extractMessages → trimmer → llm.bindTools(tools)
    // ChatPromptTemplate 输出 ChatPromptValue，而 trimmer 接受 BaseMessage[]，
    // 需要用 RunnableLambda 做一次类型转换。
    const extractMessages = RunnableLambda.from(
      (v: ChatPromptValueInterface): BaseMessage[] => v.toChatMessages()
    );
    const tools = toolRegistry.getLangChainTools();
    const chain = prompt
      .pipe(extractMessages)
      .pipe(trimmer)
      .pipe(this.llm.bindTools(tools));

    // 用 RunnableWithMessageHistory 包装链，自动管理跨请求历史
    // chain 的完整输入类型包含 history，由 RunnableWithMessageHistory 内部注入，
    // 对外暴露的接口只需要 { input: string }，此处做一次有意的类型断言。
    this.chainWithHistory = new RunnableWithMessageHistory({
      runnable: chain as unknown as Runnable<{ input: string }, AIMessage>,
      getMessageHistory: (id: string) => this.sessionStore.getOrCreate(id),
      inputMessagesKey: 'input',
      historyMessagesKey: 'history',
    }) as unknown as Runnable<{ input: string }, AIMessage>;

    // 带长期记忆的链
    this.chainWithLongTermMemory = new RunnableWithMessageHistory({
      runnable: chain as unknown as Runnable<
        { input: string; long_term_memory: BaseMessage[] },
        AIMessage
      >,
      getMessageHistory: (id: string) => this.sessionStore.getOrCreate(id),
      inputMessagesKey: 'input',
      historyMessagesKey: 'history',
    }) as unknown as Runnable<
      { input: string; long_term_memory: BaseMessage[] },
      AIMessage
    >;
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

    // 检索长期记忆（在 try 块之前，便于降级处理）
    let longTermMemoryContext = '';
    console.log('🔍 [Controller] 开始检索长期记忆...');
    try {
      if (this.longTermMemoryManager) {
        console.log('📤 [Controller] 调用长期记忆管理器进行检索...');
        console.log(
          '📋 [Controller] 检索查询:',
          prompt.substring(0, 50) + (prompt.length > 50 ? '...' : '')
        );
        const memories = await this.longTermMemoryManager.search(prompt);
        console.log(`📊 [Controller] 检索到 ${memories.length} 条相关记忆`);

        if (memories.length > 0) {
          console.log('🔄 [Controller] 格式化记忆为 Prompt 上下文...');
          longTermMemoryContext =
            this.longTermMemoryManager.formatMemoriesForPrompt(memories);
          console.log('✓ [Controller] 长期记忆上下文已生成');
          console.log(
            '📋 [Controller] 记忆上下文预览:',
            longTermMemoryContext.substring(0, 100) + '...'
          );
        } else {
          console.log('ℹ️ [Controller] 未找到相关长期记忆');
        }
      } else {
        console.log('ℹ️ [Controller] 长期记忆管理器未初始化，跳过检索');
      }
    } catch (error) {
      console.warn(
        '⚠️ [Controller] 长期记忆检索失败，继续使用短期记忆:',
        error
      );
    }

    try {
      // Token 预检：加载当前历史 + 新 prompt，超限时裁剪历史
      const historyStore = this.sessionStore.getOrCreate(this.sessionId);
      const historyMessages = await historyStore.getMessages();
      const allMessages: BaseMessage[] = [
        ...historyMessages,
        new HumanMessage(prompt),
      ];
      const trimmedMessages = await runTokenPreflight(
        allMessages,
        this.config.maxTokens
      );

      // 若发生裁剪，将裁剪后的历史写回 SessionStore
      if (trimmedMessages.length < allMessages.length) {
        await this.sessionStore.clear(this.sessionId);
        // 最后一条是当前 HumanMessage，不写回（由 chainWithHistory 自动管理）
        const trimmedHistory = trimmedMessages.slice(
          0,
          trimmedMessages.length - 1
        );
        for (const msg of trimmedHistory) {
          await historyStore.addMessage(msg);
        }
      }

      // 检查是否有可用工具
      const enabledTools = this.toolRegistry.getEnabledTools();
      if (enabledTools.length === 0) {
        return await this.llmResponseWithHistory(prompt, longTermMemoryContext);
      }

      // 工具调用循环
      for (
        let iteration = 0;
        iteration < this.config.maxIterations;
        iteration++
      ) {
        // 检查超时
        if (this.checkTimeout()) {
          return this.fallback('timeout');
        }

        this.metrics.iterationCount = iteration + 1;

        // 规划阶段
        const planningContext: PlanningContext = {
          prompt,
          conversationHistory: [],
          availableTools: this.getAvailableToolsInfo(enabledTools),
        };

        const plan = await this.planner.plan(planningContext);

        // 如果不需要工具，直接获取 LLM 响应（历史由 chainWithHistory 自动管理）
        if (!plan.needsTool || plan.toolCalls.length === 0) {
          return await this.llmResponseWithHistory(
            prompt,
            longTermMemoryContext
          );
        }

        // 执行阶段
        const results: ToolExecutionResult[] =
          await this.executor.execute(plan);

        // 更新指标
        this.updateMetrics(results);

        // 处理执行结果
        const allFailed = results.every((r) => !r.success);
        if (allFailed) {
          return await this.llmResponseWithHistory(
            prompt,
            longTermMemoryContext
          );
        }

        // 将工具结果注入 prompt，然后获取最终 LLM 响应
        const toolContext = results
          .map((r) => `[工具: ${r.toolName}]\n${r.result}`)
          .join('\n\n');
        const finalInput = `${prompt}\n\n以下是工具执行结果，请基于这些结果回答用户的问题：\n\n${toolContext}`;
        return await this.llmResponseWithHistory(
          finalInput,
          longTermMemoryContext
        );
      }

      return this.fallback('iteration_exceeded');
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
   * 通过 RunnableWithMessageHistory 获取 LLM 响应
   * 自动读取和保存跨请求会话历史，并记录 token 消耗
   * @param input 用户输入
   * @param longTermMemoryContext 长期记忆上下文（可选）
   */
  private async llmResponseWithHistory(
    input: string,
    longTermMemoryContext?: string
  ): Promise<string> {
    console.log('🤖 [Controller] 开始生成 LLM 响应...');
    const hasLongTermMemory =
      this.longTermMemoryManager && longTermMemoryContext;

    console.log('📋 [Controller] LLM 调用配置:', {
      hasLongTermMemory,
      inputLength: input.length,
      sessionId: this.sessionId,
    });

    const startTime = Date.now();
    const response = hasLongTermMemory
      ? await this.chainWithLongTermMemory.invoke(
          {
            input,
            long_term_memory: [new HumanMessage(longTermMemoryContext)],
          },
          { configurable: { sessionId: this.sessionId } }
        )
      : await this.chainWithHistory.invoke(
          { input },
          { configurable: { sessionId: this.sessionId } }
        );
    const llmDuration = Date.now() - startTime;
    console.log(`✓ [Controller] LLM 响应完成，耗时: ${llmDuration}ms`);

    this.state = 'completed';
    this.metrics.endTime = Date.now();
    this.metrics.totalDuration = this.metrics.endTime - this.metrics.startTime;

    // 记录 token 消耗（仅统计 usage，不计算 USD 成本）
    this.costTracker.record(response.usage_metadata);
    console.log('📊 [Controller] Token 消耗:', {
      inputTokens: response.usage_metadata?.input_tokens || 0,
      outputTokens: response.usage_metadata?.output_tokens || 0,
      totalTokens: response.usage_metadata?.total_tokens || 0,
    });

    if (response && typeof response.content === 'string') {
      console.log('✓ [Controller] LLM 响应内容长度:', response.content.length);
      // 异步提取长期记忆（不阻塞响应）
      void this.extractLongTermMemoryAsync(input, response.content);
      return response.content;
    }

    throw new Error('模型响应格式不正确');
  }

  /**
   * 异步提取长期记忆
   */
  private async extractLongTermMemoryAsync(
    userMessage: string,
    aiResponse: string
  ): Promise<void> {
    console.log('🧠 [Controller] 开始异步提取长期记忆...');
    if (!this.longTermMemoryManager) {
      console.log('ℹ️ [Controller] 长期记忆管理器未初始化，跳过提取');
      return;
    }

    console.log('📋 [Controller] 提取参数:', {
      userMessageLength: userMessage.length,
      aiResponseLength: aiResponse.length,
      sessionId: this.sessionId,
    });

    try {
      const startTime = Date.now();
      await this.longTermMemoryManager.extractAndStore(
        userMessage,
        aiResponse,
        this.sessionId
      );
      const duration = Date.now() - startTime;
      console.log(`✓ [Controller] 长期记忆提取完成，耗时: ${duration}ms`);
    } catch (error) {
      // 提取失败不影响主流程
      console.warn('⚠️ [Controller] 长期记忆提取失败:', error);
    }
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
   * 检查 Token 限制
   * @param history 消息历史（简化的消息对象数组）
   * @returns Token 状态信息
   */
  checkTokenLimit(
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): TokenStatus {
    // 将简化的消息对象转换为 BaseMessage
    const messages: BaseMessage[] = history.map((msg) => {
      switch (msg.role) {
        case 'user':
          return new HumanMessage(msg.content);
        case 'assistant':
          return new AIMessage(msg.content);
        case 'system':
          return new SystemMessage(msg.content);
        default:
          return new HumanMessage(msg.content);
      }
    });

    return getTokenStatus(
      messages,
      this.config.maxTokens,
      this.config.tokenThreshold
    );
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
      all_tools_failed: '__FALLBACK_TO_LLM__',
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
   * 获取 SessionStore（供测试使用）
   */
  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  /**
   * 获取 CostTracker（供测试和统计使用）
   */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  /**
   * 获取 LongTermMemoryManager（供测试使用）
   */
  getLongTermMemoryManager(): LongTermMemoryManager | null {
    return this.longTermMemoryManager;
  }
}
