## 新增需求

### 需求：工具注册中心提供已注册工具列表
工具注册中心必须维护所有可用工具的列表，包含工具名称、描述和参数模式。

#### 场景：获取所有已注册工具
- **当** 调用方执行 `registry.getTools()`
- **则** 返回包含名称、描述和参数模式的所有已注册工具定义数组

#### 场景：仅获取已启用的工具
- **当** 调用方执行 `registry.getEnabledTools()`
- **则** 仅返回 `enabled` 为 true 的工具

### 需求：工具注册中心支持动态启用/禁用
工具注册中心必须允许在运行时启用或禁用工具，无需修改代码。

#### 场景：启用工具
- **当** 调用方执行 `registry.enableTool('tavily-search')`
- **则** 工具的启用状态设置为 true

#### 场景：禁用工具
- **当** 调用方执行 `registry.disableTool('tavily-search')`
- **则** 工具的启用状态设置为 false

### 需求：工具注册中心验证工具定义
工具注册中心必须在注册工具时验证工具定义，确保必填字段存在。

#### 场景：注册缺少必填字段的工具
- **当** 调用方尝试注册一个缺少 `name` 字段的工具
- **则** 抛出错误，提示 "Tool definition must include name, description, and schema"

### 需求：可通过注册中心执行工具
工具注册中心必须提供按名称和给定参数执行工具的方法。

#### 场景：执行已存在的工具
- **当** 调用方执行 `registry.executeTool('tavily-search', { query: 'AI news' })`
- **则** 使用提供的参数执行工具并返回结果

#### 场景：执行不存在的工具
- **当** 调用方执行 `registry.executeTool('non-existent-tool', {})`
- **则** 抛出错误，提示 "Tool 'non-existent-tool' not found"