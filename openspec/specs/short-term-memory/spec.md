## 需求：SessionStore 管理会话历史实例

SessionStore 必须为每个 sessionId 维护一个独立的 `InMemoryChatMessageHistory` 实例，实现跨请求的会话记忆存储。

### 场景：首次获取会话历史

- **当** 以新的 sessionId 调用 `getOrCreate(sessionId)` 时
- **那么** 必须创建并返回一个新的 `InMemoryChatMessageHistory` 实例

### 场景：再次获取同一会话历史

- **当** 以已存在的 sessionId 再次调用 `getOrCreate(sessionId)` 时
- **那么** 必须返回同一个 `InMemoryChatMessageHistory` 实例（引用相同），保持历史连续性

### 场景：清空指定会话历史

- **当** 调用 `clear(sessionId)` 时
- **那么** 该 sessionId 对应的历史必须被清空（调用底层 `clearMessages()`），实例本身保留

### 场景：清空不存在的会话

- **当** 对一个从未创建过的 sessionId 调用 `clear(sessionId)` 时
- **那么** 不应抛出错误，静默忽略

### 场景：删除整个会话实例

- **当** 调用 `delete(sessionId)` 时
- **那么** 该 sessionId 对应的实例必须从内部 Map 中移除；后续调用 `getOrCreate(sessionId)` 将创建新实例

### 场景：获取所有活跃会话 ID

- **当** 调用 `getAllSessionIds()` 时
- **那么** 必须返回当前 store 中所有已创建的 sessionId 字符串数组

---

## 需求：InMemoryChatMessageHistory 消息类型支持

历史实例内部必须能正确存储 LangChain 1.x 消息对象。

### 场景：自动存储 HumanMessage

- **当** `RunnableWithMessageHistory` 处理用户输入后
- **那么** 历史中必须包含对应的 `HumanMessage` 对象

### 场景：自动存储 AIMessage

- **当** `RunnableWithMessageHistory` 处理 AI 回复后
- **那么** 历史中必须包含对应的 `AIMessage` 对象

### 场景：消息顺序保证

- **当** 多轮对话发生后调用历史实例的 `getMessages()` 时
- **那么** 消息必须按写入顺序（时间顺序）返回

---

## 需求：外部记忆系统扩展接口（预留）

SessionStore 的 `getOrCreate` 必须返回 `BaseChatMessageHistory` 类型，允许未来替换为持久化后端。

### 场景：接口可替换性

- **当** 需要替换存储后端（如 Redis、PostgreSQL）时
- **那么** 只需更换 `getOrCreate` 的内部实现，Controller 层无需修改
