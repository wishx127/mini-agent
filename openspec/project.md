# Mini Agent 项目文档

## 项目概述

Mini Agent 是一个最小可用的 AI Agent，基于Node.js、TypeScript和LangChain构建。该项目旨在提供一个轻量级、易于配置和扩展的AI对话代理，支持自定义模型baseURL配置，通过终端命令行与AI进行交互。

## 核心特性

- 🤖 **基于LangChain的Agent核心** - 使用LangChain框架构建的AI代理
- 🔧 **灵活的配置系统** - 支持环境变量、配置文件多种配置方式
- 💬 **交互式命令行对话** - 提供用户友好的CLI交互界面
- 📝 **多配置源支持** - 环境变量、.env文件、默认值三级配置优先级
- 🔒 **TypeScript类型安全** - 完整的类型定义和编译时检查
- 🌐 **自定义模型支持** - 支持配置不同AI模型的baseURL和参数

## 技术架构

### 技术栈

- **运行时**: Node.js
- **语言**: TypeScript
- **AI框架**: LangChain (Core + OpenAI)
- **CLI框架**: Commander.js
- **配置管理**: dotenv
- **包管理**: npm

### 项目结构

```
src/
├── agent/           # Agent核心功能模块
│   └── core.ts      # AgentCore类 - 处理AI对话逻辑
├── config/          # 配置管理模块
│   └── model-config.ts  # ModelConfigManager类 - 配置加载和验证
├── cli/             # 命令行界面模块
│   └── interface.ts # CLIInterface类 - 用户交互处理
├── types/           # TypeScript类型定义
│   └── model-config.ts  # ModelConfig接口和默认配置
└── index.ts         # 程序入口文件
```

### 核心组件说明

#### 1. AgentCore (`src/agent/core.ts`)

**职责**: AI代理的核心逻辑处理

**主要功能**:

- LLM模型初始化和配置
- 用户提示处理和响应生成
- 错误处理和异常管理
- 响应格式化

**关键方法**:

- `processPrompt(prompt: string)` - 处理用户输入并返回AI响应
- `callLLM(prompt: string)` - 调用底层LLM模型
- `formatResponse(response: string)` - 格式化响应输出

#### 2. ModelConfigManager (`src/config/model-config.ts`)

**职责**: 配置管理和验证

**主要功能**:

- 多源配置加载（环境变量 > 配置文件 > 默认值）
- 配置验证和错误检测
- 类型安全的配置访问

**配置优先级**:

1. 环境变量 (`process.env`)
2. .env配置文件
3. 默认配置 (`DEFAULT_MODEL_CONFIG`)

#### 3. CLIInterface (`src/cli/interface.ts`)

**职责**: 命令行交互界面

**主要功能**:

- 命令行参数解析
- 用户输入处理和响应显示
- 交互式对话循环
- 退出和错误处理

#### 4. ModelConfig 类型 (`src/types/model-config.ts`)

**配置接口**:

```typescript
interface ModelConfig {
  baseUrl: string; // LLM模型的base URL
  modelName: string; // 模型名称
  apiKey?: string; // API密钥（可选）
  temperature?: number; // 温度参数 (0-2)
  maxTokens?: number; // 最大token数量
}
```

## 开发方法

### 环境要求

- Node.js 18+
- npm 8+
- TypeScript 5+

### 开发流程

1. **环境配置**

   ```bash
   # 克隆项目
   git clone <repository-url>
   cd mini-agent

   # 安装依赖
   npm install
   ```

2. **配置文件设置**

   ```bash
   # 复制示例配置
   cp .env.example .env

   # 编辑配置文件
   nano .env
   ```

3. **开发模式运行**

   ```bash
   # 编译并运行
   npm run dev

   # 或直接使用ts-node
   npx ts-node src/index.ts
   ```

4. **生产构建**

   ```bash
   # TypeScript编译
   npm run build

   # 运行编译后的代码
   npm start
   ```

### 配置管理

#### 配置选项

| 环境变量            | 默认值                      | 说明             |
| ------------------- | --------------------------- | ---------------- |
| `MODEL_BASE_URL`    | `https://api.openai.com/v1` | 模型API的基础URL |
| `MODEL_NAME`        | `gpt-3.5-turbo`             | 模型名称         |
| `MODEL_API_KEY`     | -                           | API密钥（可选）  |
| `MODEL_TEMPERATURE` | `0.7`                       | 温度参数（0-2）  |
| `MODEL_MAX_TOKENS`  | `2048`                      | 最大token数量    |

#### 配置验证规则

- `baseUrl`: 必须为非空且有效的URL格式
- `modelName`: 必须为非空字符串
- `temperature`: 必须在0-2范围内
- `maxTokens`: 必须大于0

### 扩展开发指南

#### 添加新的配置选项

1. 在 `ModelConfig` 接口中添加新字段
2. 更新 `DEFAULT_MODEL_CONFIG` 默认值
3. 在 `ModelConfigManager` 中添加环境变量解析
4. 更新配置验证逻辑

#### 自定义Agent行为

1. 继承 `AgentCore` 类
2. 重写 `processPrompt` 方法添加预处理逻辑
3. 扩展 `formatResponse` 方法自定义响应格式
4. 添加新的工具方法

#### 添加新的CLI命令

1. 在 `CLIInterface.setupCommands()` 中添加新命令
2. 实现对应的处理方法
3. 更新帮助文档

### 错误处理策略

- **配置错误**: 启动时验证，失败则退出程序
- **网络错误**: 重试机制和友好错误提示
- **API错误**: 根据HTTP状态码提供具体错误信息
- **用户输入错误**: 输入验证和空值处理

### 测试建议

- 单元测试: 配置管理、类型验证
- 集成测试: Agent响应、CLI交互
- E2E测试: 完整对话流程
- 错误场景测试: 网络异常、配置错误

## 部署和分发

### 本地安装

```bash
# 全局安装
npm install -g .

# 使用
mini-agent --config ./my-config.env
```

### 包发布

```bash
# 构建
npm run build

# 发布到npm
npm publish
```

## 项目优势

1. **轻量级**: 最小依赖，快速启动
2. **可扩展**: 模块化设计，易于扩展
3. **类型安全**: TypeScript提供编译时保障
4. **配置灵活**: 多源配置支持
5. **错误友好**: 详细的错误提示和处理
6. **文档完整**: 清晰的代码注释和使用说明

## 未来发展方向

- 支持更多AI模型提供商
- 添加工具调用功能
- 实现记忆和上下文管理
- 支持流式响应
- 添加插件系统
- 集成更多CLI功能

---

_此文档旨在帮助AI开发者快速理解项目架构和开发方法，便于后续的维护和扩展工作。_
