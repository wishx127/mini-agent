import type { ChatOpenAI } from '@langchain/openai';

import type { MemorySearchResult } from '../../types/memory.js';

import {
  ExecutionPhase,
  ExecutionConfig,
  DEFAULT_EXECUTION_CONFIG,
  PlanningContext,
  Plan,
  ReflectionResult,
  ExecutionMetrics,
  Message,
  ToolInfo,
  WaveExecutionResult,
  TerminationChecker,
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
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }

  async run(userPrompt: string): Promise<{
    finalAnswer: string;
    metrics: ExecutionMetrics;
  }> {
    let finalAnswer = '';

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
          finalAnswer = plan.reasoning || '任务完成';
          this.metrics.recordPhaseTiming('PLAN', Date.now() - phaseStartTime);
          return {
            finalAnswer,
            metrics: this.metrics.finalize('planner_final'),
          };
        }
        this.phase = 'ACT';
      } else if (this.phase === 'ACT') {
        await this.executeAct();
        this.phase = 'REFLECT';
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
            finalAnswer: content || '任务完成',
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
          await this.executeAct(reflection.shouldRetryTools);
          this.phase = 'REFLECT';
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

  private async executeObserve(userPrompt: string): Promise<void> {
    await Promise.resolve();
    if (this.iteration === 0) {
      this.workingMemory.addUserMessage(userPrompt);
    }
  }

  private async executePlan(userPrompt: string): Promise<Plan> {
    const context = this.buildPlanningContext(userPrompt);
    const prompt = await this.buildPlannerPrompt(context);
    const response = await this.deps.llm.invoke(prompt);
    const content = this.extractContent(response);
    const plan = this.parsePlanResponse(content);
    this.currentPlan = plan;
    return plan;
  }

  private extractContent(response: unknown): string {
    if (typeof response === 'string') {
      return response;
    }
    if (response && typeof response === 'object' && 'content' in response) {
      const content = (response as { content: unknown }).content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content
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
    return '';
  }

  private async executeAct(toolsToRetry?: string[]): Promise<void> {
    if (!this.currentPlan || this.currentPlan.steps.length === 0) {
      this.log(`[ACT] 没有计划步骤可执行 (迭代 ${this.iteration})`);
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

    const config = {
      toolTimeout: this.config.toolTimeout,
      maxConcurrentTools:
        (this.config as unknown as { maxConcurrentTools?: number })
          .maxConcurrentTools || 5,
      waveTimeout:
        (this.config as unknown as { waveTimeout?: number }).waveTimeout ||
        60000,
    };

    const waveResults = await executeAllWaves(
      waves,
      this.deps.executeTool,
      config
    );

    this.lastWaveResults = waveResults;

    for (const waveResult of waveResults) {
      this.log(
        `[ACT] 波次 ${waveResult.waveIndex}: ${waveResult.successCount} 成功, ${waveResult.failureCount} 失败, 耗时 ${waveResult.waveDuration}ms`
      );

      for (const stepResult of waveResult.stepResults) {
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
      }
    }
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

    const phaseDuration = Date.now() - phaseStartTime;
    this.log(
      `[REFLECT] 反思完成，耗时 ${phaseDuration}ms，决策: ${result.decision}`
    );
    this.metrics.recordPhaseTiming('REFLECT', phaseDuration);

    return result;
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
    const memoryContext = await this.retrieveMemories(context.userPrompt);

    return `你是规划助手。根据以下上下文，制定执行计划。
${memoryContext ? `\n${memoryContext}\n` : ''}
上下文:
${contextStr}

请返回 JSON 格式的计划:
{
  "steps": [{"id": "step1", "toolName": "toolName", "arguments": {}, "dependsOn": [], "confidence": 0.9, "reasoning": "..."}],
  "overallConfidence": 0.9,
  "reasoning": "...",
  "isFinalAnswer": false
}`;
  }

  private async buildFinalAnswerPrompt(
    context: PlanningContext
  ): Promise<string> {
    const toolResults = this.collectToolResults();
    const successfulResults = toolResults
      .filter((r) => r.status === 'success' && r.result)
      .map((r) => `【${r.toolName}】: ${r.result}`)
      .join('\n\n');

    const failedResults = toolResults
      .filter((r) => r.status !== 'success')
      .map((r) => `【${r.toolName}】: ${r.error || '执行失败'}`)
      .join('\n');

    const memoryContext = await this.retrieveMemories(context.userPrompt);

    return `你是助手，需要根据用户的问题和工具执行结果，生成最终答案。
${memoryContext ? `\n${memoryContext}\n` : ''}
用户问题: ${context.userPrompt}

工具执行结果:
${successfulResults || '无成功执行的工具'}

${failedResults ? `失败的工具:\n${failedResults}` : ''}

请基于以上信息，为用户生成一个清晰、完整的最终答案。直接回答用户的问题，不要提及工具执行的细节。`;
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
