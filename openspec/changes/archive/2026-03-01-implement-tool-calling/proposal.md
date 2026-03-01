## Why

当前的 Mini Agent 仅支持基本的对话功能，无法调用外部工具或 API。为了实现真正的智能体 (Agent) 能力，需要添加工具调用 (Tool Calling) 系统，使 Agent 能够自主判断何时使用工具（如 Tavily 联网搜索）来获取实时信息。

## What Changes

- **新增工具注册系统**：支持动态注册和管理可调用工具
- **添加工具调用中间件**：在 Agent 处理流程中插入工具调用判断逻辑
- **实现 Tavily 搜索工具**：作为首个集成工具，支持联网搜索功能
- **配置系统扩展**：添加 API Key 管理和工具配置支持
- **Agent 逻辑重构**：修改 `AgentCore` 以支持工具识别和调用

## Capabilities

### New Capabilities

- `tool-registry`: 工具注册中心，管理所有可用工具的定义、描述和调用方法
- `tavily-search`: Tavily 联网搜索工具，提供实时网络搜索能力
- `agent-tool-calling`: Agent 工具调用逻辑，使 Agent 能自主判断是否使用工具
- `env-api-config`: 环境变量配置扩展，支持 Tavily 等第三方 API Key 管理

### Modified Capabilities

- `agent-core`: 需要扩展核心逻辑以支持工具调用流程

## Impact

- **文件变更**:
  - `src/agent/core.ts` - 扩展以支持工具调用
  - `src/config/model-config.ts` - 添加工具相关配置
  - `src/types/model-config.ts` - 扩展配置接口
- **新增模块**:
  - `src/tools/` - 工具系统目录
  - `src/tools/registry.ts` - 工具注册中心
  - `src/tools/tavily.ts` - Tavily 搜索工具实现
- **依赖新增**:
  - `@langchain/community` - LangChain 社区工具包
  - `tavily-ai` - Tavily SDK (可选)
- **API 影响**: 无破坏性变更，向后兼容
- **配置影响**: 需要添加 `TAVILY_API_KEY` 环境变量（可选）
