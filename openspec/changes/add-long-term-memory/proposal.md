## Why

当前 agent 只有会话级的短期记忆（对话历史），无法跨会话持久化和检索重要信息。用户偏好、关键事实等重要信息在会话结束后丢失，导致无法提供个性化和持续改进的服务。需要实现长期记忆系统，能够提取、存储、检索和管理结构化的长期记忆，支持向量检索以实现语义化召回。

## What Changes

- 新增长期记忆存储系统，使用 Supabase 作为向量数据库后端
- 实现长期记忆读取流程：用户问题 → query embedding → 向量检索 → top-k memory → 注入 prompt
- 实现长期记忆写入流程：用户对话 → LLM 提取重要信息 → 生成 embedding → 写入向量数据库
- 支持结构化记忆类型（如 user_preference、fact、experience 等）
- 实现记忆管理能力：更新、遗忘（过期机制、重写机制）、合并、分类
- 与现有短期记忆系统协同工作，形成完整的双记忆系统

## Capabilities

### New Capabilities

- `long-term-memory`: 长期记忆系统，包括记忆的提取、存储、检索、更新、遗忘、合并和分类管理。使用向量数据库实现语义化检索，支持结构化记忆类型定义。

- `vector-database-client`: 向量数据库客户端，封装 Supabase 连接、embedding 生成、向量存储和检索操作。

### Modified Capabilities

- `memory-integration`: 需要集成长期记忆系统到现有的记忆闭环中，在短期记忆拼接基础上增加长期记忆检索步骤。

## Impact

- **新增代码**:
  - `VectorDatabaseClient`: Supabase 客户端封装
  - `LongTermMemoryManager`: 长期记忆管理器
  - `MemoryExtractor`: LLM 驱动的记忆提取器
  - 记忆类型定义和 schema

- **修改代码**:
  - Controller: 集成长期记忆检索到执行流程
  - Prompt 模板: 添加长期记忆占位符
  - 记忆闭环: 扩展为"长期记忆检索 → 短期记忆拼接 → Token 预检 → 工具调用 → 生成回复 → 写入长期记忆 → 写入短期记忆"

- **新增依赖**:
  - `@supabase/supabase-js`: Supabase 客户端
  - embedding 相关依赖

- **配置变更**:
  - 新增 Supabase 连接配置（URL、API Key）
  - embedding 模型配置
  - 记忆管理策略配置（过期时间、top-k 数量等）
