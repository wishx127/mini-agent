# Mini Agent

一个最小可用的AI Agent，基于Node.js、TypeScript和LangChain构建。支持自定义模型baseURL配置，通过终端命令行与AI进行交互。

## 功能特性

- 🤖 基于LangChain的Agent核心
- 🔧 支持自定义模型baseURL
- 🛠️ 支持工具调用
- 🔍 内置联网搜索
- 💬 交互式命令行对话
- 📝 环境变量和.env配置文件支持
- 🔒 TypeScript类型安全

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

| 环境变量            | 默认值                      | 说明             |
| ------------------- | --------------------------- | ---------------- |
| `MODEL_BASE_URL`    | `https://api.openai.com/v1` | 模型API的基础URL |
| `MODEL_NAME`        | `gpt-3.5-turbo`             | 模型名称         |
| `MODEL_API_KEY`     | -                           | API密钥（可选）  |
| `MODEL_TEMPERATURE` | `0.7`                       | 温度参数（0-2）  |
| `MODEL_MAX_TOKENS`  | `2048`                      | 最大token数量    |
| `DISABLED_TOOLS`    | -                           | 禁用的工具列表   |
| `TAVILY_API_KEY`    | -                           | Tavily API密钥   |

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

### 联网搜索

当询问需要实时信息的问题时，Agent会自动使用Tavily搜索工具：

```bash
👤 您: 今天的热搜新闻有哪些
⚡ [Tool Executor] 执行工具: tavily
✅ [Tool Executor] 执行完成 (耗时 1200ms)
🤖 Agent: 今天的热搜新闻包括：...
```

## 项目结构

```
src/
├── agent/           # Agent核心功能
├── config/          # 配置管理 (含工具配置)
├── cli/             # 命令行界面
├── types/           # TypeScript类型定义
└── tools/           # 工具系统 (插件化架构)
    ├── base.ts      # 工具基础类型定义
    ├── registry.ts  # 工具注册中心
    ├── loader.ts    # 工具加载器
    └── plugins/     # 工具插件
        └── tavily.ts # Tavily搜索插件
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
