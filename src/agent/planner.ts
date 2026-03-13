import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from '@langchain/core/messages';

import {
  ExecutionPlan,
  PlanningContext,
  ToolCallDetail,
  ToolInfo,
  ConversationMessage,
} from '../types/agent.js';
import { ToolRegistry } from '../tools/index.js';

/**
 * 搜索关键词列表（用于规则兜底）
 */
const SEARCH_KEYWORDS = [
  '搜索',
  '查询',
  '联网',
  '最新',
  '检索',
  'news',
  'search',
  'find',
  'look up',
];

/**
 * Planner - Agent 编排层的规划模块
 *
 * 职责：
 * - 判断是否需要使用工具
 * - 选择最合适的工具
 * - 规划工具执行顺序
 * - 参数验证
 * - LLM 决策和规则兜底
 */
export class Planner {
  private llm: ChatOpenAI;
  private toolRegistry: ToolRegistry;

  constructor(llm: ChatOpenAI, toolRegistry: ToolRegistry) {
    this.llm = llm;
    this.toolRegistry = toolRegistry;
  }

  /**
   * 规划执行计划
   */
  async plan(context: PlanningContext): Promise<ExecutionPlan> {
    const { prompt, conversationHistory, availableTools } = context;

    // 过滤出启用的工具
    const enabledTools = availableTools.filter((t) => t.enabled);

    // 没有可用工具
    if (enabledTools.length === 0) {
      return {
        needsTool: false,
        toolCalls: [],
        reasoning: '没有可用的工具',
      };
    }

    // 尝试 LLM 决策
    try {
      const llmPlan = await this.llmDecision(
        prompt,
        conversationHistory,
        enabledTools
      );
      if (llmPlan) {
        // 若 LLM 判断不需要工具，但规则认为需要，则强制进入兜底
        if (!llmPlan.needsTool && this.shouldUseTool(prompt)) {
          return this.ruleBasedFallback(
            prompt,
            enabledTools,
            conversationHistory
          );
        }
        return llmPlan;
      }
    } catch {
      console.log('🔄 [Planner] LLM 决策失败，启用规则兜底策略');
    }

    // 规则兜底
    return this.ruleBasedFallback(prompt, enabledTools, conversationHistory);
  }

  /**
   * 判断是否需要使用工具
   */
  shouldUseTool(prompt: string): boolean {
    // 检查是否包含搜索关键词
    const lowerPrompt = prompt.toLowerCase();
    const hasSearchKeyword = SEARCH_KEYWORDS.some((keyword) =>
      lowerPrompt.includes(keyword.toLowerCase())
    );

    if (hasSearchKeyword) {
      return true;
    }

    return false;
  }

  /**
   * 选择最合适的工具
   */
  selectTool(prompt: string, tools: ToolInfo[]): ToolInfo | null {
    const lowerPrompt = prompt.toLowerCase();

    // 搜索相关
    if (
      SEARCH_KEYWORDS.some((keyword) =>
        lowerPrompt.includes(keyword.toLowerCase())
      )
    ) {
      const searchTool = tools.find(
        (t) => t.name === 'tavily' || t.name.includes('search')
      );
      if (searchTool) {
        return searchTool;
      }
    }

    // 默认返回第一个可用工具
    return tools[0] || null;
  }

  /**
   * 规划执行顺序
   */
  planExecution(toolCalls: ToolCallDetail[]): ToolCallDetail[] {
    // 当前实现：按顺序执行
    // 未来可以支持并行执行或条件执行
    return toolCalls;
  }

  /**
   * 验证工具参数
   */
  validateParams(toolCall: ToolCallDetail): boolean {
    if (!toolCall.arguments) {
      return false;
    }

    // 基础验证：确保参数是对象
    if (typeof toolCall.arguments !== 'object') {
      return false;
    }

    // TODO: 可以扩展为基于工具 schema 的验证
    return true;
  }

  /**
   * LLM 决策
   */
  private async llmDecision(
    prompt: string,
    conversationHistory: ConversationMessage[],
    tools: ToolInfo[]
  ): Promise<ExecutionPlan | null> {
    try {
      const langChainTools = this.toolRegistry.getLangChainTools();
      const llmWithTools = this.llm.bindTools(langChainTools);
      const messages = this.buildDecisionMessages(
        prompt,
        conversationHistory,
        tools
      );

      const response = await llmWithTools.invoke(messages);

      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolCalls: ToolCallDetail[] = response.tool_calls.map(
          (tc, index) => ({
            toolCallId: `tool_${Date.now()}_${index}`,
            toolName: tc.name,
            arguments: tc.args as Record<string, unknown>,
          })
        );

        return {
          needsTool: true,
          toolCalls: this.planExecution(toolCalls),
          reasoning: `LLM 决策: 使用工具 ${toolCalls.map((t) => t.toolName).join(', ')}`,
        };
      }

      // LLM 判断不需要工具
      return {
        needsTool: false,
        toolCalls: [],
        reasoning: 'LLM 判断不需要使用工具',
      };
    } catch {
      return null;
    }
  }

  /**
   * 基于规则的兜底规划
   */
  private ruleBasedFallback(
    prompt: string,
    tools: ToolInfo[],
    _conversationHistory: ConversationMessage[]
  ): ExecutionPlan {
    // 检查是否需要工具
    if (!this.shouldUseTool(prompt)) {
      return {
        needsTool: false,
        toolCalls: [],
        reasoning: '规则判断: 不需要使用工具',
      };
    }

    // 选择工具
    const selectedTool = this.selectTool(prompt, tools);
    if (!selectedTool) {
      return {
        needsTool: false,
        toolCalls: [],
        reasoning: '规则判断: 没有合适的工具',
      };
    }

    // 构建工具调用
    const toolCall: ToolCallDetail = {
      toolCallId: `tool_${Date.now()}_0`,
      toolName: selectedTool.name,
      arguments: this.inferArguments(prompt, selectedTool),
    };

    // 验证参数
    if (!this.validateParams(toolCall)) {
      return {
        needsTool: false,
        toolCalls: [],
        reasoning: `规则判断: 工具 ${selectedTool.name} 参数验证失败`,
      };
    }

    return {
      needsTool: true,
      toolCalls: [toolCall],
      reasoning: `规则兜底: 使用工具 ${selectedTool.name}`,
    };
  }

  /**
   * 生成执行计划
   */
  generateExecutionPlan(
    needsTool: boolean,
    toolCalls: ToolCallDetail[],
    reasoning?: string
  ): ExecutionPlan {
    return {
      needsTool,
      toolCalls: needsTool ? this.planExecution(toolCalls) : [],
      reasoning,
    };
  }

  /**
   * 推断工具参数
   */
  private inferArguments(
    prompt: string,
    tool: ToolInfo
  ): Record<string, unknown> {
    // 对于搜索工具，使用 prompt 作为查询参数
    if (tool.name === 'tavily' || tool.name.includes('search')) {
      return { query: prompt };
    }

    // 默认参数
    return { input: prompt };
  }

  /**
   * 构建决策消息
   */
  private buildDecisionMessages(
    prompt: string,
    conversationHistory: ConversationMessage[],
    tools: ToolInfo[]
  ): Array<HumanMessage | SystemMessage | AIMessage> {
    const messages: Array<HumanMessage | SystemMessage | AIMessage> = [];

    // 系统消息
    const toolDescriptions = tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');
    messages.push(
      new SystemMessage(
        `你是一个智能助手，可以决定是否使用工具来回答用户问题。

可用工具:
${toolDescriptions}

如果用户的问题需要实时信息或外部数据，请使用合适的工具。
如果问题可以直接回答，请不要使用工具。`
      )
    );

    // 对话历史
    for (const msg of conversationHistory) {
      if (msg.role === 'user') {
        messages.push(new HumanMessage(msg.content));
      } else if (msg.role === 'assistant') {
        messages.push(new AIMessage(msg.content));
      }
    }

    // 当前问题
    messages.push(new HumanMessage(prompt));

    return messages;
  }
}
