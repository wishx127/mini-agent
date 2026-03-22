import { ChatOpenAI } from '@langchain/openai';

import { ModelConfig } from '../types/model-config.js';
import { ControlConfig } from '../types/agent.js';
import type { VectorDatabaseConfig } from '../types/memory.js';
import { ToolRegistry, toolLoader } from '../tools/index.js';
// 可观测性系统导入
import {
  ObservabilityClient,
  TraceManager,
  SpanManager,
  PromptManager,
  type ObservabilityConfig,
} from '../observability/index.js';

import { Controller } from './controller.js';
import { Planner } from './planner.js';
import { Executor } from './executor.js';

/**
 * Agent 核心类
 * 负责协调 LLM、工具、记忆和可观测性系统
 */
export class AgentCore {
  private llm: ChatOpenAI;
  private config: ModelConfig;
  private toolRegistry: ToolRegistry;
  private controller: Controller;
  private planner: Planner;
  private executor: Executor;
  /** 可观测性客户端 */
  private observabilityClient: ObservabilityClient;
  /** Trace 管理器 */
  private traceManager: TraceManager;
  /** Span 管理器 */
  private spanManager: SpanManager;
  /** Prompt 管理器 */
  private promptManager: PromptManager;

  constructor(config: ModelConfig) {
    this.config = config;
    this.llm = this.initializeLLM();
    this.toolRegistry = this.initializeToolRegistry();

    // 初始化可观测性系统
    this.observabilityClient = this.initializeObservability();
    this.traceManager = new TraceManager(this.observabilityClient);
    this.spanManager = new SpanManager(
      this.observabilityClient,
      this.traceManager
    );
    this.promptManager = new PromptManager(this.observabilityClient);

    this.planner = this.initializePlanner();
    this.executor = this.initializeExecutor();
    this.controller = this.initializeController();

    // 注册系统 Prompt 模板到 Langfuse
    void this.registerPrompts();
  }

  // ==================== 初始化 ====================

  /**
   * 初始化 LLM 模型实例
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

  /** 初始化可观测性客户端 */
  private initializeObservability(): ObservabilityClient {
    const observabilityConfig = this.getObservabilityConfig();
    return new ObservabilityClient(observabilityConfig);
  }

  /** 获取可观测性配置 */
  private getObservabilityConfig(): ObservabilityConfig {
    const options = this.config.observability;

    const enabled =
      options?.enabled ?? process.env.LANGFUSE_ENABLED !== 'false';
    const publicKey =
      options?.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY ?? '';
    const secretKey =
      options?.secretKey ?? process.env.LANGFUSE_SECRET_KEY ?? '';
    const host =
      options?.host ??
      process.env.LANGFUSE_HOST ??
      'https://cloud.langfuse.com';

    return {
      enabled: enabled && !!publicKey && !!secretKey,
      publicKey,
      secretKey,
      host,
    };
  }

  /** 注册系统 Prompt 模板 */
  private async registerPrompts(): Promise<void> {
    await this.promptManager.registerSystemPrompts();
  }

  private initializePlanner(): Planner {
    return new Planner(
      this.llm,
      this.toolRegistry,
      this.spanManager,
      this.config.modelName
    );
  }

  /**
   * 初始化 Executor 模块
   */
  private initializeExecutor(): Executor {
    const controlConfig = this.getControlConfig();
    return new Executor(this.toolRegistry, controlConfig, this.spanManager);
  }

  /**
   * 初始化 Controller 模块
   */
  private initializeController(): Controller {
    const controlConfig = this.getControlConfig();
    const vectorDbConfig = this.getVectorDbConfig();
    return new Controller(
      this.llm,
      this.toolRegistry,
      controlConfig,
      vectorDbConfig,
      this.traceManager,
      this.spanManager,
      this.config.modelName
    );
  }

  /**
   * 获取向量数据库配置
   */
  private getVectorDbConfig(): VectorDatabaseConfig | undefined {
    const longTermMemory = this.config.longTermMemory;
    if (!longTermMemory || !longTermMemory.enabled) {
      return undefined;
    }

    if (!longTermMemory.supabaseUrl || !longTermMemory.supabaseApiKey) {
      return undefined;
    }

    return {
      supabaseUrl: longTermMemory.supabaseUrl,
      supabaseApiKey: longTermMemory.supabaseApiKey,
      tableName: longTermMemory.tableName,
      embeddingDimension: longTermMemory.embeddingDimension,
      embeddingApiUrl: longTermMemory.embeddingApiUrl,
      embeddingModel: longTermMemory.embeddingModel,
      embeddingApiKey: longTermMemory.embeddingApiKey,
    };
  }

  /**
   * 获取控制配置
   */
  private getControlConfig(): Partial<ControlConfig> {
    const orchestration = this.config.orchestration;
    const longTermMemoryEnabled = this.config.longTermMemory?.enabled ?? false;

    const controlConfig: Partial<ControlConfig> = {
      maxTokens: this.config.maxTokens ?? 4096,
      enableLongTermMemory: longTermMemoryEnabled,
    };

    if (orchestration?.maxIterations !== undefined) {
      controlConfig.maxIterations = orchestration.maxIterations;
    }
    if (orchestration?.timeout !== undefined) {
      controlConfig.timeout = orchestration.timeout;
    }
    if (orchestration?.tokenThreshold !== undefined) {
      controlConfig.tokenThreshold = orchestration.tokenThreshold;
    }
    if (orchestration?.toolTimeout !== undefined) {
      controlConfig.toolTimeout = orchestration.toolTimeout;
    }
    if (orchestration?.maxResultLength !== undefined) {
      controlConfig.maxResultLength = orchestration.maxResultLength;
    }

    return controlConfig;
  }

  // ==================== 主入口 ====================

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
   * 处理用户提示
   *
   * 将请求委托给 Controller 执行编排流程
   */
  async processPrompt(prompt: string): Promise<string> {
    try {
      const result = await this.controller.execute(prompt);
      // 过滤推理过程，只返回最终答案
      return this.filterReasoningProcess(result.finalAnswer);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error(`❌ [AgentCore] 处理错误: ${errorMessage}`);
      return `处理过程中发生错误: ${errorMessage}`;
    }
  }

  // ==================== 辅助方法 ====================

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

  /**
   * 获取最后一次请求的 token 使用量
   */
  getLastTokenUsage(): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null {
    const records = this.controller.getCostTracker().getRecentRecords(1);
    if (records.length === 0) return null;
    const r = records[0];
    return {
      inputTokens: r.usage.input_tokens ?? 0,
      outputTokens: r.usage.output_tokens ?? 0,
      totalTokens: r.usage.total_tokens ?? 0,
    };
  }

  /**
   * 获取本次会话累计 token 统计
   */
  getSessionTokenSummary() {
    return this.controller.getCostTracker().getSummary();
  }

  /**
   * 获取 Controller 实例（用于测试和调试）
   */
  getController(): Controller {
    return this.controller;
  }

  /**
   * 获取 Planner 实例（用于测试和调试）
   */
  getPlanner(): Planner {
    return this.planner;
  }

  /**
   * 获取 Executor 实例（用于测试和调试）
   */
  getExecutor(): Executor {
    return this.executor;
  }

  /** 获取可观测性客户端 */
  getObservabilityClient(): ObservabilityClient {
    return this.observabilityClient;
  }

  /** 检查可观测性是否启用 */
  isObservabilityEnabled(): boolean {
    return this.observabilityClient.isEnabled();
  }

  /** 刷新可观测性数据到 Langfuse */
  async flushObservability(): Promise<void> {
    await this.observabilityClient.flush();
  }
}
