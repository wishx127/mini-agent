## 需求：Supabase 连接管理

VectorDatabaseClient 必须管理 Supabase 客户端的连接和生命周期。

### 场景：初始化连接

- **当** 调用 `VectorDatabaseClient.initialize(config)` 时
- **那么** 必须创建 Supabase 客户端实例
- **且** 必须验证连接有效性（执行简单的 SQL 查询）
- **且** 配置必须包含 url 和 apiKey

### 场景：连接失败处理

- **当** Supabase 连接失败时
- **那么** 必须抛出明确的连接错误
- **且** 错误信息必须包含失败原因和建议

### 场景：断开连接

- **当** 调用 `VectorDatabaseClient.disconnect()` 时
- **那么** 必须清理所有连接资源

---

## 需求：向量嵌入生成

VectorDatabaseClient 必须能够将文本转换为向量嵌入。

### 场景：单条文本嵌入

- **当** 调用 `VectorDatabaseClient.generateEmbedding(text)` 时
- **那么** 必须调用 Qwen text-embedding-v3 模型
- **且** 必须返回 1024 维的浮点数组（默认维度）

### 场景：批量文本嵌入

- **当** 调用 `VectorDatabaseClient.generateEmbeddings(texts)` 时
- **那么** 必须批量调用 embedding API
- **且** 必须返回嵌入数组，顺序与输入一致

### 场景：嵌入失败重试

- **当** embedding API 调用失败时
- **那么** 必须重试最多 3 次（指数退避）
- **且** 重试失败后必须抛出错误

### 场景：嵌入缓存

- **当** 相同文本重复请求嵌入时
- **那么** 必须返回缓存的嵌入结果（避免重复 API 调用）

---

## 需求：向量存储

VectorDatabaseClient 必须支持将向量数据存储到 Supabase。

### 场景：插入单条向量记录

- **当** 调用 `VectorDatabaseClient.insertVector(data)` 时
- **那么** 必须插入到 memories 表
- **且** 必须返回插入记录的 id

### 场景：批量插入向量

- **当** 调用 `VectorDatabaseClient.insertVectors(dataArray)` 时
- **那么** 必须使用批量插入（单次 SQL 语句）
- **且** 必须返回所有插入记录的 id 数组

### 场景：插入失败处理

- **当** 插入操作失败时
- **那么** 必须回滚整个批量操作
- **且** 必须抛出包含详细错误信息的异常

---

## 需求：向量相似度检索

VectorDatabaseClient 必须支持基于余弦相似度的向量检索。

### 场景：基本向量检索

- **当** 调用 `VectorDatabaseClient.searchSimilar(queryEmbedding, topK)` 时
- **那么** 必须执行 SQL: `SELECT * FROM memories ORDER BY embedding <=> queryEmbedding LIMIT topK`
- **且** 必须返回匹配的记录数组

### 场景：带过滤条件的检索

- **当** 调用 `VectorDatabaseClient.searchSimilar(queryEmbedding, topK, filters)` 时
- **那么** 必须在 SQL 中添加 WHERE 子句
- **且** filters 必须支持按 type, session_id, is_active 等字段过滤

### 场景：返回相似度分数

- **当** 执行向量检索时
- **那么** 每条结果必须包含相似度分数（cosine similarity）
- **且** 相似度分数必须在 [0, 1] 范围内

---

## 需求：向量更新与删除

VectorDatabaseClient 必须支持向量记录的更新和删除操作。

### 场景：更新向量记录

- **当** 调用 `VectorDatabaseClient.updateVector(id, updates)` 时
- **那么** 必须更新指定 id 的记录
- **且** 如果 updates 包含 content 字段，必须重新生成 embedding

### 场景：软删除向量记录

- **当** 调用 `VectorDatabaseClient.deleteVector(id)` 时
- **那么** 必须将 is_active 设置为 false（软删除）

### 场景：硬删除向量记录

- **当** 调用 `VectorDatabaseClient.hardDeleteVector(id)` 时
- **那么** 必须从数据库中永久删除该记录

---

## 需求：健康检查

VectorDatabaseClient 必须提供健康检查接口。

### 场景：健康检查通过

- **当** 调用 `VectorDatabaseClient.healthCheck()` 且 Supabase 可用时
- **那么** 必须返回 `{ status: 'healthy', latency: <ms> }`

### 场景：健康检查失败

- **当** 调用 `VectorDatabaseClient.healthCheck()` 且 Supabase 不可用时
- **那么** 必须返回 `{ status: 'unhealthy', error: <error message> }`

---

## 需求：降级策略

VectorDatabaseClient 必须支持降级模式，在 Supabase 不可用时优雅降级。

### 场景：自动降级

- **当** 连续 3 次 Supabase 操作失败时
- **那么** 必须进入降级模式
- **且** 所有后续操作必须返回降级响应（如空结果）
- **且** 必须记录降级日志

### 场景：降级恢复

- **当** 处于降级模式且下一次健康检查成功时
- **那么** 必须退出降级模式，恢复正常操作

### 场景：降级配置

- **当** 配置 `enableDegradation: false` 时
- **那么** Supabase 失败时必须抛出异常，不进入降级模式
