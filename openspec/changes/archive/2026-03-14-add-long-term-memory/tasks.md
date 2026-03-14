## 1. 基础设施准备

- [x] 1.1 创建 Supabase 项目并获取项目 URL 和 API Key（文档已完成：docs/infrastructure-setup.md）
- [x] 1.2 在 Supabase 中启用 pgvector 扩展（文档已完成：docs/infrastructure-setup.md）
- [x] 1.3 创建 memories 表 schema（包含 id, type, content, embedding, metadata, session_id, created_at, last_accessed_at, access_count, expires_at, is_active 字段）（已完成：sql/memories_schema.sql）
- [x] 1.4 在 embedding 列上创建 ivfflat 索引（已完成：sql/memories_schema.sql）
- [x] 1.5 创建记忆类型验证约束（type 必须在预定义类型列表中）（已完成：sql/memories_schema.sql）
- [x] 1.6 安装依赖 `@supabase/supabase-js`

## 2. 类型定义

- [x] 2.1 创建 `Memory` 类型定义（包含所有字段类型）
- [x] 2.2 创建 `MemoryType` 枚举（user_preference, fact, experience, task, context）
- [x] 2.3 创建 `MemoryMetadata` 接口（支持任意自定义字段）
- [x] 2.4 创建 `VectorDatabaseConfig` 接口（包含 Supabase 配置）
- [x] 2.5 创建 `MemorySearchResult` 接口（包含记忆和相似度分数）
- [x] 2.6 创建 `MemoryExtractionResult` 接口（包含提取的记忆和置信度）

## 3. VectorDatabaseClient 实现

- [x] 3.1 创建 `VectorDatabaseClient` 类
- [x] 3.2 实现 `initialize(config)` 方法：创建 Supabase 客户端并验证连接
- [x] 3.3 实现 `disconnect()` 方法：清理连接资源
- [x] 3.4 实现 `generateEmbedding(text)` 方法：调用 Qwen text-embedding-v3 模型
- [x] 3.5 实现 `generateEmbeddings(texts)` 方法：批量生成 embedding
- [x] 3.6 实现 embedding 缓存机制（避免重复 API 调用）
- [x] 3.7 实现 `insertVector(data)` 方法：插入单条向量记录
- [x] 3.8 实现 `insertVectors(dataArray)` 方法：批量插入向量
- [x] 3.9 实现 `searchSimilar(queryEmbedding, topK, filters)` 方法：向量相似度检索
- [x] 3.10 实现 `updateVector(id, updates)` 方法：更新向量记录
- [x] 3.11 实现 `deleteVector(id)` 方法：软删除向量记录
- [x] 3.12 实现 `hardDeleteVector(id)` 方法：永久删除向量记录
- [x] 3.13 实现 `healthCheck()` 方法：检查 Supabase 连接状态
- [x] 3.14 实现降级模式：连续失败自动降级，健康检查成功后恢复
- [x] 3.15 实现 API 调用失败重试机制（最多 3 次，指数退避）
- [x] 3.16 为 VectorDatabaseClient 编写单元测试

## 4. MemoryExtractor 实现

- [x] 4.1 创建 `MemoryExtractor` 类
- [x] 4.2 定义记忆提取的 JSON Schema（结构化输出）
- [x] 4.3 实现 `extract(userMessage, aiResponse)` 方法：使用 LLM 提取潜在记忆
- [x] 4.4 实现置信度阈值过滤（只保留置信度 >= 0.7 的记忆）
- [x] 4.5 实现提取数量限制（最多 3 条记忆）
- [x] 4.6 实现记忆内容标准化（如"我喜欢 TypeScript" → "User prefers TypeScript"）
- [x] 4.7 实现提取失败降级（记录错误但不抛出异常）
- [x] 4.8 为 MemoryExtractor 编写单元测试

## 5. LongTermMemoryManager 实现

- [x] 5.1 创建 `LongTermMemoryManager` 类
- [x] 5.2 实现 `create(memory)` 方法：存储新记忆到向量数据库
- [x] 5.3 实现 `search(query, topK)` 方法：基于查询文本的向量检索
- [x] 5.4 实现检索时更新访问记录（last_accessed_at, access_count）
- [x] 5.5 实现 `update(memoryId, newContent)` 方法：更新记忆内容并重新生成 embedding
- [x] 5.6 实现 `updateMetadata(memoryId, metadata)` 方法：合并更新元数据
- [x] 5.7 实现 `delete(memoryId)` 方法：软删除记忆
- [x] 5.8 实现 `getByType(type)` 方法：按类型查询记忆
- [x] 5.9 实现 `getBySession(sessionId)` 方法：按会话查询记忆
- [x] 5.10 实现 `getStats()` 方法：统计各类型记忆数量
- [x] 5.11 实现记忆合并逻辑：相似度 > 0.95 自动合并
- [x] 5.12 实现记忆过期标记：expires_at < now() 标记为 inactive
- [x] 5.13 实现批量过期清理定时任务
- [x] 5.14 为 LongTermMemoryManager 编写单元测试

## 6. Controller 集成

- [x] 6.1 修改 `ControlConfig` 接口：添加长期记忆配置项（enableLongTermMemory, longTermMemoryTopK, memoryExtractionThreshold）
- [x] 6.2 修改 Controller 构造函数：注入 `VectorDatabaseClient` 和 `LongTermMemoryManager`
- [x] 6.3 修改 Controller 初始化：初始化 VectorDatabaseClient
- [x] 6.4 修改 prompt 模板：添加 `MessagesPlaceholder('long_term_memory')`
- [x] 6.5 调整 prompt 模板顺序：system → long_term_memory → history → human
- [x] 6.6 修改 `execute()` 方法：在调用 LLM 前检索长期记忆
- [x] 6.7 实现 `execute()` 中的长期记忆检索失败降级（检索失败时使用空数组）
- [x] 6.8 修改 `execute()` 方法：在 LLM 回复后提取长期记忆
- [x] 6.9 实现记忆提取失败降级（提取失败不影响短期记忆写入）
- [x] 6.10 更新记忆闭环顺序：长期记忆检索 → 短期记忆拼接 → Token 预检 → 工具调用 → 生成回复 → 提取长期记忆 → 写入长期记忆 → 写入短期记忆
- [x] 6.11 实现配置开关：`enableLongTermMemory: false` 时跳过长期记忆流程
- [x] 6.12 为 Controller 的长期记忆集成编写集成测试（已完成：src/agent/controller-long-term-memory.test.ts）

## 7. 配置文件更新

- [x] 7.1 在环境变量配置中添加 `SUPABASE_URL` 和 `SUPABASE_API_KEY`
- [x] 7.2 在配置文件中添加长期记忆配置项
- [x] 7.3 添加 embedding 模型配置（Qwen text-embedding-v3，默认 1024 维）
- [x] 7.4 添加记忆过期策略配置（默认过期时间）
- [x] 7.5 更新配置文档和示例（已完成：docs/long-term-memory-configuration.md, .env.production.example）

## 8. 测试与验证

- [x] 8.1 编写 VectorDatabaseClient 集成测试（已完成：src/agent/memory/vector-database-client.test.ts）
- [x] 8.2 编写 LongTermMemoryManager 集成测试（已完成：src/agent/memory/long-term-memory-manager.test.ts）
- [x] 8.3 编写 Controller 端到端测试（包含长期记忆的完整流程）（已完成：src/agent/controller-long-term-memory.test.ts）
- [x] 8.4 测试降级行为：Supabase 不可用时系统仍能正常工作
- [ ] 8.5 测试记忆检索性能：验证检索延迟在可接受范围内（需在生产环境验证）
- [ ] 8.6 测试记忆提取准确性：验证 LLM 提取的记忆质量（需在实际使用中验证）
- [x] 8.7 测试记忆合并逻辑：验证相似记忆正确合并（已在单元测试中覆盖）
- [x] 8.8 测试记忆过期机制：验证过期记忆不再出现在检索结果中（已在单元测试中覆盖）
- [x] 8.9 测试配置开关：验证禁用长期记忆后系统行为正确（已在集成测试中覆盖）

## 9. 文档与部署

- [x] 9.1 编写长期记忆系统架构文档（已完成：docs/long-term-memory-architecture.md）
- [x] 9.2 编写 API 使用文档（如何创建、检索、更新记忆）（已完成：docs/long-term-memory-api.md）
- [x] 9.3 编写配置说明文档（Supabase 配置、长期记忆配置项）（已完成：docs/long-term-memory-configuration.md）
- [x] 9.4 编写迁移指南（如何从无长期记忆版本升级）（已完成：docs/long-term-memory-migration.md）
- [x] 9.5 更新 README.md 添加长期记忆功能说明（已完成）
- [x] 9.6 准备 Supabase 表结构 SQL 脚本（用于生产部署）（已完成：sql/memories_schema.sql）
- [x] 9.7 准备生产环境配置示例（已完成：.env.production.example）
