## Purpose

提供完整的 Git 版本控制操作能力，支持 Agent 执行常见的 Git 命令来管理代码仓库。基于人类监督执行模式，危险操作需要人类确认。

## ADDED Requirements

### Requirement: 安全执行基础

所有 Git 操作 SHALL 使用安全的执行机制。

#### Scenario: 使用 execFile 执行

- **WHEN** 调用任何 Git 操作
- **THEN** 使用 `child_process.execFile` 执行
- **AND** 设置 `shell: false`
- **AND** 参数以数组形式传递，避免 shell 注入

#### Scenario: 路径验证

- **WHEN** Git 操作涉及文件路径
- **THEN** 使用 `fs.realpathSync.native()` 解析路径
- **AND** 验证路径在项目目录内

#### Scenario: 超时控制

- **WHEN** Git 操作执行时间超过配置的超时时间
- **THEN** 启动进程树终止流程
- **AND** 返回超时错误

**默认超时时间**:

- clone: 120 秒
- 其他操作: 30 秒

#### Scenario: 统一错误格式

- **WHEN** Git 操作失败
- **THEN** 返回结构化错误信息
- **AND** 包含错误码、类型、可重试性标记

**错误格式**:

```typescript
{
  code: string;           // 如 'GIT_AUTH_FAILED'
  message: string;        // 人类可读信息
  type: 'SECURITY' | 'NETWORK' | 'GIT' | 'TIMEOUT' | 'RESOURCE' | 'CONFIRMATION';
  retryable: boolean;     // 是否可重试
  requiresConfirmation?: boolean;  // 是否需要人类确认
  details?: Record<string, any>;
}
```

### Requirement: 克隆仓库

Git 操作工具 SHALL 支持从远程仓库克隆代码。

#### Scenario: 成功克隆仓库

- **WHEN** 调用 Git 克隆工具并传入有效的仓库 URL
- **THEN** 克隆仓库到指定目录
- **AND** 返回克隆结果信息

#### Scenario: 克隆到指定目录

- **WHEN** 调用 Git 克隆工具并传入 `directory` 参数
- **THEN** 克隆仓库到指定目录名
- **AND** 目录不存在时自动创建

#### Scenario: 克隆私有仓库

- **WHEN** 调用 Git 克隆工具并传入需要认证的仓库 URL
- **AND** 用户已配置 Git 凭证（SSH key 或 credential helper）
- **THEN** 成功克隆私有仓库

#### Scenario: 克隆已存在目录

- **WHEN** 调用 Git 克隆工具并传入已存在的目录路径
- **THEN** 返回错误，提示目录已存在
- **AND** 错误码：`GIT_DIRECTORY_EXISTS`

### Requirement: 查看仓库状态

Git 操作工具 SHALL 支持查看仓库当前状态。

#### Scenario: 获取仓库状态

- **WHEN** 调用 Git 状态工具并传入仓库路径
- **THEN** 返回当前分支名称
- **AND** 返回已修改文件列表
- **AND** 返回已暂存文件列表
- **AND** 返回未跟踪文件列表

#### Scenario: 在非 Git 目录获取状态

- **WHEN** 调用 Git 状态工具并传入非 Git 仓库路径
- **THEN** 返回错误，提示不是 Git 仓库
- **AND** 错误码：`GIT_NOT_REPOSITORY`

### Requirement: 分支操作

Git 操作工具 SHALL 支持分支管理操作。

#### Scenario: 列出所有分支

- **WHEN** 调用 Git 分支列表工具
- **THEN** 返回本地分支列表
- **AND** 标记当前活动分支

#### Scenario: 创建新分支

- **WHEN** 调用 Git 创建分支工具并传入分支名称
- **THEN** 基于当前分支创建新分支
- **AND** 可选切换到新分支

#### Scenario: 切换分支

- **WHEN** 调用 Git 切换分支工具并传入分支名称
- **THEN** 切换到指定分支
- **AND** 返回切换结果

#### Scenario: 切换分支失败（有未提交更改）

- **WHEN** 调用 Git 切换分支工具
- **AND** 当前有未提交的更改
- **AND** 切换会导致更改丢失
- **THEN** 返回错误，提示有未提交更改
- **AND** 错误码：`GIT_UNCOMMITTED_CHANGES`
- **AND** 建议操作：提交更改或暂存

#### Scenario: 删除分支

- **WHEN** 调用 Git 删除分支工具并传入分支名称
- **AND** 分支已完全合并
- **THEN** 删除指定分支

#### Scenario: 删除未合并分支

- **WHEN** 调用 Git 删除分支工具并传入未合并的分支名称
- **AND** 未使用强制删除标志
- **THEN** 返回错误，提示分支未合并
- **AND** 错误码：`GIT_BRANCH_NOT_MERGED`

### Requirement: 提交更改

Git 操作工具 SHALL 支持提交代码更改。

#### Scenario: 暂存并提交文件

- **WHEN** 调用 Git 提交工具并传入文件路径和提交信息
- **THEN** 将文件添加到暂存区
- **AND** 创建提交
- **AND** 返回提交哈希

#### Scenario: 提交所有修改

- **WHEN** 调用 Git 提交工具并传入 `all` 标志
- **THEN** 暂存所有已修改文件
- **AND** 创建提交

#### Scenario: 空提交信息

- **WHEN** 调用 Git 提交工具并传入空提交信息
- **THEN** 返回错误，提示提交信息不能为空
- **AND** 错误码：`GIT_EMPTY_MESSAGE`

### Requirement: 远程操作

Git 操作工具 SHALL 支持与远程仓库交互。

#### Scenario: 推送更改

- **WHEN** 调用 Git 推送工具并传入远程名称和分支名称
- **THEN** 将本地提交推送到远程仓库
- **AND** 返回推送结果

#### Scenario: 推送失败（认证错误）

- **WHEN** 调用 Git 推送工具
- **AND** 认证失败
- **THEN** 返回错误，提示认证失败
- **AND** 错误码：`GIT_AUTH_FAILED`
- **AND** 建议操作：检查 Git 凭证配置

#### Scenario: 推送失败（非快进）

- **WHEN** 调用 Git 推送工具
- **AND** 远程有本地没有的更新
- **THEN** 返回错误，提示推送被拒绝
- **AND** 错误码：`GIT_PUSH_REJECTED`
- **AND** 建议操作：先执行 git pull

#### Scenario: 强制推送需要确认

- **WHEN** 调用 Git 推送工具并传入 `force: true`
- **THEN** 返回 `CONFIRMATION_REQUIRED` 错误
- **AND** 说明 force push 会覆盖远程历史
- **AND** 提供替代方案：先 pull 再 push

**确认请求示例**:

```typescript
{
  code: 'CONFIRMATION_REQUIRED',
  message: 'Force push will overwrite remote history',
  type: 'CONFIRMATION',
  requiresConfirmation: true,
  details: {
    operation: 'git push --force',
    risks: [
      'Will overwrite remote branch history',
      'Other collaborators may lose commits',
      'Cannot be undone'
    ],
    alternatives: [
      'Use regular push after pulling changes',
      'Use git reflog to recover lost commits'
    ]
  }
}
```

#### Scenario: 拉取更新

- **WHEN** 调用 Git 拉取工具并传入远程名称和分支名称
- **THEN** 从远程仓库拉取更新
- **AND** 合并到当前分支
- **AND** 返回拉取结果

#### Scenario: 拉取产生合并冲突

- **WHEN** 调用 Git 拉取工具
- **AND** 产生合并冲突
- **THEN** 返回错误，提示有合并冲突
- **AND** 错误码：`GIT_MERGE_CONFLICT`
- **AND** 返回冲突文件列表
- **AND** 建议操作：手动解决冲突

#### Scenario: 获取远程分支列表

- **WHEN** 调用 Git 远程分支列表工具
- **THEN** 返回所有远程分支列表

### Requirement: 重置操作

Git 操作工具 SHALL 支持重置仓库状态。

#### Scenario: 软重置

- **WHEN** 调用 Git 重置工具并传入 `mode: 'soft'`
- **THEN** 重置 HEAD 到指定提交
- **AND** 保留工作区和暂存区更改
- **AND** 这是安全操作，不需要确认

#### Scenario: 混合重置

- **WHEN** 调用 Git 重置工具并传入 `mode: 'mixed'`
- **THEN** 重置 HEAD 到指定提交
- **AND** 重置暂存区但保留工作区
- **AND** 这是安全操作，不需要确认

#### Scenario: 硬重置需要确认

- **WHEN** 调用 Git 重置工具并传入 `mode: 'hard'`
- **THEN** 返回 `CONFIRMATION_REQUIRED` 错误
- **AND** 说明 hard reset 会丢失所有未提交更改
- **AND** 提供替代方案：先 stash 或 soft reset

**确认请求示例**:

```typescript
{
  code: 'CONFIRMATION_REQUIRED',
  message: 'Hard reset will discard all uncommitted changes',
  type: 'CONFIRMATION',
  requiresConfirmation: true,
  details: {
    operation: 'git reset --hard',
    risks: [
      'Will discard all uncommitted changes',
      'Will discard all untracked files',
      'Cannot be undone'
    ],
    alternatives: [
      'Use git stash to save changes temporarily',
      'Use git reset --soft to keep changes staged',
      'Use git reset --mixed to keep changes unstaged'
    ]
  }
}
```

### Requirement: 清理操作

Git 操作工具 SHALL 支持清理工作区。

#### Scenario: 清理未跟踪文件

- **WHEN** 调用 Git 清理工具并传入 `force: false`
- **THEN** 返回 `CONFIRMATION_REQUIRED` 错误
- **AND** 提示需要确认才能执行清理

#### Scenario: 强制清理需要确认

- **WHEN** 调用 Git 清理工具并传入 `force: true` 和 `directories: false`
- **THEN** 返回 `CONFIRMATION_REQUIRED` 错误
- **AND** 说明只清理文件，不清理目录

- **WHEN** 调用 Git 清理工具并传入 `force: true` 和 `directories: true`
- **THEN** 返回 `CONFIRMATION_REQUIRED` 错误
- **AND** 说明这会删除所有未跟踪文件和目录
- **AND** 提供预览选项让用户先查看将被删除的文件

**确认请求示例**:

```typescript
{
  code: 'CONFIRMATION_REQUIRED',
  message: 'Git clean will permanently delete untracked files',
  type: 'CONFIRMATION',
  requiresConfirmation: true,
  details: {
    operation: 'git clean -fd',
    risks: [
      'Will permanently delete untracked files',
      'Will permanently delete untracked directories',
      'Cannot be undone'
    ],
    alternatives: [
      'Use git clean -n (dry run) to preview files first',
      'Manually backup important files before cleaning'
    ]
  }
}
```

### Requirement: 查看提交历史

Git 操作工具 SHALL 支持查看提交历史。

#### Scenario: 查看日志

- **WHEN** 调用 Git 日志工具
- **THEN** 返回提交历史列表
- **AND** 包含提交哈希、作者、日期、提交信息

#### Scenario: 限制日志数量

- **WHEN** 调用 Git 日志工具并传入 `limit` 参数
- **THEN** 返回指定数量的最近提交

## Error Handling

### 错误类型分类

| 错误类型     | 说明         | 示例                 |
| ------------ | ------------ | -------------------- |
| SECURITY     | 安全相关错误 | 路径越界、命令被拒绝 |
| NETWORK      | 网络相关错误 | 连接超时、DNS 失败   |
| GIT          | Git 操作错误 | 合并冲突、分支不存在 |
| TIMEOUT      | 超时错误     | 命令执行超时         |
| RESOURCE     | 资源限制错误 | 输出过大、并发限制   |
| CONFIRMATION | 需要人类确认 | 危险操作待确认       |

### 常见错误码

| 错误码                  | 说明          | 可重试 |
| ----------------------- | ------------- | ------ |
| GIT_AUTH_FAILED         | 认证失败      | 否     |
| GIT_NOT_REPOSITORY      | 不是 Git 仓库 | 否     |
| GIT_DIRECTORY_EXISTS    | 目录已存在    | 否     |
| GIT_BRANCH_NOT_FOUND    | 分支不存在    | 否     |
| GIT_BRANCH_NOT_MERGED   | 分支未合并    | 否     |
| GIT_UNCOMMITTED_CHANGES | 有未提交更改  | 否     |
| GIT_MERGE_CONFLICT      | 合并冲突      | 否     |
| GIT_PUSH_REJECTED       | 推送被拒绝    | 是     |
| GIT_TIMEOUT             | 执行超时      | 是     |
| GIT_NETWORK_ERROR       | 网络错误      | 是     |
| CONFIRMATION_REQUIRED   | 需要人类确认  | 否     |

## Idempotency Notes

以下 Git 操作的幂等性说明：

| 操作                   | 幂等 | 说明                     |
| ---------------------- | ---- | ------------------------ |
| git-status             | ✓    | 无副作用                 |
| git-log                | ✓    | 无副作用                 |
| git-branch (list)      | ✓    | 无副作用                 |
| git-clone              | ✗    | 目录已存在会失败         |
| git-branch (create)    | ✗    | 分支已存在会失败         |
| git-branch (delete)    | ✓    | 重复删除无影响           |
| git-add                | ✓    | 重复添加无影响           |
| git-commit             | ✗    | 会创建新提交             |
| git-push               | ✗    | 重复推送可能失败         |
| git-pull               | ✗    | 会修改工作区             |
| git-reset (soft/mixed) | ✓    | 重复重置到同一提交无影响 |
| git-reset (hard)       | ✗    | 会修改工作区             |
| git-clean              | ✗    | 会删除文件               |

## Authentication

Git 操作**不管理凭证**，依赖 Git 原生配置：

- SSH 认证：配置 `~/.ssh/id_rsa` 或 `~/.ssh/id_ed25519`
- HTTPS 认证：配置 `git credential.helper`
- 错误处理：认证失败时返回 `GIT_AUTH_FAILED` 错误

## Dangerous Operations Summary

以下 Git 操作被认为是危险的，需要人类确认：

| 操作             | 危险原因       | 替代方案                 |
| ---------------- | -------------- | ------------------------ |
| git push --force | 覆盖远程历史   | 先 pull 再 push          |
| git reset --hard | 丢失未提交更改 | git stash / reset --soft |
| git clean -fd    | 删除未跟踪文件 | 手动备份                 |

## Implementation Notes

### 确认机制实现

```typescript
interface DangerousOperation {
  checkDangerous(args: GitArgs): boolean;
  getConfirmationRequest(args: GitArgs): ConfirmationRequest;
  executeWithConfirmation(args: GitArgs, confirmed: boolean): Promise<Result>;
}

function git_push(args: PushArgs): Promise<Result> {
  if (args.force && !args.confirmed) {
    return {
      code: 'CONFIRMATION_REQUIRED',
      message: 'Force push will overwrite remote history',
      type: 'CONFIRMATION',
      requiresConfirmation: true,
      details: {
        operation: 'git push --force',
        risks: ['Will overwrite remote branch history', 'Cannot be undone'],
        alternatives: ['Pull changes first', 'Use regular push'],
      },
      retryable: false,
    };
  }
  // 执行推送...
}
```

### 进程树终止

```typescript
async function terminateProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await execFile('taskkill', ['/PID', pid.toString(), '/T', '/F']);
  } else {
    try {
      await execFile('kill', ['-TERM', `-${pid}`]);
      await sleep(5000);
      await execFile('kill', ['-KILL', `-${pid}`]);
    } catch (e) {
      // 进程可能已经退出
    }
  }
}
```
