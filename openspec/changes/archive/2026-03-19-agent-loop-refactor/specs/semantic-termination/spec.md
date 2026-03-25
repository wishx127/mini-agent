## 语义终止条件能力

### Requirement：规划器信号终止

当规划器输出 `type: "final"` 且置信度达到阈值时，系统应立即终止循环。

#### Scenario：高置信度最终答案

- **WHEN** 规划器返回 `type: "final"`，confidence ≥ 0.8
- **THEN** 反思阶段返回 done=true，reason="planner_final_high_confidence"

#### Scenario：中等置信度最终答案

- **WHEN** 规划器返回 `type: "final"`，0.6 ≤ confidence < 0.8
- **THEN** 反思阶段返回 done=true，reason="planner_final_medium_confidence"

#### Scenario：低置信度最终答案

- **WHEN** 规划器返回 `type: "final"`，confidence < 0.6
- **THEN** 反思阶段需判断，可能转为 "continue" 而非立即终止

---

### Requirement：无信息增长检测

当连续多轮工具调用未返回新信息时，系统应检测到收敛并终止。

#### Scenario：连续两轮相同结果

- **WHEN** 第 N 轮和第 N+1 轮工具结果完全相同（字符串相等）
- **THEN** 反思阶段返回 done=true，reason="no_information_growth"

#### Scenario：信息相似度高

- **WHEN** 第 N 轮和第 N+1 轮工具结果的余弦相似度 > 0.9
- **THEN** 反思阶段认定为无新信息增长，考虑终止

#### Scenario：长期探索无进展

- **WHEN** 最近 3 轮工具调用的平均信息增长率 < 0.1（信息密度极低）
- **THEN** 反思阶段返回 done=true，reason="convergence_detected"

#### Scenario：无信息增长不触发（前两轮除外）

- **WHEN** 仅执行了 1-2 轮，即使结果相同
- **THEN** 系统不触发无信息增长检测，允许继续探索

---

### Requirement：最大迭代硬限制

系统应设置循环迭代的硬上限（默认 10 轮）。达到此限制时立即终止。

#### Scenario：迭代计数达到上限

- **WHEN** iterationCount == maxIterations（默认 10）
- **THEN** 循环立即终止，reason="max_iterations_reached"

#### Scenario：可配置迭代上限

- **WHEN** 系统初始化时设置 maxIterations=15
- **THEN** 循环在第 15 次迭代后强制终止

#### Scenario：临界判断

- **WHEN** iterationCount == maxIterations - 1（如 9），准备第 10 轮
- **THEN** 反思阶段允许第 10 轮执行，完成后强制终止

---

### Requirement：Token 预算检查

系统应在循环中监控 token 消耗，当接近上限时触发终止或压缩。

#### Scenario：Token 预算警告

- **WHEN** remainingTokenBudget < 30% 的模型上下文窗口
- **THEN** 系统记录警告，反思阶段可能建议加速终止

#### Scenario：Token 预算超限

- **WHEN** conversationHistory + toolMemory 总 token > 75% 的模型上下文窗口
- **THEN** 循环立即终止，reason="token_limit_exceeded"

#### Scenario：摘要压缩触发

- **WHEN** Token 占用 > 60%，系统决定压缩而非终止
- **THEN** OBSERVE 阶段触发 summaryMemory 生成，压缩工作记忆

#### Scenario：Token 状态查询

- **WHEN** 任何阶段需查询 token 状态
- **THEN** 系统提供接口返回 usedTokens / totalBudget / remainingTokens

---

### Requirement：超时终止

系统应设置总执行时间的硬限制（默认 300000ms）。超时时立即中止所有操作。

#### Scenario：执行时间超时

- **WHEN** 从执行开始到当前时间 > maxExecutionTime（默认 300000ms）
- **THEN** 循环立即终止，reason="execution_timeout"

#### Scenario：可配置超时

- **WHEN** 系统初始化时设置 maxExecutionTime=600000
- **THEN** 循环最多执行 600 秒

#### Scenario：波次级超时

- **WHEN** 某个波次（并行工具组）的总耗时 > waveTimeout（默认 60000ms）
- **THEN** 该波次中仍未完成的工具调用被中止

#### Scenario：优雅超时处理

- **WHEN** 执行接近超时（剩余 5 秒）
- **THEN** 系统尝试生成最佳努力的答案，而非直接报错

---

### Requirement：降级触发终止

当工具失败次数超过重试预算或检测到无法恢复的错误时，系统应触发降级终止。

#### Scenario：重试预算耗尽

- **WHEN** 某工具失败次数达到 maxRetryPerTool（默认 3）
- **THEN** 反思阶段返回 done=true，reason="retry_budget_exhausted"

#### Scenario：全部工具失败

- **WHEN** 某轮所有工具调用均失败，且无可恢复路径
- **THEN** 反思阶段返回 done=true，reason="all_tools_failed"

#### Scenario：系统性错误

- **WHEN** 检测到系统性错误（如 API 限流、认证失败）
- **THEN** 反思阶段返回 done=true，reason="system_error"

---

### Requirement：TerminationChecker 类实现

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

interface TerminationCheckResult {
  shouldTerminate: boolean;
  reason?: TerminationReason;
  message?: string;
}

class TerminationChecker {
  private config: TerminationConfig;
  private startTime: number;
  private iteration: number;
  private failureCount: number;
  private consecutiveNoGrowthCount: number;
  private lastInformationGrowth: number;
  private terminationHistory: TerminationCheckResult[];

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
