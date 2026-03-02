# 实现任务清单

本文档列出实现 Agent 编排层所需的所有任务，按阶段分组。

## 1. 准备工作

- [x] 1.1 创建编排层类型定义文件 `src/types/agent.ts`
- [x] 1.2 定义核心接口：ExecutionPlan、ToolExecutionResult、ControlConfig、ExecutionMetrics
- [x] 1.3 定义错误类型：NetworkError、TimeoutError、ParameterError、UnknownError
- [x] 1.4 扩展 ModelConfig 类型，添加编排层配置参数

## 2. Controller 模块实现

- [x] 2.1 创建 Controller 模块文件 `src/agent/controller.ts`
- [x] 2.2 实现 Token 限制检查功能（checkTokenLimit）
- [x] 2.3 实现超时控制功能（checkTimeout）
- [x] 2.4 实现迭代次数限制功能（checkIterationCount）
- [x] 2.5 实现失败兜底策略（fallback）
- [x] 2.6 实现指标追踪功能（trackMetrics）
- [x] 2.7 实现编排协调逻辑（execute）
- [x] 2.8 实现配置验证和默认值设置

## 3. Executor 模块实现

- [x] 3.1 创建 Executor 模块文件 `src/agent/executor.ts`
- [x] 3.2 实现工具执行功能（executeTool）
- [x] 3.3 实现错误分类和处理（handleError）
- [x] 3.4 实现重试机制（executeWithRetry）
- [x] 3.5 实现指数退避延迟策略
- [x] 3.6 实现执行时间追踪
- [x] 3.7 实现结果格式化和截断（formatResult、truncateResult）
- [x] 3.8 实现执行日志记录

## 4. Planner 模块实现

- [x] 4.1 创建 Planner 模块文件 `src/agent/planner.ts`
- [x] 4.2 实现工具使用判断功能（shouldUseTool）
- [x] 4.3 实现工具选择功能（selectTool）
- [x] 4.4 实现执行顺序规划功能（planExecution）
- [x] 4.5 实现参数验证功能（validateParams）
- [x] 4.6 实现 LLM 决策逻辑（llmDecision）
- [x] 4.7 实现基于规则的兜底规划（ruleBasedFallback）
- [x] 4.8 实现执行计划生成（generateExecutionPlan）

## 5. AgentCore 重构

- [x] 5.1 导入新模块到 AgentCore
- [x] 5.2 初始化 Planner、Executor、Controller 实例
- [x] 5.3 重构 processPrompt 方法，委托给 Controller
- [x] 5.4 移除旧的 LLM 决策逻辑
- [x] 5.5 移除旧的工具执行逻辑
- [x] 5.6 移除旧的控制逻辑
- [x] 5.7 保持 getToolRegistry() 方法不变
- [x] 5.8 验证向后兼容性

## 6. 单元测试

- [x] 6.1 编写 Controller 单元测试
- [x] 6.2 测试 Token 限制检查功能
- [x] 6.3 测试超时控制功能
- [x] 6.4 测试迭代次数限制功能
- [x] 6.5 测试兜底策略
- [x] 6.6 编写 Executor 单元测试
- [x] 6.7 测试工具执行功能
- [x] 6.8 测试错误处理
- [x] 6.9 测试重试机制
- [x] 6.10 测试结果格式化
- [x] 6.11 编写 Planner 单元测试
- [x] 6.12 测试工具判断功能
- [x] 6.13 测试工具选择功能
- [x] 6.14 测试参数验证功能
- [x] 6.15 测试 LLM 决策逻辑
- [x] 6.16 测试规则兜底逻辑

## 7. 集成测试

- [x] 7.1 编写端到端集成测试
- [x] 7.2 测试完整的编排流程
- [x] 7.3 测试多工具调用场景
- [x] 7.4 测试错误恢复场景
- [x] 7.5 测试 Token 超限场景
- [x] 7.6 测试超时场景
- [x] 7.7 测试迭代次数超限场景
- [x] 7.8 测试所有工具失败场景

## 8. 回归测试

- [x] 8.1 验证现有功能正常工作
- [x] 8.2 验证 processPrompt 接口兼容性
- [x] 8.3 验证构造函数接口兼容性
- [x] 8.4 验证返回值格式不变
- [x] 8.5 验证工具注册机制正常工作
- [x] 8.6 验证配置系统正常工作

## 9. 性能测试

- [x] 9.1 测试 Token 计数性能
- [x] 9.2 测试重试机制对性能的影响
- [x] 9.3 测试超时控制的准确性
- [x] 9.4 测试指标追踪的性能开销
- [x] 9.5 测试并发场景下的行为

## 10. 文档和配置

- [x] 10.1 更新项目 README 文档和 docs/agent-architecture.md
- [x] 10.2 更新 openspec/project.md
- [x] 10.3 添加编排层配置示例到 .env.example
- [x] 10.4 编写编排层使用指南
- [x] 10.5 编写故障排查指南
- [x] 10.6 添加代码注释和 JSDoc

## 11. 清理和优化

- [x] 11.1 移除未使用的代码
- [x] 11.2 优化导入语句
- [x] 11.3 运行 ESLint 检查
- [x] 11.4 运行 TypeScript 编译检查
- [x] 11.5 代码格式化
- [x] 11.6 最终回归测试
