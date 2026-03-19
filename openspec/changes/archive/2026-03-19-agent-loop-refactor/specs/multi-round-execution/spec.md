## 多轮循环执行能力

### Requirement：状态机驱动的循环执行

系统应实现显式的 OBSERVE → PLAN → ACT → REFLECT 状态机，循环执行直到满足终止条件。每轮循环应按序进行观察、规划、执行、反思，并根据反思结果决定是否继续循环或返回最终答案。

#### Scenario：正常多轮循环流程
- **WHEN** Agent 接收需要多步工具调用的复杂任务
- **THEN** 系统执行至少 2 轮循环，每轮包括 OBSERVE/PLAN/ACT/REFLECT 四个阶段

#### Scenario：单轮终止
- **WHEN** 规划器在第一轮规划后输出 `type: "final"` 且置信度 ≥0.8
- **THEN** 系统在第一轮反思后终止，不进行第二轮循环

#### Scenario：循环中动态调整
- **WHEN** 第一轮工具执行失败，反思阶段判定为可恢复错误
- **THEN** 系统进入第二轮循环，规划器根据失败信息重新规划

---

### Requirement：阶段化上下文管理

每个阶段应维护和更新自己的上下文：OBSERVE 收集状态，PLAN 使用上下文，ACT 执行工具，REFLECT 评估结果。各阶段上下文应显式传递，防止隐藏依赖。

#### Scenario：OBSERVE 阶段上下文收集
- **WHEN** 进入新一轮循环的 OBSERVE 阶段
- **THEN** 系统收集对话历史、工具结果、token 状态、迭代计数，封装为 PlanningContext 对象

#### Scenario：PLAN 阶段使用完整上下文
- **WHEN** OBSERVE 阶段完成，进入 PLAN 阶段
- **THEN** 规划器接收包含工作记忆、工具记忆、摘要记忆的完整 PlanningContext

#### Scenario：REFLECT 阶段决策基于 ACT 结果
- **WHEN** ACT 阶段返回工具执行结果，进入 REFLECT 阶段
- **THEN** 反思器评估工具成功/失败，决定 retry/new_plan/finalize_answer/fallback 之一

---

### Requirement：循环计数和迭代追踪

系统应追踪循环迭代次数，并使用此作为硬限制和指标参考。每轮循环应记录其编号，工具调用应知晓自己所在的迭代轮数。

#### Scenario：迭代计数递增
- **WHEN** 完成一轮 REFLECT 阶段后准备下一轮循环
- **THEN** iterationCount 自增 1，下一轮 OBSERVE 阶段使用新的计数

#### Scenario：工具结果关联迭代编号
- **WHEN** ACT 阶段执行工具并返回结果
- **THEN** 每个工具结果包含 iterationNum 字段，指示其在第几轮循环中执行

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
- **WHEN** 从执行开始的总耗时超过配置超时（默认 60s）
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
- **THEN** 执行结果包含 terminationReason 和 terminationDetails，便于事后分析
