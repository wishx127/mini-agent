## 规划上下文能力

### Requirement：PlanningContext 数据结构

PlanningContext 是一个统一的数据结构，包含规划器所需的所有上下文信息，从而使规划器无需直接访问内部数据结构。

#### Scenario：基础字段
- **WHEN** OBSERVE 阶段构建 PlanningContext
- **THEN** 结构包含必备字段：
  ```
  - userPrompt (string)
  - workingMemory (Message[])
  - toolMemory (ToolRecord[])
  - summaryMemory (Summary[])
  - iterationCount (number)
  - availableTools (ToolInfo[])
  ```

#### Scenario：额外字段
- **WHEN** PlanningContext 构建完毕
- **THEN** 结构还包含可选字段：
  ```
  - remainingTokenBudget (number)
  - remainingIterations (number)
  - previousPlanConfidence (number)
  - failedToolsThisRound (string[])
  - informationGrowthRate (number)
  - deduplicationInfo (DeduplicationState)
  ```

#### Scenario：工具信息字段
- **WHEN** availableTools 字段填充
- **THEN** 每个工具包含：
  - name (string)
  - description (string)
  - inputSchema (object)
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
- **THEN** 每条消息包含 role（user / assistant / tool）和 content

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
  - timeRange (from / to)
  - messageCount (被压缩的消息数)
  - summary (文本摘要)

#### Scenario：摘要在规划中使用
- **WHEN** 规划器需要理解之前的工作历程
- **THEN** 可读取摘要而非完整历史，节省 token 和思考时间

---

### Requirement：Token 和资源信息

PlanningContext 应包含当前的 token 预算和执行资源状态。

#### Scenario：Token 预算
- **WHEN** 规划器需要了解剩余 token
- **THEN** remainingTokenBudget 字段指示还可用的 token 数

#### Scenario：迭代预算
- **WHEN** 规划器需要了解还有多少轮迭代
- **THEN** remainingIterations 字段指示 maxIterations - iterationCount

#### Scenario：资源约束感知
- **WHEN** 剩余 token 仅有 1000，剩余迭代 1 轮
- **THEN** 规划器可据此调整计划复杂度

---

### Requirement：失败和性能信息

PlanningContext 应包含本轮的失败信息和性能指标，帮助规划器调整策略。

#### Scenario：本轮失败工具列表
- **WHEN** 某些工具在本轮失败
- **THEN** failedToolsThisRound 字段列出工具名称

#### Scenario：失败原因
- **WHEN** 规划器查询失败的原因
- **THEN** 每个失败工具包含 failureReason（如 "timeout" / "parameter_error"）

#### Scenario：信息增长率
- **WHEN** informationGrowthRate 计算完毕
- **THEN** PlanningContext 包含 0 到 1 之间的数值，表示本轮信息增长程度

#### Scenario：工具成功率
- **WHEN** 规划器评估工具可靠性
- **THEN** 每个工具的 recentSuccessRate 基于最近 5 次调用计算

---

### Requirement：Deduplication 状态信息

PlanningContext 应包含工具去重的相关信息，使规划器能够做出知情决策。

#### Scenario：最近重复调用
- **WHEN** deduplicationInfo 被访问
- **THEN** 包含最近检测到的重复调用及其状态（skipped / retried）

#### Scenario：重试预算
- **WHEN** 规划器考虑重试某工具
- **THEN** deduplicationInfo 包含该工具的剩余重试预算

#### Scenario：去重建议
- **WHEN** 规划器建议调用某工具
- **THEN** 系统返回是否存在最近相同的调用，供规划器参考

---

### Requirement：上下文大小管理

系统应确保 PlanningContext 的总大小在模型上下文窗口的合理范围内。

#### Scenario：大小计算
- **WHEN** PlanningContext 构建完毕
- **THEN** 系统计算其总 token 数，确保 ≤ 模型上下文 * 0.6

#### Scenario：超大小处理
- **WHEN** PlanningContext 超过 token 限制
- **THEN** 系统自动截断工具记忆（保留最近 5 条）、摘要记忆（仅保留最新摘要）

#### Scenario：预留空间
- **WHEN** 规划器需要输出空间
- **THEN** PlanningContext 大小最多占用 60%，预留 40% 给规划器输出

---

### Requirement：上下文序列化和持久化

系统应支持将 PlanningContext 序列化为 JSON，便于日志记录和调试。

#### Scenario：完整序列化
- **WHEN** 调用 `context.toJSON()`
- **THEN** 返回可被 `JSON.stringify` 处理的完整结构

#### Scenario：缩减序列化
- **WHEN** 调用 `context.toJSON({verbose: false})`
- **THEN** 返回仅包含关键字段的精简版本，便于快速日志

#### Scenario：文件保存
- **WHEN** 需要保存上下文用于调试
- **THEN** 系统提供 `context.saveToFile(path)` 接口保存 JSON 文件

---

### Requirement：上下文工厂和验证

系统应提供规范化的方式构建和验证 PlanningContext。

#### Scenario：工厂方法
- **WHEN** OBSERVE 阶段需要构建上下文
- **THEN** 调用 `PlanningContextFactory.create(observedState)` 返回有效的 PlanningContext

#### Scenario：验证检查
- **WHEN** PlanningContext 构建完毕
- **THEN** 系统验证：
  - 所有必需字段存在
  - 数值字段在有效范围内
  - 消息列表按时间有序
  - 无循环引用

#### Scenario：验证失败处理
- **WHEN** 验证失败
- **THEN** 系统抛出详细错误，指示缺失或无效的字段

---

### Requirement：上下文版本和兼容性

系统应支持 PlanningContext 的版本管理，便于未来演进。

#### Scenario：版本字段
- **WHEN** PlanningContext 创建
- **THEN** 包含 `version` 字段指示其版本号（如 "1.0"）

#### Scenario：版本兼容性
- **WHEN** 规划器接收 PlanningContext
- **THEN** 检查版本并确保兼容，否则抛出错误或尝试升级

#### Scenario：向后兼容性
- **WHEN** 新的规划器版本接收旧的 PlanningContext
- **THEN** 系统可在必要时填充新字段的默认值
