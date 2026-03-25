## 多轮循环执行能力

### Requirement：状态机驱动的循环执行

系统应实现显式的 OBSERVE → PLAN → ACT → EVALUATE → REFLECT 状态机，循环执行直到满足终止条件。每轮循环应按序进行观察、规划、执行、评估、反思，并根据反思结果决定是否继续循环或返回最终答案。

#### Scenario：正常多轮循环流程

- **WHEN** Agent 接收需要多步工具调用的复杂任务
- **THEN** 系统执行至少 2 轮循环，每轮包括 OBSERVE/PLAN/ACT/EVALUATE/REFLECT 五个阶段

#### Scenario：单轮终止

- **WHEN** 规划器在第一轮规划后输出 `type: "final"` 且置信度 ≥0.8
- **THEN** 系统在第一轮反思后终止，不进行第二轮循环

#### Scenario：循环中动态调整

- **WHEN** 第一轮工具执行失败，反思阶段判定为可恢复错误
- **THEN** 系统进入第二轮循环，规划器根据失败信息重新规划

---

### Requirement：阶段化上下文管理

每个阶段应维护和更新自己的上下文：OBSERVE 收集状态，PLAN 使用上下文，ACT 执行工具，EVALUATE 评估结果，REFLECT 反思决策。各阶段上下文应显式传递，防止隐藏依赖。

#### Scenario：OBSERVE 阶段上下文收集

- **WHEN** 进入新一轮循环的 OBSERVE 阶段
- **THEN** 系统收集对话历史、工具结果、token 状态、迭代计数，封装为 PlanningContext 对象

#### Scenario：PLAN 阶段使用完整上下文

- **WHEN** OBSERVE 阶段完成，进入 PLAN 阶段
- **THEN** 规划器接收包含工作记忆、工具记忆、摘要记忆的完整 PlanningContext

#### Scenario：EVALUATE 阶段评估结果

- **WHEN** ACT 阶段返回工具执行结果，进入 EVALUATE 阶段
- **THEN** 评估器评估工具成功/失败，生成评估报告

#### Scenario：REFLECT 阶段决策

- **WHEN** EVALUATE 阶段完成，进入 REFLECT 阶段
- **THEN** 反思器评估结果，决定 retry/new_plan/finalize_answer/fallback 之一

---

### Requirement：循环计数和迭代追踪

系统应追踪循环迭代次数，并使用此作为硬限制和指标参考。每轮循环应记录其编号，工具调用应知晓自己所在的迭代轮数。

#### Scenario：迭代计数递增

- **WHEN** 完成一轮 REFLECT 阶段后准备下一轮循环
- **THEN** iterationCount 自增 1，下一轮 OBSERVE 阶段使用新的计数

#### Scenario：工具结果关联迭代编号

- **WHEN** ACT 阶段执行工具并返回结果
- **THEN** 每个工具结果包含 iteration 字段，指示其在第几轮循环中执行

#### Scenario：指标收集追踪循环深度

- **WHEN** 执行完成
- **THEN** 执行指标包含 totalIterations 字段，显示消耗的轮数

---

### Requirement：显式循环终止条件

循环应在下列任一条件满足时终止：规划器信号、最大迭代次数、无信息增长、token 超预算、超时、降级触发。终止时应记录终止原因。

#### Scenario：规划器信号导致终止

- **WHEN** 规划器返回 `type: "final"` 且 confidence ≥0.8
- **THEN** 反思阶段返回 done=true，reason="plan_complete"，循环终止

#### Scenario：最大迭代硬限制

- **WHEN** iterationCount 达到配置的 maxIterations（默认 10）
- **THEN** 循环立即终止，reason="max_iterations"

#### Scenario：无信息增长检测

- **WHEN** 最近 2 轮工具调用返回相同结果（按工具名+输出内容去重）
- **THEN** 反思阶段返回 done=true，reason="no_new_information"

#### Scenario：Token 超预算终止

- **WHEN** conversationHistory + toolMemory 总 token 数超过配置阈值
- **THEN** 循环终止，reason="token_limit"

#### Scenario：超时终止

- **WHEN** 从执行开始的总耗时超过配置超时（默认 300000ms）
- **THEN** 循环立即终止，reason="timeout"

#### Scenario：降级触发终止

- **WHEN** 工具失败次数超过配置的重试预算（默认 3 次）
- **THEN** 反思阶段返回 done=true，reason="fallback_triggered"

---

### Requirement：循环状态可观测性

循环执行应提供清晰的可观测性，允许外部系统（日志、指标、调试工具）观察循环进度。

#### Scenario：每阶段转移日志

- **WHEN** 从一个阶段转移到另一个阶段
- **THEN** 系统记录结构化日志，包含阶段名、迭代号、转移原因

#### Scenario：循环中间状态查询

- **WHEN** 调用方查询当前执行状态（非阻塞查询）
- **THEN** 返回当前迭代号、所处阶段、已累积的工具调用数

#### Scenario：终止原因追踪

- **WHEN** 循环终止
- **THEN** 返回结果包含 terminationReason 字段，说明为何终止

---

### Requirement：EVALUATE 阶段评估逻辑

EVALUATE 阶段应对 ACT 阶段的工具执行结果进行综合评估，基于准确性、完整性、效率、置信度四个维度生成评分，并根据评分决定下一步流程。

#### Scenario：评估维度计算

- **WHEN** EVALUATE 阶段执行
- **THEN** 系统计算以下维度评分：
  - **准确性 (accuracy)**: 基于成功/失败率和错误类型（权重 0.3）
  - **完整性 (completeness)**: 基于计划完成度和信息增长（权重 0.25）
  - **效率 (efficiency)**: 基于执行时间和资源使用（权重 0.2）
  - **置信度 (confidence)**: 基于计划置信度和执行结果（权重 0.25）

#### Scenario：综合评分计算

- **WHEN** 各维度评分计算完成
- **THEN** 系统计算综合评分 (overall) = accuracy×0.3 + completeness×0.25 + efficiency×0.2 + confidence×0.25

#### Scenario：评估结果决策

- **WHEN** 综合评分 ≥ 0.8
- **THEN** 系统决定进入 REFLECT 阶段

#### Scenario：评估结果较差

- **WHEN** 综合评分 < 0.4
- **THEN** 系统决定跳过 REFLECT，直接进入 PLAN 阶段重新规划

#### Scenario：评估结果一般

- **WHEN** 综合评分在 [0.4, 0.8) 区间
- **THEN** 系统决定进入 REFLECT 阶段继续处理

---

### Requirement：ExecutionEngine 类实现

```typescript
type ExecutionPhase =
  | 'OBSERVE' // 观察阶段
  | 'PLAN' // 规划阶段
  | 'ACT' // 执行阶段
  | 'EVALUATE' // 评估阶段
  | 'REFLECT'; // 反思阶段

interface ExecutionConfig {
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
  maxConcurrentTools: number;
  waveTimeout: number;
  enableStateProtection: boolean;
  maxStateSize: number;
}

interface EvaluatorConfig {
  accuracyWeight: number; // 默认 0.3
  completenessWeight: number; // 默认 0.25
  efficiencyWeight: number; // 默认 0.2
  confidenceWeight: number; // 默认 0.25
  minSuccessThreshold: number; // 默认 0.5
  maxExecutionTimeThreshold: number; // 默认 30000ms
  verbose?: boolean;
}

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

class ExecutionEngine {
  private config: ExecutionConfig;
  private phase: ExecutionPhase;
  private iteration: number;
  private workingMemory: ConversationHistory;
  private toolMemory: ToolMemory;
  private summaryMemory: SummaryMemory;
  private metrics: ExecutionMetricsCollector;
  private deduplicationEngine: DeduplicationEngine;
  private terminationChecker: TerminationChecker;
  private reflector: Reflector;
  private deps: ExecutionEngineDeps;
  private currentPlan: Plan | null;
  private lastWaveResults: WaveExecutionResult[];
  private verbose: boolean;
  private stateDigestGenerator: StateDigestGenerator;
  private deltaDetector: DeltaDetector;
  private errorHandler: AgentErrorHandler;
  private previousSnapshot: StateSnapshot | null;
  private stateDigestHistory: StateDigest[];
  private stateDeltaHistory: StateDelta[];
  private evaluator: Evaluator;
  private lastEvaluationScore: EvaluationScore | null;

  constructor(config: Partial<ExecutionConfig>, deps: ExecutionEngineDeps);

  async run(
    userPrompt: string,
    conversationHistory?: Array<{ role: string; content: string }>
  ): Promise<{ finalAnswer: string; metrics: ExecutionMetrics }>;

  private async observe(): Promise<StateSnapshot>;
  private async plan(state: StateSnapshot): Promise<Plan>;
  private async act(plan: Plan): Promise<ToolExecutionResult[]>;
  private async evaluate(
    results: ToolExecutionResult[]
  ): Promise<EvaluationResult>;
  private async reflect(
    evaluation: EvaluationResult
  ): Promise<ReflectionResult>;
  private transitionTo(phase: ExecutionPhase): void;
}
```
