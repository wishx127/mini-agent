# File Operations 技术架构文档

## 概述

File Operations 是 mini-agent 框架的文件系统工具集，提供完整的文件操作能力，包括读取、写入、创建、删除、移动、搜索等功能，用于在安全的沙箱环境中执行文件操作。

## 技术栈

| 组件       | 技术/库              | 用途                    |
| ---------- | -------------------- | ----------------------- |
| 参数验证   | Zod                  | Schema 定义与运行时校验 |
| Glob 匹配  | fast-glob            | 高性能文件模式匹配      |
| 路径处理   | Node.js path/fs      | 文件系统操作            |
| 装饰器注册 | TypeScript Decorator | 工具自动注册            |
| 输出格式化 | chalk                | 终端彩色输出            |

## 架构设计

### 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Agent 执行层                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  ┌───────────┐   │
│  │   ReadTool  │  │   GlobTool  │  │     GrepTool        │  │  LSTool   │   │
│  │  (文件读取)  │  │ (模式匹配)   │  │   (内容搜索)         │  │ (目录列表) │   │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  └─────┬─────┘   │
│         │                │                    │                   │         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  ┌───────────┐   │
│  │  WriteTool  │  │  CreateTool │  │     DeleteTool      │  │  MoveTool │   │
│  │  (写入文件)  │  │ (创建文件)   │  │   (删除文件/目录)    │  │ (移动文件) │   │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  └─────┬─────┘   │
│         │                │                    │                   │         │
│  ┌─────────────┐         │                    │                   │         │
│  │  MkdirTool  │         └────────────────────┼───────────────────┘         │
│  │  (创建目录)  │                              │                             │
│  └──────┬──────┘                              │                             │
│         │                                     │                             │
│         └─────────────────────────────────────┼─────────────────────────────┘
│                                               │                             │
│         ┌─────────────────────────────────────┴─────────────────────────┐   │
│         │                      PathValidator                             │   │
│         │  (路径安全验证 / 文件类型检测 / 项目边界检查 / 授权管理)          │   │
│         └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│                   Tool Registry (工具注册表)                                  │
│              @registerTool() 装饰器自动收集                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. 模块职责

| 模块          | 文件                | 职责                                 |
| ------------- | ------------------- | ------------------------------------ |
| ReadTool      | `read-tool.ts`      | 读取文件内容，支持行范围选择         |
| GlobTool      | `glob-tool.ts`      | 文件模式匹配，支持深度限制和排序     |
| GrepTool      | `grep-tool.ts`      | 正则搜索文件内容，支持上下文显示     |
| LSTool        | `ls-tool.ts`        | 列出目录内容，支持递归和筛选         |
| CreateTool    | `create-tool.ts`    | 创建新文件，自动创建父目录           |
| WriteTool     | `write-tool.ts`     | 写入文件内容，支持覆盖控制           |
| DeleteTool    | `delete-tool.ts`    | 删除文件或目录，支持递归删除         |
| MoveTool      | `move-tool.ts`      | 移动/重命名文件，自动创建目标目录    |
| MkdirTool     | `mkdir-tool.ts`     | 创建新目录，支持递归创建             |
| PathValidator | `path-validator.ts` | 路径安全验证、文件大小检查、编码检测 |
| Types         | `types.ts`          | 错误码定义、自定义错误类             |
| Index         | `index.ts`          | 统一导出入口                         |

## 核心实现详解

### 1. ReadTool - 文件读取工具

**技术实现：**

```typescript
// 基于 Zod 的参数 Schema 定义
readonly paramsSchema = z.object({
  file_path: z.string().describe('要读取的文件路径'),
  offset: z.number().optional().describe('起始行号（从 1 开始）'),
  limit: z.number().optional().describe('最多读取的行数'),
});
```

**执行流程：**

1. **路径解析** → 使用 `path.resolve()` 将相对路径转为绝对路径（支持项目外路径）
2. **文件存在检查** → `fs.stat()` 确认文件存在
3. **软链接解析** → `fs.realpath()` 获取真实路径
4. **文件大小检查** → `validateFileSize()` 限制最大 1MB
5. **文本文件检测** → `validateTextFile()` 防止读取二进制文件
6. **内容读取** → `fs.readFile()` 读取 UTF-8 内容
7. **行范围提取** → `extractLines()` 处理 offset/limit 参数
8. **格式化输出** → 添加 `[File: path]` 标识头便于 LLM 识别

**安全机制：**

- 路径解析使用 `path.resolve()` + `fs.realpath()` 双重验证
- 软链接会被解析到真实路径后再进行范围检查
- 二进制文件通过检测 null 字节和 BOM 头识别

### 2. GlobTool - 文件模式匹配工具

**技术实现：**

```typescript
// fast-glob 配置选项
const globOptions: fastGlob.Options = {
  cwd: searchCwd,
  dot: true, // 包含隐藏文件
  followSymbolicLinks: true, // 跟随软链接
  deep: maxDepth, // 最大搜索深度
  ignore: exclude, // 排除模式
  absolute: true, // 返回绝对路径
  onlyFiles: true, // 仅返回文件
};
```

**执行流程：**

1. **确定搜索目录** → 默认项目根目录，支持自定义 `cwd`
2. **目录边界检查** → `isPathWithinProject()` 确保搜索范围不越界
3. **执行 Glob 搜索** → `fastGlob(pattern, options)` 获取匹配文件列表
4. **结果过滤** → 二次验证所有结果路径在项目目录内
5. **排序处理** → 支持按修改时间(`mtime`)或文件名(`name`)排序
6. **数量限制** → 默认最多返回 1000 个结果

**性能优化：**

- 使用 `fast-glob` 替代原生实现，支持并行搜索和缓存
- 搜索深度限制防止深层目录遍历
- 结果按需排序，避免不必要的 stat 调用

### 3. GrepTool - 文件内容搜索工具

**技术实现：**

```typescript
// 多行模式 vs 逐行模式
if (regex.multiline) {
  // 对整个文件内容执行正则匹配
  while ((match = globalRegex.exec(content)) !== null) {
    // 计算行号并提取上下文
  }
} else {
  // 逐行搜索，性能更优
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(line)) { ... }
  }
}
```

**执行流程：**

1. **正则编译** → `compileRegex()` 处理 `caseInsensitive` 和 `multiline` 标志
2. **文件列表获取** → 支持单文件(`path`)或批量模式(`glob`)
3. **逐文件搜索** → 跳过大于 1MB 的文件和二进制文件
4. **匹配提取** → 记录文件路径、行号、匹配内容
5. **上下文构建** → 根据 `contextLines` 参数添加前后文
6. **结果格式化** → 生成类 ripgrep 格式的输出

**输出格式示例：**

```
[File: src/utils.ts]
  42| function processData() {
  43|   const result = transform(input);
> 44|   return result.map(x => x.id);
  45| }

2 matches in 1 file
```

### 4. LSTool - 目录列表工具

**技术实现：**

```typescript
readonly paramsSchema = z.object({
  path: z.string().optional().describe('要列出的目录路径'),
  type: z.enum(['files', 'dirs', 'all']).optional().describe('筛选类型'),
  show_hidden: z.boolean().optional().describe('是否显示隐藏文件'),
  recursive: z.boolean().optional().describe('是否递归遍历'),
  max_depth: z.number().optional().describe('最大递归深度'),
  sort_by: z.enum(['name', 'time']).optional().describe('排序方式'),
});
```

**执行流程：**

1. **路径解析** → 解析目标目录路径（支持绝对路径和相对路径）
2. **目录验证** → 检查路径是否存在且为目录
3. **读取目录** → `fs.readdir()` 获取目录项
4. **类型筛选** → 根据 `type` 参数筛选文件或目录
5. **隐藏文件控制** → 根据 `show_hidden` 参数过滤隐藏文件
6. **递归遍历** → 根据 `recursive` 和 `max_depth` 递归处理子目录
7. **排序输出** → 根据 `sort_by` 参数按名称或时间排序

**输出格式示例：**

```
📂 Directory: src/tools

📁 file-operations/
📁 search/
📄 base.ts
📄 index.ts
📄 registry.ts

Total: 5 items
```

### 5. CreateTool - 创建文件工具

**技术实现：**

```typescript
readonly paramsSchema = z.object({
  file_path: z.string().describe('要创建的文件路径'),
  overwrite: z.boolean().optional().describe('是否覆盖已存在文件'),
  require_auth: z.boolean().optional().describe('是否已获取用户授权'),
});
```

**执行流程：**

1. **路径检查** → 检查路径是否以斜杠结尾（防止误将目录当文件）
2. **路径解析** → 解析完整路径（支持绝对路径和相对路径）
3. **项目边界检查** → `isPathWithinProject()` 检查路径是否在项目内
4. **授权验证** → 项目外路径需要 `require_auth` 授权
5. **文件存在检查** → 检查文件是否已存在，根据 `overwrite` 决定是否覆盖
6. **目录检查** → 确保路径不是已存在的目录
7. **创建父目录** → `ensureDirectoryExists()` 自动创建父目录
8. **创建文件** → `fs.writeFile()` 创建空文件

**安全机制：**

- 项目外路径需要显式授权（`require_auth: true`）
- 防止覆盖已存在文件（除非明确设置 `overwrite: true`）
- 自动创建父目录，但项目外需要授权

### 6. WriteTool - 写入文件工具

**技术实现：**

```typescript
readonly paramsSchema = z.object({
  file_path: z.string().describe('要写入的文件路径'),
  content: z.string().describe('要写入的内容'),
  overwrite: z.boolean().optional().describe('是否覆盖已存在文件，默认true'),
  require_auth: z.boolean().optional().describe('是否已获取用户授权'),
});
```

**执行流程：**

1. **路径解析** → 解析完整路径（支持绝对路径和相对路径）
2. **项目边界检查** → `isPathWithinProject()` 检查路径是否在项目内
3. **授权验证** → 项目外路径需要 `require_auth` 授权
4. **文件存在检查** → 检查文件是否已存在，根据 `overwrite` 决定是否覆盖
5. **创建父目录** → `ensureDirectoryExists()` 自动创建父目录
6. **写入内容** → `fs.writeFile()` 写入文件内容

**与 CreateTool 的区别：**

- WriteTool 用于写入内容，CreateTool 用于创建空文件
- WriteTool 默认允许覆盖（`overwrite: true`），CreateTool 默认不允许

### 7. DeleteTool - 删除文件/目录工具

**技术实现：**

```typescript
readonly paramsSchema = z.object({
  file_path: z.string().describe('要删除的文件或文件夹路径'),
  recursive: z.boolean().optional().default(false).describe('是否递归删除'),
  require_auth: z.boolean().optional().describe('是否已获取用户授权'),
});
```

**执行流程：**

1. **路径解析** → 解析完整路径（支持绝对路径和相对路径）
2. **项目边界检查** → `isPathWithinProject()` 检查路径是否在项目内
3. **授权验证** → 项目外路径需要 `require_auth` 授权
4. **存在检查** → `fs.stat()` 确认文件/目录存在
5. **执行删除** → `fs.rm()` 删除文件或目录（支持递归删除）

**安全机制：**

- 项目外路径需要显式授权
- 删除目录时需要设置 `recursive: true`
- 返回明确的删除确认信息

### 8. MoveTool - 移动/重命名文件工具

**技术实现：**

```typescript
readonly paramsSchema = z.object({
  source_path: z.string().describe('源文件路径'),
  target_path: z.string().describe('目标路径'),
  overwrite: z.boolean().optional().describe('是否覆盖已存在文件'),
  require_auth: z.boolean().optional().describe('是否已获取用户授权'),
});
```

**执行流程：**

1. **源路径解析** → 解析源文件路径并检查是否存在
2. **源路径边界检查** → 确保源路径在项目目录内
3. **源路径类型检查** → 确保源路径是文件而非目录
4. **目标路径解析** → 解析目标路径
5. **目标路径边界检查** → 项目外路径需要授权
6. **目标路径确定** → 如果目标是目录，将文件移入该目录
7. **覆盖检查** → 检查目标是否已存在，根据 `overwrite` 决定
8. **创建父目录** → 确保目标父目录存在
9. **执行移动** → `fs.rename()` 移动文件

**安全机制：**

- 源文件必须在项目目录内
- 目标路径在项目外需要授权
- 默认不覆盖已存在文件

### 9. MkdirTool - 创建目录工具

**技术实现：**

```typescript
readonly paramsSchema = z.object({
  dir_path: z.string().describe('要创建的目录路径'),
  recursive: z.boolean().optional().describe('是否递归创建父目录，默认true'),
  require_auth: z.boolean().optional().describe('是否已获取用户授权'),
});
```

**执行流程：**

1. **路径解析** → 解析完整路径（支持绝对路径和相对路径）
2. **项目边界检查** → `isPathWithinProject()` 检查路径是否在项目内
3. **授权验证** → 项目外路径需要 `require_auth` 授权
4. **存在检查** → 检查目录是否已存在
5. **创建目录** → `fs.mkdir()` 创建目录（支持递归创建）

### 10. PathValidator - 路径安全验证

**核心算法：**

```typescript
// 路径边界检查
export function isPathWithinProject(targetPath: string): boolean {
  const root = getProjectRoot();
  const normalizedTarget = path.normalize(targetPath);
  const normalizedRoot = path.normalize(root);

  // 添加路径分隔符确保精确匹配
  const targetWithSep = normalizedTarget.endsWith(path.sep)
    ? normalizedTarget
    : normalizedTarget + path.sep;
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;

  return (
    targetWithSep.startsWith(rootWithSep) || normalizedTarget === normalizedRoot
  );
}
```

**验证流程：**

1. **路径解析** → `path.resolve()` 将相对路径转为绝对路径
2. **项目边界检查** → `isPathWithinProject()` 验证路径在项目根目录内
3. **文件存在检查** → `fs.stat()` 确认文件/目录存在
4. **软链接解析** → `fs.realpath()` 获取真实路径
5. **二次边界检查** → 再次验证真实路径不越界

**新增功能：**

```typescript
// 获取项目根目录
export function getProjectRoot(): string;

// 确保目录存在（自动创建父目录）
export async function ensureDirectoryExists(
  filePath: string,
  requireAuth: boolean
): Promise<void>;

// 检查是否为目录
export async function isDirectory(targetPath: string): Promise<boolean>;

// 检查源路径是否存在（用于 Move 工具）
export async function sourcePathExists(sourcePath: string): Promise<boolean>;
```

**文本文件检测：**

```typescript
async function validateTextFile(filePath: string): Promise<void> {
  const fd = await open(filePath, 'r');
  const buffer = Buffer.alloc(1024);
  const result = await fd.read(buffer, 0, 1024, 0);

  // 检测 null 字节（二进制文件特征）
  if (sample.includes(0)) throw new ToolError(...);

  // 检测 BOM 头
  if (hasBOM(sample)) return;

  // 检查 UTF-8 有效性
  if (isValidUTF8(sample)) return;

  // 检查 ASCII 范围
  if (isValidASCII(sample)) return;

  throw new ToolError(...);
}
```

## 工具注册机制

### 装饰器注册

File Operations 使用 TypeScript 装饰器实现自动注册：

```typescript
// registry.ts
export function registerTool() {
  return function <T extends new () => BaseTool>(constructor: T): T {
    baseToolClasses.push(constructor);
    return constructor;
  };
}

// 使用示例
@registerTool()
export class ReadTool extends BaseTool {
  readonly name = 'read';
  // ...
}
```

### 加载流程

1. **装饰器收集** → 类定义时自动加入 `baseToolClasses` 数组
2. **Loader 扫描** → `tools/loader.ts` 导入 `file-operations/index.ts`
3. **实例化** → 通过反射创建工具实例
4. **注册到 Registry** → 添加到工具名称到实例的映射
5. **分类索引** → 根据 `category` 属性建立分类索引

## 与其他模块的联动

### 1. 与 Agent 执行引擎的集成

```
Agent Executor
      │
      ▼
┌─────────────────┐
│  Tool Registry  │ ◄── 通过名称查找工具实例
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   BaseTool.run  │ ◄── 参数验证 (Zod)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Tool.execute   │ ◄── 具体工具逻辑
└─────────────────┘
```

### 2. 与工具分类系统的集成

File Operations 属于 `ToolCategories.FILE_SYSTEM` 分类：

```typescript
// base.ts
export const ToolCategories = {
  INTERNAL: 'INTERNAL',
  EXTERNAL_API: 'EXTERNAL_API',
  FILE_SYSTEM: 'FILE_SYSTEM', // ← File Operations 所属分类
  VECTOR_SEARCH: 'VECTOR_SEARCH',
  SANDBOX: 'SANDBOX',
  UNCATEGORIZED: 'UNCATEGORIZED',
} as const;
```

分类用途：

- **权限控制** → 未来可基于分类实施细粒度权限
- **调用统计** → 按分类统计工具使用频率
- **UI 分组** → CLI 展示时按分类组织

### 3. 与 LLM 工具调用的集成

File Operations 通过 `toLangChainTool()` 方法转换为 LLM 可调用的格式：

```typescript
toLangChainTool(): LangChainToolDefinition {
  return {
    type: 'function',
    function: {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '...' },
          offset: { type: 'number', description: '...' },
          limit: { type: 'number', description: '...' },
        },
        required: ['file_path'],
      },
    },
  };
}
```

## 安全边界

### 路径沙箱

- **PROJECT_ROOT** 环境变量定义项目根目录
- 所有文件操作默认被限制在项目目录内
- 支持项目外路径操作，但需要显式授权（`require_auth: true`）
- 软链接会被解析并验证真实路径

### 授权机制

| 操作类型 | 项目内 | 项目外 |
| -------- | ------ | ------ |
| 读取     | 允许   | 允许   |
| 写入     | 允许   | 需授权 |
| 创建     | 允许   | 需授权 |
| 删除     | 允许   | 需授权 |
| 移动     | 允许   | 需授权 |
| 创建目录 | 允许   | 需授权 |

### 资源限制

| 限制项     | 默认值  | 说明                       |
| ---------- | ------- | -------------------------- |
| 文件大小   | 1MB     | 防止读取大文件导致内存溢出 |
| 搜索深度   | 10 层   | 防止深层目录遍历           |
| 结果数量   | 1000 个 | 防止返回过多结果           |
| 上下文行数 | 10 行   | grep 工具的上下文显示上限  |

### 错误处理

```typescript
export enum FileOperationErrorCode {
  // 原有错误码
  PATH_NOT_FOUND = 'PATH_NOT_FOUND',
  PATH_ACCESS_DENIED = 'PATH_ACCESS_DENIED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_ENCODING = 'INVALID_ENCODING',
  INVALID_REGEX = 'INVALID_REGEX',
  INVALID_GLOB_PATTERN = 'INVALID_GLOB_PATTERN',

  // 新增错误码
  WRITE_ERROR = 'WRITE_ERROR',
  FILE_ALREADY_EXISTS = 'FILE_ALREADY_EXISTS',
  IS_DIRECTORY = 'IS_DIRECTORY',
  DELETE_ERROR = 'DELETE_ERROR',
  MOVE_ERROR = 'MOVE_ERROR',
  SOURCE_NOT_FOUND = 'SOURCE_NOT_FOUND',
  USER_CANCELLED = 'USER_CANCELLED',
}
```

## 使用示例

### ReadTool

```typescript
// 读取整个文件
await readTool.execute({ file_path: 'src/index.ts' });

// 读取指定行范围
await readTool.execute({
  file_path: 'src/index.ts',
  offset: 10,
  limit: 20,
});
```

### GlobTool

```typescript
// 查找所有 TypeScript 文件
await globTool.execute({ pattern: '**/*.ts' });

// 限制深度并排除测试文件
await globTool.execute({
  pattern: 'src/**/*.ts',
  maxDepth: 5,
  exclude: ['**/*.test.ts', '**/*.spec.ts'],
  sortBy: 'mtime',
  order: 'desc',
});
```

### GrepTool

```typescript
// 在单文件中搜索
await grepTool.execute({
  pattern: 'function\s+\w+',
  path: 'src/utils.ts',
  contextLines: 2,
});

// 批量搜索
await grepTool.execute({
  pattern: 'TODO|FIXME',
  glob: '**/*.ts',
  caseInsensitive: true,
});
```

### LSTool

```typescript
// 列出当前目录
await lsTool.execute({});

// 递归列出目录，仅显示文件
await lsTool.execute({
  path: 'src',
  recursive: true,
  type: 'files',
  show_hidden: false,
  sort_by: 'name',
});
```

### CreateTool

```typescript
// 创建新文件
await createTool.execute({ file_path: 'src/new-file.ts' });

// 强制覆盖已存在文件
await createTool.execute({
  file_path: 'src/existing.ts',
  overwrite: true,
});
```

### WriteTool

```typescript
// 写入文件内容
await writeTool.execute({
  file_path: 'src/config.json',
  content: '{"key": "value"}',
});

// 不覆盖已存在文件
await writeTool.execute({
  file_path: 'src/important.ts',
  content: 'console.log("hello")',
  overwrite: false,
});
```

### DeleteTool

```typescript
// 删除文件
await deleteTool.execute({ file_path: 'src/old-file.ts' });

// 递归删除目录
await deleteTool.execute({
  file_path: 'src/old-folder',
  recursive: true,
});
```

### MoveTool

```typescript
// 重命名文件
await moveTool.execute({
  source_path: 'src/old-name.ts',
  target_path: 'src/new-name.ts',
});

// 移动文件到目录
await moveTool.execute({
  source_path: 'src/file.ts',
  target_path: 'src/utils/',
});
```

### MkdirTool

```typescript
// 创建目录
await mkdirTool.execute({ dir_path: 'src/new-folder' });

// 递归创建嵌套目录
await mkdirTool.execute({
  dir_path: 'src/nested/deep/folder',
  recursive: true,
});
```

---

_文档版本: 2.0_
_最后更新: 2026-03-30_
