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
├── token-manager.ts                # estimateTokenCount + createTrimmer + 预检（支持 CJK）
├── cost-tracker.ts                 # CostTracker：Token 消耗统计 + 成本计算
├── vector-database-client.ts        # 向量数据库客户端（Supabase + pgvector）
├── memory-extractor.ts             # 记忆提取器（LLM 驱动 + 置信度过滤）
├── long-term-memory-manager.ts     # 长期记忆管理器（CRUD + 队列消费 + 记忆合并）
├── long-term-memory-reader.ts      # 长期记忆读取器（检索 + 格式化）
├── memory-dispatcher.ts            # 记忆派发器（入队协调）
└── memory-job-queue.ts             # 持久化队列（异步任务处理 + 失败重试）
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

快速估算单段文本的 token 数量，支持 CJK 字符精确估算：

- 中文字符（含全角标点）：1 字 ≈ 1 token
- 其他字符（英文、数字等）：4 字符 ≈ 1 token

```typescript
import { estimateTokenCount } from './memory/index.js';

estimateTokenCount('Hello, world!'); // 4
estimateTokenCount('你好世界'); // 4（每个中文字符算 1 token）
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

从 LLM 响应的 `usageMetadata` 读取并累计 token 消耗，支持成本计算。

```typescript
import { CostTracker } from './memory/index.js';

const tracker = new CostTracker();

// 记录一次 LLM 调用的 token 消耗（会自动计算成本）
tracker.record(response.usageMetadata, 'gpt-4o');

// 获取累计统计
const summary = tracker.getSummary();
// {
//   totalInputTokens: 5000,
//   totalOutputTokens: 2000,
//   totalTokens: 7000,
//   totalCost: 0.15,         // 根据模型单价计算
//   totalInputCost: 0.05,
//   totalOutputCost: 0.10,
//   currency: 'USD',
//   requestCount: 10
// }

// 获取所有记录
const records = tracker.getRecords();

// 获取最近 5 条记录
const recent = tracker.getRecentRecords(5);

// 重置统计
tracker.reset();
```

---

## 长期记忆（跨会话）

长期记忆通过向量数据库实现跨会话的持久化记忆，记住用户的偏好、背景和重要事实。

### Worker 生命周期

长期记忆 Worker 负责消费持久化队列：

- `LongTermMemoryManager` 可通过 `startQueueConsumer(pollIntervalMs)` 启动队列消费器
- Worker 定时轮询队列，处理记忆提取和存储任务
- 支持失败重试（指数退避）和死信队列（failed 目录）
- 调用 `shutdown()` 可优雅停止 Worker

### 核心组件

#### VectorDatabaseClient

- 管理 Supabase 连接
- 生成文本向量（Qwen text-embedding-v3，1024 维）
- 向量相似度搜索
- 失败降级和缓存机制
- 支持 RPC 搜索和降级查询

```typescript
import { VectorDatabaseClient } from './memory/index.js';

const dbClient = new VectorDatabaseClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseApiKey: process.env.SUPABASE_API_KEY!,
  embeddingApiKey: process.env.EMBEDDING_API_KEY!,
  tableName: 'memories',
  embeddingDimension: 1024,
});

// 初始化连接
await dbClient.initialize();

// 生成文本向量
const embedding = await dbClient.generateEmbedding('用户喜欢 TypeScript');

// 搜索相似向量
const results = await dbClient.searchSimilar(embedding, 5);

// 带过滤条件的搜索
const filteredResults = await dbClient.searchSimilar(embedding, 5, {
  type: 'user_preference',
  sessionId: 'session-123',
});

// 插入向量
const memory = await dbClient.insertVector({
  type: 'user_preference',
  content: '用户喜欢深色主题',
  sessionId: 'session-123',
});

// 更新向量
await dbClient.updateVector(memoryId, { content: '新内容' });

// 软删除
await dbClient.deleteVector(memoryId);

// 硬删除
await dbClient.hardDeleteVector(memoryId);

// 更新访问记录
await dbClient.updateAccessRecord(memoryId);

// 获取连接状态
const state = dbClient.getState(); // 'connected' | 'degraded' | 'failed'

// 检查可用性
const available = dbClient.isAvailable();

// 断开连接
dbClient.disconnect();
```

#### LongTermMemoryManager

长期记忆管理器，负责记忆的完整生命周期管理（CRUD、提取、合并、队列消费）。

```typescript
import { LongTermMemoryManager } from './memory/index.js';

const manager = new LongTermMemoryManager(dbClient, llm, {
  enabled: true,
  topK: 5,
  extractionThreshold: 0.7,
  maxExtractionsPerTurn: 3,
  mergeSimilarityThreshold: 0.85,
  defaultExpirationMs: 30 * 24 * 60 * 60 * 1000, // 30天
  queueWorkerEnabled: true,
  queuePollIntervalMs: 2000,
  queueMaxAttempts: 3,
  queueRetryBackoffMs: 30000,
});

// 初始化（连接数据库并启动队列消费器）
await manager.initialize();

// 创建记忆
const memory = await manager.create({
  type: 'user_preference',
  content: '用户喜欢 TypeScript',
  sessionId: 'session-123',
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
});

// 搜索记忆
const results = await manager.search('用户偏好', 5);

// 按类型查询
const preferences = await manager.getByType('user_preference', 10);

// 按会话查询
const sessionMemories = await manager.getBySession('session-123', 10);

// 更新记忆
await manager.update(memoryId, '更新后的内容');

// 更新元数据
await manager.updateMetadata(memoryId, { key: 'value' });

// 删除记忆
await manager.delete(memoryId);

// 从对话中提取并存储记忆
const result = await manager.extractAndStore(
  '用户消息',
  'AI 回复',
  'session-123'
);

// 将提取任务入队（异步处理）
await manager.enqueueExtraction('用户消息', 'AI 回复', 'session-123');

// 获取待处理任务数量
const pendingCount = await manager.getPendingJobCount();

// 获取统计信息
const stats = manager.getStats();

// 启动队列消费器
manager.startQueueConsumer(2000);

// 关闭管理器
manager.shutdown();
```

#### LongTermMemoryReader

仅负责检索和格式化，不执行存储操作。

```typescript
const reader = new LongTermMemoryReader(dbClient, {
  enabled: true,
  topK: 5,
});

// 初始化连接
await reader.initialize();

// 搜索相关记忆
const results = await reader.search('用户偏好');

// 格式化为 prompt 文本
const context = reader.formatMemoriesForPrompt(results);
// 输出:
// 以下是可能与当前对话相关的历史记忆：
// 1. [用户偏好] 用户喜欢深色主题 (相关度: 95%)

// 关闭连接
reader.shutdown();
```

#### MemoryExtractor

LLM 驱动的记忆提取器，从对话中提取结构化记忆。

```typescript
import { MemoryExtractor } from './memory/index.js';

const extractor = new MemoryExtractor(llm, {
  confidenceThreshold: 0.7,
  maxExtractionsPerTurn: 3,
});

// 从对话中提取记忆
const result = await extractor.extract('用户消息', 'AI 回复');
// {
//   memories: [
//     { type: 'user_preference', content: '用户喜欢 TypeScript', confidence: 0.9, reasoning: '...' }
//   ],
//   success: true
// }
```

#### MemoryDispatcher

协调记忆提取任务的派发，将任务持久化到队列。

```typescript
const dispatcher = new MemoryDispatcher({ enabled: true });
await dispatcher.enqueue({
  userMessage: '用户消息',
  aiResponse: 'AI 回复',
  sessionId: 'session-123',
});
```

#### MemoryJobQueue

持久化队列，用于异步处理记忆存储任务，支持失败重试和指数退避。

```typescript
const queue = new MemoryJobQueue('/path/to/queue');

// 初始化队列目录
await queue.initialize();

// 添加任务到队列
const jobId = await queue.enqueue({ userMessage, aiResponse, sessionId });

// 获取待处理任务（移动到 processing 目录）
const jobs = await queue.take(1);

// 确认任务完成（删除 processing 中的文件）
await queue.ack(job);

// 任务失败时重试或移入失败队列
await queue.retryOrFail(job, error, maxAttempts, backoffMs);

// 获取待处理任务数量
const pendingCount = await queue.getPendingCount();
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
    maxTokens: 4000,
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

// 获取长期记忆读取器
const reader = controller.getLongTermMemoryReader();

// 获取记忆派发器
const dispatcher = controller.getMemoryDispatcher();
```

### 短期记忆流程

1. 加载会话历史（`SessionStore.getOrCreate`）
2. ExecutionEngine 执行对话流程
3. 手动保存用户消息和 AI 响应到会话历史
4. 记录 token 消耗

### 长期记忆流程

1. 检索相关记忆（`LongTermMemoryReader.search`）
2. 格式化记忆上下文
3. 注入 ExecutionEngine 配置
4. 异步派发存储任务（`MemoryDispatcher.enqueue`）
5. 持久化队列处理（`MemoryJobQueue`）

---

## Token 预检流程

Token 管理通过 `ExecutionEngine` 内部处理：

1. **加载当前历史**：从 `SessionStore` 获取历史消息
2. **ExecutionEngine 内部处理**：引擎负责 token 估算和裁剪
3. **链内兜底**：`createTrimmer` 作为 Runnable 链的一个步骤，提供第二层保护

手动检查 token 状态：

```typescript
const status = controller.checkTokenLimit([
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi there!' },
]);
// { total, limit, percentage, exceeded, nearThreshold }
```

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

| 限制           | 说明                       | 缓解措施                      |
| -------------- | -------------------------- | ----------------------------- |
| 进程内存储     | 重启后历史清空             | 可替换为 Redis/数据库后端     |
| token 估算精度 | CJK 字符估算仍有误差       | 双层裁剪（预检 + 链内）       |
| 工具调用历史   | 仅自动追踪 human/AI 消息对 | 通过 ExecutionEngine 管理     |
| 向量数据库依赖 | 需要 Supabase + pgvector   | 提供降级机制（degraded 模式） |

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
