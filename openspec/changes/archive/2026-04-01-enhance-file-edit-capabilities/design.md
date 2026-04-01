## Context

当前项目已具备基本的文件操作能力，包括文件的读取和写入。但在实际开发场景中，经常需要对文件进行局部修改、内容替换或差异比较，而全量覆盖写入存在以下问题：

1. **效率低下**：即使只修改一行，也需要重写整个文件
2. **容易出错**：全量覆盖可能导致意外覆盖其他未预期的内容
3. **缺乏版本控制支持**：无法生成标准的差异格式用于版本追踪
4. **数据安全风险**：操作失败可能导致文件损坏
5. **并发冲突**：多进程同时修改同一文件会导致数据竞争

本项目需要引入精细的文件编辑能力，支持 patch 局部修改、edit 文本替换和 diff 差异比较，同时保证数据安全和并发安全。

## Goals / Non-Goals

**Goals:**

- 实现基于统一差异格式（Unified Diff）的文件局部修改能力
- 提供便捷的搜索替换接口，支持文本内容的查找和替换
- 实现文件内容差异比较，生成标准格式的差异报告
- **支持目录级别的递归 diff 比较**
- 支持行级编辑操作（插入、删除、替换）
- 提供完善的错误处理和验证机制
- **保证操作原子性**：操作失败时文件内容不受影响
- **支持并发控制**：防止多进程同时修改导致的冲突
- **支持用户授权机制**：文件修改操作需要用户授权后才能执行

**Non-Goals:**

- 不实现二进制文件的 diff/patch 支持
- 不实现三路合并（3-way merge）功能
- 不实现交互式冲突解决
- 不替代版本控制系统（Git/SVN）的核心功能
- 不实现实时协作编辑（如 OT/CRDT 算法）
- **不实现撤销操作**（通过原子写入保证数据安全，无需备份机制）
- **不实现无授权的文件修改**（所有修改操作必须获得用户授权）

## Decisions

### 1. 使用 `diff` 和 `patch` 算法库

**决策**: 使用成熟的 `diff` 算法库（如 `diff` npm 包）来实现差异计算，而不是自行实现。

**理由**:

- 差异算法（Myers 算法等）实现复杂，成熟库经过充分测试
- 社区维护的库有更好的性能和边界情况处理
- 减少维护成本

**替代方案考虑**:

- 自行实现：可以更好地控制输出格式，但开发成本高
- 使用系统命令（`diff`, `patch`）：依赖系统环境，跨平台兼容性差

### 2. API 设计采用函数式接口

**决策**: 提供独立的函数接口：`applyPatch()`, `editFile()`, `diffFiles()`, `diffStrings()`, `getFileHash()`，而不是面向对象的类设计。

**理由**:

- 与现有文件操作 API 风格保持一致
- 使用简单，调用方无需管理对象生命周期
- 便于测试和 tree-shaking

**替代方案考虑**:

- 类/对象设计：可以维护状态，但对于无状态文件操作过于复杂

### 3. 统一错误处理策略

**决策**: 所有操作返回统一格式的结构化结果对象，包含 `success` 标志、结构化 `error` 信息、性能元数据等。

**理由**:

- 调用方可以程序化地处理不同类型的错误（通过 `error.code`）
- 便于调试和日志记录（`affectedRanges`, `executionTime`）
- 避免使用异常作为控制流

**接口定义**:

```typescript
interface EditResult {
  success: boolean;
  error?: {
    code:
      | 'PATCH_MISMATCH'
      | 'FILE_NOT_FOUND'
      | 'VALIDATION_ERROR'
      | 'IO_ERROR'
      | 'CONCURRENT_MODIFICATION'
      | 'PERMISSION_DENIED'
      | 'FILE_TOO_LARGE'
      | 'ENCODING_ERROR'
      | 'WRITE_TEMP_FAILED'
      | 'RENAME_FAILED';
    message: string;
    details?: any;
  };
  changes?: number;
  affectedRanges?: Array<{ startLine: number; endLine: number }>;
  executionTime?: number;
}
```

### 4. 操作原子性保证（临时文件 + 原子重命名）

**决策**: 所有修改操作采用"临时文件 + 原子重命名"策略保证原子性。

**流程**:

1. 读取原文件内容
2. 在内存中生成新内容
3. 写入临时文件（`filename.tmp`）
4. 使用原子重命名（`fs.rename`）替换原文件
5. 重命名失败时删除临时文件

**理由**:

- 原子重命名保证文件始终处于完整状态
- 无需备份文件管理，避免备份堆积问题
- 实现简单，跨平台兼容性好

**替代方案考虑**:

- 备份 + 回滚：需要管理备份文件生命周期，增加复杂性
- 事务日志（WAL）：过于复杂，不适合此场景

### 5. 并发控制（乐观锁）

**决策**: 采用乐观锁机制防止并发修改冲突。

**实现**:

- API 添加可选的 `expectedHash` 参数
- 写入前计算当前文件内容的 SHA-256 hash，与 `expectedHash` 比较
- 不匹配时返回 `CONCURRENT_MODIFICATION` 错误
- 由调用方决定是否重试
- 提供 `getFileHash(filePath)` 辅助函数供调用者获取文件 hash

**理由**:

- 不依赖额外库，跨平台兼容性好
- 适合读多写少的场景
- 符合现代分布式系统的常见模式

**替代方案考虑**:

- 文件锁（flock）：依赖平台特定实现，Windows 支持有限
- 不处理：风险转移给调用方

### 6. Patch 应用采用严格模式 + dryRun

**决策**:

- 所有 hunk 验证通过后才执行实际写入（原子性）
- 添加 `dryRun` 选项，默认值为 `true`（安全优先）

**理由**:

- 防止文件处于部分修改状态
- 默认安全，避免意外修改
- 符合大多数用户的预期（要么全成功，要么全失败）

### 7. 性能优化（分块处理 + 文件大小限制）

**决策**:

- 使用分块处理支持大文件
- 添加 `maxFileSize` 参数，默认值为 1MB
- 超过阈值时返回 `FILE_TOO_LARGE` 错误

**理由**:

- 分块处理避免内存溢出
- 默认限制保护意外的大文件处理
- 设置为 `null` 可禁用限制

### 8. 模糊匹配支持

**决策**: Edit 操作默认精确匹配，支持通过 `matchOptions` 启用灵活匹配。

**支持选项**:

- `ignoreWhitespace`: 忽略空白字符差异
- `caseInsensitive`: 忽略大小写
- `wholeWord`: 全词匹配

**理由**:

- 向后兼容（不传选项时保持精确匹配）
- 满足常见需求，避免正则表达式的复杂性
- 行为可预测

### 9. 文件编码处理

**决策**:

- 默认使用 UTF-8 编码
- 支持通过选项指定其他编码
- 支持自动检测文件编码（通过 BOM 或 chardet）

**理由**:

- UTF-8 是现代项目的标准编码
- 自动检测提高易用性
- 显式指定编码可以避免编码检测的不确定性

### 10. 目录递归 diff 支持

**决策**: `diffFiles()` 函数支持目录级别的递归比较。

**实现**:

- 当传入的两个路径都是目录时，递归比较目录内所有文件
- 生成包含多个文件差异的合并 diff 输出
- 支持 `recursive` 选项控制是否递归子目录（默认 `true`）
- 支持 `exclude` 选项排除特定文件/目录模式

**理由**:

- 满足常见需求（比较两个版本的代码目录）
- 与 Git diff 目录的行为一致
- 复用现有的文件遍历能力

### 11. 用户授权机制

**决策**: 所有文件修改操作（`applyPatch`, `editFile`）必须通过用户授权后才能执行实际写入。

**实现**:

- 修改操作前自动调用 `authManager.askForAuth()` 获取用户授权
- **获得授权后**，执行实际的文件修改并写入
- **修改完成后**，生成 diff 预览作为结果返回给用户
- 授权状态可以缓存，避免同一操作重复询问
- 提供 `requireAuth` 选项，允许调用方显式控制是否需要授权（默认 `true`）

**授权流程**:

```
调用 applyPatch/editFile
  ↓
检查 requireAuth 和授权状态
  ↓ 需要授权且未授权
调用 authManager.askForAuth() 询问用户
  ↓
用户授权？
  ↓ 否
返回错误 UNAUTHORIZED_OPERATION

  ↓ 是 或 不需要授权
执行文件修改（apply patch / edit）
  ↓
原子写入文件（temp + rename）
  ↓
生成修改后的 diff 预览
  ↓
返回成功结果（包含 diff、changes、affectedRanges 等）
```

**理由**:

- 保证用户对文件修改有完全控制权
- 修改完成后返回 diff，让用户确认实际变更内容
- 复用现有的 `authManager` 授权基础设施
- 符合安全最佳实践

## Risks / Trade-offs

| Risk                           | Mitigation                                                          |
| ------------------------------ | ------------------------------------------------------------------- |
| Patch 应用失败（上下文不匹配） | 提供 `dryRun` 选项预先验证；清晰的错误信息                          |
| 大文件性能问题                 | 分块处理；`maxFileSize` 限制；可禁用限制处理超大文件                |
| 并发编辑冲突                   | 乐观锁机制（`expectedHash`）；清晰的 `CONCURRENT_MODIFICATION` 错误 |
| 编码问题导致乱码               | 默认 UTF-8；支持编码检测；提供编码选项                              |
| 操作失败导致数据丢失           | 临时文件 + 原子重命名机制保证原子性                                 |
| 临时文件残留                   | 重命名失败时清理临时文件；提供清理工具                              |
| 正则表达式性能陷阱             | 使用简单的匹配选项，避免完整正则支持                                |
| 软链接处理不当                 | 明确定义行为：默认跟随链接，提供选项控制                            |
| 换行符不一致                   | 自动识别并保留原换行符风格                                          |
| 未授权的文件修改               | 所有修改操作必须通过 `authManager` 获取用户授权                     |

## API 设计

### applyPatch(filePath, patch, options?)

```typescript
interface ApplyPatchOptions {
  dryRun?: boolean; // 默认 true
  encoding?: string; // 默认 'utf8'
  expectedHash?: string; // 乐观锁，SHA-256 hash
  requireAuth?: boolean; // 默认 true，是否需要用户授权
}

interface ApplyPatchResult extends EditResult {
  hunks?: number;
  hunksValid?: number;
  diff?: string; // 未授权时返回 diff 预览
  authorized?: boolean; // 是否已获得用户授权
}
```

### editFile(filePath, options)

```typescript
interface EditFileOptions {
  search: string;
  replace: string;
  replaceAll?: boolean; // 默认 false
  matchOptions?: {
    ignoreWhitespace?: boolean;
    caseInsensitive?: boolean;
    wholeWord?: boolean;
  };
  encoding?: string;
  expectedHash?: string; // 乐观锁，SHA-256 hash
  requireAuth?: boolean; // 默认 true，是否需要用户授权
}

interface EditFileResult extends EditResult {
  diff?: string; // 未授权时返回 diff 预览
  authorized?: boolean; // 是否已获得用户授权
}
```

### diffFiles(fileA, fileB, options?)

```typescript
interface DiffOptions {
  contextLines?: number; // 默认 3
  maxFileSize?: number; // 默认 1MB，null 表示无限制
  encoding?: string;
  recursive?: boolean; // 默认 true，目录比较时递归子目录
  exclude?: string[]; // 排除模式，如 ['node_modules', '*.log']
}

interface DiffResult extends EditResult {
  diff?: string;
  addedLines?: number;
  removedLines?: number;
  hunks?: number;
  filesCompared?: number; // 目录比较时统计比较的文件数
}
```

### diffStrings(strA, strB, options?)

```typescript
interface DiffStringsOptions {
  contextLines?: number; // 默认 3
}

interface DiffStringsResult extends EditResult {
  diff?: string;
  addedLines?: number;
  removedLines?: number;
  hunks?: number;
}
```

### getFileHash(filePath, options?)

```typescript
interface GetFileHashOptions {
  encoding?: string; // 默认 'utf8'
}

interface GetFileHashResult {
  success: boolean;
  hash?: string; // SHA-256 hash 值
  error?: {
    code: 'FILE_NOT_FOUND' | 'PERMISSION_DENIED' | 'IO_ERROR';
    message: string;
  };
}
```

## Migration Plan

本项目将新功能集成到现有的 `file-operations` 插件目录中。集成步骤：

1. **安装依赖**: 添加 `diff` 等相关 npm 包
2. **创建工具文件**: 在 `src/tools/plugins/file-operations/` 下创建：
   - `diff-tool.ts` - 文件/字符串比较功能
   - `patch-tool.ts` - Patch 应用功能
   - `edit-tool.ts` - 文件编辑功能
3. **更新索引**: 修改 `src/tools/plugins/file-operations/index.ts` 导出新工具
4. **注册工具**: 更新主工具注册表，注册新工具
5. **功能测试**: 在非生产环境测试各项功能
6. **文档更新**: 更新 API 文档，添加使用示例

## 目录结构

```
src/tools/plugins/file-operations/
├── index.ts              # 更新：导出所有工具（含新增）
├── types.ts              # 可能需要更新：添加新类型定义
├── read-tool.ts
├── write-tool.ts
├── create-tool.ts
├── delete-tool.ts
├── move-tool.ts
├── mkdir-tool.ts
├── ls-tool.ts
├── glob-tool.ts
├── grep-tool.ts
├── diff-tool.ts          # 新增：文件/字符串比较
├── patch-tool.ts         # 新增：Patch 应用
├── edit-tool.ts          # 新增：文件编辑（search/replace）
└── path-validator.ts
```

## Open Questions

1. ~~是否需要支持二进制文件的 diff？~~ **决策**: 不支持
2. ~~是否需要支持目录级别的递归 diff？~~ **决策**: 支持
3. ~~是否需要支持 patch 的部分应用？~~ **决策**: 不支持，保持原子性
