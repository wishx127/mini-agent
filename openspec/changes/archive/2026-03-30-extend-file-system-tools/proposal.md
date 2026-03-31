# Proposal: 扩展文件系统工具能力

## Why

当前工具层仅实现了文件查找（glob）和内容读取（read/grep）功能，无法满足完整的文件操作需求。为了提供与 Claude Code 类似的开发体验，需要扩展文件系统基础能力，支持目录遍历、文件创建、内容写入、文件删除、文件移动等核心操作，使 Agent 能够自主完成代码生成、文件管理和项目维护任务。

## What Changes

- **新增 `LS` 工具**: 遍历目录结构，列出指定目录中的文件和子目录，支持递归遍历和排序
- **新增 `Create` 工具**: 创建新文件，支持自动创建父目录，支持覆盖控制
- **新增 `Write` 工具**: 写入文件内容，支持创建新文件或覆盖现有文件，自动创建父目录
- **新增 `Delete` 工具**: 删除文件，执行前需要用户手动确认授权
- **新增 `Move` 工具**: 移动或重命名文件，支持覆盖控制
- **扩展错误码**: 在 `FileOperationErrorCode` 中新增写入和移动相关错误类型
- **增强路径验证**: 支持写入操作的路径安全检查和目录自动创建

## Capabilities

### New Capabilities

- `file-ls`: 目录遍历工具，支持递归、排序、深度控制
- `file-create`: 文件创建工具，支持自动创建父目录和覆盖控制
- `file-write`: 文件写入工具，写入内容到文件（新建或覆盖）
- `file-delete`: 文件删除工具，需要用户确认授权
- `file-move`: 文件移动/重命名工具，支持跨目录移动

### Modified Capabilities

- `file-operation-types`: 扩展错误码枚举，新增写入、删除、移动相关错误类型

## Impact

**Affected Code:**

- `src/tools/plugins/file-operations/` - 新增工具实现文件
- `src/tools/plugins/file-operations/types.ts` - 扩展错误码定义
- `src/tools/plugins/file-operations/index.ts` - 导出新增工具
- `src/tools/plugins/file-operations/path-validator.ts` - 增强路径验证逻辑

**APIs:**

- 新增 5 个工具注册到工具注册表
- 扩展现有文件操作工具类别

**Dependencies:**

- 依赖现有 `fs/promises` API
- 依赖 `chalk` 用于控制台输出
- 依赖 `zod` 用于参数校验

**Systems:**

- 工具注册和发现系统
- Agent 执行引擎（通过工具调用）
- 路径安全验证系统
- 用户确认交互系统（Delete 工具）
