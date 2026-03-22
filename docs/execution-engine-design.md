# 执行引擎设计文档

## 概述

Mini Agent 的执行引擎是一个基于状态机的智能循环系统，实现了 OBSERVE → PLAN → ACT → REFLECT 的执行流程。本文档详细介绍执行引擎的架构设计、状态机模型、内存模型和核心组件。

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    ExecutionEngine                           │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │OBSERVE  │→│  PLAN   │→│   ACT   │→│ REFLECT │       │
│  │ 阶段    │  │  阶段   │  │  阶段   │  │  阶段   │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
│       │            │            │            │             │
│       ↓            ↓            ↓            ↓             │
│  ┌─────────────────────────────────────────────────┐       │
│  │              核心组件层                           │       │
│  ├─────────────────────────────────────────────────┤       │
│  │  PlanningContextFactory  │  ParallelExecutor    │       │
│  │  DeduplicationEngine     │  Reflector           │       │
│  │  TerminationChecker      │  MetricsCollector    │       │
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
enum ExecutionPhase {
  OBSERVE = 'OBSERVE', // 观察阶段
  PLAN = 'PLAN', // 规划阶段
  ACT = 'ACT', // 执行阶段
  EVALUATE = 'EVALUATE', // 评估阶段
  REFLECT = 'REFLECT', // 反思阶段
}
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
  private tokenManager: TokenManager;

  // FIFO 淘汰
  append(message: Message): void {
    this.messages.push(message);
    if (this.messages.length > this.maxSize) {
      this.messages.shift(); // 移除最旧的消息
    }
  }

  // Token 限制
  async appendWithTokenCheck(message: Message): Promise<void> {
    const estimatedTokens = this.tokenManager.estimateTokens(message);
    if (this.getCurrentTokens() + estimatedTokens > this.tokenThreshold) {
      await this.generateSummary();
    }
    this.append(message);
  }
}
```

#### 2. 工具记忆管理

```typescript
class ToolMemory {
  private records: ToolRecord[] = [];
  private hashIndex: Map<string, string> = new Map();
  private maxSize: number;
  private retentionPeriod: number;

  // 去重检查
  checkDuplicate(toolName: string, args: Record<string, unknown>): boolean {
    const hash = this.calculateInputHash(toolName, args);
    return this.hashIndex.has(hash);
  }

  // 记录工具调用
  record(
    toolName: string,
    args: Record<string, unknown>,
    result: ToolResult
  ): void {
    const record: ToolRecord = {
      toolName,
      args,
      result,
      timestamp: Date.now(),
      inputHash: this.calculateInputHash(toolName, args),
    };

    this.records.push(record);
    this.hashIndex.set(record.inputHash, record.toolName);

    // 清理过期记录
    this.cleanupExpiredRecords();
  }

  // 清理策略
  private cleanupExpiredRecords(): void {
    const cutoff = Date.now() - this.retentionPeriod;
    this.records = this.records.filter((r) => r.timestamp > cutoff);

    if (this.records.length > this.maxSize) {
      this.records = this.records.slice(-this.maxSize);
    }

    // 重建索引
    this.rebuildIndex();
  }
}
```

#### 3. 摘要记忆管理

```typescript
class SummaryMemory {
  private summaries: Summary[] = [];
  private triggerRound: number;
  private triggerTokens: number;

  // 生成摘要
  async generate(
    conversationHistory: ConversationHistory,
    toolMemory: ToolMemory
  ): Promise<Summary> {
    const context = this.buildContext(conversationHistory, toolMemory);
    const content = await this.llmGenerateSummary(context);

    const summary: Summary = {
      content,
      timestamp: Date.now(),
      roundCount: conversationHistory.getRoundCount(),
      tokenCount: this.tokenManager.countTokens(content),
    };

    this.summaries.push(summary);
    return summary;
  }

  // 触发检查
  shouldTrigger(conversationHistory: ConversationHistory): boolean {
    // 基于轮数
    if (conversationHistory.getRoundCount() % this.triggerRound === 0) {
      return true;
    }

    // 基于 Token
    const estimatedTokens = this.tokenManager.estimateTokens(
      conversationHistory.getText()
    );
    if (estimatedTokens > this.triggerTokens) {
      return true;
    }

    return false;
  }
}
```

## 核心组件

### 1. ExecutionEngine

执行引擎的主类，负责协调各个阶段的执行。

```typescript
class ExecutionEngine {
  private phase: ExecutionPhase = ExecutionPhase.OBSERVE;
  private iteration: number = 0;
  private startTime: number = 0;

  // 记忆系统
  private conversationHistory: ConversationHistory;
  private toolMemory: ToolMemory;
  private summaryMemory: SummaryMemory;

  // 核心组件
  private planningContextFactory: PlanningContextFactory;
  private parallelExecutor: ParallelExecutor;
  private deduplicationEngine: DeduplicationEngine;
  private reflector: Reflector;
  private terminationChecker: TerminationChecker;
  private metricsCollector: MetricsCollector;

  async run(userPrompt: string): Promise<ExecutionResult> {
    this.initialize(userPrompt);

    while (!this.shouldTerminate()) {
      switch (this.phase) {
        case ExecutionPhase.OBSERVE:
          await this.observe();
          this.phase = ExecutionPhase.PLAN;
          break;

        case ExecutionPhase.PLAN:
          const plan = await this.plan();
          if (plan.isFinalAnswer) {
            return this.finalize(plan.finalAnswer);
          }
          this.currentPlan = plan;
          this.phase = ExecutionPhase.ACT;
          break;

        case ExecutionPhase.ACT:
          await this.act();
          this.phase = ExecutionPhase.REFLECT;
          break;

        case ExecutionPhase.REFLECT:
          const reflection = await this.reflect();
          this.phase = this.handleReflection(reflection);
          break;
      }

      this.iteration++;
      this.metricsCollector.recordIteration(this.iteration);
    }

    return this.finalizeWithTermination();
  }
}
```

### 2. PlanningContextFactory

负责构建规划上下文，为 LLM 提供完整的执行信息。

```typescript
class PlanningContextFactory {
  async build(
    conversationHistory: ConversationHistory,
    toolMemory: ToolMemory,
    summaryMemory: SummaryMemory,
    deduplicationEngine: DeduplicationEngine,
    availableTools: ToolInfo[]
  ): Promise<PlanningContext> {
    return {
      conversationHistory: conversationHistory.getRecent(10),
      conversationSummary: await summaryMemory.getLatest(),
      toolHistory: toolMemory.getSummary(),
      deduplicationStats: deduplicationEngine.getStats(),
      availableTools: availableTools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
      executionConstraints: this.buildConstraints(),
      previousErrors: toolMemory.getRecentErrors(5),
    };
  }
}
```

### 3. ParallelExecutor

负责并行执行工具调用，支持依赖图解析和波次执行。

```typescript
class ParallelExecutor {
  async execute(
    plan: Plan,
    executeTool: ExecuteToolFunction
  ): Promise<ToolResult[]> {
    // 构建依赖图
    const graph = this.buildDependencyGraph(plan.steps);

    // 拓扑排序
    const waves = this.topologicalSort(graph);

    // 波次执行
    const results: ToolResult[] = [];
    for (const wave of waves) {
      const waveResults = await Promise.allSettled(
        wave.map((step) => this.executeStep(step, executeTool))
      );
      results.push(...waveResults.map((r) => this.normalizeResult(r)));
    }

    return results;
  }

  private buildDependencyGraph(steps: PlanStep[]): DependencyGraph {
    const graph = new DependencyGraph();

    for (const step of steps) {
      graph.addNode(step.id, step);

      for (const dep of step.dependencies) {
        graph.addEdge(dep, step.id);
      }
    }

    return graph;
  }
}
```

### 4. DeduplicationEngine

负责工具调用去重，避免重复执行相同的工具调用。

```typescript
class DeduplicationEngine {
  private records: Map<string, ToolRecord> = new Map();
  private retryBudgets: Map<string, number> = new Map();

  check(toolName: string, args: Record<string, unknown>): DedupResult {
    const hash = this.calculateInputHash(toolName, args);
    const key = `${toolName}:${hash}`;

    if (this.records.has(key)) {
      const record = this.records.get(key)!;
      const budget = this.retryBudgets.get(key) || 0;

      if (budget > 0) {
        this.retryBudgets.set(key, budget - 1);
        return { isDuplicate: true, shouldRetry: true, budget };
      }

      return { isDuplicate: true, shouldRetry: false, budget: 0 };
    }

    return { isDuplicate: false, shouldRetry: false };
  }

  record(
    toolName: string,
    args: Record<string, unknown>,
    result: ToolResult
  ): void {
    const hash = this.calculateInputHash(toolName, args);
    const key = `${toolName}:${hash}`;

    this.records.set(key, {
      toolName,
      args,
      result,
      timestamp: Date.now(),
    });

    this.retryBudgets.set(key, this.maxRetryPerTool);
  }
}
```

### 5. Reflector

负责反思阶段的决策，分析工具执行结果并做出决策。

```typescript
class Reflector {
  private strategy: ReflectorStrategy;

  async reflect(
    toolResults: ToolResult[],
    planningContext: PlanningContext,
    metrics: ExecutionMetrics
  ): Promise<ReflectionResult> {
    const successRate = this.calculateSuccessRate(toolResults);
    const informationGrowth = this.calculateInformationGrowth(toolResults);
    const confidence = this.calculateConfidence(toolResults, metrics);

    const decision = this.makeDecision(
      successRate,
      informationGrowth,
      confidence,
      this.strategy
    );

    return {
      decision,
      confidence,
      successRate,
      informationGrowth,
      reasons: this.buildReasons(decision, successRate, informationGrowth),
      diagnosticData: {
        toolResults: toolResults.map((r) => ({
          toolName: r.toolName,
          success: r.success,
          duration: r.duration,
        })),
        metrics,
      },
    };
  }

  private makeDecision(
    successRate: number,
    informationGrowth: number,
    confidence: number,
    strategy: ReflectorStrategy
  ): ReflectionDecision {
    // 保守策略
    if (strategy === 'conservative') {
      if (successRate < 0.5) return 'fallback';
      if (informationGrowth < 0.1) return 'finalize_answer';
      if (confidence < 0.6) return 'retry';
    }

    // 平衡策略
    if (strategy === 'balanced') {
      if (successRate < 0.3) return 'fallback';
      if (informationGrowth < 0.05) return 'finalize_answer';
      if (confidence < 0.5) return 'retry';
    }

    // 激进策略
    if (strategy === 'aggressive') {
      if (successRate < 0.1) return 'fallback';
      if (informationGrowth < 0.01) return 'finalize_answer';
    }

    return 'continue';
  }
}
```

### 6. TerminationChecker

负责检查终止条件，支持多种语义终止条件。

```typescript
class TerminationChecker {
  check(
    phase: ExecutionPhase,
    iteration: number,
    startTime: number,
    metrics: ExecutionMetrics,
    plan?: Plan
  ): TerminationResult {
    const reasons: string[] = [];

    // 规划器信号终止
    if (plan?.isFinalAnswer) {
      reasons.push('规划器返回最终答案');
    }

    // 最大迭代次数
    if (iteration >= this.config.maxIterations) {
      reasons.push(`达到最大迭代次数 (${this.config.maxIterations})`);
    }

    // 最大执行时间
    const elapsed = Date.now() - startTime;
    if (elapsed >= this.config.maxExecutionTime) {
      reasons.push(`达到最大执行时间 (${this.config.maxExecutionTime}ms)`);
    }

    // Token 预算
    if (metrics.tokenUsage >= this.config.tokenThreshold) {
      reasons.push(`Token 使用量超过阈值 (${this.config.tokenThreshold})`);
    }

    // 工具失败预算
    if (metrics.failedTools >= this.config.maxFailedTools) {
      reasons.push(`工具失败次数超过预算 (${this.config.maxFailedTools})`);
    }

    return {
      shouldTerminate: reasons.length > 0,
      reasons,
      priority: this.calculatePriority(reasons),
    };
  }
}
```

## 数据流

### 完整执行流程

```
用户输入
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    OBSERVE 阶段                              │
├─────────────────────────────────────────────────────────────┤
│  1. 收集当前状态                                             │
│  2. 更新工作记忆                                             │
│  3. 构建 PlanningContext                                     │
│  4. 检查终止条件                                             │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    PLAN 阶段                                 │
├─────────────────────────────────────────────────────────────┤
│  1. 调用 LLM 生成计划                                        │
│  2. 解析计划响应                                             │
│  3. 验证计划合法性                                           │
│  4. 返回计划或最终答案                                       │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    ACT 阶段                                  │
├─────────────────────────────────────────────────────────────┤
│  1. 检查工具去重                                             │
│  2. 构建依赖图                                               │
│  3. 生成执行波次                                             │
│  4. 并行执行工具                                             │
│  5. 收集工具结果                                             │
│  6. 更新工具记忆                                             │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    REFLECT 阶段                              │
├─────────────────────────────────────────────────────────────┤
│  1. 评估工具执行成功率                                       │
│  2. 分析信息增长                                             │
│  3. 检测重复调用模式                                         │
│  4. 做出决策 (continue/retry/finalize/fallback)             │
│  5. 记录反思指标                                             │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
是否继续循环?
    │
    ├── 否 → 返回最终答案
    │
    └── 是 → 返回 OBSERVE 阶段
```

## 性能优化

### 1. 并行执行优化

- 自动识别可并行执行的工具
- 使用 Promise.allSettled 处理部分失败
- 波次级超时控制

### 2. 缓存优化

- PlanningContext 缓存
- 工具定义摘要缓存
- 去重结果缓存

### 3. 内存优化

- FIFO 淘汰策略
- 定期清理过期记录
- Token 限制管理

### 4. 指标采样

- 关键指标全量采样
- 详细指标概率采样
- 异常指标阈值采样

## 扩展性

### 1. 自定义反思策略

```typescript
const customStrategy: ReflectorStrategy = {
  name: 'custom',
  evaluate: (metrics) => {
    // 自定义评估逻辑
    return decision;
  },
};

const engine = new ExecutionEngine({
  reflectorStrategy: customStrategy,
});
```

### 2. 自定义终止条件

```typescript
const customTermination: TerminationCondition = {
  name: 'custom',
  check: (context) => {
    // 自定义检查逻辑
    return { shouldTerminate: false, reasons: [] };
  },
};

const engine = new ExecutionEngine({
  terminationConditions: [customTermination],
});
```

### 3. 自定义记忆策略

```typescript
const customMemoryStrategy: MemoryStrategy = {
  cleanup: (memory) => {
    // 自定义清理逻辑
  },
  compress: (memory) => {
    // 自定义压缩逻辑
  },
};

const engine = new ExecutionEngine({
  memoryStrategy: customMemoryStrategy,
});
```

## 总结

Mini Agent 的执行引擎通过状态机模型实现了智能的执行循环，通过分层内存系统管理执行上下文，通过并行执行和多种优化策略提升了执行性能。该设计具有良好的扩展性，支持自定义策略和条件，能够适应不同的使用场景。
