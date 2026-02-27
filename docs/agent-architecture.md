# Mini Agent 架构设计文档

## 1. 整体架构概览

Mini Agent 采用分层模块化架构，各组件职责明确，通过清晰的接口进行通信。

### 1.1 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                     Mini Agent                          │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │  CLI Interface  │    │    ModelConfigManager       │ │
│  │                 │    │                             │ │
│  │ • 用户交互      │    │ • 配置加载                   │ │
│  │ • 输入处理      │    │ • 配置验证                   │ │
│  │ • 响应显示      │    │ • 多源配置合并               │ │
│  └─────────┬───────┘    └──────────────┬──────────────┘ │
│            │                           │                │
│            │                           │                │
│  ┌─────────▼───────────────────────────▼──────────────┐ │
│  │                      Agent                         │ │
│  │                                                    │ │
│  │  • 接收用户输入 → 调用LLM → 返回响应                │ │
│  │  • LangChain ChatOpenAI集成                        │ │
│  │  • HumanMessage包装和invoke调用                    │ │
│  └───────────────────────┬────────────────────────────┘ │
│                          │                              │
│  ┌───────────────────────▼────────────────────────────┐ │
│  │               LLM Backend (External)               │ │
│  │                                                    │ │
│  │  • OpenAI API / 兼容服务                           │ │
│  │  • HTTP REST API 调用                              │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## 2. 核心组件架构

### 2.1 AgentCore - AI代理核心

**职责**: 处理AI对话逻辑，桥接用户输入和LLM服务

```
┌─────────────────────────────────────────┐
│              AgentCore                  │
├─────────────────────────────────────────┤
│  Properties:                            │
│  • llm: ChatOpenAI                      │
│  • config: ModelConfig                  │
│                                         │
│  Methods:                               │
│  • processPrompt(prompt) → 处理用户输入，调用LLM进行响应 │
│  • initializeLLM() → 初始化ChatOpenAI实例 │
│  • callLLM(prompt) → 调用LLM，获取响应内容 │
│  • formatResponse(response) → 格式化响应内容 │
└─────────────────┬───────────────────────┘
                  │
                  │ 依赖
                  ▼
┌─────────────────────────────────────────┐
│           ChatOpenAI (LangChain)        │
│                                         │
│  • invoke: 同步阻塞调用模型,支持多种输入格式 │
└─────────────────────────────────────────┘
```

**工作流程**:

```
用户输入
    ↓
processPrompt(prompt)
    ↓
callLLM(prompt)
    ├─→ HumanMessage(prompt)  // 包装用户输入,符合LangChain输入格式
    ├─→ llm.invoke([message]) // 调用LLM
    └─→ response.content      // 提取响应内容
    ↓
返回AI响应
```

## 3. 数据流架构

### 3.1 对话数据流

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
AgentCore.callLLM()
    ├─────────► HumanMessage()  // 包装输入
    │
    ▼
ChatOpenAI.invoke([message])
    │
    ▼
LLM Backend (HTTP API)
    │ (响应内容)
    ▼
ChatOpenAI
    │
    ▼
AgentCore ← response.content
    │
    ▼
CLIInterface
    │
    ▼
用户
```

## 4. 架构特点

### 4.1 技术选型优势

- **LangChain**: 统一的 LLM 接口，支持多种模型
- **TypeScript**: 类型安全，提高代码质量和开发效率
- **Commander**: 成熟的 CLI 框架，功能丰富
- **模块化设计**: 便于测试、维护和团队协作
