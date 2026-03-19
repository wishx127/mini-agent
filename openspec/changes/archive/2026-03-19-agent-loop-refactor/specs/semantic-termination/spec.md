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

系统应设置总执行时间的硬限制（默认 60 秒）。超时时立即中止所有操作。

#### Scenario：执行时间超时
- **WHEN** 从执行开始到当前时间 > maxExecutionTime（默认 60s）
- **THEN** 循环立即终止，reason="execution_timeout"

#### Scenario：可配置超时
- **WHEN** 系统初始化时设置 maxExecutionTime=120
- **THEN** 循环最多执行 120 秒

#### Scenario：波次级超时
- **WHEN** 某个波次（并行工具组）的总耗时 > batchTimeout（默认 30s）
- **THEN** 该波次中仍未完成的工具调用被中止

#### Scenario：优雅超时处理
- **WHEN** 执行接近超时（剩余 5 秒）
- **THEN** 反思阶段立即返回 done=true，不再进行新的规划

---

### Requirement：降级触发终止

当工具失败超过重试预算或无法进展时，系统应触发降级策略并终止。

#### Scenario：单个工具重试预算耗尽
- **WHEN** 某工具失败 3 次（默认重试上限），仍无成功
- **THEN** 反思阶段返回 action="fallback"，终止循环

#### Scenario：多个工具均失败
- **WHEN** 本轮执行中 3 个工具中 2 个失败，无新信息
- **THEN** 反思阶段返回 done=true，reason="fallback_triggered"

#### Scenario：降级信号
- **WHEN** 反思阶段检测到无法进展（工具反复失败，信息增长停滞）
- **THEN** 系统发出 fallback_signal，上层应用可据此提供降级服务

---

### Requirement：复合终止条件评估

系统应综合评估多个终止条件，根据优先级决策是否终止。

#### Scenario：多个条件同时满足
- **WHEN** iterationCount 达到上限 AND Token 超预算
- **THEN** 系统选择优先级更高的条件（通常是硬限制），返回相应 reason

#### Scenario：优先级顺序
- **WHEN** 评估终止条件
- **THEN** 优先级为：
  1. 超时（硬限制，最高优先级）
  2. Token 超限（资源限制）
  3. 最大迭代（预算限制）
  4. 规划器信号（语义判断）
  5. 无信息增长（收敛检测，最低优先级）

#### Scenario：保守评估
- **WHEN** 终止条件不明确（如信息增长率在边界）
- **THEN** 系统倾向保守（继续执行）而非激进（提前终止）

---

### Requirement：终止原因记录

系统应明确记录终止的原因和相关上下文，便于调试和指标分析。

#### Scenario：终止原因枚举
- **WHEN** 循环终止
- **THEN** reason 字段取值为：
  - "planner_final_high_confidence"
  - "planner_final_medium_confidence"
  - "no_information_growth"
  - "max_iterations_reached"
  - "token_limit_exceeded"
  - "execution_timeout"
  - "fallback_triggered"
  - "user_interrupted"

#### Scenario：终止上下文
- **WHEN** 循环终止
- **THEN** 返回的终止信息包含：
  - reason (字符串)
  - finalIterationCount (数字)
  - elapsedTime (毫秒)
  - tokensUsed (数字)
  - informationGrowth (数字 0-1)
  - toolSuccessRate (数字 0-1)

#### Scenario：指标关联
- **WHEN** 终止原因为 "max_iterations_reached"
- **THEN** 指标包含 hitMaxIterationsFlag=true，便于分析过度迭代的任务

---

### Requirement：提前信号和预警

系统应在临界条件满足前发出预警，允许上层应用提前准备降级。

#### Scenario：迭代预算预警
- **WHEN** iterationCount == maxIterations - 2（如 8）
- **THEN** 系统记录预警日志，通知观察者"仅剩 2 轮迭代"

#### Scenario：Token 预警
- **WHEN** remainingTokenBudget < 20%
- **THEN** 系统发出 token_warning 事件

#### Scenario：超时预警
- **WHEN** elapsedTime > 0.8 * maxExecutionTime（如超过 48 秒）
- **THEN** 系统发出 timeout_warning 事件

#### Scenario：观察者处理预警
- **WHEN** 上层应用监听到预警
- **THEN** 可主动触发 summaryMemory 压缩或准备降级响应
