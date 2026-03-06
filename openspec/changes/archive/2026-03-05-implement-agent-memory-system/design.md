## 背景

当前 mini-agent 的 Controller 在每次 `execute()` 调用时从零构建对话历史（`const conversationHistory: ConversationMessage[] = []`），每次请求相互独立，无法保留跨请求的上下文。用户必须在每轮对话中重复提供背景信息，严重影响多轮交互体验。

本次改造选用 **LangChain 1.x 的 `RunnableWithMessageHistory`** 实现跨请求会话记忆。该 API 是 LangChain LCEL（LangChain Expression Language）生态的官方推荐方式，完整替代旧版 `ConversationChain` 和 `@langchain/memory` 包，与项目已有的 `@langchain/core ^1.1.28` 完全兼容，无需新增依赖。

## 目标 / 非目标

**目标：**

1. 使用 `RunnableWithMessageHistory` 实现跨请求的会话记忆自动管理
2. 使用 `InMemoryChatMessageHistory` 作为内存存储后端（进程内持久）
3. 使用 `trimMessages` 实现滑动窗口 Token 裁剪，避免超出上下文限制
4. 实现成本追踪系统，从 `AIMessage.usageMetadata` 读取真实 token 消耗
5. 重构 Controller，将手动消息数组管理替换为 Runnable 链调用

**非目标：**

- 长期记忆 / 持久化存储（不对接 Redis、数据库等外部系统）
- 向量检索 / RAG（预留 `BaseChatMessageHistory` 接口供未来扩展）
- 多会话并发管理（当前单会话场景，`sessionId` 固定为 `'default'`）
- **成本计算**（`CostTracker` 只记录 `usage` token 消耗，不计算 USD 成本，`totalCost` 固定为 0）

## Token 预检与处理流程

每次 `execute(prompt)` 调用时，在发起 LLM 请求前执行以下预检步骤：

```
1. 拼接完整 prompt
   system 消息 + SessionStore 历史消息 + 当前用户输入

2. 本地估算 token 数量
   estimateTokenCount(messages) → Math.ceil(totalLength / 4)

3. 超出模型限制时处理
   → 调用 trimMessages 裁剪历史（保留最新消息，始终保留 system）
   → summary 兜底（预留接口，暂不实现）

4. 发送请求
   chainWithHistory.invoke({ input: prompt }, { configurable: { sessionId } })

5. 从 usage 记录真实消耗
   response.usage → { input_tokens, output_tokens, total_tokens }
   costTracker.record(response.usage)

6. 计入成本系统
   （成本单价换算暂不实现，仅记录 token 数量）
```

`getTokenStatus()` 在预检阶段提供 `{ total, limit, percentage, exceeded, nearThreshold }` 状态报告，当 `exceeded = true` 时触发裁剪分支。

## 系统架构

```
src/agent/memory/
├── index.ts              # 统一导出入口
├── types.ts              # TokenUsage、CostRecord、CostSummary 类型定义
├── session-store.ts      # SessionStore：管理 InMemoryChatMessageHistory 实例
├── token-manager.ts      # estimateTokenCount + createTrimmer（trimMessages 工厂）
└── cost-tracker.ts       # CostTracker：从 usageMetadata 读取并累计 token 消耗
```

**需修改的现有文件：**

```
src/agent/controller.ts   # 核心重构：手动消息管理 → RunnableWithMessageHistory 链
```

## 记忆闭环流程

```
用户输入 (prompt)
   ↓
短期记忆拼接
   SessionStore.getOrCreate(sessionId) → 加载 InMemoryChatMessageHistory
   → 注入 MessagesPlaceholder('history')
   ↓
Token 预检（见上节）
   estimateTokenCount → 超限时 trimMessages 裁剪历史
   ↓
拼接检索结果（工具调用结果注入）
   工具调用轮次：Executor 执行工具 → ToolMessage 注入当前轮上下文
   → 循环直到 LLM 不再请求工具调用
   ↓
生成回复
   chainWithHistory.invoke({ input: prompt }, { configurable: { sessionId } })
   → ChatPromptTemplate（system + history + human）
   → trimMessages（链内兜底裁剪）
   → LLM.bindTools(tools) → AIMessage（含 usageMetadata）
   ↓
写入短期记忆
   RunnableWithMessageHistory 自动将 HumanMessage + AIMessage 写回 SessionStore
   CostTracker.record(response.usageMetadata) 记录 token 消耗
```

## 关键技术决策

### 1. 核心：`RunnableWithMessageHistory`

选择理由：

- LangChain 1.x 官方推荐，替代已废弃的 `ConversationChain`
- 自动处理历史读写，无需手动维护 `conversationHistory` 数组
- 与 LCEL Runnable 编排模式完全一致，可无缝接入 `pipe` / `invoke` 体系
- 通过 `sessionId` 支持多会话隔离，扩展性好

```typescript
import { RunnableWithMessageHistory } from '@langchain/core/runnables/history';
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';

const prompt = ChatPromptTemplate.fromMessages([
  ['system', '你是一个智能助手，使用工具来回答需要实时信息的问题。'],
  new MessagesPlaceholder('history'),
  ['human', '{input}'],
]);

const chain = prompt.pipe(trimmer).pipe(llm);

const chainWithHistory = new RunnableWithMessageHistory({
  runnable: chain,
  getMessageHistory: (sessionId) => sessionStore.getOrCreate(sessionId),
  inputMessagesKey: 'input',
  historyMessagesKey: 'history',
});

const response = await chainWithHistory.invoke(
  { input: userPrompt },
  { configurable: { sessionId: 'default' } }
);
```

### 2. Token 裁剪：`trimMessages`

选择理由：

- `@langchain/core/messages` 提供的官方工具，与 LangChain 消息类型完全兼容
- 支持按 token 数量、消息数量等多种策略
- 可作为 Runnable 链中的独立步骤，保持链式组合的一致性

```typescript
import { trimMessages } from '@langchain/core/messages';

const trimmer = trimMessages({
  maxTokens: config.maxTokens,
  strategy: 'last', // 保留最新消息，删除最旧的
  tokenCounter: estimateTokenCount,
  includeSystem: true, // 始终保留 system 消息
  allowPartial: false,
  startOn: 'human', // 从 HumanMessage 开始截取，避免孤立的 AI/tool 消息
});
```

### 3. 历史存储：`InMemoryChatMessageHistory`

- 进程内存储，重启后清空（满足非目标中不对接外部系统的要求）
- 实现 `BaseChatMessageHistory` 接口，未来可无缝替换为持久化后端
- 由 `SessionStore` 统一管理，每个 `sessionId` 对应一个独立实例

### 4. 成本追踪

LangChain 1.x 在 `AIMessage.usageMetadata` 中返回真实 token 消耗：

```typescript
interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}
```

`CostTracker.record(usageMetadata)` 从该字段读取并累加，提供 `getSummary()` 查询接口。`usageMetadata` 为 `undefined` 时静默跳过，不报错。

## Controller 重构策略

`execute()` 接口保持不变（入参 `prompt: string`，返回 `Promise<string>`），仅替换内部实现：

```typescript
// 旧方式（废弃）：每次调用手动构建消息数组
const conversationHistory: ConversationMessage[] = [];
conversationHistory.push({ role: 'user', content: prompt });
const messages = this.buildMessages(prompt, conversationHistory);
const response = await this.llm.invoke(messages);

// 新方式：RunnableWithMessageHistory 自动管理跨请求历史
const response = await this.chainWithHistory.invoke(
  { input: prompt },
  { configurable: { sessionId: this.sessionId } }
);
const text = typeof response.content === 'string' ? response.content : '';
this.costTracker.record(response.usageMetadata);
```

**废弃并移除的代码：**

- `buildMessages()` 方法
- `appendToolResults()` 方法
- `directLLMResponse()` / `finalLLMResponse()` 中的手动消息拼接
- `ConversationMessage` 类型的本地使用
- `conversationHistory: ConversationMessage[]` 局部变量

**保留不变的逻辑：**

- 超时检查（`checkTimeout()`）
- 迭代次数限制（`maxIterations`）
- 兜底策略（`fallback()`）
- 执行指标追踪（`ExecutionMetrics`）

## 迁移计划

1. **新增** `src/agent/memory/` 模块
   - `types.ts`：TokenUsage、CostRecord、CostSummary 类型
   - `session-store.ts`：SessionStore 类
   - `token-manager.ts`：estimateTokenCount 函数 + createTrimmer 工厂
   - `cost-tracker.ts`：CostTracker 类
   - `index.ts`：统一导出

2. **重构** `src/agent/controller.ts`
   - 构造函数中初始化 SessionStore、CostTracker
   - 构建 `ChatPromptTemplate | trimmer | llm.bindTools(tools)` Runnable 链
   - 用 `RunnableWithMessageHistory` 包装链，关联 SessionStore
   - `execute()` 改为调用 `chainWithHistory.invoke()`
   - 移除废弃的手动消息管理代码

3. **验证**
   - 运行现有测试无回归
   - 集成测试验证跨请求记忆保持
   - 验证 trimMessages 裁剪行为正确

## 风险与权衡

| 风险                                                                                    | 影响                              | 缓解措施                                               |
| --------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------ |
| `RunnableWithMessageHistory` 仅自动追踪 human/AI 消息对，工具调用中间步骤不自动写入历史 | 工具调用上下文可能在历史中缺失    | 测试验证；必要时在 Executor 返回后手动追加 ToolMessage |
| `trimMessages` 裁剪工具消息的兼容性                                                     | tool 消息被错误裁剪导致上下文缺失 | 配置 `startOn: 'human'` 保证从完整轮次开始裁剪         |
| Controller 重构影响现有测试                                                             | 破坏工具调用或兜底逻辑            | 保持 `execute()` 接口不变，仅替换内部实现              |

## 开放问题

1. **工具调用历史追踪**：`RunnableWithMessageHistory` 默认只追踪 human/AI 消息对，工具调用中间步骤需要手动追加到 SessionStore 还是保留当前轮次内的局部历史？待实现后验证。
2. **成本单价配置**：`CostTracker` 计算 USD 成本时需要单价，暂从 Controller 构造参数传入，未配置则仅统计 token 数量，成本显示为 0。
