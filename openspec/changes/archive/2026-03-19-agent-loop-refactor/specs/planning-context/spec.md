## 规划上下文能力

### Requirement：PlanningContext 数据结构

PlanningContext 是一个统一的数据结构，包含规划器所需的所有上下文信息，从而使规划器无需直接访问内部数据结构。

#### Scenario：基础字段

- **WHEN** OBSERVE 阶段构建 PlanningContext
- **THEN** 结构包含必备字段：
  ```typescript
  interface PlanningContext {
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
  ```

#### Scenario：工具信息字段

- **WHEN** availableTools 字段填充
- **THEN** 每个工具包含：
  - name (string)
  - description (string)
  - enabled (boolean)
  - parameters (Record<string, unknown>)
  - recentSuccessRate (number)
  - lastUsedIteration (number)
  - failureCount (number)

---

### Requirement：工作记忆集成

PlanningContext 应包含完整的工作记忆（最近 N 条消息）作为规划器的主要上下文。

#### Scenario：消息历史

- **WHEN** workingMemory 字段被规划器访问
- **THEN** 包含最多 maxWorkingMemorySize 条消息，按时间顺序排列

#### Scenario：消息角色

- **WHEN** 规划器读取工作记忆
- **THEN** 每条消息包含 role（system / user / assistant / tool）和 content

#### Scenario：消息元数据

- **WHEN** 规划器需要理解消息来源
- **THEN** 每条消息包含 timestamp 和 source（如 "iteration_2_tool_result"）

---

### Requirement：工具记忆集成

PlanningContext 应包含相关的工具记忆信息（最近调用、失败统计），支持规划器做出更好的工具选择。

#### Scenario：最近工具调用

- **WHEN** toolMemory 字段被规划器访问
- **THEN** 包含最近 10 条工具调用记录，按时间逆序排列

#### Scenario：工具统计

- **WHEN** 规划器需要了解各工具的可靠性
- **THEN** 提供聚合统计：每个工具的成功率、平均响应时间、最后使用时间

#### Scenario：失败模式识别

- **WHEN** 规划器评估是否再次使用某工具
- **THEN** toolMemory 包含该工具的最近失败记录和错误类型

---

### Requirement：摘要记忆集成

PlanningContext 应包含早期轮次的压缩摘要，作为长期上下文的补充。

#### Scenario：摘要列表

- **WHEN** summaryMemory 字段被规划器访问
- **THEN** 包含按时间顺序排列的所有摘要，每个包含：
  - id (string)
  - timeRange (from / to)
  - messageCount (被压缩的消息数)
  - summary (文本摘要)
  - timestamp (number)

#### Scenario：摘要在规划中使用

- **WHEN** 规划器需要理解之前的工作历程
- **THEN** 可读取摘要而非完整历史，节省 token 和思考时间

---

### Requirement：Token 和资源信息

PlanningContext 应包含当前的 token 预算和执行资源状态。

#### Scenario：Token 预算

- **WHEN** remainingTokenBudget 字段被访问
- **THEN** 返回当前剩余可用的 token 数量

#### Scenario：迭代限制

- **WHEN** remainingIterations 字段被访问
- **THEN** 返回剩余可执行的迭代次数（maxIterations - currentIteration）

#### Scenario：资源警告

- **WHEN** token 或迭代接近限制
- **THEN** 系统在 PlanningContext 中标记警告状态，规划器可据此调整策略

---

### Requirement：PlanningContextBuilder 类实现

```typescript
class PlanningContextBuilder {
  private memory: Memory;
  private config: ExecutionConfig;
  private toolRegistry: ToolRegistry;

  constructor(
    memory: Memory,
    config: ExecutionConfig,
    toolRegistry: ToolRegistry
  );

  buildContext(userPrompt: string, iterationCount: number): PlanningContext;
  private calculateTokenBudget(): number;
  private getAvailableTools(): ToolInfo[];
  private getFailedToolsThisRound(): string[];
  private calculateInformationGrowthRate(): number;
}
```
