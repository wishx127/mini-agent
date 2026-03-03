# Mini Agent 架构设计文档

## 1. 整体架构概览

Mini Agent 采用分层模块化架构,集成了工具调用能力,支持 LLM 自主决策和执行工具。各组件职责明确,通过清晰的接口进行通信。

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
│  │  │  ┌─────────────┐   ┌─────────────┐   ┌───────────┐ │  │   │
│  │  │  │ Controller  │ → │   Planner   │ → │  Executor │ │  │   │
│  │  │  │  (控制层)   │   │  (决策层)   │   │  (执行层) │ │  │   │
│  │  │  │             │   │             │   │           │ │  │   │
│  │  │  │ • Token限制 │   │ • 工具判断  │   │ • 执行工具│ │  │   │
│  │  │  │ • 超时控制  │   │ • 工具选择  │   │ • 重试机制│ │  │   │
│  │  │  │ • 迭代限制  │   │ • 执行规划  │   │ • 错误处理│ │  │   │
│  │  │  │ • 兜底策略  │   │ • 参数验证  │   │ • 结果格式化│ │  │   │
│  │  │  └─────────────┘   └─────────────┘   └───────────┘ │  │   │
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

**职责**: 处理AI对话逻辑,管理工具调用流程,桥接用户输入和LLM服务。AgentCore 作为门面类,集成编排层三个模块。

```
┌─────────────────────────────────────────────────┐
│                  AgentCore                      │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • llm: ChatOpenAI                             │
│  • config: ModelConfig                         │
│  • toolRegistry: ToolRegistry                  │
│  • controller: Controller                      │
│  • planner: Planner                            │
│  • executor: Executor                          │
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
│  • Token 限制检查                               │
│  • 超时控制                                     │
│  • 迭代次数限制                                 │
│  • 兜底策略                                     │
└─────────────────────────────────────────────────┘
```

### 2.1.1 Controller - 控制层

**职责**: 全局控制,管理执行边界,提供安全保障。

| 属性           | 说明            |
| -------------- | --------------- |
| `llm`          | ChatOpenAI 实例 |
| `toolRegistry` | 工具注册表      |
| `config`       | 控制配置        |
| `metrics`      | 执行指标        |

**方法**:

- `execute(prompt)` - 编排入口
- `checkTokenLimit()` - Token 限制检查
- `checkTimeout()` - 超时检查
- `checkIterationCount()` - 迭代次数检查
- `fallback()` - 兜底策略
- `trackMetrics()` - 指标追踪

**控制参数**:

- `maxTokens`: 最大 Token 数量 (默认 4096)
- `maxIterations`: 最大迭代次数 (默认 3)
- `timeout`: 超时时间 (默认 30000ms)
- `tokenThreshold`: Token 预警阈值 (默认 0.9)

### 2.1.2 Planner - 决策层

**职责**: 智能决策,决定是否使用工具、选择哪个工具、规划调用顺序。

**方法**:

- `shouldUseTool()` - 判断是否需要工具
- `selectTool()` - 选择工具
- `planExecution()` - 规划执行顺序
- `validateParams()` - 参数验证
- `llmDecision()` - LLM 智能决策
- `ruleBasedFallback()` - 规则兜底
- `generateExecutionPlan()` - 生成执行计划

### 2.1.3 Executor - 执行层

**职责**: 工具执行,包含重试机制、熔断保护和错误处理。

**方法**:

- `execute()` - 执行工具
- `executeWithRetry()` - 带重试的执行
- `handleError()` - 错误分类和处理
- `formatResult()` - 格式化结果
- `truncateResult()` - 截断过长结果

**重试策略**:

- 网络错误: 最多重试 3 次,指数退避 (1s, 2s, 4s)
- 超时错误: 最多重试 2 次,固定间隔 (1s)
- 参数错误: 不重试,直接返回错误

**熔断保护**:

```
┌──────────────────────────────────────────────────┐
│          CircuitBreaker 状态机                   │
├──────────────────────────────────────────────────┤
│  CLOSED (关闭)                                   │
│  • 正常执行工具调用                              │
│  • 记录成功/失败次数                             │
│  • 失败达到阈值 → OPEN                          │
│                                                  │
│  OPEN (打开)                                     │
│  • 拒绝所有调用，返回 CircuitOpenError          │
│  • 等待 resetTimeout 后 → HALF_OPEN             │
│                                                  │
│  HALF_OPEN (半开)                                │
│  • 允许有限次数的测试调用                        │
│  • 成功 → CLOSED                                │
│  • 失败 → OPEN                                  │
└──────────────────────────────────────────────────┘
```

**执行流程**:

```typescript
// Executor 中的熔断器使用
const breaker = this.toolRegistry.getToolBreaker(toolName);

try {
  const result = await breaker.execute(async () => {
    return this.toolRegistry.executeTool(name, params);
  });
} catch (error) {
  if (error instanceof CircuitOpenError) {
    // 熔断器打开，返回状态信息
    return { success: false, result: error.message };
  }
}
```

### 编排层工作流程

```
用户输入
    ↓
Controller.execute(prompt)
    ↓
Planner.shouldUseTool() → 判断是否需要工具
    ↓
Planner.selectTool() → 选择工具
    ↓
Planner.generateExecutionPlan() → 生成执行计划
    ↓
Controller.checkTokenLimit() → Token 限制检查
    ↓
Controller.checkTimeout() → 超时检查
    ↓
Executor.execute(plan) → 执行工具
    ├─→ executeWithRetry() → 重试机制
    ├─→ handleError() → 错误处理
    └─→ truncateResult() → 结果截断
    ↓
Controller.checkIterationCount() → 迭代次数检查
    ↓
返回响应或执行兜底策略
```

**工作流程 - 8步流水线**:

```
用户输入
    ↓
processPrompt(prompt)
    ↓
Step 1: LLM Decision - 判断是否需要使用工具
    ├─→ 使用 bindTools 让 LLM 自主决策
    └─→ 规则兜底策略（关键词匹配）
    ↓
Step 2: Tool Router - 选择工具
    ├─→ 从 ToolRegistry 查询工具
    └─→ 验证工具是否启用
    ↓
Step 3: Tool Validator - 参数验证
    └─→ 使用 Zod Schema 验证参数
    ↓
Step 4 & 5: Tool Executor - 执行工具
    ├─→ Promise.race 实现超时控制(30s)
    └─→ 捕获异常并记录
    ↓
Step 6: Result Truncator - 结果截断
    └─→ 限制最大 4000 字符
    ↓
Step 7: Append Tool Message - 添加工具消息
    └─→ 记录到对话历史
    ↓
Step 8: Final LLM Response - 最终响应
    └─→ 基于工具结果生成答案
```

### 2.2 Tool System - 工具系统

**职责**: 提供插件化的工具管理架构,支持工具注册、加载和执行

#### 2.2.1 BaseTool - 工具基类

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

#### 2.2.2 ToolRegistry - 工具注册中心

```
┌─────────────────────────────────────────────────┐
│              ToolRegistry                       │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • tools: Map<string, BaseTool>                 │
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

#### 2.2.3 ToolLoader - 工具加载器

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

#### 2.2.4 工具注册机制

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

**示例工具 - TavilySearchTool**:

```
┌─────────────────────────────────────────────────┐
│          TavilySearchTool                       │
├─────────────────────────────────────────────────┤
│  • name: 'tavily'                               │
│  • description: 搜索互联网最新信息              │
│  • paramsSchema: { query: string }              │
│  • 功能: 使用 Tavily API 进行联网搜索           │
│  • 返回: 格式化的搜索结果                       │
└─────────────────────────────────────────────────┘
```

## 3. 数据流架构

### 3.1 工具调用数据流

```
用户输入
    │
    ▼
CLIInterface.handleUserInput()
    │
    ▼
AgentCore.processPrompt()
    │
    ▼
AgentCore.llmDecision() ────┐
    │                        │
    ├─→ bindTools()          │
    ├─→ LLM.invoke()         │
    └─→ tool_calls?          │
         │                   │
         │ YES               │ NO
         ▼                   ▼
    ToolRouter           finalLLMResponse()
         │                   │
         ▼                   │
    ToolValidator            │
         │                   │
         ▼                   │
    ToolExecutor             │
    ├─→ CircuitBreaker.execute() ← 熔断保护
    │   ├─→ Promise.race()   │
    │   ├─→ tool.run()       │
    │   └─→ timeout: 30s     │
    └─→ CircuitOpenError?    │ ← 熔断拦截
         │                   │
         ▼                   │
    ResultTruncator          │
         │                   │
         ▼                   │
    AppendToolMessage        │
         │                   │
         ▼                   │
    finalLLMResponse() ◄─────┘
         │
         ▼
    返回AI响应
```

## 4. 架构特点

### 5.1 技术选型优势

- **LangChain**: 统一的 LLM 接口,支持 Function Calling
- **Zod**: 强类型参数验证,自动生成工具定义
- **TypeScript**: 类型安全,提高代码质量和开发效率
- **Commander**: 成熟的 CLI 框架,功能丰富
- **装饰器模式**: 自动化工具注册,简化开发
- **插件化设计**: 工具独立开发、配置和加载
