import { StateSnapshot, StateDelta } from './types.js';

export interface DeltaDetectorConfig {
  progressThreshold: number;
  errorThreshold: number;
  skipPlanConditions: {
    maxConsecutiveNoProgress: number;
    maxRecentErrors: number;
    minIterationsBeforeSkip: number;
  };
}

export const DEFAULT_DELTA_DETECTOR_CONFIG: DeltaDetectorConfig = {
  progressThreshold: 0.1,
  errorThreshold: 3,
  skipPlanConditions: {
    maxConsecutiveNoProgress: 2,
    maxRecentErrors: 3,
    minIterationsBeforeSkip: 2,
  },
};

export class DeltaDetector {
  private config: DeltaDetectorConfig;
  private previousSnapshot: StateSnapshot | null = null;
  private consecutiveNoProgressCount: number = 0;

  constructor(config: Partial<DeltaDetectorConfig> = {}) {
    this.config = { ...DEFAULT_DELTA_DETECTOR_CONFIG, ...config };
  }

  /**
   * 检测状态变化
   */
  detectDelta(currentSnapshot: StateSnapshot): StateDelta {
    const timestamp = Date.now();

    // 计算进度变化
    const progressDelta = this.calculateProgressDelta(currentSnapshot);

    // 计算新错误数量
    const newErrors = this.calculateNewErrors(currentSnapshot);

    // 检测是否使用了新工具
    const newToolsUsed = this.detectNewToolsUsed(currentSnapshot);

    // 计算信息增长率
    const informationGrowthRate =
      this.calculateInformationGrowthRate(currentSnapshot);

    // 更新连续无进展计数
    if (progressDelta < this.config.progressThreshold) {
      this.consecutiveNoProgressCount++;
    } else {
      this.consecutiveNoProgressCount = 0;
    }

    // 判断是否应该跳过规划
    const shouldSkipPlan = this.shouldSkipPlanning(
      currentSnapshot,
      progressDelta,
      newErrors
    );

    const skipReason = shouldSkipPlan
      ? this.getSkipReason(currentSnapshot, progressDelta, newErrors)
      : undefined;

    // 更新 previousSnapshot
    this.previousSnapshot = currentSnapshot;

    return {
      progress_delta: progressDelta,
      new_errors: newErrors,
      new_tools_used: newToolsUsed,
      information_growth_rate: informationGrowthRate,
      should_skip_plan: shouldSkipPlan,
      skip_reason: skipReason,
      timestamp,
    };
  }

  /**
   * 计算进度变化
   */
  private calculateProgressDelta(currentSnapshot: StateSnapshot): number {
    if (!this.previousSnapshot) {
      return 1.0; // 第一次迭代，视为有进展
    }

    const currentProgress = currentSnapshot.currentPlanProgress;
    const previousProgress = this.previousSnapshot.currentPlanProgress;

    if (previousProgress.totalSteps === 0) {
      return currentProgress.totalSteps > 0 ? 1.0 : 0;
    }

    const previousRate =
      previousProgress.completedSteps / previousProgress.totalSteps;
    const currentRate =
      currentProgress.totalSteps > 0
        ? currentProgress.completedSteps / currentProgress.totalSteps
        : 0;

    return Math.max(0, currentRate - previousRate);
  }

  /**
   * 计算新错误数量
   */
  private calculateNewErrors(currentSnapshot: StateSnapshot): number {
    if (!this.previousSnapshot) {
      return currentSnapshot.failureStats.recentFailures;
    }

    const currentFailures = currentSnapshot.failureStats.totalFailures;
    const previousFailures = this.previousSnapshot.failureStats.totalFailures;

    return Math.max(0, currentFailures - previousFailures);
  }

  /**
   * 检测是否使用了新工具
   */
  private detectNewToolsUsed(currentSnapshot: StateSnapshot): boolean {
    if (!this.previousSnapshot) {
      return currentSnapshot.recentToolRecords.length > 0;
    }

    const currentTools = new Set(
      currentSnapshot.recentToolRecords.map((r) => r.toolName)
    );
    const previousTools = new Set(
      this.previousSnapshot.recentToolRecords.map((r) => r.toolName)
    );

    for (const tool of currentTools) {
      if (!previousTools.has(tool)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 计算信息增长率
   */
  private calculateInformationGrowthRate(
    currentSnapshot: StateSnapshot
  ): number {
    if (!this.previousSnapshot) {
      return 1.0;
    }

    const currentRecords = currentSnapshot.recentToolRecords;
    const previousRecords = this.previousSnapshot.recentToolRecords;

    if (currentRecords.length === 0) {
      return 0;
    }

    // 计算成功结果的唯一性
    const currentSuccessResults = new Set(
      currentRecords
        .filter((r) => r.status === 'success' && r.result)
        .map((r) => r.result!.substring(0, 100)) // 取前100字符作为特征
    );

    const previousSuccessResults = new Set(
      previousRecords
        .filter((r) => r.status === 'success' && r.result)
        .map((r) => r.result!.substring(0, 100))
    );

    // 计算新结果的比例
    let newResults = 0;
    for (const result of currentSuccessResults) {
      if (!previousSuccessResults.has(result)) {
        newResults++;
      }
    }

    return currentSuccessResults.size > 0
      ? newResults / currentSuccessResults.size
      : 0;
  }

  /**
   * 判断是否应该跳过规划
   */
  private shouldSkipPlanning(
    currentSnapshot: StateSnapshot,
    progressDelta: number,
    _newErrors: number
  ): boolean {
    const { skipPlanConditions } = this.config;

    // 检查最小迭代次数
    if (
      currentSnapshot.iteration < skipPlanConditions.minIterationsBeforeSkip
    ) {
      return false;
    }

    // 检查连续无进展次数
    if (
      this.consecutiveNoProgressCount >=
      skipPlanConditions.maxConsecutiveNoProgress
    ) {
      return true;
    }

    // 检查近期错误数量
    if (
      currentSnapshot.failureStats.recentFailures >=
      skipPlanConditions.maxRecentErrors
    ) {
      return true;
    }

    // 检查进度变化
    if (
      progressDelta < this.config.progressThreshold &&
      currentSnapshot.iteration > 1
    ) {
      return true;
    }

    return false;
  }

  /**
   * 获取跳过规划的原因
   */
  private getSkipReason(
    currentSnapshot: StateSnapshot,
    progressDelta: number,
    newErrors: number
  ): string {
    const reasons: string[] = [];

    if (
      this.consecutiveNoProgressCount >=
      this.config.skipPlanConditions.maxConsecutiveNoProgress
    ) {
      reasons.push(`连续 ${this.consecutiveNoProgressCount} 次无进展`);
    }

    if (
      currentSnapshot.failureStats.recentFailures >=
      this.config.skipPlanConditions.maxRecentErrors
    ) {
      reasons.push(
        `近期失败次数过多 (${currentSnapshot.failureStats.recentFailures})`
      );
    }

    if (
      progressDelta < this.config.progressThreshold &&
      currentSnapshot.iteration > 1
    ) {
      reasons.push(`进度变化过小 (${(progressDelta * 100).toFixed(1)}%)`);
    }

    if (newErrors > this.config.errorThreshold) {
      reasons.push(`新增错误过多 (${newErrors})`);
    }

    return reasons.join('; ') || '未知原因';
  }

  /**
   * 重置检测器状态
   */
  reset(): void {
    this.previousSnapshot = null;
    this.consecutiveNoProgressCount = 0;
  }

  /**
   * 获取当前连续无进展计数
   */
  getConsecutiveNoProgressCount(): number {
    return this.consecutiveNoProgressCount;
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<DeltaDetectorConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取当前配置
   */
  getConfig(): DeltaDetectorConfig {
    return { ...this.config };
  }
}
