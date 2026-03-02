# Agent Planner 规格说明

## 概述

Planner 是 Agent 编排层的决策模块，负责工具选择决策、调用顺序规划和参数验证。作为纯决策模块，Planner 不执行任何实际操作，仅返回执行计划。

## ADDED Requirements

### Requirement: Planner 必须判断是否需要使用工具

系统必须分析用户输入和对话历史，判断是否需要调用工具。

#### Scenario: 需要工具获取实时信息

- **WHEN** 用户询问当前天气、新闻或实时数据
- **THEN** Planner 必须返回需要使用工具的执行计划

#### Scenario: 一般问题不需要工具

- **WHEN** 用户询问不需要实时数据的一般知识问题
- **THEN** Planner 必须返回不需要使用工具的执行计划

#### Scenario: 特定搜索关键词需要工具

- **WHEN** 用户输入包含"搜索"、"查询"、"联网"、"最新"、"search"、"find"等关键词
- **THEN** Planner 必须返回需要使用工具的执行计划

### Requirement: Planner 必须选择最合适的工具

系统必须评估可用工具，根据用户意图和工具能力选择最合适的工具。

#### Scenario: 信息检索选择搜索工具

- **WHEN** 用户需要搜索信息
- **THEN** Planner 必须选择 Tavily 搜索工具（如果可用且已启用）

#### Scenario: 没有可用工具

- **WHEN** 用户请求的功能没有合适的工具可用
- **THEN** Planner 必须返回不包含工具调用的执行计划

#### Scenario: 工具被禁用

- **WHEN** 最合适的工具存在但被禁用
- **THEN** Planner 不得在执行计划中包含该工具

### Requirement: Planner 必须规划工具执行顺序

系统必须确定需要多个工具时的调用顺序。

#### Scenario: 单工具执行

- **WHEN** 只需要一个工具
- **THEN** Planner 必须返回包含单个工具调用的执行计划

#### Scenario: 多工具顺序执行

- **WHEN** 需要多个有依赖关系的工具
- **THEN** Planner 必须返回工具按正确顺序排列的执行计划

#### Scenario: 独立工具并行执行

- **WHEN** 多个独立的工具可以并行执行
- **THEN** Planner 必须返回允许并行执行的执行计划

### Requirement: Planner 必须验证工具参数

系统必须在执行前根据工具的 schema 验证工具参数。

#### Scenario: 有效参数

- **WHEN** 工具调用的参数有效且符合工具的 schema
- **THEN** Planner 必须在执行计划中包含该工具调用

#### Scenario: 无效参数

- **WHEN** 工具调用的参数无效或缺少必需参数
- **THEN** Planner 必须拒绝该工具调用并在计划中返回错误

#### Scenario: 可选参数缺失

- **WHEN** 可选参数缺失但必需参数存在
- **THEN** Planner 必须接受该工具调用，并为可选参数使用默认值

### Requirement: Planner 必须使用 LLM 进行智能规划

系统必须利用 LLM 对工具使用做出智能决策。

#### Scenario: LLM 成功决策

- **WHEN** LLM 可用并返回有效的工具调用决策
- **THEN** Planner 必须使用 LLM 的决策作为执行计划

#### Scenario: LLM 决策失败

- **WHEN** LLM 调用失败或返回无效响应
- **THEN** Planner 必须回退到基于规则的规划

#### Scenario: LLM 判断不需要工具

- **WHEN** LLM 判断不需要工具
- **THEN** Planner 必须返回不包含工具调用的执行计划

### Requirement: Planner 必须提供基于规则的兜底

系统必须在 LLM 规划不可用时实现基于规则的规划作为兜底。

#### Scenario: 搜索规则的兜底

- **WHEN** LLM 规划失败且用户输入包含搜索关键词
- **THEN** Planner 必须返回使用搜索工具的执行计划

#### Scenario: 没有匹配的规则

- **WHEN** LLM 规划失败且没有规则匹配用户输入
- **THEN** Planner 必须返回不包含工具调用的执行计划

### Requirement: Planner 必须返回结构化的执行计划

系统必须返回可供 Executor 使用的结构良好的执行计划。

#### Scenario: 包含工具调用的计划

- **WHEN** Planner 判断需要工具
- **THEN** Planner 必须返回包含工具调用、参数和元数据的 ExecutionPlan 对象

#### Scenario: 不包含工具调用的计划

- **WHEN** Planner 判断不需要工具
- **THEN** Planner 必须返回包含空工具调用数组的 ExecutionPlan 对象

#### Scenario: 计划包含推理说明

- **WHEN** Planner 创建执行计划
- **THEN** 计划必须包含推理说明，用于透明度和调试
