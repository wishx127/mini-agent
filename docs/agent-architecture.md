# Mini Agent 架构设计文档

## 1. 整体架构概览

Mini Agent 采用分层模块化架构，集成了工具调用能力，支持 LLM 自主决策和执行工具。各组件职责明确，通过清晰的接口进行通信。

### 1.1 系统架构图

```
┌────────────────────────────────────────────────────────────────────┐
│                          Mini Agent                                 │
├────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────────────────────────┐   │
│  │  CLI Interface  │    │       ModelConfigManager            │   │
│  │                 │    │                                     │   │
│  │ • 用户交互      │    │ • 配置加载                          │   │
│  │ • 输入处理      │    │ • 配置验证                          │   │
│  │ • 响应显示      │    │ • 多源配置合并                      │   │
│  └─────────┬───────┘    └──────────────┬──────────────────────┘   │
│            │                           │                          │
│            │                           │                          │
│  ┌─────────▼───────────────────────────▼──────────────────────┐   │
│  │                      Agent Core                            │   │
│  │                                                            │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │         编排层 Orchestration Layer                   │  │   │
│  │  │                                                      │  │   │
│  │  │  ┌─────────────────────────────────────────────────┐│  │   │
│  │  │  │           ExecutionEngine                       ││  │   │
│  │  │  │                                                  ││  │   │
│  │  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐││  │   │
│  │  │  │  │OBSERVE  │→│  PLAN   │→│   ACT   │→│REFLECT│││  │   │
│  │  │  │  │ 阶段    │ │  阶段   │ │  阶段   │ │ 阶段  │││  │   │
│  │  │  │  └─────────┘ └─────────┘ └─────────┘ └───────┘││  │   │
│  │  │  └─────────────────────────────────────────────────┘│  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  └───────────────────────┬────────────────────────────────────┘   │
│                          │                                        │
│            ┌─────────────┴─────────────┐                          │
│            │                           │                          │
│  ┌─────────▼──────────┐    ┌──────────▼───────────────────────┐  │
│  │   Tool Registry   │    │      LLM Backend (External)      │  │
│  │                    │    │                                  │  │
│  │ • BaseTool管理    │    │ • OpenAI API / 兼容服务          │  │
│  │ • 工具注册/查询   │    │ • HTTP REST API 调用             │  │
│  │ • 启用/禁用控制   │    │ • Function Calling 支持          │  │
│  │ • LangChain格式   │    │                                  │  │
│  │   转换            │    │                                  │  │
│  └────────────────────┘    └──────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

## 2. 核心组件架构

### 2.1 AgentCore - AI代理核心

**职责**: 处理AI对话逻辑，管理工具调用流程，桥接用户输入和LLM服务。AgentCore 作为门面类，集成编排层模块。

```
┌─────────────────────────────────────────────────┐
│                  AgentCore                      │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • llm: ChatOpenAI                             │
│  • config: ModelConfig                         │
│  • toolRegistry: ToolRegistry                  │
│  • controller: Controller                      │
│                                                 │
│  Methods:                                       │
│  • processPrompt(prompt) → 委托给Controller   │
│  • getToolRegistry() → 获取工具注册表         │
└─────────────────┬───────────────────────────────┘
                  │
                  │ 委托
                  ▼
┌─────────────────────────────────────────────────┐
│         Controller (控制层)                     │
│  • 执行引擎协调                                 │
│  • 可观测性集成                                 │
│  • 记忆系统管理                                 │
└─────────────────────────────────────────────────┘
```

### 2.1.1 Controller - 控制层

**职责**: 协调执行引擎，管理可观测性和记忆系统。

| 属性           | 说明            |
| -------------- | --------------- |
| `llm`          | ChatOpenAI 实例 |
| `toolRegistry` | 工具注册表      |
| `config`       | 控制配置        |
| `metrics`      | 执行指标        |

**方法**:

- `execute(prompt)` - 编排入口，使用 ExecutionEngine
- `getStatus()` - 获取执行状态
- `getEngineConfig()` - 获取引擎配置
- `updateEngineConfig()` - 更新引擎配置

**控制参数**:

- `maxIterations`: 最大迭代次数 (默认 10)
- `maxExecutionTime`: 最大执行时间 (默认 300000ms)
- `toolTimeout`: 工具超时时间 (默认 30000ms)
- `tokenThreshold`: Token 预警阈值 (默认 0.9)

### 2.2 ExecutionEngine - 执行引擎

**职责**: 管理多轮循环执行，实现状态机驱动的 OBSERVE → PLAN → ACT → REFLECT 流程。

```
┌─────────────────────────────────────────────────┐
│              ExecutionEngine                    │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • config: ExecutionConfig                     │
│  • phase: ExecutionPhase                       │
│  • iteration: number                           │
│  • workingMemory: ConversationHistory          │
│  • toolMemory: ToolMemory                      │
│  • summaryMemory: SummaryMemory                │
│  • metrics: ExecutionMetricsCollector          │
│  • deduplicationEngine: DeduplicationEngine    │
│  • terminationChecker: TerminationChecker      │
│  • reflector: Reflector                        │
│                                                 │
│  Methods:                                       │
│  • run(userPrompt) → 执行主循环                │
│  • getPhase() → 获取当前阶段                   │
│  • getIteration() → 获取迭代次数               │
│  • getWorkingMemory() → 获取工作记忆           │
│  • getToolMemory() → 获取工具记忆              │
│  • getSummaryMemory() → 获取摘要记忆           │
└─────────────────────────────────────────────────┘
```

**状态机模型**:

```
                    ┌──────────────────┐
                    │                  │
                    ▼                  │
              ┌──────────┐            │
              │ OBSERVE  │            │
              └──────────┘            │
                    │                 │
                    ▼                 │
              ┌──────────┐            │
         ┌───│   PLAN   │────────────┤
         │   └──────────┘            │
         │         │                 │
         │         ▼                 │
         │   ┌──────────┐            │
         │   │   ACT    │            │
         │   └──────────┘            │
         │         │                 │
         │         ▼                 │
         │   ┌──────────┐            │
         │   │ REFLECT  │            │
         │   └──────────┘            │
         │         │                 │
         │         ▼                 │
         │   ┌──────────┐            │
         └──→│ 继续循环  │            │
             └──────────┘            │
                    │                 │
                    ▼                 │
              ┌──────────┐            │
              │ 终止执行  │←───────────┘
              └──────────┘
```

### 2.2.1 Reflector - 反思器

**职责**: 评估工具执行结果，做出决策（continue/retry/new_plan/finalize_answer/fallback）。

```
┌─────────────────────────────────────────────────┐
│                Reflector                        │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • config: ReflectorConfig                     │
│                                                 │
│  Methods:                                       │
│  • reflect(context) → 反思决策                 │
│  • analyzeToolFailures() → 分析工具失败        │
│  • evaluateInformationGrowth() → 评估信息增长  │
│  • determineErrorAttribution() → 错误归因      │
│  • makeDecision() → 做出决策                   │
└─────────────────────────────────────────────────┘
```

**决策逻辑**:

```typescript
type ReflectionDecision =
  | 'continue' // 继续执行
  | 'retry' // 重试工具
  | 'new_plan' // 重新规划
  | 'finalize_answer' // 生成最终答案
  | 'fallback'; // 降级处理
```

### 2.2.2 ParallelExecutor - 并行执行器

**职责**: 并行执行工具调用，支持依赖图解析和波次执行。

```
┌─────────────────────────────────────────────────┐
│            ParallelExecutor                     │
├─────────────────────────────────────────────────┤
│  Methods:                                       │
│  • buildExecutionWaves() → 构建执行波次        │
│  • executeAllWaves() → 执行所有波次            │
│  • executeWave() → 执行单个波次                │
│  • parseDependencyGraph() → 解析依赖图         │
│  • topologicalSort() → 拓扑排序                │
│  • groupIntoWaves() → 分组为波次               │
└─────────────────────────────────────────────────┘
```

**波次执行示例**:

```
计划步骤:
  step1: search(query) → 无依赖
  step2: analyze(data) → 依赖 step1
  step3: format(result) → 无依赖

执行波次:
  波次0: [step1, step3] → 并行执行
  波次1: [step2] → 等待波次0完成
```

### 2.2.3 DeduplicationEngine - 去重引擎

**职责**: 避免重复的工具调用，管理重试预算。

```
┌─────────────────────────────────────────────────┐
│         DeduplicationEngine                     │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • toolMemory: ToolMemory                      │
│  • config: DeduplicationConfig                 │
│  • retryBudgets: Map<string, number>           │
│                                                 │
│  Methods:                                       │
│  • checkDuplicate() → 检查重复调用             │
│  • getDeduplicationState() → 获取去重状态       │
│  • getWarningMessage() → 获取警告信息          │
│  • onToolSuccess() → 工具成功回调              │
│  • onToolFailure() → 工具失败回调              │
└─────────────────────────────────────────────────┘
```

### 2.2.4 TerminationChecker - 终止检查器

**职责**: 检查多种终止条件，支持语义终止。

```
┌─────────────────────────────────────────────────┐
│          TerminationChecker                     │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • config: TerminationConfig                   │
│  • startTime: number                           │
│  • iteration: number                           │
│  • failureCount: number                        │
│  • consecutiveNoGrowthCount: number            │
│                                                 │
│  Methods:                                       │
│  • checkAll() → 检查所有终止条件               │
│  • checkPlannerSignal() → 规划器信号检查       │
│  • checkNoInformationGrowth() → 信息增长检查   │
│  • checkMaxIterations() → 最大迭代检查         │
│  • checkTokenBudget() → Token预算检查          │
│  • checkExecutionTimeout() → 执行超时检查      │
│  • checkFailureBudget() → 失败预算检查         │
└─────────────────────────────────────────────────┘
```

**终止条件优先级**:

| 终止条件     | 优先级 | 说明                       |
| ------------ | ------ | -------------------------- |
| 规划器信号   | 1      | 规划器返回 `type: "final"` |
| 无信息增长   | 2      | 连续 N 轮无新信息          |
| 最大迭代     | 3      | 达到最大迭代次数限制       |
| Token 超预算 | 4      | Token 使用超过阈值         |
| 执行超时     | 5      | 总执行时间超过限制         |
| 失败预算     | 6      | 工具失败次数超过预算       |

## 3. 记忆系统架构

### 3.1 分层记忆模型

```
┌─────────────────────────────────────────────────────────────┐
│                    内存系统架构                               │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │              工作记忆 (Working Memory)                │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  ConversationHistory                        │   │   │
│  │  │  - 最近 N 条消息                             │   │   │
│  │  │  - FIFO 淘汰策略                             │   │   │
│  │  │  - Token 限制管理                            │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              工具记忆 (Tool Memory)                  │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  ToolMemory                                 │   │   │
│  │  │  - 工具调用记录                               │   │   │
│  │  │  - 输入哈希去重                               │   │   │
│  │  │  - 成功/失败统计                              │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              摘要记忆 (Summary Memory)               │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  SummaryMemory                              │   │   │
│  │  │  - LLM 生成的摘要                            │   │   │
│  │  │  - 历史压缩存储                              │   │   │
│  │  │  - 关键信息保留                              │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 ConversationHistory - 对话历史

**职责**: 管理工作记忆，存储最近的对话消息。

```
┌─────────────────────────────────────────────────┐
│           ConversationHistory                   │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • messages: Message[]                         │
│  • maxSize: number                             │
│  • maxTokens: number                           │
│                                                 │
│  Methods:                                       │
│  • addMessage() → 添加消息                     │
│  • addUserMessage() → 添加用户消息             │
│  • addAssistantMessage() → 添加助手消息        │
│  • addToolMessage() → 添加工具消息             │
│  • getMessages() → 获取所有消息                │
│  • getRecentMessages() → 获取最近消息          │
│  • estimateTokens() → 估算Token数量           │
│  • clear() → 清空历史                          │
└─────────────────────────────────────────────────┘
```

### 3.3 ToolMemory - 工具记忆

**职责**: 存储工具调用记录，支持去重和统计。

```
┌─────────────────────────────────────────────────┐
│              ToolMemory                         │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • records: ToolRecord[]                       │
│  • maxSize: number                             │
│                                                 │
│  Methods:                                       │
│  • addRecord() → 添加记录                      │
│  • getRecords() → 获取所有记录                 │
│  • getRecentRecords() → 获取最近记录           │
│  • findDuplicate() → 查找重复调用              │
│  • getToolStats() → 获取工具统计               │
│  • queryToolMemory() → 查询工具记忆            │
│  • exportToJSON() → 导出为JSON                 │
└─────────────────────────────────────────────────┘
```

### 3.4 SummaryMemory - 摘要记忆

**职责**: 存储历史摘要，用于 Token 压缩。

```
┌─────────────────────────────────────────────────┐
│            SummaryMemory                        │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • summaries: Summary[]                        │
│  • maxSize: number                             │
│                                                 │
│  Methods:                                       │
│  • addSummary() → 添加摘要                     │
│  • getSummaries() → 获取所有摘要               │
│  • getLatestSummary() → 获取最新摘要           │
│  • exportToJSON() → 导出为JSON                 │
└─────────────────────────────────────────────────┘
```

## 4. Tool System - 工具系统

**职责**: 提供插件化的工具管理架构，支持工具注册、加载和执行。

### 4.1 BaseTool - 工具基类

```
┌─────────────────────────────────────────────────┐
│              BaseTool (抽象类)                  │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • name: string - 工具名称                      │
│  • description: string - 工具描述               │
│  • paramsSchema: ZodSchema - 参数验证           │
│  • _enabled: boolean - 启用状态                 │
│                                                 │
│  Methods:                                       │
│  • execute(params) → 工具执行逻辑(抽象)         │
│  • run(params) → 验证+执行                      │
│  • toLangChainTool() → 转换为LangChain格式      │
│  • zodTypeToLangChainProperty() → 类型转换      │
└─────────────────────────────────────────────────┘
```

**特性**:

- 基于 Zod 的参数验证
- 自动生成 LangChain 工具定义
- 支持启用/禁用状态控制
- 类型安全的参数处理

### 4.2 ToolRegistry - 工具注册中心

```
┌─────────────────────────────────────────────────┐
│              ToolRegistry                       │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • tools: Map<string, BaseTool>                │
│                                                 │
│  Methods:                                       │
│  • registerTool(tool) → 注册单个工具            │
│  • registerTools(tools) → 批量注册              │
│  • getTools() → 获取所有工具                    │
│  • getEnabledTools() → 获取启用的工具           │
│  • enableTool(name) / disableTool(name)         │
│  • executeTool(name, params) → 执行工具         │
│  • getLangChainTools() → 获取LangChain格式      │
└─────────────────────────────────────────────────┘
```

### 4.3 ToolLoader - 工具加载器

```
┌─────────────────────────────────────────────────┐
│              ToolLoader                         │
├─────────────────────────────────────────────────┤
│  Methods:                                       │
│  • loadFromConfig(registry, configs, disabled)  │
│    → 从配置加载工具                             │
│  • loadAll(registry) → 加载所有工具             │
│  • getToolNames() → 获取所有工具名称            │
│  • hasTool(name) → 检查工具是否存在             │
└─────────────────────────────────────────────────┘
```

### 4.4 工具注册机制

```
┌─────────────────────────────────────────────────┐
│          @registerTool() 装饰器                 │
├─────────────────────────────────────────────────┤
│  使用方式:                                      │
│  @registerTool()                                │
│  class MyTool extends BaseTool {                │
│    readonly name = 'my-tool';                   │
│    readonly description = '我的工具';           │
│    readonly paramsSchema = z.object({...});     │
│    async execute(params) { ... }                │
│  }                                              │
│                                                 │
│  自动注册到: baseToolClasses[]                  │
│  自动加载: ToolLoader.loadFromConfig()          │
└─────────────────────────────────────────────────┘
```

## 5. 数据流架构

### 5.1 多轮循环执行数据流

```
用户输入
    │
    ▼
Controller.execute(prompt)
    │
    ▼
ExecutionEngine.run(prompt)
    │
    ├─→ OBSERVE 阶段
    │   • 收集当前状态
    │   • 更新工作记忆
    │   • 构建 PlanningContext
    │   • 检查终止条件
    │
    ├─→ PLAN 阶段
    │   • 调用 LLM 生成计划
    │   • 解析计划响应
    │   • 验证计划合法性
    │   • 返回计划或最终答案
    │
    ├─→ ACT 阶段
    │   • 检查工具去重
    │   • 构建依赖图
    │   • 生成执行波次
    │   • 并行执行工具
    │   • 收集工具结果
    │   • 更新工具记忆
    │
    └─→ REFLECT 阶段
        • 评估工具执行成功率
        • 分析信息增长
        • 检测重复调用模式
        • 做出决策 (continue/retry/finalize/fallback)
        • 记录反思指标
    │
    ▼
是否继续循环?
    │
    ├── 否 → 返回最终答案
    │
    └── 是 → 返回 OBSERVE 阶段
```

### 5.2 并行执行数据流

```
计划步骤
    │
    ▼
parseDependencyGraph(plan)
    │
    ▼
topologicalSort(steps)
    │
    ▼
groupIntoWaves(sortedSteps)
    │
    ▼
executeAllWaves(waves, toolExecutor)
    │
    ├─→ 波次0: [step1, step3] → 并行执行
    │   • resolveDependencies(step1.args)
    │   • resolveDependencies(step3.args)
    │   • Promise.all([execute(step1), execute(step3)])
    │
    ├─→ 波次1: [step2] → 等待波次0完成
    │   • resolveDependencies(step2.args, previousResults)
    │   • execute(step2)
    │
    └─→ 收集所有结果
        • 按步骤顺序排序
        • 返回 WaveExecutionResult[]
```

## 6. 架构特点

### 6.1 技术选型优势

- **LangChain**: 统一的 LLM 接口，支持 Function Calling
- **Zod**: 强类型参数验证，自动生成工具定义
- **TypeScript**: 类型安全，提高代码质量和开发效率
- **Commander**: 成熟的 CLI 框架，功能丰富
- **装饰器模式**: 自动化工具注册，简化开发
- **插件化设计**: 工具独立开发、配置和加载

### 6.2 设计模式

- **状态机模式**: 执行引擎使用状态机管理执行流程
- **策略模式**: 反思器支持不同的决策策略（conservative/balanced/aggressive）
- **工厂模式**: PlanningContextFactory 构建规划上下文
- **观察者模式**: 指标收集器支持回调通知
- **适配器模式**: PlannerAdapter 提供新旧格式兼容

### 6.3 扩展性

- **自定义反思策略**: 可实现 ReflectorStrategy 接口
- **自定义终止条件**: 可实现 TerminationCondition 接口
- **自定义记忆策略**: 可实现 MemoryStrategy 接口
- **插件化工具**: 通过装饰器自动注册新工具
