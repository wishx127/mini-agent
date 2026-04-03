import {
  ReflectionResult,
  ReflectionDecision,
  ReflectionReasoning,
  ToolFailureAnalysis,
  ErrorAttribution,
  Plan,
  ToolRecord,
} from './types.js';

export interface ReflectorConfig {
  strategy: 'conservative' | 'balanced' | 'aggressive';
  timeoutMs: number;
  similarityThreshold: number;
  maxRetryPerTool: number;
  /** 是否输出详细日志 */
  verbose?: boolean;
}

export interface ReflectionContext {
  currentPlan: Plan | null;
  toolResults: Array<{
    toolName: string;
    status: string;
    result?: string;
    error?: string;
    executionTime?: number;
    executeOnce?: boolean;
  }>;
  iteration: number;
  maxIterations: number;
  toolMemory: ToolRecord[];
  remainingRetryBudget: number;
}

export const DEFAULT_REFLECTOR_CONFIG: ReflectorConfig = {
  strategy: 'balanced',
  timeoutMs: 100,
  similarityThreshold: 0.7,
  maxRetryPerTool: 3,
  verbose: false,
};

export class Reflector {
  private config: ReflectorConfig;

  constructor(config: Partial<ReflectorConfig> = {}) {
    this.config = { ...DEFAULT_REFLECTOR_CONFIG, ...config };
  }

  async reflect(context: ReflectionContext): Promise<ReflectionResult> {
    const startTime = Date.now();
    const timeoutPromise = new Promise<ReflectionResult>((resolve) =>
      setTimeout(
        () => resolve(this.createTimeoutResult()),
        this.config.timeoutMs
      )
    );

    const reflectionPromise = this.performReflection(context);
    const result = await Promise.race([reflectionPromise, timeoutPromise]);

    const duration = Date.now() - startTime;
    this.logReflection(context, result, duration);

    return result;
  }

  private createTimeoutResult(): ReflectionResult {
    return {
      decision: 'finalize_answer',
      reasoning: '反思超时，使用默认保守决策',
      confidence: 0.3,
      informationGrowth: 0,
    };
  }

  private async performReflection(
    context: ReflectionContext
  ): Promise<ReflectionResult> {
    await Promise.resolve();

    const toolResults = context.toolResults;
    const successCount = toolResults.filter(
      (r) => r.status === 'success'
    ).length;
    const failureCount = toolResults.length - successCount;
    const successRate =
      toolResults.length > 0 ? successCount / toolResults.length : 0;

    const toolFailures = this.analyzeToolFailures(toolResults);
    const informationGrowth = this.evaluateInformationGrowth(
      toolResults,
      context.toolMemory
    );
    const errorAttribution = this.determineErrorAttribution(toolFailures);
    const plannerConfidence = context.currentPlan?.overallConfidence ?? 0.5;

    const reasoning: ReflectionReasoning = {
      successRate,
      informationGrowth,
      confidenceScore: plannerConfidence,
      iterationCount: context.iteration,
      retryBudgetRemaining: context.remainingRetryBudget,
      toolFailures,
    };

    const decision = this.makeDecision({
      successRate,
      failureCount,
      informationGrowth,
      plannerConfidence,
      errorAttribution,
      toolFailures,
      reasoning,
      context,
    });

    return {
      decision,
      reasoning: this.generateReasoningText(decision, reasoning),
      confidence: plannerConfidence,
      informationGrowth,
      errorAttribution,
      detailedReasoning: reasoning,
      shouldRetryTools:
        decision === 'retry'
          ? toolFailures.filter((f) => f.isRecoverable).map((f) => f.toolName)
          : undefined,
    };
  }

  private analyzeToolFailures(
    toolResults: Array<{
      toolName: string;
      status: string;
      error?: string;
    }>
  ): ToolFailureAnalysis[] {
    const failures: ToolFailureAnalysis[] = [];

    for (const tool of toolResults) {
      if (tool.status !== 'success') {
        const errorType = this.classifyError(tool.error, tool.status);
        const isRecoverable = this.isErrorRecoverable(errorType);
        const suggestedAction = this.suggestActionForError(
          errorType,
          isRecoverable
        );

        failures.push({
          toolName: tool.toolName,
          errorType,
          errorMessage: tool.error || `Status: ${tool.status}`,
          isRecoverable,
          suggestedAction,
        });
      }
    }

    return failures;
  }

  private classifyError(
    error?: string,
    status?: string
  ): ToolFailureAnalysis['errorType'] {
    if (status === 'timeout') return 'timeout';

    if (!error) return 'unknown';

    const errorLower = error.toLowerCase();

    if (
      errorLower.includes('timeout') ||
      errorLower.includes('connection') ||
      errorLower.includes('network')
    ) {
      return 'network_error';
    }

    if (
      errorLower.includes('invalid') ||
      errorLower.includes('parameter') ||
      errorLower.includes('argument')
    ) {
      return 'parameter_error';
    }

    if (errorLower.includes('rate limit') || errorLower.includes('too many')) {
      return 'rate_limit';
    }

    return 'unknown';
  }

  private isErrorRecoverable(
    errorType: ToolFailureAnalysis['errorType']
  ): boolean {
    return (
      errorType === 'network_error' ||
      errorType === 'timeout' ||
      errorType === 'rate_limit'
    );
  }

  private suggestActionForError(
    errorType: ToolFailureAnalysis['errorType'],
    isRecoverable: boolean
  ): ToolFailureAnalysis['suggestedAction'] {
    if (!isRecoverable) return 'fallback';

    if (errorType === 'parameter_error') return 'new_plan';
    if (errorType === 'network_error' || errorType === 'timeout')
      return 'retry';
    if (errorType === 'rate_limit') return 'new_plan';

    return 'retry';
  }

  private evaluateInformationGrowth(
    toolResults: Array<{ result?: string; status: string }>,
    toolMemory: ToolRecord[]
  ): number {
    if (toolResults.length === 0) return 0;

    const successfulResults = toolResults
      .filter((r) => r.status === 'success' && r.result)
      .map((r) => r.result!);

    if (successfulResults.length === 0) return 0;

    if (toolMemory.length === 0) {
      return 1;
    }

    let totalSimilarity = 0;
    let comparisonCount = 0;

    for (const newResult of successfulResults) {
      for (const oldRecord of toolMemory) {
        if (oldRecord.result) {
          const similarity = this.calculateSimilarity(
            newResult,
            oldRecord.result
          );
          totalSimilarity += similarity;
          comparisonCount++;
        }
      }
    }

    const avgSimilarity =
      comparisonCount > 0 ? totalSimilarity / comparisonCount : 0;
    const informationGrowth = Math.max(0, 1 - avgSimilarity);

    return Math.round(informationGrowth * 100) / 100;
  }

  private calculateSimilarity(text1: string, text2: string): number {
    // 优化：对于短文本使用字符级比较，对于长文本使用单词级比较
    if (text1.length < 100 || text2.length < 100) {
      // 短文本使用字符级 Jaccard 相似度
      const chars1 = new Set(text1.toLowerCase());
      const chars2 = new Set(text2.toLowerCase());

      if (chars1.size === 0 || chars2.size === 0) return 0;

      const intersection = new Set([...chars1].filter((x) => chars2.has(x)));
      const union = new Set([...chars1, ...chars2]);

      return union.size > 0 ? intersection.size / union.size : 0;
    }

    // 长文本使用单词级 Jaccard 相似度
    const words1 = new Set(
      text1
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 0)
    );
    const words2 = new Set(
      text2
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 0)
    );

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private determineErrorAttribution(
    failures: ToolFailureAnalysis[]
  ): ErrorAttribution {
    if (failures.length === 0) return 'none';

    const hasParameterErrors = failures.some(
      (f) => f.errorType === 'parameter_error'
    );
    const hasNetworkErrors = failures.some(
      (f) => f.errorType === 'network_error' || f.errorType === 'timeout'
    );
    const hasRateLimit = failures.some((f) => f.errorType === 'rate_limit');

    if (hasParameterErrors) return 'planner';
    if (hasNetworkErrors || hasRateLimit) return 'tool';
    if (failures.length === 1 && failures[0].errorType === 'unknown')
      return 'system';

    return 'tool';
  }

  private makeDecision(params: {
    successRate: number;
    failureCount: number;
    informationGrowth: number;
    plannerConfidence: number;
    errorAttribution: ErrorAttribution;
    toolFailures: ToolFailureAnalysis[];
    reasoning: ReflectionReasoning;
    context: ReflectionContext;
  }): ReflectionDecision {
    const {
      successRate,
      failureCount,
      informationGrowth,
      plannerConfidence,
      errorAttribution,
      toolFailures,
      context,
    } = params;

    // 检查是否有一次性工具成功执行
    const hasSuccessfulOneOffTool = context.toolResults.some(
      (r) => r.status === 'success' && r.executeOnce === true
    );
    if (hasSuccessfulOneOffTool) {
      // 一次性工具成功执行后应立即结束
      return 'finalize_answer';
    }

    // 根据策略调整决策阈值
    const strategyMultipliers = this.getStrategyMultipliers();

    if (failureCount === 0) {
      // 如果信息增长为 0 或负数，说明没有获得新信息，应该结束
      if (informationGrowth <= 0) {
        return 'finalize_answer';
      }
      // 如果信息增长足够大，继续执行
      if (informationGrowth > 0.5 * strategyMultipliers.continueThreshold) {
        return 'continue';
      }
      // 如果接近最大迭代次数，结束
      if (context.iteration >= context.maxIterations - 1) {
        return 'finalize_answer';
      }
      // 信息增长较小但为正数，继续执行
      return 'continue';
    }

    if (failureCount > 0 && successRate === 0) {
      const recoverableCount = toolFailures.filter(
        (f) => f.isRecoverable
      ).length;
      if (
        recoverableCount > 0 &&
        plannerConfidence >= 0.8 * strategyMultipliers.retryConfidenceThreshold
      ) {
        if (errorAttribution === 'planner') {
          return 'new_plan';
        }
        return 'retry';
      }
      if (
        plannerConfidence <
        0.6 * strategyMultipliers.fallbackConfidenceThreshold
      ) {
        return 'fallback';
      }
      if (errorAttribution === 'planner') {
        return 'new_plan';
      }
      return 'new_plan';
    }

    if (failureCount > 0 && successRate > 0) {
      const hasRecoverable = toolFailures.some((f) => f.isRecoverable);
      if (
        hasRecoverable &&
        plannerConfidence >= 0.7 * strategyMultipliers.retryConfidenceThreshold
      ) {
        if (errorAttribution === 'planner') {
          return 'new_plan';
        }
        return 'retry';
      }
      return 'new_plan';
    }

    return 'continue';
  }

  private getStrategyMultipliers(): {
    continueThreshold: number;
    retryConfidenceThreshold: number;
    fallbackConfidenceThreshold: number;
  } {
    switch (this.config.strategy) {
      case 'conservative':
        return {
          continueThreshold: 1.5,
          retryConfidenceThreshold: 1.2,
          fallbackConfidenceThreshold: 0.8,
        };
      case 'aggressive':
        return {
          continueThreshold: 0.7,
          retryConfidenceThreshold: 0.8,
          fallbackConfidenceThreshold: 1.2,
        };
      case 'balanced':
      default:
        return {
          continueThreshold: 1.0,
          retryConfidenceThreshold: 1.0,
          fallbackConfidenceThreshold: 1.0,
        };
    }
  }

  private generateReasoningText(
    decision: ReflectionDecision,
    reasoning: ReflectionReasoning
  ): string {
    const parts: string[] = [];

    parts.push(`成功率: ${(reasoning.successRate * 100).toFixed(0)}%`);
    parts.push(`信息增长: ${(reasoning.informationGrowth * 100).toFixed(0)}%`);
    parts.push(`置信度: ${(reasoning.confidenceScore * 100).toFixed(0)}%`);
    parts.push(`迭代: ${reasoning.iterationCount}`);

    if (reasoning.toolFailures && reasoning.toolFailures.length > 0) {
      const failedTools = reasoning.toolFailures
        .map((f) => f.toolName)
        .join(', ');
      parts.push(`失败工具: ${failedTools}`);
    }

    switch (decision) {
      case 'continue':
        return `决策: 继续执行 - ${parts.join(', ')}`;
      case 'retry':
        return `决策: 重试 - ${parts.join(', ')}`;
      case 'finalize_answer':
        return `决策: 生成最终答案 - ${parts.join(', ')}`;
      case 'fallback':
        return `决策: 降级处理 - ${parts.join(', ')}`;
      default:
        return parts.join(', ');
    }
  }

  private logReflection(
    context: ReflectionContext,
    result: ReflectionResult,
    duration: number
  ): void {
    // 只在 verbose 模式下输出详细日志
    if (!this.config.verbose) {
      return;
    }

    console.log(`[REFLECT] 反思完成 (迭代 ${context.iteration})`);
    console.log(`[REFLECT] 决策: ${result.decision}`);
    console.log(`[REFLECT] 耗时: ${duration}ms`);
    console.log(
      `[REFLECT] 成功率: ${(result.detailedReasoning?.successRate ?? 0) * 100}%`
    );
    console.log(
      `[REFLECT] 信息增长: ${(result.informationGrowth ?? 0) * 100}%`
    );
    console.log(`[REFLECT] 置信度: ${(result.confidence ?? 0) * 100}%`);

    if (result.shouldRetryTools && result.shouldRetryTools.length > 0) {
      console.log(
        `[REFLECT] 建议重试工具: ${result.shouldRetryTools.join(', ')}`
      );
    }

    if (result.detailedReasoning?.toolFailures) {
      for (const failure of result.detailedReasoning.toolFailures) {
        console.log(
          `[REFLECT] 工具失败: ${failure.toolName} - ${failure.errorType} - ${failure.errorMessage}`
        );
      }
    }
  }

  updateConfig(newConfig: Partial<ReflectorConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): ReflectorConfig {
    return { ...this.config };
  }
}
