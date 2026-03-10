# 长期记忆功能迁移指南

## 概述

本指南帮助您从无长期记忆版本升级到支持长期记忆的版本。迁移过程是**增量式**的，不会影响现有功能。

## 兼容性说明

### 向后兼容

长期记忆功能是**完全可选**的：

- 不提供向量数据库配置时，系统仍然正常工作
- 现有的短期记忆（会话历史）功能不受影响
- 所有现有 API 保持兼容

### 系统要求

| 组件       | 最低版本 | 推荐版本 |
| ---------- | -------- | -------- |
| Node.js    | 18.x     | 20.x     |
| TypeScript | 5.0      | 5.3+     |
| Supabase   | -        | 最新版   |

## 迁移步骤

### 第 1 步：安装依赖

长期记忆功能需要 Supabase 客户端：

```bash
npm install @supabase/supabase-js
```

依赖已包含在 `package.json` 中，执行 `npm install` 即可。

### 第 2 步：创建 Supabase 项目

1. 访问 [Supabase](https://supabase.com) 并登录
2. 点击 "New Project" 创建新项目
3. 记录以下信息：
   - Project URL
   - anon public key

### 第 3 步：创建数据库表

在 Supabase SQL Editor 中执行：

```sql
-- 方式 1：执行完整脚本
-- 复制 sql/memories_schema.sql 的内容并执行

-- 方式 2：最小化脚本（快速开始）
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1024),
  metadata JSONB DEFAULT '{}'::jsonb,
  session_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  access_count INTEGER DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true
);

-- 创建索引
CREATE INDEX IF NOT EXISTS memories_embedding_idx
ON memories
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 添加类型约束
ALTER TABLE memories
ADD CONSTRAINT valid_memory_type
CHECK (type IN ('user_preference', 'fact', 'experience', 'task', 'context'));
```

### 第 4 步：获取 Embedding API Key

长期记忆使用 Qwen text-embedding-v3 模型生成向量：

1. 访问 [阿里云 DashScope](https://dashscope.console.aliyun.com/)
2. 开通服务并创建 API Key
3. 记录 API Key

### 第 5 步：更新环境变量

在 `.env` 文件中添加：

```env
# Supabase 配置
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_API_KEY=your-supabase-anon-key

# Embedding API 配置
EMBEDDING_API_KEY=your-dashscope-api-key

# 长期记忆配置（可选）
LONG_TERM_MEMORY_ENABLED=true
LONG_TERM_MEMORY_TOP_K=5
MEMORY_EXTRACTION_THRESHOLD=0.7
```

### 第 6 步：更新代码

#### 方式 1：自动启用（推荐）

只需提供配置，Controller 会自动初始化长期记忆：

```typescript
import { Controller } from './agent/controller.js';
import { ToolRegistry } from './tools/index.js';
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({
  configuration: { baseURL: process.env.MODEL_BASE_URL },
  modelName: process.env.MODEL_NAME,
  openAIApiKey: process.env.MODEL_API_KEY,
});

const toolRegistry = new ToolRegistry();

// 提供向量数据库配置，自动启用长期记忆
const controller = new Controller(
  llm,
  toolRegistry,
  { enableLongTermMemory: true }, // 配置项
  {
    // 向量数据库配置
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_API_KEY!,
    embeddingApiKey: process.env.EMBEDDING_API_KEY!,
  }
);

// 使用方式不变
const response = await controller.execute('你好');
```

#### 方式 2：保持原有行为（不启用）

不提供向量数据库配置，系统保持原有行为：

```typescript
// 不提供 vectorDbConfig，长期记忆不启用
const controller = new Controller(llm, toolRegistry);

// 或者显式禁用
const controller = new Controller(llm, toolRegistry, {
  enableLongTermMemory: false,
});
```

### 第 7 步：验证迁移

运行测试验证功能正常：

```bash
# 运行长期记忆相关测试
npm test -- --grep "LongTermMemory"

# 运行所有测试
npm test
```

手动测试：

```typescript
// 测试记忆存储
await controller.execute('我喜欢使用 TypeScript');

// 测试记忆检索
const response = await controller.execute('给我推荐一些编程语言');
// 应该基于之前的偏好推荐 TypeScript
```

## 迁移场景

### 场景 1：完全启用长期记忆

```typescript
// 完整配置
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
    supabaseKey: process.env.SUPABASE_API_KEY!,
    embeddingApiKey: process.env.EMBEDDING_API_KEY!,
  }
);
```

### 场景 2：渐进式迁移

先在开发环境测试，再推广到生产：

```typescript
// 根据环境变量决定是否启用
const enableLongTermMemory = process.env.NODE_ENV === 'production';

const controller = new Controller(
  llm,
  toolRegistry,
  { enableLongTermMemory },
  enableLongTermMemory ? vectorDbConfig : undefined
);
```

### 场景 3：部分用户启用

```typescript
// 根据用户配置决定是否启用
function createController(userId: string, userConfig: UserConfig) {
  return new Controller(
    llm,
    toolRegistry,
    { enableLongTermMemory: userConfig.hasLongTermMemory },
    userConfig.hasLongTermMemory
      ? {
          supabaseUrl: process.env.SUPABASE_URL!,
          supabaseKey: process.env.SUPABASE_API_KEY!,
          embeddingApiKey: process.env.EMBEDDING_API_KEY!,
        }
      : undefined
  );
}
```

## 代码变更对照

### Controller 构造函数

**之前：**

```typescript
constructor(
  llm: ChatOpenAI,
  toolRegistry: ToolRegistry,
  config?: Partial<ControlConfig>
)
```

**之后：**

```typescript
constructor(
  llm: ChatOpenAI,
  toolRegistry: ToolRegistry,
  config?: Partial<ControlConfig>,
  vectorDbConfig?: VectorDatabaseConfig  // 新增参数
)
```

**影响：** 无破坏性变更，新参数可选。

### ControlConfig 接口

**之前：**

```typescript
interface ControlConfig {
  maxTokens: number;
  maxIterations: number;
  timeout: number;
  tokenThreshold: number;
}
```

**之后：**

```typescript
interface ControlConfig {
  // 原有配置
  maxTokens: number;
  maxIterations: number;
  timeout: number;
  tokenThreshold: number;

  // 新增配置
  enableLongTermMemory?: boolean;
  longTermMemoryTopK?: number;
  memoryExtractionThreshold?: number;
}
```

**影响：** 新配置项有默认值，无需修改现有代码。

### execute() 方法

**之前和之后：** 签名完全一致

```typescript
async execute(prompt: string): Promise<string>
```

**影响：** 无需修改调用代码。

## 新增文件清单

迁移后项目新增以下文件：

```
src/
├── types/
│   └── memory.ts                              # 记忆相关类型定义
├── agent/
│   └── memory/
│       ├── vector-database-client.ts          # 向量数据库客户端
│       ├── memory-extractor.ts                # 记忆提取器
│       ├── long-term-memory-manager.ts        # 长期记忆管理器
│       ├── vector-database-client.test.ts     # 测试文件
│       ├── memory-extractor.test.ts           # 测试文件
│       └── long-term-memory-manager.test.ts   # 测试文件
sql/
└── memories_schema.sql                        # 数据库表结构
docs/
├── long-term-memory-architecture.md           # 架构文档
├── long-term-memory-api.md                    # API 文档
├── long-term-memory-configuration.md          # 配置文档
└── long-term-memory-migration.md              # 本迁移文档
```

## 回滚方案

如需回滚到无长期记忆版本：

### 方式 1：禁用功能

```typescript
// 不提供向量数据库配置
const controller = new Controller(llm, toolRegistry);

// 或显式禁用
const controller = new Controller(llm, toolRegistry, {
  enableLongTermMemory: false,
});
```

### 方式 2：移除配置

从 `.env` 中移除或注释相关配置：

```env
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_API_KEY=your-supabase-anon-key
# EMBEDDING_API_KEY=your-dashscope-api-key
```

### 方式 3：代码回滚

如果需要完全移除长期记忆功能：

1. 恢复 Controller 构造函数签名
2. 移除新增的类型定义文件
3. 移除 `src/agent/memory/` 下的新增文件
4. 更新依赖：`npm uninstall @supabase/supabase-js`

## 常见问题

### Q1: 迁移后现有对话历史会丢失吗？

**A:** 不会。长期记忆和短期记忆是独立的系统：

- 短期记忆（会话历史）保持不变
- 长期记忆是新增功能
- 两者可以同时使用

### Q2: 迁移会影响性能吗？

**A:** 影响很小：

- 记忆检索：~50-200ms（取决于网络和数据库）
- 记忆提取：异步执行，不阻塞响应
- 可通过配置调整检索数量优化

### Q3: 可以只对部分对话启用长期记忆吗？

**A:** 可以。为每个 Controller 实例独立配置：

```typescript
// 用户 A：启用长期记忆
const controllerA = new Controller(
  llm,
  toolRegistry,
  { enableLongTermMemory: true },
  dbConfig
);

// 用户 B：不启用长期记忆
const controllerB = new Controller(llm, toolRegistry);
```

### Q4: 迁移需要修改现有测试吗？

**A:** 大部分测试无需修改：

- Controller 测试：提供 Mock 配置即可
- 集成测试：可能需要 Mock 向量数据库

### Q5: 如何监控长期记忆使用情况？

**A:** 使用提供的 API：

```typescript
const manager = controller.getLongTermMemoryManager();
if (manager) {
  const stats = await manager.getStats();
  console.log('记忆总数:', stats.total);
  console.log('各类型统计:', stats.byType);
}
```

## 迁移检查清单

- [ ] 已安装 `@supabase/supabase-js` 依赖
- [ ] 已创建 Supabase 项目
- [ ] 已执行 `sql/memories_schema.sql` 创建表结构
- [ ] 已获取 DashScope API Key
- [ ] 已更新 `.env` 文件
- [ ] 已更新 Controller 初始化代码
- [ ] 已运行测试验证功能
- [ ] 已在生产环境配置中启用（可选）

## 获取帮助

- 查看架构文档：`docs/long-term-memory-architecture.md`
- 查看 API 文档：`docs/long-term-memory-api.md`
- 查看配置文档：`docs/long-term-memory-configuration.md`
- Supabase 文档：https://supabase.com/docs
- DashScope 文档：https://help.aliyun.com/zh/dashscope/
