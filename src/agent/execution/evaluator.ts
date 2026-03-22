/**
 * 评估器模块 - 第三阶段优化
 * 实现统一结果评估函数，用于EVALUATE阶段
 */

import { Plan, ToolRecord, StateSnapshot, ExecutionMetrics } from './types.js';

/**
 * 评估分数接口
 */
export interface EvaluationScore {
  /** 准确性评估 (0-1) */
  accuracy: number;
  /** 完整性评估 (0-1) */
  completeness: number;
  /** 效率评估 (0-1) */
  efficiency: number;
  /** 置信度评估 (0-1) */
  confidence: number;
  /** 综合评分 (0-1) */
  overall: number;
  /** 评估详情 */
  details: {
    /** 成功步骤数 */
    successCount: number;
    /** 失败步骤数 */
    failureCount: number;
    /** 总步骤数 */
    totalCount: number;
    /** 平均执行时间 (ms) */
    avgExecutionTime: number;
    /** 信息增长评分 */
    informationGrowth: number;
    /** 计划完成度 */
    planCompletion: number;
  };
  /** 评估建议 */
  suggestions: string[];
  /** 评估时间戳 */
  timestamp: number;
  /** 迭代次数 */
  iteration: number;
}

/**
 * 评估上下文接口
 */
export interface EvaluationContext {
  /** 当前计划 */
  currentPlan: Plan | null;
  /** 工具执行结果 */
  toolResults: Array<{
    toolName: string;
    status: string;
    result?: string;
    error?: string;
    executionTime?: number;
  }>;
  /** 工具记忆 */
  toolMemory: ToolRecord[];
  /** 状态快照 */
  stateSnapshot: StateSnapshot;
  /** 迭代次数 */
  iteration: number;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 执行指标 */
  metrics: ExecutionMetrics;
}

/**
 * 评估器配置接口
 */
export interface EvaluatorConfig {
  /** 准确性权重 */
  accuracyWeight: number;
  /** 完整性权重 */
  completenessWeight: number;
  /** 效率权重 */
  efficiencyWeight: number;
  /** 置信度权重 */
  confidenceWeight: number;
  /** 最小成功阈值 */
  minSuccessThreshold: number;
  /** 最大执行时间阈值 (ms) */
  maxExecutionTimeThreshold: number;
  /** 是否启用详细日志 */
  verbose?: boolean;
}

/**
 * 默认评估器配置
 */
export const DEFAULT_EVALUATOR_CONFIG: EvaluatorConfig = {
  accuracyWeight: 0.3,
  completenessWeight: 0.25,
  efficiencyWeight: 0.2,
  confidenceWeight: 0.25,
  minSuccessThreshold: 0.5,
  maxExecutionTimeThreshold: 30000,
  verbose: false,
};

/**
 * 评估器类
 * 实现统一结果评估函数，用于EVALUATE阶段
 */
export class Evaluator {
  private config: EvaluatorConfig;

  constructor(config: Partial<EvaluatorConfig> = {}) {
    this.config = { ...DEFAULT_EVALUATOR_CONFIG, ...config };
  }

  /**
   * 评估执行结果
   * @param context 评估上下文
   * @returns 评估分数
   */
  evaluate(context: EvaluationContext): EvaluationScore {
    const startTime = Date.now();

    // 计算基础指标
    const successCount = context.toolResults.filter(
      (r) => r.status === 'success'
    ).length;
    const failureCount = context.toolResults.filter(
      (r) => r.status !== 'success'
    ).length;
    const totalCount = context.toolResults.length;

    // 计算各个维度的评分
    const accuracy = this.evaluateAccuracy(context);
    const completeness = this.evaluateCompleteness(context);
    const efficiency = this.evaluateEfficiency(context);
    const confidence = this.evaluateConfidence(context);

    // 计算综合评分
    const overall = this.calculateOverallScore(
      accuracy,
      completeness,
      efficiency,
      confidence
    );

    // 计算详细指标
    const avgExecutionTime = this.calculateAvgExecutionTime(
      context.toolResults
    );
    const informationGrowth = this.calculateInformationGrowth(context);
    const planCompletion = this.calculatePlanCompletion(context);

    // 生成评估建议
    const suggestions = this.generateSuggestions({
      accuracy,
      completeness,
      efficiency,
      confidence,
      overall,
      successCount,
      failureCount,
      totalCount,
      avgExecutionTime,
      informationGrowth,
      planCompletion,
    });

    const evaluationScore: EvaluationScore = {
      accuracy,
      completeness,
      efficiency,
      confidence,
      overall,
      details: {
        successCount,
        failureCount,
        totalCount,
        avgExecutionTime,
        informationGrowth,
        planCompletion,
      },
      suggestions,
      timestamp: Date.now(),
      iteration: context.iteration,
    };

    if (this.config.verbose) {
      console.log(
        `[EVALUATE] 评估完成 (迭代 ${context.iteration}), 耗时 ${Date.now() - startTime}ms`
      );
      console.log(
        `[EVALUATE] 综合评分: ${(overall * 100).toFixed(1)}%, ` +
          `准确性: ${(accuracy * 100).toFixed(1)}%, ` +
          `完整性: ${(completeness * 100).toFixed(1)}%, ` +
          `效率: ${(efficiency * 100).toFixed(1)}%, ` +
          `置信度: ${(confidence * 100).toFixed(1)}%`
      );
    }

    return evaluationScore;
  }

  /**
   * 评估准确性
   * 基于成功/失败率和错误类型
   */
  private evaluateAccuracy(context: EvaluationContext): number {
    const { toolResults } = context;

    if (toolResults.length === 0) {
      return 0.5; // 无结果时返回中性分数
    }

    const successCount = toolResults.filter(
      (r) => r.status === 'success'
    ).length;
    const successRate = successCount / toolResults.length;

    // 考虑错误类型的权重
    const criticalErrors = toolResults.filter(
      (r) =>
        r.status === 'failed' &&
        (r.error?.includes('parameter') || r.error?.includes('validation'))
    ).length;

    const recoverableErrors = toolResults.filter(
      (r) =>
        r.status === 'timeout' ||
        (r.status === 'failed' &&
          (r.error?.includes('network') || r.error?.includes('rate limit')))
    ).length;

    // 基础准确性分数
    let accuracy = successRate;

    // 根据错误类型调整
    if (criticalErrors > 0) {
      accuracy *= 0.7; // 关键错误降低准确性
    }
    if (recoverableErrors > 0) {
      accuracy *= 0.9; // 可恢复错误轻微降低准确性
    }

    return Math.max(0, Math.min(1, accuracy));
  }

  /**
   * 评估完整性
   * 基于计划完成度和信息增长
   */
  private evaluateCompleteness(context: EvaluationContext): number {
    const { currentPlan, toolResults } = context;

    // 如果没有计划，视为完成
    if (!currentPlan || currentPlan.steps.length === 0) {
      return 1;
    }

    // 计算计划完成度
    const planCompletion = this.calculatePlanCompletion(context);

    // 计算信息增长
    const informationGrowth = this.calculateInformationGrowth(context);

    // 计算步骤覆盖率
    const stepCoverage = toolResults.length / currentPlan.steps.length;

    // 综合完整性分数
    const completeness =
      planCompletion * 0.4 + informationGrowth * 0.3 + stepCoverage * 0.3;

    return Math.max(0, Math.min(1, completeness));
  }

  /**
   * 评估效率
   * 基于执行时间和资源使用
   */
  private evaluateEfficiency(context: EvaluationContext): number {
    const { toolResults } = context;

    // 计算平均执行时间
    const avgExecutionTime = this.calculateAvgExecutionTime(toolResults);

    // 计算时间效率
    const timeEfficiency =
      avgExecutionTime > 0
        ? Math.max(
            0,
            1 - avgExecutionTime / this.config.maxExecutionTimeThreshold
          )
        : 1;

    // 计算迭代效率
    const iterationEfficiency =
      context.maxIterations > 0
        ? 1 - context.iteration / context.maxIterations
        : 1;

    // 计算成功率效率
    const successRate =
      toolResults.length > 0
        ? toolResults.filter((r) => r.status === 'success').length /
          toolResults.length
        : 0;

    // 综合效率分数
    const efficiency =
      timeEfficiency * 0.4 + iterationEfficiency * 0.3 + successRate * 0.3;

    return Math.max(0, Math.min(1, efficiency));
  }

  /**
   * 评估置信度
   * 基于计划置信度和执行结果
   */
  private evaluateConfidence(context: EvaluationContext): number {
    const { currentPlan, toolResults } = context;

    // 计算计划置信度
    const planConfidence = currentPlan?.overallConfidence ?? 0.5;

    // 计算执行置信度
    const executionConfidence =
      toolResults.length > 0
        ? toolResults.filter((r) => r.status === 'success').length /
          toolResults.length
        : 0.5;

    // 计算结果一致性
    const resultConsistency = this.calculateResultConsistency(toolResults);

    // 综合置信度分数
    const confidence =
      planConfidence * 0.4 +
      executionConfidence * 0.4 +
      resultConsistency * 0.2;

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * 计算综合评分
   */
  private calculateOverallScore(
    accuracy: number,
    completeness: number,
    efficiency: number,
    confidence: number
  ): number {
    const overall =
      accuracy * this.config.accuracyWeight +
      completeness * this.config.completenessWeight +
      efficiency * this.config.efficiencyWeight +
      confidence * this.config.confidenceWeight;

    return Math.max(0, Math.min(1, overall));
  }

  /**
   * 计算平均执行时间
   */
  private calculateAvgExecutionTime(
    toolResults: Array<{ executionTime?: number }>
  ): number {
    const executionTimes = toolResults
      .filter((r) => r.executionTime !== undefined)
      .map((r) => r.executionTime!);

    if (executionTimes.length === 0) {
      return 0;
    }

    return executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;
  }

  /**
   * 计算信息增长
   */
  private calculateInformationGrowth(context: EvaluationContext): number {
    const { toolResults, toolMemory } = context;

    const successfulResults = toolResults
      .filter((r) => r.status === 'success' && r.result)
      .map((r) => r.result!);

    if (successfulResults.length === 0) {
      return 0;
    }

    if (toolMemory.length === 0) {
      return 1; // 首次执行，信息增长最大
    }

    // 计算新结果与历史结果的相似度
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

  /**
   * 计算计划完成度
   */
  private calculatePlanCompletion(context: EvaluationContext): number {
    const { currentPlan, toolResults } = context;

    if (!currentPlan || currentPlan.steps.length === 0) {
      return 1; // 无计划时视为完成
    }

    const completedSteps = toolResults.filter(
      (r) => r.status === 'success'
    ).length;
    const totalSteps = currentPlan.steps.length;

    return Math.min(1, completedSteps / totalSteps);
  }

  /**
   * 计算结果一致性
   */
  private calculateResultConsistency(
    toolResults: Array<{ result?: string; status: string }>
  ): number {
    const successfulResults = toolResults
      .filter((r) => r.status === 'success' && r.result)
      .map((r) => r.result!);

    if (successfulResults.length < 2) {
      return 1; // 结果少于2个时，一致性为1
    }

    // 计算结果之间的平均相似度
    let totalSimilarity = 0;
    let comparisonCount = 0;

    for (let i = 0; i < successfulResults.length; i++) {
      for (let j = i + 1; j < successfulResults.length; j++) {
        const similarity = this.calculateSimilarity(
          successfulResults[i],
          successfulResults[j]
        );
        totalSimilarity += similarity;
        comparisonCount++;
      }
    }

    return comparisonCount > 0 ? totalSimilarity / comparisonCount : 1;
  }

  /**
   * 计算文本相似度
   */
  private calculateSimilarity(text1: string, text2: string): number {
    // 对于短文本使用字符级比较，对于长文本使用单词级比较
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

  /**
   * 生成评估建议
   */
  private generateSuggestions(scores: {
    accuracy: number;
    completeness: number;
    efficiency: number;
    confidence: number;
    overall: number;
    successCount: number;
    failureCount: number;
    totalCount: number;
    avgExecutionTime: number;
    informationGrowth: number;
    planCompletion: number;
  }): string[] {
    const suggestions: string[] = [];

    // 准确性建议
    if (scores.accuracy < 0.5) {
      suggestions.push('准确性较低，建议检查工具参数或重新规划');
    }

    // 完整性建议
    if (scores.completeness < 0.5) {
      suggestions.push('完整性不足，建议继续执行或调整计划');
    }

    // 效率建议
    if (scores.efficiency < 0.5) {
      suggestions.push('效率较低，建议优化工具选择或减少步骤');
    }

    // 置信度建议
    if (scores.confidence < 0.5) {
      suggestions.push('置信度较低，建议收集更多信息或重新评估');
    }

    // 失败率建议
    if (scores.failureCount > 0 && scores.totalCount > 0) {
      const failureRate = scores.failureCount / scores.totalCount;
      if (failureRate > 0.5) {
        suggestions.push('失败率过高，建议重新规划或降级处理');
      }
    }

    // 信息增长建议
    if (scores.informationGrowth < 0.3) {
      suggestions.push('信息增长不足，建议尝试新的工具或方法');
    }

    // 计划完成度建议
    if (scores.planCompletion < 0.5) {
      suggestions.push('计划完成度较低，建议继续执行或调整计划');
    }

    // 综合评分建议
    if (scores.overall >= 0.8) {
      suggestions.push('执行效果良好，可以考虑生成最终答案');
    } else if (scores.overall >= 0.6) {
      suggestions.push('执行效果一般，建议继续优化');
    } else if (scores.overall < 0.4) {
      suggestions.push('执行效果较差，建议重新规划');
    }

    return suggestions;
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<EvaluatorConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取配置
   */
  getConfig(): EvaluatorConfig {
    return { ...this.config };
  }
}

/**
 * 快速评估函数
 * 用于快速评估执行结果
 */
export function evaluateExecution(
  context: EvaluationContext,
  config?: Partial<EvaluatorConfig>
): EvaluationScore {
  const evaluator = new Evaluator(config);
  return evaluator.evaluate(context);
}
