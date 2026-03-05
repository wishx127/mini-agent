## 需求：Token 数量估算函数

TokenManager 必须提供 `estimateTokenCount` 函数，对任意文本或消息内容做快速 token 估算。

### 场景：估算字符串文本

- **当** 估算文本 `"Hello world"`（11 字符）时
- **那么** 结果必须为 3（`Math.ceil(11 / 4)`）

### 场景：估算长文本

- **当** 估算 1000 个字符的文本时
- **那么** 结果必须为 250（`Math.ceil(1000 / 4)`）

### 场景：估算空字符串

- **当** 估算空字符串 `""` 时
- **那么** 结果必须为 0

---

## 需求：使用 `trimMessages` 实现消息裁剪

TokenManager 必须提供 `createTrimmer` 工厂函数，返回配置好的 `trimMessages` Runnable，可直接用于 LCEL 链中。

### 场景：工厂函数接受 maxTokens 参数

- **当** 调用 `createTrimmer({ maxTokens: 2000 })` 时
- **那么** 必须返回一个可作为 Runnable 步骤使用的裁剪器（可调用 `.invoke(messages)`）

### 场景：裁剪保留最新消息

- **当** 消息列表总 token 超过 maxTokens 时
- **那么** 必须优先保留最新消息，删除最旧消息（`strategy: 'last'`）

### 场景：裁剪始终保留系统消息

- **当** 消息列表包含 SystemMessage 时
- **那么** 裁剪后系统消息必须始终存在（`includeSystem: true`）

### 场景：裁剪从完整轮次开始

- **当** 需要裁剪时
- **那么** 必须从 HumanMessage 开始截取（`startOn: 'human'`），避免上下文中出现孤立的 AIMessage 或 ToolMessage

### 场景：不超限时原样返回

- **当** 消息总 token 未超过 maxTokens 时
- **那么** 裁剪器必须原样返回所有消息，不删除任何内容

---

## 需求：Token 状态报告

TokenManager 必须提供 `getTokenStatus` 函数，返回当前消息列表的 token 使用状态。

### 场景：获取 Token 状态

- **当** 调用 `getTokenStatus(messages, limit)` 时
- **那么** 必须返回包含以下字段的对象：
  - `total`：当前消息列表估算的总 token 数
  - `limit`：上限
  - `percentage`：`total / limit`
  - `exceeded`：`total > limit`
  - `nearThreshold`：`total >= limit × threshold`（默认 threshold = 0.8）

### 场景：接近阈值时标记警告

- **当** token 使用量超过 `limit × 0.8` 但未超过 `limit` 时
- **那么** `nearThreshold` 必须为 `true`，`exceeded` 必须为 `false`

### 场景：超过限制时标记超限

- **当** token 使用量超过 `limit` 时
- **那么** `exceeded` 必须为 `true`，`nearThreshold` 也为 `true`

---

## 需求：Token 预检（execute 调用前）

`execute()` 在发起 LLM 调用前，必须通过 `getTokenStatus` 完成 Token 预检并按结果决策。

### 场景：预检未超限时正常继续

- **当** 估算的完整 prompt token 未超过模型限制时
- **那么** 直接进入下一步，不裁剪历史，不触发兜底

### 场景：预检超限时触发裁剪

- **当** `getTokenStatus` 返回 `exceeded = true` 时
- **那么** 必须先调用 `createTrimmer` 裁剪历史消息，再发起 LLM 调用

### 场景：裁剪后重新估算不超限

- **当** `trimMessages` 裁剪完成后
- **那么** 裁剪结果的 token 数量必须 ≤ 模型 `maxTokens` 限制
