## Why

当前 mini-agent 只能进行简单的联网搜索和对话，缺乏对本地文件系统的操作能力。为了提升 agent 的实用性，需要添加类似 Claude Code 的文件操作工具，让 agent 能够读取文件内容、搜索文件和匹配文件模式，从而更好地理解和操作用户的代码库。

## What Changes

- 新增 `Read` 工具：安全地读取文件内容，支持指定行范围
- 新增 `Glob` 工具：基于模式匹配查找文件（如 `**/*.ts`）
- 新增 `Grep` 工具：在文件内容中搜索匹配指定正则表达式的行
- 所有文件操作限制在项目根目录内，防止越权访问
- 集成到现有工具注册中心，使用 `@registerTool()` 装饰器自动注册

## Capabilities

### New Capabilities

- `file-read`: 读取文件内容，支持行范围选择和字符限制
- `file-glob`: 文件模式匹配搜索，支持 glob 语法
- `file-grep`: 文件内容正则搜索，支持多行匹配和上下文行

### Modified Capabilities

- 无现有 spec 需要修改

## Impact

- **代码影响**: 新增 `src/tools/plugins/file-operations/` 目录，包含三个工具实现
- **API 影响**: 新增三个工具可供 agent 调用
- **安全影响**: 需要实现路径安全检查，确保只能访问项目目录内文件
- **依赖影响**: 可能需要添加 `fast-glob` 或 `glob` 库用于文件匹配
