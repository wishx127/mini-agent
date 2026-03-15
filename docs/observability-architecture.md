# 可观测性系统架构

本文档详细介绍 Mini Agent 的可观测性系统，包括架构设计、技术选型、实现方案和配置指南。

## 概述

Mini Agent 的可观测性系统基于 [Langfuse](https://langfuse.com/) 平台构建，提供完整的 AI 应用追踪能力：

- **Trace 追踪**：每次对话的完整调用链
- **Span 追踪**：LLM 调用和 Tool 调用的详细记录
- **Token 统计**：输入/输出 Token 使用量追踪
- **成本统计**：基于模型定价的自动成本计算
- **Prompt 版本管理**：系统 Prompt 模板的版本控制

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        AgentCore                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                  ObservabilityClient                     │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐│ │
│  │  │TraceManager │ │ SpanManager │ │   PromptManager     ││ │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘│ │
│  └─────────────────────────────────────────────────────────┘ │
│                           │                                   │
│  ┌────────────────────────┼────────────────────────────────┐ │
│  │                        ▼                                 │ │
│  │  ┌──────────┐    ┌──────────┐    ┌──────────────────┐   │ │
│  │  │Controller│───▶│ Planner  │───▶│    Executor      │   │ │
│  │  └──────────┘    └──────────┘    └──────────────────┘   │ │
│  │       │               │                   │              │ │
│  │       ▼               ▼                   ▼              │ │
│  │  [Trace]         [LLM Span]         [Tool Span]         │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │    Langfuse     │
                   │     Cloud       │
                   └─────────────────┘
```

### Trace/Span 层级结构

```
Trace (conversation)
├── Span (llm) - planner-decision
│   ├── input: { prompt, toolsCount }
│   ├── output: { toolCalls, needsTool }
│   └── metadata: { model, usage, cost }
│
├── Span (tool) - tool-execution
│   ├── input: { toolName, arguments }
│   ├── output: { result }
│   └── metadata: { success, executionTime }
│
└── Span (llm) - llm-response
    ├── input: { input, hasLongTermMemory }
    ├── output: { response }
    └── metadata: { model, usage, cost }
```

### 数据流向

```
1. 用户请求 → Controller.execute()
      │
      ▼
2. TraceManager.createTrace() → 创建 Trace
      │
      ▼
3. Planner.plan() → SpanManager.createLLMSpan()
      │
      ▼
4. Executor.execute() → SpanManager.createToolSpan()
      │
      ▼
5. Controller.llmResponseWithHistory() → SpanManager.createLLMSpan()
      │
      ▼
6. TraceManager.endTrace() → 结束 Trace
      │
      ▼
7. ObservabilityClient.flush() → 数据上报到 Langfuse
```

## 技术选型

### Langfuse SDK

选择 Langfuse 作为可观测性平台的原因：

| 特性        | Langfuse             | 其他方案        |
| ----------- | -------------------- | --------------- |
| AI 原生设计 | ✅ 专为 LLM 应用设计 | ❌ 通用 APM     |
| Token 追踪  | ✅ 内置支持          | ⚠️ 需要自定义   |
| 成本计算    | ✅ 自动计算          | ❌ 需要自己实现 |
| Prompt 管理 | ✅ 版本控制          | ❌ 不支持       |
| 开源        | ✅ 开源可自托管      | ⚠️ 部分开源     |
| 集成难度    | ✅ 简单              | ⚠️ 复杂         |

### SDK 集成方式

使用官方 `langfuse` npm 包：

```typescript
import Langfuse from 'langfuse';

const client = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_HOST,
});
```

## 模块设计

### 1. ObservabilityClient (langfuse-client.ts)

负责 Langfuse 客户端的初始化和生命周期管理。

```typescript
export class ObservabilityClient {
  private client: Langfuse | null;
  private config: ObservabilityConfig;

  constructor(config?: ObservabilityConfig) {
    this.config = config ?? createObservabilityConfig();
    this.client = createLangfuseClient(this.config);
  }

  isEnabled(): boolean {
    return this.config.enabled && this.client !== null;
  }

  async flush(): Promise<void> {
    if (this.client) {
      await this.client.flushAsync();
    }
  }
}
```

**关键特性**：

- 配置缺失时优雅降级
- 单例模式管理客户端实例
- 提供统一的启用状态检查

### 2. TraceManager (trace-manager.ts)

负责 Trace 的创建和生命周期管理。

```typescript
export class TraceManager {
  createTrace(context: TraceContext): string | null {
    if (!this.client.isEnabled()) return null;

    const trace = langfuseClient.trace({
      id: context.traceId,
      name: context.name,
      sessionId: context.sessionId,
      userId: context.userId,
      input: context.input,
    });

    return trace.id;
  }

  endTrace(output?: string, metadata?: Record<string, unknown>): void {
    // 记录最终状态和总耗时
  }
}
```

**Trace 类型**：

- `conversation`: 完整对话流程

### 3. SpanManager (span-manager.ts)

负责 Span 的创建、更新和结束。

```typescript
export class SpanManager {
  createLLMSpan(name: string, input: unknown, model?: string): string | null;
  endLLMSpan(
    spanId: string,
    output: unknown,
    usage?: LLMUsage,
    cost?: CostCalculation
  ): void;

  createToolSpan(name: string, toolName: string, input: unknown): string | null;
  endToolSpan(
    spanId: string,
    output: unknown,
    success: boolean,
    error?: Error
  ): void;
}
```

**Span 类型**：

- `llm`: LLM 调用（规划决策、响应生成）
- `tool`: 工具调用

### 4. CostCalculator (cost-calculator.ts)

负责 Token 成本计算。

```typescript
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': {
    inputCostPer1k: 0.0025,
    outputCostPer1k: 0.01,
    currency: 'USD',
  },
  'gpt-4o-mini': {
    inputCostPer1k: 0.00015,
    outputCostPer1k: 0.0006,
    currency: 'USD',
  },
  'deepseek-chat': {
    inputCostPer1k: 0.00014,
    outputCostPer1k: 0.00028,
    currency: 'USD',
  },
  // ... 更多模型
};

export function calculateCost(
  usage: LLMUsage,
  modelName: string
): CostCalculation {
  const pricing = getModelPricing(modelName);
  const inputCost = (usage.inputTokens / 1000) * pricing.inputCostPer1k;
  const outputCost = (usage.outputTokens / 1000) * pricing.outputCostPer1k;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency: pricing.currency,
  };
}
```

**支持的模型定价**：

- OpenAI: GPT-4, GPT-4 Turbo, GPT-4o, GPT-4o-mini, GPT-3.5-turbo
- Anthropic: Claude 3 Opus, Claude 3.5 Sonnet, Claude 3 Haiku
- DeepSeek: DeepSeek Chat, DeepSeek Reasoner
- 阿里云: Qwen Turbo, Qwen Plus, Qwen Max

### 5. PromptManager (prompt-manager.ts)

负责 Prompt 模板的版本管理。

```typescript
export class PromptManager {
  async registerPrompt(template: PromptTemplate): Promise<string | null>;
  async registerSystemPrompts(): Promise<void>;
  getPromptVersion(name: string): string | undefined;
}
```

**系统 Prompt 模板**：

- `agent-system`: Agent 系统提示词
- `planner-decision`: 规划决策提示词

## 集成点

### AgentCore 初始化

```typescript
// src/agent/core.ts
export class AgentCore {
  constructor(config: ModelConfig) {
    // 初始化可观测性客户端
    this.observabilityClient = this.initializeObservability();
    this.traceManager = new TraceManager(this.observabilityClient);
    this.spanManager = new SpanManager(
      this.observabilityClient,
      this.traceManager
    );
    this.promptManager = new PromptManager(this.observabilityClient);

    // 注册 Prompt 模板
    void this.registerPrompts();
  }
}
```

### Controller Trace 管理

```typescript
// src/agent/controller.ts
async execute(prompt: string): Promise<string> {
  // 创建 Trace
  const traceId = this.traceManager.generateTraceId();
  this.traceManager.createTrace({
    traceId,
    name: 'conversation',
    sessionId: this.sessionId,
    input: prompt,
  });

  try {
    // ... 执行逻辑

    // 结束 Trace
    this.traceManager.endTrace(result);
    return result;
  } catch (error) {
    this.traceManager.endTrace(undefined, { error: errorMessage });
    throw error;
  }
}
```

### LLM 调用 Span

```typescript
// 创建 LLM Span
const spanId = this.spanManager.createLLMSpan(
  'llm-response',
  { input, hasLongTermMemory },
  this.modelName
);

try {
  const response = await this.llm.invoke(messages);

  // 计算成本
  const usage = { inputTokens, outputTokens, totalTokens };
  const cost = calculateCost(usage, this.modelName);

  // 结束 Span
  this.spanManager.endLLMSpan(
    spanId,
    response.content,
    usage,
    cost,
    this.modelName
  );

  return response;
} catch (error) {
  this.spanManager.endSpan(spanId, { error });
  throw error;
}
```

### Tool 调用 Span

```typescript
// 创建 Tool Span
const spanId = this.spanManager.createToolSpan(
  'tool-execution',
  toolCall.toolName,
  toolCall.arguments
);

try {
  const result = await this.executeTool(toolCall);

  // 结束 Span
  this.spanManager.endToolSpan(
    spanId,
    result.result,
    result.success,
    result.executionTime,
    result.lastError ? new Error(result.lastError) : undefined
  );

  return result;
} catch (error) {
  this.spanManager.endSpan(spanId, { error });
  throw error;
}
```

## 配置指南

### 环境变量配置

```env
# Langfuse 配置
LANGFUSE_PUBLIC_KEY=pk-xxx
LANGFUSE_SECRET_KEY=sk-xxx
LANGFUSE_HOST=https://cloud.langfuse.com
LANGFUSE_ENABLED=true
```

### 代码配置

```typescript
import { AgentCore } from './agent/core.js';

const agent = new AgentCore({
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4o',
  observability: {
    enabled: true,
    publicKey: 'pk-xxx',
    secretKey: 'sk-xxx',
    host: 'https://cloud.langfuse.com',
  },
});
```

### 降级策略

当 Langfuse 配置缺失时，系统会自动降级：

```typescript
// 配置缺失时自动禁用
const enabled = enabled && !!publicKey && !!secretKey;

// 禁用后不影响业务流程
if (!this.client.isEnabled()) {
  return null; // 跳过追踪，不抛出错误
}
```

## 最佳实践

### 1. 及时刷新数据

```typescript
// 在程序退出前刷新数据
process.on('beforeExit', async () => {
  await agent.flushObservability();
});
```

### 2. 合理设置 Session ID

```typescript
// 使用用户 ID 或会话 ID 关联 Trace
this.traceManager.createTrace({
  traceId,
  name: 'conversation',
  sessionId: userId, // 用户 ID
  userId: userId,
});
```

### 3. 自定义模型定价

```typescript
import { addCustomPricing } from './observability/index.js';

addCustomPricing('my-custom-model', {
  inputCostPer1k: 0.001,
  outputCostPer1k: 0.002,
  currency: 'USD',
});
```

### 4. 错误追踪

```typescript
// 错误会自动记录到 Span
this.spanManager.endSpan(spanId, {
  error: error instanceof Error ? error : new Error('未知错误'),
});
```

## 文件结构

```
src/observability/
├── index.ts              # 模块导出
├── types.ts              # 类型定义
├── langfuse-client.ts    # Langfuse 客户端管理
├── trace-manager.ts      # Trace 生命周期管理
├── span-manager.ts       # Span 创建和管理
├── cost-calculator.ts    # 成本计算
└── prompt-manager.ts     # Prompt 版本管理
```

## 监控指标

在 Langfuse 平台可以查看以下指标：

| 指标         | 说明               |
| ------------ | ------------------ |
| Trace 数量   | 对话总数           |
| 平均响应时间 | 对话平均耗时       |
| Token 使用量 | 总 Token 消耗      |
| 成本统计     | 总成本和按模型分布 |
| 错误率       | 失败 Trace 占比    |
| 工具调用统计 | 各工具使用频率     |

## 故障排查

### 1. 数据未上报

检查配置是否正确：

```bash
# 查看启动日志
✅ [Observability] Langfuse 客户端初始化成功
```

### 2. 成本计算不准确

确认模型名称匹配：

```typescript
// 模型名称需要包含定价表中的关键字
modelName: 'gpt-4o'; // ✅ 匹配 'gpt-4o'
modelName: 'gpt-4o-2024-05-13'; // ✅ 匹配 'gpt-4o'
modelName: 'custom-model'; // ❌ 使用默认定价
```

### 3. Prompt 注册失败

Prompt 可能已存在，检查 Langfuse 控制台中的 Prompt 列表。
