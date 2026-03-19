## Why

当前 Agent 执行架构采用单次规划-执行-返回的模式，无法处理复杂多步任务的动态调整和失败恢复。在工具调用失败、上下文不完整或需要多轮迭代推理的场景中，Agent 缺乏有效的循环机制，导致任务完成度低且用户体验差。通过引入显式多轮循环架构和分层记忆体系，可以显著提升 Agent 的自适应能力、容错机制和任务完成率。

## What Changes

- **循环执行模型**：将单次"规划→执行→返回"改为"OBSERVE → PLAN → ACT → REFLECT"状态机，支持多轮迭代直到达成终止条件
- **分层记忆体系**：引入工作记忆、工具记忆、摘要记忆三层结构，防止 token 爆炸同时保留关键上下文
- **工具重复调用防护**：维护 toolUsageHistory，planner 可识别重复调用并优化工具选择策略
- **多步计划与并行执行**：planner 支持输出多步计划，act 阶段可并行执行无依赖工具
- **强化反思评估**：reflect 阶段增强失败归因、成功判定和下一步策略决策能力
- **语义终止条件**：从单一 needsTool 标志升级为多维度判断（信息增长、迭代次数、token 超限、超时）
- **完整指标收集**：跟踪循环深度、工具成功率、终止原因等关键指标，支持后续优化

## Capabilities

### New Capabilities

- `multi-round-execution`: 显式多轮循环执行机制，支持状态机驱动的 OBSERVE/PLAN/ACT/REFLECT 阶段
- `layered-memory-system`: 分层记忆体系（工作记忆/工具记忆/摘要记忆），防止 token 增长失控
- `tool-deduplication`: 工具调用去重与智能选择，避免重复调用相同工具
- `multi-step-planning`: 多步计划生成与置信度评分，支持复杂推理链
- `parallel-tool-execution`: 计划内多个工具的并行执行能力
- `enhanced-reflection`: 强化的反思评估，包含失败归因、策略决策、误差恢复
- `semantic-termination`: 基于多维度信息的语义终止条件评估
- `planning-context`: 统一的规划上下文结构，整合历史、记忆、token 状态
- `execution-metrics`: 循环执行指标收集与状态追踪

### Modified Capabilities

- `agent-execution`: 现有 Agent 执行能力的内部重构，改为基于状态机的多轮循环模型

## Impact

- **核心架构文件**: `src/agent/execute.ts` 及 planner 模块的重构
- **API 影响**: planner 输入输出格式扩展（支持多步计划和置信度）；reflect 逻辑独立化
- **存储**: 新增 conversationHistory 管理、toolMemory、summaryMemory 数据结构
- **向后兼容性**: 外部 Agent 调用接口保持兼容，内部执行流程升级
- **测试覆盖**: 需扩展测试用例以覆盖多轮循环、工具失败恢复、token 管理等场景
- **性能**: 初期可能增加 token 消耗（历史追踪），长期通过摘要机制优化
- **可扩展性**: 为后续 multi-agent、LangGraph 集成奠定基础
