## MODIFIED Requirements

### Requirement：Agent 执行主循环

现有 Agent 执行从单次规划→执行→返回改为多轮 OBSERVE→PLAN→ACT→REFLECT 循环。

#### Scenario：外部调用接口保持兼容
- **WHEN** 外层应用调用 `agent.execute(prompt, tools)`
- **THEN** 返回值格式不变，仍然是 `Promise<ExecutionResult>`

#### Scenario：内部执行流程升级
- **WHEN** `execute()` 被调用
- **THEN** 内部执行多轮循环而非单次规划：
  1. 第一轮进入 OBSERVE 阶段收集初始状态
  2. PLAN 阶段调用规划器生成计划
  3. ACT 阶段执行工具
  4. REFLECT 阶段评估结果决策
  5. 如果反思返回 done=false，返回第 1 步；否则返回最终答案

#### Scenario：规划器签名变化
- **WHEN** 规划器被调用
- **THEN** 输入从旧的 `{prompt, toolResults}` 变为新的 PlanningContext 对象

#### Scenario：规划器输出变化
- **WHEN** 规划器返回结果
- **THEN** 从布尔 `needsTool` 变为结构化对象：
  ```json
  {
    "type": "tool" | "final",
    "steps": [多步计划],
    "confidence": number
  }
  ```

#### Scenario：工具调用方式变化
- **WHEN** ACT 阶段执行工具
- **THEN** 不再逐个同步调用，而是：
  - 识别计划中的依赖关系
  - 并行执行无依赖的步骤
  - 等待依赖完成后执行后续步骤

---

### Requirement：规划器接口升级

现有规划器接口需调整以支持新的执行模型。

#### Scenario：新增功能：多步规划
- **WHEN** 规划器规划
- **THEN** 可输出 steps 数组而非单个工具调用

#### Scenario：新增功能：置信度评分
- **WHEN** 规划器输出计划
- **THEN** 必须包含 confidence 字段表示计划信心

#### Scenario：新增功能：最终答案类型
- **WHEN** 规划器认为任务完成
- **THEN** 返回 `type: "final"` 而非依赖外层判断

#### Scenario：输入上下文丰富
- **WHEN** 规划器接收输入
- **THEN** 包含完整的 PlanningContext 而非简单的历史消息

#### Scenario：向后兼容路径（可选）
- **WHEN** 现有规划器无法升级
- **THEN** 系统可提供适配层，将旧规划器输出转换为新格式（需手动映射 needsTool → type）

---

### Requirement：工具调用执行升级

工具调用执行从顺序单体升级为计划驱动的并行模式。

#### Scenario：计划驱动执行
- **WHEN** ACT 阶段执行
- **THEN** 按照 PLAN 阶段生成的计划执行，而非直接按工具列表

#### Scenario：依赖尊重
- **WHEN** 计划中步骤 B 依赖步骤 A
- **THEN** 系统确保 A 完成后才执行 B

#### Scenario：并行执行
- **WHEN** 计划中多个步骤无依赖
- **THEN** 系统同时发起多个工具调用（受并发限制）

#### Scenario：结果按计划顺序返回
- **WHEN** 工具执行完毕
- **THEN** 返回结果按计划步骤顺序排列，便于反思和后续处理

---

### Requirement：错误处理升级

现有单一错误处理改为多层次错误处理。

#### Scenario：工具层面错误处理
- **WHEN** 某个工具调用失败
- **THEN** ACT 阶段记录失败但不立即中止，继续执行其他步骤

#### Scenario：反思层面决策
- **WHEN** ACT 阶段返回包含失败的结果
- **THEN** REFLECT 阶段分析失败原因，决定 retry / new_plan / fallback

#### Scenario：全局级别降级
- **WHEN** 多轮循环仍无进展
- **THEN** 系统触发 fallback，返回最佳努力的答案

#### Scenario：错误信息保留和传播
- **WHEN** 执行失败
- **THEN** 返回的 ExecutionResult 包含详细错误信息和诊断数据

---

### Requirement：性能和可观测性升级

增强执行过程的性能指标和日志记录。

#### Scenario：结构化日志
- **WHEN** 执行进行中
- **THEN** 系统记录每个阶段的日志，包含迭代号、耗时、关键决策

#### Scenario：指标收集
- **WHEN** 执行完成
- **THEN** 返回结果包含完整的 ExecutionMetrics 对象

#### Scenario：可视化支持
- **WHEN** 需要理解执行过程
- **THEN** 系统提供追踪数据可导出为时间线或 DAG 格式

#### Scenario：性能开销最小化
- **WHEN** 配置 metricsLevel="basic"
- **THEN** 性能开销 < 5%（相比原单次执行）

---

### Requirement：超时和资源管理

现有简单的超时管理升级为多层次的资源管理。

#### Scenario：全局超时
- **WHEN** Agent 执行
- **THEN** 遵守 maxExecutionTime（默认 60s）限制

#### Scenario：阶段级超时
- **WHEN** 某个阶段（如 ACT）执行
- **THEN** 如 ACT 涉及并行工具调用，单个波次有 batchTimeout

#### Scenario：工具级超时
- **WHEN** 某个工具调用
- **THEN** 每个工具有独立的超时限制，超时时中止该工具

#### Scenario：提前警告
- **WHEN** 执行接近超时或 token 限制
- **THEN** 系统发出预警，允许上层应用做出反应

---

### Requirement：内存和状态管理

现有单次执行的简单状态改为多轮循环的复杂状态。

#### Scenario：循环状态追踪
- **WHEN** 循环进行中
- **THEN** 系统维护完整的执行状态，包括当前迭代号、阶段、历史记录

#### Scenario：内存压缩
- **WHEN** 执行跨多轮循环
- **THEN** 系统自动生成摘要记忆，防止 token 爆炸

#### Scenario：状态恢复（未来）
- **WHEN** 执行中断需要恢复
- **THEN** 系统保存完整的执行快照，允许后续恢复

---

### Requirement：规划器和反思器的一致性

规划器的规划输出应与反思器的期望一致。

#### Scenario：计划格式一致性
- **WHEN** 规划器输出计划
- **THEN** 反思器和 ACT 阶段都能正确解析该格式

#### Scenario：置信度语义一致
- **WHEN** 规划器输出 confidence 0.7
- **THEN** 反思器理解此表示"70% 的信心该计划成功"

#### Scenario：步骤依赖的一致理解
- **WHEN** 规划器输出步骤依赖
- **THEN** ACT 阶段正确理解为执行顺序约束

---

### Requirement：执行结果格式升级

返回的 ExecutionResult 应包含新的循环执行信息。

#### Scenario：基础结果格式保留
- **WHEN** 调用方读取结果
- **THEN** 仍包含原有字段：answer / error / success

#### Scenario：新增循环信息
- **WHEN** 返回结果
- **THEN** 新增字段：
  - iterationCount（消耗的轮数）
  - terminationReason（终止原因）
  - metrics（ExecutionMetrics 对象）

#### Scenario：详细执行追踪
- **WHEN** 调用方需要调试
- **THEN** 结果包含可选的 trace 字段，含所有工具调用、规划、反思的记录

#### Scenario：向后兼容性
- **WHEN** 旧版调用方只关注 answer
- **THEN** 可直接访问 result.answer，新字段对现有代码无影响

---

### Requirement：配置项新增

新的执行模型引入多个可配置参数。

#### Scenario：循环配置
- **WHEN** 创建 Agent 时
- **THEN** 可配置：
  - maxIterations（默认 10）
  - maxExecutionTime（默认 60s）
  - terminationStrategy（"conservative" / "balanced" / "aggressive"）

#### Scenario：内存配置
- **WHEN** 创建 Agent 时
- **THEN** 可配置：
  - maxWorkingMemorySize（默认 10）
  - summaryTrigger（"round_based" / "token_based" / "semantic"）
  - summaryTriggerValue（每 N 轮或每 M tokens）

#### Scenario：并行配置
- **WHEN** 创建 Agent 时
- **THEN** 可配置：
  - maxConcurrentTools（默认 5）
  - batchTimeout（默认 30s）

#### Scenario：默认值合理性
- **WHEN** 使用默认配置
- **THEN** 对大多数场景适用，性能和准确度平衡
