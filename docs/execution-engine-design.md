# 执行引擎设计文档

## 概述

Mini Agent 的执行引擎是一个基于状态机的智能循环系统，实现了 OBSERVE → PLAN → ACT → EVALUATE → REFLECT 的执行流程。本文档详细介绍执行引擎的架构设计、状态机模型、内存模型和核心组件。

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    ExecutionEngine                           │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │OBSERVE  │→│  PLAN   │→│   ACT   │→│EVALUATE │       │
│  │ 阶段    │  │  阶段   │  │  阶段   │  │  阶段   │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
│       │            │            │            │             │
│       ↓            ↓            ↓            ↓             │
│  ┌─────────────────────────────────────────────────┐       │
│  │              核心组件层                           │       │
│  ├─────────────────────────────────────────────────┤       │
│  │  StateDigestGenerator  │  DeltaDetector         │       │
│  │  Reflector             │  Evaluator             │       │
│  │  TerminationChecker    │  ParallelExecutor      │       │
│  │  DeduplicationEngine   │  AgentErrorHandler     │       │
│  └─────────────────────────────────────────────────┘       │
│       │            │            │            │             │
│       ↓            ↓            ↓            ↓             │
│  ┌─────────────────────────────────────────────────┐       │
│  │              记忆系统层                           │       │
│  ├─────────────────────────────────────────────────┤       │
│  │  ConversationHistory    │  ToolMemory           │       │
│  │  SummaryMemory          │  TokenManager         │       │
│  └─────────────────────────────────────────────────┘       │
│       │            │            │            │             │
│       ↓            ↓            ↓            ↓             │
│  ┌─────────────────────────────────────────────────┐       │
│  │              外部依赖层                           │       │
│  ├─────────────────────────────────────────────────┤       │
│  │  ChatOpenAI (LLM)       │  ToolRegistry         │       │
│  │  ToolExecutor           │  SummaryGenerator     │       │
│  └─────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## 状态机模型

### 状态定义

```typescript
type ExecutionPhase =
  | 'OBSERVE' // 观察阶段
  | 'PLAN' // 规划阶段
  | 'ACT' // 执行阶段
  | 'EVALUATE' // 评估阶段
  | 'REFLECT'; // 反思阶段
```

### 状态转移图

```
                    ┌──────────────────┐
                    │                  │
                    ▼                  │
              ┌──────────┐            │
              │ OBSERVE  │            │
              └──────────┘            │
                    │                 │
                    ▼                 │
              ┌──────────┐            │
         ┌───│   PLAN   │────────────┤
         │   └──────────┘            │
         │         │                 │
         │         ▼                 │
         │   ┌──────────┐            │
         │   │   ACT    │            │
         │   └──────────┘            │
         │         │                 │
         │         ▼                 │
         │   ┌──────────┐            │
         │   │ EVALUATE │            │
         │   └──────────┘            │
         │         │                 │
         │         ▼                 │
         │   ┌──────────┐            │
         │   │ REFLECT  │            │
         │   └──────────┘            │
         │         │                 │
         │         ▼                 │
         │   ┌──────────┐            │
         └──→│ 继续循环  │            │
             └──────────┘            │
                    │                 │
                    ▼                 │
              ┌──────────┐            │
              │ 终止执行  │←───────────┘
              └──────────┘
```

### 状态转移规则

| 当前状态 | 转移条件     | 下一状态 | 说明               |
| -------- | ------------ | -------- | ------------------ |
| OBSERVE  | 正常流程     | PLAN     | 收集状态后进入规划 |
| PLAN     | 生成计划     | ACT      | 计划生成后进入执行 |
| PLAN     | 返回最终答案 | 终止     | 规划器直接返回答案 |
| ACT      | 执行完成     | EVALUATE | 工具执行后进入评估 |
| EVALUATE | 评分 ≥ 0.8   | REFLECT  | 评估良好，进入反思 |
| EVALUATE | 评分 < 0.4   | PLAN     | 评估较差，重新规划 |
| EVALUATE | 其他评分     | REFLECT  | 评估一般，进入反思 |
| REFLECT  | 继续执行     | OBSERVE  | 反思决定继续循环   |
| REFLECT  | 重试计划     | PLAN     | 反思决定重新规划   |
| REFLECT  | 返回答案     | 终止     | 反思决定返回答案   |
| REFLECT  | 降级处理     | 终止     | 反思决定降级       |

## 执行配置

```typescript
interface ExecutionConfig {
  // 基础配置
  maxIterations: number; // 最大迭代次数（默认 10）
  maxExecutionTime: number; // 最大执行时间（默认 300000ms）
  maxWorkingMemorySize: number; // 工作记忆大小（默认 10）
  maxToolMemorySize: number; // 工具记忆大小（默认 100）
  summaryTriggerRound: number; // 摘要触发轮数（默认 5）
  summaryTriggerTokens: number; // 摘要触发 Token（默认 8000）
  tokenThreshold: number; // Token 阈值（默认 0.9）
  toolTimeout: number; // 工具超时（默认 30000ms）
  maxRetryPerTool: number; // 每工具最大重试（默认 3）

  // 并行执行配置
  enableParallelExecution: boolean; // 启用并行执行（默认 true）
  maxConcurrentTools: number; // 最大并发工具数（默认 5）
  waveTimeout: number; // 波次超时（默认 60000ms）

  // 安全配置
  enableStateProtection: boolean; // 启用状态保护（默认 true）
  maxStateSize: number; // 最大状态大小（默认 1000）
}
```

## 核心组件

### 1. ExecutionEngine

```typescript
class ExecutionEngine {
  constructor(config: Partial<ExecutionConfig>, deps: ExecutionEngineDeps);

  async run(
    userPrompt: string,
    conversationHistory?: Array<{ role: string; content: string }>
  ): Promise<{
    finalAnswer: string;
    metrics: ExecutionMetrics;
  }>;
}

interface ExecutionEngineDeps {
  llm: ChatOpenAI;
  tools: ToolInfo[];
  generateSummary: (messages: Message[]) => Promise<string>;
  executeTool: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<string>;
  reflectorConfig?: Partial<ReflectorConfig>;
  longTermMemoryReader?: LongTermMemoryReader;
  userInfoContext?: string;
}
```

### 2. StateDigestGenerator

```typescript
interface StateSnapshot {
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

interface StateDigest {
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

class StateDigestGenerator {
  generate(snapshot: StateSnapshot): StateDigest;
}
```

### 3. DeltaDetector

```typescript
interface StateDelta {
  progress_delta: number;
  new_errors: number;
  new_tools_used: boolean;
  information_growth_rate: number;
  should_skip_plan: boolean;
  skip_reason?: string;
  timestamp: number;
}

class DeltaDetector {
  detect(current: StateSnapshot, previous: StateSnapshot | null): StateDelta;
}
```

### 4. Evaluator

```typescript
interface EvaluationScore {
  accuracy: number; // 准确性评估 (0-1)
  completeness: number; // 完整性评估 (0-1)
  efficiency: number; // 效率评估 (0-1)
  confidence: number; // 置信度评估 (0-1)
  overall: number; // 综合评分 (0-1)
  details: {
    successCount: number;
    failureCount: number;
    totalCount: number;
    avgExecutionTime: number;
    informationGrowth: number;
    planCompletion: number;
  };
  suggestions: string[];
  timestamp: number;
  iteration: number;
}

interface EvaluationContext {
  currentPlan: Plan | null;
  toolResults: Array<{
    toolName: string;
    status: string;
    result?: string;
    error?: string;
    executionTime?: number;
  }>;
  toolMemory: ToolRecord[];
  stateSnapshot: StateSnapshot;
  iteration: number;
  maxIterations: number;
  metrics: ExecutionMetrics;
}

class Evaluator {
  constructor(config?: Partial<EvaluatorConfig>);
  evaluate(context: EvaluationContext): EvaluationScore;
}
```

### 5. Reflector

```typescript
type ReflectionDecision =
  | 'continue' // 继续执行
  | 'retry' // 重试工具
  | 'new_plan' // 重新规划
  | 'finalize_answer' // 生成最终答案
  | 'fallback'; // 降级处理

interface ReflectionResult {
  decision: ReflectionDecision;
  reasoning: string;
  shouldRetryTools?: string[];
  confidence: number;
  informationGrowth?: number;
  errorAttribution?: ErrorAttribution;
  detailedReasoning?: ReflectionReasoning;
  failure_reflection?: FailureReflection;
  success_reflection?: SuccessReflection;
}

interface ReflectionContext {
  currentPlan: Plan | null;
  toolResults: Array<{
    toolName: string;
    status: string;
    result?: string;
    error?: string;
    executionTime?: number;
  }>;
  iteration: number;
  maxIterations: number;
  toolMemory: ToolRecord[];
  remainingRetryBudget: number;
}

class Reflector {
  constructor(config?: Partial<ReflectorConfig>);
  reflect(context: ReflectionContext): Promise<ReflectionResult>;
}
```

### 6. ParallelExecutor

```typescript
interface ExecutionWave {
  waveIndex: number;
  steps: PlanStep[];
}

interface WaveExecutionResult {
  waveIndex: number;
  results: ToolExecutionResult[];
  executionTime: number;
}

// 解析依赖图
function parseDependencyGraph(plan: Plan): Map<string, Set<string>>;

// 拓扑排序
function topologicalSort(steps: PlanStep[]): PlanStep[];

// 将步骤分组为执行波次
function groupIntoWaves(steps: PlanStep[]): ExecutionWave[];

// 构建执行波次（入口函数）
function buildExecutionWaves(plan: Plan): ExecutionWave[];

// 解析参数中的占位符
function resolveDependencies(
  stepArgs: Record<string, unknown>,
  previousResults: Map<string, ToolExecutionResult>
): Record<string, unknown>;

// 执行单个波次
function executeWave(
  wave: ExecutionWave,
  toolExecutor: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<string>,
  previousResults: Map<string, ToolExecutionResult>,
  config: {
    toolTimeout: number;
    maxConcurrentTools: number;
    waveTimeout: number;
  }
): Promise<WaveExecutionResult>;

// 执行所有波次（主入口）
function executeAllWaves(
  waves: ExecutionWave[],
  toolExecutor: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<string>,
  config: {
    toolTimeout: number;
    maxConcurrentTools: number;
    waveTimeout: number;
  }
): Promise<{
  results: ToolExecutionResult[];
  duration: number;
}>;
```

### 7. TerminationChecker

```typescript
interface TerminationConfig {
  maxIterations: number;
  maxExecutionTime: number;
  maxTokens: number;
  tokenBudgetThreshold: number;
  similarityThreshold: number;
  noGrowthIterationsRequired: number;
  failureBudget: number;
  warningThresholdRatio: number;
  maxConsecutiveFailures: number;
  consecutiveFailuresRequired: number;
}

interface TerminationCheckResult {
  shouldTerminate: boolean;
  reason?: TerminationReason;
  message?: string;
}

type TerminationReason =
  | 'planner_final_high_confidence'
  | 'planner_final_medium_confidence'
  | 'max_iterations_reached'
  | 'no_information_growth'
  | 'convergence_detected'
  | 'token_limit_exceeded'
  | 'execution_timeout'
  | 'retry_budget_exhausted'
  | 'all_tools_failed'
  | 'system_error';

class TerminationChecker {
  constructor(config?: Partial<TerminationConfig>);

  updateIteration(): void;
  recordFailure(): void;
  recordSuccess(): void;
  recordInformationGrowth(growth: number): void;

  check(params: {
    plannerDecision?: string;
    plannerConfidence?: number;
    tokenCount?: number;
  }): TerminationCheckResult;

  getStatus(): {
    iteration: number;
    elapsedTime: number;
    failureCount: number;
    consecutiveNoGrowthCount: number;
    lastInformationGrowth: number;
    isNearLimit: boolean;
  };

  getTerminationHistory(): TerminationCheckResult[];
  reset(): void;
}
```

## 内存模型

### 内存层次结构

```
┌─────────────────────────────────────────────────────────────┐
│                    内存系统架构                               │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │              工作记忆 (Working Memory)                │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  ConversationHistory                        │   │   │
│  │  │  - 最近 N 条消息                             │   │   │
│  │  │  - FIFO 淘汰策略                             │   │   │
│  │  │  - Token 限制管理                            │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              工具记忆 (Tool Memory)                  │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  ToolMemory                                 │   │   │
│  │  │  - 工具调用记录                               │   │   │
│  │  │  - 输入哈希去重                               │   │   │
│  │  │  - 成功/失败统计                              │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              摘要记忆 (Summary Memory)               │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  SummaryMemory                              │   │   │
│  │  │  - LLM 生成的摘要                            │   │   │
│  │  │  - 历史压缩存储                              │   │   │
│  │  │  - 关键信息保留                              │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 内存管理策略

#### 1. 工作记忆管理

```typescript
class ConversationHistory {
  private messages: Message[] = [];
  private maxSize: number;
  private maxTokens: number;

  constructor(maxSize: number = 50, maxTokens: number = 4000);

  addMessage(message: Omit<Message, 'timestamp'>): void;
  addUserMessage(content: string): void;
  addAssistantMessage(content: string): void;
  addToolMessage(content: string, toolCallId: string, toolName: string): void;

  getMessages(): Message[];
  getRecentMessages(limit: number): Message[];
  getMessagesAsBaseMessages(): BaseMessage[];

  clear(): void;
  size(): number;
  estimateTokens(): number;
  exportToJSON(): string;
}
```

#### 2. 工具记忆管理

```typescript
class ToolMemory {
  private records: ToolRecord[] = [];
  private maxSize: number;
  private recentQueryLimit: number;

  constructor(maxSize: number = 100, recentQueryLimit: number = 5);

  addRecord(record: Omit<ToolRecord, 'inputHash' | 'timestamp'>): void;
  getRecords(): ToolRecord[];
  getRecentRecords(limit: number): ToolRecord[];
  findDuplicate(
    toolName: string,
    arguments_: Record<string, unknown>
  ): ToolRecord | null;
  getToolStats(toolName: string): {
    successCount: number;
    failureCount: number;
    avgExecutionTime: number;
  };
  getFailureCount(toolName: string): number;
  queryToolMemory(
    toolName?: string,
    inputHash?: string,
    limit?: number
  ): ToolRecord[];
  clear(): void;
  size(): number;
  exportToJSON(): string;
}
```

#### 3. 摘要记忆管理

```typescript
class SummaryMemory {
  private summaries: Summary[] = [];
  private maxSize: number;

  constructor(maxSize: number = 20);

  addSummary(summary: Omit<Summary, 'id' | 'timestamp'>): void;
  getSummaries(): Summary[];
  getLatestSummary(): Summary | null;
  clear(): void;
  size(): number;
  exportToJSON(): string;
}
```

## 执行流程示例

### 场景：用户询问天气

```
1. OBSERVE
   - 收集状态快照
   - 生成状态摘要
   - 检测状态变更
   - 更新工作记忆（添加用户消息）

2. PLAN
   - 构建规划上下文
   - 调用 LLM 生成计划
   - 解析计划响应

3. ACT
   - 调用 tavily 搜索工具
   - 获取天气信息

4. EVALUATE
   - 评估工具执行结果
   - 计算评分 (假设 0.9)
   - 评分 >= 0.8，决定进入 REFLECT

5. REFLECT
   - 分析执行结果
   - 决策：finalize_answer
   - 生成最终答案

6. 终止
   - 返回最终答案和执行指标
```

### 场景：工具执行失败

```
1-3. OBSERVE, PLAN, ACT (同上的前几步)

4. EVALUATE
   - 评估工具执行结果
   - 计算评分 (假设 0.3)
   - 评分 < 0.4，决定进入 PLAN 重新规划

5. PLAN
   - 使用更新后的上下文重新规划
   - 可能选择不同工具或参数

6. EVALUATE
   - 再次评估

7. REFLECT
   - 根据评估结果决定是否继续
```

## 错误处理

### AgentErrorHandler

```typescript
class AgentErrorHandler {
  handle(error: Error, context: ErrorContext): ErrorResult;
  classify(error: Error): ErrorType;
  recover(error: Error, context: ErrorContext): RecoveryAction;
}

type ErrorType = 'network' | 'timeout' | 'parameter' | 'unknown';

type RecoveryAction =
  | { type: 'retry'; delay: number }
  | { type: 'fallback'; alternative: string }
  | { type: 'abort'; reason: string };
```

## 指标收集

### ExecutionMetrics

```typescript
interface ExecutionMetrics {
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
```

## 扩展点

### 自定义执行阶段

```typescript
interface ExecutionPhaseHandler {
  name: ExecutionPhase;
  execute(context: PhaseContext): Promise<PhaseResult>;
}

class CustomPhaseHandler implements ExecutionPhaseHandler {
  name = 'CUSTOM';

  async execute(context: PhaseContext): Promise<PhaseResult> {
    // 自定义阶段逻辑
    return { nextPhase: 'NEXT_PHASE' };
  }
}
```

### 自定义终止条件

```typescript
interface TerminationCondition {
  name: string;
  check(context: ExecutionContext): boolean;
  getReason(): string;
}

class CustomTerminationCondition implements TerminationCondition {
  name = 'custom';

  check(context: ExecutionContext): boolean {
    // 自定义终止检查
    return false;
  }

  getReason(): string {
    return 'Custom termination reason';
  }
}
```
