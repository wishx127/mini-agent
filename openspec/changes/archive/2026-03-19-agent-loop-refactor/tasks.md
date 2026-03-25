## 1. 基础数据结构和类型定义

- [x] 1.1 创建 ConversationHistory 类，支持消息追加和按大小限制
- [x] 1.2 创建 ToolRecord 类型，定义工具调用记录的结构
- [x] 1.3 创建 ToolMemory 类，支持工具记录存储和查询
- [x] 1.4 创建 Summary 类型，定义摘要的结构
- [x] 1.5 创建 SummaryMemory 类，支持摘要存储和生成
- [x] 1.6 创建 PlanningContext 类和工厂类，统一规划器输入
- [x] 1.7 定义新的规划器输出格式接口（Plan / PlanStep）
- [x] 1.8 定义反思阶段的输出接口（ReflectionResult）
- [x] 1.9 创建 ExecutionMetrics 类，定义指标结构

---

## 2. 状态机核心逻辑

- [x] 2.1 创建 ExecutionPhase 类型（OBSERVE / PLAN / ACT / EVALUATE / REFLECT）
- [x] 2.2 创建 ExecutionEngine 类框架，实现主循环逻辑
- [x] 2.3 实现 OBSERVE 阶段，收集状态和构建 PlanningContext
- [x] 2.4 实现 PLAN 阶段，调用规划器获取多步计划
- [x] 2.5 实现 ACT 阶段框架和阶段转移逻辑
- [x] 2.6 实现 EVALUATE 阶段，评估工具执行结果
- [x] 2.7 实现 REFLECT 阶段框架和决策逻辑
- [x] 2.8 实现循环主体，处理阶段转移和终止条件检查
- [x] 2.9 添加循环计数和状态追踪

---

## 3. 工具执行和并行支持

- [x] 3.1 实现计划依赖图解析，识别可并行步骤
- [x] 3.2 实现拓扑排序，确定执行波次顺序
- [x] 3.3 实现单工具调用接口，支持输入注入和错误捕获
- [x] 3.4 实现并行工具调用执行（Promise.all）
- [x] 3.5 实现工具结果收集和按顺序返回
- [x] 3.6 实现超时和异常处理，单步和波次级别
- [x] 3.7 实现工具结果向 conversationHistory 追加

---

## 4. 工具去重和智能选择

- [x] 4.1 实现输入哈希计算函数
- [x] 4.2 创建 DeltaDetector 类
- [x] 4.3 实现工具调用去重检查
- [x] 4.4 实现重试预算管理（per tool）
- [x] 4.5 实现去重建议和警告逻辑
- [x] 4.6 将去重信息集成到 PlanningContext

---

## 5. 分层记忆系统

- [x] 5.1 实现工作记忆的大小管理（FIFO 淘汰）
- [x] 5.2 实现工具记忆的清理策略（保留期和大小限制）
- [x] 5.3 实现摘要记忆的轮数触发生成
- [x] 5.4 实现摘要记忆的 Token 触发生成
- [x] 5.5 集成 LLM 调用生成摘要内容
- [x] 5.6 实现内存持久化接口（导出为 JSON）
- [x] 5.7 添加内存查询接口（queryToolMemory 等）

---

## 6. 强化反思阶段

- [x] 6.1 实现工具结果成功评估逻辑
- [x] 6.2 实现错误归因分析（工具/规划器/系统）
- [x] 6.3 实现信息增长评估（相似度计算）
- [x] 6.4 实现多维度决策框架（成功率、增长、置信度）
- [x] 6.5 实现 continue / retry / new_plan / finalize_answer / fallback 决策
- [x] 6.6 实现置信度驱动的重试策略
- [x] 6.7 添加详细的决策理由和诊断数据

---

## 7. 语义终止条件

- [x] 7.1 实现规划器信号终止检查（type: final）
- [x] 7.2 实现无信息增长检测（相似度阈值）
- [x] 7.3 实现最大迭代硬限制检查
- [x] 7.4 实现 Token 预算检查和超限处理
- [x] 7.5 实现执行超时检查
- [x] 7.6 实现降级触发检查（失败预算）
- [x] 7.7 实现复合终止条件评估和优先级排序
- [x] 7.8 实现提前预警机制（临界通知）
- [x] 7.9 添加终止原因记录

---

## 8. 执行指标和可观测性

- [x] 8.1 创建 ExecutionMetricsCollector 类，支持指标收集
- [x] 8.2 在 OBSERVE 阶段记录时间戳
- [x] 8.3 在每个阶段完成后记录阶段耗时
- [x] 8.4 在工具执行后记录工具级指标
- [x] 8.5 实现指标聚合（工具统计、时间分布等）
- [x] 8.6 实现成功率和效率指标计算
- [x] 8.7 实现实时指标回调机制
- [x] 8.8 实现指标序列化和导出（JSON）
- [x] 8.9 实现指标查询接口

---

## 9. 长期记忆管理

- [x] 9.1 创建 LongTermMemoryManager 类
- [x] 9.2 实现向量数据库客户端集成
- [x] 9.3 实现记忆创建（createMemory）
- [x] 9.4 实现记忆检索（retrieveMemories）
- [x] 9.5 实现记忆过期处理
- [x] 9.6 实现记忆元数据管理

---

## 10. 可观测性系统

- [x] 10.1 创建 TraceManager 类，管理追踪生命周期
- [x] 10.2 创建 SpanManager 类，管理跨度生命周期
- [x] 10.3 创建 PromptManager 类，管理提示词记录
- [x] 10.4 实现成本计算功能
- [x] 10.5 实现追踪数据持久化

---

## 11. Worker 系统

- [x] 11.1 创建 WorkerMonitor 类，监控内存 worker
- [x] 11.2 实现 worker 健康检查
- [x] 11.3 实现 worker 自动重启机制
- [x] 11.4 创建 MemoryConsumer 类，处理内存消息

---

## 12. 工具系统增强

- [x] 12.1 创建 BaseTool 抽象类
- [x] 12.2 创建 ToolRegistry 类，管理工具注册
- [x] 12.3 创建 ToolCategoryRegistry 类，按类别管理工具
- [x] 12.4 实现 CircuitBreaker 熔断器模式
- [x] 12.5 实现工具执行错误分类

---

## 13. 集成和测试

- [x] 13.1 集成 ExecutionEngine 到 Controller
- [x] 13.2 集成 Memory 系统到 Controller
- [x] 13.3 集成 Observability 系统到 AgentCore
- [x] 13.4 编写单元测试（各阶段独立测试）
- [x] 13.5 编写集成测试（端到端执行流程）
- [x] 13.6 性能测试和优化

---

## 14. 文档更新

- [x] 14.1 更新 agent-architecture.md
- [x] 14.2 更新 execution-engine-design.md
- [x] 14.3 更新 openspec 下的 spec 文档
- [x] 14.4 更新 design.md
- [x] 14.5 更新 tasks.md

## 15. 编排层文档修正（2026-03-24）

- [x] 15.1 修正执行阶段：OBSERVE → PLAN → ACT → EVALUATE → REFLECT
- [x] 15.2 修正配置方式：使用 `ModelConfig.orchestration` 而非环境变量
- [x] 15.3 更新 ExecutionConfig 接口：添加 `maxConcurrentTools`, `waveTimeout`, `enableStateProtection`, `maxStateSize`
- [x] 15.4 添加 Evaluator 组件文档
- [x] 15.5 更新 Reflector 文档：添加详细推理、失败分析、成功分析

## 16. Worker Monitoring 文档修正（2026-03-24）

- [x] 16.1 修正重启机制描述：固定延迟而非指数退避
- [x] 16.2 修正状态文件接口名：`WorkerStatusFile` → `WorkerStatus`
- [x] 15.6 更新 ExecutionEngine 文档：添加状态管理、错误处理
- [x] 15.7 修正 Controller API：`getEngine()` → `getEngineConfig()` / `updateEngineConfig()`
- [x] 15.8 添加 Controller 组件获取方法文档：`getSessionStore()`, `getCostTracker()`, `getLongTermMemoryReader()`, `getMemoryDispatcher()`
- [x] 15.9 更新指标追踪示例：添加 EVALUATE 阶段时间
