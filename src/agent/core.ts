import { ChatOpenAI } from '@langchain/openai';

import { ModelConfig } from '../types/model-config.js';
import { ControlConfig } from '../types/agent.js';
import { ToolRegistry, toolLoader } from '../tools/index.js';

import { Controller } from './controller.js';
import { Planner } from './planner.js';
import { Executor } from './executor.js';

/**
 * AgentCore - Agent 系统核心门面类
 *
 * 集成 Planner、Executor、Controller 三个编排模块，
 * 提供统一的对外接口。
 *
 * 架构:
 * AgentCore (Facade)
 *   └── Controller (控制入口)
 *         ├── Planner (决策)
 *         └── Executor (执行)
 */
export class AgentCore {
  private llm: ChatOpenAI;
  private config: ModelConfig;
  private toolRegistry: ToolRegistry;
  private controller: Controller;
  private planner: Planner;
  private executor: Executor;

  constructor(config: ModelConfig) {
    this.config = config;
    this.llm = this.initializeLLM();
    this.toolRegistry = this.initializeToolRegistry();
    this.planner = this.initializePlanner();
    this.executor = this.initializeExecutor();
    this.controller = this.initializeController();
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

  /**
   * 初始化 Planner 模块
   */
  private initializePlanner(): Planner {
    return new Planner(this.llm, this.toolRegistry);
  }

  /**
   * 初始化 Executor 模块
   */
  private initializeExecutor(): Executor {
    const controlConfig = this.getControlConfig();
    return new Executor(this.toolRegistry, controlConfig);
  }

  /**
   * 初始化 Controller 模块
   */
  private initializeController(): Controller {
    const controlConfig = this.getControlConfig();
    return new Controller(this.llm, this.toolRegistry, controlConfig);
  }

  /**
   * 获取控制配置
   */
  private getControlConfig(): Partial<ControlConfig> {
    const orchestration = this.config.orchestration;
    if (!orchestration) {
      return {};
    }

    return {
      maxIterations: orchestration.maxIterations,
      timeout: orchestration.timeout,
      tokenThreshold: orchestration.tokenThreshold,
      toolTimeout: orchestration.toolTimeout,
      maxResultLength: orchestration.maxResultLength,
      maxTokens: this.config.maxTokens ?? 4096,
    };
  }

  // ==================== 主入口 ====================

  /**
   * 处理用户提示
   *
   * 将请求委托给 Controller 执行编排流程
   */
  async processPrompt(prompt: string): Promise<string> {
    try {
      return await this.controller.execute(prompt);
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
}
