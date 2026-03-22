import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from '@langchain/core/messages';

import {
  ExecutionPlan,
  ToolCallDetail,
  ToolInfo,
  ConversationMessage,
} from '../types/agent.js';
import { ToolRegistry } from '../tools/index.js';
import {
  SpanManager,
  calculateCost,
  createDisabledObservabilityClient,
  PromptManager,
  type LLMUsage,
} from '../observability/index.js';
import { TraceManager } from '../observability/trace-manager.js';

import type { PlanningContext, Plan, PlanStep } from './execution/types.js';

const SEARCH_KEYWORDS: string[] = [
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

function createDefaultSpanManager(): SpanManager {
  const client = createDisabledObservabilityClient();
  const traceManager = new TraceManager(client);
  return new SpanManager(client, traceManager);
}

export class Planner {
  private llm: ChatOpenAI;
  private toolRegistry: ToolRegistry;
  private spanManager: SpanManager;
  private modelName: string;
  private promptManager: PromptManager;

  constructor(
    llm: ChatOpenAI,
    toolRegistry: ToolRegistry,
    spanManager?: SpanManager,
    modelName?: string
  ) {
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.spanManager = spanManager ?? createDefaultSpanManager();
    this.modelName = modelName ?? 'gpt-3.5-turbo';
    this.promptManager = new PromptManager(
      this.spanManager.getObservabilityClient()
    );
  }

  /**
   * 规划执行计划
   */
  async plan(context: PlanningContext): Promise<Plan> {
    const prompt = context.userPrompt;
    const conversationHistory = context.workingMemory.map((m) => ({
      role: m.role,
      content: m.content,
      toolCallId: m.toolCallId,
      toolName: m.toolName,
    }));
    const availableTools = context.availableTools;

    const enabledTools = availableTools.filter((t) => t.enabled);

    console.log('[Planner] 开始规划');
    console.log(`[Planner] 可用工具数量: ${enabledTools.length}`);
    console.log(`[Planner] 用户提示: ${prompt.substring(0, 50)}...`);

    if (enabledTools.length === 0) {
      const result: Plan = {
        steps: [],
        overallConfidence: 0,
        reasoning: '没有可用的工具',
        isFinalAnswer: true,
      };
      console.log('[Planner] 没有可用工具，直接返回');
      return result;
    }

    try {
      const llmPlan = await this.llmDecision(
        prompt,
        conversationHistory,
        enabledTools
      );
      if (llmPlan) {
        if (!llmPlan.needsTool && this.shouldUseTool(prompt)) {
          const fallback = this.ruleBasedFallback(
            prompt,
            enabledTools,
            conversationHistory
          );
          console.log(
            '[Planner] LLM 判断不需要工具，但规则认为需要，使用兜底策略'
          );
          return this.convertToNewPlanFormat(fallback);
        }
        console.log(
          `[Planner] LLM 决策: 需要工具=${llmPlan.needsTool}, 工具数量=${llmPlan.toolCalls.length}`
        );
        return this.convertToNewPlanFormat(llmPlan);
      }
    } catch {
      console.log('🔄 [Planner] LLM 决策失败，启用规则兜底策略');
    }

    const fallback = this.ruleBasedFallback(
      prompt,
      enabledTools,
      conversationHistory
    );
    console.log(
      `[Planner] 兜底策略: 需要工具=${fallback.needsTool}, 工具数量=${fallback.toolCalls.length}`
    );
    return this.convertToNewPlanFormat(fallback);
  }

  private convertToNewPlanFormat(executionPlan: ExecutionPlan): Plan {
    const steps: PlanStep[] = executionPlan.toolCalls.map((tc, index) => ({
      id: tc.toolCallId || `step_${index}`,
      toolName: tc.toolName,
      arguments: tc.arguments || {},
      dependsOn: [],
      confidence: 0.8,
      reasoning: executionPlan.reasoning,
    }));

    const plan: Plan = {
      steps,
      overallConfidence: executionPlan.needsTool ? 0.8 : 0.0,
      reasoning: executionPlan.reasoning,
      isFinalAnswer: !executionPlan.needsTool,
    };

    return this.validatePlanDependencies(plan);
  }

  private validatePlanDependencies(plan: Plan): Plan {
    const stepIds = new Set(plan.steps.map((s) => s.id));
    const validSteps = plan.steps.filter((step) => {
      const validDeps = step.dependsOn.filter((depId) => stepIds.has(depId));
      if (validDeps.length !== step.dependsOn.length) {
        return false;
      }
      if (this.hasCircularDependency(plan.steps, step.id, new Set())) {
        return false;
      }
      return true;
    });

    if (validSteps.length !== plan.steps.length) {
      return {
        ...plan,
        steps: validSteps,
        overallConfidence: plan.overallConfidence * 0.5,
        reasoning: `${plan.reasoning || ''} [警告: 无效依赖已移除]`,
      };
    }

    return plan;
  }

  private hasCircularDependency(
    steps: PlanStep[],
    stepId: string,
    visited: Set<string>
  ): boolean {
    if (visited.has(stepId)) {
      return true;
    }
    visited.add(stepId);
    const step = steps.find((s) => s.id === stepId);
    if (!step) {
      return false;
    }
    for (const depId of step.dependsOn) {
      if (this.hasCircularDependency(steps, depId, new Set(visited))) {
        return true;
      }
    }
    return false;
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

    // 清理多余的空行
    filtered = filtered.replace(/\n{3,}/g, '\n\n');

    // 去除首尾空白
    filtered = filtered.trim();

    return filtered;
  }

  /**
   * LLM 决策
   */
  private async llmDecision(
    prompt: string,
    conversationHistory: ConversationMessage[],
    tools: ToolInfo[]
  ): Promise<ExecutionPlan | null> {
    const spanId = this.spanManager.createLLMSpan(
      'planner-decision',
      { prompt, toolsCount: tools.length },
      this.modelName
    );

    try {
      const langChainTools = this.toolRegistry.getLangChainTools();
      const llmWithTools = this.llm.bindTools(langChainTools);
      const messages = await this.buildDecisionMessages(
        prompt,
        conversationHistory,
        tools
      );

      const response = await llmWithTools.invoke(messages);

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
          {
            toolCalls: response.tool_calls,
            needsTool: !!response.tool_calls?.length,
          },
          usage,
          cost,
          this.modelName
        );
      }

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

      // LLM 判断不需要工具，过滤推理过程
      const content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      const filteredContent = this.filterReasoningProcess(content);

      return {
        needsTool: false,
        toolCalls: [],
        reasoning: filteredContent || 'LLM 判断不需要使用工具',
      };
    } catch (error) {
      if (spanId) {
        this.spanManager.endSpan(spanId, {
          error: error instanceof Error ? error : new Error('未知错误'),
        });
      }
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
  private async buildDecisionMessages(
    prompt: string,
    conversationHistory: ConversationMessage[],
    tools: ToolInfo[]
  ): Promise<Array<HumanMessage | SystemMessage | AIMessage>> {
    const messages: Array<HumanMessage | SystemMessage | AIMessage> = [];

    // 系统消息
    const toolDescriptions = tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');

    const systemPromptResult = await this.promptManager.getCompiledPrompt(
      'planner-decision',
      { tool_descriptions: toolDescriptions }
    );

    const defaultSystemPrompt = `你是一个智能助手，可以决定是否使用工具来回答用户问题。

可用工具:
${toolDescriptions}

如果用户的问题需要实时信息或外部数据，请使用合适的工具。
如果问题可以直接回答，请不要使用工具。`;

    const systemPrompt = systemPromptResult?.content ?? defaultSystemPrompt;
    messages.push(new SystemMessage(systemPrompt));

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
