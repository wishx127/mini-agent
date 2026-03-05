## 需求：Controller 构建 RunnableWithMessageHistory 链

Controller 必须在初始化时构建基于 `RunnableWithMessageHistory` 的 Runnable 链，完全替代手动消息数组管理。

### 场景：构建完整 Runnable 链

- **当** Controller 初始化时
- **那么** 必须构建 `ChatPromptTemplate → trimmer → llm.bindTools(tools)` 的 Runnable 链，并用 `RunnableWithMessageHistory` 包装

### 场景：ChatPromptTemplate 包含历史占位符

- **当** 构建 prompt 模板时
- **那么** 必须包含 `MessagesPlaceholder('history')` 以注入历史消息，顺序为：system → history → human

### 场景：getMessageHistory 关联 SessionStore

- **当** `RunnableWithMessageHistory` 需要获取历史时
- **那么** 必须调用 `sessionStore.getOrCreate(sessionId)` 返回对应的 `InMemoryChatMessageHistory` 实例

---

## 需求：`execute()` 通过 Runnable 链调用 LLM

Controller 的 `execute(prompt)` 方法必须通过 `chainWithHistory.invoke()` 完成请求，不再手动构建消息数组。

### 场景：正常调用链执行

- **当** 调用 `execute(prompt)` 时
- **那么** 必须调用 `chainWithHistory.invoke({ input: prompt }, { configurable: { sessionId } })`

### 场景：历史自动写入

- **当** `chainWithHistory.invoke()` 执行完成后
- **那么** 用户输入（HumanMessage）和 AI 回复（AIMessage）必须被自动写入 SessionStore，无需手动追加

### 场景：跨请求历史保持

- **当** 同一 `sessionId` 发起第二次 `execute(prompt2)` 时
- **那么** 第一次请求的对话历史（HumanMessage + AIMessage）必须出现在第二次请求的上下文中

### 场景：空输入提前返回

- **当** `prompt` 为空字符串或纯空白时
- **那么** 必须在调用链之前提前返回错误信息 `'输入不能为空'`，不触发 LLM 调用

---

## 需求：成本追踪集成

Controller 必须从 `chainWithHistory.invoke()` 的返回值中提取 token 消耗并记录。

### 场景：从 AIMessage.usageMetadata 记录消耗

- **当** LLM 返回带有 `usageMetadata` 的 `AIMessage` 时
- **那么** 必须将 `usageMetadata` 传给 `CostTracker.record()`，记录本次请求的 input/output/total tokens

### 场景：usageMetadata 缺失时不报错

- **当** LLM 响应的 `usageMetadata` 为 `undefined` 时
- **那么** Controller 不应因此抛出错误，正常返回响应文本

---

## 需求：工具调用与记忆的兼容性

Controller 的工具调用流程必须与 `RunnableWithMessageHistory` 协同工作。

### 场景：工具调用结果注入上下文

- **当** Executor 返回工具执行结果时
- **那么** 工具消息（ToolMessage）必须能注入本次 LLM 调用的上下文

### 场景：最终响应通过链生成

- **当** 工具调用完成需要生成最终回复时
- **那么** 最终 LLM 调用必须通过 `chainWithHistory.invoke()` 执行，确保历史被正确记录

---

## 需求：记忆闭环完整性

Controller 的 `execute()` 必须实现完整的五步记忆闭环。

### 场景：短期记忆拼接

- **当** `execute(prompt)` 被调用时
- **那么** 必须先从 `SessionStore` 加载该 `sessionId` 的历史消息，作为上下文一部分传入 LLM

### 场景：工具调用结果注入上下文

- **当** Executor 执行工具返回 `ToolMessage` 时
- **那么** 工具结果必须注入当前 LLM 调用的上下文，而不是丢弃

### 场景：完整闭环顺序

- **当** `execute(prompt)` 完成一次完整调用后
- **那么** 执行顺序必须为：短期记忆拼接 → Token 预检 → 工具调用结果注入 → 生成回复 → 写入短期记忆

---

## 需求：usage 真实消耗记录

### 场景：从 LLM 响应 usage 记录消耗

- **当** LLM 返回带 `usageMetadata` 的响应后
- **那么** 必须立即调用 `CostTracker.record(response.usageMetadata)` 记录本次真实 token 消耗
- **且** `usageMetadata` 中的 `input_tokens`、`output_tokens`、`total_tokens` 必须正确映射到 `CostRecord`

### 场景：成本计算不实现

- **当** `CostTracker.getSummary()` 被调用时
- **那么** `totalCost` 字段必须为 `0`（成本单价换算暂不实现）
- **但** `totalTokens`、`requestCount` 等 token 统计字段必须正确累加

---

## 需求：兜底逻辑保持不变

记忆系统集成后，超时、迭代次数限制、Token 超限等兜底逻辑必须保持不变。

### 场景：超时兜底

- **当** 执行超时时
- **那么** 必须返回超时兜底消息，本次调用前已写入的历史不受影响

### 场景：Token 超限兜底

- **当** 当前请求 token 估算超限时
- **那么** 必须触发兜底策略返回提示信息，不触发 LLM 调用

### 场景：迭代次数超限兜底

- **当** 工具调用迭代达到 `maxIterations` 时
- **那么** 必须返回迭代超限兜底消息
