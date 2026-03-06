## 1. 环境准备

- [x] 1.1 确认 `@langchain/core ^1.1.28` 已提供 `RunnableWithMessageHistory`、`InMemoryChatMessageHistory`、`trimMessages`（无需新增依赖）
- [x] 1.2 创建 `src/agent/memory/` 目录，新建以下空文件：`types.ts`、`session-store.ts`、`token-manager.ts`、`cost-tracker.ts`、`index.ts`

## 2. 类型定义

- [x] 2.1 在 `types.ts` 中定义 `TokenUsage` 类型：`{ input_tokens: number; output_tokens: number; total_tokens: number }`
- [x] 2.2 在 `types.ts` 中定义 `CostRecord` 类型：`{ usage: TokenUsage; model?: string; timestamp: number; cost: number }`
- [x] 2.3 在 `types.ts` 中定义 `CostSummary` 类型：`{ totalPromptTokens: number; totalCompletionTokens: number; totalTokens: number; totalCost: number; requestCount: number }`

## 3. SessionStore 实现

- [x] 3.1 在 `session-store.ts` 中实现 `SessionStore` 类，内部维护 `Map<string, InMemoryChatMessageHistory>`
- [x] 3.2 实现 `getOrCreate(sessionId: string): BaseChatMessageHistory` 方法：不存在则创建新 `InMemoryChatMessageHistory` 实例并存入 Map，已存在则直接返回
- [x] 3.3 实现 `clear(sessionId: string): Promise<void>` 方法：调用对应实例的 `clearMessages()`，sessionId 不存在时静默忽略
- [x] 3.4 实现 `delete(sessionId: string): void` 方法：从 Map 中移除对应实例
- [x] 3.5 实现 `getAllSessionIds(): string[]` 方法：返回当前所有 sessionId 列表

## 4. TokenManager 实现

- [x] 4.1 在 `token-manager.ts` 中实现 `estimateTokenCount(text: string): number` 函数，使用 `Math.ceil(text.length / 4)` 快速估算
- [x] 4.2 实现 `createTrimmer({ maxTokens }: { maxTokens: number })` 工厂函数，调用 `trimMessages` 并配置：`strategy: 'last'`、`tokenCounter: estimateTokenCount`、`includeSystem: true`、`allowPartial: false`、`startOn: 'human'`
- [x] 4.3 实现 `getTokenStatus(messages: BaseMessage[], limit: number, threshold?: number): TokenStatus` 函数，返回 `{ total, limit, percentage, exceeded, nearThreshold }`（threshold 默认 0.8）
- [x] 4.4 实现 `runTokenPreflight(messages: BaseMessage[], maxTokens: number): BaseMessage[]` 预检函数：调用 `getTokenStatus`，若 `exceeded = true` 则调用 `createTrimmer` 裁剪后返回裁剪结果，否则原样返回

## 5. CostTracker 实现（仅记录 usage，不计算成本）

> **注意**：成本单价换算暂不实现。`CostTracker` 仅从 LLM 响应的 `usage` 对象读取并累计 token 消耗，`totalCost` 固定为 0。

- [x] 5.1 在 `cost-tracker.ts` 中实现 `CostTracker` 类，构造函数接受可选配置 `{ pricePerInputToken?: number; pricePerOutputToken?: number }`（参数保留接口，本次不使用）
- [x] 5.2 实现 `record(usageMetadata: UsageMetadata | undefined, model?: string): void` 方法：`usageMetadata` 为 `undefined` 时静默跳过；否则从 `usage` 对象提取 `input_tokens`、`output_tokens`、`total_tokens` 并追加 `CostRecord`（`cost` 字段固定为 0）
- [x] 5.3 实现 `getSummary(): CostSummary` 方法，返回累计 token 统计（`totalCost` 固定为 0，无记录时所有字段为 0）
- [x] 5.4 实现 `getRecords(): CostRecord[]` 方法，返回按时间顺序排列的全部历史记录
- [x] 5.5 实现 `getRecentRecords(n: number): CostRecord[]` 方法，返回最近 n 条记录（不足 n 条则返回全部）
- [x] 5.6 实现 `reset(): void` 方法，清空所有记录并将累计值归零

## 6. memory 模块统一导出

- [x] 6.1 在 `index.ts` 中统一导出：`SessionStore`、`CostTracker`、`estimateTokenCount`、`createTrimmer`、`getTokenStatus`，以及 `TokenUsage`、`CostRecord`、`CostSummary` 类型

## 7. Controller 重构（核心）

- [x] 7.1 在 `controller.ts` 中引入 `SessionStore`、`CostTracker`、`createTrimmer` 并在构造函数中初始化（`sessionId` 默认为 `'default'`）
- [x] 7.2 使用 `ChatPromptTemplate.fromMessages` 构建 prompt 模板，包含三段：`['system', '...']`、`new MessagesPlaceholder('history')`、`['human', '{input}']`
- [x] 7.3 调用 `createTrimmer({ maxTokens: config.maxTokens })` 创建 trimmer 实例
- [x] 7.4 构建 Runnable 链：`prompt.pipe(trimmer).pipe(llm.bindTools(tools))`
- [x] 7.5 用 `RunnableWithMessageHistory` 包装链，配置 `getMessageHistory: (id) => sessionStore.getOrCreate(id)`、`inputMessagesKey: 'input'`、`historyMessagesKey: 'history'`，赋值给 `this.chainWithHistory`
- [x] 7.6 在 `execute()` 中实现 Token 预检闭环：
  - 从 SessionStore 加载当前历史消息（短期记忆拼接）
  - 调用 `runTokenPreflight(messages, config.maxTokens)` 进行预检；超限时裁剪历史
  - 调用 `this.chainWithHistory.invoke({ input: prompt }, { configurable: { sessionId: this.sessionId } })` 发送请求
- [x] 7.7 从 `response.usageMetadata`（LLM 响应的 `usage` 对象）提取消耗并调用 `this.costTracker.record(response.usageMetadata)`（仅记录 token 数量，不计算成本）
- [x] 7.8 保留超时检查（`checkTimeout()`）、迭代次数限制（`maxIterations`）、兜底策略（`fallback()`）逻辑不变
- [x] 7.9 移除废弃代码：`buildMessages()` 方法、`appendToolResults()` 方法、`directLLMResponse()` / `finalLLMResponse()` 中的手动消息拼接、`conversationHistory: ConversationMessage[]` 局部变量

## 8. 测试和验证

- [x] 8.1 运行现有测试套件确保无回归（`npm test`）
- [x] 8.2 为 `SessionStore` 编写单元测试：验证 `getOrCreate` 幂等性、`clear` 清空行为、`delete` 移除行为、`getAllSessionIds` 返回列表
- [x] 8.3 为 `TokenManager` 编写单元测试：验证 `estimateTokenCount` 计算、`createTrimmer` 裁剪后保留 system 消息和最新消息、`getTokenStatus` 各阈值边界
- [x] 8.4 为 `CostTracker` 编写单元测试：验证 `record` 累加、`usageMetadata` 为 undefined 时不报错、`getSummary` 统计正确、`reset` 归零、`getRecentRecords(n)` 边界
- [x] 8.5 为 Controller 编写集成测试：验证同一 sessionId 的第二次 `execute()` 调用中，历史中包含第一次的 HumanMessage 和 AIMessage
- [x] 8.6 手动验证 CLI 多轮对话：连续提问两个相关问题，确认第二轮 Agent 能正确引用第一轮上下文
- [x] 8.7 更新 README 文档，并在docs文件夹下新增文档 `memory-system.md`，详细描述内存系统设计、实现和使用方法
