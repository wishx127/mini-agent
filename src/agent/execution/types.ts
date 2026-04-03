import { createHash } from 'crypto';

import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
  source?: string;
}

export type ToolCallStatus = 'pending' | 'success' | 'failed' | 'timeout';

export type ExecutionPhase =
  | 'OBSERVE'
  | 'PLAN'
  | 'ACT'
  | 'EVALUATE'
  | 'REFLECT';

/**
 * 统一后的执行配置接口
 * 合并了ExecutionConfig和ExecutionConfigExtended的所有配置项
 */
export interface UnifiedExecutionConfig {
  // 基础配置
  maxIterations: number;
  maxExecutionTime: number;
  maxWorkingMemorySize: number;
  maxToolMemorySize: number;
  summaryTriggerRound: number;
  summaryTriggerTokens: number;
  tokenThreshold: number;
  toolTimeout: number;
  maxRetryPerTool: number;
  enableParallelExecution: boolean;

  // 并行执行配置
  maxConcurrentTools: number;
  waveTimeout: number;

  // 安全配置
  enableStateProtection: boolean;
  maxStateSize: number;
}

/**
 * 向后兼容的类型别名
 * 保持现有代码的兼容性
 */
export type ExecutionConfig = UnifiedExecutionConfig;

/**
 * 统一后的默认配置
 */
export const DEFAULT_UNIFIED_CONFIG: UnifiedExecutionConfig = {
  maxIterations: 100,
  maxExecutionTime: 600000,
  maxWorkingMemorySize: 10,
  maxToolMemorySize: 100,
  summaryTriggerRound: 5,
  summaryTriggerTokens: 8000,
  tokenThreshold: 0.9,
  toolTimeout: 30000,
  maxRetryPerTool: 3,
  enableParallelExecution: true,
  maxConcurrentTools: 5,
  waveTimeout: 60000,
  enableStateProtection: true,
  maxStateSize: 1000,
};

/**
 * 保持向后兼容的默认配置别名
 */
export const DEFAULT_EXECUTION_CONFIG = DEFAULT_UNIFIED_CONFIG;

export interface ToolRecord {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: string;
  status: ToolCallStatus;
  error?: string;
  timestamp: number;
  iteration: number;
  executionTime?: number;
  retryCount?: number;
  inputHash?: string;
}

export function computeInputHash(input: Record<string, unknown>): string {
  const normalized = JSON.stringify(sortObjectKeys(input));
  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      sortObjectKeys(item as Record<string, unknown>)
    ) as unknown as Record<string, unknown>;
  }
  const sorted: Record<string, unknown> = {};
  Object.keys(obj)
    .sort()
    .forEach((key) => {
      sorted[key] = sortObjectKeys(obj[key] as Record<string, unknown>);
    });
  return sorted;
}

export class ToolMemory {
  private records: ToolRecord[] = [];
  private maxSize: number;
  private recentQueryLimit: number;

  constructor(maxSize: number = 100, recentQueryLimit: number = 5) {
    this.maxSize = maxSize;
    this.recentQueryLimit = recentQueryLimit;
  }

  addRecord(record: Omit<ToolRecord, 'inputHash' | 'timestamp'>): void {
    const inputHash = computeInputHash(record.arguments);
    const newRecord: ToolRecord = {
      ...record,
      inputHash,
      timestamp: Date.now(),
    };
    this.records.push(newRecord);
    this.enforceSizeLimit();
  }

  getRecords(): ToolRecord[] {
    return [...this.records];
  }

  getRecentRecords(limit: number): ToolRecord[] {
    return this.records.slice(-limit);
  }

  findDuplicate(
    toolName: string,
    arguments_: Record<string, unknown>
  ): ToolRecord | null {
    const inputHash = computeInputHash(arguments_);
    const recentRecords = this.getRecentRecords(this.recentQueryLimit);
    for (let i = recentRecords.length - 1; i >= 0; i--) {
      const record = recentRecords[i];
      if (record.toolName === toolName && record.inputHash === inputHash) {
        return record;
      }
    }
    return null;
  }

  getToolStats(toolName: string): {
    successCount: number;
    failureCount: number;
    avgExecutionTime: number;
  } {
    const toolRecords = this.records.filter((r) => r.toolName === toolName);
    if (toolRecords.length === 0) {
      return { successCount: 0, failureCount: 0, avgExecutionTime: 0 };
    }
    const successCount = toolRecords.filter(
      (r) => r.status === 'success'
    ).length;
    const failureCount = toolRecords.filter(
      (r) => r.status === 'failed' || r.status === 'timeout'
    ).length;
    const totalTime = toolRecords.reduce(
      (sum, r) => sum + (r.executionTime || 0),
      0
    );
    return {
      successCount,
      failureCount,
      avgExecutionTime: totalTime / toolRecords.length,
    };
  }

  getFailureCount(toolName: string): number {
    return this.records.filter(
      (r) =>
        r.toolName === toolName &&
        (r.status === 'failed' || r.status === 'timeout')
    ).length;
  }

  queryToolMemory(
    toolName?: string,
    inputHash?: string,
    limit: number = 10
  ): ToolRecord[] {
    let filtered = this.records;

    if (toolName) {
      filtered = filtered.filter((r) => r.toolName === toolName);
    }

    if (inputHash) {
      filtered = filtered.filter((r) => r.inputHash === inputHash);
    }

    return filtered.slice(-limit);
  }

  clear(): void {
    this.records = [];
  }

  size(): number {
    return this.records.length;
  }

  exportToJSON(): string {
    return JSON.stringify(this.records, null, 2);
  }

  private enforceSizeLimit(): void {
    if (this.records.length > this.maxSize) {
      this.records = this.records.slice(-this.maxSize);
    }
  }
}

export interface Summary {
  id: string;
  timeRange: {
    from: number;
    to: number;
  };
  messageCount: number;
  summary: string;
  timestamp: number;
  iteration: number;
}

export class SummaryMemory {
  private summaries: Summary[] = [];
  private maxSize: number;

  constructor(maxSize: number = 20) {
    this.maxSize = maxSize;
  }

  addSummary(summary: Omit<Summary, 'id' | 'timestamp'>): void {
    const newSummary: Summary = {
      ...summary,
      id: `summary_${Date.now()}`,
      timestamp: Date.now(),
    };
    this.summaries.push(newSummary);
    this.enforceSizeLimit();
  }

  getSummaries(): Summary[] {
    return [...this.summaries];
  }

  getLatestSummary(): Summary | null {
    if (this.summaries.length === 0) {
      return null;
    }
    return this.summaries[this.summaries.length - 1];
  }

  clear(): void {
    this.summaries = [];
  }

  size(): number {
    return this.summaries.length;
  }

  exportToJSON(): string {
    return JSON.stringify(this.summaries, null, 2);
  }

  private enforceSizeLimit(): void {
    if (this.summaries.length > this.maxSize) {
      this.summaries = this.summaries.slice(-this.maxSize);
    }
  }
}

export class ConversationHistory {
  private messages: Message[] = [];
  private maxSize: number;
  private maxTokens: number;

  constructor(maxSize: number = 50, maxTokens: number = 4000) {
    this.maxSize = maxSize;
    this.maxTokens = maxTokens;
  }

  addMessage(message: Omit<Message, 'timestamp'>): void {
    const newMessage: Message = {
      ...message,
      timestamp: Date.now(),
    };
    this.messages.push(newMessage);
    this.enforceSizeLimit();
  }

  addUserMessage(content: string): void {
    this.addMessage({ role: 'user', content });
  }

  addAssistantMessage(content: string): void {
    this.addMessage({ role: 'assistant', content });
  }

  addToolMessage(content: string, toolCallId: string, toolName: string): void {
    this.addMessage({ role: 'tool', content, toolCallId, toolName });
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  getRecentMessages(limit: number): Message[] {
    return this.messages.slice(-limit);
  }

  getMessagesAsBaseMessages(): BaseMessage[] {
    return this.messages.map((msg) => {
      if (msg.role === 'user') {
        return new HumanMessage(msg.content);
      } else if (msg.role === 'assistant') {
        return new AIMessage(msg.content);
      } else if (msg.role === 'tool') {
        return new ToolMessage(msg.content, msg.toolCallId || '');
      }
      return new SystemMessage(msg.content);
    });
  }

  clear(): void {
    this.messages = [];
  }

  size(): number {
    return this.messages.length;
  }

  estimateTokens(): number {
    return this.messages.reduce((sum, msg) => {
      // 更准确的 token 估算：中文约 1.5 tokens，英文约 0.25 tokens
      const content = msg.content;
      let tokens = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        if (char > 127) {
          tokens += 1.5; // 中文/日文等
        } else {
          tokens += 0.25; // 英文
        }
      }
      return sum + Math.ceil(tokens);
    }, 0);
  }

  exportToJSON(): string {
    return JSON.stringify(this.messages, null, 2);
  }

  private enforceSizeLimit(): void {
    if (this.messages.length > this.maxSize) {
      this.messages = this.messages.slice(-this.maxSize);
    }
    while (this.estimateTokens() > this.maxTokens && this.messages.length > 1) {
      this.messages = this.messages.slice(1);
    }
  }
}

export interface ToolInfo {
  name: string;
  description: string;
  enabled: boolean;
  parameters?: Record<string, unknown>;
  recentSuccessRate?: number;
  lastUsedIteration?: number;
  failureCount?: number;
  timeout?: number; // 工具级别的超时时间（毫秒）
}

export interface DeduplicationState {
  duplicateCallsDetected: number;
  duplicateCallsSkipped: number;
  toolRetryBudgets: Record<string, number>;
}

export interface PlanningContext {
  userPrompt: string;
  workingMemory: Message[];
  toolMemory: ToolRecord[];
  summaryMemory: Summary[];
  iterationCount: number;
  availableTools: ToolInfo[];
  remainingTokenBudget?: number;
  remainingIterations?: number;
  previousPlanConfidence?: number;
  failedToolsThisRound?: string[];
  informationGrowthRate?: number;
  deduplicationInfo?: DeduplicationState;
}

export interface PlanStep {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  dependsOn: string[];
  confidence: number;
  reasoning?: string;
  // 新增：步骤原子性定义
  expected_output?: string;
  success_criteria?: string;
  retryable?: boolean;
  max_retries?: number;
}

export interface Plan {
  steps: PlanStep[];
  overallConfidence: number;
  reasoning?: string;
  isFinalAnswer?: boolean;
  // 新增：计划结构标准化
  expected_outcome?: string;
  termination_condition?: string;
  priority?: 'high' | 'medium' | 'low';
  estimated_duration?: number;
}

export type ReflectionDecision =
  | 'continue'
  | 'retry'
  | 'new_plan'
  | 'finalize_answer'
  | 'fallback';

export type ErrorAttribution = 'tool' | 'planner' | 'system' | 'none';

export interface ToolFailureAnalysis {
  toolName: string;
  errorType:
    | 'network_error'
    | 'parameter_error'
    | 'timeout'
    | 'rate_limit'
    | 'unknown';
  errorMessage: string;
  isRecoverable: boolean;
  suggestedAction: 'retry' | 'new_plan' | 'fallback';
}

export interface ReflectionReasoning {
  successRate: number;
  informationGrowth: number;
  confidenceScore: number;
  iterationCount: number;
  retryBudgetRemaining: number;
  terminationReason?: string;
  toolFailures?: ToolFailureAnalysis[];
}

/**
 * 失败反思结构接口
 */
export interface FailureReflection {
  /** 失败类型 */
  failure_type:
    | 'tool_error'
    | 'bad_plan'
    | 'missing_info'
    | 'timeout'
    | 'unknown';
  /** 根本原因 */
  root_cause: string;
  /** 影响范围 */
  impact_scope: 'single_step' | 'multiple_steps' | 'entire_plan';
  /** 可恢复性 */
  is_recoverable: boolean;
  /** 改进建议 */
  improvement_suggestions: string[];
  /** 相关工具 */
  related_tools?: string[];
  /** 错误详情 */
  error_details?: string;
}

/**
 * 成功反思结构接口
 */
export interface SuccessReflection {
  /** 可复用模式 */
  reusable_pattern?: string;
  /** 有用工具序列 */
  useful_tool_sequence?: string[];
  /** 优化提示 */
  optimization_hint?: string;
  /** 成功因素 */
  success_factors: string[];
  /** 关键步骤 */
  key_steps?: string[];
  /** 性能指标 */
  performance_metrics?: {
    execution_time: number;
    success_rate: number;
    information_gain: number;
  };
}

export interface ReflectionResult {
  decision: ReflectionDecision;
  reasoning: string;
  shouldRetryTools?: string[];
  confidence: number;
  informationGrowth?: number;
  errorAttribution?: ErrorAttribution;
  detailedReasoning?: ReflectionReasoning;
  /** 失败反思结构 */
  failure_reflection?: FailureReflection;
  /** 成功反思结构 */
  success_reflection?: SuccessReflection;
}

export interface ExecutionMetrics {
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  iterationCount: number;
  toolSuccessCount: number;
  toolFailureCount: number;
  toolResults: Array<{
    toolName: string;
    success: boolean;
    executionTime: number;
    isDuplicate?: boolean;
  }>;
  phaseTimings: Record<string, number>;
  terminationReason?: string;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

export type MetricsCallback = (metrics: ExecutionMetrics) => void;

export interface AggregatedToolStats {
  toolName: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgExecutionTime: number;
  minExecutionTime: number;
  maxExecutionTime: number;
  totalExecutionTime: number;
}

export interface EfficiencyMetrics {
  overallSuccessRate: number;
  avgIterationDuration: number;
  avgPhaseDuration: Record<string, number>;
  toolEfficiency: Record<string, number>;
  totalExecutionTime: number;
  activeTime: number;
  idleTime: number;
  efficiencyRatio: number;
}

export class ExecutionMetricsCollector {
  private metrics: ExecutionMetrics;
  private callbacks: MetricsCallback[] = [];

  constructor() {
    this.metrics = {
      startTime: Date.now(),
      iterationCount: 0,
      toolSuccessCount: 0,
      toolFailureCount: 0,
      toolResults: [],
      phaseTimings: {},
    };
  }

  getMetrics(): ExecutionMetrics {
    return { ...this.metrics };
  }

  addCallback(callback: MetricsCallback): void {
    this.callbacks.push(callback);
  }

  removeCallback(callback: MetricsCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  private notifyCallbacks(): void {
    const snapshot = this.getMetrics();
    for (const callback of this.callbacks) {
      try {
        callback(snapshot);
      } catch (error) {
        console.error('[Metrics] Callback error:', error);
      }
    }
  }

  incrementIteration(): void {
    this.metrics.iterationCount++;
    this.notifyCallbacks();
  }

  recordToolExecution(
    toolName: string,
    success: boolean,
    executionTime: number,
    isDuplicate?: boolean
  ): void {
    this.metrics.toolResults.push({
      toolName,
      success,
      executionTime,
      isDuplicate,
    });
    if (success) {
      this.metrics.toolSuccessCount++;
    } else {
      this.metrics.toolFailureCount++;
    }
    this.notifyCallbacks();
  }

  recordPhaseTiming(phase: string, duration: number): void {
    const existing = this.metrics.phaseTimings[phase] || 0;
    this.metrics.phaseTimings[phase] = existing + duration;
    this.notifyCallbacks();
  }

  recordTokenUsage(input: number, output: number): void {
    this.metrics.tokenUsage = {
      input,
      output,
      total: input + output,
    };
    this.notifyCallbacks();
  }

  aggregateToolStats(): AggregatedToolStats[] {
    const toolMap = new Map<string, AggregatedToolStats>();

    for (const result of this.metrics.toolResults) {
      const existing = toolMap.get(result.toolName) || {
        toolName: result.toolName,
        totalCalls: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        avgExecutionTime: 0,
        minExecutionTime: Infinity,
        maxExecutionTime: 0,
        totalExecutionTime: 0,
      };

      existing.totalCalls++;
      if (result.success) {
        existing.successCount++;
      } else {
        existing.failureCount++;
      }
      existing.totalExecutionTime += result.executionTime;
      existing.minExecutionTime = Math.min(
        existing.minExecutionTime,
        result.executionTime
      );
      existing.maxExecutionTime = Math.max(
        existing.maxExecutionTime,
        result.executionTime
      );

      toolMap.set(result.toolName, existing);
    }

    const stats: AggregatedToolStats[] = [];
    for (const stat of toolMap.values()) {
      stat.successRate =
        stat.totalCalls > 0 ? stat.successCount / stat.totalCalls : 0;
      stat.avgExecutionTime =
        stat.totalCalls > 0 ? stat.totalExecutionTime / stat.totalCalls : 0;
      if (stat.minExecutionTime === Infinity) {
        stat.minExecutionTime = 0;
      }
      stats.push(stat);
    }

    return stats;
  }

  getEfficiencyMetrics(): EfficiencyMetrics {
    const toolStats = this.aggregateToolStats();
    const toolEfficiency: Record<string, number> = {};

    for (const stat of toolStats) {
      toolEfficiency[stat.toolName] = stat.successRate;
    }

    const avgPhaseDuration: Record<string, number> = {};
    const iterationCount = this.metrics.iterationCount || 1;

    for (const [phase, duration] of Object.entries(this.metrics.phaseTimings)) {
      avgPhaseDuration[phase] = duration / iterationCount;
    }

    const totalToolTime = this.metrics.toolResults.reduce(
      (sum, r) => sum + r.executionTime,
      0
    );

    const totalPhaseTime = Object.values(this.metrics.phaseTimings).reduce(
      (sum, d) => sum + d,
      0
    );

    const totalDuration = this.metrics.totalDuration || 0;
    const activeTime = totalToolTime;
    const idleTime = totalDuration - activeTime;

    return {
      overallSuccessRate: this.getSuccessRate(),
      avgIterationDuration:
        this.metrics.iterationCount > 0
          ? totalPhaseTime / this.metrics.iterationCount
          : 0,
      avgPhaseDuration,
      toolEfficiency,
      totalExecutionTime: totalDuration,
      activeTime,
      idleTime: Math.max(0, idleTime),
      efficiencyRatio: totalDuration > 0 ? activeTime / totalDuration : 0,
    };
  }

  getSuccessRate(): number {
    const total = this.metrics.toolSuccessCount + this.metrics.toolFailureCount;
    return total > 0 ? this.metrics.toolSuccessCount / total : 0;
  }

  queryMetrics(filter?: {
    toolName?: string;
    minExecutionTime?: number;
    maxExecutionTime?: number;
    successOnly?: boolean;
  }): ExecutionMetrics['toolResults'] {
    let results = [...this.metrics.toolResults];

    if (filter) {
      if (filter.toolName) {
        results = results.filter((r) => r.toolName === filter.toolName);
      }
      if (filter.minExecutionTime !== undefined) {
        results = results.filter(
          (r) => r.executionTime >= filter.minExecutionTime!
        );
      }
      if (filter.maxExecutionTime !== undefined) {
        results = results.filter(
          (r) => r.executionTime <= filter.maxExecutionTime!
        );
      }
      if (filter.successOnly) {
        results = results.filter((r) => r.success);
      }
    }

    return results;
  }

  serializeToJSON(): string {
    const data = {
      ...this.metrics,
      aggregatedStats: this.aggregateToolStats(),
      efficiencyMetrics: this.getEfficiencyMetrics(),
    };
    return JSON.stringify(data, null, 2);
  }

  serializeToCSV(): string {
    const headers = ['toolName', 'success', 'executionTime', 'isDuplicate'];
    const rows = this.metrics.toolResults.map((r) => [
      r.toolName,
      r.success,
      r.executionTime,
      r.isDuplicate || false,
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  finalize(terminationReason?: string): ExecutionMetrics {
    this.metrics.endTime = Date.now();
    this.metrics.totalDuration = this.metrics.endTime - this.metrics.startTime;
    this.metrics.terminationReason = terminationReason;
    this.notifyCallbacks();
    return this.getMetrics();
  }
}

export interface ToolExecutionResult {
  stepId: string;
  stepIndex: number;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: string;
  status: ToolCallStatus;
  error?: string;
  startTime: number;
  endTime: number;
  duration: number;
  // 新增：执行结果结构化
  token_usage?: {
    input: number;
    output: number;
    total: number;
  };
  error_type?:
    | 'network_error'
    | 'parameter_error'
    | 'timeout'
    | 'rate_limit'
    | 'unknown';
  retryable?: boolean;
}

export interface WaveExecutionResult {
  waveIndex: number;
  stepResults: ToolExecutionResult[];
  waveDuration: number;
  successCount: number;
  failureCount: number;
}

export interface ExecutionWave {
  waveIndex: number;
  steps: PlanStep[];
}

export interface ExecutionConfigExtended extends ExecutionConfig {
  maxConcurrentTools: number;
  waveTimeout: number;
}

export interface DeduplicationConfig {
  checkLimit: number;
  retryBudgetPerTool: number;
  enableWarning: boolean;
}

export const DEFAULT_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  checkLimit: 5,
  retryBudgetPerTool: 3,
  enableWarning: true,
};

export interface DeduplicationResult {
  shouldSkip: boolean;
  skipReason?: 'success' | 'budget_exhausted' | 'timeout_risk';
  previousRecord?: ToolRecord;
  retryCount: number;
  remainingBudget: number;
}

export class DeduplicationEngine {
  private toolMemory: ToolMemory;
  private config: DeduplicationConfig;
  private retryBudgets: Map<string, number>;
  private duplicateCallsDetected: number;
  private duplicateCallsSkipped: number;

  constructor(toolMemory: ToolMemory, config?: Partial<DeduplicationConfig>) {
    this.toolMemory = toolMemory;
    this.config = { ...DEFAULT_DEDUPLICATION_CONFIG, ...config };
    this.retryBudgets = new Map();
    this.duplicateCallsDetected = 0;
    this.duplicateCallsSkipped = 0;
    this.initializeRetryBudgets();
  }

  private initializeRetryBudgets(): void {
    const records = this.toolMemory.getRecords();
    const toolNames = new Set(records.map((r) => r.toolName));
    for (const toolName of toolNames) {
      this.retryBudgets.set(toolName, this.config.retryBudgetPerTool);
    }
  }

  checkDuplicate(
    toolName: string,
    arguments_: Record<string, unknown>
  ): DeduplicationResult {
    const duplicate = this.toolMemory.findDuplicate(toolName, arguments_);

    if (!duplicate) {
      return {
        shouldSkip: false,
        retryCount: 0,
        remainingBudget: this.getRetryBudget(toolName),
      };
    }

    this.duplicateCallsDetected++;

    if (
      duplicate.status === 'success' &&
      (duplicate.result?.length || 0) > 50
    ) {
      this.duplicateCallsSkipped++;
      return {
        shouldSkip: true,
        skipReason: 'success',
        previousRecord: duplicate,
        retryCount: duplicate.retryCount || 0,
        remainingBudget: this.getRetryBudget(toolName),
      };
    }

    const remainingBudget = this.getRetryBudget(toolName);
    if (remainingBudget <= 0) {
      return {
        shouldSkip: true,
        skipReason: 'budget_exhausted',
        previousRecord: duplicate,
        retryCount: duplicate.retryCount || 0,
        remainingBudget: 0,
      };
    }

    if (duplicate.status === 'timeout') {
      return {
        shouldSkip: true,
        skipReason: 'timeout_risk',
        previousRecord: duplicate,
        retryCount: (duplicate.retryCount || 0) + 1,
        remainingBudget,
      };
    }

    return {
      shouldSkip: false,
      previousRecord: duplicate,
      retryCount: (duplicate.retryCount || 0) + 1,
      remainingBudget,
    };
  }

  private getRetryBudget(toolName: string): number {
    if (!this.retryBudgets.has(toolName)) {
      this.retryBudgets.set(toolName, this.config.retryBudgetPerTool);
    }
    return this.retryBudgets.get(toolName)!;
  }

  decrementRetryBudget(toolName: string): void {
    const current = this.getRetryBudget(toolName);
    this.retryBudgets.set(toolName, Math.max(0, current - 1));
  }

  resetRetryBudget(toolName: string): void {
    this.retryBudgets.set(toolName, this.config.retryBudgetPerTool);
  }

  onToolSuccess(toolName: string): void {
    this.resetRetryBudget(toolName);
  }

  onToolFailure(toolName: string): void {
    this.decrementRetryBudget(toolName);
  }

  getDeduplicationState(): DeduplicationState {
    const toolRetryBudgets: Record<string, number> = {};
    for (const [toolName, budget] of this.retryBudgets.entries()) {
      toolRetryBudgets[toolName] = budget;
    }
    return {
      duplicateCallsDetected: this.duplicateCallsDetected,
      duplicateCallsSkipped: this.duplicateCallsSkipped,
      toolRetryBudgets,
    };
  }

  getConfig(): DeduplicationConfig {
    return { ...this.config };
  }

  getWarningMessage(
    toolName: string,
    arguments_: Record<string, unknown>
  ): string | null {
    if (!this.config.enableWarning) {
      return null;
    }

    const result = this.checkDuplicate(toolName, arguments_);

    if (result.shouldSkip && result.previousRecord) {
      if (result.skipReason === 'success') {
        return `检测到重复的工具调用 [${toolName}]，前次调用成功，结果长度 ${result.previousRecord.result?.length || 0} 字符`;
      } else if (result.skipReason === 'budget_exhausted') {
        return `检测到重复的工具调用 [${toolName}]，重试预算已耗尽`;
      } else if (result.skipReason === 'timeout_risk') {
        return `检测到重复的工具调用 [${toolName}]，前次调用超时`;
      }
    }

    return null;
  }
}

// 状态快照接口 - 用于OBSERVE阶段收集系统状态
export interface StateSnapshot {
  iteration: number;
  timestamp: number;
  workingMemorySize: number;
  workingMemoryTokens: number;
  toolMemorySize: number;
  recentToolRecords: ToolRecord[];
  currentPlanProgress: {
    totalSteps: number;
    completedSteps: number;
    remainingSteps: number;
  };
  failureStats: {
    totalFailures: number;
    recentFailures: number;
    retryCount: number;
  };
  performanceStats: {
    avgToolExecutionTime: number;
    totalExecutionTime: number;
  };
}

// 状态摘要接口 - 用于生成状态的简洁描述
export interface StateDigest {
  summary: string;
  keyMetrics: {
    progressRate: number;
    successRate: number;
    informationGrowth: number;
  };
  highlights: string[];
  warnings: string[];
  timestamp: number;
  iteration: number;
}

// 状态变化检测接口 - 用于检测状态变化
export interface StateDelta {
  progress_delta: number;
  new_errors: number;
  new_tools_used: boolean;
  information_growth_rate: number;
  should_skip_plan: boolean;
  skip_reason?: string;
  timestamp: number;
}

// Agent错误接口 - 用于统一错误处理
export interface AgentError {
  type:
    | 'tool_error'
    | 'planner_error'
    | 'system_error'
    | 'timeout_error'
    | 'validation_error';
  retryable: boolean;
  severity: 1 | 2 | 3 | 4 | 5;
  message: string;
  originalError?: unknown;
  timestamp: number;
  iteration: number;
  context?: Record<string, unknown>;
}

export type TerminationReason =
  | 'planner_final'
  | 'no_information_growth'
  | 'max_iterations'
  | 'token_budget_exceeded'
  | 'execution_timeout'
  | 'failure_budget_exhausted'
  | 'consecutive_failures'
  | 'none';

export interface TerminationCheckResult {
  shouldTerminate: boolean;
  reason: TerminationReason;
  priority: number;
  message: string;
  details?: Record<string, unknown>;
}

export interface TerminationConfig {
  maxIterations: number;
  maxExecutionTime: number;
  maxTokens: number;
  tokenBudgetThreshold: number;
  similarityThreshold: number;
  noGrowthIterationsRequired: number;
  failureBudget: number;
  warningThresholdRatio: number;
  // 新增：连续失败终止条件
  maxConsecutiveFailures: number;
  consecutiveFailuresRequired: number;
}

export const DEFAULT_TERMINATION_CONFIG: TerminationConfig = {
  maxIterations: 100,
  maxExecutionTime: 600000,
  maxTokens: 1280000,
  tokenBudgetThreshold: 0.9,
  similarityThreshold: 0.95,
  noGrowthIterationsRequired: 2,
  failureBudget: 3,
  warningThresholdRatio: 0.8,
  // 新增：连续失败终止条件默认值
  maxConsecutiveFailures: 3,
  consecutiveFailuresRequired: 3,
};

export class TerminationChecker {
  private config: TerminationConfig;
  private startTime: number;
  private iteration: number;
  private failureCount: number;
  private consecutiveNoGrowthCount: number;
  private lastInformationGrowth: number;
  private terminationHistory: TerminationCheckResult[];

  constructor(config: Partial<TerminationConfig> = {}) {
    this.config = { ...DEFAULT_TERMINATION_CONFIG, ...config };
    this.startTime = Date.now();
    this.iteration = 0;
    this.failureCount = 0;
    this.consecutiveNoGrowthCount = 0;
    this.lastInformationGrowth = 0;
    this.terminationHistory = [];
  }

  updateIteration(): void {
    this.iteration++;
  }

  recordFailure(): void {
    this.failureCount++;
  }

  recordInformationGrowth(growth: number): void {
    this.lastInformationGrowth = growth;
    if (growth < 1 - this.config.similarityThreshold) {
      this.consecutiveNoGrowthCount++;
    } else {
      this.consecutiveNoGrowthCount = 0;
    }
  }

  resetNoGrowthCount(): void {
    this.consecutiveNoGrowthCount = 0;
  }

  checkAll(
    currentPlan: { isFinalAnswer?: boolean } | null,
    currentTokenUsage: number
  ): TerminationCheckResult {
    const checks = [
      this.checkPlannerSignal(currentPlan),
      this.checkNoInformationGrowth(),
      this.checkMaxIterations(),
      this.checkTokenBudget(currentTokenUsage),
      this.checkExecutionTimeout(),
      this.checkFailureBudget(),
    ];

    checks.sort((a, b) => a.priority - b.priority);

    const result = checks.find((c) => c.shouldTerminate) || {
      shouldTerminate: false,
      reason: 'none' as TerminationReason,
      priority: 999,
      message: '继续执行',
    };

    if (result.shouldTerminate) {
      this.terminationHistory.push(result);
    }

    return result;
  }

  checkPlannerSignal(
    currentPlan: { isFinalAnswer?: boolean } | null
  ): TerminationCheckResult {
    if (currentPlan?.isFinalAnswer) {
      return {
        shouldTerminate: true,
        reason: 'planner_final',
        priority: 1,
        message: '规划器发出终止信号 (type: final)',
        details: { plan: currentPlan },
      };
    }
    return {
      shouldTerminate: false,
      reason: 'none',
      priority: 999,
      message: '规划器未发出终止信号',
    };
  }

  checkNoInformationGrowth(): TerminationCheckResult {
    if (
      this.consecutiveNoGrowthCount >= this.config.noGrowthIterationsRequired
    ) {
      return {
        shouldTerminate: true,
        reason: 'no_information_growth',
        priority: 2,
        message: `连续 ${this.consecutiveNoGrowthCount} 次无信息增长 (相似度 >= ${this.config.similarityThreshold})`,
        details: {
          consecutiveNoGrowth: this.consecutiveNoGrowthCount,
          threshold: this.config.noGrowthIterationsRequired,
          lastGrowth: this.lastInformationGrowth,
        },
      };
    }
    return {
      shouldTerminate: false,
      reason: 'none',
      priority: 999,
      message: '有信息增长',
    };
  }

  checkMaxIterations(): TerminationCheckResult {
    if (this.iteration >= this.config.maxIterations) {
      return {
        shouldTerminate: true,
        reason: 'max_iterations',
        priority: 3,
        message: `已达到最大迭代次数限制 (${this.iteration}/${this.config.maxIterations})`,
        details: { current: this.iteration, max: this.config.maxIterations },
      };
    }
    return {
      shouldTerminate: false,
      reason: 'none',
      priority: 999,
      message: `迭代次数未超限 (${this.iteration}/${this.config.maxIterations})`,
    };
  }

  checkTokenBudget(currentTokenUsage: number): TerminationCheckResult {
    const tokenRatio = currentTokenUsage / this.config.maxTokens;
    if (tokenRatio >= this.config.tokenBudgetThreshold) {
      return {
        shouldTerminate: true,
        reason: 'token_budget_exceeded',
        priority: 4,
        message: `Token 使用已超预算 (${(tokenRatio * 100).toFixed(0)}%)`,
        details: { tokenRatio, threshold: this.config.tokenBudgetThreshold },
      };
    }
    return {
      shouldTerminate: false,
      reason: 'none',
      priority: 999,
      message: `Token 使用未超预算 (${(tokenRatio * 100).toFixed(0)}%)`,
    };
  }

  checkExecutionTimeout(): TerminationCheckResult {
    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.config.maxExecutionTime) {
      return {
        shouldTerminate: true,
        reason: 'execution_timeout',
        priority: 5,
        message: `执行超时 (${(elapsed / 1000).toFixed(1)}s / ${(this.config.maxExecutionTime / 1000).toFixed(0)}s)`,
        details: { elapsed, limit: this.config.maxExecutionTime },
      };
    }
    return {
      shouldTerminate: false,
      reason: 'none',
      priority: 999,
      message: `执行未超时 (${(elapsed / 1000).toFixed(1)}s)`,
    };
  }

  checkFailureBudget(): TerminationCheckResult {
    if (this.failureCount >= this.config.failureBudget) {
      return {
        shouldTerminate: true,
        reason: 'failure_budget_exhausted',
        priority: 6,
        message: `失败预算已耗尽 (${this.failureCount}/${this.config.failureBudget})`,
        details: {
          failures: this.failureCount,
          budget: this.config.failureBudget,
        },
      };
    }
    return {
      shouldTerminate: false,
      reason: 'none',
      priority: 999,
      message: `失败预算充足 (${this.failureCount}/${this.config.failureBudget})`,
    };
  }

  /**
   * 检查连续失败终止条件
   */
  checkConsecutiveFailures(
    consecutiveFailures: number
  ): TerminationCheckResult {
    if (consecutiveFailures >= this.config.consecutiveFailuresRequired) {
      return {
        shouldTerminate: true,
        reason: 'consecutive_failures',
        priority: 7,
        message: `连续失败次数过多 (${consecutiveFailures}/${this.config.consecutiveFailuresRequired})`,
        details: {
          consecutiveFailures,
          threshold: this.config.consecutiveFailuresRequired,
        },
      };
    }
    return {
      shouldTerminate: false,
      reason: 'none',
      priority: 999,
      message: `连续失败次数正常 (${consecutiveFailures}/${this.config.consecutiveFailuresRequired})`,
    };
  }

  getWarningStatus(currentTokenUsage: number): {
    isWarning: boolean;
    message?: string;
  } {
    const tokenRatio = currentTokenUsage / this.config.maxTokens;
    const iterationRatio = this.iteration / this.config.maxIterations;

    if (tokenRatio >= this.config.warningThresholdRatio) {
      return {
        isWarning: true,
        message: `Token 接近耗尽 (${(tokenRatio * 100).toFixed(0)}%)`,
      };
    }

    if (iterationRatio >= this.config.warningThresholdRatio) {
      return {
        isWarning: true,
        message: `即将达到最大迭代次数 (${this.iteration}/${this.config.maxIterations})`,
      };
    }

    const elapsed = Date.now() - this.startTime;
    const timeRatio = elapsed / this.config.maxExecutionTime;
    if (timeRatio >= this.config.warningThresholdRatio) {
      return {
        isWarning: true,
        message: `即将超时 (${(timeRatio * 100).toFixed(0)}%)`,
      };
    }

    return { isWarning: false };
  }

  getTerminationHistory(): TerminationCheckResult[] {
    return [...this.terminationHistory];
  }

  getLastTerminationReason(): TerminationReason {
    if (this.terminationHistory.length === 0) {
      return 'none';
    }
    return this.terminationHistory[this.terminationHistory.length - 1].reason;
  }

  reset(): void {
    this.startTime = Date.now();
    this.iteration = 0;
    this.failureCount = 0;
    this.consecutiveNoGrowthCount = 0;
    this.lastInformationGrowth = 0;
    this.terminationHistory = [];
  }
}
