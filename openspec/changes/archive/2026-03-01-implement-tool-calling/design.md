## Context

### 背景与现状

当前 Mini Agent 仅有基础对话功能，使用 `@langchain/openai` 的 `ChatOpenAI` 与 LLM 交互。用户请求需要联网搜索时，Agent 无法自主判断并调用外部工具。

项目现有架构：
- `AgentCore`: 基于 LangChain 的核心 Agent 类
- `ModelConfigManager`: 配置管理，支持环境变量和 .env 文件
- 已有依赖: `@langchain/core`, `@langchain/openai`

### 约束与要求

- 必须保持向后兼容，不破坏现有 API
- 工具可通过配置启用/禁用
- 支持开发者通过环境变量配置 API Key
- LLM 模型需要支持 Function Calling（工具调用）能力

## Goals / Non-Goals

**Goals:**
- 实现工具注册系统，支持代码定义工具 + 配置启用/禁用
- 实现 Agent 工具调用逻辑：LLM 判断 + 规则兜底
- 集成 Tavily 搜索工具作为首个示例工具
- 扩展配置系统，支持工具相关环境变量

**Non-Goals:**
- 不实现复杂的多工具协作链式调用
- 不实现工具执行结果的二次 LLM 处理（直接返回结果）
- 不支持自定义 HTTP 工具（仅通过预设工具扩展）

## Decisions

### D1: 工具注册机制 - 代码定义 + 配置启用

**决策**: 工具通过代码定义（实现 Tool 接口），通过配置文件或环境变量启用/禁用。

**理由**:
- 代码定义保证类型安全和 IDE 支持
- 配置启用让开发者无需修改代码即可开关工具
- 符合最小权限原则，未启用的工具不会被加载

**替代方案考虑**:
- 纯配置驱动：需要额外的配置解析和验证逻辑，增加复杂度
- 纯代码注册：不够灵活，无法在不修改代码的情况下开关工具

### D2: 工具调用判断 - LLM 判断 + 规则兜底

**决策**: Agent 首先尝试让 LLM 判断是否需要调用工具，如果 LLM 不支持或未返回有效工具调用，则使用规则匹配兜底。

**理由**:
- LLM 判断是主流方案，支持任意工具组合
- 规则兜底处理 LLM 不支持 function calling 或判断失误的情况
- 规则兜底仅处理明确需要工具的场景（如包含搜索关键词）

**替代方案考虑**:
- 纯 LLM 判断：部分模型不支持 function calling，无法覆盖所有场景
- 纯规则匹配：无法处理复杂场景，规则维护成本高

### D3: Tavily 集成 - 使用 @langchain/tavily

**决策**: 使用 `@langchain/tavily` 官方工具包，而非直接调用 Tavily API。

**理由**:
- `@langchain/tavily` 已封装完整的 Tool 实现，减少开发工作
- 官方包维护及时，兼容性好
- 与现有 LangChain 生态无缝集成

**替代方案考虑**:
- 直接调用 HTTP API：需要自行封装 Tool 接口，增加维护成本
- 使用社区封装的 tavily-ai：非官方，长期维护风险高

### D4: 配置结构扩展

**决策**: 在 `ModelConfig` 中添加 `tools` 配置对象，并在 `ModelConfigManager` 中支持 `TOOL_<NAME>_ENABLED` 环境变量格式。

**理由**:
- 保持配置结构清晰，工具配置与模型配置分离
- 环境变量命名统一，便于开发者理解
- 兼容现有配置加载逻辑

## Risks / Trade-offs

### R1: LLM 模型兼容性

**[风险]**: 部分 LLM 不支持 function calling，导致工具调用能力受限。

** Mitigation **: 实现规则兜底机制，对于明确需要工具的请求（如包含"搜索"、"查询"等关键词）直接调用工具。

### R2: 工具调用循环

**[风险]**: Agent 可能陷入无限调用工具的循环。

** Mitigation **: 设置最大工具调用次数限制（默认 3 次），超过后强制返回结果。

### R3: API Key 安全

**[风险]**: 工具 API Key 明文存储在环境变量或配置中。

** Mitigation **: 仅在工具启用时检查 API Key，不启用时忽略；提示开发者使用 .env 文件管理敏感配置。

### R4: 工具执行失败

**[风险]**: 工具执行失败（如网络错误）导致 Agent 无法正常响应。

** Mitigation **: 工具执行异常时捕获错误，将错误信息返回给 LLM，让 LLM 决定如何处理。

## Migration Plan

### 步骤 1: 添加依赖

```bash
npm install @langchain/tavily
```

### 步骤 2: 创建工具系统目录

```
src/tools/
├── index.ts          # 导出所有工具和注册中心
├── registry.ts       # 工具注册中心
├── base.ts           # 工具基类和接口定义
└── tavily.ts         # Tavily 搜索工具实现
```

### 步骤 3: 扩展配置类型

修改 `src/types/model-config.ts`:
- 添加 `ToolConfig` 接口
- 在 `ModelConfig` 中添加工具配置

修改 `src/config/model-config.ts`:
- 添加工具相关配置加载逻辑
- 支持 `TOOL_<NAME>_ENABLED` 环境变量

### 步骤 4: 重构 AgentCore

修改 `src/agent/core.ts`:
- 注入工具注册中心
- 添加工具调用中间件逻辑
- 实现 LLM 判断 + 规则兜底的工具选择机制

### 步骤 5: 配置示例

创建 `.env.example` 文件:
```
# Tavily 搜索工具
TAVILY_API_KEY=your_api_key_here
TOOL_TAVILY_ENABLED=true
```

## Open Questions

### Q1: 工具调用结果如何处理？

**问题**: 工具执行结果直接返回给用户，还是再次交给 LLM 处理后返回？

**当前决策**: 直接返回工具执行结果的文本描述，简化实现。如需更智能的处理，可在后续迭代中扩展。

### Q2: 是否需要支持工具描述的自定义？

**问题**: 工具的描述（description）是否允许开发者自定义，还是固定？

**当前决策**: 工具描述在代码中定义，保持简单。如需自定义，可后续添加配置覆盖机制。

### Q3: 规则兜底的规则如何定义？

**问题**: 规则兜底的匹配规则是硬编码还是可配置？

**当前决策**: 规则硬编码在 AgentCore 中，仅处理最常见的场景（如包含"搜索"、"联网"等关键词）。