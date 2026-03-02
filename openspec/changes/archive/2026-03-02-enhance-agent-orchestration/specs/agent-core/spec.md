# Agent Core 规格说明

## 概述

AgentCore 是 Agent 系统的核心门面类，负责集成 Planner、Executor、Controller 三个编排模块，并提供统一的对外接口。本次修改重构 AgentCore 以实现清晰的分层架构。

## ADDED Requirements

### Requirement: AgentCore 必须集成 Planner 模块

系统必须集成 Planner 模块用于工具选择和执行规划。

#### Scenario: 初始化 Planner

- **WHEN** AgentCore 被实例化
- **THEN** AgentCore 必须创建并初始化一个 Planner 实例

#### Scenario: 将规划委托给 Planner

- **WHEN** AgentCore 需要确定工具使用
- **THEN** AgentCore 必须将规划任务委托给 Planner 模块

#### Scenario: 向 Planner 传递上下文

- **WHEN** 调用 Planner
- **THEN** AgentCore 必须提供提示、对话历史和可用工具

### Requirement: AgentCore 必须集成 Executor 模块

系统必须集成 Executor 模块用于工具执行和错误处理。

#### Scenario: 初始化 Executor

- **WHEN** AgentCore 被实例化
- **THEN** AgentCore 必须创建并初始化一个 Executor 实例

#### Scenario: 将执行委托给 Executor

- **WHEN** AgentCore 接收到执行计划
- **THEN** AgentCore 必须将执行任务委托给 Executor 模块

#### Scenario: 向 Executor 传递工具注册表

- **WHEN** 初始化 Executor
- **THEN** AgentCore 必须提供工具注册表用于工具执行

### Requirement: AgentCore 必须集成 Controller 模块

系统必须集成 Controller 模块用于编排控制和限制。

#### Scenario: 初始化 Controller

- **WHEN** AgentCore 被实例化
- **THEN** AgentCore 必须创建并初始化一个 Controller 实例

#### Scenario: 将控制委托给 Controller

- **WHEN** AgentCore 处理提示
- **THEN** AgentCore 必须将编排委托给 Controller 模块

#### Scenario: 向 Controller 传递配置

- **WHEN** 初始化 Controller
- **THEN** AgentCore 必须提供控制配置参数

### Requirement: AgentCore 必须保持向后兼容

系统必须保持现有公共接口的向后兼容性。

#### Scenario: processPrompt 接口不变

- **WHEN** 外部代码调用 processPrompt(prompt)
- **THEN** 方法签名必须保持不变 (prompt: string) => Promise<string>

#### Scenario: 构造函数接口不变

- **WHEN** AgentCore 被实例化
- **THEN** 构造函数签名必须保持不变 (config: ModelConfig)

#### Scenario: 返回类型不变

- **WHEN** processPrompt 返回结果
- **THEN** 它必须像之前一样返回字符串

## REMOVED Requirements

### Requirement: AgentCore 直接实现 LLM 决策逻辑

**Reason**: LLM 决策逻辑已移至 Planner 模块，以实现更好的关注点分离

**Migration**: 使用 Planner.shouldUseTool() 和 Planner.selectTool() 代替

### Requirement: AgentCore 直接执行工具

**Reason**: 工具执行逻辑已移至 Executor 模块，以实现更好的错误处理和重试机制

**Migration**: 使用 Executor.executeTool() 进行工具执行

### Requirement: AgentCore 包含分散的控制逻辑

**Reason**: 控制逻辑已移至 Controller 模块，以实现集中管理

**Migration**: 使用 Controller 进行 Token 限制、超时和迭代控制

## MODIFIED Requirements

### Requirement: AgentCore 必须通过编排层处理用户提示

系统必须通过委托给 Controller 模块来处理用户提示，Controller 协调 Planner 和 Executor。

**之前的行为**: AgentCore 直接实现整个处理流程，职责混合

**新的行为**: AgentCore 委托给 Controller，后者管理编排流程

#### Scenario: 通过编排层处理提示

- **WHEN** 使用用户提示调用 processPrompt
- **THEN** AgentCore 必须委托给 Controller.execute(prompt) 并返回结果

#### Scenario: 处理编排错误

- **WHEN** Controller 或任何编排层抛出错误
- **THEN** AgentCore 必须捕获错误并返回用户友好的错误消息

#### Scenario: 保持对话流程

- **WHEN** 按顺序处理提示
- **THEN** AgentCore 必须通过 Controller 模块维护对话历史

### Requirement: AgentCore 必须初始化编排模块

系统必须在构造期间初始化所有编排模块（Planner、Executor、Controller）。

**之前的行为**: AgentCore 直接初始化 LLM 和工具注册表

**新的行为**: AgentCore 初始化 LLM、工具注册表和三个编排模块

#### Scenario: 初始化所有模块

- **WHEN** 调用 AgentCore 构造函数
- **THEN** AgentCore 必须初始化 LLM、ToolRegistry、Planner、Executor 和 Controller

#### Scenario: 向模块传递共享资源

- **WHEN** 初始化编排模块
- **THEN** AgentCore 必须向模块传递共享资源（LLM 实例、工具注册表、配置）

#### Scenario: 处理初始化失败

- **WHEN** 模块初始化失败
- **THEN** AgentCore 必须抛出描述性错误

### Requirement: AgentCore 必须提供工具注册表访问

系统必须维护 getToolRegistry() 方法以保持向后兼容。

**之前的行为**: 返回工具注册表供外部访问

**新的行为**: 不变 - 仍然返回工具注册表

#### Scenario: 获取工具注册表

- **WHEN** 调用 getToolRegistry()
- **THEN** AgentCore 必须返回 ToolRegistry 实例

#### Scenario: 工具注册表包含所有已注册的工具

- **WHEN** 外部代码访问工具注册表
- **THEN** 注册表必须包含初始化期间注册的所有工具
