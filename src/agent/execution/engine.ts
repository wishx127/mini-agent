import type { ChatOpenAI } from '@langchain/openai';

import type { MemorySearchResult } from '../../types/memory.js';

import {
  ExecutionPhase,
  ExecutionConfig,
  DEFAULT_EXECUTION_CONFIG,
  PlanningContext,
  Plan,
  PlanStep,
  ReflectionResult,
  ExecutionMetrics,
  Message,
  ToolInfo,
  WaveExecutionResult,
  TerminationChecker,
  StateSnapshot,
  StateDigest,
  StateDelta,
  ToolCallStatus,
} from './types.js';
import {
  ConversationHistory,
  ToolMemory,
  SummaryMemory,
  ExecutionMetricsCollector,
  DeduplicationEngine,
} from './types.js';
import { buildExecutionWaves, executeAllWaves } from './parallel-executor.js';
import { Reflector, ReflectorConfig } from './reflector.js';
import { StateDigestGenerator } from './state-digest.js';
import { DeltaDetector } from './delta-detector.js';
import { AgentErrorHandler } from './agent-error.js';
import { Evaluator, EvaluationScore } from './evaluator.js';

export interface ExecutionEngineDeps {
  llm: ChatOpenAI;
  tools: ToolInfo[];
  generateSummary: (messages: Message[]) => Promise<string>;
  executeTool: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<string>;
  reflectorConfig?: Partial<ReflectorConfig>;
  longTermMemoryReader?: {
    search: (query: string, topK?: number) => Promise<MemorySearchResult[]>;
    formatMemoriesForPrompt: (results: MemorySearchResult[]) => string;
  };
  userInfoContext?: string;
  /**
   * 工具执行完成回调
   * @param toolName 工具名称
   * @param args 工具参数
   * @param result 工具执行结果
   */
  onToolExecuted?: (
    toolName: string,
    args: Record<string, unknown>,
    result: string
  ) => void;
}

export class ExecutionEngine {
  private config: ExecutionConfig;
  private phase: ExecutionPhase;
  private iteration: number;
  private workingMemory: ConversationHistory;
  private toolMemory: ToolMemory;
  private summaryMemory: SummaryMemory;
  private metrics: ExecutionMetricsCollector;
  private deduplicationEngine: DeduplicationEngine;
  private terminationChecker: TerminationChecker;
  private reflector: Reflector;
  private deps: ExecutionEngineDeps;
  private currentPlan: Plan | null = null;
  private lastWaveResults: WaveExecutionResult[] = [];
  private verbose: boolean;

  // 新增：OBSERVE阶段增强组件
  private stateDigestGenerator: StateDigestGenerator;
  private deltaDetector: DeltaDetector;
  private errorHandler: AgentErrorHandler;
  private previousSnapshot: StateSnapshot | null = null;
  private stateDigestHistory: StateDigest[] = [];
  private stateDeltaHistory: StateDelta[] = [];

  // 新增：EVALUATE阶段组件
  private evaluator: Evaluator;
  private lastEvaluationScore: EvaluationScore | null = null;

  constructor(config: Partial<ExecutionConfig>, deps: ExecutionEngineDeps) {
    this.config = { ...DEFAULT_EXECUTION_CONFIG, ...config };
    this.verbose = (config as { verbose?: boolean }).verbose ?? false;
    this.phase = 'OBSERVE';
    this.iteration = 0;
    this.workingMemory = new ConversationHistory(
      this.config.maxWorkingMemorySize,
      this.config.summaryTriggerTokens
    );
    this.toolMemory = new ToolMemory(this.config.maxToolMemorySize);
    this.summaryMemory = new SummaryMemory();
    this.metrics = new ExecutionMetricsCollector();
    this.deduplicationEngine = new DeduplicationEngine(this.toolMemory);
    this.terminationChecker = new TerminationChecker({
      maxIterations: this.config.maxIterations,
      maxExecutionTime: this.config.maxExecutionTime,
      tokenBudgetThreshold: this.config.tokenThreshold,
    });
    this.reflector = new Reflector(deps.reflectorConfig);
    this.deps = deps;

    // 初始化新增组件
    this.stateDigestGenerator = new StateDigestGenerator();
    this.deltaDetector = new DeltaDetector();
    this.errorHandler = new AgentErrorHandler();

    // 初始化EVALUATE阶段组件
    this.evaluator = new Evaluator({
      verbose: this.verbose,
    });
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }

  async run(
    userPrompt: string,
    conversationHistory?: Array<{ role: string; content: string }>
  ): Promise<{
    finalAnswer: string;
    metrics: ExecutionMetrics;
  }> {
    let finalAnswer = '';

    // 如果有会话历史，将其添加到 workingMemory
    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        if (msg.role === 'user') {
          this.workingMemory.addUserMessage(msg.content);
        } else if (msg.role === 'assistant') {
          this.workingMemory.addAssistantMessage(msg.content);
        }
      }
    }

    while (true) {
      const phaseStartTime = Date.now();

      const currentTokenUsage = this.workingMemory.estimateTokens();
      const terminationCheck = this.terminationChecker.checkAll(
        this.currentPlan,
        currentTokenUsage
      );

      if (terminationCheck.shouldTerminate) {
        this.log(`[Termination] ${terminationCheck.message}`);
        return {
          finalAnswer: terminationCheck.message,
          metrics: this.metrics.finalize(terminationCheck.reason),
        };
      }

      const warningStatus =
        this.terminationChecker.getWarningStatus(currentTokenUsage);
      if (warningStatus.isWarning) {
        this.log(`[Warning] ${warningStatus.message}`);
      }

      if (this.phase === 'OBSERVE') {
        await this.executeObserve(userPrompt);
        this.phase = 'PLAN';
      } else if (this.phase === 'PLAN') {
        const plan = await this.executePlan(userPrompt);
        if (plan.isFinalAnswer) {
          finalAnswer = plan.reasoning ?? '';
          this.metrics.recordPhaseTiming('PLAN', Date.now() - phaseStartTime);
          return {
            finalAnswer,
            metrics: this.metrics.finalize('planner_final'),
          };
        }
        this.phase = 'ACT';
      } else if (this.phase === 'ACT') {
        await this.executeAct();
        this.phase = 'EVALUATE';
      } else if (this.phase === 'EVALUATE') {
        const evaluation = this.executeEvaluate();
        this.lastEvaluationScore = evaluation;

        // 根据评估结果决定下一步
        if (evaluation.overall >= 0.8) {
          this.log('[EVALUATE] 评估结果良好，进入REFLECT阶段');
          this.phase = 'REFLECT';
        } else if (evaluation.overall < 0.4) {
          this.log('[EVALUATE] 评估结果较差，直接进入PLAN阶段重新规划');
          this.phase = 'PLAN';
          this.terminationChecker.updateIteration();
          this.metrics.incrementIteration();
        } else {
          this.log('[EVALUATE] 评估结果一般，进入REFLECT阶段');
          this.phase = 'REFLECT';
        }
      } else if (this.phase === 'REFLECT') {
        const reflection = await this.executeReflect();

        const toolResults = this.collectToolResults();
        const failureCount = toolResults.filter(
          (r) => r.status !== 'success'
        ).length;
        if (failureCount > 0) {
          this.terminationChecker.recordFailure();
        }

        this.terminationChecker.recordInformationGrowth(
          reflection.informationGrowth ?? 0
        );

        if (reflection.decision === 'finalize_answer') {
          this.log('[REFLECT] 决策: 生成最终答案');
          await this.checkAndGenerateSummary();

          // 调用规划器生成真正的最终答案
          const context = this.buildPlanningContext(userPrompt);
          const prompt = await this.buildFinalAnswerPrompt(context);
          const response = await this.deps.llm.invoke(prompt);
          const content = this.extractContent(response);

          this.metrics.recordPhaseTiming(
            'REFLECT',
            Date.now() - phaseStartTime
          );
          return {
            finalAnswer: content,
            metrics: this.metrics.finalize('final_answer'),
          };
        }

        if (reflection.decision === 'fallback') {
          this.metrics.recordPhaseTiming(
            'REFLECT',
            Date.now() - phaseStartTime
          );
          return {
            finalAnswer: '工具执行失败，触发降级处理',
            metrics: this.metrics.finalize('fallback'),
          };
        }

        if (reflection.decision === 'new_plan') {
          this.log('[REFLECT] 决策: 重新规划');
          await this.checkAndGenerateSummary();
          this.phase = 'PLAN';
          this.terminationChecker.updateIteration();
          this.metrics.incrementIteration();
          this.metrics.recordPhaseTiming(
            'REFLECT',
            Date.now() - phaseStartTime
          );
          continue;
        }

        if (reflection.decision === 'retry') {
          this.log(
            `[REFLECT] 决策: 重试工具: ${reflection.shouldRetryTools?.join(', ')}`
          );
          await this.checkAndGenerateSummary();
          this.phase = 'ACT';
          this.terminationChecker.updateIteration();
          this.metrics.incrementIteration();
          this.metrics.recordPhaseTiming(
            'REFLECT',
            Date.now() - phaseStartTime
          );
          continue;
        }

        if (reflection.decision === 'continue') {
          this.log('[REFLECT] 决策: 继续执行，进入重新规划');
          await this.checkAndGenerateSummary();
          this.phase = 'PLAN';
          this.terminationChecker.updateIteration();
          this.metrics.incrementIteration();
          this.metrics.recordPhaseTiming(
            'REFLECT',
            Date.now() - phaseStartTime
          );
          continue;
        }

        await this.checkAndGenerateSummary();

        this.phase = 'OBSERVE';
        this.terminationChecker.updateIteration();
        this.metrics.incrementIteration();
      }

      this.metrics.recordPhaseTiming(this.phase, Date.now() - phaseStartTime);
    }
  }

  /**
   * 收集当前系统状态快照
   */
  private collectStateSnapshot(): StateSnapshot {
    const toolRecords = this.toolMemory.getRecords();
    const recentToolRecords = this.toolMemory.getRecentRecords(5);

    // 计算失败统计
    const totalFailures = toolRecords.filter(
      (r) => r.status === 'failed' || r.status === 'timeout'
    ).length;
    const recentFailures = recentToolRecords.filter(
      (r) => r.status === 'failed' || r.status === 'timeout'
    ).length;

    // 计算平均工具执行时间
    const executionTimes = toolRecords
      .filter((r) => r.executionTime)
      .map((r) => r.executionTime!);
    const avgToolExecutionTime =
      executionTimes.length > 0
        ? executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length
        : 0;

    // 计算计划进度
    const totalSteps = this.currentPlan?.steps.length || 0;
    const completedSteps = toolRecords.filter(
      (r) => r.status === 'success' && r.iteration === this.iteration
    ).length;

    return {
      iteration: this.iteration,
      timestamp: Date.now(),
      workingMemorySize: this.workingMemory.size(),
      workingMemoryTokens: this.workingMemory.estimateTokens(),
      toolMemorySize: this.toolMemory.size(),
      recentToolRecords,
      currentPlanProgress: {
        totalSteps,
        completedSteps,
        remainingSteps: Math.max(0, totalSteps - completedSteps),
      },
      failureStats: {
        totalFailures,
        recentFailures,
        retryCount:
          this.deduplicationEngine.getDeduplicationState()
            .duplicateCallsDetected,
      },
      performanceStats: {
        avgToolExecutionTime,
        totalExecutionTime: Date.now() - this.metrics.getMetrics().startTime,
      },
    };
  }

  private async executeObserve(userPrompt: string): Promise<void> {
    await Promise.resolve();

    // 第一次迭代时添加用户消息
    if (this.iteration === 0) {
      this.workingMemory.addUserMessage(userPrompt);
    }

    // 收集状态快照
    const currentSnapshot = this.collectStateSnapshot();

    // 生成状态摘要
    const stateDigest = this.stateDigestGenerator.generateHeuristicDigest(
      currentSnapshot,
      this.previousSnapshot
    );
    this.stateDigestHistory.push(stateDigest);

    // 检测状态变化
    const stateDelta = this.deltaDetector.detectDelta(currentSnapshot);
    this.stateDeltaHistory.push(stateDelta);

    // 记录状态信息到日志
    this.log(`[OBSERVE] ${stateDigest.summary}`);
    if (stateDigest.warnings.length > 0) {
      this.log(`[OBSERVE] 警告: ${stateDigest.warnings.join(', ')}`);
    }
    if (stateDelta.should_skip_plan) {
      this.log(`[OBSERVE] 建议跳过规划: ${stateDelta.skip_reason}`);
    }

    // 更新 previousSnapshot
    this.previousSnapshot = currentSnapshot;

    // 将状态摘要写入 workingMemory
    this.workingMemory.addAssistantMessage(
      `[状态摘要] ${stateDigest.summary}\n` +
        `进度: ${(stateDigest.keyMetrics.progressRate * 100).toFixed(0)}%, ` +
        `成功率: ${(stateDigest.keyMetrics.successRate * 100).toFixed(0)}%, ` +
        `信息增长: ${(stateDigest.keyMetrics.informationGrowth * 100).toFixed(0)}%`
    );
  }

  private async executePlan(userPrompt: string): Promise<Plan> {
    const context = this.buildPlanningContext(userPrompt);
    const prompt = await this.buildPlannerPrompt(context);
    const response = await this.deps.llm.invoke(prompt);
    const content = this.extractContent(response);
    const plan = this.parsePlanResponse(content);

    // 如果 isFinalAnswer=true 但 reasoning 为空，使用 buildFinalAnswerPrompt 获取答案
    if (
      plan.isFinalAnswer &&
      (!plan.reasoning || plan.reasoning.trim() === '')
    ) {
      const finalAnswerPrompt = await this.buildFinalAnswerPrompt(context);
      const finalResponse = await this.deps.llm.invoke(finalAnswerPrompt);
      const finalContent = this.extractContent(finalResponse);
      plan.reasoning = finalContent || '无法生成答案';
    }

    this.currentPlan = plan;
    return plan;
  }

  private extractContent(response: unknown): string {
    let content = '';

    if (typeof response === 'string') {
      content = response;
    } else if (
      response &&
      typeof response === 'object' &&
      'content' in response
    ) {
      const responseContent = (response as { content: unknown }).content;
      if (typeof responseContent === 'string') {
        content = responseContent;
      } else if (Array.isArray(responseContent)) {
        content = responseContent
          .map((c) => {
            if (typeof c === 'string') return c;
            if (c && typeof c === 'object' && 'text' in c) {
              return String((c as { text: unknown }).text);
            }
            return '';
          })
          .join('');
      }
    }

    // 过滤推理过程，只保留最终答案
    return this.filterReasoningProcess(content);
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

    // 移除包含"下一步应"的推理段落（内部规划用语）
    filtered = filtered.replace(/.*下一步应[\s\S]*?(?=\n\n|\n[^下]|$)/gi, '');

    // 移除包含"用户正在期待"的推理段落（内部规划用语）
    filtered = filtered.replace(
      /.*用户正在期待[\s\S]*?(?=\n\n|\n[^用]|$)/gi,
      ''
    );

    // 移除包含"虽然此前"的推理段落（内部规划用语）
    filtered = filtered.replace(/.*虽然此前[\s\S]*?(?=\n\n|\n[^虽]|$)/gi, '');

    // 移除包含"满足其"的推理段落（内部规划用语）
    filtered = filtered.replace(/.*满足其[\s\S]*?(?=\n\n|\n[^满]|$)/gi, '');

    // 移除包含"提升对话体验"的推理段落（内部规划用语）
    filtered = filtered.replace(
      /.*提升对话体验[\s\S]*?(?=\n\n|\n[^提]|$)/gi,
      ''
    );

    // 移除以"分析用户"开头的段落（内部规划用语）
    filtered = filtered.replace(/^分析用户[\s\S]*?(?=\n\n|\n[^分]|$)/gi, '');

    // 移除以"为了"开头的目的说明段落（如果后面跟着推理）
    filtered = filtered.replace(
      /^为了[\s\S]*?(?=，|,)(?:，|,)[\s\S]*?(?=\n\n|\n[^为]|$)/gi,
      ''
    );

    // 移除JSON格式的reasoning字段暴露（如 "reasoning": "..." 或 reasoning: "..."）
    filtered = filtered.replace(/"reasoning"\s*:\s*"[^"]*"/gi, '');
    filtered = filtered.replace(/reasoning\s*:\s*"[^"]*"/gi, '');

    // 移除包含"核心诉求"的分析段落（内部规划用语）
    filtered = filtered.replace(/.*核心诉求[\s\S]*?(?=\n\n|\n[^核]|$)/gi, '');

    // 移除包含"置信度"的分析段落（内部规划用语）
    filtered = filtered.replace(/.*置信度[\s\S]*?(?=\n\n|\n[^置]|$)/gi, '');

    // 移除包含"单次澄清动作"的分析段落（内部规划用语）
    filtered = filtered.replace(
      /.*单次澄清动作[\s\S]*?(?=\n\n|\n[^单]|$)/gi,
      ''
    );

    // 移除以"此为"开头的判断说明段落（内部规划用语）
    filtered = filtered.replace(/^此为[\s\S]*?(?=\n\n|$)/gi, '');

    // 移除包含"无需复杂流程"的分析段落（内部规划用语）
    filtered = filtered.replace(
      /.*无需复杂流程[\s\S]*?(?=\n\n|\n[^无]|$)/gi,
      ''
    );

    // 移除包含"置信度高"的分析段落（内部规划用语）
    filtered = filtered.replace(/.*置信度高[\s\S]*?(?=\n\n|\n[^置]|$)/gi, '');

    // 移除看起来像内部决策输出的内容（如"用户的核心诉求是..."、"此为单次澄清动作"等）
    filtered = filtered.replace(/^用户的[\s\S]*?(?=\n\n|$)/gim, '');
    filtered = filtered.replace(/^此为[\s\S]*?(?=\n\n|$)/gim, '');
    filtered = filtered.replace(/^基于用户偏好[\s\S]*?(?=\n\n|$)/gim, '');
    filtered = filtered.replace(/^应立即[\s\S]*?(?=\n\n|$)/gim, '');
    filtered = filtered.replace(/^无需[\s\S]*?(?=\n\n|$)/gim, '');

    // 移除 ```json 代码块（如果LLM输出了JSON格式的reasoning）
    filtered = filtered.replace(/```json[\s\S]*?```/gi, '');

    // 清理多余的空行
    filtered = filtered.replace(/\n{3,}/g, '\n\n');

    // 去除首尾空白
    filtered = filtered.trim();

    // 安全检查：如果过滤后内容为空，保留原始内容
    if (!filtered || filtered.length === 0) {
      return content.trim();
    }

    return filtered;
  }

  private async executeAct(toolsToRetry?: string[]): Promise<void> {
    // 优化点3.1：ACT阶段空计划处理
    if (!this.currentPlan || this.currentPlan.steps.length === 0) {
      this.log(`[ACT] 没有计划步骤可执行 (迭代 ${this.iteration})`);

      // 创建空计划错误
      const emptyPlanError = this.errorHandler.createError(
        'validation_error',
        '计划为空或没有可执行的步骤',
        {
          severity: 3,
          iteration: this.iteration,
          context: {
            hasPlan: !!this.currentPlan,
            stepsCount: this.currentPlan?.steps.length || 0,
          },
        }
      );

      // 记录错误到 workingMemory
      this.workingMemory.addAssistantMessage(
        `[错误] ${this.errorHandler.formatError(emptyPlanError)}`
      );

      // 设置 phase = "REFLECT" 以触发重新规划
      this.phase = 'REFLECT';
      return;
    }

    let stepsToExecute = this.currentPlan.steps;

    if (toolsToRetry && toolsToRetry.length > 0) {
      this.log(
        `[ACT] 重试工具: ${toolsToRetry.join(', ')} (迭代 ${this.iteration})`
      );
      stepsToExecute = this.currentPlan.steps.filter((step) =>
        toolsToRetry.includes(step.toolName)
      );

      if (stepsToExecute.length === 0) {
        this.log('[ACT] 没有需要重试的工具');
        return;
      }
    } else {
      this.log(
        `[ACT] 执行工具 (迭代 ${this.iteration}), 步骤数: ${this.currentPlan.steps.length}`
      );
    }

    const waves = buildExecutionWaves({
      ...this.currentPlan,
      steps: stepsToExecute,
    });
    this.log(`[ACT] 生成 ${waves.length} 个波次`);

    // 创建工具信息映射，用于获取工具级别的超时时间
    const toolInfoMap = new Map(
      this.deps.tools.map((tool) => [tool.name, tool])
    );

    const config = {
      toolTimeout: this.config.toolTimeout,
      maxConcurrentTools:
        (this.config as unknown as { maxConcurrentTools?: number })
          .maxConcurrentTools || 5,
      waveTimeout:
        (this.config as unknown as { waveTimeout?: number }).waveTimeout ||
        60000,
      toolInfoMap,
    };

    const waveResults = await executeAllWaves(
      waves,
      this.deps.executeTool,
      config,
      this.deps.onToolExecuted
    );

    this.lastWaveResults = waveResults;

    // 优化点4.2：step-level retry机制
    const failedSteps: Array<{
      step: PlanStep;
      error: string;
      retryCount: number;
    }> = [];

    for (const waveResult of waveResults) {
      this.log(
        `[ACT] 波次 ${waveResult.waveIndex}: ${waveResult.successCount} 成功, ${waveResult.failureCount} 失败, 耗时 ${waveResult.waveDuration}ms`
      );

      for (const stepResult of waveResult.stepResults) {
        // 记录到 toolMemory
        this.toolMemory.addRecord({
          toolCallId: stepResult.stepId,
          toolName: stepResult.toolName,
          arguments: stepResult.arguments,
          result: stepResult.result,
          status: stepResult.status,
          iteration: this.iteration,
          executionTime: stepResult.duration,
          retryCount: 0,
        });

        this.workingMemory.addToolMessage(
          stepResult.result || stepResult.error || '',
          stepResult.stepId,
          stepResult.toolName
        );

        this.metrics.recordToolExecution(
          stepResult.toolName,
          stepResult.status === 'success',
          stepResult.duration
        );

        // 收集失败的步骤，准备重试
        if (stepResult.status !== 'success') {
          const step = stepsToExecute.find((s) => s.id === stepResult.stepId);
          if (step) {
            // 检查是否是用户取消的错误（不应该重试）
            const isUserCancelled =
              stepResult.error?.includes('USER_CANCELLED') ||
              stepResult.error?.includes('用户拒绝授权');

            // 检查步骤是否可重试
            const isRetryable = step.retryable !== false && !isUserCancelled; // 默认可重试，但用户取消除外

            if (isRetryable) {
              // 检查重试预算
              const deduplicationResult =
                this.deduplicationEngine.checkDuplicate(
                  step.toolName,
                  step.arguments
                );

              if (
                !deduplicationResult.shouldSkip &&
                deduplicationResult.remainingBudget > 0
              ) {
                failedSteps.push({
                  step,
                  error: stepResult.error || '未知错误',
                  retryCount: deduplicationResult.retryCount,
                });
              } else {
                this.log(
                  `[ACT] 步骤 ${step.id} 失败，但重试预算已耗尽或应跳过: ${deduplicationResult.skipReason || '无'}`
                );
              }
            } else {
              this.log(`[ACT] 步骤 ${step.id} 标记为不可重试`);
            }
          }
        }
      }
    }

    // 执行 step-level retry
    if (failedSteps.length > 0) {
      this.log(`[ACT] 准备重试 ${failedSteps.length} 个失败的步骤`);

      for (const { step, retryCount } of failedSteps) {
        const maxRetries = step.max_retries ?? this.config.maxRetryPerTool;

        if (retryCount >= maxRetries) {
          this.log(
            `[ACT] 步骤 ${step.id} 已达到最大重试次数 (${retryCount}/${maxRetries})`
          );
          continue;
        }

        this.log(
          `[ACT] 重试步骤 ${step.id} (第 ${retryCount + 1} 次): ${step.toolName}`
        );

        // 减少重试预算
        this.deduplicationEngine.decrementRetryBudget(step.toolName);

        // 执行单个步骤
        const startTime = Date.now();
        let status: ToolCallStatus = 'success';
        let result: string | undefined;
        let stepError: string | undefined;

        try {
          const timeoutPromise = new Promise<string>((_, reject) => {
            setTimeout(
              () => reject(new Error('Tool execution timeout')),
              this.config.toolTimeout
            );
          });

          result = await Promise.race([
            this.deps.executeTool(step.toolName, step.arguments),
            timeoutPromise,
          ]);
        } catch (e) {
          status =
            e instanceof Error && e.message === 'Tool execution timeout'
              ? 'timeout'
              : 'failed';
          stepError = e instanceof Error ? e.message : String(e);
        }

        const endTime = Date.now();
        const duration = endTime - startTime;

        // 记录重试结果
        this.toolMemory.addRecord({
          toolCallId: `${step.id}_retry_${retryCount + 1}`,
          toolName: step.toolName,
          arguments: step.arguments,
          result,
          status,
          iteration: this.iteration,
          executionTime: duration,
          retryCount: retryCount + 1,
        });

        this.workingMemory.addToolMessage(
          result || stepError || '',
          `${step.id}_retry_${retryCount + 1}`,
          step.toolName
        );

        this.metrics.recordToolExecution(
          step.toolName,
          status === 'success',
          duration
        );

        if (status === 'success') {
          this.log(`[ACT] 步骤 ${step.id} 重试成功`);
          this.deduplicationEngine.onToolSuccess(step.toolName);
        } else {
          this.log(`[ACT] 步骤 ${step.id} 重试失败: ${stepError}`);
          this.deduplicationEngine.onToolFailure(step.toolName);
        }
      }
    }
  }

  private executeEvaluate(): EvaluationScore {
    this.log(`[EVALUATE] 评估阶段 (迭代 ${this.iteration})`);

    const phaseStartTime = Date.now();

    const toolResults = this.collectToolResults();
    const currentSnapshot = this.collectStateSnapshot();

    const context = {
      currentPlan: this.currentPlan,
      toolResults,
      toolMemory: this.toolMemory.getRecords(),
      stateSnapshot: currentSnapshot,
      iteration: this.iteration,
      maxIterations: this.config.maxIterations,
      metrics: this.metrics.getMetrics(),
    };

    const result = this.evaluator.evaluate(context);

    const phaseDuration = Date.now() - phaseStartTime;
    this.log(
      `[EVALUATE] 评估完成，耗时 ${phaseDuration}ms，综合评分: ${(result.overall * 100).toFixed(1)}%`
    );
    this.metrics.recordPhaseTiming('EVALUATE', phaseDuration);

    return result;
  }

  private async executeReflect(): Promise<ReflectionResult> {
    this.log(`[REFLECT] 反思阶段 (迭代 ${this.iteration})`);

    const phaseStartTime = Date.now();

    const toolResults = this.collectToolResults();
    const context = {
      currentPlan: this.currentPlan,
      toolResults,
      iteration: this.iteration,
      maxIterations: this.config.maxIterations,
      toolMemory: this.toolMemory.getRecords(),
      remainingRetryBudget: this.config.maxRetryPerTool,
    };

    const result = await this.reflector.reflect(context);

    // 根据评估结果增强反思结果
    if (this.lastEvaluationScore) {
      result.detailedReasoning = {
        ...result.detailedReasoning,
        successRate:
          this.lastEvaluationScore.details.successCount /
          Math.max(1, this.lastEvaluationScore.details.totalCount),
        informationGrowth: this.lastEvaluationScore.details.informationGrowth,
        confidenceScore: this.lastEvaluationScore.confidence,
        iterationCount: this.iteration,
        retryBudgetRemaining: this.config.maxRetryPerTool,
      };

      // 根据评估结果生成失败反思或成功反思
      if (this.lastEvaluationScore.overall < 0.5) {
        result.failure_reflection = {
          failure_type: this.determineFailureType(toolResults),
          root_cause: this.determineRootCause(toolResults),
          impact_scope:
            toolResults.filter((r) => r.status !== 'success').length > 1
              ? 'multiple_steps'
              : 'single_step',
          is_recoverable: this.lastEvaluationScore.accuracy > 0.3,
          improvement_suggestions: this.lastEvaluationScore.suggestions,
          related_tools: toolResults
            .filter((r) => r.status !== 'success')
            .map((r) => r.toolName),
        };
      } else if (this.lastEvaluationScore.overall >= 0.8) {
        result.success_reflection = {
          success_factors: this.identifySuccessFactors(toolResults),
          key_steps: toolResults
            .filter((r) => r.status === 'success')
            .map((r) => r.toolName),
          performance_metrics: {
            execution_time: this.lastEvaluationScore.details.avgExecutionTime,
            success_rate: this.lastEvaluationScore.accuracy,
            information_gain:
              this.lastEvaluationScore.details.informationGrowth,
          },
        };
      }
    }

    const phaseDuration = Date.now() - phaseStartTime;
    this.log(
      `[REFLECT] 反思完成，耗时 ${phaseDuration}ms，决策: ${result.decision}`
    );
    this.metrics.recordPhaseTiming('REFLECT', phaseDuration);

    return result;
  }

  private determineFailureType(
    toolResults: Array<{ status: string; error?: string }>
  ): 'tool_error' | 'bad_plan' | 'missing_info' | 'timeout' | 'unknown' {
    const failures = toolResults.filter((r) => r.status !== 'success');
    if (failures.length === 0) return 'unknown';

    const hasTimeout = failures.some((r) => r.status === 'timeout');
    if (hasTimeout) return 'timeout';

    const hasParameterError = failures.some(
      (r) => r.error?.includes('parameter') || r.error?.includes('validation')
    );
    if (hasParameterError) return 'bad_plan';

    const hasNetworkError = failures.some(
      (r) => r.error?.includes('network') || r.error?.includes('connection')
    );
    if (hasNetworkError) return 'tool_error';

    return 'unknown';
  }

  private determineRootCause(
    toolResults: Array<{ status: string; error?: string }>
  ): string {
    const failures = toolResults.filter((r) => r.status !== 'success');
    if (failures.length === 0) return '无失败';

    const errors = failures.map((r) => r.error).filter(Boolean);
    if (errors.length === 0) return '未知错误';

    return errors.join('; ');
  }

  private identifySuccessFactors(
    toolResults: Array<{ status: string; toolName: string }>
  ): string[] {
    const factors: string[] = [];
    const successCount = toolResults.filter(
      (r) => r.status === 'success'
    ).length;
    const totalCount = toolResults.length;

    if (successCount === totalCount) {
      factors.push('所有工具执行成功');
    }

    if (successCount > 0) {
      const successTools = toolResults
        .filter((r) => r.status === 'success')
        .map((r) => r.toolName);
      factors.push(`成功工具: ${successTools.join(', ')}`);
    }

    return factors;
  }

  private collectToolResults(): Array<{
    toolName: string;
    status: string;
    result?: string;
    error?: string;
    executionTime?: number;
  }> {
    const results: Array<{
      toolName: string;
      status: string;
      result?: string;
      error?: string;
      executionTime?: number;
    }> = [];
    for (const waveResult of this.lastWaveResults) {
      for (const stepResult of waveResult.stepResults) {
        results.push({
          toolName: stepResult.toolName,
          status: stepResult.status,
          result: stepResult.result,
          error: stepResult.error,
          executionTime: stepResult.duration,
        });
      }
    }
    return results;
  }

  private async checkAndGenerateSummary(): Promise<void> {
    const shouldTriggerByRound =
      this.iteration > 0 &&
      this.iteration % this.config.summaryTriggerRound === 0;

    const tokenEstimate = this.workingMemory.estimateTokens();
    const shouldTriggerByToken =
      tokenEstimate > this.config.summaryTriggerTokens;

    if (shouldTriggerByRound || shouldTriggerByToken) {
      this.log(
        `[SUMMARY] 触发摘要生成 (轮数: ${shouldTriggerByRound}, Token: ${tokenEstimate}/${this.config.summaryTriggerTokens})`
      );

      const messagesToSummarize = this.workingMemory.getRecentMessages(
        this.config.maxWorkingMemorySize
      );

      try {
        const summaryText =
          await this.deps.generateSummary(messagesToSummarize);

        const lastSummary = this.summaryMemory.getLatestSummary();
        const fromTime = lastSummary
          ? lastSummary.timeRange.to
          : Date.now() - 60000;

        this.summaryMemory.addSummary({
          timeRange: {
            from: fromTime,
            to: Date.now(),
          },
          messageCount: messagesToSummarize.length,
          summary: summaryText,
          iteration: this.iteration,
        });

        this.workingMemory.clear();

        this.log(
          `[SUMMARY] 摘要生成完成，已添加到摘要记忆 (${summaryText.length} 字符)`
        );
      } catch (error) {
        console.error(`[SUMMARY] 摘要生成失败:`, error);
      }
    }
  }

  private buildPlanningContext(userPrompt: string): PlanningContext {
    return {
      userPrompt,
      workingMemory: this.workingMemory.getMessages(),
      toolMemory: this.toolMemory.getRecords(),
      summaryMemory: this.summaryMemory.getSummaries(),
      iterationCount: this.iteration,
      availableTools: this.deps.tools,
      remainingIterations: this.config.maxIterations - this.iteration,
      deduplicationInfo: this.deduplicationEngine.getDeduplicationState(),
    };
  }

  private async retrieveMemories(query: string): Promise<string> {
    if (!this.deps.longTermMemoryReader) {
      return '';
    }
    try {
      const results = await this.deps.longTermMemoryReader.search(query, 3);
      if (results.length === 0) {
        return '';
      }
      return this.deps.longTermMemoryReader.formatMemoriesForPrompt(results);
    } catch (error) {
      console.error('[Memory] 检索记忆失败:', error);
      return '';
    }
  }

  private async buildPlannerPrompt(context: PlanningContext): Promise<string> {
    const contextStr = JSON.stringify(context, null, 2);

    const memoryQuery = `${context.userPrompt} 用户偏好 名字 称呼`;
    const memoryContext = await this.retrieveMemories(memoryQuery);

    return `你是规划助手。根据以下上下文，制定执行计划。
${memoryContext ? `\n${memoryContext}\n` : ''}
上下文:
${contextStr}

重要规则：
1. 只返回JSON格式的计划，不要包含任何思考过程、推理步骤或分析说明
2. 不要回复"任务完成"、"处理完成"等元信息
3. 如果无法制定计划，返回空步骤数组
4. 只输出纯JSON，不要添加任何其他文字

请返回纯JSON格式：
{
  "steps": [{"id": "step1", "toolName": "toolName", "arguments": {}, "dependsOn": [], "confidence": 0.9}],
  "overallConfidence": 0.9,
  "isFinalAnswer": false
}`;
  }

  private async buildFinalAnswerPrompt(
    context: PlanningContext
  ): Promise<string> {
    const toolResults = this.collectToolResults();
    const successfulResults = toolResults
      .filter((r) => r.status === 'success' && r.result)
      .map((r) => r.result)
      .join('\n');

    const failedResults = toolResults
      .filter((r) => r.status !== 'success')
      .map((r) => `【${r.toolName}】: ${r.error || '执行失败'}`)
      .join('\n');

    const memoryQuery = `${context.userPrompt} 用户偏好 名字 称呼 个性化`;
    const memoryContext = await this.retrieveMemories(memoryQuery);

    const allMemoryContext = [this.deps.userInfoContext, memoryContext]
      .filter(Boolean)
      .join('\n\n');

    return `你是一个友好的AI助手。请根据以下信息直接回答用户的问题。

重要规则：
1. 只回复与用户问题直接相关的内容，不要添加无关信息
2. 尽力回答用户的问题，即使没有完整信息也要提供有帮助的回应
3. 如果确实无法回答，可以说明原因或提供替代建议，但不要简单说"我不清楚"
4. 不要伪造或虚构任何信息
5. 绝对不要回复"任务完成"、"处理完成"、"已完成"等元信息
6. 不要解释你的思考过程或推理步骤
7. 保持回答简洁、直接、有帮助

${allMemoryContext ? `\n用户相关信息:\n${allMemoryContext}\n` : ''}
用户问题: ${context.userPrompt}

${successfulResults ? `相关参考信息:\n${successfulResults}\n` : ''}
${failedResults ? `注意：部分信息获取失败:\n${failedResults}\n` : ''}

请直接回答用户的问题，只输出与问题相关的答案：`;
  }

  private parsePlanResponse(content: string): Plan {
    try {
      const parsed = JSON.parse(content) as {
        steps?: Array<{
          id: string;
          toolName: string;
          arguments: Record<string, unknown>;
          dependsOn: string[];
          confidence: number;
          reasoning?: string;
        }>;
        overallConfidence?: number;
        reasoning?: string;
        isFinalAnswer?: boolean;
      };
      return {
        steps: parsed.steps || [],
        overallConfidence: parsed.overallConfidence || 0.5,
        reasoning: parsed.reasoning,
        isFinalAnswer: parsed.isFinalAnswer || false,
      };
    } catch {
      return {
        steps: [],
        overallConfidence: 0,
        reasoning: '解析失败',
        isFinalAnswer: true,
      };
    }
  }

  getPhase(): ExecutionPhase {
    return this.phase;
  }

  getIteration(): number {
    return this.iteration;
  }

  getWorkingMemory(): ConversationHistory {
    return this.workingMemory;
  }

  getToolMemory(): ToolMemory {
    return this.toolMemory;
  }

  getSummaryMemory(): SummaryMemory {
    return this.summaryMemory;
  }

  getDeduplicationEngine(): DeduplicationEngine {
    return this.deduplicationEngine;
  }
}
