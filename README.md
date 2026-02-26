# Mini Agent

一个最小可用的AI Agent，基于Node.js、TypeScript和LangChain构建。支持自定义模型baseURL配置，通过终端命令行与AI进行交互。

## 功能特性

- 🤖 基于LangChain的Agent核心
- 🔧 支持自定义模型baseURL
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

## 使用示例

```bash
$ npm run dev
🤖 Agent初始化成功!
📡 模型: gpt-3.5-turbo
🌐 Base URL: https://api.openai.com/v1

输入您的消息开始对话 (输入 "quit" 或 "exit" 退出):

👤 您: 你好，请介绍一下自己
🤖 Agent: 你好！我是一个基于LangChain构建的AI助手...

👤 您: exit
👋 再见！
```

## 项目结构

```
src/
├── agent/           # Agent核心功能
├── config/          # 配置管理
├── cli/             # 命令行界面
├── models/          # 模型相关
└── types/           # TypeScript类型定义
```

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
