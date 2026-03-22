import { StateSnapshot, StateDigest } from './types.js';

export interface StateDigestConfig {
  enableLLMGeneration: boolean;
  maxHighlights: number;
  maxWarnings: number;
  warningThresholds: {
    highFailureRate: number;
    lowProgressRate: number;
    highTokenUsage: number;
  };
}

export const DEFAULT_STATE_DIGEST_CONFIG: StateDigestConfig = {
  enableLLMGeneration: false,
  maxHighlights: 5,
  maxWarnings: 3,
  warningThresholds: {
    highFailureRate: 0.5,
    lowProgressRate: 0.1,
    highTokenUsage: 0.8,
  },
};

export class StateDigestGenerator {
  private config: StateDigestConfig;

  constructor(config: Partial<StateDigestConfig> = {}) {
    this.config = { ...DEFAULT_STATE_DIGEST_CONFIG, ...config };
  }

  /**
   * 基于启发式规则生成状态摘要
   */
  generateHeuristicDigest(
    snapshot: StateSnapshot,
    previousSnapshot?: StateSnapshot | null
  ): StateDigest {
    const highlights: string[] = [];
    const warnings: string[] = [];

    // 计算关键指标
    const successRate = this.calculateSuccessRate(snapshot);
    const progressRate = this.calculateProgressRate(snapshot);
    const informationGrowth = this.calculateInformationGrowth(
      snapshot,
      previousSnapshot
    );

    // 生成亮点
    if (successRate > 0.8) {
      highlights.push(`工具成功率高: ${(successRate * 100).toFixed(0)}%`);
    }
    if (progressRate > 0.5) {
      highlights.push(`执行进度良好: ${(progressRate * 100).toFixed(0)}%`);
    }
    if (snapshot.recentToolRecords.length > 0) {
      const recentSuccess = snapshot.recentToolRecords.filter(
        (r) => r.status === 'success'
      ).length;
      if (recentSuccess === snapshot.recentToolRecords.length) {
        highlights.push('最近工具调用全部成功');
      }
    }

    // 生成警告
    if (successRate < this.config.warningThresholds.highFailureRate) {
      warnings.push(`工具失败率较高: ${((1 - successRate) * 100).toFixed(0)}%`);
    }
    if (
      progressRate < this.config.warningThresholds.lowProgressRate &&
      snapshot.iteration > 1
    ) {
      warnings.push(`执行进度缓慢: ${(progressRate * 100).toFixed(0)}%`);
    }
    if (
      snapshot.workingMemoryTokens >
      snapshot.workingMemorySize *
        1000 *
        this.config.warningThresholds.highTokenUsage
    ) {
      warnings.push('Token 使用量接近上限');
    }
    if (snapshot.failureStats.recentFailures > 2) {
      warnings.push(
        `近期失败次数较多: ${snapshot.failureStats.recentFailures} 次`
      );
    }

    // 生成摘要文本
    const summary = this.generateSummaryText(
      snapshot,
      successRate,
      progressRate,
      highlights,
      warnings
    );

    return {
      summary,
      keyMetrics: {
        progressRate,
        successRate,
        informationGrowth,
      },
      highlights: highlights.slice(0, this.config.maxHighlights),
      warnings: warnings.slice(0, this.config.maxWarnings),
      timestamp: Date.now(),
      iteration: snapshot.iteration,
    };
  }

  /**
   * 计算工具成功率
   */
  private calculateSuccessRate(snapshot: StateSnapshot): number {
    const totalCalls =
      snapshot.failureStats.totalFailures +
      snapshot.recentToolRecords.filter((r) => r.status === 'success').length;
    if (totalCalls === 0) return 1.0;

    const successCalls = snapshot.recentToolRecords.filter(
      (r) => r.status === 'success'
    ).length;
    return successCalls / Math.max(snapshot.recentToolRecords.length, 1);
  }

  /**
   * 计算执行进度率
   */
  private calculateProgressRate(snapshot: StateSnapshot): number {
    const { totalSteps, completedSteps } = snapshot.currentPlanProgress;
    if (totalSteps === 0) return 0;
    return completedSteps / totalSteps;
  }

  /**
   * 计算信息增长率
   */
  private calculateInformationGrowth(
    snapshot: StateSnapshot,
    previousSnapshot?: StateSnapshot | null
  ): number {
    if (!previousSnapshot) return 1.0;

    const currentToolCount = snapshot.recentToolRecords.length;

    if (currentToolCount === 0) return 0;

    // 基于新工具使用和成功结果计算信息增长
    const newToolsUsed = new Set(
      snapshot.recentToolRecords.map((r) => r.toolName)
    );
    const oldToolsUsed = new Set(
      previousSnapshot.recentToolRecords.map((r) => r.toolName)
    );
    const newToolCount = [...newToolsUsed].filter(
      (t) => !oldToolsUsed.has(t)
    ).length;

    const growthFromNewTools = Math.min(newToolCount * 0.2, 0.6);
    const growthFromProgress =
      snapshot.currentPlanProgress.completedSteps >
      previousSnapshot.currentPlanProgress.completedSteps
        ? 0.4
        : 0;

    return Math.min(growthFromNewTools + growthFromProgress, 1.0);
  }

  /**
   * 生成摘要文本
   */
  private generateSummaryText(
    snapshot: StateSnapshot,
    successRate: number,
    progressRate: number,
    highlights: string[],
    warnings: string[]
  ): string {
    const parts: string[] = [];

    parts.push(`迭代 ${snapshot.iteration}: `);

    // 进度描述
    const { totalSteps, completedSteps } = snapshot.currentPlanProgress;
    if (totalSteps > 0) {
      parts.push(
        `进度 ${completedSteps}/${totalSteps} (${(progressRate * 100).toFixed(0)}%)`
      );
    } else {
      parts.push('尚未开始执行');
    }

    // 成功率描述
    if (snapshot.recentToolRecords.length > 0) {
      parts.push(`，成功率 ${(successRate * 100).toFixed(0)}%`);
    }

    // 状态描述
    if (warnings.length > 0) {
      parts.push('，存在警告');
    } else if (highlights.length > 0) {
      parts.push('，状态良好');
    }

    return parts.join('');
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<StateDigestConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取当前配置
   */
  getConfig(): StateDigestConfig {
    return { ...this.config };
  }
}
