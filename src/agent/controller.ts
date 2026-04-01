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
  ToolInfo,
  ConversationMessage,
  TokenStatus,
  ExecutionResult,
  TerminationReason,
} from '../types/agent.js';
import type { VectorDatabaseConfig } from '../types/memory.js';
import { ToolRegistry } from '../tools/index.js';
import { authManager } from '../tools/auth-manager.js';
import {
  TraceManager,
  SpanManager,
  calculateCost,
  createDisabledObservabilityClient,
  PromptManager,
  type LLMUsage,
} from '../observability/index.js';

import {
  SessionStore,
  CostTracker,
  createTrimmer,
  getTokenStatus,
  VectorDatabaseClient,
  LongTermMemoryReader,
  MemoryDispatcher,
} from './memory/index.js';

function createDefaultTraceManager(): TraceManager {
  const client = createDisabledObservabilityClient();
  return new TraceManager(client);
}

function createDefaultSpanManager(): SpanManager {
  const client = createDisabledObservabilityClient();
  return new SpanManager(client, createDefaultTraceManager());
}

export class Controller {
  private config: ControlConfig;
  private metrics: ExecutionMetrics;
  private state: ExecutionState = 'idle';
  private llm: ChatOpenAI;
  private toolRegistry: ToolRegistry;
  private sessionStore: SessionStore;
  private costTracker: CostTracker;
  private longTermMemoryReader: LongTermMemoryReader | null = null;
  private memoryDispatcher: MemoryDispatcher | null = null;
  private readonly sessionId: string = 'default';
  private chainWithHistory: Runnable<{ input: string }, AIMessage> | null =
    null;
  private chainWithLongTermMemory: Runnable<
    { input: string; long_term_memory: BaseMessage[] },
    AIMessage
  > | null = null;
  private traceManager: TraceManager;
  private spanManager: SpanManager;
  private modelName: string;
  private promptManager: PromptManager;
  /**
   * 工具执行完成回调
   */
  onToolExecuted?: (
    toolName: string,
    args: Record<string, unknown>,
    result: string
  ) => void;

  constructor(
    llm: ChatOpenAI,
    toolRegistry: ToolRegistry,
    config: Partial<ControlConfig> = {},
    vectorDbConfig?: VectorDatabaseConfig,
    traceManager?: TraceManager,
    spanManager?: SpanManager,
    modelName?: string
  ) {
    this.config = this.validateAndMergeConfig(config);
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.traceManager = traceManager ?? createDefaultTraceManager();
    this.spanManager = spanManager ?? createDefaultSpanManager();
    this.modelName = modelName ?? 'gpt-3.5-turbo';
    this.promptManager = new PromptManager(
      this.spanManager.getObservabilityClient()
    );
    this.metrics = this.initMetrics();
    // 初始化 startTime，避免 checkTimeout() 在 execute() 前调用时返回错误结果
    this.metrics.startTime = Date.now();
    // 初始化记忆组件
    this.sessionStore = new SessionStore();
    this.costTracker = new CostTracker();

    // 初始化长期记忆管理器（如果配置了向量数据库）
    console.log('🔧 [Controller] 配置信息:', {
      enableLongTermMemory: this.config.enableLongTermMemory,
      hasVectorDbConfig: !!vectorDbConfig,
      longTermMemoryTopK: this.config.longTermMemoryTopK,
      memoryExtractionThreshold: this.config.memoryExtractionThreshold,
    });

    if (this.config.enableLongTermMemory && vectorDbConfig) {
      console.log('📋 [Controller] 向量数据库配置:', {
        supabaseUrl: vectorDbConfig.supabaseUrl ? '已配置' : '未配置',
        supabaseApiKey: vectorDbConfig.supabaseApiKey ? '已配置' : '未配置',
        tableName: vectorDbConfig.tableName || 'memories',
      });

      const dbClient = new VectorDatabaseClient(vectorDbConfig);
      this.longTermMemoryReader = new LongTermMemoryReader(dbClient, {
        enabled: true,
        topK: this.config.longTermMemoryTopK || 5,
      });
      this.memoryDispatcher = new MemoryDispatcher({
        enabled: true,
      });

      // 异步初始化，不阻塞构造函数
      this.longTermMemoryReader
        .initialize()
        .then((success) => {
          if (!success) {
            console.warn('⚠️ [Controller] 长期记忆初始化失败');
            this.longTermMemoryReader = null;
          }
        })
        .catch((error) => {
          console.error('❌ [Controller] 长期记忆初始化异常:', error);
          this.longTermMemoryReader = null;
        });
    }

    // 构建 prompt 模板：system + long_term_memory + history 占位符 + human
    void this.initializeChainsAsync();
  }

  private async initializeChainsAsync(): Promise<void> {
    const systemPromptResult = await this.promptManager.getCompiledPrompt(
      'agent-system',
      {}
    );
    const systemPrompt =
      systemPromptResult?.content ??
      '你是一个智能助手，使用工具来回答需要实时信息的问题。';

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', systemPrompt],
      new MessagesPlaceholder({
        variableName: 'long_term_memory',
        optional: true,
      }),
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
    const tools = this.toolRegistry.getLangChainTools();
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
      merged.maxTokens = DEFAULT_CONTROL_CONFIG.maxTokens;
    }
    if (!Number.isFinite(merged.maxIterations) || merged.maxIterations <= 0) {
      merged.maxIterations = DEFAULT_CONTROL_CONFIG.maxIterations;
    }
    if (merged.timeout <= 0) {
      merged.timeout = DEFAULT_CONTROL_CONFIG.timeout;
    }
    if (merged.tokenThreshold <= 0 || merged.tokenThreshold > 1) {
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
   * 使用 ExecutionEngine 实现 PLAN→ACT→OBSERVE→REFLECT 模式
   */
  async execute(
    prompt: string,
    options?: {
      maxIterations?: number;
      maxExecutionTime?: number;
      toolTimeout?: number;
    }
  ): Promise<ExecutionResult> {
    // 边缘情况处理
    if (!prompt || prompt.trim().length === 0) {
      return {
        finalAnswer: '输入不能为空',
        success: false,
        metrics: this.initMetrics(),
        error: '输入不能为空',
      };
    }

    // 清除授权拒绝记录，确保每次对话都是新的授权请求
    authManager.clearRejectedAuths();

    // 初始化执行状态
    this.state = 'running';
    this.metrics = this.initMetrics();
    this.metrics.startTime = Date.now();

    const traceId = this.traceManager.generateTraceId();
    this.traceManager.createTrace({
      traceId,
      name: 'conversation-engine',
      sessionId: this.sessionId,
      input: prompt,
    });

    try {
      // 获取可用工具
      const enabledTools = this.toolRegistry.getEnabledTools();
      const toolInfos = this.getAvailableToolsInfo(enabledTools);

      // 获取会话历史
      const sessionHistory = this.sessionStore.getOrCreate(this.sessionId);
      const historyMessages = await sessionHistory.getMessages();

      // 将历史消息转换为 ConversationMessage 格式
      const conversationHistory = this.toConversationHistory(historyMessages);

      // 查询用户相关信息（名字、偏好等）
      let userInfoContext = '';
      if (this.longTermMemoryReader) {
        try {
          const userQueries = [
            '用户信息',
            '名字',
            '称呼',
            '用户偏好',
            '个性化',
          ];
          const allMemories: string[] = [];

          for (const query of userQueries) {
            const results = await this.longTermMemoryReader.search(query, 3);
            if (results.length > 0) {
              allMemories.push(
                this.longTermMemoryReader.formatMemoriesForPrompt(results)
              );
            }
          }

          if (allMemories.length > 0) {
            userInfoContext = allMemories.join('\n\n');
          }
        } catch (error) {
          console.warn('⚠️ [Controller] 查询用户信息失败:', error);
        }
      }

      // 创建执行引擎配置
      const engineConfig = {
        maxIterations: options?.maxIterations ?? this.config.maxIterations,
        maxExecutionTime: options?.maxExecutionTime ?? this.config.timeout,
        toolTimeout: options?.toolTimeout ?? this.config.toolTimeout,
        maxWorkingMemorySize: 10,
        maxToolMemorySize: 100,
        summaryTriggerRound: 5,
        summaryTriggerTokens: 8000,
        tokenThreshold: 0.9,
        maxRetryPerTool: 3,
        enableParallelExecution: true,
      };

      // 导入 ExecutionEngine
      const { ExecutionEngine } = await import('./execution/index.js');

      // 创建执行引擎
      const engine = new ExecutionEngine(engineConfig, {
        llm: this.llm,
        tools: toolInfos,
        generateSummary: async (messages) => {
          // 使用 LLM 生成摘要
          const messagesText = messages
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n');
          const summaryPrompt = `请为以下对话生成一个简洁的摘要：\n${messagesText}`;
          const response = await this.llm.invoke(summaryPrompt);
          return typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);
        },
        executeTool: async (toolName, args) => {
          try {
            // 使用 toolRegistry.executeTool() 而不是 tool.run()
            // 这样可以启用授权系统的交互式权限验证
            const result = await this.toolRegistry.executeTool(toolName, args);
            return typeof result === 'string' ? result : JSON.stringify(result);
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : '未知错误';
            return `工具执行失败: ${errorMsg}`;
          }
        },
        longTermMemoryReader: this.longTermMemoryReader ?? undefined,
        userInfoContext: userInfoContext || undefined,
        onToolExecuted: this.onToolExecuted,
      });

      // 执行引擎，传入会话历史
      const { finalAnswer, metrics } = await engine.run(
        prompt,
        conversationHistory
      );

      // 保存用户消息和AI响应到会话历史
      await sessionHistory.addUserMessage(prompt);
      await sessionHistory.addAIMessage(finalAnswer);

      // 更新状态
      this.state = 'completed';
      this.metrics.endTime = Date.now();
      this.metrics.totalDuration =
        this.metrics.endTime - this.metrics.startTime;

      // 映射终止原因
      const terminationReason = this.mapTerminationReason(
        metrics.terminationReason
      );

      // 触发记忆提取（异步，不阻塞返回）
      void this.extractLongTermMemoryAsync(prompt, finalAnswer);

      return {
        finalAnswer,
        success: true,
        metrics: this.metrics,
        terminationReason,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      this.state = 'failed';
      this.metrics.endTime = Date.now();
      this.metrics.totalDuration =
        this.metrics.endTime - this.metrics.startTime;

      return {
        finalAnswer: `处理过程中发生错误: ${errorMessage}`,
        success: false,
        metrics: this.metrics,
        error: errorMessage,
        terminationReason: 'fallback',
      };
    } finally {
      this.traceManager.endTrace(this.state);
    }
  }

  /**
   * 过滤LLM响应中的推理过程，只保留最终答案
   */
  private filterReasoningProcess(content: string): string {
    if (!content) return content;

    let filtered = content;

    // 移除 <thinking>...</thinking> 标签及其内容
    filtered = filtered.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

    // 移除 <thought>...</thought> 标签及其内容
    filtered = filtered.replace(/<thought>[\s\S]*?<\/thought>/gi, '');

    // 移除 <reasoning>...</reasoning> 标签及其内容
    filtered = filtered.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');

    // 移除 <analysis>...</analysis> 标签及其内容
    filtered = filtered.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '');

    // 移除 ```thinking...``` 代码块
    filtered = filtered.replace(/```thinking[\s\S]*?```/gi, '');

    // 移除 ```thought...``` 代码块
    filtered = filtered.replace(/```thought[\s\S]*?```/gi, '');

    // 移除 ```reasoning...``` 代码块
    filtered = filtered.replace(/```reasoning[\s\S]*?```/gi, '');

    // 移除以"思考："、"推理："、"分析："等开头的段落（支持中英文冒号）
    filtered = filtered.replace(
      /^(思考|推理|分析|考虑|让我想想|首先|第一步|Thought|Reasoning|Analysis|Let me think|First)[：:][\s\S]*?(?=\n\n|\n[^思推考分虑让首第TLF]|$)/gim,
      ''
    );

    // 移除包含"让我思考"、"我需要分析"等的段落
    filtered = filtered.replace(
      /^(让我思考|我需要分析|我来分析|让我想想|我来思考|Let me think|I need to analyze|I'll analyze)[\s\S]*?(?=\n\n|\n[^让我来思分考想LIA]|$)/gim,
      ''
    );

    // 移除以"好的"、"Okay"、"Sure"等开头的确认性语句（如果后面跟着推理过程）
    filtered = filtered.replace(
      /^(好的|Okay|Sure|Alright|当然|没问题)[，,]?(让我|我来|I'll|Let me)[\s\S]*?(?=\n\n|\n[^让来IL]|$)/gim,
      ''
    );

    // 移除单独成行的"思考过程："、"推理过程："等标题
    filtered = filtered.replace(
      /^(思考过程|推理过程|分析过程|Thought process|Reasoning process)[：:]\s*$/gim,
      ''
    );

    // 移除 "---" 分隔线后面紧跟的推理内容
    filtered = filtered.replace(
      /---\s*\n(思考|推理|分析|Thought|Reasoning|Analysis)[：:][\s\S]*?(?=\n\n|$)/gi,
      ''
    );

    // 新增：移除以"根据"开头的分析段落（如"根据用户偏好数据和当前对话上下文..."）
    filtered = filtered.replace(/^根据[\s\S]*?(?=。|\.)(?:。|\.)/gm, '');

    // 新增：移除包含"下一步应"的推理段落
    filtered = filtered.replace(/.*下一步应[\s\S]*?(?=\n\n|\n[^下]|$)/gi, '');

    // 新增：移除包含"用户正在期待"的推理段落
    filtered = filtered.replace(
      /.*用户正在期待[\s\S]*?(?=\n\n|\n[^用]|$)/gi,
      ''
    );

    // 新增：移除包含"虽然此前"的推理段落
    filtered = filtered.replace(/.*虽然此前[\s\S]*?(?=\n\n|\n[^虽]|$)/gi, '');

    // 新增：移除包含"满足其"的推理段落
    filtered = filtered.replace(/.*满足其[\s\S]*?(?=\n\n|\n[^满]|$)/gi, '');

    // 新增：移除包含"提升对话体验"的推理段落
    filtered = filtered.replace(
      /.*提升对话体验[\s\S]*?(?=\n\n|\n[^提]|$)/gi,
      ''
    );

    // 新增：移除以"分析用户"开头的段落
    filtered = filtered.replace(/^分析用户[\s\S]*?(?=\n\n|\n[^分]|$)/gi, '');

    // 新增：移除以"基于"开头的分析段落
    filtered = filtered.replace(/^基于[\s\S]*?(?=。|\.)(?:。|\.)/gm, '');

    // 新增：移除以"考虑到"开头的分析段落
    filtered = filtered.replace(/^考虑到[\s\S]*?(?=。|\.)(?:。|\.)/gm, '');

    // 新增：移除以"为了"开头的目的说明段落（如果后面跟着推理）
    filtered = filtered.replace(
      /^为了[\s\S]*?(?=，|,)(?:，|,)[\s\S]*?(?=\n\n|\n[^为]|$)/gi,
      ''
    );

    // 移除JSON格式的reasoning字段暴露
    filtered = filtered.replace(/"reasoning"\s*:\s*"[^"]*"/gi, '');
    filtered = filtered.replace(/reasoning\s*:\s*"[^"]*"/gi, '');

    // 移除包含"核心诉求"、"置信度"、"单次澄清动作"等内部决策说明
    filtered = filtered.replace(/.*核心诉求[\s\S]*?(?=\n\n|\n[^核]|$)/gi, '');
    filtered = filtered.replace(/.*置信度[\s\S]*?(?=\n\n|\n[^置]|$)/gi, '');
    filtered = filtered.replace(
      /.*单次澄清动作[\s\S]*?(?=\n\n|\n[^单]|$)/gi,
      ''
    );
    filtered = filtered.replace(
      /.*无需复杂流程[\s\S]*?(?=\n\n|\n[^无]|$)/gi,
      ''
    );
    filtered = filtered.replace(/.*置信度高[\s\S]*?(?=\n\n|\n[^置]|$)/gi, '');

    // 移除看起来像内部决策输出的内容
    filtered = filtered.replace(/^用户的[\s\S]*?(?=\n\n|$)/gim, '');
    filtered = filtered.replace(/^此为[\s\S]*?(?=\n\n|$)/gim, '');
    filtered = filtered.replace(/^基于用户偏好[\s\S]*?(?=\n\n|$)/gim, '');
    filtered = filtered.replace(/^应立即[\s\S]*?(?=\n\n|$)/gim, '');
    filtered = filtered.replace(/^无需[\s\S]*?(?=\n\n|$)/gim, '');

    // 移除 ```json 代码块
    filtered = filtered.replace(/```json[\s\S]*?```/gi, '');

    // 清理多余的空行
    filtered = filtered.replace(/\n{3,}/g, '\n\n');

    // 去除首尾空白
    filtered = filtered.trim();

    return filtered;
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
    const hasLongTermMemory =
      this.longTermMemoryReader && longTermMemoryContext;

    if (!this.chainWithHistory) {
      await this.initializeChainsAsync();
    }

    const spanId = this.spanManager.createLLMSpan(
      'llm-response',
      { input, hasLongTermMemory },
      this.modelName
    );

    try {
      const response = hasLongTermMemory
        ? await this.chainWithLongTermMemory!.invoke(
            {
              input,
              long_term_memory: [new HumanMessage(longTermMemoryContext)],
            },
            { configurable: { sessionId: this.sessionId } }
          )
        : await this.chainWithHistory!.invoke(
            { input },
            { configurable: { sessionId: this.sessionId } }
          );

      this.state = 'completed';
      this.metrics.endTime = Date.now();

      this.costTracker.record(response.usage_metadata, this.modelName);

      const usage: LLMUsage | undefined = response.usage_metadata
        ? {
            inputTokens: response.usage_metadata.input_tokens ?? 0,
            outputTokens: response.usage_metadata.output_tokens ?? 0,
            totalTokens: response.usage_metadata.total_tokens ?? 0,
          }
        : undefined;

      const cost = usage ? calculateCost(usage, this.modelName) : undefined;

      if (spanId) {
        this.spanManager.endLLMSpan(
          spanId,
          response.content,
          usage,
          cost,
          this.modelName
        );
      }

      if (response && typeof response.content === 'string') {
        // 过滤推理过程
        const filteredContent = this.filterReasoningProcess(response.content);
        void this.extractLongTermMemoryAsync(input, filteredContent);
        return filteredContent;
      }

      throw new Error('模型响应格式不正确');
    } catch (error) {
      if (spanId) {
        this.spanManager.endSpan(spanId, {
          error: error instanceof Error ? error : new Error('未知错误'),
        });
      }
      throw error;
    }
  }

  /**
   * 异步提取长期记忆
   */
  private async extractLongTermMemoryAsync(
    userMessage: string,
    aiResponse: string
  ): Promise<void> {
    if (!this.memoryDispatcher) {
      return;
    }

    try {
      await this.memoryDispatcher.enqueue({
        userMessage,
        aiResponse,
        sessionId: this.sessionId,
      });
    } catch {
      // 提取失败不影响主流程
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
    return tools.map((tool) => {
      // 如果是 BaseTool，提取参数定义
      const baseTool = tool as import('../tools/base.js').BaseTool;
      let parameters: Record<string, unknown> | undefined;
      if (typeof baseTool.toLangChainTool === 'function') {
        const langChainTool = baseTool.toLangChainTool();
        parameters = langChainTool.function.parameters;
      }

      return {
        name: tool.name,
        description: tool.description,
        enabled: tool.enabled,
        parameters,
      };
    });
  }

  /**
   * 将 LangChain BaseMessage 转换为 Planner 使用的对话历史格式
   */
  private toConversationHistory(
    messages: BaseMessage[]
  ): ConversationMessage[] {
    return messages.map((msg) => {
      const rawType =
        typeof (msg as { _getType?: () => string })._getType === 'function'
          ? (msg as { _getType: () => string })._getType()
          : (msg as { type?: string }).type;

      const role: ConversationMessage['role'] =
        rawType === 'human'
          ? 'user'
          : rawType === 'ai'
            ? 'assistant'
            : rawType === 'tool'
              ? 'tool'
              : 'system';

      const content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);

      const toolCallId =
        (msg as { tool_call_id?: string; toolCallId?: string }).tool_call_id ??
        (msg as { tool_call_id?: string; toolCallId?: string }).toolCallId;
      const toolName =
        (msg as { name?: string; toolName?: string }).name ??
        (msg as { name?: string; toolName?: string }).toolName;

      return {
        role,
        content,
        ...(toolCallId ? { toolCallId } : {}),
        ...(toolName ? { toolName } : {}),
      };
    });
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
   * 获取 LongTermMemoryReader（供测试使用）
   */
  getLongTermMemoryReader(): LongTermMemoryReader | null {
    return this.longTermMemoryReader;
  }

  /**
   * 获取 MemoryDispatcher（供测试使用）
   */
  getMemoryDispatcher(): MemoryDispatcher | null {
    return this.memoryDispatcher;
  }

  /**
   * 映射终止原因到新的 TerminationReason 类型
   */
  private mapTerminationReason(reason?: string): TerminationReason {
    if (!reason) {
      return 'completed';
    }

    const reasonMap: Record<string, TerminationReason> = {
      planner_final: 'planner_final',
      no_information_growth: 'no_information_growth',
      max_iterations: 'max_iterations',
      token_budget_exceeded: 'token_budget_exceeded',
      execution_timeout: 'execution_timeout',
      failure_budget_exhausted: 'failure_budget_exhausted',
      final_answer: 'final_answer',
      fallback: 'fallback',
    };

    return reasonMap[reason] || 'completed';
  }

  /**
   * 获取执行引擎配置
   */
  getEngineConfig() {
    return {
      maxIterations: this.config.maxIterations,
      maxExecutionTime: this.config.timeout,
      toolTimeout: this.config.toolTimeout,
      tokenThreshold: this.config.tokenThreshold,
    };
  }

  /**
   * 更新执行引擎配置
   */
  updateEngineConfig(
    config: Partial<{
      maxIterations: number;
      maxExecutionTime: number;
      toolTimeout: number;
      tokenThreshold: number;
    }>
  ) {
    if (config.maxIterations !== undefined) {
      this.config.maxIterations = config.maxIterations;
    }
    if (config.maxExecutionTime !== undefined) {
      this.config.timeout = config.maxExecutionTime;
    }
    if (config.toolTimeout !== undefined) {
      this.config.toolTimeout = config.toolTimeout;
    }
    if (config.tokenThreshold !== undefined) {
      this.config.tokenThreshold = config.tokenThreshold;
    }
  }
}
