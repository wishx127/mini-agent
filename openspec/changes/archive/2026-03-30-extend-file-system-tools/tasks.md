# Tasks: 文件系统工具扩展

## 1. 扩展错误码定义

- [x] 1.1 在 `types.ts` 中新增写入、删除、移动相关错误码（WRITE_ERROR, FILE_ALREADY_EXISTS, IS_DIRECTORY, DELETE_ERROR, MOVE_ERROR, SOURCE_NOT_FOUND, USER_CANCELLED）
- [x] 1.2 验证错误码枚举导出正确

## 2. 增强路径验证器

- [x] 2.1 在 `path-validator.ts` 中添加 `ensureDirectoryExists` 辅助函数用于自动创建父目录
- [x] 2.2 添加 `isDirectory` 检查函数
- [x] 2.3 添加 `sourcePathExists` 检查函数（用于 Move 工具）

## 3. 实现 LS 工具

- [x] 3.1 创建 `ls-tool.ts` 文件，实现 LSTool 类
- [x] 3.2 实现目录内容读取和筛选逻辑（files/dirs/all）
- [x] 3.3 实现隐藏文件控制（show_hidden）
- [x] 3.4 实现递归遍历功能（recursive, max_depth）
- [x] 3.5 实现排序功能（sort_by: name/time）
- [x] 3.6 添加工具装饰器注册

## 4. 实现 Create 工具

- [x] 4.1 创建 `create-tool.ts` 文件，实现 CreateTool 类
- [x] 4.2 实现文件创建逻辑
- [x] 4.3 实现自动创建父目录功能
- [x] 4.4 实现文件已存在检查（根据 overwrite 参数决定行为）
- [x] 4.5 实现目录路径检查（防止用 create 创建目录）
- [x] 4.6 添加 `overwrite` 参数支持（默认 false）
- [x] 4.7 添加工具装饰器注册

## 5. 实现 Write 工具

- [x] 5.1 创建 `write-tool.ts` 文件，实现 WriteTool 类
- [x] 5.2 实现文件内容写入逻辑
- [x] 5.3 实现自动创建父目录功能
- [x] 5.4 实现 `overwrite` 参数支持（默认 true）
- [x] 5.5 添加工具装饰器注册

## 6. 实现 Delete 工具

- [x] 6.1 创建 `delete-tool.ts` 文件，实现 DeleteTool 类
- [x] 6.2 实现用户确认机制（返回确认请求，等待用户授权）
- [x] 6.3 实现文件删除逻辑
- [x] 6.4 实现目录删除防护（检查是否为目录）
- [x] 6.5 实现文件存在性验证
- [x] 6.6 添加工具装饰器注册

## 7. 实现 Move 工具

- [x] 7.1 创建 `move-tool.ts` 文件，实现 MoveTool 类
- [x] 7.2 实现文件移动/重命名逻辑
- [x] 7.3 实现自动创建目标父目录功能
- [x] 7.4 实现源文件存在性验证
- [x] 7.5 实现源文件是目录的防护
- [x] 7.6 实现 `overwrite` 参数支持（默认 false）
- [x] 7.7 添加工具装饰器注册

## 8. 更新文件操作模块导出

- [x] 8.1 更新 `file-operations/index.ts`，导出新增的工具类
- [x] 8.2 确保所有新工具都能被工具加载器正确加载

## 9. 测试验证

- [x] 9.1 测试 LS 工具的各种场景（列出目录、筛选、隐藏文件、递归、排序、深度限制）
- [x] 9.2 测试 Create 工具的各种场景（创建文件、父目录自动创建、文件已存在错误、覆盖模式）
- [x] 9.3 测试 Write 工具的各种场景（创建文件、覆盖文件、禁止覆盖模式）
- [x] 9.4 测试 Delete 工具的各种场景（删除文件、目录防护、路径安全、用户确认流程）
- [x] 9.5 测试 Move 工具的各种场景（移动文件、重命名、跨目录移动、覆盖模式、源文件验证）
- [x] 9.6 测试错误码和错误信息正确性
- [x] 9.7 运行 lint 检查确保代码风格一致

## 10. 文档更新

- [x] 10.1 更新 `docs/file-operations-architecture.md`，添加新工具说明
- [x] 10.2 验证所有新工具都有正确的 JSDoc 注释
