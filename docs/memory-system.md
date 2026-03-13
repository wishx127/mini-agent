# 记忆系统

Mini Agent 的记忆系统分为两个层次：**短期记忆**（会话历史）和**长期记忆**（跨会话持久化）。两者协同工作，为 Agent 提供连续上下文和个性化能力。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Controller                                      │
│                    (编排层 - 协调短期记忆、长期记忆、工具调用)                │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
┌─────────────────────────┐  ┌─────────────────────────────┐  ┌──────────────────────────┐
│   短期记忆 (Session)    │  │   长期记忆 (LongTerm)      │  │    工具调用              │
│                         │  │                             │  │                          │
│ SessionStore            │  │ LongTermMemoryReader        │  │ Planner                  │
│ (InMemoryChatHistory)   │  │ (检索 + 格式化)             │  │ (计划)                   │
│                         │  │                             │  │                          │
│ RunnableWithMessage     │  │ MemoryDispatcher            │  │ Executor                 │
│ History                 │  │ (派发提取任务)              │  │ (执行)                   │
│                         │  │                             │  │                          │
│ - 进程内存储             │  │ MemoryJobQueue              │  │                          │
│ - 自动读写历史           │  │ (持久化队列)                │  │                          │
│ - Token 预检 + 裁剪      │  │                             │  │                          │
└─────────────────────────┘  └─────────────────────────────┘  └──────────────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────────────┐
                              │   VectorDatabaseClient      │
                              │   (Supabase + pgvector)    │
                              └─────────────────────────────┘
```

## 目录结构

```
src/agent/memory/
├── index.ts                        # 统一导出入口
├── types.ts                        # TokenUsage、CostRecord、CostSummary 类型
├── session-store.ts                # SessionStore：管理 InMemoryChatMessageHistory
├── token-manager.ts                # estimateTokenCount + createTrimmer + 预检
├── cost-tracker.ts                 # CostTracker：Token 消耗统计
├── vector-database-client.ts        # 向量数据库客户端（Supabase）
├── memory-extractor.ts             # 记忆提取器（LLM 驱动）
├── long-term-memory-manager.ts     # 长期记忆管理器（生命周期 + 队列）
├── long-term-memory-reader.ts      # 长期记忆读取器（检索 + 格式化）
├── memory-dispatcher.ts            # 记忆派发器（协调存储流程）
└── memory-job-queue.ts             # 持久化队列（异步任务处理）
```

---

## 短期记忆（会话历史）

短期记忆基于 LangChain `RunnableWithMessageHistory`，实现跨请求的会话上下文保留。

### 记忆闭环

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

### SessionStore

管理每个 `sessionId` 对应的 `InMemoryChatMessageHistory` 实例，是短期记忆的存储后端。

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

- 进程内存储，重启后清空
- 实现 `BaseChatMessageHistory` 接口，可替换为 Redis 或数据库后端
- 每个 `sessionId` 对应独立实例，天然支持多用户/多会话隔离

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

### CostTracker

从 LLM 响应的 `usageMetadata` 读取并累计 token 消耗。

> **注意**：成本单价换算暂不实现，`totalCost` 固定为 0，仅统计 token 数量。

```typescript
import { CostTracker } from './memory/index.js';

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

## 长期记忆（跨会话）

长期记忆通过向量数据库实现跨会话的持久化记忆，记住用户的偏好、背景和重要事实。

### Worker 生命周期（CLI 模式）

CLI 启动时会自动拉起长期记忆 Worker，负责消费持久化队列：

- CLI 运行期间，Worker 常驻并持续消费队列
- CLI 退出后，Worker 继续处理剩余队列，**队列清空后自动退出**
- Worker 日志写入 `memory-worker.log`

### 核心组件

#### VectorDatabaseClient

- 管理 Supabase 连接
- 生成文本向量（Qwen text-embedding-v3，1024 维）
- 向量相似度搜索
- 失败降级和缓存机制

```typescript
import { VectorDatabaseClient } from './memory/index.js';

const dbClient = new VectorDatabaseClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseApiKey: process.env.SUPABASE_API_KEY!,
  embeddingApiKey: process.env.EMBEDDING_API_KEY!,
});

await dbClient.initialize();
const results = await dbClient.searchSimilar(embedding, 5);
```

#### LongTermMemoryReader

仅负责检索和格式化，不执行存储操作。

```typescript
const reader = new LongTermMemoryReader(dbClient, {
  enabled: true,
  topK: 5,
});

const results = await reader.search('用户偏好');
const context = reader.formatMemoriesForPrompt(results);
// 输出:
// 以下是可能与当前对话相关的历史记忆：
// 1. [用户偏好] 用户喜欢深色主题 (相关度: 95%)
```

#### MemoryDispatcher

协调记忆提取任务的派发。

```typescript
const dispatcher = new MemoryDispatcher({ enabled: true });
await dispatcher.dispatch('用户消息', 'AI 回复', 'session-123');
```

#### MemoryJobQueue

持久化队列，用于异步处理记忆存储任务，支持失败重试。

```typescript
const queue = new MemoryJobQueue('/path/to/queue');
await queue.enqueue({ userMessage, aiResponse, sessionId });
const jobs = await queue.take(1);
await queue.ack(job);
```

### 长期记忆检索流程

```
用户输入 (prompt)
   ↓
LongTermMemoryReader.search(query)
   ↓
VectorDatabaseClient.generateEmbedding(query)
   ↓
Supabase 向量搜索
   ↓
返回相似记忆列表
   ↓
更新访问记录 (access_count++, last_accessed_at)
   ↓
formatMemoriesForPrompt() 格式化
   ↓
注入 LLM Prompt (long_term_memory)
```

### 记忆类型

| 类型              | 说明       | 示例                                   |
| ----------------- | ---------- | -------------------------------------- |
| `user_preference` | 用户偏好   | "User prefers TypeScript"              |
| `fact`            | 事实信息   | "User's project uses Node.js 18"       |
| `experience`      | 交互经验   | "Weather search returned good results" |
| `task`            | 任务相关   | "User needs to deploy to production"   |
| `context`         | 上下文信息 | "Discussing project architecture"      |

---

## Controller 集成

Controller 在构造函数中自动初始化记忆系统：

```typescript
const controller = new Controller(
  llm,
  toolRegistry,
  {
    enableLongTermMemory: true,
    longTermMemoryTopK: 5,
    memoryExtractionThreshold: 0.7,
  },
  {
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseApiKey: process.env.SUPABASE_API_KEY!,
    embeddingApiKey: process.env.EMBEDDING_API_KEY!,
  }
);

// 第一轮对话
const reply1 = await controller.execute('我叫张三');
// 自动检索长期记忆 + 存储短期记忆

// 第二轮对话
const reply2 = await controller.execute('我叫什么名字？');
// 记住上下文 + 可能基于长期记忆

// 查询 token 使用统计
const summary = controller.getCostTracker().getSummary();
console.log(`本次会话共消耗 ${summary.totalTokens} tokens`);
```

### 短期记忆流程

1. 加载会话历史（`SessionStore.getOrCreate`）
2. Token 预检，超限则裁剪历史
3. 执行 LLM 链
4. 自动写回对话历史
5. 记录 token 消耗

### 长期记忆流程

1. 检索相关记忆（`LongTermMemoryReader.search`）
2. 格式化记忆上下文
3. 注入 LLM Prompt
4. 异步派发存储任务（`MemoryDispatcher.dispatch`）
5. 持久化队列处理（`MemoryJobQueue`）

---

## Token 预检流程

每次 `execute(prompt)` 时：

1. **加载当前历史**：从 `SessionStore` 获取历史消息
2. **拼接当前输入**：`[...historyMessages, new HumanMessage(prompt)]`
3. **估算 token 数量**：`estimateTokenCount` 对每条消息求和
4. **超限时裁剪**：调用 `runTokenPreflight`，裁剪后将历史写回 `SessionStore`
5. **链内兜底**：`createTrimmer` 作为 Runnable 链的一个步骤，提供第二层保护

---

## 设计决策

### 为什么选择 RunnableWithMessageHistory？

- LangChain 官方推荐，替代已废弃的 `ConversationChain`
- 自动处理历史读写，无需手动维护 `conversationHistory` 数组
- 通过 `sessionId` 支持多会话隔离，扩展性好
- 与 LCEL Runnable 编排模式完全一致

### 短期记忆 vs 长期记忆

| 特性     | 短期记忆          | 长期记忆              |
| -------- | ----------------- | --------------------- |
| 存储方式 | 进程内 (InMemory) | 向量数据库 (Supabase) |
| 持久化   | 否                | 是                    |
| 检索方式 | 顺序              | 向量相似度            |
| 用途     | 当前会话上下文    | 跨会话个性化          |

### 已知限制

| 限制           | 说明                       | 缓解措施                   |
| -------------- | -------------------------- | -------------------------- |
| 进程内存储     | 重启后历史清空             | 可替换为 Redis/数据库后端  |
| token 估算精度 | length / 4 仅近似          | 双层裁剪（预检 + 链内）    |
| 工具调用历史   | 仅自动追踪 human/AI 消息对 | 通过 finalInput 注入上下文 |
| 成本计算       | totalCost 固定为 0         | 预留接口，后续可接入       |

---

## 扩展：替换存储后端

### 短期记忆持久化

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
}
```

### 长期记忆向量数据库

可以替换为其他向量数据库：

```typescript
// Pinecone
import { Pinecone } from '@pinecone-database/pinecone';

// Weaviate
import { WeaviateClient } from 'weaviate-client';

// 只需实现相同的接口
class CustomVectorDB {
  async searchSimilar(embedding: number[], topK: number) { ... }
  async insertVector(data: CreateMemoryInput) { ... }
}
```
