# Mini Agent

一个最小可用的AI Agent，基于Node.js、TypeScript和LangChain构建。支持自定义模型baseURL配置，通过终端命令行与AI进行交互。

## 功能特性

- 🤖 基于LangChain的Agent核心
- 🔧 支持自定义模型baseURL
- 🛠️ 支持工具调用
- 🔍 内置联网搜索
- 💬 交互式命令行对话
- 🧠 跨请求会话记忆 - 基于 `RunnableWithMessageHistory` 的多轮对话上下文保持
- 💾 长期记忆系统 - 基于向量数据库的持久化记忆，支持跨会话记忆用户偏好和重要信息
- 📊 Token 管理 - 自动 token 预检与 `trimMessages` 滑动窗口裁剪
- 📝 环境变量和.env配置文件支持
- 🔒 TypeScript类型安全
- 🛡️ 熔断器保护 - 自动熔断故障工具,防止资源浪费
- 🔌 双格式参数定义 - 同时支持 Zod 和 JSON Schema

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置

#### 方法1：环境变量

复制 `.env.example` 为 `.env` 并修改配置：

```bash
cp .env.example .env
```

然后编辑 `.env` 文件：

```env
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-3.5-turbo
MODEL_API_KEY=your-api-key-here
```

### 工具配置 (可选)

Mini Agent 支持工具调用功能，默认启用Tavily搜索工具。

```env
# 可选：禁用指定工具 (逗号分隔)
DISABLED_TOOLS=tavily

# Tavily搜索工具API Key
TAVILY_API_KEY=your-tavily-api-key
```

### 命令行参数

```bash
# 使用自定义.env配置文件
npm start -- --config ./my-config.env

# 显示帮助信息
npm start -- --help
```

## 配置选项

### 基础配置

| 环境变量            | 默认值                      | 说明             |
| ------------------- | --------------------------- | ---------------- |
| `MODEL_BASE_URL`    | `https://api.openai.com/v1` | 模型API的基础URL |
| `MODEL_NAME`        | `gpt-3.5-turbo`             | 模型名称         |
| `MODEL_API_KEY`     | -                           | API密钥（可选）  |
| `MODEL_TEMPERATURE` | `0.7`                       | 温度参数（0-2）  |
| `MODEL_MAX_TOKENS`  | `2048`                      | 最大token数量    |
| `DISABLED_TOOLS`    | -                           | 禁用的工具列表   |
| `TAVILY_API_KEY`    | -                           | Tavily API密钥   |

### 长期记忆配置

| 环境变量                       | 默认值       | 说明                     |
| ------------------------------ | ------------ | ------------------------ |
| `SUPABASE_URL`                 | -            | Supabase 项目 URL        |
| `SUPABASE_API_KEY`             | -            | Supabase anon key        |
| `EMBEDDING_API_KEY`            | -            | Embedding API 密钥       |
| `LONG_TERM_MEMORY_ENABLED`     | `true`       | 是否启用长期记忆         |
| `LONG_TERM_MEMORY_TOP_K`       | `5`          | 检索记忆数量             |
| `MEMORY_EXTRACTION_THRESHOLD`  | `0.7`        | 记忆提取置信度阈值       |
| `MEMORY_DEFAULT_EXPIRATION_MS` | `2592000000` | 记忆默认过期时间（30天） |

### 长期记忆 Worker（自动）

CLI 启动时会自动拉起长期记忆 Worker，用于异步消费记忆队列：

- CLI 运行期间，Worker 常驻并持续消费队列
- CLI 退出后，Worker 会继续处理队列，**队列清空后自动退出**
- Worker 日志写入 `memory-worker.log`

## 使用示例

### 基础对话

```bash
$ npm run dev
🤖 Agent初始化成功!
📡 模型: gpt-3.5-turbo
🌐 Base URL: https://api.openai.com/v1

💬 输入您的消息开始对话 (输入 "quit" 或 "exit" 退出):

👤 您: 你好，请介绍一下自己
🤖 Agent: 你好！我是一个基于LangChain构建的AI助手...
```

### 长期记忆

启用长期记忆后，Agent 会自动记住用户的偏好和重要信息：

```bash
👤 您: 我是一名前端开发者，喜欢使用 React 和 TypeScript
🤖 Agent: 你好！很高兴认识你，作为一名前端开发者...

👤 您: 给我推荐一些技术栈
🤖 Agent: 基于你的前端开发背景和 React/TypeScript 偏好，我推荐...
# Agent 会记住之前的对话内容，提供个性化推荐

👤 您: (重新启动程序)
👤 您: 我之前说过的技术栈偏好还记得吗？
🤖 Agent: 当然！你之前提到喜欢使用 React 和 TypeScript...
# 即使重启程序，Agent 仍能回忆起之前的对话
```

### 联网搜索

当询问需要实时信息的问题时，Agent会自动使用Tavily搜索工具：

```bash
👤 您: 今天的热搜新闻有哪些
⚡ [Tool Executor] 执行工具: tavily
✅ [Tool Executor] 执行完成 (耗时 1200ms)
🤖 Agent: 今天的热搜新闻包括：...
```

## 高级功能

### 熔断器保护

工具调用失败时,熔断器会自动保护系统:

```
[CircuitBreaker] tavily: CLOSED -> OPEN | Stats: success=0, failures=5
🛡️ [Executor] 熔断器已打开: Circuit breaker is OPEN for tool 'tavily'. Will retry after 30000ms

// 30秒后自动尝试恢复
[CircuitBreaker] tavily: OPEN -> HALF_OPEN
[CircuitBreaker] tavily: HALF_OPEN -> CLOSED
```

### 工具分类

支持5种工具分类,便于管理和查询:

- **INTERNAL**: 内部工具(如计算器、格式转换等)
- **EXTERNAL_API**: 外部API工具(如搜索、翻译等)
- **FILE_SYSTEM**: 文件系统工具(如读写文件)
- **VECTOR_SEARCH**: 向量检索工具(如RAG、语义搜索)
- **SANDBOX**: 代码执行沙箱(如Python执行器)

```typescript
// 获取所有外部API工具
const externalTools = registry.getToolsByCategory('EXTERNAL_API');

// 获取多个分类的工具
const searchTools = registry.getToolsByCategory([
  'EXTERNAL_API',
  'VECTOR_SEARCH',
]);
```

### 双格式参数定义

支持 Zod 和 JSON Schema 两种参数定义方式:

```typescript
// 方式1: Zod (推荐,类型安全)
readonly paramsSchema = z.object({
  query: z.string().describe('搜索查询'),
  limit: z.number().optional()
});

// 方式2: JSON Schema (兼容性更好)
readonly jsonSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '搜索查询' },
    limit: { type: 'number' }
  },
  required: ['query']
};
```

## 项目结构

```
src/
├── agent/           # Agent核心功能
│   ├── controller.ts    # 控制层
│   ├── planner.ts       # 决策层
│   ├── executor.ts      # 执行层
│   └── memory/          # 会话记忆系统
│       ├── index.ts         # 统一导出
│       ├── types.ts         # TokenUsage、CostRecord 等类型
│       ├── session-store.ts # SessionStore（内存会话存储）
│       ├── token-manager.ts # Token 估算、裁剪与预检
│       └── cost-tracker.ts  # Token 消耗统计
├── config/          # 配置管理 (含工具配置)
├── cli/             # 命令行界面
├── types/           # TypeScript类型定义
└── tools/           # 工具系统 (插件化架构)
    ├── base.ts           # 工具基类和注册表
    ├── registry.ts       # 工具注册中心
    ├── loader.ts         # 工具加载器
    ├── circuit-breaker.ts   # 熔断器
    ├── category-registry.ts # 工具分类注册表
    └── plugins/         # 工具插件
        ├── index.ts      # 插件导出
        └── tavily.ts     # Tavily搜索插件
```

## 编排层架构

Mini Agent 采用三层编排架构：Controller（控制层）→ Planner（决策层）→ Executor（执行层）。

```
用户输入 → Controller (控制入口)
                ↓
           Planner (决策)
                ↓
           Executor (执行)
                ↓
           Controller (检查)
                ↓
           最终响应
```

### Controller（控制层）

- **Token 限制检查**: 防止上下文溢出
- **超时控制**: 防止无限等待
- **迭代次数限制**: 防止循环调用
- **兜底策略**: 异常情况下的优雅降级
- **指标追踪**: 记录执行过程

### Planner（决策层）

- **工具判断**: 判断是否需要使用工具
- **工具选择**: 选择最合适的工具
- **执行规划**: 规划工具调用顺序
- **参数验证**: 验证工具参数
- **LLM 决策**: 使用 LLM 进行智能决策
- **规则兜底**: LLM 不可用时的备用方案

### Executor（执行层）

- **工具执行**: 执行工具调用
- **错误处理**: 异常分类和处理
- **重试机制**: 网络错误自动重试（指数退避）
- **结果格式化**: 截断过长结果

### 编排层配置

可在 `.env` 中配置编排层参数：

```env
# 编排层配置
ORCHESTRATION_MAX_ITERATIONS=3
ORCHESTRATION_TIMEOUT=30000
ORCHESTRATION_TOKEN_THRESHOLD=0.9
ORCHESTRATION_TOOL_TIMEOUT=10000
ORCHESTRATION_MAX_RESULT_LENGTH=4000
```

详细配置说明见 [编排层使用指南](docs/orchestration-guide.md)。

## 会话记忆

Mini Agent 支持跨请求的多轮对话记忆。同一进程内，Agent 会自动记住之前的对话内容：

```bash
👤 您: 我叫张三
🤖 Agent: 你好，张三！有什么可以帮你的吗？

👤 您: 我叫什么名字？
🤖 Agent: 你叫张三。
```

记忆系统基于 LangChain `RunnableWithMessageHistory`，包含以下能力：

- **自动历史管理**：无需手动维护对话数组，历史自动读写
- **Token 裁剪**：会话超长时自动裁剪旧消息，保留 system 提示词和最新对话
- **Token 统计**：追踪每次 LLM 调用的 token 消耗

详细设计说明见 [会话记忆系统文档](docs/memory-system.md)。

## 长期记忆

Mini Agent 支持基于向量数据库的长期记忆系统，能够持久化存储用户的偏好、重要事实和交互经验，实现真正的"记忆"能力。

### 快速开始

1. **创建 Supabase 项目**

   访问 [Supabase](https://supabase.com) 创建项目，获取 URL 和 API Key。

2. **执行数据库脚本**

   在 Supabase SQL Editor 中执行 `sql/memories_schema.sql`。

3. **配置环境变量**

   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_API_KEY=your-supabase-anon-key
   EMBEDDING_API_KEY=your-dashscope-api-key
   ```

4. **启动 Agent**

   ```bash
   npm run dev
   ```

### 主要功能

- **自动记忆提取**：从对话中自动提取重要信息存储
- **向量相似度检索**：基于语义理解检索相关记忆
- **记忆合并**：自动合并高度相似的记忆
- **过期管理**：支持设置记忆过期时间
- **降级保护**：数据库不可用时自动降级，不影响主流程
- **异步队列处理**：记忆存储通过持久化队列异步处理，Worker 自动管理生命周期

### 记忆类型

| 类型              | 说明       | 示例                                 |
| ----------------- | ---------- | ------------------------------------ |
| `user_preference` | 用户偏好   | "User prefers dark mode"             |
| `fact`            | 事实信息   | "User's project uses Node.js 18"     |
| `experience`      | 交互经验   | "Weather search tool worked well"    |
| `task`            | 任务相关   | "User needs to deploy to production" |
| `context`         | 上下文信息 | "Discussing project architecture"    |

详细文档：

- [长期记忆架构文档](docs/long-term-memory-architecture.md)
- [长期记忆 API 文档](docs/long-term-memory-api.md)
- [长期记忆配置文档](docs/long-term-memory-configuration.md)
- [长期记忆迁移指南](docs/long-term-memory-migration.md)

## 开发

```bash
# 安装开发依赖
npm install

# 开发模式（TypeScript编译 + 运行）
npm run dev

# 构建生产版本
npm run build
```

## 许可证

MIT
