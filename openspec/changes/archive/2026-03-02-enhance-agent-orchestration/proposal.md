## Why

当前的 Mini Agent 虽然已经实现了基础的流水线架构，但缺少清晰的编排层设计。现有代码将规划、执行和控制逻辑混杂在一起，导致：

1. **职责不清**：`llmDecision` 方法同时负责判断、选择和规划，违反单一职责原则
2. **重试机制缺失**：工具执行失败后没有重试策略，直接返回错误结果
3. **控制机制分散**：超时、调用次数限制等控制逻辑散落在各处，难以统一管理
4. **Token 控制缺失**：没有 Token 上限控制，可能导致上下文溢出或成本失控
5. **兜底策略简陋**：失败时仅返回错误消息，无法优雅降级

现在需要引入清晰的编排层架构，分离 Planner、Executor 和 Controller 职责，构建健壮的 Agent 执行系统。

## What Changes

- **新增 Planner 层**：独立的规划模块，负责工具选择决策、调用顺序规划、参数验证
- **新增 Executor 层**：独立的执行模块，负责工具调用、异常处理、重试机制、结果处理
- **新增 Controller 层**：独立的控制模块，负责 Token 上限、超时控制、调用次数限制、失败兜底
- **重构 AgentCore**：将现有逻辑拆分到三个新模块，保持对外接口不变
- **增强错误处理**：实现优雅降级策略，提供更有价值的错误反馈
- **添加监控指标**：记录关键指标用于性能分析和问题排查

## Capabilities

### New Capabilities

- `agent-planner`: 独立的规划器模块，负责工具选择决策、调用顺序规划、参数验证
- `agent-executor`: 独立的执行器模块，负责工具调用、异常处理、重试机制、结果处理
- `agent-controller`: 独立的控制模块，负责 Token 上限控制、超时管理、调用限制、失败兜底策略

### Modified Capabilities

- `agent-core`: 重构核心逻辑，集成 Planner、Executor、Controller 三个新模块，保持对外接口不变

## Impact

- **文件变更**:
  - `src/agent/core.ts` - 重构以集成编排层
  - `src/types/model-config.ts` - 添加编排层相关配置
- **新增模块**:
  - `src/agent/planner.ts` - 规划器实现
  - `src/agent/executor.ts` - 执行器实现
  - `src/agent/controller.ts` - 控制器实现
  - `src/agent/types.ts` - 编排层类型定义
- **依赖影响**: 无新增依赖，使用现有 LangChain 和 TypeScript 能力
- **API 影响**: 无破坏性变更，向后兼容
- **配置影响**: 可选配置项（默认值已内置），用户可自定义控制参数
