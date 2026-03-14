## 需求：长期记忆存储

系统必须能够将结构化的长期记忆持久化存储到向量数据库中。

### 场景：存储新记忆

- **当** 调用 `LongTermMemoryManager.create(memory)` 时
- **那么** 记忆必须被存储到 Supabase 的 memories 表中
- **且** 记忆必须包含 id, type, content, embedding, metadata, session_id, created_at 字段
- **且** embedding 必须由 content 通过 embedding 模型生成

### 场景：记忆类型验证

- **当** 存储的记忆 type 不在预定义类型列表中时
- **那么** 必须抛出验证错误，拒绝存储
- **且** 预定义类型包括: user_preference, fact, experience, task, context

### 场景：元数据存储

- **当** 存储记忆时
- **那么** metadata 字段必须以 JSONB 格式存储
- **且** metadata 可以包含任意自定义字段（如置信度、来源等）

---

## 需求：长期记忆检索

系统必须能够基于查询文本进行向量相似度检索，返回最相关的 top-k 条记忆。

### 场景：向量检索基本流程

- **当** 调用 `LongTermMemoryManager.search(query, topK)` 时
- **那么** 必须将 query 转换为 embedding
- **且** 必须使用余弦相似度在向量数据库中检索
- **且** 必须返回 topK 条最相关的记忆（按相似度降序）
- **且** 默认 topK 为 5

### 场景：过滤非活跃记忆

- **当** 执行向量检索时
- **那么** 必须过滤掉 is_active = false 的记忆
- **且** 必须过滤掉 expires_at < now() 的记忆

### 场景：更新访问记录

- **当** 记忆被检索返回时
- **那么** 必须更新该记忆的 last_accessed_at 为当前时间
- **且** 必须增加 access_count 计数

### 场景：空结果处理

- **当** 检索不到任何相关记忆时
- **那么** 必须返回空数组，不抛出错误

---

## 需求：长期记忆更新

系统必须支持对已存在的记忆进行内容更新。

### 场景：更新记忆内容

- **当** 调用 `LongTermMemoryManager.update(memoryId, newContent)` 时
- **那么** 必须更新该记忆的 content 字段
- **且** 必须重新生成 embedding
- **且** 必须更新 last_accessed_at 为当前时间

### 场景：更新不存在的记忆

- **当** 尝试更新不存在的 memoryId 时
- **那么** 必须抛出记忆不存在错误

### 场景：更新元数据

- **当** 调用 `LongTermMemoryManager.updateMetadata(memoryId, metadata)` 时
- **那么** 必须合并新的 metadata 到现有 metadata 中（不是替换）

---

## 需求：长期记忆遗忘

系统必须支持记忆的过期和主动删除。

### 场景：基于时间的自动过期

- **当** 记忆的 expires_at 时间到达时
- **那么** 该记忆的 is_active 必须被标记为 false
- **且** 该记忆不再出现在检索结果中

### 场景：主动删除记忆

- **当** 调用 `LongTermMemoryManager.delete(memoryId)` 时
- **那么** 必须将该记忆的 is_active 设置为 false（软删除）
- **且** 该记忆必须保留在数据库中用于审计

### 场景：批量过期清理

- **当** 定时任务执行过期清理时
- **那么** 必须批量标记所有 expires_at < now() 且 is_active = true 的记忆为 inactive

---

## 需求：记忆合并

系统必须能够合并相似度极高的重复记忆。

### 场景：自动合并相似记忆

- **当** 新记忆与现有记忆的相似度 > 0.95 时
- **那么** 必须合并为一条记忆
- **且** 保留 content 较新的那条
- **且** 合并后的 metadata 必须包含合并来源信息

### 场景：合并冲突处理

- **当** 两条记忆 type 不同但相似度极高时
- **那么** 必须保留 type 更具体的那条（优先级: user_preference > fact > experience > task > context）

---

## 需求：记忆分类查询

系统必须支持按记忆类型进行分类查询。

### 场景：按类型查询

- **当** 调用 `LongTermMemoryManager.getByType(type)` 时
- **那么** 必须返回所有 is_active = true 且 type 匹配的记忆
- **且** 必须按 created_at 降序排列

### 场景：按会话查询

- **当** 调用 `LongTermMemoryManager.getBySession(sessionId)` 时
- **那么** 必须返回该 session 创建的所有记忆
- **且** 必须按 created_at 降序排列

### 场景：统计记忆数量

- **当** 调用 `LongTermMemoryManager.getStats()` 时
- **那么** 必须返回各类型的记忆数量统计
- **且** 必须包含总记忆数、活跃记忆数、过期记忆数

---

## 需求：记忆提取

系统必须能够使用 LLM 从对话中自动提取结构化的长期记忆。

### 场景：提取用户偏好

- **当** 用户对话中表达偏好（如"我喜欢 TypeScript"）时
- **那么** 必须提取为 type = "user_preference" 的记忆
- **且** content 必须标准化为"User prefers TypeScript"

### 场景：提取事实信息

- **当** 用户对话中提及事实（如"我的名字是 Alice"）时
- **那么** 必须提取为 type = "fact" 的记忆

### 场景：置信度阈值过滤

- **当** 提取的记忆置信度 < 0.7 时
- **那么** 必须丢弃该记忆，不进行存储

### 场景：提取数量限制

- **当** 单次对话提取的记忆数量 > 3 时
- **那么** 必须只保留置信度最高的 3 条记忆

### 场景：提取失败降级

- **当** LLM 提取失败或返回无效格式时
- **那么** 必须记录错误日志但不抛出异常
- **且** 本次对话不存储长期记忆，仅存储短期记忆
