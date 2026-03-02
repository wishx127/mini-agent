# Agent Controller 规格说明

## 概述

Controller 是 Agent 编排层的控制模块，负责全局控制 Token 上限、超时管理、调用次数限制和失败兜底策略。Controller 作为编排流程的入口，协调 Planner 和 Executor 工作。

## ADDED Requirements

### Requirement: Controller 必须强制执行 Token 限制

系统必须监控并强制执行 Token 使用限制，以防止上下文溢出。

#### Scenario: Token 使用在限制内

- **WHEN** 总 Token 计数低于 maxTokens（默认 4096）
- **THEN** Controller 必须允许执行继续

#### Scenario: Token 使用超过阈值

- **WHEN** Token 使用达到 maxTokens 的 90%
- **THEN** Controller 必须发出警告但允许执行

#### Scenario: Token 使用超过限制

- **WHEN** 总 Token 计数超过 maxTokens
- **THEN** Controller 必须触发 Token 限制兜底策略

#### Scenario: 截断对话历史

- **WHEN** 超过 Token 限制
- **THEN** Controller 必须截断历史，仅保留最近的消息并保持在限制内

### Requirement: Controller 必须强制执行超时限制

系统必须为整个编排过程强制执行最大执行时间。

#### Scenario: 执行在超时内

- **WHEN** 总执行时间在超时限制内（默认 30000ms）
- **THEN** Controller 必须允许执行完成

#### Scenario: 执行超过超时

- **WHEN** 执行时间超过超时限制
- **THEN** Controller 必须终止执行并返回部分结果及超时提示

#### Scenario: 工具执行期间超时

- **WHEN** 超时发生在工具执行期间
- **THEN** Controller 必须取消工具执行并启动兜底策略

### Requirement: Controller 必须限制迭代次数

系统必须强制执行工具调用的最大迭代次数。

#### Scenario: 迭代次数在限制内

- **WHEN** 工具调用迭代次数低于 maxIterations（默认 3）
- **THEN** Controller 必须允许进一步迭代

#### Scenario: 迭代次数达到限制

- **WHEN** 工具调用迭代次数达到 maxIterations
- **THEN** Controller 必须停止进一步工具调用并返回结果及提示

#### Scenario: 可能提前终止

- **WHEN** 用户请求提前终止或发生严重错误
- **THEN** Controller 必须立即停止，无论迭代次数如何

### Requirement: Controller 必须实现兜底策略

系统必须在失败发生时提供优雅降级。

#### Scenario: 所有工具失败

- **WHEN** 所有工具执行都失败
- **THEN** Controller 必须回退到不使用工具的直接 LLM 响应

#### Scenario: Token 限制超出

- **WHEN** Token 限制无法通过截断解决
- **THEN** Controller 必须返回错误消息，并提示减少上下文

#### Scenario: 超时超出

- **WHEN** 总执行时间超过超时
- **THEN** Controller 必须返回到目前为止收集的部分结果及超时提示

#### Scenario: 迭代次数超出

- **WHEN** 迭代次数达到限制
- **THEN** Controller 必须返回已完成迭代的结果及提示

### Requirement: Controller 必须协调 Planner 和 Executor

系统必须协调 Planner 和 Executor 模块之间的工作流。

#### Scenario: 正常编排流程

- **WHEN** Controller 接收到提示
- **THEN** Controller 必须调用 Planner 创建执行计划，然后调用 Executor 执行该计划

#### Scenario: Planner 返回无工具

- **WHEN** Planner 判断不需要工具
- **THEN** Controller 必须跳过 Executor 并返回直接的 LLM 响应

#### Scenario: Executor 所有工具失败

- **WHEN** Executor 报告所有工具执行失败
- **THEN** Controller 必须启动兜底策略

### Requirement: Controller 必须追踪执行指标

系统必须在执行期间收集和追踪指标，用于监控和分析。

#### Scenario: 追踪 Token 使用

- **WHEN** Controller 检查 Token 限制
- **THEN** Controller 必须记录当前 Token 计数和百分比

#### Scenario: 追踪执行时间

- **WHEN** Controller 监控执行
- **THEN** Controller 必须记录开始时间、结束时间和持续时间

#### Scenario: 追踪迭代次数

- **WHEN** Controller 管理迭代
- **THEN** Controller 必须记录当前迭代次数和最大迭代次数

#### Scenario: 追踪工具执行结果

- **WHEN** 工具被执行
- **THEN** Controller 必须记录成功/失败次数和执行时间

### Requirement: Controller 必须支持可配置参数

系统必须允许配置控制参数。

#### Scenario: 使用默认参数

- **WHEN** 未提供自定义配置
- **THEN** Controller 必须使用默认值（maxTokens=4096、maxIterations=3、timeout=30000ms）

#### Scenario: 使用自定义参数

- **WHEN** 提供自定义配置
- **THEN** Controller 必须使用自定义值而非默认值

#### Scenario: 验证配置值

- **WHEN** 提供无效的配置值
- **THEN** Controller 必须使用默认值并记录警告

### Requirement: Controller 必须提供执行状态

系统必须在执行期间提供实时状态信息。

#### Scenario: 报告执行开始

- **WHEN** Controller 开始处理提示
- **THEN** Controller 必须将状态报告为"running"并附带初始指标

#### Scenario: 报告执行进度

- **WHEN** Controller 完成一个阶段（规划、执行等）
- **THEN** Controller 必须报告进度并附带更新的指标

#### Scenario: 报告执行完成

- **WHEN** Controller 完成处理
- **THEN** Controller 必须将状态报告为"completed"或"failed"并附带最终指标

### Requirement: Controller 必须处理边缘情况

系统必须优雅地处理边缘情况和意外场景。

#### Scenario: 空提示

- **WHEN** Controller 接收到空提示或仅包含空白的提示
- **THEN** Controller 必须返回错误消息，不调用 Planner 或 Executor

#### Scenario: 没有注册的工具

- **WHEN** 没有可用的工具
- **THEN** Controller 必须跳过工具调用并返回直接的 LLM 响应

#### Scenario: Planner 抛出错误

- **WHEN** Planner 抛出意外错误
- **THEN** Controller 必须捕获错误并返回兜底响应

#### Scenario: Executor 抛出错误

- **WHEN** Executor 抛出意外错误
- **THEN** Controller 必须捕获错误并返回兜底响应
