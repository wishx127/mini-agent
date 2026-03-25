## 并行工具执行能力

### Requirement：依赖识别和并行分组

ACT 阶段应识别计划中没有依赖关系或依赖已完成的步骤，将它们分组为可并行执行的"波次"。

#### Scenario：单波次并行

- **WHEN** 计划包含 3 个独立步骤（无依赖）
- **THEN** ACT 阶段将这 3 个步骤分组为 1 个波次，同时执行

#### Scenario：多波次执行

- **WHEN** 计划包含步骤 0、1（无依赖），步骤 2 依赖 0、1
- **THEN** ACT 阶段识别 2 个波次：
  - 波次 1：执行步骤 0、1（并行）
  - 波次 2：执行步骤 2（待波次 1 完成）

#### Scenario：复杂依赖图并行分组

- **WHEN** 计划包含步骤 0、1（无依赖），步骤 2、3 分别依赖 0，步骤 4 依赖 2、3
- **THEN** ACT 阶段识别 3 个波次：
  - 波次 1：步骤 0、1
  - 波次 2：步骤 2、3
  - 波次 3：步骤 4

---

### Requirement：并行工具调用发起

对于同一波次中的所有步骤，ACT 阶段应同时发起工具调用，不阻塞等待任何一个完成。

#### Scenario：异步工具调用

- **WHEN** 波次包含 2 个步骤，均调用不同工具
- **THEN** ACT 阶段使用 Promise.all 或类似机制同时发起两个工具调用

#### Scenario：调用间无阻塞

- **WHEN** 第一个工具调用已发起，立即发起第二个工具调用
- **THEN** ACT 阶段不等待第一个工具返回结果就发起第二个调用

#### Scenario：波次间有序等待

- **WHEN** 波次 1 的所有调用已发起，准备进入波次 2
- **THEN** ACT 阶段阻塞等待波次 1 的所有工具调用完成才开始波次 2

---

### Requirement：结果收集和排序

所有工具调用完成后，ACT 阶段应收集所有结果，按步骤索引顺序排列返回，保证结果顺序与计划步骤顺序一致。

#### Scenario：结果按步骤顺序返回

- **WHEN** 步骤 0、1 并行执行，步骤 1 先返回，步骤 0 后返回
- **THEN** 结果数组按步骤索引排序：[step0_result, step1_result]

#### Scenario：部分结果失败处理

- **WHEN** 并行执行中步骤 0 成功，步骤 1 超时
- **THEN** 结果包含两个条目，step1_result 包含 status="timeout"

#### Scenario：结果中保持步骤对应关系

- **WHEN** ACT 阶段返回结果
- **THEN** 每个结果包含 stepIndex 字段，标识其对应的计划步骤

---

### Requirement：超时和资源限制

并行执行应遵守全局和单步超时限制。单个工具调用的超时独立，全局限制规约所有并行调用的总耗时。

#### Scenario：单步超时

- **WHEN** 某个工具配置超时为 10s
- **THEN** 即使在并行波次中，该工具调用 10s 后仍会超时中断

#### Scenario：全局波次超时

- **WHEN** 波次 1 包含 3 个工具，配置波次总超时为 15s
- **THEN** 波次 1 中任何工具调用不会超过 15s（最慢的工具决定波次耗时）

#### Scenario：并发连接限制

- **WHEN** 系统配置最大并发工具调用为 5
- **THEN** 即使计划包含 10 个并行步骤，系统也最多同时发起 5 个调用

#### Scenario：资源限制告警

- **WHEN** 并行执行接近资源限制（如 80% 并发）
- **THEN** 系统记录警告日志，供监控告警系统使用

---

### Requirement：部分失败处理

在并行执行中，某些步骤失败不应自动中止其他步骤。系统应继续执行所有步骤，在反思阶段统一评估失败。

#### Scenario：一个失败，其他继续

- **WHEN** 波次 1 包含步骤 0、1，步骤 0 失败
- **THEN** 系统不中止步骤 1，继续执行，等待两者结果

#### Scenario：多个失败报告

- **WHEN** 波次包含 4 个步骤，其中 2 个失败
- **THEN** ACT 返回结果包含 4 个条目，其中 2 个标记为 status="failed"

#### Scenario：反思阶段失败决策

- **WHEN** ACT 返回包含多个失败的结果
- **THEN** 反思阶段评估失败的严重性和影响，决定 retry / new_plan / fallback

---

### Requirement：并行执行函数集合

```typescript
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

// 创建默认工具执行器
function createDefaultToolExecutor(
  toolExecutor: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<string>
): (
  toolName: string,
  args: Record<string, unknown>,
  timeout: number
) => Promise<ToolExecutionResult>;

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
