# Git/Bash 工具文档

## 概述

本模块提供两个核心执行工具：**Git 工具** 和 **Bash 工具**。它们共同为 Agent 提供操作系统级别的版本控制能力和 shell 命令执行能力，同时通过多层安全机制确保系统稳定性。

## 能力介绍

### Git 工具

Git 工具封装了常用的 Git 操作，支持以下功能：

| 操作         | 功能说明                                               |
| ------------ | ------------------------------------------------------ |
| `git_clone`  | 克隆远程仓库，支持指定分支和浅克隆                     |
| `git_status` | 查看仓库当前状态，包括分支、已修改、已暂存、未跟踪文件 |
| `git_branch` | 分支管理：列出、创建、删除、切换分支                   |
| `git_commit` | 提交更改，支持直接传入 message 或通过 IDE API 获取     |
| `git_push`   | 推送到远程仓库                                         |
| `git_pull`   | 从远程仓库拉取更新                                     |
| `git_log`    | 查看提交历史                                           |
| `git_reset`  | 重置提交（soft/mixed/hard 模式）                       |
| `git_clean`  | 清理未跟踪文件                                         |

### Bash 工具

Bash 工具提供受控的 shell 命令执行能力：

| 参数        | 说明             |
| ----------- | ---------------- |
| `command`   | 要执行的命令     |
| `args`      | 命令参数列表     |
| `cwd`       | 工作目录         |
| `timeout`   | 超时时间（毫秒） |
| `env`       | 额外的环境变量   |
| `confirmed` | 确认执行危险操作 |

## 架构设计

### 模块结构

```
src/tools/plugins/
├── git/
│   ├── index.ts           # 入口导出
│   ├── git-tool.ts        # Tool 类定义（@registerTool 装饰器）
│   ├── git-tools.ts       # 业务逻辑实现
│   ├── git-executor.ts    # Git 命令执行器
│   └── types.ts           # 类型定义
└── bash/
    ├── index.ts           # 入口导出
    ├── bash-tool.ts       # Tool 类定义
    └── bash-executor.ts   # Bash 命令执行器
```

### 分层职责

| 层级    | 组件                                  | 职责                             |
| ------- | ------------------------------------- | -------------------------------- |
| Tool 层 | `git-tool.ts`, `bash-tool.ts`         | 参数验证、结果格式化、用户交互   |
| 业务层  | `git-tools.ts`                        | Git 业务逻辑、参数组装、结果解析 |
| 执行层  | `git-executor.ts`, `bash-executor.ts` | 命令执行、输出收集、超时处理     |
| 安全层  | `command-security/`                   | 危险命令检测、路径验证、并发控制 |
| 审计层  | `audit-logger/`                       | 操作日志记录                     |

## 核心技术实现

### 1. 工具注册机制

使用 TypeScript 装饰器 `@registerTool()` 自动注册工具到全局注册表：

```typescript
@registerTool()
export class GitCloneTool extends BaseTool {
  readonly name = 'git_clone';
  readonly description = '从远程仓库克隆代码到本地目录';
  readonly paramsSchema = z.object({
    url: z.string().describe('远程仓库 URL'),
    // ...
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    // 实现
  }
}
```

### 2. 参数验证

基于 `zod` 的运行时参数验证，确保输入安全：

```typescript
readonly paramsSchema = z.object({
  url: z.string().url().describe('远程仓库 URL'),
  branch: z.string().optional(),
  depth: z.number().min(1).optional(),
});
```

### 3. 命令执行模型

**GitExecutor** 和 **BashExecutor** 采用统一的执行模型：

```
┌─────────────────────────────────────────┐
│           执行请求入口                    │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────▼──────────────┐
    │     前置检查                 │
    │  • Git 安装检查              │
    │  • 并发限制检查               │
    │  • 工作目录验证              │
    └─────────────┬──────────────┘
                  │
    ┌─────────────▼──────────────┐
    │     命令执行                 │
    │  • spawn/execFile           │
    │  • 超时控制                  │
    │  • 输出截断                  │
    └─────────────┬──────────────┘
                  │
    ┌─────────────▼──────────────┐
    │     后置处理                 │
    │  • 审计日志记录              │
    │  • 资源释放                  │
    └─────────────────────────────┘
```

### 4. 安全机制

#### 4.1 危险命令检测

通过 `dangerous-patterns.ts` 检测高风险命令：

| 检测类别 | 示例命令          | 处理方式 |
| -------- | ----------------- | -------- |
| 文件删除 | `rm -rf /`, `del` | 直接拒绝 |
| 网络操作 | `curl`, `wget`    | 需要确认 |
| 系统修改 | `chmod`, `chown`  | 需要确认 |
| 进程操作 | `kill -9`         | 需要确认 |

#### 4.2 路径验证

防止路径遍历攻击，确保操作在允许范围内：

```typescript
validateWorkingDirectory(cwd) → { valid: boolean, resolvedPath?: string }
```

#### 4.3 并发限制

使用 `ConcurrencyLimiter` 限制同时执行的命令数量（默认 3 个），避免系统过载。

#### 4.4 超时与进程终止

支持超时控制，超时后自动终止进程树：

```typescript
// Windows: taskkill /PID <pid> /T /F
// Unix: kill -TERM -<pid> → kill -KILL -<pid>
```

## 与其他模块的联动

### 1. 与 BaseTool 的联动

所有工具继承 `BaseTool`，获得：

- 基于 zod 的参数验证
- LangChain 格式的工具定义生成
- 统一的 `run()` 执行入口

### 2. 与安全模块的联动

```
┌──────────────────┐
│   Git/Bash Tool  │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────┐
│         command-security             │
│  • dangerous-patterns (危险检测)      │
│  • path-validator (路径验证)          │
│  • concurrency-limiter (并发限制)     │
│  • process-manager (进程管理)         │
└──────────────────────────────────────┘
```

### 3. 与审计日志的联动

每次命令执行都会记录审计日志：

```typescript
auditLogger.logCommandExecution(
  'git', // category
  'clone', // operation
  'git clone ...', // command
  cwd, // working directory
  success, // result
  duration, // execution time
  error // error details (if any)
);
```

### 4. 与工具注册表的联动

```
@registerTool() 装饰器
       │
       ▼
getRegisteredBaseTools() → ToolRegistry → Agent 工具列表
```

## 技术特点总结

| 特性     | 实现方式                               |
| -------- | -------------------------------------- |
| 类型安全 | TypeScript + zod 双重保障              |
| 安全防护 | 四层安全机制（检测、验证、限制、审计） |
| 跨平台   | 支持 Windows (cmd) 和 Unix (sh)        |
| 可观测性 | 完整的审计日志                         |
| 错误处理 | 统一的错误类型和错误码体系             |
| 扩展性   | 装饰器模式便于新增工具                 |

## 使用示例

### Git 操作

```typescript
// 克隆仓库
const cloneResult = await gitClone({
  url: 'https://github.com/user/repo.git',
  branch: 'main',
  depth: 1,
});

// 查看状态
const statusResult = await gitStatus({ cwd: '/path/to/repo' });

// 提交代码
const commitResult = await gitCommit({
  message: 'feat: add new feature',
  files: ['src/index.ts'],
});
```

### Bash 操作

```typescript
const result = await bashExecute({
  command: 'npm run build',
  cwd: '/path/to/project',
  timeout: 60000,
  env: { NODE_ENV: 'production' },
});
```
