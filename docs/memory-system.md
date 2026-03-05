# 会话记忆系统

Mini Agent 从 v1.1 起引入了基于 LangChain `RunnableWithMessageHistory` 的跨请求会话记忆系统，彻底解决了每次 `execute()` 调用相互独立、无法保留上下文的问题。

## 架构概览

```
src/agent/memory/
├── index.ts              # 统一导出入口
├── types.ts              # TokenUsage、CostRecord、CostSummary 类型定义
├── session-store.ts      # SessionStore：管理 InMemoryChatMessageHistory 实例
├── token-manager.ts      # estimateTokenCount + createTrimmer（trimMessages 工厂）
└── cost-tracker.ts       # CostTracker：从 usageMetadata 读取并累计 token 消耗
```

记忆闭环如下：

```
用户输入 (prompt)
   ↓
短期记忆拼接
   SessionStore.getOrCreate(sessionId) → 加载 InMemoryChatMessageHistory
   → 注入 MessagesPlaceholder('history')
   ↓
Token 预检（runTokenPreflight）
   estimateTokenCount → 超限时 trimMessages 裁剪历史
   ↓
发起 LLM 请求
   chainWithHistory.invoke({ input: prompt }, { configurable: { sessionId } })
   → ChatPromptTemplate（system + history + human）
   → trimMessages（链内兜底裁剪）
   → LLM.bindTools(tools) → AIMessage（含 usageMetadata）
   ↓
写入短期记忆
   RunnableWithMessageHistory 自动将 HumanMessage + AIMessage 写回 SessionStore
   CostTracker.record(response.usageMetadata) 记录 token 消耗
```

---

## 模块详解

### SessionStore

管理每个 `sessionId` 对应的 `InMemoryChatMessageHistory` 实例，是整个记忆系统的存储后端。

```typescript
import { SessionStore } from './memory/index.js';

const store = new SessionStore();

// 获取或创建 session（幂等）
const history = store.getOrCreate('user-123');

// 清空消息（保留 session）
await store.clear('user-123');

// 彻底移除 session
store.delete('user-123');

// 查看所有 session ID
const ids = store.getAllSessionIds(); // ['user-123', ...]
```

**特性：**

- 进程内存储，重启后清空（满足无需持久化的场景）
- 实现 `BaseChatMessageHistory` 接口，未来可无缝替换为 Redis 或数据库后端
- 每个 `sessionId` 对应独立实例，天然支持多用户/多会话隔离

---

### TokenManager

提供 token 估算、消息裁剪和预检功能。

#### estimateTokenCount

快速估算单段文本的 token 数量（`Math.ceil(text.length / 4)`）。

```typescript
import { estimateTokenCount } from './memory/index.js';

estimateTokenCount('Hello, world!'); // 4
```

#### createTrimmer

基于 `trimMessages` 创建 Runnable 裁剪器，可直接接入 LCEL 链中。

```typescript
import { createTrimmer } from './memory/index.js';

const trimmer = createTrimmer({ maxTokens: 4000 });
// 可作为 Runnable 链的一部分
const chain = prompt.pipe(trimmer).pipe(llm);
```

裁剪策略：

- `strategy: 'last'`：保留最新消息，删除最旧的
- `includeSystem: true`：始终保留 system 消息
- `allowPartial: false`：不裁剪单条消息
- `startOn: 'human'`：从 HumanMessage 开始截取，避免孤立的 AI/Tool 消息

#### getTokenStatus

获取消息列表的 token 状态报告。

```typescript
import { getTokenStatus } from './memory/index.js';

const status = getTokenStatus(messages, 4000);
// {
//   total: 1200,        // 当前 token 总量
//   limit: 4000,        // 上限
//   percentage: 0.3,    // 使用率
//   exceeded: false,    // 是否超限
//   nearThreshold: false // 是否接近阈值（默认 80%）
// }
```

#### runTokenPreflight

Token 预检：超限时自动裁剪，否则原样返回。

```typescript
import { runTokenPreflight } from './memory/index.js';

const safeMessages = await runTokenPreflight(messages, 4000);
```

---

### CostTracker

从 LLM 响应的 `usageMetadata` 读取并累计 token 消耗。

> **注意**：成本单价换算暂不实现，`totalCost` 固定为 0，仅统计 token 数量。

```typescript
import { CostTracker } from './memory/index.js';
import type { UsageMetadata } from '@langchain/core/messages';

const tracker = new CostTracker();

// 记录一次 LLM 调用的 token 消耗
tracker.record(response.usageMetadata, 'gpt-4o');

// 获取累计统计
const summary = tracker.getSummary();
// {
//   totalPromptTokens: 5000,
//   totalCompletionTokens: 2000,
//   totalTokens: 7000,
//   totalCost: 0,         // 暂不计算
//   requestCount: 10
// }

// 获取最近 5 条记录
const recent = tracker.getRecentRecords(5);

// 重置统计
tracker.reset();
```

---

## Controller 集成

Controller 在构造函数中自动初始化记忆系统，`execute()` 接口保持不变：

```typescript
const controller = new Controller(llm, toolRegistry, { maxTokens: 4000 });

// 第一轮对话
const reply1 = await controller.execute('我叫张三');

// 第二轮对话（自动记住第一轮上下文）
const reply2 = await controller.execute('我叫什么名字？');
// reply2: "你叫张三"

// 查询 token 使用统计
const summary = controller.getCostTracker().getSummary();
console.log(`本次会话共消耗 ${summary.totalTokens} tokens`);
```

---

## Token 预检流程

每次 `execute(prompt)` 时，在发起 LLM 请求前执行以下预检：

1. **加载当前历史**：从 `SessionStore` 获取历史消息
2. **拼接当前输入**：`[...historyMessages, new HumanMessage(prompt)]`
3. **估算 token 数量**：`estimateTokenCount` 对每条消息求和
4. **超限时裁剪**：调用 `runTokenPreflight`，裁剪后将历史写回 `SessionStore`
5. **链内兜底**：`createTrimmer` 作为 Runnable 链的一个步骤，提供第二层保护

---

## 设计决策

### 为什么选择 RunnableWithMessageHistory？

- LangChain 1.x 官方推荐，替代已废弃的 `ConversationChain`
- 自动处理历史读写，无需手动维护 `conversationHistory` 数组
- 通过 `sessionId` 支持多会话隔离，扩展性好
- 与 LCEL Runnable 编排模式完全一致

### 已知限制

| 限制           | 说明                       | 缓解措施                                         |
| -------------- | -------------------------- | ------------------------------------------------ |
| 进程内存储     | 重启后历史清空             | 可替换 `BaseChatMessageHistory` 实现为持久化后端 |
| token 估算精度 | `length / 4` 仅为近似值    | 双层裁剪（预检 + 链内）保证不超限                |
| 工具调用历史   | 仅自动追踪 human/AI 消息对 | 工具结果通过 `finalInput` 注入当前轮上下文       |
| 成本计算       | totalCost 固定为 0         | 预留接口，后续可接入单价配置                     |

---

## 扩展：替换为持久化存储

只需替换 `SessionStore` 内的存储实现：

```typescript
import { BaseChatMessageHistory } from '@langchain/core/chat_history';

class RedisMessageHistory implements BaseChatMessageHistory {
  // 实现 addMessage / getMessages / clear 等方法
}

class PersistentSessionStore {
  getOrCreate(sessionId: string): BaseChatMessageHistory {
    return new RedisMessageHistory(sessionId);
  }
  // ...
}
```

Controller 的其他部分无需任何修改。
