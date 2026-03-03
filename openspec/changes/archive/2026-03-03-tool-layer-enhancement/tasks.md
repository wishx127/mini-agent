# 实现任务：工具层增强

## 1. BaseTool 接口扩展

- [x] 1.1 为 BaseTool 类添加 `category` 可选属性
- [x] 1.2 为 BaseTool 类添加 `timeout` 可选属性
- [x] 1.3 为 BaseTool 类添加 `retryConfig` 可选属性
- [x] 1.4 为 BaseTool 类添加 `jsonSchema` 可选属性
- [x] 1.5 导出 ToolCategory 类型和 ToolCategories 枚举

## 2. 熔断器实现

- [x] 2.1 创建 `CircuitBreakerState` 枚举 (CLOSED, OPEN, HALF_OPEN)
- [x] 2.2 创建 `CircuitBreakerConfig` 接口
- [x] 2.3 实现带状态机的 `CircuitBreaker` 类
- [x] 2.4 实现带保护逻辑的 `execute()` 方法
- [x] 2.5 添加失败跟踪和阈值检测
- [x] 2.6 添加自动状态转换 (CLOSED→OPEN→HALF_OPEN→CLOSED)
- [x] 2.7 从 tools 模块导出 CircuitBreaker

## 3. 工具分类实现

- [x] 3.1 定义包含五种分类的 `ToolCategory` 类型
- [x] 3.2 创建 `ToolCategoryRegistry` 类用于分类管理
- [x] 3.3 实现 `getToolsByCategory()` 方法
- [x] 3.4 实现 `registerToolCategory()` 方法
- [x] 3.5 使用 Map 添加分类索引以实现 O(1) 查询

## 4. ToolRegistry 增强

- [x] 4.1 将 CircuitBreaker 集成到 ToolRegistry
- [x] 4.2 添加 `getToolBreaker(name)` 方法
- [x] 4.3 在注册表中添加 `getToolsByCategory()` 方法
- [x] 4.4 添加分类缓存机制
- [x] 4.5 处理未分类工具的 UNCATEGORIZED 默认值

## 5. Executor 集成

- [x] 5.1 更新 executor 使用工具级超时
- [x] 5.2 在执行前集成熔断器检查
- [x] 5.3 更新 CircuitOpenError 的错误处理
- [x] 5.4 在执行结果中添加熔断器状态

## 6. JSON Schema 支持

- [x] 6.1 添加 JSON Schema 验证工具函数
- [x] 6.2 在 BaseTool 中实现 `validateParams()` 方法
- [x] 6.3 添加用于 OpenAI 格式的 `getToolDefinition()`
- [x] 6.4 添加用于 Anthropic 格式的 `getAnthropicToolDefinition()`
- [x] 6.5 支持双格式 (Zod + JSONSchema)

## 7. 测试与文档

- [x] 7.1 编写 CircuitBreaker 单元测试
- [x] 7.2 编写 ToolCategories 单元测试
- [x] 7.3 编写 executor 集成测试
- [x] 7.4 更新 README 和 docs\tool-system-architecture.md 添加新功能说明
- [x] 7.5 为每个新功能添加使用示例
