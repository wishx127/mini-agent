## 执行指标能力

### Requirement：关键指标收集

系统应在循环执行过程中收集关键指标，用于性能分析和优化。

#### Scenario：基础执行指标

- **WHEN** 执行完成
- **THEN** 返回指标包含：
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

#### Scenario：迭代级指标

- **WHEN** 每轮循环完成
- **THEN** 系统记录该轮的指标：
  ```typescript
  interface IterationMetrics {
    iteration: number;
    phaseDurations: {
      observe: number;
      plan: number;
      act: number;
      evaluate: number;
      reflect: number;
    };
    toolsExecuted: string[];
    toolsSucceeded: number;
    toolsFailed: number;
    informationGrowth: number;
    tokensConsumed: number;
  }
  ```

#### Scenario：工具级指标

- **WHEN** 工具执行完毕
- **THEN** 系统记录工具指标：
  ```typescript
  interface ToolMetrics {
    toolName: string;
    duration: number;
    status: 'pending' | 'success' | 'failed' | 'timeout';
    inputSize: number;
    outputSize: number;
    tokensCost: number;
    errorType?: string;
    iteration: number;
  }
  ```

---

### Requirement：指标汇总和聚合

系统应支持对指标进行聚合分析，生成执行摘要。

#### Scenario：工具统计聚合

- **WHEN** 执行完成，需要工具级统计
- **THEN** 返回各工具的聚合数据：
  ```typescript
  interface ToolAggregateMetrics {
    [toolName: string]: {
      callCount: number;
      successCount: number;
      failureCount: number;
      avgDuration: number;
      avgInputSize: number;
      avgOutputSize: number;
      totalTokensCost: number;
    };
  }
  ```

#### Scenario：时间分布

- **WHEN** 分析执行时间分布
- **THEN** 系统提供各阶段的时间分布和平均耗时

#### Scenario：成功率统计

- **WHEN** 需要评估执行质量
- **THEN** 返回：
  ```typescript
  interface SuccessMetrics {
    overallSuccessRate: number;
    toolSuccessRate: number;
    informationAcquisitionRate: number;
    convergenceSpeed: number;
  }
  ```

---

### Requirement：异常和错误指标

系统应详细记录执行过程中的异常和错误。

#### Scenario：错误分类统计

- **WHEN** 执行期间发生错误
- **THEN** 指标包含错误分类统计：
  ```typescript
  interface ErrorMetrics {
    toolErrors: Record<string, number>;
    timeoutErrors: number;
    parameterErrors: number;
    networkErrors: number;
    tokenLimitHits: number;
  }
  ```

#### Scenario：错误事件日志

- **WHEN** 需要详细错误信息
- **THEN** 系统提供错误事件列表：
  ```typescript
  interface ErrorEvent {
    timestamp: number;
    errorType: string;
    tool?: string;
    iteration: number;
    errorMessage: string;
    isRecoverable: boolean;
  }
  ```

---

### Requirement：资源消耗指标

系统应追踪资源消耗情况，包括 token、时间、内存等。

#### Scenario：Token 消耗详解

- **WHEN** 需要了解 token 消耗
- **THEN** 返回：
  ```typescript
  interface TokenMetrics {
    tokensByPhase: {
      observe: number;
      plan: number;
      act: number;
      evaluate: number;
      reflect: number;
    };
    tokensBySource: {
      conversationHistory: number;
      workingMemory: number;
      summaryMemory: number;
    };
  }
  ```

#### Scenario：资源效率指标

- **WHEN** 评估执行效率
- **THEN** 返回：
  ```typescript
  interface EfficiencyMetrics {
    tokensPerSuccessfulTool: number;
    timePerNewInformation: number;
    successRatePerIteration: number[];
  }
  ```

---

### Requirement：决策和选择指标

系统应记录规划器、反思器的决策统计。

#### Scenario：规划器置信度分布

- **WHEN** 分析规划质量
- **THEN** 返回所有规划的置信度分布：
  ```typescript
  interface PlannerMetrics {
    averageConfidence: number;
    minConfidence: number;
    maxConfidence: number;
    confidenceByIteration: number[];
  }
  ```

#### Scenario：反思决策统计

- **WHEN** 分析循环进展
- **THEN** 返回：
  ```typescript
  interface ReflectionMetrics {
    decisionCounts: Record<ReflectionDecision, number>;
    averageTimeToDecision: number;
  }
  ```

---

### Requirement：ExecutionMetricsCollector 类实现

```typescript
class ExecutionMetricsCollector {
  private iterations: IterationMetrics[];
  private toolMetrics: ToolMetrics[];
  private startTime: number;

  startIteration(iteration: number): void;
  recordPhaseDuration(phase: ExecutionPhase, duration: number): void;
  recordToolExecution(metrics: ToolMetrics): void;
  endIteration(): void;
  getSummary(): ExecutionMetrics;
  getToolAggregates(): ToolAggregateMetrics;
  getErrorMetrics(): ErrorMetrics;
}
```
