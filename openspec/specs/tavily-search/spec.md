## 新增需求

### 需求：Tavily 搜索工具执行网络搜索
Tavily 搜索工具必须接受搜索查询并从 Tavily API 返回相关的网络搜索结果。

#### 场景：搜索成功并返回结果
- **当** 用户提供有效的搜索查询且 Tavily API 密钥已配置
- **则** 返回包含标题、URL 和内容的搜索结果列表

#### 场景：使用空查询搜索
- **当** 用户使用空查询调用工具
- **则** 抛出错误，提示 "Search query cannot be empty"

### 需求：Tavily 搜索工具验证 API 密钥
Tavily 搜索工具必须在尝试搜索前检查 API 密钥是否可用。

#### 场景：未配置 API 密钥时搜索
- **当** 用户尝试在没有配置 TAVILY_API_KEY 的情况下搜索
- **则** 抛出错误，提示 "Tavily API key not configured. Please set TAVILY_API_KEY environment variable"

### 需求：Tavily 搜索工具处理 API 错误
Tavily 搜索工具必须优雅地处理 API 错误并提供有意义的错误信息。

#### 场景：API 返回错误
- **当** Tavily API 返回错误响应
- **则** 抛出包含 API 错误信息的错误

### 需求：Tavily 搜索工具与 LangChain 集成
Tavily 搜索工具必须兼容 LangChain 的 Tool 接口以便与 Agent 集成。

#### 场景：作为 LangChain 工具使用
- **当** 工具与 LangChain Agent 配合使用并通过 bindTools() 绑定
- **则** 工具接受一个包含 `query` 字符串字段的 JSON 对象