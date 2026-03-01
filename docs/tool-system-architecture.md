# Mini Agent 工具系统架构文档

## 1. 工具系统概览

工具系统是 Mini Agent 的核心扩展能力，采用插件化架构设计，支持工具的自动注册、动态加载和灵活配置。

### 1.1 核心特性

- **插件化设计**: 工具独立开发，通过装饰器自动注册
- **类型安全**: 基于 Zod 的参数验证和类型推导
- **标准接口**: 统一的 BaseTool 抽象类
- **配置驱动**: 通过配置文件控制工具行为
- **LangChain 兼容**: 自动转换工具定义格式

## 2. 模块架构图

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tool System                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  Tool Definition Layer                    │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐    │  │
│  │  │  BaseTool   │  │  TavilyTool  │  │  CustomTool  │    │  │
│  │  │  (抽象类)   │  │  (搜索工具)  │  │  (自定义)    │    │  │
│  │  └─────────────┘  └──────────────┘  └──────────────┘    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                      │
│                          │ @registerTool()                      │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                 Tool Registration Layer                   │  │
│  │  ┌─────────────────────────────────────────────────────┐ │  │
│  │  │  baseToolClasses: Array<ToolClass>                  │ │  │
│  │  │  [TavilyTool, CustomTool, ...]                      │ │  │
│  │  └─────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                      │
│                          │ ToolLoader.loadFromConfig()          │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                 Tool Management Layer                     │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │              ToolRegistry                          │  │  │
│  │  │  ┌──────────────────────────────────────────────┐ │  │  │
│  │  │  │  tools: Map<string, BaseTool>                │ │  │  │
│  │  │  │  • tavily -> TavilyTool instance             │ │  │  │
│  │  │  │  • custom -> CustomTool instance             │ │  │  │
│  │  │  └──────────────────────────────────────────────┘ │  │  │
│  │  │  • registerTool() - 注册工具实例                  │  │  │
│  │  │  • executeTool() - 执行工具                       │  │  │
│  │  │  • getLangChainTools() - 转换为LC格式             │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                      │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Tool Execution Layer                    │  │
│  │  ┌─────────────────────────────────────────────────────┐ │  │
│  │  │  Tool Execution Pipeline                            │ │  │
│  │  │  1. 参数验证 (Zod Schema)                           │ │  │
│  │  │  2. 状态检查 (enabled/disabled)                     │ │  │
│  │  │  3. 执行工具逻辑 (execute method)                   │ │  │
│  │  │  4. 返回结果 (string)                               │ │  │
│  │  └─────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 模块依赖关系

```
┌─────────────┐
│   Agent     │
│    Core     │
└──────┬──────┘
       │ 使用
       ▼
┌─────────────┐      自动注册      ┌──────────────┐
│    Tool     │ ◄───────────────── │   Tool       │
│  Registry   │                    │  Definition  │
└──────┬──────┘                    └──────┬───────┘
       │                                  │ 继承
       │ 使用                             ▼
       │                           ┌──────────────┐
       │                           │   BaseTool   │
       │                           │   (抽象类)   │
       │                           └──────────────┘
       │                                  ▲
       │                                  │ 实现
       ▼                                  │
┌─────────────┐                    ┌──────┴───────┐
│    Tool     │ ── 加载实例 ──────►│  具体工具    │
│   Loader    │                    │  (Tavily等)  │
└──────┬──────┘                    └──────────────┘
       │                                  ▲
       │ 导入                             │ 导出
       ▼                                  │
┌─────────────┐                    ┌──────┴───────┐
│  plugins/   │ ── 统一导出 ──────►│  index.ts    │
│             │                    │  (入口文件)  │
└─────────────┘                    └──────────────┘
```

## 3. 核心组件详解

### 3.1 BaseTool - 工具基类

**源文件**: `src/tools/base.ts`

**职责**: 定义工具的标准接口和行为模板

```
┌──────────────────────────────────────────────────┐
│              BaseTool (抽象类)                   │
├──────────────────────────────────────────────────┤
│  抽象属性 (子类必须实现):                        │
│  • name: string - 工具唯一标识                   │
│  • description: string - 工具功能描述            │
│  • paramsSchema: ZodSchema - 参数验证规则        │
│                                                  │
│  内部属性:                                       │
│  • _enabled: boolean - 工具启用状态              │
│                                                  │
│  核心方法:                                       │
│  • execute(params) [抽象] - 执行工具逻辑         │
│  • run(params) - 参数验证 + 执行                 │
│  • toLangChainTool() - 转换为LC格式              │
│                                                  │
│  辅助方法:                                       │
│  • zodTypeToLangChainProperty() - 类型转换       │
│  • extractDescription() - 提取参数描述           │
│  • unwrapZodType() - 解析Zod类型                 │
└──────────────────────────────────────────────────┘
```

**执行流程**:

```
run(params) 调用
    │
    ▼
检查 enabled 状态 ──► false ──► 抛出异常
    │ true
    ▼
Zod Schema 验证参数 ──► 失败 ──► 抛出异常
    │ 成功
    ▼
调用 execute(params)
    │
    ▼
返回结果 (string)
```

### 3.2 ToolRegistry - 工具注册中心

**源文件**: `src/tools/base.ts`

**职责**: 管理工具实例的生命周期，提供查询和执行接口

```
┌──────────────────────────────────────────────────┐
│              ToolRegistry                        │
├──────────────────────────────────────────────────┤
│  内部状态:                                       │
│  • tools: Map<string, BaseTool> - 工具映射表     │
│                                                  │
│  注册管理:                                       │
│  • registerTool(tool) - 注册单个工具             │
│  • registerTools(tools) - 批量注册               │
│  • clear() - 清空所有工具                        │
│                                                  │
│  查询接口:                                       │
│  • getTools() - 获取所有工具                     │
│  • getEnabledTools() - 获取启用的工具            │
│  • getTool(name) - 按名称查询                    │
│  • getLangChainTools() - 获取LC格式定义          │
│                                                  │
│  状态控制:                                       │
│  • enableTool(name) - 启用工具                   │
│  • disableTool(name) - 禁用工具                  │
│                                                  │
│  执行接口:                                       │
│  • executeTool(name, params) - 执行指定工具      │
└──────────────────────────────────────────────────┘
```

**工具执行流程**:

```
executeTool(name, params)
    │
    ▼
查询工具: tools.get(name) ──► 不存在 ──► 抛出异常
    │ 存在
    ▼
检查状态: tool.enabled ──► false ──► 抛出异常
    │ true
    ▼
执行工具: tool.run(params)
    │
    ├─► 成功 ──► 返回结果
    └─► 失败 ──► 捕获异常并重新抛出
```

### 3.3 ToolLoader - 工具加载器

**源文件**: `src/tools/loader.ts`

**职责**: 从配置和注册表中加载工具实例

```
┌──────────────────────────────────────────────────┐
│              ToolLoader                          │
├──────────────────────────────────────────────────┤
│  核心方法:                                       │
│  • loadFromConfig(registry, configs, disabled)   │
│    - 从配置加载工具到注册表                      │
│  • loadAll(registry) - 加载所有工具              │
│  • getToolNames() - 获取所有工具名称             │
│  • hasTool(name) - 检查工具是否存在              │
└──────────────────────────────────────────────────┘
```

**加载流程**:

```
loadFromConfig(registry, toolConfigs, disabledTools)
    │
    ▼
遍历 baseToolClasses
    │
    ├─► 对每个 ToolClass:
    │   │
    │   ├─► 创建实例: new ToolClass()
    │   │
    │   ├─► 检查禁用列表
    │   │   └─► 在列表中 ──► 跳过
    │   │
    │   ├─► 应用配置: toolConfigs[tool.name]
    │   │   └─► 设置 enabled 状态
    │   │
    │   └─► 注册: registry.registerTool(tool)
    │
    └─► 完成加载
```

### 3.4 工具注册机制

**源文件**: `src/tools/registry.ts`

**职责**: 自动收集工具类定义

```
┌──────────────────────────────────────────────────┐
│          @registerTool() 装饰器                  │
├──────────────────────────────────────────────────┤
│  装饰器函数:                                     │
│  function registerTool() {                       │
│    return function(constructor) {                │
│      baseToolClasses.push(constructor);          │
│      return constructor;                         │
│    }                                             │
│  }                                               │
│                                                  │
│  注册表:                                         │
│  const baseToolClasses: Array<ToolClass> = [];   │
│                                                  │
│  辅助函数:                                       │
│  • registerBaseTool(ToolClass) - 手动添加        │
│  • getRegisteredBaseTools() - 获取所有注册类     │
│                                                  │
│  自动注册流程:                                   │
│  plugins/index.ts 导出工具类                    │
│       ↓                                          │
│  loader.ts 导入 plugins/index.ts                │
│       ↓                                          │
│  装饰器自动执行，工具类加入注册表               │
└──────────────────────────────────────────────────┘
```

## 4. 数据流动流程

### 4.1 工具注册流程

```
┌──────────────────────────────────────────────────────────────┐
│                    Tool Registration Flow                     │
└──────────────────────────────────────────────────────────────┘

1. 定义工具类
   ┌─────────────────────────────────┐
   │ @registerTool()                 │
   │ class TavilyTool extends ...    │
   │   readonly name = 'tavily'      │
   │   readonly description = ...    │
   │   readonly paramsSchema = ...   │
   │   async execute(params) { ... } │
   │ }                               │
   └─────────────────────────────────┘
              │
              │ 装饰器执行
              ▼
2. 自动注册到类列表
   ┌─────────────────────────────────┐
   │ baseToolClasses: [              │
   │   TavilyTool,                   │
   │   CustomTool,                   │
   │   ...                           │
   │ ]                               │
   └─────────────────────────────────┘
              │
              │ plugins/index.ts 导入模块
              ▼
3. loader.ts 触发自动注册
   ┌─────────────────────────────────┐
   │ import './plugins/index.js';    │
   │ // 导入即触发装饰器注册         │
   └─────────────────────────────────┘
              │
              │ AgentCore 初始化
              ▼
4. ToolLoader 加载实例
   ┌─────────────────────────────────┐
   │ toolLoader.loadFromConfig(      │
   │   registry,                     │
   │   toolConfigs,                  │
   │   disabledTools                 │
   │ )                               │
   └─────────────────────────────────┘
              │
              │ 遍历注册表
              ▼
5. 创建并注册工具实例
   ┌─────────────────────────────────┐
   │ const tool = new TavilyTool();  │
   │ if (!disabled) {                │
   │   registry.registerTool(tool);  │
   │ }                               │
   └─────────────────────────────────┘
              │
              ▼
6. 工具就绪
   ┌─────────────────────────────────┐
   │ ToolRegistry {                  │
   │   tools: Map {                  │
   │     'tavily' -> TavilyTool,     │
   │     'custom' -> CustomTool,     │
   │     ...                         │
   │   }                             │
   │ }                               │
   └─────────────────────────────────┘
```

### 4.2 工具调用流程

```
┌──────────────────────────────────────────────────────────────┐
│                    Tool Invocation Flow                       │
└──────────────────────────────────────────────────────────────┘

1. 用户提问
   ┌─────────────────────────────────┐
   │ "最新的AI新闻有哪些？"          │
   └─────────────────────────────────┘
              │
              ▼
2. AgentCore 处理
   ┌─────────────────────────────────┐
   │ processPrompt(prompt)           │
   │ └─► llmDecision()               │
   └─────────────────────────────────┘
              │
              ▼
3. LLM 决策
   ┌─────────────────────────────────┐
   │ llm.bindTools(tools)            │
   │ llm.invoke(messages)            │
   │                                 │
   │ 返回: tool_calls = [{           │
   │   name: 'tavily',               │
   │   args: { query: '最新AI新闻' } │
   │ }]                              │
   └─────────────────────────────────┘
              │
              ▼
4. 工具路由
   ┌─────────────────────────────────┐
   │ toolRouter(toolCall)            │
   │ └─► toolRegistry.getTool(name)  │
   │                                 │
   │ 返回: TavilyTool instance       │
   └─────────────────────────────────┘
              │
              ▼
5. 工具验证
   ┌─────────────────────────────────┐
   │ toolValidator(tool)             │
   │ • 检查工具存在                  │
   │ • 检查工具启用                  │
   └─────────────────────────────────┘
              │
              ▼
6. 工具执行
   ┌─────────────────────────────────┐
   │ toolExecutor(toolCall, iter)    │
   │ └─► registry.executeTool()      │
   │     └─► tool.run(params)        │
   │        ├─► 验证参数(Zod)        │
   │        └─► execute(params)      │
   │                                 │
   │ 返回: "搜索结果: ..."           │
   └─────────────────────────────────┘
              │
              ▼
7. 结果处理
   ┌─────────────────────────────────┐
   │ resultTruncator(result)         │
   │ • 截断过长结果(>4000字符)       │
   └─────────────────────────────────┘
              │
              ▼
8. 添加到对话历史
   ┌─────────────────────────────────┐
   │ appendToolMessage()             │
   │ • 添加 assistant 消息           │
   │ • 添加 tool 调用记录            │
   │ • 添加 tool 执行结果            │
   └─────────────────────────────────┘
              │
              ▼
9. 最终响应
   ┌─────────────────────────────────┐
   │ finalLLMResponse()              │
   │ • LLM 基于工具结果生成答案      │
   └─────────────────────────────────┘
              │
              ▼
10. 返回用户
   ┌─────────────────────────────────┐
   │ "根据搜索结果，最新的AI新闻..."│
   └─────────────────────────────────┘
```

### 4.3 LangChain 工具转换流程

```
┌──────────────────────────────────────────────────────────────┐
│              LangChain Tool Conversion Flow                   │
└──────────────────────────────────────────────────────────────┘

BaseTool 实例
   │
   ▼
toLangChainTool() 调用
   │
   ├─► 提取基本信息
   │   • name: 'tavily'
   │   • description: '搜索工具...'
   │
   ├─► 解析 Zod Schema
   │   paramsSchema: z.object({
   │     query: z.string()
   │   })
   │
   ├─► 转换参数类型
   │   zodTypeToLangChainProperty()
   │   • ZodString → { type: 'string', description: '...' }
   │   • ZodNumber → { type: 'number', description: '...' }
   │   • ZodBoolean → { type: 'boolean', description: '...' }
   │   • ZodEnum → { type: 'string', enum: [...] }
   │
   └─► 生成 LangChain 格式
       {
         type: 'function',
         function: {
           name: 'tavily',
           description: '搜索工具...',
           parameters: {
             type: 'object',
             properties: {
               query: {
                 type: 'string',
                 description: '搜索查询关键词'
               }
             },
             required: ['query']
           }
         }
       }
              │
              ▼
    LLM Function Calling 使用
```

## 5. 扩展开发指南

### 5.1 开发新工具

```typescript
// 1. 创建工具文件: src/tools/plugins/my-tool.ts

import { z } from 'zod';
import { BaseTool } from '../base.js';
import { registerTool } from '../registry.js';

@registerTool() // 自动注册装饰器
export class MyTool extends BaseTool {
  // 工具名称 (唯一标识)
  readonly name = 'my-tool';

  // 工具描述 (LLM 会根据描述判断何时使用)
  readonly description = '我的自定义工具,用于处理特定任务';

  // 参数定义 (Zod Schema)
  readonly paramsSchema = z.object({
    input: z.string().describe('输入参数'),
    option: z.enum(['a', 'b']).optional().describe('可选选项'),
  });

  // 执行逻辑
  async execute(params: Record<string, unknown>): Promise<string> {
    const { input, option } = params as {
      input: string;
      option?: 'a' | 'b';
    };

    // 实现工具逻辑
    const result = await doSomething(input, option);

    // 返回字符串结果
    return `处理结果: ${result}`;
  }
}
```

### 5.2 注册新工具

```typescript
// 2. 在 src/tools/plugins/index.ts 中添加导出

export { MyTool } from './my-tool.js';

// 装饰器 @registerTool() 会自动完成注册，无需手动调用 registerBaseTool()
```

### 5.3 配置新工具

```yaml
# 3. 在配置文件中可选配置

tools:
  disabled:
    - 'my-tool' # 禁用工具
  configs:
    my-tool:
      enabled: true
      # 其他自定义配置
```

## 7. 总结

Mini Agent 的工具系统采用清晰的分层架构:

1. **定义层**: BaseTool 抽象类定义标准接口
2. **注册层**: 装饰器自动收集工具类定义
3. **管理层**: ToolRegistry 管理工具实例生命周期
4. **执行层**: 完整的参数验证和执行流程

通过插件化设计和配置驱动,工具系统具备良好的扩展性和灵活性,开发者可以轻松添加新工具,用户可以通过配置控制工具行为。
