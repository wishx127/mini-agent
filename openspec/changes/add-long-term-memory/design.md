## 上下文

当前 mini-agent 系统实现了基于 LangChain 的会话级短期记忆，使用 `SessionStore` 和 `InMemoryChatMessageHistory` 管理对话历史。短期记忆仅在当前会话有效，无法跨会话持久化用户偏好、关键事实等重要信息。

**现有架构**:

- `Controller`: 编排层，使用 `RunnableWithMessageHistory` 管理会话历史
- `SessionStore`: 内存级会话存储，键值对映射 sessionId → InMemoryChatMessageHistory
- 记忆闭环: 短期记忆拼接 → Token 预检 → 工具调用 → 生成回复 → 写入短期记忆

**约束**:

- 必须使用 Supabase 作为向量数据库后端
- 长期记忆系统必须与现有短期记忆系统协同工作
- 不能破坏现有的会话级对话历史功能
- 需要支持结构化记忆和语义检索

**利益相关者**:

- Agent 用户：期望个性化、持续改进的服务体验
- 开发者：需要清晰的 API 和可扩展的架构

## 目标 / 非目标

**目标**:

- 实现跨会话的长期记忆持久化存储
- 支持基于向量相似度的语义检索
- 实现从对话中自动提取重要信息并结构化存储
- 提供记忆管理能力（更新、遗忘、合并、分类）
- 与现有短期记忆系统无缝集成

**非目标**:

- 不实现成本计算功能（沿用现有 CostTracker）
- 不替换现有的短期记忆系统
- 不实现用户权限和多租户隔离（超出当前范围）
- 不实现记忆的可视化管理界面

## 决策

### 决策 1: 使用 Supabase 作为向量数据库

**选择**: Supabase (基于 PostgreSQL + pgvector 扩展)

**理由**:

- 提供开箱即用的向量存储和检索能力
- PostgreSQL 生态系统成熟，支持结构化查询和向量查询的混合
- 支持 ACID 事务，便于记忆的更新和删除
- 提供实时订阅能力，未来可扩展分布式场景
- 免费套餐足够开发和小规模使用

**备选方案**:

- Pinecone: 专业向量数据库，但学习曲线较陡，免费版限制较多
- ChromaDB: 本地优先，但不适合生产环境的多实例部署
- 自建 PostgreSQL + pgvector: 灵活但运维成本高

### 决策 2: 记忆提取使用 LLM 辅助

**选择**: 使用 LLM 从对话中提取结构化记忆

**理由**:

- 自动化程度高，无需人工标注
- 可以理解上下文，提取隐含信息（如用户偏好）
- 结构化输出可控（使用 JSON Schema）

**实现方式**:

- 在每次对话后，调用 LLM 分析对话内容
- 使用 structured output 确保输出格式符合预定义 schema
- 提取的记忆类型包括: user_preference, fact, experience, task, context

**备选方案**:

- 基于规则的提取: 难以处理复杂语义，覆盖面有限
- 纯向量化存储: 缺乏结构化信息，难以实现分类和合并

### 决策 3: 双记忆系统架构

**选择**: 长期记忆与短期记忆并行，在 prompt 中分别占位

**架构设计**:

```
用户问题
  ↓
长期记忆检索 (向量相似度) → top-k memories
  ↓
短期记忆拼接 (对话历史)
  ↓
Prompt 组装: system + long_term_memory + short_term_memory + human
  ↓
LLM 调用
  ↓
回复 + 提取重要信息 → 写入长期记忆
  ↓
对话历史 → 写入短期记忆
```

**理由**:

- 两种记忆职责不同: 短期记忆维护对话上下文，长期记忆存储跨会话知识
- 分离存储便于独立优化（检索效率、过期策略）
- 用户可以清除短期记忆（隐私），但保留长期记忆中的个性化信息

### 决策 4: 记忆过期与更新机制

**选择**: 基于时间戳和访问次数的混合策略

**实现细节**:

- 每条记忆包含: createdAt, lastAccessedAt, accessCount, expiresAt
- 过期策略: expiresAt < now() → 标记为 inactive
- 重写机制: 相似度 > 0.95 的记忆自动合并（保留最新内容）
- 访问频率: accessCount 高的记忆优先级更高

**理由**:

- 避免记忆无限增长
- 保持记忆的时效性和相关性
- 减少向量检索的噪音

**备选方案**:

- 纯时间过期: 无法处理长期有效的重要信息
- 纯 LRU 淘汰: 可能淘汰重要的低频访问记忆

### 决策 5: 向量嵌入使用 Qwen Embeddings

**选择**: `text-embedding-v3` 模型（阿里云百炼平台）

**理由**:

- 与现有 LLM 同源，兼容性好
- 性价比高: 0.0005 元/千 Token，Batch 调用 0.00025 元/千 Token
- 1024 维向量（默认），检索质量优秀
- 支持多维度输出：1024（默认）、768、512、256、128、64
- 支持中英日韩等 50+ 主流语种

**备选方案**:

- `text-embedding-v4`（Qwen3-Embedding 系列）：更新的版本，支持更多维度选择（最高 4096 维）
- OpenAI `text-embedding-3-small`: 成本较高，需要额外配置
- 开源模型 (如 sentence-transformers): 需要自建服务，增加运维复杂度

## 风险 / 依赖权衡

### 风险 1: Supabase 服务可用性

**风险**: Supabase 服务不可用导致长期记忆功能失效

**缓解**:

- 实现降级策略: Supabase 不可用时，仅使用短期记忆
- 记忆检索失败不应阻塞对话流程
- 本地缓存最近的记忆作为备份

### 风险 2: 记忆提取的准确性

**风险**: LLM 提取的记忆不准确或过于频繁

**缓解**:

- 使用 structured output 约束输出格式
- 设置提取阈值: 只提取置信度 > 0.7 的信息
- 实现用户反馈机制: 允许用户标记错误记忆
- 限制单次对话的记忆提取数量（最多 3 条）

### 风险 3: 向量检索性能

**风险**: 随着记忆数量增长，检索延迟增加

**缓解**:

- 使用 Supabase 的向量索引 (ivfflat 或 hnsw)
- 限制检索的 top-k 数量（默认 5）
- 实现 query embedding 的缓存
- 定期清理过期记忆，控制向量空间大小

### 风险 4: Embedding 成本

**风险**: 大量对话导致 embedding API 成本上升

**缓解**:

- 只对提取后的结构化记忆生成 embedding（不对原始对话）
- 使用 Qwen text-embedding-v3（性价比高：0.0005 元/千 Token）
- 使用 Batch 调用享受半价优惠（0.00025 元/千 Token）
- 实现批量 embedding 减少请求次数

## 迁移计划

### 阶段 1: 基础设施准备

1. 创建 Supabase 项目和表结构
2. 配置 pgvector 扩展
3. 创建记忆表 schema:
   ```sql
   CREATE TABLE memories (
     id UUID PRIMARY KEY,
     type VARCHAR(50),
     content TEXT,
     embedding VECTOR(1024),
     metadata JSONB,
     session_id VARCHAR(255),
     created_at TIMESTAMP,
     last_accessed_at TIMESTAMP,
     access_count INT DEFAULT 0,
     expires_at TIMESTAMP,
     is_active BOOLEAN DEFAULT true
   );
   CREATE INDEX ON memories USING ivfflat (embedding vector_cosine_ops);
   ```

### 阶段 2: 核心模块实现

1. 实现 `VectorDatabaseClient`: 封装 Supabase 连接和向量操作
2. 实现 `LongTermMemoryManager`: 记忆的 CRUD 和检索
3. 实现 `MemoryExtractor`: LLM 驱动的记忆提取
4. 定义记忆类型 schema

### 阶段 3: Controller 集成

1. 修改 Controller 初始化: 注入 LongTermMemoryManager
2. 修改 `execute()` 方法: 在短期记忆前增加长期记忆检索
3. 修改 prompt 模板: 添加 long_term_memory 占位符
4. 实现记忆提取和写入流程

### 阶段 4: 记忆管理功能

1. 实现过期清理定时任务
2. 实现记忆合并逻辑
3. 实现记忆更新接口
4. 实现记忆分类查询

### 阶段 5: 测试与优化

1. 单元测试: VectorDatabaseClient, LongTermMemoryManager
2. 集成测试: Controller 的长期记忆流程
3. 性能测试: 向量检索延迟
4. 降级测试: Supabase 不可用时的行为

### 回滚策略

- 长期记忆功能通过配置开关控制
- 关闭开关后，系统退化为纯短期记忆模式
- Supabase 表数据可导出备份
- 代码变更在独立分支，可快速回退

## 开放问题

1. **记忆提取的触发时机**: 是每次对话后都提取，还是在会话结束时批量提取？
   - 建议: 每次对话后提取，但实现节流（同一 session 最多每 5 分钟提取一次）

2. **记忆的隐私边界**: 是否允许用户查看和删除长期记忆？
   - 建议: 提供管理接口，支持查看、删除、标记隐私

3. **多用户隔离**: 当前 sessionId 是否足够标识用户？
   - 建议: 增加 userId 字段，实现多租户隔离

4. **记忆的权重计算**: 如何结合相似度、访问频率、时效性计算综合权重？
   - 建议: 实现可配置的评分函数，默认公式:
     ```
     score = similarity * 0.5 + accessCount_norm * 0.3 + recency_norm * 0.2
     ```
