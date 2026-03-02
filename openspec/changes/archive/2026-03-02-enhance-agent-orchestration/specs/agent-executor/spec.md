# Agent Executor 规格说明

## 概述

Executor 是 Agent 编排层的执行模块，负责工具调用、异常处理、重试机制和结果处理。Executor 接收 Planner 生成的执行计划并执行工具调用。

## ADDED Requirements

### Requirement: Executor 必须按执行计划执行工具

系统必须按照执行计划指定的顺序执行工具调用。

#### Scenario: 执行单个工具

- **WHEN** 执行计划包含单个工具调用
- **THEN** Executor 必须使用指定参数执行该工具并返回结果

#### Scenario: 按顺序执行多个工具

- **WHEN** 执行计划包含多个顺序工具调用
- **THEN** Executor 必须按指定顺序逐个执行工具

#### Scenario: 跳过禁用的工具

- **WHEN** 执行计划包含已禁用的工具
- **THEN** Executor 必须跳过该工具并记录警告

### Requirement: Executor 必须处理执行错误

系统必须在工具执行期间适当处理不同类型的错误。

#### Scenario: 工具执行期间的网络错误

- **WHEN** 工具执行因网络问题失败
- **THEN** Executor 必须将错误分类为网络错误并启动重试机制

#### Scenario: 超时错误

- **WHEN** 工具执行超过时间限制
- **THEN** Executor 必须将错误分类为超时错误并相应处理

#### Scenario: 参数无效错误

- **WHEN** 工具执行因参数无效而失败
- **THEN** Executor 必须将错误分类为参数错误并不重试

#### Scenario: 未知错误

- **WHEN** 工具执行因无法识别的错误而失败
- **THEN** Executor 必须将错误分类为未知错误并尝试重试一次

### Requirement: Executor 必须实现重试机制

系统必须根据错误类型使用适当的退避策略重试失败的工具执行。

#### Scenario: 使用指数退避重试网络错误

- **WHEN** 发生网络错误
- **THEN** Executor 必须使用指数退避（1s、2s、4s 延迟）最多重试 3 次

#### Scenario: 使用固定延迟重试超时错误

- **WHEN** 发生超时错误
- **THEN** Executor 必须使用固定 1s 延迟最多重试 2 次

#### Scenario: 不重试参数错误

- **WHEN** 发生参数验证错误
- **THEN** Executor 不得重试，必须立即返回错误

#### Scenario: 重试未知错误一次

- **WHEN** 发生未知错误
- **THEN** Executor 必须使用 1s 延迟重试一次

#### Scenario: 超过最大重试次数

- **WHEN** 重试次数耗尽
- **THEN** Executor 必须返回最后一次错误并将执行标记为失败

### Requirement: Executor 必须追踪执行时间

系统必须追踪并记录每次工具调用的执行时间。

#### Scenario: 记录成功执行时间

- **WHEN** 工具执行成功
- **THEN** Executor 必须在结果中记录执行时间

#### Scenario: 记录失败执行时间

- **WHEN** 工具执行失败
- **THEN** Executor 必须记录失败前的时间消耗

#### Scenario: 在总时间中包含重试延迟

- **WHEN** 发生重试
- **THEN** Executor 必须在总执行时间中包含重试延迟

### Requirement: Executor 必须格式化和截断结果

系统必须格式化工具执行结果，并在必要时进行截断。

#### Scenario: 格式化成功结果

- **WHEN** 工具执行成功
- **THEN** Executor 必须将结果格式化为字符串

#### Scenario: 截断过长的结果

- **WHEN** 结果超过 MAX_RESULT_LENGTH（4000 字符）
- **THEN** Executor 必须截断结果并附加截断提示

#### Scenario: 保留短结果

- **WHEN** 结果在长度限制内
- **THEN** Executor 必须返回未经修改的结果

### Requirement: Executor 必须返回结构化的执行结果

系统必须为每次工具执行返回结构良好的结果。

#### Scenario: 返回成功结果

- **WHEN** 工具执行成功
- **THEN** Executor 必须返回包含 success=true、结果内容、toolCallId、toolName 和 executionTime 的 ToolExecutionResult

#### Scenario: 返回失败结果

- **WHEN** 工具执行在所有重试后失败
- **THEN** Executor 必须返回包含 success=false、错误消息、toolCallId、toolName 和 executionTime 的 ToolExecutionResult

#### Scenario: 包含重试历史

- **WHEN** 执行期间发生了重试
- **THEN** Executor 必须在结果元数据中包含重试次数和最后一次错误

### Requirement: Executor 必须遵守超时限制

系统必须为每次工具执行强制执行超时限制。

#### Scenario: 工具执行在超时内

- **WHEN** 工具执行在超时限制内完成
- **THEN** Executor 必须正常返回结果

#### Scenario: 工具执行超过超时

- **WHEN** 工具执行超过超时限制
- **THEN** Executor 必须取消执行并返回超时错误

#### Scenario: 重试期间超时

- **WHEN** 包含重试的累计时间超过超时
- **THEN** Executor 必须停止重试并返回超时错误

### Requirement: Executor 必须记录执行详情

系统必须记录工具执行的详细信息，用于调试和监控。

#### Scenario: 记录工具开始

- **WHEN** 工具执行开始
- **THEN** Executor 必须记录工具名称和参数

#### Scenario: 记录工具成功

- **WHEN** 工具执行成功
- **THEN** Executor 必须记录成功和执行时间

#### Scenario: 记录工具失败

- **WHEN** 工具执行失败
- **THEN** Executor 必须记录失败和错误详情

#### Scenario: 记录重试尝试

- **WHEN** 发生重试
- **THEN** Executor 必须记录重试尝试次数和延迟
