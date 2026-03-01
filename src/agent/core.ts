import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { AIMessage } from '@langchain/core/messages';

import { ModelConfig } from '../types/model-config.js';
import { ToolRegistry, ToolCall, BaseTool, toolLoader } from '../tools/index.js';

/**
 * 对话消息类型
 */
type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * 对话消息结构
 */
interface ConversationMessage {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
}

/**
 * 工具执行结果
 */
interface ToolExecutionResult {
  success: boolean;
  result: string;
  toolCallId: string;
  toolName: string;
  executionTime?: number;
}

/**
 * 搜索关键词列表（用于规则兜底）
 */
const SEARCH_KEYWORDS = ['搜索', '查询', '联网', '最新', '检索', 'news', 'search', 'find', 'look up'];

/**
 * 最大工具调用次数
 */
const MAX_TOOL_ITERATIONS = 3;

/**
 * 工具执行超时时间（毫秒）
 */
const TOOL_TIMEOUT = 30000;

/**
 * 工具结果最大长度
 */
const MAX_RESULT_LENGTH = 4000;

/**
 * Agent核心类 - 流水线架构
 *
 * 流程:
 * processPrompt -> LLM Decision -> Tool Router -> Tool Validator ->
 * Tool Executor (timeout + retry) -> Result Truncator ->
 * Append tool role message -> Final LLM Response
 */
export class AgentCore {
  private llm: ChatOpenAI;
  private config: ModelConfig;
  private toolRegistry: ToolRegistry;

  constructor(config: ModelConfig) {
    this.config = config;
    this.llm = this.initializeLLM();
    this.toolRegistry = this.initializeToolRegistry();
  }

  // ==================== 初始化 ====================

  /**
   * 初始化LLM模型实例
   */
  private initializeLLM(): ChatOpenAI {
    return new ChatOpenAI({
      model: this.config.modelName,
      temperature: this.config.temperature ?? 0.7,
      maxTokens: this.config.maxTokens ?? 2048,
      configuration: {
        baseURL: this.config.baseUrl,
        ...(this.config.apiKey && { apiKey: this.config.apiKey }),
      },
    });
  }

  /**
   * 初始化工具注册中心 - 插件化加载
   * 默认加载所有工具，可通过配置禁用
   */
  private initializeToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    // 从配置加载工具 - 插件化机制
    // 默认加载所有工具，通过 disabled 指定要禁用的工具
    const disabledTools = this.config.tools?.disabled ?? [];
    const toolConfigs = this.config.tools?.configs ?? {};

    toolLoader.loadFromConfig(registry, toolConfigs, disabledTools);

    return registry;
  }

  // ==================== 主入口 ====================

  /**
   * 处理用户提示 - 流水线入口
   */
  async processPrompt(prompt: string): Promise<string> {
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('输入不能为空');
    }

    const originalPrompt = prompt;
    const conversationHistory: ConversationMessage[] = [];
    let toolExecuted = false;

    // 添加原始用户问题
    conversationHistory.push({
      role: 'user',
      content: originalPrompt,
    });

    // 工具调用循环
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      // Step 1: LLM Decision - 判断是否需要工具
      const toolCall = await this.llmDecision(originalPrompt, conversationHistory, toolExecuted);

      if (!toolCall) {
        // Step 8: Final LLM Response - 不需要工具，直接获取最终响应
        const response = await this.finalLLMResponse(originalPrompt, conversationHistory);
        return response;
      }

      // Step 2: Tool Router - 选择工具
      const selectedTool = this.toolRouter(toolCall);

      // Step 3: Tool Validator - 验证工具参数
      const validatedTool = this.toolValidator(selectedTool);

      // Step 4 & 5: Tool Executor - 执行工具（超时+重试）
      const executionResult = await this.toolExecutor(toolCall, iteration);

      // Step 6: Result Truncator - 截断结果
      const truncatedResult = this.resultTruncator(executionResult.result);

      // Step 7: Append tool role message - 添加工具消息
      this.appendToolMessage(
        conversationHistory,
        validatedTool,
        executionResult.toolCallId,
        truncatedResult
      );

      toolExecuted = true;
    }

    return '已达到最大工具调用次数限制。请稍后重试。';
  }

  // ==================== 流水线步骤 ====================

  /**
   * Step 1: LLM Decision - 判断是否需要使用工具
   *
   * 由 LLM 判断是否需要调用工具，返回工具调用信息
   */
  private async llmDecision(
    originalPrompt: string,
    conversationHistory: ConversationMessage[],
    toolExecuted: boolean
  ): Promise<ToolCall | null> {
    const enabledTools = this.toolRegistry.getEnabledTools();

    // 没有可用工具
    if (enabledTools.length === 0) {
      return null;
    }

    // 已执行过工具，不再调用
    if (toolExecuted) {
      return null;
    }

    // 让 LLM 自行判断
    try {
      const langChainTools = this.toolRegistry.getLangChainTools();
      const llmWithTools = this.llm.bindTools(langChainTools);
      const messages = this.buildMessages(originalPrompt, conversationHistory);

      const response = await llmWithTools.invoke(messages);

      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolCall = response.tool_calls[0];
        return {
          name: toolCall.name,
          arguments: toolCall.args as Record<string, unknown>,
        };
      }
    } catch {
      console.log('🔄 [LLM Decision] 工具调用不可用，启用规则兜底策略');
    }

    // 规则兜底
    if (this.shouldUseSearchTool(originalPrompt)) {
      const tavilyTool = this.toolRegistry.getTool('tavily');
      if (tavilyTool?.enabled) {
        return {
          name: 'tavily',
          arguments: { query: originalPrompt },
        };
      }
    }

    return null;
  }

  /**
   * Step 2: Tool Router - 工具路由
   *
   * 根据工具调用请求选择对应的工具定义
   */
  private toolRouter(toolCall: ToolCall): BaseTool {
    const tool = this.toolRegistry.getTool(toolCall.name);

    if (!tool) {
      throw new Error(`未找到工具: ${toolCall.name}`);
    }

    if (!tool.enabled) {
      throw new Error(`工具未启用: ${toolCall.name}`);
    }

    return tool;
  }

  /**
   * Step 3: Tool Validator - 工具参数验证
   *
   * 验证工具参数是否符合要求
   */
  private toolValidator(tool: BaseTool): BaseTool {
    // TODO: 可以添加参数 schema 验证，后续进行扩展
    return tool;
  }

  /**
   * Step 4 & 5: Tool Executor - 工具执行器
   *
   * 执行工具调用，包含超时控制和重试机制
   */
  private async toolExecutor(
    toolCall: ToolCall,
    iteration: number
  ): Promise<ToolExecutionResult> {
    const toolCallId = `tool_${Date.now()}_${iteration}`;
    const startTime = Date.now();

    console.log(`⚡ [Tool Executor] 执行工具: ${toolCall.name}`);

    try {
      // 使用 Promise.race 实现超时控制
      const result = await Promise.race([
        this.toolRegistry.executeTool(toolCall.name, toolCall.arguments),
        this.createTimeout(TOOL_TIMEOUT),
      ]);

      const executionTime = Date.now() - startTime;
      console.log(`✅ [Tool Executor] 执行完成 (耗时 ${executionTime}ms)`);

      return {
        success: true,
        result,
        toolCallId,
        toolName: toolCall.name,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      console.error(`❌ [Tool Executor] 执行失败: ${errorMessage}`);

      return {
        success: false,
        result: `工具执行失败: ${errorMessage}`,
        toolCallId,
        toolName: toolCall.name,
        executionTime,
      };
    }
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
   * Step 6: Result Truncator - 结果截断器
   *
   * 截断过长的工具结果，避免超出 LLM 上下文限制
   */
  private resultTruncator(result: string): string {
    if (result.length <= MAX_RESULT_LENGTH) {
      return result;
    }

    const truncated = result.substring(0, MAX_RESULT_LENGTH);
    console.log(`✂️ [Result Truncator] 结果过长，已截断 ${result.length} → ${MAX_RESULT_LENGTH} 字符`);

    return `${truncated}\n\n[结果已截断...]`;
  }

  /**
   * Step 7: Append Tool Message - 添加工具消息
   *
   * 将工具调用和结果添加到对话历史
   */
  private appendToolMessage(
    conversationHistory: ConversationMessage[],
    tool: BaseTool,
    toolCallId: string,
    toolResult: string
  ): void {
    // 添加助手消息（工具调用意图）
    conversationHistory.push({
      role: 'assistant',
      content: `我将使用工具来回答这个问题。`,
    });

    // 添加工具调用记录
    conversationHistory.push({
      role: 'tool',
      content: `[工具调用: ${tool.name}] 描述: ${tool.description}`,
      toolCallId,
      toolName: tool.name,
    });

    // 添加工具执行结果
    conversationHistory.push({
      role: 'tool',
      content: toolResult,
      toolCallId,
      toolName: tool.name,
    });

    // 添加上下文提示
    conversationHistory.push({
      role: 'user',
      content: `基于之前的工具调用结果，请回答用户的问题。`,
    });
  }

  /**
   * Step 8: Final LLM Response - 最终 LLM 响应
   *
   * 获取 LLM 的最终响应
   */
  private async finalLLMResponse(
    originalPrompt: string,
    conversationHistory: ConversationMessage[]
  ): Promise<string> {
    const messages = this.buildMessages(originalPrompt, conversationHistory);
    const response = await this.llm.invoke(messages);

    if (response && typeof response.content === 'string') {
      return response.content;
    }

    throw new Error('模型响应格式不正确');
  }

  // ==================== 辅助方法 ====================

  /**
   * 判断是否应该使用搜索工具（规则兜底）
   */
  private shouldUseSearchTool(prompt: string): boolean {
    const lowerPrompt = prompt.toLowerCase();
    return SEARCH_KEYWORDS.some((keyword) => lowerPrompt.includes(keyword.toLowerCase()));
  }

  /**
   * 构建消息列表
   */
  private buildMessages(
    prompt: string,
    conversationHistory: ConversationMessage[]
  ): Array<HumanMessage | SystemMessage | AIMessage | ToolMessage> {
    const messages: Array<HumanMessage | SystemMessage | AIMessage | ToolMessage> = [];

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
        messages.push(new ToolMessage(msg.content, msg.toolCallId ?? '', msg.toolName));
      }
    }

    // 当前输入
    messages.push(new HumanMessage(prompt));

    return messages;
  }

  /**
   * 格式化响应输出
   */
  formatResponse(response: string): string {
    return response.trim();
  }

  /**
   * 获取工具注册中心
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}