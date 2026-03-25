## 工具去重能力

### Requirement：输入哈希计算

系统应为每个工具输入计算确定性哈希值，用于识别功能相同的输入。哈希应基于输入对象的规范化形式，对象属性顺序变化不应影响哈希结果。

#### Scenario：简单输入哈希

- **WHEN** 工具输入为 `{query: "weather today", location: "Beijing"}`
- **THEN** 系统生成稳定哈希，多次计算结果相同

#### Scenario：属性顺序不影响哈希

- **WHEN** 两个输入对象字段顺序不同但内容相同：`{a: 1, b: 2}` 和 `{b: 2, a: 1}`
- **THEN** 两个输入生成相同的哈希值

#### Scenario：嵌套对象哈希

- **WHEN** 工具输入包含嵌套对象：`{search: {keyword: "ai", filter: {type: "paper"}}}`
- **THEN** 系统递归计算嵌套对象的哈希，最终生成稳定的哈希值

---

### Requirement：最近调用查询

系统应支持快速查询工具记忆中最近是否调用过相同工具名和输入哈希的调用。查询应限制在最近 N 条记录（默认 5），以避免全表扫描。

#### Scenario：查询最近相同调用

- **WHEN** 规划器建议调用 `SearchTool` 且输入为 `{query: "python asyncio"}`
- **THEN** 系统查询工具记忆最近 5 条记录，检查是否存在 `SearchTool` + 输入哈希相同的调用

#### Scenario：查询返回匹配记录

- **WHEN** 查询找到匹配的最近调用
- **THEN** 系统返回匹配记录的完整信息：输入、输出、状态、时间戳、迭代号

#### Scenario：查询无匹配记录

- **WHEN** 工具记忆中最近 5 条记录中无匹配
- **THEN** 系统返回空结果，表示此调用未在最近执行过

#### Scenario：查询限制效率

- **WHEN** 工具记忆已包含数百条记录
- **THEN** 查询仅扫描最近 5 条（可配置），耗时不超过 10ms

---

### Requirement：去重决策规则

系统应根据最近调用的状态和输出，决定是否应跳过重复调用。规则应为：

1. 前次调用成功 → 建议跳过或告知规划器
2. 前次调用失败 → 允许重试（受重试预算限制）
3. 前次调用超时 → 决定是否重试（基于总耗时预算）

#### Scenario：成功调用去重

- **WHEN** 检测到重复调用，前次调用状态为 "success" 且输出长度 > 50 字符
- **THEN** 反思阶段返回建议：skip 或 inform_planner，而不是实际执行此工具

#### Scenario：失败调用重试

- **WHEN** 检测到重复调用，前次调用状态为 "failed"，且该工具失败次数 < 重试预算
- **THEN** 系统允许这次调用执行，记录为重试尝试

#### Scenario：失败调用放弃

- **WHEN** 检测到重复调用，前次失败，该工具失败次数已达重试预算上限
- **THEN** 反思阶段建议：new_plan 或 fallback，不执行此调用

#### Scenario：超时调用判决

- **WHEN** 检测到重复调用，前次调用状态为 "timeout"，系统已消耗总耗时的 80%
- **THEN** 反思阶段建议：skip 或 fallback，避免再次超时

---

### Requirement：重复调用通知

当检测到重复调用时，系统应通知规划器或反思器，提供上下文信息支持决策。通知应包含前次调用的关键信息。

#### Scenario：规划器可见重复调用历史

- **WHEN** 规划上下文包含工具记忆信息
- **THEN** 规划器可查询 `getRecentToolCalls(toolName, limit=5)` 获得最近调用，观察模式

#### Scenario：反思器评估重复调用

- **WHEN** ACT 阶段返回结果，反思器发现某工具调用重复
- **THEN** 反思器接收包含重复标记和前次结果的工具结果，如：
  ```json
  {
    "tool": "SearchTool",
    "result": "...",
    "isDuplicate": true,
    "previousResult": "...",
    "previousStatus": "success",
    "iterationsSinceLastCall": 2
  }
  ```

#### Scenario：重复调用统计

- **WHEN** 执行指标收集
- **THEN** 指标包含 duplicateToolCallsDetected 和 duplicateToolCallsSkipped 字段

---

### Requirement：重试预算管理

系统应维护每个工具的失败重试预算。对同一工具的重试次数受限（默认 3 次），防止无限重试。当预算耗尽，不再允许重试。

#### Scenario：初始化重试预算

- **WHEN** 系统初始化
- **THEN** 每个工具的重试计数器设为 0

#### Scenario：重试计数递增

- **WHEN** 某工具调用失败，系统决定重试
- **THEN** 该工具的重试计数器 +1

#### Scenario：重试预算耗尽检测

- **WHEN** 某工具的重试计数器 == maxRetryPerTool（默认 3）
- **THEN** 系统标记该工具预算耗尽，不再允许重试

#### Scenario：跨轮次重试预算

- **WHEN** 第 1 轮工具 A 失败并重试，第 2 轮再次调用工具 A
- **THEN** 重试计数器跨轮次累计，防止长期重复失败

---

### Requirement：DeltaDetector 类实现

```typescript
interface DeduplicationConfig {
  maxRecentCalls: number;
  similarityThreshold: number;
  maxRetryPerTool: number;
}

interface DuplicateCheckResult {
  isDuplicate: boolean;
  previousCall?: ToolRecord;
  shouldSkip: boolean;
  reason?: string;
}

class DeltaDetector {
  private config: DeduplicationConfig;
  private retryCounters: Map<string, number>;

  constructor(config: DeduplicationConfig);

  checkDuplicate(
    toolName: string,
    input: Record<string, unknown>,
    toolMemory: ToolRecord[]
  ): DuplicateCheckResult;

  computeInputHash(input: Record<string, unknown>): string;
  private normalizeInput(input: Record<string, unknown>): string;
  private shouldAllowRetry(toolName: string): boolean;
  private incrementRetryCount(toolName: string): void;

  getRetryCount(toolName: string): number;
  resetRetryCount(toolName: string): void;
}
```
