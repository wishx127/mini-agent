# Mini Agent 架构设计文档

## 1. 整体架构概览

Mini Agent 采用分层模块化架构，集成了工具调用能力、长期记忆系统和可观测性能力，支持 LLM 自主决策和执行工具。各组件职责明确，通过清晰的接口进行通信。

### 1.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Mini Agent                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────────────────────────────────┐    │
│  │  CLI Interface  │    │       ModelConfigManager                    │    │
│  │                 │    │                                             │    │
│  │ • 用户交互      │    │ • 配置加载                                  │    │
│  │ • 输入处理      │    │ • 配置验证                                  │    │
│  │ • 响应显示      │    │ • 多源配置合并                              │    │
│  │ • 命令系统      │    │ • 工具配置                                  │    │
│  └─────────┬───────┘    └──────────────────┬──────────────────────────┘    │
│            │                               │                               │
│            │                               │                               │
│  ┌─────────▼───────────────────────────────▼──────────────────────────┐    │
│  │                      Agent Core                                     │    │
│  │                                                                     │    │
│  │  ┌─────────────────────────────────────────────────────────────┐   │    │
│  │  │         编排层 Orchestration Layer                           │   │    │
│  │  │                                                              │   │    │
│  │  │  ┌─────────────────────────────────────────────────────────┐│   │    │
│  │  │  │           ExecutionEngine                               ││   │    │
│  │  │  │                                                          ││   │    │
│  │  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       ││   │    │
│  │  │  │  │OBSERVE  │→│  PLAN   │→│   ACT   │→│EVALUATE │       ││   │    │
│  │  │  │  │ 阶段    │ │  阶段   │ │  阶段   │ │  阶段   │       ││   │    │
│  │  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘       ││   │    │
│  │  │  │       │                                    │            ││   │    │
│  │  │  │       ▼                                    ▼            ││   │    │
│  │  │  │  ┌──────────┐                         ┌──────────┐      ││   │    │
│  │  │  │  │ REFLECT  │────────────────────────→│ 终止检查 │      ││   │    │
│  │  │  │  │  阶段    │                         │          │      ││   │    │
│  │  │  │  └──────────┘                         └──────────┘      ││   │    │
│  │  │  └─────────────────────────────────────────────────────────┘│   │    │
│  │  └─────────────────────────────────────────────────────────────┘   │    │
│  └───────────────────────────┬─────────────────────────────────────────┘    │
│                              │                                              │
│        ┌─────────────────────┼─────────────────────┐                        │
│        │                     │                     │                        │
│  ┌─────▼──────┐    ┌────────▼─────────┐  ┌───────▼──────────────┐         │
│  │   Tool     │    │      LLM         │  │   Memory System      │         │
│  │  Registry  │    │    Backend       │  │                      │         │
│  │            │    │                  │  │ • SessionStore       │         │
│  │ • 工具管理 │    │ • ChatOpenAI     │  │ • CostTracker        │         │
│  │ • 熔断保护 │    │ • Function Call  │  │ • TokenManager       │         │
│  │ • 分类管理 │    │                  │  │ • LongTermMemory     │         │
│  └────────────┘    └──────────────────┘  └──────────────────────┘         │
│                              │                                              │
│                              ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────┐      │
│  │                    Observability System                           │      │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────────┐ │      │
│  │  │TraceManager │ │ SpanManager │ │      PromptManager          │ │      │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────────┘ │      │
│  └──────────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 目录结构

```
src/
├── agent/
│   ├── core.ts                    # AgentCore - 门面类
│   ├── controller.ts              # Controller - 控制层
│   ├── planner.ts                 # Planner - 规划器
│   ├── executor.ts                # Executor - 工具执行器（包装层）
│   ├── execution/
│   │   ├── engine.ts              # ExecutionEngine - 执行引擎
│   │   ├── types.ts               # 执行引擎类型定义
│   │   ├── reflector.ts           # Reflector - 反思器
│   │   ├── evaluator.ts           # Evaluator - 评估器
│   │   ├── state-digest.ts        # StateDigestGenerator - 状态摘要
│   │   ├── delta-detector.ts      # DeltaDetector - 变更检测
│   │   ├── parallel-executor.ts   # 并行执行器
│   │   ├── plan-validator.ts      # 计划验证器
│   │   ├── planner-adapter.ts     # 规划器适配器
│   │   ├── state-manager.ts       # 状态管理器
│   │   ├── agent-error.ts         # 错误处理器
│   │   └── async-lock.ts          # 异步锁
│   └── memory/
│       ├── session-store.ts       # 会话存储
│       ├── cost-tracker.ts        # 成本追踪
│       ├── token-manager.ts       # Token管理
│       ├── long-term-memory-manager.ts    # 长期记忆管理
│       ├── long-term-memory-reader.ts     # 长期记忆读取
│       ├── memory-extractor.ts    # 记忆提取器
│       ├── memory-dispatcher.ts   # 记忆派发器
│       ├── memory-job-queue.ts    # 记忆任务队列
│       └── vector-database-client.ts      # 向量数据库客户端
├── cli/
│   ├── interface.ts               # CLIInterface - 主界面
│   ├── display-manager.ts         # 显示管理器
│   ├── command-selector.ts        # 命令选择器
│   └── commands/                  # 命令系统
│       ├── registry.ts            # 命令注册器
│       ├── loader.ts              # 命令加载器
│       ├── types.ts               # 命令类型
│       └── cmd/                   # 具体命令实现
├── tools/
│   ├── base.ts                    # BaseTool - 工具基类
│   ├── registry.ts                # 工具注册表
│   ├── loader.ts                  # 工具加载器
│   ├── circuit-breaker.ts         # 熔断器
│   ├── category-registry.ts       # 分类注册表
│   └── plugins/                   # 工具插件
│       ├── tavily.ts              # Tavily搜索工具
│       └── index.ts               # 插件导出
├── observability/
│   ├── langfuse-client.ts         # Langfuse客户端
│   ├── trace-manager.ts           # Trace管理器
│   ├── span-manager.ts            # Span管理器
│   ├── prompt-manager.ts          # Prompt管理器
│   ├── cost-calculator.ts         # 成本计算器
│   └── types.ts                   # 可观测性类型
├── worker/                        # Worker进程
│   ├── worker-monitor.ts          # Worker监控器
│   ├── memory-consumer.ts         # 内存消费者
│   ├── worker-monitor-utils.ts    # 监控工具
│   └── check-worker-status.ts     # 状态检查工具
├── config/
│   └── model-config.ts            # 模型配置管理
└── types/
    ├── agent.ts                   # Agent类型
    ├── memory.ts                  # 记忆类型
    └── model-config.ts            # 模型配置类型
```

## 2. 核心组件架构

### 2.1 AgentCore - AI代理核心

**职责**: 处理AI对话逻辑，管理工具调用流程，桥接用户输入和LLM服务。AgentCore 作为门面类，集成编排层模块。

```typescript
class AgentCore {
  private llm: ChatOpenAI;
  private config: ModelConfig;
  private toolRegistry: ToolRegistry;
  private controller: Controller;
  private planner: Planner;
  private executor: Executor;
  private observabilityClient: ObservabilityClient;
  private traceManager: TraceManager;
  private spanManager: SpanManager;
  private promptManager: PromptManager;

  constructor(config: ModelConfig);
  private initializeLLM(): ChatOpenAI;
  private initializeToolRegistry(): ToolRegistry;
  private initializeObservability(): ObservabilityClient;
  private initializePlanner(): Planner;
  private initializeExecutor(): Executor;
  private initializeController(): Controller;
  private registerPrompts(): Promise<void>;
  async processPrompt(prompt: string): Promise<string>;
  getToolRegistry(): ToolRegistry;
}
```

### 2.2 Controller - 控制层

**职责**: 协调执行引擎，管理可观测性和记忆系统。

```typescript
class Controller {
  private config: ControlConfig;
  private metrics: ExecutionMetrics;
  private state: ExecutionState;
  private llm: ChatOpenAI;
  private toolRegistry: ToolRegistry;
  private sessionStore: SessionStore;
  private costTracker: CostTracker;
  private longTermMemoryReader: LongTermMemoryReader | null;
  private memoryDispatcher: MemoryDispatcher | null;
  private chainWithHistory: Runnable | null;
  private traceManager: TraceManager;
  private spanManager: SpanManager;
  private modelName: string;
  private promptManager: PromptManager;

  constructor(
    llm: ChatOpenAI,
    toolRegistry: ToolRegistry,
    config?: Partial<ControlConfig>,
    vectorDbConfig?: VectorDatabaseConfig,
    traceManager?: TraceManager,
    spanManager?: SpanManager,
    modelName?: string
  );

  async execute(prompt: string): Promise<string>;
  getStatus(): ExecutionState;
  getEngineConfig(): {
    maxIterations: number;
    maxExecutionTime: number;
    toolTimeout: number;
    tokenThreshold: number;
  };
  updateEngineConfig(
    config: Partial<{
      maxIterations: number;
      maxExecutionTime: number;
      toolTimeout: number;
      tokenThreshold: number;
    }>
  ): void;
}
```

**控制参数**:

| 参数               | 默认值   | 说明           |
| ------------------ | -------- | -------------- |
| `maxIterations`    | 10       | 最大迭代次数   |
| `maxExecutionTime` | 300000ms | 最大执行时间   |
| `toolTimeout`      | 30000ms  | 工具超时时间   |
| `tokenThreshold`   | 0.9      | Token 预警阈值 |
| `maxTokens`        | 4000     | 最大Token数    |

### 2.3 ExecutionEngine - 执行引擎

**职责**: 管理多轮循环执行，实现状态机驱动的 OBSERVE → PLAN → ACT → EVALUATE → REFLECT 流程。

```typescript
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
  getPhase(): ExecutionPhase;
  getIteration(): number;
}
```

**状态机模型**:

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

**执行阶段说明**:

| 阶段     | 职责                       | 关键组件                            |
| -------- | -------------------------- | ----------------------------------- |
| OBSERVE  | 收集系统状态，生成状态摘要 | StateDigestGenerator, DeltaDetector |
| PLAN     | 基于上下文生成执行计划     | Planner, PlanningContextFactory     |
| ACT      | 执行工具调用，支持并行     | ParallelExecutor, Executor          |
| EVALUATE | 评估执行结果质量           | Evaluator                           |
| REFLECT  | 反思决策，确定下一步       | Reflector                           |

### 2.4 Reflector - 反思器

**职责**: 评估工具执行结果，做出决策。

```typescript
interface ReflectorConfig {
  strategy: 'conservative' | 'balanced' | 'aggressive';
  timeoutMs: number;
  similarityThreshold: number;
  maxRetryPerTool: number;
  verbose?: boolean;
}

class Reflector {
  private config: ReflectorConfig;

  async reflect(context: ReflectionContext): Promise<ReflectionResult>;
  private analyzeToolFailures(results: ToolExecutionResult[]): FailureAnalysis;
  private evaluateInformationGrowth(
    current: StateSnapshot,
    previous: StateSnapshot | null
  ): InformationGrowth;
  private determineErrorAttribution(
    failures: FailureAnalysis
  ): ErrorAttribution;
  private makeDecision(context: ReflectionContext): ReflectionDecision;
}

type ReflectionDecision =
  | 'continue' // 继续执行
  | 'retry' // 重试工具
  | 'new_plan' // 重新规划
  | 'finalize_answer' // 生成最终答案
  | 'fallback'; // 降级处理
```

### 2.5 Evaluator - 评估器

**职责**: 在ACT阶段后评估工具执行结果质量。

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

interface EvaluatorConfig {
  accuracyWeight: number;
  completenessWeight: number;
  efficiencyWeight: number;
  confidenceWeight: number;
  minSuccessThreshold: number;
  maxExecutionTimeThreshold: number;
  verbose?: boolean;
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
  private config: EvaluatorConfig;

  constructor(config?: Partial<EvaluatorConfig>);
  evaluate(context: EvaluationContext): EvaluationScore;
}
```

**评估逻辑**:

- 评分 >= 0.8: 进入 REFLECT 阶段
- 评分 < 0.4: 进入 PLAN 阶段重新规划
- 其他: 进入 REFLECT 阶段

### 2.6 StateDigestGenerator - 状态摘要生成器

**职责**: 为 OBSERVE 阶段生成系统状态摘要。

```typescript
interface StateSnapshot {
  iteration: number;
  timestamp: number;
  workingMemorySize: number;
  workingMemoryTokens: number;
  toolMemorySize: number;
  recentToolRecords: ToolRecord[];
  currentPlanProgress: PlanProgress;
  failureStats: FailureStats;
  performanceStats: PerformanceStats;
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
  generateHeuristicDigest(
    snapshot: StateSnapshot,
    previousSnapshot?: StateSnapshot | null
  ): StateDigest;
  private calculateProgressRate(snapshot: StateSnapshot): number;
  private calculateSuccessRate(snapshot: StateSnapshot): number;
  private calculateInformationGrowth(
    current: StateSnapshot,
    previousSnapshot?: StateSnapshot | null
  ): number;
}
```

### 2.7 DeltaDetector - 变更检测器

**职责**: 检测系统状态变化，决定是否跳过某些阶段。

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

### 2.8 ParallelExecutor - 并行执行器

**职责**: 并行执行工具调用，支持依赖图解析和波次执行。

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

**波次执行示例**:

```
计划步骤:
  step1: search(query) → 无依赖
  step2: analyze(data) → 依赖 step1
  step3: format(result) → 无依赖

执行波次:
  波次0: [step1, step3] → 并行执行
  波次1: [step2] → 等待波次0完成
```

### 2.9 TerminationChecker - 终止检查器

**职责**: 检查多种终止条件，支持语义终止。

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

**终止条件优先级**:

| 优先级 | 终止条件     | 说明                       |
| ------ | ------------ | -------------------------- |
| 1      | 规划器信号   | 规划器返回 `type: "final"` |
| 2      | 无信息增长   | 连续 N 轮无新信息          |
| 3      | 最大迭代     | 达到最大迭代次数限制       |
| 4      | Token 超预算 | Token 使用超过阈值         |
| 5      | 执行超时     | 总执行时间超过限制         |
| 6      | 失败预算     | 工具失败次数超过预算       |

## 3. 记忆系统架构

### 3.1 分层记忆模型

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
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              长期记忆 (Long-term Memory)             │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  VectorDatabaseClient                       │   │   │
│  │  │  - Supabase + pgvector                       │   │   │
│  │  │  - 向量相似度搜索                            │   │   │
│  │  │  - 持久化存储                                │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 记忆组件

#### SessionStore

```typescript
class SessionStore {
  private sessions: Map<string, InMemoryChatMessageHistory>;

  getOrCreate(sessionId: string): InMemoryChatMessageHistory;
  async clear(sessionId: string): Promise<void>;
  delete(sessionId: string): void;
  getAllSessionIds(): string[];
}
```

#### CostTracker

```typescript
class CostTracker {
  private records: CostRecord[];

  record(usage: UsageMetadata, modelName: string): void;
  getSummary(): CostSummary;
  getRecentRecords(count: number): CostRecord[];
  reset(): void;
}
```

#### TokenManager

```typescript
function estimateTokenCount(text: string): number;
function createTrimmer(options: TrimmerOptions): Runnable;
function getTokenStatus(messages: BaseMessage[], limit: number): TokenStatus;
async function runTokenPreflight(
  messages: BaseMessage[],
  limit: number
): Promise<BaseMessage[]>;
```

#### LongTermMemoryManager

```typescript
class LongTermMemoryManager {
  private dbClient: VectorDatabaseClient;
  private extractor: MemoryExtractor;
  private config: LongTermMemoryConfig;
  private queue: MemoryJobQueue;

  async initialize(): Promise<boolean>;
  create(input: CreateMemoryInput): Promise<Memory | null>;
  search(query: string, topK?: number): Promise<MemorySearchResult[]>;
  update(id: string, content: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  shutdown(): void;
}
```

## 4. 可观测性系统

### 4.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Observability System                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │              ObservabilityClient                     │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │  │TraceManager │ │ SpanManager │ │PromptManager│   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Langfuse                          │   │
│  │              (Cloud/Self-hosted)                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Trace/Span 层级结构

```
Trace (conversation)
├── Generation (llm) - planner-decision
│   ├── input: { prompt, toolsCount }
│   ├── output: { toolCalls, needsTool }
│   ├── metadata: { model, usage, cost }
│   └── usageDetails: { input: 100, output: 50, total: 150 }
│
├── Span (tool) - tool-execution
│   ├── input: { toolName, arguments }
│   ├── output: { result }
│   └── metadata: { success, executionTime }
│
└── Generation (llm) - llm-response
    ├── input: { input, hasLongTermMemory }
    ├── output: { response }
    ├── metadata: { model, usage, cost }
    └── usageDetails: { input: 200, output: 100, total: 300 }
```

### 4.3 核心组件

#### ObservabilityClient

```typescript
class ObservabilityClient {
  private client: LangfusePromptClient | null;
  private rawClient: LangfuseClient | null;
  private config: ObservabilityConfig;

  constructor(config?: ObservabilityConfig);
  isEnabled(): boolean;
  getClient(): LangfusePromptClient | null;
  getRawClient(): LangfuseClient | null;
  async flush(): Promise<void>;
}
```

#### TraceManager

```typescript
class TraceManager {
  createTrace(context: TraceContext): string | null;
  endTrace(output?: string, metadata?: Record<string, unknown>): void;
  getCurrentTraceId(): string | null;
  generateTraceId(): string;
}
```

#### SpanManager

```typescript
class SpanManager {
  createSpan(options: CreateSpanOptions): string | null;
  createLLMSpan(
    name: string,
    input: unknown,
    metadata?: Record<string, unknown>
  ): string | null;
  createToolSpan(name: string, toolName: string, input: unknown): string | null;
  endSpan(spanId: string, options?: EndSpanOptions): void;
}
```

#### PromptManager

```typescript
class PromptManager {
  async registerPrompt(
    name: string,
    template: string,
    labels?: string[]
  ): Promise<void>;
  async getPrompt(
    name: string,
    version?: string
  ): Promise<PromptTemplate | null>;
  compileTemplate(template: string, variables: Record<string, string>): string;
}
```

## 5. 工具系统架构

### 5.1 核心组件

#### BaseTool

```typescript
abstract class BaseTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly paramsSchema: z.ZodType<Record<string, unknown>>;

  protected _enabled: boolean;
  readonly category?: ToolCategory;
  readonly timeout?: number;
  readonly retryConfig?: RetryConfig;
  readonly jsonSchema?: JSONSchema;

  get enabled(): boolean;
  set enabled(value: boolean);

  abstract execute(params: Record<string, unknown>): Promise<string>;
  run(params: Record<string, unknown>): Promise<string>;
  getLangChainTool(): LangChainToolDefinition;
}
```

#### ToolRegistry

```typescript
class ToolRegistry {
  private tools: Map<string, BaseTool>;
  private categoryRegistry: ToolCategoryRegistry;

  register(tool: BaseTool): void;
  getTool(name: string): BaseTool | undefined;
  getAllTools(): BaseTool[];
  getEnabledTools(): BaseTool[];
  getLangChainTools(): LangChainToolDefinition[];
  executeTool(name: string, params: Record<string, unknown>): Promise<string>;
}
```

#### CircuitBreaker

```typescript
class CircuitBreaker {
  private state: CircuitState;
  private failureCount: number;
  private lastFailureTime: number;
  private halfOpenAttempts: number;

  async execute<T>(fn: () => Promise<T>): Promise<T>;
  getState(): CircuitState;
  getStats(): CircuitStats;
  reset(): void;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
```

## 6. Worker 系统

### 6.1 架构设计

```
┌───────────────────────────┐          ┌───────────────────────────┐
│      父进程 (CLI/Main)     │          │      子进程 (Worker)      │
│ ┌───────────────────────┐ │  spawn   │ ┌───────────────────────┐ │
│ │    WorkerMonitor      ├─┼──────────>│ │    MemoryConsumer     │ │
│ └──────────┬────────────┘ │          │ └──────────┬────────────┘ │
│            │              │          │            │              │
│ ┌──────────▼────────────┐ │          │ ┌──────────▼────────────┐ │
│ │      Status CLI       │ │          │ │ LongTermMemoryManager │ │
│ └──────────┬────────────┘ │          │ └───────────────────────┘ │
└────────────┼──────────────┘          └────────────┬──────────────┘
             │                                      │
             │           通信与持久化层             │
             │   ┌──────────────────────────────┐   │
             └───>      状态文件 (.json)        <───┘
                 │   (心跳、PID、队列积压)      │
                 └──────────────────────────────┘
                 ┌──────────────────────────────┐
                 │      日志文件 (.log)         │
                 └──────────────────────────────┘
```

### 6.2 WorkerMonitor

```typescript
interface WorkerStatus {
  isAlive: boolean;
  pid: number | null;
  uptime: number;
  lastHeartbeat: Date | null;
  restartCount: number;
  lastError: string | null;
  pendingJobs: number;
}

interface MonitorConfig {
  heartbeatTimeout: number;
  maxRestarts: number;
  restartDelay: number;
  healthCheckInterval: number;
  logPath?: string;
}

class WorkerMonitor {
  async start(): Promise<void>;
  stop(): void;
  getStatus(): WorkerStatus;
  private restartWorker(): void;
  private checkHealth(): void;
}
```

## 7. CLI 系统

### 7.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIInterface                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Command    │  │   Command    │  │   CommandSelector │  │
│  │   Registry   │  │   Loader     │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
└─────────┼─────────────────┼───────────────────┼────────────┘
          │                 │                   │
          ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                      Command Modules                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │  help.ts │ │ clear.ts │ │  exit.ts │ │memory.ts │  ...  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 命令类型

```typescript
interface Command {
  name: string;
  description: string;
  aliases?: string[];
  action: () => void | Promise<void>;
}

interface CommandContext {
  cli: CLIInterface;
  showPrompt: () => void;
  clearScreen: () => void;
  quit: () => void;
}
```

## 8. 配置系统

### 8.1 模型配置

```typescript
interface ModelConfig {
  baseUrl: string;
  modelName: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolsConfig;
  longTermMemory?: LongTermMemoryOptions;
}

interface ToolsConfig {
  disabled?: string[];
  configs?: Record<string, Record<string, unknown>>;
}

interface LongTermMemoryOptions {
  enabled: boolean;
  supabaseUrl?: string;
  supabaseApiKey?: string;
  embeddingApiKey?: string;
}
```

### 8.2 环境变量

| 环境变量              | 说明              |
| --------------------- | ----------------- |
| `MODEL_BASE_URL`      | 模型API基础URL    |
| `MODEL_NAME`          | 模型名称          |
| `MODEL_API_KEY`       | API密钥           |
| `MODEL_TEMPERATURE`   | 温度参数          |
| `MODEL_MAX_TOKENS`    | 最大Token数       |
| `DISABLED_TOOLS`      | 禁用的工具列表    |
| `TAVILY_API_KEY`      | Tavily API密钥    |
| `LANGFUSE_PUBLIC_KEY` | Langfuse公钥      |
| `LANGFUSE_SECRET_KEY` | Langfuse密钥      |
| `LANGFUSE_HOST`       | Langfuse主机      |
| `SUPABASE_URL`        | Supabase URL      |
| `SUPABASE_API_KEY`    | Supabase API密钥  |
| `EMBEDDING_API_KEY`   | Embedding API密钥 |

## 9. 扩展点

### 9.1 自定义工具

```typescript
@registerTool()
class MyTool extends BaseTool {
  readonly name = 'my-tool';
  readonly description = '我的工具';
  readonly paramsSchema = z.object({
    query: z.string().describe('查询内容'),
  });
  readonly category = ToolCategories.EXTERNAL_API;

  async execute(params: { query: string }): Promise<string> {
    // 工具逻辑
    return 'result';
  }
}
```

### 9.2 自定义命令

```typescript
export const myCommand: CommandDefinition = {
  name: 'my-command',
  description: '我的命令',
  aliases: ['mc'],
  execute: async (context: CommandContext) => {
    // 命令逻辑
  },
};
```

### 9.3 自定义反射策略

```typescript
class CustomReflectorStrategy implements ReflectorStrategy {
  evaluate(context: ReflectionContext): ReflectionDecision {
    // 自定义评估逻辑
    return 'continue';
  }
}
```
