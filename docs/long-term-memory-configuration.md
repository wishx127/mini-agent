# 长期记忆配置说明文档

## 配置概览

长期记忆系统的配置分为三个部分：

1. **环境变量配置**：数据库连接和 API 密钥
2. **控制器配置**：记忆行为参数
3. **向量数据库配置**：Supabase 和 Embedding 配置

## 环境变量配置

### .env 文件模板

```env
# ============================================
# 模型配置（必填）
# ============================================
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-3.5-turbo
MODEL_API_KEY=your-model-api-key
MODEL_TEMPERATURE=0.7
MODEL_MAX_TOKENS=2048

# ============================================
# Supabase 配置（长期记忆必填）
# ============================================
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_API_KEY=your-supabase-anon-key

# ============================================
# Embedding API 配置（长期记忆必填）
# ============================================
# 使用阿里云 DashScope API (Qwen text-embedding-v3)
EMBEDDING_API_KEY=your-dashscope-api-key

# ============================================
# 长期记忆配置（可选）
# ============================================
# 是否启用长期记忆（默认 true）
LONG_TERM_MEMORY_ENABLED=true
# 检索记忆数量（默认 5）
LONG_TERM_MEMORY_TOP_K=5
# 记忆提取置信度阈值（默认 0.7）
MEMORY_EXTRACTION_THRESHOLD=0.7
# 记忆默认过期时间（毫秒，默认 30 天）
MEMORY_DEFAULT_EXPIRATION_MS=2592000000
# 记忆合并相似度阈值（默认 0.95）
MEMORY_MERGE_THRESHOLD=0.95
# 每次提取的最大记忆数（默认 3）
MEMORY_MAX_EXTRACTIONS_PER_TURN=3

# ============================================
# 工具配置（可选）
# ============================================
DISABLED_TOOLS=tavily
TAVILY_API_KEY=your-tavily-api-key

# ============================================
# 编排层配置（可选）
# ============================================
ORCHESTRATION_MAX_ITERATIONS=3
ORCHESTRATION_TIMEOUT=30000
ORCHESTRATION_TOKEN_THRESHOLD=0.9
ORCHESTRATION_TOOL_TIMEOUT=10000
ORCHESTRATION_MAX_RESULT_LENGTH=4000
```

## 获取配置值

### 1. Supabase 配置

#### 创建 Supabase 项目

1. 访问 [Supabase](https://supabase.com)
2. 点击 "New Project"
3. 填写项目信息并创建

#### 获取 URL 和 API Key

1. 进入项目仪表板
2. 点击 "Settings" → "API"
3. 复制以下值：
   - **Project URL** → `SUPABASE_URL`
   - **anon public** → `SUPABASE_API_KEY`

#### 创建数据库表

在 SQL Editor 中执行 `sql/memories_schema.sql` 脚本。

### 2. Embedding API 配置

#### 获取阿里云 DashScope API Key

1. 访问 [阿里云 DashScope](https://dashscope.console.aliyun.com/)
2. 开通服务并创建 API Key
3. 复制 API Key → `EMBEDDING_API_KEY`

**注意：**

- Qwen text-embedding-v3 模型默认输出 1024 维向量
- 与数据库 `VECTOR(1024)` 类型匹配

### 3. 模型配置

根据使用的模型提供商配置：

#### OpenAI

```env
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-3.5-turbo
MODEL_API_KEY=your-openai-api-key
```

#### Azure OpenAI

```env
MODEL_BASE_URL=https://your-resource.openai.azure.com
MODEL_NAME=gpt-35-turbo
MODEL_API_KEY=your-azure-api-key
```

#### 其他兼容 API

```env
MODEL_BASE_URL=https://your-api-endpoint.com/v1
MODEL_NAME=your-model-name
MODEL_API_KEY=your-api-key
```

## 控制器配置

### 配置接口

```typescript
interface ControlConfig {
  // 长期记忆配置
  enableLongTermMemory: boolean; // 是否启用长期记忆
  longTermMemoryTopK: number; // 检索记忆数量
  memoryExtractionThreshold: number; // 提取置信度阈值

  // 编排层配置
  maxTokens: number; // 最大 token 数
  maxIterations: number; // 最大迭代次数
  timeout: number; // 超时时间（ms）
  tokenThreshold: number; // token 阈值
}
```

### 默认值

```typescript
const DEFAULT_CONTROL_CONFIG: ControlConfig = {
  enableLongTermMemory: true,
  longTermMemoryTopK: 5,
  memoryExtractionThreshold: 0.7,
  maxTokens: 4096,
  maxIterations: 3,
  timeout: 30000,
  tokenThreshold: 0.9,
};
```

### 使用示例

```typescript
import { Controller } from './agent/controller.js';

const controller = new Controller(
  llm,
  toolRegistry,
  {
    // 启用长期记忆
    enableLongTermMemory: true,
    // 检索更多记忆
    longTermMemoryTopK: 10,
    // 更严格的提取
    memoryExtractionThreshold: 0.8,
    // 其他配置...
    maxTokens: 8192,
    timeout: 60000,
  },
  vectorDbConfig
);
```

## 向量数据库配置

### 配置接口

```typescript
interface VectorDatabaseConfig {
  supabaseUrl: string; // Supabase 项目 URL
  supabaseKey: string; // Supabase anon key
  embeddingApiKey: string; // Embedding API key
}
```

### 使用示例

```typescript
import { VectorDatabaseClient } from './agent/memory/vector-database-client.js';

const dbClient = new VectorDatabaseClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_API_KEY!,
  embeddingApiKey: process.env.EMBEDDING_API_KEY!,
});
```

## 长期记忆详细配置

### 启用/禁用长期记忆

```typescript
// 启用（需要提供 vectorDbConfig）
new Controller(
  llm,
  toolRegistry,
  {
    enableLongTermMemory: true,
  },
  vectorDbConfig
);

// 禁用
new Controller(llm, toolRegistry, {
  enableLongTermMemory: false,
});
```

### 检索数量配置 (longTermMemoryTopK)

**作用：** 控制每次对话检索多少条相关记忆

**建议值：**

- **对话场景**：3-5（减少上下文长度）
- **知识密集场景**：8-10（提供更多背景）
- **节省 token**：2-3（最小化成本）

```typescript
// 检索更多记忆
new Controller(llm, toolRegistry, {
  longTermMemoryTopK: 10,
});

// 减少记忆数量
new Controller(llm, toolRegistry, {
  longTermMemoryTopK: 3,
});
```

### 提取阈值配置 (memoryExtractionThreshold)

**作用：** 控制哪些对话会被提取为记忆

**建议值：**

- **精准提取**：0.8-0.9（只提取高质量记忆）
- **标准提取**：0.6-0.7（平衡质量和数量）
- **宽松提取**：0.4-0.5（提取更多记忆，可能包含噪音）

```typescript
// 精准提取
new Controller(llm, toolRegistry, {
  memoryExtractionThreshold: 0.85,
});

// 宽松提取
new Controller(llm, toolRegistry, {
  memoryExtractionThreshold: 0.5,
});
```

### 记忆过期配置

**通过环境变量设置默认过期时间：**

```env
# 7 天过期
MEMORY_DEFAULT_EXPIRATION_MS=604800000

# 30 天过期（默认）
MEMORY_DEFAULT_EXPIRATION_MS=2592000000

# 永不过期（不设置或设为 0）
MEMORY_DEFAULT_EXPIRATION_MS=0
```

**手动设置单个记忆过期时间：**

```typescript
const manager = controller.getLongTermMemoryManager();
await manager.create({
  type: 'task',
  content: '临时任务：完成代码审查',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 天后过期
});
```

### 记忆合并配置

```env
# 相似度阈值（默认 0.95）
MEMORY_MERGE_THRESHOLD=0.95

# 每次最大提取数（默认 3）
MEMORY_MAX_EXTRACTIONS_PER_TURN=3
```

## 配置最佳实践

### 1. 开发环境配置

```env
# 开发环境：启用调试，宽松阈值
MODEL_NAME=gpt-3.5-turbo
LONG_TERM_MEMORY_ENABLED=true
LONG_TERM_MEMORY_TOP_K=5
MEMORY_EXTRACTION_THRESHOLD=0.6
MEMORY_DEFAULT_EXPIRATION_MS=604800000  # 7 天
```

### 2. 生产环境配置

```env
# 生产环境：更严格的配置
MODEL_NAME=gpt-4
LONG_TERM_MEMORY_ENABLED=true
LONG_TERM_MEMORY_TOP_K=5
MEMORY_EXTRACTION_THRESHOLD=0.75
MEMORY_DEFAULT_EXPIRATION_MS=2592000000  # 30 天
MEMORY_MERGE_THRESHOLD=0.95
```

### 3. 成本优化配置

```env
# 成本优化：减少 token 消耗
MODEL_NAME=gpt-3.5-turbo
LONG_TERM_MEMORY_TOP_K=3
MEMORY_EXTRACTION_THRESHOLD=0.8
MEMORY_MAX_EXTRACTIONS_PER_TURN=2
```

### 4. 知识密集场景配置

```env
# 知识密集：提取更多记忆
LONG_TERM_MEMORY_TOP_K=10
MEMORY_EXTRACTION_THRESHOLD=0.6
MEMORY_MAX_EXTRACTIONS_PER_TURN=5
MEMORY_DEFAULT_EXPIRATION_MS=0  # 永不过期
```

## 配置验证

### 自动验证

Controller 会在初始化时验证配置：

```typescript
// 无效配置示例
new Controller(llm, toolRegistry, {
  maxTokens: -1, // 会警告并使用默认值
  maxIterations: 0, // 会警告并使用默认值
  timeout: -100, // 会警告并使用默认值
});

// 控制台输出：
// ⚠️ [Controller] maxTokens 必须大于 0，使用默认值
// ⚠️ [Controller] maxIterations 必须大于 0，使用默认值
// ⚠️ [Controller] timeout 必须大于 0，使用默认值
```

### 手动验证

```typescript
// 检查长期记忆管理器是否初始化
const manager = controller.getLongTermMemoryManager();
if (!manager) {
  console.log('长期记忆未启用或初始化失败');
}

// 检查数据库连接
const dbClient = new VectorDatabaseClient(config);
const isHealthy = await dbClient.healthCheck();
if (!isHealthy) {
  console.log('数据库连接失败');
}
```

## 环境变量优先级

配置加载顺序（后者覆盖前者）：

1. 默认值（代码中定义）
2. `.env` 文件
3. 系统环境变量
4. 构造函数参数

```typescript
// 示例：构造函数参数优先级最高
new Controller(llm, toolRegistry, {
  longTermMemoryTopK: 10, // 覆盖 .env 中的值
});
```

## 故障排查

### 配置未生效

1. 检查 `.env` 文件是否在项目根目录
2. 确认环境变量名称拼写正确
3. 重启应用以加载新配置

### 长期记忆不工作

1. 确认 `SUPABASE_URL` 和 `SUPABASE_API_KEY` 已设置
2. 确认 `EMBEDDING_API_KEY` 已设置
3. 确认 `enableLongTermMemory` 为 `true`
4. 检查数据库表是否创建成功

### 性能问题

1. 减少 `LONG_TERM_MEMORY_TOP_K` 值
2. 增加 `MEMORY_EXTRACTION_THRESHOLD` 减少提取
3. 优化数据库索引（见 SQL schema）
4. 检查网络延迟

## 配置示例文件

参见项目根目录的 `.env.example` 文件。
