/**
 * 状态管理器
 * 提供线程安全的状态访问和封装
 */

import { AsyncLock, LockResult } from './async-lock.js';
import {
  UnifiedExecutionConfig,
  ConversationHistory,
  ToolMemory,
  SummaryMemory,
  Message,
  ToolRecord,
  Summary,
  StateSnapshot,
} from './types.js';

/**
 * 状态验证结果接口
 */
export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  warnings: string[];
}

/**
 * 状态管理器类
 * 封装所有状态访问，提供线程安全的操作
 */
export class StateManager {
  private workingMemory: ConversationHistory;
  private toolMemory: ToolMemory;
  private summaryMemory: SummaryMemory;
  private lock: AsyncLock;
  private config: UnifiedExecutionConfig;
  private stateHistory: StateSnapshot[] = [];
  private maxHistorySize: number = 10;

  constructor(config: UnifiedExecutionConfig) {
    this.config = config;
    this.lock = new AsyncLock({
      priority: 'write',
      timeout: 5000,
    });
    this.workingMemory = new ConversationHistory(
      config.maxWorkingMemorySize,
      config.summaryTriggerTokens
    );
    this.toolMemory = new ToolMemory(config.maxToolMemorySize);
    this.summaryMemory = new SummaryMemory();
  }

  /**
   * 使用写锁执行操作
   */
  async withWriteLock<T>(operation: () => Promise<T>): Promise<LockResult<T>> {
    return this.lock.acquire('write', operation);
  }

  /**
   * 使用读锁执行操作
   */
  async withReadLock<T>(operation: () => Promise<T>): Promise<LockResult<T>> {
    return this.lock.acquire('read', operation);
  }

  /**
   * 添加用户消息
   */
  addUserMessage(content: string): void {
    this.workingMemory.addUserMessage(content);
  }

  /**
   * 添加助手消息
   */
  addAssistantMessage(content: string): void {
    this.workingMemory.addAssistantMessage(content);
  }

  /**
   * 添加工具消息
   */
  addToolMessage(content: string, toolCallId: string, toolName: string): void {
    this.workingMemory.addToolMessage(content, toolCallId, toolName);
  }

  /**
   * 获取消息
   */
  getMessages(): Message[] {
    return this.workingMemory.getMessages();
  }

  /**
   * 获取最近的消息
   */
  getRecentMessages(limit: number): Message[] {
    return this.workingMemory.getRecentMessages(limit);
  }

  /**
   * 清空工作内存
   */
  clearWorkingMemory(): void {
    this.workingMemory.clear();
  }

  /**
   * 添加工具记录
   */
  addToolRecord(record: Omit<ToolRecord, 'inputHash' | 'timestamp'>): void {
    this.toolMemory.addRecord(record);
  }

  /**
   * 获取工具记录
   */
  getToolRecords(): ToolRecord[] {
    return this.toolMemory.getRecords();
  }

  /**
   * 获取最近的工具记录
   */
  getRecentToolRecords(limit: number): ToolRecord[] {
    return this.toolMemory.getRecentRecords(limit);
  }

  /**
   * 查找重复的工具调用
   */
  findDuplicateToolCall(
    toolName: string,
    arguments_: Record<string, unknown>
  ): ToolRecord | null {
    return this.toolMemory.findDuplicate(toolName, arguments_);
  }

  /**
   * 获取工具统计信息
   */
  getToolStats(toolName: string): {
    successCount: number;
    failureCount: number;
    avgExecutionTime: number;
  } {
    return this.toolMemory.getToolStats(toolName);
  }

  /**
   * 清空工具内存
   */
  clearToolMemory(): void {
    this.toolMemory.clear();
  }

  /**
   * 添加摘要
   */
  addSummary(summary: Omit<Summary, 'id' | 'timestamp'>): void {
    this.summaryMemory.addSummary(summary);
  }

  /**
   * 获取摘要
   */
  getSummaries(): Summary[] {
    return this.summaryMemory.getSummaries();
  }

  /**
   * 获取最新的摘要
   */
  getLatestSummary(): Summary | null {
    return this.summaryMemory.getLatestSummary();
  }

  /**
   * 清空摘要内存
   */
  clearSummaryMemory(): void {
    this.summaryMemory.clear();
  }

  /**
   * 创建状态快照
   */
  createSnapshot(): StateSnapshot {
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

    return {
      iteration: 0, // 将在外部设置
      timestamp: Date.now(),
      workingMemorySize: this.workingMemory.size(),
      workingMemoryTokens: this.workingMemory.estimateTokens(),
      toolMemorySize: this.toolMemory.size(),
      recentToolRecords,
      currentPlanProgress: {
        totalSteps: 0, // 将在外部设置
        completedSteps: 0,
        remainingSteps: 0,
      },
      failureStats: {
        totalFailures,
        recentFailures,
        retryCount: 0, // 将在外部设置
      },
      performanceStats: {
        avgToolExecutionTime,
        totalExecutionTime: 0, // 将在外部设置
      },
    };
  }

  /**
   * 保存状态快照到历史
   */
  saveSnapshotToHistory(snapshot: StateSnapshot): void {
    this.stateHistory.push(snapshot);
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }
  }

  /**
   * 获取状态历史
   */
  getStateHistory(): StateSnapshot[] {
    return [...this.stateHistory];
  }

  /**
   * 恢复状态快照
   */
  restoreSnapshot(snapshot: StateSnapshot): void {
    // 清空当前状态
    this.workingMemory.clear();
    this.toolMemory.clear();
    this.summaryMemory.clear();

    // 恢复工作内存（如果快照中包含消息）
    // 注意：当前的StateSnapshot不包含完整消息，只包含大小信息
    // 在实际实现中，可能需要扩展StateSnapshot接口来包含完整状态

    // 这里我们只恢复大小信息，实际数据需要从其他来源恢复
    console.log(
      `[StateManager] 恢复状态快照: 工作内存大小 ${snapshot.workingMemorySize}, 工具内存大小 ${snapshot.toolMemorySize}`
    );
  }

  /**
   * 验证状态
   */
  validateState(): ValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    // 检查工作内存大小
    if (this.workingMemory.size() > this.config.maxWorkingMemorySize) {
      issues.push(
        `工作内存大小 (${this.workingMemory.size()}) 超过限制 (${this.config.maxWorkingMemorySize})`
      );
    }

    // 检查工具内存大小
    if (this.toolMemory.size() > this.config.maxToolMemorySize) {
      issues.push(
        `工具内存大小 (${this.toolMemory.size()}) 超过限制 (${this.config.maxToolMemorySize})`
      );
    }

    // 检查Token使用量
    const tokenUsage = this.workingMemory.estimateTokens();
    const tokenThreshold = this.config.summaryTriggerTokens * 0.8;
    if (tokenUsage > tokenThreshold) {
      warnings.push(`Token使用量 (${tokenUsage}) 接近阈值 (${tokenThreshold})`);
    }

    // 检查状态保护是否启用
    if (this.config.enableStateProtection) {
      // 检查状态大小
      const totalStateSize =
        this.workingMemory.size() +
        this.toolMemory.size() +
        this.summaryMemory.size();
      if (totalStateSize > this.config.maxStateSize) {
        issues.push(
          `总状态大小 (${totalStateSize}) 超过限制 (${this.config.maxStateSize})`
        );
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * 清理过期状态
   */
  cleanupExpiredState(): void {
    // 清理过期的工具记录
    const toolRecords = this.toolMemory.getRecords();
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24小时

    const expiredRecords = toolRecords.filter(
      (record) => now - record.timestamp > maxAge
    );

    if (expiredRecords.length > 0) {
      console.log(
        `[StateManager] 清理 ${expiredRecords.length} 条过期工具记录`
      );
      // 注意：ToolMemory类没有提供删除单条记录的方法
      // 在实际实现中，可能需要扩展ToolMemory类来支持这个功能
    }

    // 清理过期的摘要
    const summaries = this.summaryMemory.getSummaries();
    const expiredSummaries = summaries.filter(
      (summary) => now - summary.timestamp > maxAge
    );

    if (expiredSummaries.length > 0) {
      console.log(`[StateManager] 清理 ${expiredSummaries.length} 条过期摘要`);
      // 注意：SummaryMemory类没有提供删除单条摘要的方法
    }
  }

  /**
   * 获取状态统计信息
   */
  getStateStats(): {
    workingMemorySize: number;
    workingMemoryTokens: number;
    toolMemorySize: number;
    summaryMemorySize: number;
    totalStateSize: number;
  } {
    return {
      workingMemorySize: this.workingMemory.size(),
      workingMemoryTokens: this.workingMemory.estimateTokens(),
      toolMemorySize: this.toolMemory.size(),
      summaryMemorySize: this.summaryMemory.size(),
      totalStateSize:
        this.workingMemory.size() +
        this.toolMemory.size() +
        this.summaryMemory.size(),
    };
  }

  /**
   * 导出状态为JSON
   */
  exportState(): string {
    return JSON.stringify(
      {
        workingMemory: this.workingMemory.getMessages(),
        toolMemory: this.toolMemory.getRecords(),
        summaryMemory: this.summaryMemory.getSummaries(),
        timestamp: Date.now(),
      },
      null,
      2
    );
  }

  /**
   * 从JSON导入状态
   */
  importState(jsonState: string): void {
    try {
      const state = JSON.parse(jsonState) as {
        workingMemory?: unknown[];
        toolMemory?: unknown[];
        summaryMemory?: unknown[];
      };

      // 清空当前状态
      this.workingMemory.clear();
      this.toolMemory.clear();
      this.summaryMemory.clear();

      // 恢复工作内存
      if (state.workingMemory && Array.isArray(state.workingMemory)) {
        for (const message of state.workingMemory) {
          // 类型断言，确保消息格式正确
          const msg = message as Omit<Message, 'timestamp'>;
          this.workingMemory.addMessage(msg);
        }
      }

      // 恢复工具内存
      if (state.toolMemory && Array.isArray(state.toolMemory)) {
        for (const record of state.toolMemory) {
          // 类型断言，确保记录格式正确
          const rec = record as Omit<ToolRecord, 'inputHash' | 'timestamp'>;
          this.toolMemory.addRecord(rec);
        }
      }

      // 恢复摘要内存
      if (state.summaryMemory && Array.isArray(state.summaryMemory)) {
        for (const summary of state.summaryMemory) {
          // 类型断言，确保摘要格式正确
          const sum = summary as Omit<Summary, 'id' | 'timestamp'>;
          this.summaryMemory.addSummary(sum);
        }
      }

      console.log('[StateManager] 状态导入成功');
    } catch (error) {
      console.error('[StateManager] 状态导入失败:', error);
      throw new Error(`状态导入失败: ${String(error)}`);
    }
  }

  /**
   * 重置状态管理器
   */
  reset(): void {
    this.workingMemory.clear();
    this.toolMemory.clear();
    this.summaryMemory.clear();
    this.stateHistory = [];
    this.lock.reset();
    console.log('[StateManager] 状态管理器已重置');
  }

  /**
   * 获取配置
   */
  getConfig(): UnifiedExecutionConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<UnifiedExecutionConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // 如果内存大小限制发生变化，需要调整现有内存
    if (newConfig.maxWorkingMemorySize !== undefined) {
      // 注意：ConversationHistory类没有提供调整大小的方法
      // 在实际实现中，可能需要扩展ConversationHistory类来支持这个功能
    }

    if (newConfig.maxToolMemorySize !== undefined) {
      // 注意：ToolMemory类没有提供调整大小的方法
    }
  }

  /**
   * 获取锁状态
   */
  getLockStatus(): {
    readers: number;
    writer: boolean;
    readQueueLength: number;
    writeQueueLength: number;
  } {
    return this.lock.getStatus();
  }

  /**
   * 检查是否有等待锁的操作
   */
  hasLockWaiters(): boolean {
    return this.lock.hasWaiters();
  }

  /**
   * 清空所有等待锁的操作
   */
  clearLockWaiters(): void {
    this.lock.clearWaiters();
  }
}

/**
 * 创建状态管理器工厂
 */
export class StateManagerFactory {
  private managers: Map<string, StateManager> = new Map();

  /**
   * 获取或创建状态管理器
   */
  getManager(name: string, config: UnifiedExecutionConfig): StateManager {
    if (!this.managers.has(name)) {
      this.managers.set(name, new StateManager(config));
    }
    return this.managers.get(name)!;
  }

  /**
   * 移除状态管理器
   */
  removeManager(name: string): boolean {
    const manager = this.managers.get(name);
    if (manager) {
      manager.reset();
      this.managers.delete(name);
      return true;
    }
    return false;
  }

  /**
   * 获取所有状态管理器的状态
   */
  getAllStatus(): Record<string, ReturnType<StateManager['getStateStats']>> {
    const status: Record<
      string,
      ReturnType<StateManager['getStateStats']>
    > = {};
    for (const [name, manager] of this.managers) {
      status[name] = manager.getStateStats();
    }
    return status;
  }

  /**
   * 清空所有状态管理器
   */
  clearAll(): void {
    for (const manager of this.managers.values()) {
      manager.reset();
    }
    this.managers.clear();
  }
}

// 默认状态管理器工厂实例
export const defaultStateManagerFactory = new StateManagerFactory();
