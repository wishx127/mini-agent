# 长期记忆系统架构文档

## 概述

长期记忆系统是 Mini Agent 的核心功能之一，为 AI Agent 提供持久化的记忆能力。通过向量数据库存储和检索记忆，Agent 能够跨会话记住用户的偏好、重要事实和交互经验，从而提供更个性化和连贯的服务。

## 系统架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Controller                            │
│  (编排层 - 协调长期记忆检索、短期记忆、工具调用等)            │
└───────────────┬─────────────────────────┬───────────────────┘
                │                         │
                ▼                         ▼
┌───────────────────────────┐  ┌──────────────────────────┐
│  LongTermMemoryReader    │  │   SessionStore           │
│  (长期记忆读取器)        │  │   (短期记忆 - 会话历史)   │
└───────┬───────────────────┘  └──────────────────────────┘
        │
        ├──────────────────────┬──────────────────────┐
        ▼                      ▼                      ▼
┌──────────────────┐  ┌─────────────────┐  ┌──────────────────┐
│ VectorDatabase   │  │ MemoryExtractor │  │ MemoryJobQueue   │
│ Client           │  │ (LLM 提取器)    │  │ (持久化队列)     │
│ (Supabase)       │  │                 │  │                  │
└──────────────────┘  └─────────────────┘  └──────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────┐
│           Supabase (PostgreSQL + pgvector)           │
│  ┌─────────────────────────────────────────────────┐ │
│  │  memories 表                                     │ │
│  │  - id, type, content, embedding, metadata       │ │
│  │  - session_id, created_at, expires_at           │ │
│  │  - is_active, access_count                      │ │
│  └─────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────┐ │
│  │  向量索引 (ivfflat)                              │ │
│  │  - 支持余弦相似度搜索                            │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 核心组件

#### 1. VectorDatabaseClient

**职责：**

- 管理 Supabase 连接
- 生成文本向量（使用 Qwen text-embedding-v3）
- 执行向量相似度搜索
- 提供 CRUD 操作

**关键特性：**

- **连接池管理**：复用数据库连接，减少开销
- **降级模式**：连接失败时自动降级，不影响主流程
- **重试机制**：连续失败 3 次后标记为失败状态
- **缓存机制**：缓存 embedding 结果 1 小时，避免重复 API 调用

```typescript
// 示例：初始化和搜索
const dbClient = new VectorDatabaseClient({
  supabaseUrl: 'https://your-project.supabase.co',
  supabaseApiKey: 'your-anon-key',
  embeddingApiKey: 'your-dashscope-key',
});

await dbClient.initialize();
const results = await dbClient.searchSimilar(embedding, 5);
```

#### 2. MemoryExtractor

**职责：**

- 从对话中提取潜在记忆
- 使用 LLM 分析对话内容
- 过滤低置信度记忆

**提取流程：**

```
用户消息 + AI 回复 → LLM 分析 → 结构化记忆 → 置信度过滤 → 返回结果
```

**记忆类型：**

- `user_preference`: 用户偏好（如"我喜欢 TypeScript"）
- `fact`: 事实信息（如"我的项目使用 Node.js 18"）
- `experience`: 交互经验（如"上次搜索天气成功"）
- `task`: 任务相关（如"需要部署到生产环境"）
- `context`: 上下文信息（如"当前讨论的是项目架构"）

```typescript
// 示例：提取记忆
const extractor = new MemoryExtractor(llm, {
  confidenceThreshold: 0.7,
  maxExtractionsPerTurn: 3,
});

const result = await extractor.extract(
  '我是一名前端开发者',
  '你好！很高兴认识你，作为一名前端开发者...'
);

// result.memories = [{ type: 'fact', content: 'User is a frontend developer', confidence: 0.9 }]
```

#### 3. LongTermMemoryReader

**职责：**

- 仅负责检索和格式化记忆
- 不做提取和存储（分离关注点）
- 提供记忆上下文格式化

**核心功能：**

| 功能     | 方法                        | 说明                       |
| -------- | --------------------------- | -------------------------- |
| 检索记忆 | `search(query, topK)`       | 基于向量相似度检索         |
| 格式化   | `formatMemoriesForPrompt()` | 格式化为 prompt 注入上下文 |

```typescript
// 示例：检索记忆
const reader = new LongTermMemoryReader(dbClient, {
  enabled: true,
  topK: 5,
});

const results = await reader.search('我喜欢的编程语言');
const context = reader.formatMemoriesForPrompt(results);
// 输出格式：
// 以下是可能与当前对话相关的历史记忆：
// 1. [用户偏好] 我喜欢 TypeScript (相关度: 95%)
// 2. [事实] 用户是前端开发者 (相关度: 87%)
```

#### 4. LongTermMemoryManager

**职责：**

- 协调记忆的完整生命周期
- 管理记忆合并和过期
- 提供记忆检索接口
- 管理持久化队列

**核心功能：**

| 功能     | 方法                     | 说明                           |
| -------- | ------------------------ | ------------------------------ |
| 创建记忆 | `create(input)`          | 存储新记忆并检查合并           |
| 检索记忆 | `search(query, topK)`    | 基于向量相似度检索             |
| 更新记忆 | `update(id, content)`    | 更新内容并重新生成 embedding   |
| 删除记忆 | `delete(id)`             | 软删除（设置 is_active=false） |
| 记忆合并 | `checkAndMergeSimilar()` | 自动合并相似度 > 0.95 的记忆   |
| 过期管理 | `markExpiredMemories()`  | 标记过期记忆为 inactive        |

#### 5. MemoryJobQueue

**职责：**

- 持久化记忆提取任务
- 异步处理记忆存储
- 失败重试机制
- CLI 启动时自动拉起 Worker 消费队列，CLI 退出后 Worker 处理完队列再退出

**配置选项：**

- `queueDir`: 队列文件存储目录
- `queueMaxAttempts`: 最大重试次数（默认 3）
- `queueRetryBackoffMs`: 重试退避时间（默认 30 秒）
- `queuePollIntervalMs`: 队列轮询间隔（默认 10 秒）

## 数据模型

### Memory 表结构

| 字段               | 类型         | 说明               |
| ------------------ | ------------ | ------------------ |
| `id`               | UUID         | 主键               |
| `type`             | VARCHAR(50)  | 记忆类型（带约束） |
| `content`          | TEXT         | 记忆内容           |
| `embedding`        | VECTOR(1024) | 向量表示           |
| `metadata`         | JSONB        | 自定义元数据       |
| `session_id`       | VARCHAR(255) | 关联的会话 ID      |
| `created_at`       | TIMESTAMPTZ  | 创建时间           |
| `last_accessed_at` | TIMESTAMPTZ  | 最后访问时间       |
| `access_count`     | INTEGER      | 访问次数           |
| `expires_at`       | TIMESTAMPTZ  | 过期时间（可选）   |
| `is_active`        | BOOLEAN      | 是否激活           |

### 向量索引

使用 **ivfflat** 索引优化相似度搜索：

```sql
CREATE INDEX memories_embedding_idx
ON memories
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

**索引选择：**

- **ivfflat**: 适合中等规模数据（10万-100万），查询速度快
- **hnsw**: 适合大规模数据（>100万），查询速度更快但构建时间长

## 工作流程

### 1. 记忆检索流程

```
用户输入
    ↓
Controller.execute()
    ↓
LongTermMemoryReader.search(query)
    ↓
VectorDatabaseClient.generateEmbedding(query)
    ↓
Supabase RPC: search_memories(embedding, topK)
    ↓
返回相似记忆列表
    ↓
更新访问记录 (access_count++, last_accessed_at)
    ↓
格式化为 prompt 注入上下文
```

### 2. 记忆存储流程

```
用户消息 + AI 回复
    ↓
MemoryDispatcher 派发任务
    ↓
MemoryJobQueue 持久化任务（可选）
    ↓
MemoryExtractor.extract(userMsg, aiResp)
    ↓
置信度过滤 (threshold >= 0.7)
    ↓
LongTermMemoryManager.create(memory)
    ↓
VectorDatabaseClient.insertVector()
    ↓
检查相似记忆 (similarity > 0.95)
    ↓
合并或独立存储
```

### 3. 记忆合并逻辑

```
新记忆创建后
    ↓
搜索相似记忆 (同类型, top 5)
    ↓
过滤: similarity >= 0.95 且不是自身
    ↓
找到最相似的记忆
    ↓
合并内容: "原内容\n[补充] 新内容"
    ↓
删除新记忆，保留合并后的记忆
```

## 降级策略

长期记忆系统设计了多层降级保护：

### 1. 连接失败降级

```typescript
// VectorDatabaseClient 降级逻辑
if (!this.isAvailable()) {
  console.warn('VectorDatabaseClient 不可用，跳过向量操作');
  return []; // 返回空数组，不影响主流程
}
```

### 2. 检索失败降级

```typescript
// Controller 中的降级处理
try {
  if (this.longTermMemoryReader) {
    const memories = await this.longTermMemoryReader.search(prompt);
    // 使用记忆...
  }
} catch (error) {
  console.warn('长期记忆检索失败，继续使用短期记忆:', error);
  // 降级：使用空记忆继续
}
```

### 3. 提取失败降级

```typescript
// 异步提取记忆，失败不影响响应
private async extractLongTermMemoryAsync(userMessage: string, aiResponse: string) {
  try {
    await this.longTermMemoryManager.extractAndStore(userMessage, aiResponse);
  } catch (error) {
    console.warn('长期记忆提取失败:', error);
    // 不抛出异常，不影响主流程
  }
}
```

## 性能优化

### 1. Embedding 缓存

```typescript
private embeddingCache = new Map<string, EmbeddingCacheItem>();

async generateEmbedding(text: string): Promise<number[]> {
  const cacheKey = this.hashText(text);
  const cached = this.embeddingCache.get(cacheKey);
  // 1 小时内可复用
  if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
    return cached.embedding;
  }
  // 调用 API...
  this.embeddingCache.set(cacheKey, { embedding, timestamp: Date.now() });
  return embedding;
}
```

### 2. 批量操作

```typescript
// 批量生成 embedding
async generateEmbeddings(texts: string[]): Promise<number[][]> {
  // 单次 API 调用处理多个文本
}

// 批量插入向量
async insertVectors(dataArray: CreateMemoryInput[]): Promise<Memory[]>
```

### 3. 索引优化

- 使用 `ivfflat` 或 `hnsw` 索引加速向量搜索
- 为常用过滤字段创建 B-tree 索引（type, session_id, is_active）
- 定期执行 `VACUUM` 和 `ANALYZE` 维护索引性能

### 4. 持久化队列

- 记忆提取任务异步处理，不阻塞主流程
- 支持失败重试，确保数据不丢失
- 可配置队列轮询间隔

## 监控与维护

### 关键指标

| 指标         | 说明                   | 告警阈值 |
| ------------ | ---------------------- | -------- |
| 记忆总数     | memories 表的记录数    | > 100万  |
| 检索延迟     | 向量搜索响应时间       | > 500ms  |
| 提取成功率   | 记忆提取成功比例       | < 80%    |
| 过期记忆比例 | is_active=false 的比例 | > 50%    |

### 维护任务

1. **过期清理**：定时任务自动执行过期记忆清理
2. **索引重建**：数据量增长后重建向量索引
3. **备份策略**：启用 Supabase 自动备份

## 扩展性考虑

### 水平扩展

- **读写分离**：使用 Supabase 读副本分担查询压力
- **分区表**：按时间或类型分区记忆表
- **多租户**：通过 `session_id` 或新增 `tenant_id` 支持多用户

### 功能扩展

1. **记忆重要性评分**：基于访问频率和相关性动态调整
2. **主动回忆**：Agent 主动检索相关记忆辅助决策
3. **记忆遗忘**：实现艾宾浩斯遗忘曲线，自动淡出低价值记忆
4. **多模态记忆**：支持图片、音频等非文本记忆

## 安全考虑

1. **API Key 保护**：敏感信息存储在 `.env`，不提交到版本控制
2. **Row Level Security**：启用 RLS 保护用户数据隔离
3. **输入验证**：验证记忆类型和内容长度
4. **SQL 注入防护**：使用参数化查询和 Supabase SDK

## 文件结构

```
src/
├── types/
│   └── memory.ts                              # 记忆相关类型定义
├── agent/
│   ├── controller.ts                          # 主控制器
│   └── memory/
│       ├── index.ts                           # 导出入口
│       ├── vector-database-client.ts          # 向量数据库客户端
│       ├── memory-extractor.ts                # 记忆提取器
│       ├── long-term-memory-manager.ts        # 长期记忆管理器
│       ├── long-term-memory-reader.ts         # 长期记忆读取器
│       ├── memory-dispatcher.ts               # 记忆派发器
│       ├── memory-job-queue.ts                # 持久化队列
│       ├── session-store.ts                   # 会话存储
│       ├── cost-tracker.ts                    # 成本追踪
│       ├── token-manager.ts                   # Token 管理
│       └── *.test.ts                          # 测试文件
sql/
└── memories_schema.sql                        # 数据库表结构
```

## 参考资料

- [Supabase pgvector 文档](https://supabase.com/docs/guides/database/extensions/pgvector)
- [LangChain Memory 模块](https://js.langchain.com/docs/modules/memory/)
- [Qwen Embedding API](https://help.aliyun.com/zh/dashscope/developer-reference/text-embedding-api-details)
