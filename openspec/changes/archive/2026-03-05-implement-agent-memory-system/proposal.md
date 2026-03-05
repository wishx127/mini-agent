## Why

当前 mini-agent 的 Controller 在每次 `execute()` 调用时从零构建对话历史，请求之间完全独立。用户在多轮对话中必须重复提供之前已说明的背景信息，严重影响会话连贯性和使用体验。

## What Changes

- 新增记忆模块 `src/agent/memory/`，基于 **LangChain 1.x `RunnableWithMessageHistory`** 实现跨请求会话记忆
- 使用 `InMemoryChatMessageHistory` 作为进程内存储后端，预留 `BaseChatMessageHistory` 接口供未来替换
- 实现完整记忆闭环：**用户输入 → 短期记忆拼接 → 工具调用结果注入 → 生成回复 → 写回短期记忆**
- 新增 **Token 预检步骤**：`execute()` 在发起 LLM 调用前，本地估算完整 prompt 的 token 数量；超出上下文限制时通过 `trimMessages` 自动裁剪历史，保证请求不超限
- 从 LLM 响应的 `usage` 对象（`AIMessage.usageMetadata`）读取真实 token 消耗并记录；**成本计算系统预留接口，本次暂不实现**
- 重构 Controller，将手动消息数组管理替换为 `RunnableWithMessageHistory` 链式调用

## Capabilities

### New Capabilities

- **short-term-memory**：`SessionStore` 管理每个 sessionId 的 `InMemoryChatMessageHistory` 实例，实现跨请求会话存储
- **token-manager**：`estimateTokenCount` token 估算函数 + `createTrimmer` 工厂（基于 `trimMessages`），提供 `getTokenStatus` 状态报告；`execute()` 调用前执行预检，超限时触发裁剪
- **cost-tracker**：`CostTracker` 接口预留，从 LLM 响应的 `usage` 对象记录 token 消耗（`prompt_tokens`、`completion_tokens`、`total_tokens`）；**成本单价换算暂不实现，`totalCost` 固定为 0**
- **memory-integration**：Controller 使用 `RunnableWithMessageHistory` 构建完整 Runnable 链，自动管理历史读写闭环

### Modified Capabilities

- **agent-controller**：`execute()` 接口保持不变，内部实现替换为 `chainWithHistory.invoke()`，移除废弃的手动消息拼接代码

## Impact

- **无新增依赖**：`RunnableWithMessageHistory`、`InMemoryChatMessageHistory`、`trimMessages` 均来自已有的 `@langchain/core ^1.1.28`
- **新增文件**：`src/agent/memory/`（types.ts、session-store.ts、token-manager.ts、cost-tracker.ts、index.ts）
- **修改文件**：`src/agent/controller.ts`——内部实现重构，公共接口不变
- **移除代码**：`buildMessages()`、`appendToolResults()`、`directLLMResponse()` / `finalLLMResponse()` 中的手动消息拼接逻辑
