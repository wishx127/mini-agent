## 强化反思能力

### Requirement：工具结果成功评估

反思阶段应评估工具执行是否成功，基于状态、输出长度、错误标记等多个信号判断。

#### Scenario：成功工具调用
- **WHEN** 工具返回 status="success"，输出长度 > 10 字符，无错误标记
- **THEN** 反思器判定此调用为"成功"

#### Scenario：部分成功输出
- **WHEN** 工具返回 status="success"，但输出为 "Error: not found"（内容错误）
- **THEN** 反思器识别此为"假成功"，标记为需要关注

#### Scenario：工具超时
- **WHEN** 工具返回 status="timeout"
- **THEN** 反思器判定此调用为"失败"，且失败原因为超时

#### Scenario：异常返回
- **WHEN** 工具返回 status="failed"，error 字段包含异常信息
- **THEN** 反思器提取错误信息，用于错误归因

---

### Requirement：错误归因分析

反思阶段应分析失败原因，区分以下几类：
1. **工具错误**（API 问题、网络问题）
2. **规划器错误**（工具选择不当、输入参数错误）
3. **系统限制**（token 超限、超时）
4. **可恢复 vs 不可恢复**

#### Scenario：工具级别错误
- **WHEN** 工具返回 "Connection timeout"
- **THEN** 反思器归因为"tool_error"，子类为"network_timeout"

#### Scenario：规划器选择错误
- **WHEN** 工具返回"Cannot find requested information"，且该工具是唯一搜索工具
- **THEN** 反思器归因可能为"planner_error"，需要尝试不同的工具或参数

#### Scenario：参数错误
- **WHEN** 工具返回"Invalid parameter: query"，且查询参数由规划器生成
- **THEN** 反思器归因为"planner_error"，子类为"invalid_input"

#### Scenario：Token 超限
- **WHEN** 执行中发现剩余 token 预算 < 100
- **THEN** 反思器归因为"system_limit"，子类为"token_budget"

---

### Requirement：信息增长评估

反思阶段应评估本轮工具调用是否产生了新信息，或仅是重复之前的结果。

#### Scenario：新信息检测
- **WHEN** 工具返回结果，且长度 > 50 字符，与之前所有结果的余弦相似度 < 0.7
- **THEN** 反思器判定为"新信息"

#### Scenario：重复信息检测
- **WHEN** 工具返回结果，完全相同于某个前序工具结果（字符串相等）
- **THEN** 反思器判定为"重复信息"，信息密度 = 0

#### Scenario：部分重复信息
- **WHEN** 工具返回结果，与某个前序结果的 20% 内容相同
- **THEN** 反思器判定为"部分新信息"，密度 < 0.5

---

### Requirement：多维度决策框架

反思阶段应根据多个维度综合决策下一步行动，包括成功率、信息增长、置信度、重试预算等。

#### Scenario：全部成功，无新信息
- **WHEN** 所有工具成功，但信息密度 ≤ 0
- **THEN** 反思器返回 action="finalize_answer"

#### Scenario：全部成功，有新信息
- **WHEN** 所有工具成功，信息密度 > 0.5
- **THEN** 反思器返回 action="continue"（继续下一轮规划）

#### Scenario：部分失败，可恢复
- **WHEN** 某工具因参数错误失败，重试预算未用尽
- **THEN** 反思器返回 action="retry"，建议修改参数重试

#### Scenario：工具均失败，可恢复
- **WHEN** 多个工具失败但失败原因不同（网络 + 参数），重试预算充足
- **THEN** 反思器返回 action="new_plan"，建议规划器调整策略

#### Scenario：工具均失败，预算耗尽
- **WHEN** 多个工具失败，重试预算已耗尽
- **THEN** 反思器返回 action="fallback"，无法继续

---

### Requirement：下一步行动决策

反思阶段应输出明确的下一步行动，选项包括：
1. **continue**: 进行下一轮规划和执行
2. **retry**: 修改参数重试
3. **finalize_answer**: 生成最终答案
4. **fallback**: 使用降级策略，终止循环

#### Scenario：继续循环
- **WHEN** 本轮有进展，但信息不足以回答，且未达迭代上限
- **THEN** 反思器返回 `{done: false, action: "continue"}`

#### Scenario：参数重试
- **WHEN** 工具失败因参数错误，规划器可能改进参数
- **THEN** 反思器返回 `{done: false, action: "retry", suggestion: "adjust_parameters"}`

#### Scenario：完成回答
- **WHEN** 本轮获得充分信息，或已达迭代上限且有基本信息
- **THEN** 反思器返回 `{done: true, action: "finalize_answer"}`

#### Scenario：触发降级
- **WHEN** 工具全部失败，无法恢复
- **THEN** 反思器返回 `{done: true, action: "fallback", reason: "all_tools_failed"}`

---

### Requirement：反思理由和日志

反思器应提供详细的决策理由，便于调试和理解决策逻辑。理由应包含多维度评分。

#### Scenario：决策理由包含评分
- **WHEN** 反思阶段完成
- **THEN** 返回结构包含：
  ```json
  {
    "done": true,
    "action": "finalize_answer",
    "reasoning": {
      "successRate": 0.8,
      "informationGrowth": 0.6,
      "confidenceScore": 0.75,
      "iterationCount": 3,
      "retryBudgetRemaining": 2,
      "terminationReason": "sufficient_information"
    }
  }
  ```

#### Scenario：失败分析报告
- **WHEN** 反思器判定某工具失败
- **THEN** 返回结构包含：
  ```json
  {
    "toolIndex": 1,
    "toolName": "SearchTool",
    "status": "failed",
    "errorType": "parameter_error",
    "errorMessage": "Invalid query format",
    "isRecoverable": true,
    "suggestedAction": "retry_with_adjusted_query"
  }
  ```

---

### Requirement：置信度驱动的重试

反思阶段应根据规划器的置信度决定是否重试或放弃。高置信度计划失败时应更激进重试，低置信度计划失败时应更快转向其他策略。

#### Scenario：高置信度计划失败
- **WHEN** 规划器置信度 ≥ 0.8，工具执行失败
- **THEN** 反思器优先选择 "retry"，而非立即 "new_plan"

#### Scenario：低置信度计划失败
- **WHEN** 规划器置信度 < 0.6，工具执行失败
- **THEN** 反思器优先选择 "new_plan" 或 "fallback"

#### Scenario：置信度作为重试限制
- **WHEN** 规划器置信度 0.5，反思器评估是否重试
- **THEN** 反思器可能选择 "fallback" 而非多次重试

---

### Requirement：反思阶段超时

反思器本身应限制在一定时间内完成（避免反思本身成为瓶颈）。

#### Scenario：反思超时限制
- **WHEN** 反思阶段执行
- **THEN** 系统给予最多 100ms 的执行时间，超时返回默认决策

#### Scenario：复杂场景默认决策
- **WHEN** 反思超时，无法完成完整分析
- **THEN** 系统返回保守决策：action="finalize_answer"（终止并生成答案）

---

### Requirement：反思可配置策略

系统应允许配置反思的决策规则，支持不同的风险偏好。

#### Scenario：保守策略
- **WHEN** 配置 `reflectionStrategy="conservative"`
- **THEN** 反思器倾向于快速放弃和降级，避免长循环

#### Scenario：激进策略
- **WHEN** 配置 `reflectionStrategy="aggressive"`
- **THEN** 反思器倾向于重试和继续，充分利用迭代预算

#### Scenario：平衡策略
- **WHEN** 配置 `reflectionStrategy="balanced"`（默认）
- **THEN** 反思器在重试和放弃间找到平衡点

---

### Requirement：反思状态更新

反思阶段应更新执行的累积状态，包括重试计数、失败统计等，供后续决策和指标使用。

#### Scenario：重试计数更新
- **WHEN** 反思器决定 "retry"
- **THEN** 对应工具的重试计数递增

#### Scenario：失败统计更新
- **WHEN** 反思器评估工具失败
- **THEN** 全局失败统计更新（按工具类型、错误类型分类）

#### Scenario：信息增长累计
- **WHEN** 反思器评估本轮信息增长
- **THEN** 系统维护累积的信息增长量，用于收敛检测
