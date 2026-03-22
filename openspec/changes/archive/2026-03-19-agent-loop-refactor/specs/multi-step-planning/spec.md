## 多步计划能力

### Requirement：多步计划输出格式

规划器应能输出包含多个工具调用步骤的计划。每个步骤指定工具名、输入、以及依赖的前序步骤（用于描述执行顺序）。

#### Scenario：单步计划
- **WHEN** 任务可通过单个工具解决
- **THEN** 规划器返回包含 1 个步骤的计划：
  ```json
  {
    "type": "tool",
    "steps": [{"tool": "SearchTool", "input": {...}, "dependencies": []}],
    "confidence": 0.9
  }
  ```

#### Scenario：两步串行计划
- **WHEN** 任务需要先搜索后分析
- **THEN** 规划器返回 2 步计划，第二步依赖第一步：
  ```json
  {
    "type": "tool",
    "steps": [
      {"tool": "SearchTool", "input": {...}, "dependencies": []},
      {"tool": "AnalyzeTool", "input": {...}, "dependencies": [0]}
    ],
    "confidence": 0.8
  }
  ```

#### Scenario：三步计划含并行
- **WHEN** 任务包含可并行的操作
- **THEN** 规划器返回 3 步计划，步骤 1 和 2 可并行执行，步骤 3 依赖两者：
  ```json
  {
    "type": "tool",
    "steps": [
      {"tool": "FetchWeather", "input": {...}, "dependencies": []},
      {"tool": "FetchNews", "input": {...}, "dependencies": []},
      {"tool": "Summarize", "input": {...}, "dependencies": [0, 1]}
    ],
    "confidence": 0.7
  }
  ```

---

### Requirement：置信度评分

规划器应为每个计划输出置信度评分（0.0 到 1.0）。置信度表示规划器对此计划成功的信心，反思阶段使用此评分决定是否信任该计划。

#### Scenario：高置信度计划
- **WHEN** 规划器对任务理解充分，计划策略清晰
- **THEN** 计划包含 confidence ≥ 0.8

#### Scenario：低置信度计划
- **WHEN** 规划器对任务不确定，可能需要调整
- **THEN** 计划包含 confidence < 0.6

#### Scenario：中置信度计划
- **WHEN** 规划器有基本理解但可能需要迭代
- **THEN** 计划包含 0.6 ≤ confidence < 0.8

---

### Requirement：步骤依赖描述

每个步骤的 dependencies 字段应使用整数数组，指示依赖的前序步骤的索引（基于 0）。系统应验证依赖图的合法性（无循环）。

#### Scenario：无依赖步骤
- **WHEN** 某步骤可独立执行
- **THEN** 该步骤的 dependencies 为空数组 []

#### Scenario：单依赖
- **WHEN** 步骤 2 依赖步骤 0 的结果
- **THEN** 步骤 2 的 dependencies 为 [0]

#### Scenario：多依赖
- **WHEN** 步骤 3 依赖步骤 0 和步骤 1 的结果
- **THEN** 步骤 3 的 dependencies 为 [0, 1]

#### Scenario：依赖图合法性检查
- **WHEN** ACT 阶段收到计划
- **THEN** 系统验证依赖图中无循环依赖，所有索引在有效范围内，否则返回错误

---

### Requirement：推理字段（可选）

规划器可选提供 reasoning 字段，说明为何选择此计划。此字段用于可调试性和日志，不影响执行逻辑。

#### Scenario：包含推理说明
- **WHEN** 规划器生成计划时提供推理信息
- **THEN** 计划返回包含 reasoning 字段，如："First search for relevant data, then analyze results"

#### Scenario：缺少推理说明
- **WHEN** 规划器未提供 reasoning
- **THEN** 计划返回的 reasoning 字段为空或不存在，不影响执行

---

### Requirement：最终答案类型

规划器应能返回 `type: "final"` 表示任务完成，无需进一步工具调用。此时 steps 字段为空。

#### Scenario：任务完成返回最终答案
- **WHEN** 规划器认为已有足够信息生成最终答案
- **THEN** 规划器返回：
  ```json
  {
    "type": "final",
    "steps": [],
    "confidence": 0.85,
    "reasoning": "Sufficient information gathered to answer the question"
  }
  ```

#### Scenario：最终答案的置信度检查
- **WHEN** 规划器返回 `type: "final"`，置信度 < 0.6
- **THEN** 反思阶段可能建议继续规划而非直接终止

---

### Requirement：步骤输入的动态构建

步骤的输入可能需要从前序步骤的输出中提取。系统应支持在执行时进行动态输入填充，允许步骤输入包含占位符或表达式。

#### Scenario：硬编码步骤输入
- **WHEN** 步骤输入在规划时已完全确定
- **THEN** ACT 阶段直接使用该输入执行工具

#### Scenario：依赖前序步骤输出的输入
- **WHEN** 步骤 1 依赖步骤 0，需要使用步骤 0 的输出
- **THEN** ACT 阶段在执行步骤 1 前，将步骤 0 的输出注入步骤 1 的输入字段中

#### Scenario：条件执行占位符
- **WHEN** 计划中某步骤有条件执行逻辑
- **THEN** 系统允许计划包含条件标记（如 IF_SUCCESS[0]），反思阶段在阶段转移时解析

---

### Requirement：并行步骤执行

ACT 阶段应能识别计划中的并行步骤（无依赖或依赖已完成的步骤），并并行执行它们以提高效率。

#### Scenario：两个独立步骤并行执行
- **WHEN** 步骤 0 和步骤 1 都无依赖
- **THEN** ACT 阶段同时发起这两个工具调用（不等待任何一个完成）

#### Scenario：串行步骤等待依赖
- **WHEN** 步骤 2 依赖步骤 0，步骤 1 无依赖
- **THEN** ACT 阶段先并行执行步骤 0 和 1，待步骤 0 完成后再执行步骤 2

#### Scenario：并行执行的结果收集
- **WHEN** 多个步骤并行执行并完成
- **THEN** ACT 阶段按步骤索引顺序收集结果，返回有序的工具结果数组

---

### Requirement：计划执行限制

系统应对多步计划的规模进行限制，防止规划器输出过大计划导致执行时间过长。

#### Scenario：步骤数限制
- **WHEN** 规划器返回计划包含超过配置的 maxStepsPerPlan（默认 10）个步骤
- **THEN** 系统拒绝此计划，要求规划器简化计划

#### Scenario：计划复杂度验证
- **WHEN** ACT 阶段收到计划
- **THEN** 系统验证步骤数、依赖深度（最长路径）不超过限制

---

### Requirement：计划可视化和调试

系统应支持将计划表示为可视化格式（如 DAG 或树形），便于调试和理解执行流程。

#### Scenario：计划拓扑排序
- **WHEN** 需要理解步骤执行顺序
- **THEN** 系统提供 `getExecutionOrder(plan)` 返回步骤的拓扑排序

#### Scenario：计划 DAG 表示
- **WHEN** 需要调试计划结构
- **THEN** 系统可将计划转换为 GraphML 或 DOT 格式，支持可视化工具展示
