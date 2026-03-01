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

## 工具调用架构

Mini Agent 采用流水线架构处理工具调用：

```
用户输入 → LLM决策 → 工具路由 → 参数验证 → 工具执行 → 结果截断 → 消息追加 → 最终响应
```

- **LLM决策**: 判断是否需要使用工具
- **工具路由**: 根据工具名选择对应工具
- **参数验证**: 验证工具参数
- **工具执行**: 执行工具 (含超时控制)
- **结果截断**: 截断过长结果
- **消息追加**: 添加工具消息到对话历史
- **最终响应**: 返回LLM生成的回答

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
