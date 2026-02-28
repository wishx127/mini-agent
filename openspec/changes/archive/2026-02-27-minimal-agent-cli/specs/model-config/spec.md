## ADDED Requirements

### Requirement: 模型基础配置

系统必须支持配置LLM模型的基础参数，包括baseURL和模型名称。

#### Scenario: 配置自定义baseURL

- **WHEN** 用户在配置中指定自定义的baseURL
- **THEN** 系统使用该baseURL进行模型API调用
- **THEN** 配置的baseURL被正确传递给LangChain LLM实例

#### Scenario: 默认配置回退

- **WHEN** 用户未指定baseURL配置
- **THEN** 系统使用预定义的默认baseURL

### Requirement: 环境变量配置支持

系统必须支持通过环境变量配置模型参数。

#### Scenario: 环境变量配置

- **WHEN** 环境变量中设置了模型配置参数
- **THEN** 系统优先使用环境变量中的配置
- **THEN** 环境变量配置覆盖配置文件中的设置

#### Scenario: 配置参数验证

- **WHEN** 配置的baseURL格式无效
- **THEN** 系统返回配置错误提示
- **THEN** 错误信息指明具体的配置问题

### Requirement: 配置文件支持

系统必须支持通过配置文件管理模型设置。

#### Scenario: 配置文件读取

- **WHEN** 配置文件存在且格式正确
- **THEN** 系统读取配置文件中的模型配置
- **THEN** 配置参数被正确应用到模型实例

#### Scenario: 配置文件缺失处理

- **WHEN** 配置文件不存在
- **THEN** 系统使用默认配置或环境变量配置
- **THEN** 系统继续正常运行
