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
│  │  • 接收用户输入 → 工具决策 → 工具执行 → 返回响应            │   │
│  │  • 8步流水线架构                                           │   │
│  │  • LangChain ChatOpenAI集成                                │   │
│  │  • 工具注册与管理                                          │   │
│  └───────────────────────┬────────────────────────────────────┘   │
│                          │                                        │
│            ┌─────────────┴─────────────┐                          │
│            │                           │                          │
│  ┌─────────▼──────────┐    ┌──────────▼───────────────────────┐  │
│  │   Tool Registry    │    │      LLM Backend (External)      │  │
│  │                    │    │                                  │  │
│  │ • BaseTool管理     │    │ • OpenAI API / 兼容服务          │  │
│  │ • 工具注册/查询    │    │ • HTTP REST API 调用             │  │
│  │ • 启用/禁用控制    │    │ • Function Calling 支持          │  │
│  │ • LangChain格式    │    │                                  │  │
│  │   转换             │    │                                  │  │
│  └────────────────────┘    └──────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

## 2. 核心组件架构

### 2.1 AgentCore - AI代理核心

**职责**: 处理AI对话逻辑,管理工具调用流程,桥接用户输入和LLM服务

```
┌─────────────────────────────────────────────────┐
│                  AgentCore                      │
├─────────────────────────────────────────────────┤
│  Properties:                                    │
│  • llm: ChatOpenAI                              │
│  • config: ModelConfig                          │
│  • toolRegistry: ToolRegistry                   │
│                                                 │
│  Methods:                                       │
│  • processPrompt(prompt) → 处理用户输入         │
│  • llmDecision() → LLM决策是否使用工具          │
│  • toolRouter() → 工具路由选择                  │
│  • toolValidator() → 工具参数验证               │
│  • toolExecutor() → 工具执行(超时+重试)         │
│  • resultTruncator() → 结果截断                 │
│  • finalLLMResponse() → 获取最终响应            │
└─────────────────┬───────────────────────────────┘
                  │
                  │ 依赖
                  ▼
┌─────────────────────────────────────────────────┐
│         ChatOpenAI + ToolRegistry               │
│                                                 │
│  • invoke: 同步阻塞调用模型                     │
│  • bindTools: 绑定工具支持Function Calling      │
└─────────────────────────────────────────────────┘
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
    ├─→ Promise.race()       │
    ├─→ tool.run()           │
    └─→ timeout: 30s         │
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
