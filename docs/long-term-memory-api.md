# 长期记忆 API 使用文档

## 快速开始

### 1. 配置环境变量

在项目根目录创建 `.env` 文件：

```env
# Supabase 配置
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_API_KEY=your-supabase-anon-key

# Embedding API 配置
EMBEDDING_API_KEY=your-dashscope-api-key

# 模型配置
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-3.5-turbo
MODEL_API_KEY=your-model-api-key
```

### 2. 初始化 Controller

```typescript
import { Controller } from './agent/controller.js';
import { ToolRegistry } from './tools/index.js';
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({
  configuration: {
    baseURL: process.env.MODEL_BASE_URL,
  },
  modelName: process.env.MODEL_NAME,
  openAIApiKey: process.env.MODEL_API_KEY,
});

const toolRegistry = new ToolRegistry();

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
```

### 3. 基本使用

```typescript
// 执行对话（自动检索长期记忆）
const response = await controller.execute('我是一名前端开发者，喜欢用 React');
console.log(response);

// 继续对话（会记住之前的偏好）
const response2 = await controller.execute('给我推荐一些技术栈');
// Agent 会基于之前的记忆推荐 React 相关的技术栈
```

## API 参考

### Controller

#### 构造函数

```typescript
constructor(
  llm: ChatOpenAI,
  toolRegistry: ToolRegistry,
  config?: Partial<ControlConfig>,
  vectorDbConfig?: VectorDatabaseConfig
)
```

**参数：**

- `llm`: LangChain ChatOpenAI 实例
- `toolRegistry`: 工具注册表实例
- `config`: 控制器配置（可选）
- `vectorDbConfig`: 向量数据库配置（可选）

**ControlConfig 接口：**

```typescript
interface ControlConfig {
  enableLongTermMemory: boolean;
  longTermMemoryTopK: number;
  memoryExtractionThreshold: number;
  maxTokens: number;
  maxIterations: number;
  timeout: number;
  tokenThreshold: number;
}
```

#### execute(prompt: string): Promise<string>

执行对话并自动管理长期记忆。

**参数：**

- `prompt`: 用户输入

**返回：**

- AI 响应字符串

**示例：**

```typescript
const response = await controller.execute('我喜欢使用 TypeScript');
```

### VectorDatabaseClient

底层向量数据库客户端。

#### 构造函数

```typescript
constructor(config: VectorDatabaseConfig)
```

**VectorDatabaseConfig 接口：**

```typescript
interface VectorDatabaseConfig {
  supabaseUrl: string;
  supabaseApiKey: string;
  tableName?: string;
  embeddingDimension?: number;
  embeddingApiUrl?: string;
  embeddingModel?: string;
  embeddingApiKey?: string;
}
```

#### initialize(): Promise<boolean>

初始化数据库连接。

```typescript
const dbClient = new VectorDatabaseClient(config);
const connected = await dbClient.initialize();
```

#### generateEmbedding(text: string): Promise<number[] | null>

生成文本的向量表示。

```typescript
const embedding = await dbClient.generateEmbedding('这是一个测试文本');
// 返回 1024 维向量数组
```

#### searchSimilar(queryEmbedding: number[], topK: number, filters?: SearchFilters): Promise<MemorySearchResult[]>

执行向量相似度搜索。

```typescript
const results = await dbClient.searchSimilar(embedding, 5, {
  type: 'user_preference',
  sessionId: 'session-123',
});
```

#### isAvailable(): boolean

检查客户端是否可用。

```typescript
if (dbClient.isAvailable()) {
  const results = await dbClient.searchSimilar(embedding, 5);
}
```

#### healthCheck(): Promise<boolean>

检查数据库连接状态。

```typescript
const isHealthy = await dbClient.healthCheck();
```

### LongTermMemoryReader

长期记忆读取器，负责检索和格式化。

#### 构造函数

```typescript
constructor(
  dbClient: VectorDatabaseClient,
  config?: Partial<LongTermMemoryConfig>
)
```

#### search(query: string, topK?: number): Promise<MemorySearchResult[]>

基于查询文本检索相关记忆。

**参数：**

- `query`: 查询文本
- `topK`: 返回数量（默认使用配置值）

**返回：**

```typescript
interface MemorySearchResult {
  memory: Memory;
  similarity: number; // 相似度 0-1
}
```

**示例：**

```typescript
const results = await reader.search('编辑器偏好', 10);
for (const result of results) {
  console.log(`内容: ${result.memory.content}`);
  console.log(`相似度: ${(result.similarity * 100).toFixed(2)}%`);
}
```

#### formatMemoriesForPrompt(results: MemorySearchResult[]): string

格式化记忆为 prompt 上下文。

```typescript
const results = await reader.search('查询内容', 5);
const context = reader.formatMemoriesForPrompt(results);
// 输出:
// 以下是可能与当前对话相关的历史记忆：
// 1. [用户偏好] 用户喜欢深色主题 (相关度: 95%)
// 2. [事实] 用户是前端开发者 (相关度: 87%)
```

### LongTermMemoryManager

#### 构造函数

```typescript
constructor(
  dbClient: VectorDatabaseClient,
  llm: ChatOpenAI,
  config?: Partial<LongTermMemoryConfig>
)
```

#### create(input: CreateMemoryInput): Promise<Memory | null>

手动创建新记忆。

**参数：**

```typescript
interface CreateMemoryInput {
  type: MemoryType;
  content: string;
  metadata?: MemoryMetadata;
  sessionId?: string;
  expiresAt?: Date;
}
```

**示例：**

```typescript
const memory = await manager.create({
  type: 'user_preference',
  content: 'User prefers dark mode in the editor',
  metadata: {
    source: 'explicit',
    importance: 'high',
  },
  sessionId: 'session-123',
});
```

#### search(query: string, topK?: number): Promise<MemorySearchResult[]>

基于查询文本检索相关记忆。

#### update(memoryId: string, newContent: string): Promise<boolean>

更新记忆内容（自动重新生成 embedding）。

```typescript
const success = await manager.update(
  'memory-uuid',
  'User prefers dark mode and monospace font'
);
```

#### updateMetadata(memoryId: string, metadata: Record<string, unknown>): Promise<boolean>

更新记忆元数据（合并现有元数据）。

```typescript
await manager.updateMetadata('memory-uuid', {
  importance: 'high',
  lastConfirmed: new Date().toISOString(),
});
```

#### delete(memoryId: string): Promise<boolean>

软删除记忆（设置 `is_active = false`）。

```typescript
await manager.delete('memory-uuid');
```

#### getByType(type: MemoryType, limit?: number): Promise<Memory[]>

按类型查询记忆。

```typescript
const preferences = await manager.getByType('user_preference', 10);
```

#### getBySession(sessionId: string, limit?: number): Promise<Memory[]>

按会话查询记忆。

```typescript
const sessionMemories = await manager.getBySession('session-123');
```

#### getStats(): Promise<MemoryStats>

获取记忆统计信息。

**返回：**

```typescript
interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  active: number;
  expired: number;
}
```

#### extractAndStore(userMessage: string, aiResponse: string, sessionId?: string): Promise<MemoryExtractionResult>

从对话中提取并存储记忆。

```typescript
const result = await manager.extractAndStore(
  '我是一名 Python 开发者',
  '你好！很高兴认识你...',
  'session-123'
);
```

### MemoryExtractor

记忆提取器，从对话中提取潜在记忆。

#### 构造函数

```typescript
constructor(
  llm: ChatOpenAI,
  config?: Partial<MemoryExtractorConfig>
)
```

**MemoryExtractorConfig 接口：**

```typescript
interface MemoryExtractorConfig {
  confidenceThreshold: number;
  maxExtractionsPerTurn: number;
  extractionPrompt?: string;
}
```

#### extract(userMessage: string, aiResponse: string): Promise<MemoryExtractionResult>

从对话中提取记忆。

```typescript
const result = await extractor.extract(
  '我是一名前端开发者',
  '你好！很高兴认识你...'
);

// result.memories = [
//   { type: 'fact', content: 'User is a frontend developer', confidence: 0.9 }
// ]
```

### MemoryDispatcher

记忆派发器，协调记忆存储流程。

#### 构造函数

```typescript
constructor(config?: { enabled?: boolean })
```

#### dispatch(userMessage: string, aiResponse: string, sessionId?: string): Promise<void>

派发记忆提取任务。

```typescript
const dispatcher = new MemoryDispatcher({ enabled: true });
await dispatcher.dispatch('用户消息', 'AI 回复', 'session-123');
```

## 记忆类型

系统支持以下记忆类型：

| 类型     | 值                | 说明                     | 示例                                                  |
| -------- | ----------------- | ------------------------ | ----------------------------------------------------- |
| 用户偏好 | `user_preference` | 用户的偏好和喜好         | "User prefers TypeScript over JavaScript"             |
| 事实     | `fact`            | 关于用户或环境的事实信息 | "User's project uses Node.js 18"                      |
| 经验     | `experience`      | 交互历史中的重要经验     | "Weather search tool returned good results last time" |
| 任务     | `task`            | 待办或进行中的任务       | "User needs to deploy to production"                  |
| 上下文   | `context`         | 当前对话的上下文信息     | "Currently discussing project architecture"           |

## 记忆元数据结构

```typescript
interface MemoryMetadata {
  sourceSessionId?: string;
  confidence?: number;
  tags?: string[];
  [key: string]: unknown;
}
```

## 记忆搜索结果

```typescript
interface MemorySearchResult {
  memory: Memory;
  similarity: number;
}

interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  embedding?: number[];
  metadata: MemoryMetadata;
  sessionId?: string;
  createdAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  expiresAt?: Date;
  isActive: boolean;
}
```

## 使用场景

### 1. 记住用户偏好

```typescript
// 第一次对话
await controller.execute('我喜欢使用深色主题');

// 后续对话（会记住偏好）
await controller.execute('给我推荐一些开发工具');
// Agent 可能会推荐支持深色主题的工具
```

### 2. 记住用户背景

```typescript
await controller.execute('我是一名前端开发者，主要使用 React 和 TypeScript');

// 后续对话会基于这个背景
await controller.execute('给我推荐一些学习资源');
// Agent 会推荐前端相关的资源
```

### 3. 记住项目上下文

```typescript
await controller.execute('我的项目是一个电商网站，使用 Next.js 开发');

// 后续对话
await controller.execute('如何优化性能？');
// Agent 会针对电商网站和 Next.js 提供优化建议
```

## 高级用法

### 1. 手动检索记忆

```typescript
const reader = controller.longTermMemoryReader;

if (reader) {
  const results = await reader.search('查询内容', 5);
  const context = reader.formatMemoriesForPrompt(results);
}
```

### 2. 手动创建记忆

```typescript
const manager = controller.getLongTermMemoryManager();

if (manager) {
  await manager.create({
    type: 'fact',
    content: 'Project deadline is March 15, 2026',
    metadata: { priority: 'high' },
  });
}
```

### 3. 批量导入历史记忆

```typescript
const manager = controller.getLongTermMemoryManager();

const historicalMemories = [
  { type: 'user_preference', content: 'User prefers minimal UI design' },
  { type: 'fact', content: 'User works in timezone UTC+8' },
  { type: 'experience', content: 'User likes detailed code examples' },
];

for (const mem of historicalMemories) {
  await manager.create(mem);
}
```

### 4. 设置记忆过期时间

```typescript
// 创建临时记忆，30天后过期
await manager.create({
  type: 'task',
  content: 'Review PR #123',
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
});
```

### 5. 按类型检索记忆

```typescript
// 获取所有用户偏好
const preferences = await manager.getByType('user_preference', 20);

// 获取所有任务
const tasks = await manager.getByType('task', 10);
```

## 配置调优

### 记忆检索数量 (longTermMemoryTopK)

- **默认值**: 5
- **建议范围**: 3-10
- **影响**: 值越大，注入上下文的记忆越多，但 token 消耗也越大

```typescript
new Controller(llm, toolRegistry, {
  longTermMemoryTopK: 8,
});
```

### 提取置信度阈值 (memoryExtractionThreshold)

- **默认值**: 0.7
- **建议范围**: 0.5-0.9
- **影响**: 值越高，提取的记忆越准确，但数量越少

```typescript
new Controller(llm, toolRegistry, {
  memoryExtractionThreshold: 0.8,
});
```

### 禁用长期记忆

```typescript
// 方式 1: 配置中禁用
new Controller(llm, toolRegistry, {
  enableLongTermMemory: false,
});

// 方式 2: 不提供向量数据库配置
new Controller(llm, toolRegistry);
```

## 故障排查

### 记忆未被存储

**可能原因：**

1. 置信度低于阈值
2. 提取过程失败
3. 向量数据库连接失败
4. Worker 未运行或队列未被消费

**解决方法：**

```typescript
// 检查读取器状态
if (!controller.longTermMemoryReader) {
  console.log('长期记忆读取器未初始化');
}

// 手动测试检索
const results = await controller.longTermMemoryReader.search('测试');
console.log('检索结果:', results);
```

**排查建议：**

- 查看 `memory-worker.log` 是否有消费日志
- 检查 `~/.mini-agent/memory-queue` 是否有积压任务

### 记忆检索不到

**可能原因：**

1. 相似度太低
2. 记忆已过期或被删除
3. 向量索引问题

**解决方法：**

```typescript
// 增加 topK 值
const results = await reader.search('查询内容', 20);

// 检查数据库连接
const dbClient = await reader.getDbClient();
const isHealthy = await dbClient.healthCheck();
```

### 性能问题

**优化建议：**

1. 减少 `longTermMemoryTopK` 值
2. 使用更高效的向量索引（HNSW）
3. 定期清理过期记忆
4. 启用 embedding 缓存

## 最佳实践

1. **合理设置阈值**：根据场景调整提取和检索阈值
2. **定期清理**：设置合理的过期时间，避免记忆积累过多
3. **监控指标**：定期检查记忆数量和检索性能
4. **降级保护**：确保长期记忆失败时不影响主流程
5. **隐私保护**：敏感信息不要存储在长期记忆中
