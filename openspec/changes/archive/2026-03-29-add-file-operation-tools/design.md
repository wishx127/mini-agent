## Context

当前 mini-agent 的工具系统基于 `BaseTool` 抽象类，使用 `@registerTool()` 装饰器自动注册工具。已有工具如 `TavilySearchTool` 展示了标准实现模式：继承 `BaseTool`，定义 `name`、`description`、`paramsSchema`，实现 `execute` 方法。

文件操作是 agent 的核心能力之一，Claude Code 等工具已证明其重要性。本项目需要添加三个基础文件操作工具：Read（读取文件）、Glob（文件模式匹配）、Grep（内容搜索）。

## Goals / Non-Goals

**Goals:**

- 实现安全、受限的文件读取能力
- 支持常见的文件搜索模式（glob 语法）
- 支持文件内容正则搜索
- 所有操作限制在项目根目录内
- 与现有工具注册中心无缝集成

**Non-Goals:**

- 文件写入/修改操作（本次只实现读取类工具）
- 二进制文件内容解析
- 大文件（>1MB）的完整读取

## Decisions

### 1. 路径安全策略

**决策**: 使用 `path.resolve()` + `fs.realpath()` + `startsWith()` 验证，确保所有路径（包括软链接解析后的真实路径）都在项目根目录内。

**实现细节**:

1. 使用 `path.resolve()` 将相对路径转换为绝对路径
2. 使用 `fs.realpath()` 解析所有软链接，获取真实路径
3. 使用 `startsWith()` 验证真实路径是否在项目根目录内

**软链接策略**:

- 允许项目内部的软链接
- 允许软链接指向项目外部（只要软链接本身在项目内）
- 最终验证的是解析后的真实路径

**示例**:

```
项目目录: /home/user/project
软链接: /home/user/project/link -> /etc/passwd
用户请求: ./link
path.resolve(): /home/user/project/link
fs.realpath(): /etc/passwd
验证: /etc/passwd.startsWith(/home/user/project)? ❌ 拒绝
```

**理由**:

- 防止目录遍历攻击，包括通过软链接的绕过
- 支持合法的软链接用例（如 monorepo 中的软链接）
- 比 chroot 或容器化更容易实现

**替代方案**:

- 使用 `fs.access()` 权限检查 - 不够，无法防止 `../../../etc/passwd`
- 完全禁止软链接 - 过于严格，影响合法用例
- 使用专用沙箱进程 - 过度设计，增加复杂性

### 2. 工具分类

**决策**: 所有文件操作工具归类为 `FILE_SYSTEM` 分类。

**理由**:

- 与现有分类体系一致
- 便于未来权限控制和审计

### 3. 依赖选择

**决策**:

- Glob: 使用 Node.js 内置 `fs.glob` (Node 22+) 或 `fast-glob`
- Grep: 使用原生 JavaScript 正则，不依赖外部命令

**理由**:

- 减少外部依赖，提高可移植性
- 避免调用系统命令的安全风险

### 4. 错误处理

**决策**: 统一使用 `ToolError` 类，包含错误码和友好消息。

**错误类型定义**:

```typescript
// 错误码枚举
enum FileOperationErrorCode {
  PATH_NOT_FOUND = 'PATH_NOT_FOUND',
  PATH_ACCESS_DENIED = 'PATH_ACCESS_DENIED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_ENCODING = 'INVALID_ENCODING',
  INVALID_REGEX = 'INVALID_REGEX',
  INVALID_GLOB_PATTERN = 'INVALID_GLOB_PATTERN',
}

// ToolError 类结构
class ToolError extends Error {
  code: FileOperationErrorCode;
  details?: Record<string, unknown>;

  constructor(
    code: FileOperationErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
```

**错误类型**:
| 错误码 | 消息模板 | 详情字段 |
|--------|----------|----------|
| `PATH_NOT_FOUND` | `File not found: {path}` | `{ path: string }` |
| `PATH_ACCESS_DENIED` | `Access denied: {path} is outside project directory` | `{ path: string, projectRoot: string }` |
| `FILE_TOO_LARGE` | `File too large: {path} (size: {size} MB, max: {maxSize} MB)` | `{ path: string, size: number, maxSize: number }` |
| `INVALID_ENCODING` | `File is not valid text: {path}` | `{ path: string, encoding: string }` |
| `INVALID_REGEX` | `Invalid regex pattern: {pattern} - {reason}` | `{ pattern: string, reason: string }` |
| `INVALID_GLOB_PATTERN` | `Invalid glob pattern: {pattern}` | `{ pattern: string }` |

**使用示例**:

```typescript
throw new ToolError(
  FileOperationErrorCode.FILE_TOO_LARGE,
  `File too large: ${path} (size: ${sizeMB} MB, max: ${maxSizeMB} MB)`,
  { path, size: sizeMB, maxSize: maxSizeMB }
);
```

### 5. 运行时通知

**决策**: 工具执行时在控制台输出操作通知，类似 Claude Code 的行为。

**通知内容**:

- **ReadTool**: `Reading file: <path>`
- **GlobTool**: `Searching files: <pattern>`
- **GrepTool**: `Searching in files: <pattern> -> <glob>`

**通知时机**: 在工具开始执行时立即输出，使用 `console.log()` 或类似的输出机制。

**理由**:

- 让用户实时了解 agent 正在访问哪些文件
- 与 Claude Code 保持一致的用户体验
- 无需额外的日志基础设施，简单直接

**非目标**:

- 不实现持久化日志存储
- 不实现结构化日志（JSON 格式）
- 不实现日志级别控制（DEBUG/INFO/WARN/ERROR）

### 6. LLM 上下文集成（工具结果格式化）

**决策**: ReadTool 返回的内容必须包含文件路径标识，确保 LLM 能明确知道内容的来源。

**格式化规范**:

```
[File: {file_path}]

{file_content}
```

**示例**:

```
[File: ./src/index.ts]

import { something } from 'lib';
export function foo() {
  return something();
}
```

**设计理由**:

- **明确性**: LLM 在 PLAN 阶段看到 toolMemory 时，能立即识别内容来源
- **一致性**: 无论是否使用 offset/limit，格式保持一致
- **可解析性**: 方括号格式易于 LLM 和人类阅读

**边界情况处理**:

- **空文件**: 返回 `[File: {path}]\n\n`（只有标识头，无内容）
- **offset/limit**: 路径标识始终在最前面，不受行范围影响
- **多文件读取**: 每个文件独立调用，各自包含路径标识

**与 ExecutionEngine 的集成**:

- toolMemory 存储的 result 字段包含格式化后的内容
- Planner 在 buildPlanningContext 时，toolMemory 中的结果自带文件来源信息
- 无需修改 ExecutionEngine，工具层自行处理格式化

## Risks / Trade-offs

| Risk                   | Mitigation                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| 路径遍历攻击           | 严格的路径验证，解析后检查是否在项目目录内                              |
| 大文件导致内存溢出     | 设置文件大小限制（默认 1MB），大文件返回错误                            |
| 二进制文件误读         | 检测文件编码，拒绝明显非文本文件                                        |
| 递归 glob 导致性能问题 | 限制递归深度（默认 10，最大 20），限制结果数量（默认 1000，最大 10000） |
| 正则表达式拒绝服务     | 设置正则执行超时（5 秒）                                                |

### 性能边界定义

**GlobTool 限制**:

- `maxDepth`: 默认 10，最大 20（超过最大值时按最大值处理）
- `limit`: 默认 1000，最大 10000（超过最大值时按最大值处理）

**GrepTool 限制**:

- `maxFiles`: 默认 1000，最大 10000
- `regexTimeout`: 5 秒（单个文件正则匹配超时时间）

**理由**:

- 防止恶意或意外的大量资源消耗
- 默认值满足绝大多数使用场景
- 硬上限防止参数被滥用

## Migration Plan

无需迁移，这是新增功能：

1. 创建工具文件
2. 运行测试验证
3. 合并到主分支

### 6. 编码检测策略

**决策**: 使用 BOM 检测 + ASCII/UTF-8 支持，不使用外部编码检测库。

**检测逻辑**:

1. 检测 BOM（UTF-8, UTF-16 LE/BE）
2. 无 BOM 时尝试 UTF-8 解码
3. 如果 UTF-8 解码失败，尝试 ASCII 解码（只接受 0-127 字节）
4. 都失败时抛出 `INVALID_ENCODING` 错误

**支持的编码**:

- UTF-8（带或不带 BOM）
- UTF-16 LE/BE（带 BOM）
- ASCII

**不支持的编码**:

- GBK、Shift-JIS、EUC-KR 等非 Unicode 编码（会报错）

**理由**:

- 现代项目基本都是 UTF-8 或 ASCII
- 避免增加外部依赖
- 用户可以将文件转换为 UTF-8 后重新读取

**替代方案**:

- 使用 `chardet` 或 `jschardet` 库 - 增加依赖，检测可能不准确

## Open Questions

无未解决问题。
