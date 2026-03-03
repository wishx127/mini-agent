# JSON Schema 参数规范

## 新增需求

### 需求：JSON Schema 参数支持

BaseTool 接口必须支持 JSON Schema 格式的参数定义。

#### 场景：工具使用 JSON Schema 定义参数

- **当** 工具的 parametersSchema 定义为 JSON Schema 对象时
- **则** 应被接受并存储
- **且** 应可转换为 OpenAI 函数调用格式

#### 场景：Zod 向后兼容

- **当** 工具的 parametersSchema 定义为 ZodType 时
- **则** 应继续像以前一样工作
- **且** 现有工具无需任何更改

#### 场景：同时定义了 Zod 和 JSON Schema

- **当** 工具同时定义了 Zod 和 JSON Schema 参数时
- **则** JSON Schema 应在生成工具定义时优先使用
- **且** Zod 应在运行时验证时使用（如果可用）

### 需求：工具定义生成

系统必须生成 LLM 兼容的工具定义。

#### 场景：从 JSON Schema 生成 OpenAI 格式

- **当** 对具有 JSON Schema 的工具调用 getToolDefinition 时
- **则** 应生成 OpenAI 函数调用兼容的输出
- **且** parameters 字段应包含有效的 JSON Schema

#### 场景：从 JSON Schema 生成 Anthropic 格式

- **当** 对具有 JSON Schema 的工具调用 getAnthropicToolDefinition 时
- **则** 应生成 Anthropic 工具使用兼容的输出

### 需求：参数验证

系统必须根据定义的模式验证传入的参数。

#### 场景：根据 JSON Schema 验证

- **当** 使用参数调用 execute 时
- **则** 参数应根据 JSON Schema 进行验证
- **且** 无效参数应被拒绝并返回验证错误

#### 场景：验证错误消息格式

- **当** 参数验证失败时
- **则** 错误消息应包含具体的验证失败原因
- **且** 应指出哪个参数验证失败
