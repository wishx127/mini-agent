## 需求：从 usageMetadata 记录 Token 消耗

CostTracker 必须从 LangChain 1.x `AIMessage.usageMetadata` 字段读取真实 token 消耗并记录。

### 场景：记录完整的 usageMetadata

- **当** LLM 返回携带 `usageMetadata` 的 `AIMessage` 时
- **那么** 必须将 `input_tokens`、`output_tokens`、`total_tokens` 映射为内部 `TokenUsage` 结构并存储

### 场景：usageMetadata 为 undefined 时不报错

- **当** `AIMessage.usageMetadata` 为 `undefined` 或 `null` 时
- **那么** 必须静默跳过本次记录，不抛出错误，不影响后续统计

### 场景：记录模型名称和时间戳

- **当** 调用 `record(usageMetadata, model?)` 记录一条消耗时
- **那么** `CostRecord` 中必须包含 `model`（可选字符串）和 `timestamp`（`Date.now()` 毫秒时间戳）

---

## 需求：成本汇总统计

CostTracker 必须提供 `getSummary()` 方法返回累计统计信息。

### 场景：获取成本摘要

- **当** 调用 `getSummary()` 时
- **那么** 必须返回包含以下字段的 `CostSummary` 对象：
  - `totalPromptTokens`：所有请求的 input_tokens 之和
  - `totalCompletionTokens`：所有请求的 output_tokens 之和
  - `totalTokens`：所有请求的 total_tokens 之和
  - `totalCost`：按单价计算的总 USD 成本
  - `requestCount`：已记录的请求次数

### 场景：无记录时摘要为零

- **当** 尚未调用过 `record()` 时
- **那么** `getSummary()` 必须返回所有数值字段均为 `0` 的对象

### 场景：多次记录后累计正确

- **当** 调用 `record()` N 次后
- **那么** `getSummary().requestCount` 必须等于 N，`totalTokens` 必须等于各次 `total_tokens` 之和

---

## 需求：成本单价配置

CostTracker 必须支持按模型配置 token 单价，用于计算 USD 成本。

### 场景：从构造参数读取单价

- **当** 实例化 CostTracker 时传入 `pricePerInputToken` 和 `pricePerOutputToken`（每 token 的 USD 单价）
- **那么** 每次 `record()` 后，`getSummary().totalCost` 必须按单价正确累加

### 场景：未配置单价时成本为 0

- **当** 实例化 CostTracker 时未传入单价配置
- **那么** `getSummary().totalCost` 必须始终为 `0`，token 数量仍正常统计

---

## 需求：重置成本记录

CostTracker 必须提供 `reset()` 方法清空所有记录。

### 场景：重置后摘要归零

- **当** 调用 `reset()` 后
- **那么** `getSummary()` 必须返回所有字段均为 `0` 的对象，`getRecords()` 返回空数组

---

## 需求：历史记录查询

CostTracker 必须提供查询历史 CostRecord 的能力。

### 场景：获取全部历史记录

- **当** 调用 `getRecords()` 时
- **那么** 必须返回所有已记录的 `CostRecord` 数组，按时间顺序排列（最旧在前）

### 场景：获取最近 N 条记录

- **当** 调用 `getRecentRecords(n)` 时
- **那么** 必须返回最近的 `n` 条记录；若总记录数不足 `n`，则返回全部记录
