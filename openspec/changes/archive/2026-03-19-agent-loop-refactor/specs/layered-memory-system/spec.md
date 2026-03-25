## 分层记忆系统能力

### Requirement：工作记忆管理

工作记忆存储最近 N 轮对话的消息（用户输入、规划器输出、工具结果），作为规划器的主要上下文。系统应维护工作记忆大小不超过配置限制（默认 10 条消息）。

#### Scenario：工作记忆初始化

- **WHEN** 开始新的 Agent 执行
- **THEN** 工作记忆初始化为空，准备接收新消息

#### Scenario：消息追加到工作记忆

- **WHEN** 完成 ACT 阶段获得工具结果
- **THEN** 系统将工具结果作为 role="tool" 消息追加到工作记忆

#### Scenario：工作记忆大小限制

- **WHEN** 工作记忆消息数达到配置的 maxWorkingMemorySize（默认 10）且需要追加新消息
- **THEN** 系统删除最旧的 1 条消息，保持大小限制

#### Scenario：规划器访问工作记忆

- **WHEN** 规划器需要上下文进行规划
- **THEN** 规划器接收完整工作记忆消息列表，最多包含 maxWorkingMemorySize 条消息

---

### Requirement：工具记忆和去重

工具记忆记录所有执行过的工具调用，包括工具名、输入、输出、状态、时间戳。系统应支持快速查询最近是否调用过相同工具（基于名称+输入哈希），防止重复调用。

#### Scenario：工具调用记录

- **WHEN** ACT 阶段执行工具
- **THEN** 系统在工具记忆中记录条目：工具名、输入、输出、状态、时间戳、迭代号

#### Scenario：工具重复检测

- **WHEN** 规划器建议调用某工具
- **THEN** 系统计算输入哈希，查询工具记忆最近 5 条记录，识别是否有相同工具+输入的调用

#### Scenario：重复调用决策

- **WHEN** 检测到重复工具调用（相同工具名+输入）且前次成功
- **THEN** 反思阶段可建议跳过此调用或提示规划器选择新策略

#### Scenario：失败工具的重试记录

- **WHEN** 同一工具先前调用失败，规划器准备重试
- **THEN** 工具记忆包含前次失败记录，反思器可据此判断是否应重试

#### Scenario：工具记忆查询接口

- **WHEN** 规划器或反思器需要查询工具历史
- **THEN** 系统提供 `queryToolMemory(toolName, inputHash, limit)` 接口，返回匹配记录

---

### Requirement：摘要记忆和压缩

摘要记忆存储历史轮次的压缩摘要，当工作记忆无法容纳所有历史时，旧轮次被压缩为摘要。摘要应通过 LLM 生成，捕捉关键事实和决策。

#### Scenario：摘要触发条件（轮数）

- **WHEN** 执行完成 N 轮循环（默认 5 轮）且即将进入下一轮
- **THEN** 系统调用摘要生成逻辑，压缩最早的 M 条工作记忆消息为 1-2 句摘要

#### Scenario：摘要触发条件（Token）

- **WHEN** 工作记忆 + 最近工具结果的总 token 数超过阈值（默认 8K）
- **THEN** 系统触发摘要生成，将最早轮次压缩为摘要

#### Scenario：摘要生成格式

- **WHEN** 摘要生成完毕
- **THEN** 摘要记忆中添加条目：时间戳范围、压缩的消息数、摘要文本（<200 tokens）

#### Scenario：规划器访问摘要记忆

- **WHEN** 规划器构建规划上下文
- **THEN** 规划器可访问摘要记忆中的所有摘要，作为早期历史的补充

#### Scenario：摘要内容与工作记忆结合

- **WHEN** 生成最终答案
- **THEN** 系统同时使用工作记忆（近期）和摘要记忆（早期），重构完整对话历史

---

### Requirement：规划上下文结构

规划上下文（PlanningContext）是一个统一结构，包含工作记忆、工具记忆、摘要记忆、token 状态、迭代计数等，作为规划器的标准输入。

#### Scenario：PlanningContext 字段

- **WHEN** OBSERVE 阶段构建规划上下文
- **THEN** PlanningContext 包含以下字段：
  ```typescript
  interface PlanningContext {
    workingMemory: Message[];
    toolMemory: ToolRecord[];
    summaryMemory: SummaryRecord[];
    iterationCount: number;
    remainingTokenBudget: number;
    terminationReasonsCollected: string[];
  }
  ```

#### Scenario：规划器接收 PlanningContext

- **WHEN** 规划器开始规划
- **THEN** 规划器接收 PlanningContext 对象，从中提取所需上下文，无需直接访问内部数据结构

#### Scenario：上下文大小验证

- **WHEN** PlanningContext 准备完毕
- **THEN** 系统验证总大小不超过模型上下文窗口的 75%（预留 25% 用于规划输出和缓冲）

---

### Requirement：内存清理和生命周期

系统应支持内存清理策略，定期移除过期数据，防止无限增长。清理应基于配置的保留期和大小限制。

#### Scenario：工具记忆保留策略

- **WHEN** 执行完成，进入清理阶段
- **THEN** 系统删除超过保留期（默认 30 天）的工具记忆条目

#### Scenario：摘要记忆存档

- **WHEN** 摘要记忆中摘要超过 7 天且对应工作记忆已转入新摘要
- **THEN** 系统可选将旧摘要存档到外部存储或删除

#### Scenario：执行完成后的内存释放

- **WHEN** 单次 Agent 执行完成
- **THEN** 系统清理当次执行的工作记忆和临时摘要，保留工具记忆用于后续对比

---

### Requirement：记忆持久化接口

系统应提供记忆持久化接口，允许外部系统查询或导出记忆数据用于调试、审计或分析。

#### Scenario：导出工具记忆

- **WHEN** 调用方请求导出工具记忆
- **THEN** 系统返回 JSON 格式的工具记忆，包含所有字段，格式便于查询和分析

#### Scenario：导出对话历史重建

- **WHEN** 调用方请求重建完整对话历史
- **THEN** 系统返回工作记忆 + 摘要记忆的组合，按时间顺序排列，可用于回放或审计

---

### Requirement：状态快照和摘要生成

OBSERVE 阶段应收集系统状态快照，并生成启发式状态摘要，用于后续阶段决策。

#### Scenario：状态快照收集

- **WHEN** OBSERVE 阶段执行
- **THEN** 系统收集状态快照：
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
  ```

#### Scenario：状态摘要生成

- **WHEN** 状态快照收集完成
- **THEN** 系统生成状态摘要：
  ```typescript
  interface StateDigest {
    summary: string;
    keyMetrics: {
      progressRate: number; // 进度率 (0-1)
      successRate: number; // 成功率 (0-1)
      informationGrowth: number; // 信息增长率 (0-1)
    };
    highlights: string[]; // 亮点列表
    warnings: string[]; // 警告列表
    timestamp: number;
    iteration: number;
  }
  ```

#### Scenario：状态变化检测

- **WHEN** 状态快照收集完成
- **THEN** 系统检测状态变化：
  ```typescript
  interface StateDelta {
    progress_delta: number; // 进度变化
    new_errors: number; // 新增错误数
    new_tools_used: boolean; // 是否使用了新工具
    information_growth_rate: number; // 信息增长率
    should_skip_plan: boolean; // 是否跳过规划
    skip_reason?: string; // 跳过原因
    timestamp: number;
  }
  ```

---

### Requirement：Memory 类实现

```typescript
interface MemoryConfig {
  maxWorkingMemorySize: number;
  maxToolMemorySize: number;
  summaryTriggerRound: number;
  summaryTriggerTokens: number;
  tokenThreshold: number;
}

interface StateDigestConfig {
  enableLLMGeneration: boolean; // 默认 false
  maxHighlights: number; // 默认 5
  maxWarnings: number; // 默认 3
  warningThresholds: {
    highFailureRate: number; // 默认 0.5
    lowProgressRate: number; // 默认 0.1
    highTokenUsage: number; // 默认 0.8
  };
}

interface DeltaDetectorConfig {
  progressThreshold: number; // 默认 0.1
  errorThreshold: number; // 默认 3
  skipPlanConditions: {
    maxConsecutiveNoProgress: number; // 默认 2
    maxRecentErrors: number; // 默认 3
    minIterationsBeforeSkip: number; // 默认 2
  };
}

class StateDigestGenerator {
  constructor(config?: Partial<StateDigestConfig>);
  generateHeuristicDigest(
    snapshot: StateSnapshot,
    previousSnapshot?: StateSnapshot | null
  ): StateDigest;
  updateConfig(newConfig: Partial<StateDigestConfig>): void;
  getConfig(): StateDigestConfig;
}

class DeltaDetector {
  constructor(config?: Partial<DeltaDetectorConfig>);
  detectDelta(currentSnapshot: StateSnapshot): StateDelta;
  reset(): void;
  getConsecutiveNoProgressCount(): number;
  updateConfig(newConfig: Partial<DeltaDetectorConfig>): void;
  getConfig(): DeltaDetectorConfig;
}

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
}

interface ToolRecord {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'success' | 'failed' | 'timeout';
  error?: string;
  timestamp: number;
  iteration: number;
  executionTime?: number;
  retryCount?: number;
  inputHash?: string;
}

interface SummaryRecord {
  timestampRange: [number, number];
  messageCount: number;
  summary: string;
  tokenCount: number;
}

class ConversationHistory {
  private messages: Message[];
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

class ToolMemory {
  private records: ToolRecord[];
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

class SummaryMemory {
  private summaries: Summary[];
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
