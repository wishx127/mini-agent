## Purpose

定义命令执行的安全机制，确保 Bash 和 Git 操作在安全可控的环境中执行。基于**人类监督执行模式**，利用人类判断力防止危险操作，而非依赖纯技术防御。

## ADDED Requirements

### Requirement: 路径访问控制

命令安全系统 SHALL 验证所有文件路径访问是否在允许范围内。

#### Scenario: 验证工作目录范围

- **WHEN** 命令在指定工作目录执行
- **THEN** 使用 `fs.realpathSync.native()` 解析工作目录的真实路径
- **AND** 验证真实路径在项目根目录内
- **AND** 越界路径返回错误："Access denied: path outside project directory"

#### Scenario: 验证路径参数

- **WHEN** 命令包含文件路径参数
- **THEN** 解析所有路径为绝对路径
- **AND** 使用 `fs.realpathSync.native()` 解析符号链接
- **AND** 验证最终路径在项目根目录内

#### Scenario: 最小化 TOCTOU 窗口

- **WHEN** 路径验证通过后
- **THEN** 立即执行命令
- **AND** 不依赖后续的文件系统状态

### Requirement: 危险命令检测

命令安全系统 SHALL 使用黑名单机制检测危险命令，而非依赖白名单。

#### Scenario: 检测危险命令模式

- **WHEN** 调用 Bash 执行工具并传入命令
- **THEN** 检查命令是否匹配危险模式
- **AND** 危险命令返回错误并要求人类确认

**黑名单命令模式**:

- `rm -rf /` 或 `rm -rf *` - 递归删除
- `mkfs` - 格式化文件系统
- `dd` - 裸磁盘操作
- `:(){:|:&};:` - Fork 炸弹
- `> /dev/sda` - 直接写入磁盘

#### Scenario: 危险参数检测

- **WHEN** 命令参数包含危险模式
- **THEN** 返回安全错误："Dangerous pattern detected in arguments"
- **AND** 错误码：`SECURITY_DANGEROUS_PATTERN`

### Requirement: 参数验证

命令安全系统 SHALL 验证命令参数的安全性。

#### Scenario: 拒绝路径遍历参数

- **WHEN** 命令参数包含 `../` 路径遍历模式
- **AND** 目标路径在项目目录外
- **THEN** 拒绝执行
- **AND** 返回安全错误："Path traversal not allowed"
- **AND** 错误码：`SECURITY_PATH_TRAVERSAL`

#### Scenario: 验证 URL 参数

- **WHEN** 命令包含 URL 参数
- **THEN** 验证 URL 格式符合标准
- **AND** 禁止 `file://` 协议（除非明确允许）
- **AND** 禁止 `javascript://` 协议

### Requirement: 人类确认机制

命令安全系统 SHALL 对危险操作要求人类确认。

#### Scenario: 需要确认的操作

- **WHEN** 执行以下操作之一
  - `git push --force`
  - `git reset --hard`
  - `git clean -fd`
  - 任何包含 `--force` 标志的危险操作
- **THEN** 返回确认请求
- **AND** 包含操作风险说明
- **AND** 错误码：`CONFIRMATION_REQUIRED`

#### Scenario: 确认请求格式

```typescript
{
  code: 'CONFIRMATION_REQUIRED';
  message: 'This operation may cause data loss';
  type: 'CONFIRMATION';
  requiresConfirmation: true;
  details: {
    operation: 'git reset --hard';
    risks: ['Will discard all uncommitted changes', 'Cannot be undone'];
    alternatives: ['Use git reset --soft', 'Use git stash'];
  }
  retryable: false;
}
```

#### Scenario: 跳过确认

- **WHEN** 人类明确传递 `confirmed: true` 参数
- **AND** 操作属于危险操作范畴
- **THEN** 执行操作（假设人类已评估风险）
- **AND** 在审计日志中记录确认已由人类提供

### Requirement: Git 操作安全执行

Git 操作工具 SHALL 使用安全的执行方式。

#### Scenario: 使用 execFile 执行 Git 命令

- **WHEN** 调用任何 Git 操作工具
- **THEN** 使用 `child_process.execFile` 执行
- **AND** 设置 `shell: false`
- **AND** 参数以数组形式传递，避免 shell 注入

#### Scenario: 结构化参数验证

- **WHEN** 调用 Git 操作工具
- **THEN** 验证所有参数符合预定义 schema
- **AND** URL 参数必须符合有效 URL 格式
- **AND** 路径参数必须通过路径验证

#### Scenario: 危险 Git 操作需要确认

- **WHEN** 调用 `git push` 并传入 `force: true`
- **THEN** 返回 `CONFIRMATION_REQUIRED` 错误
- **AND** 说明 force push 的风险

- **WHEN** 调用 `git reset` 并传入 `mode: 'hard'`
- **THEN** 返回 `CONFIRMATION_REQUIRED` 错误
- **AND** 说明 hard reset 会丢失未提交更改

- **WHEN** 调用 `git clean` 并传入 `force: true` 和 `directories: true`
- **THEN** 返回 `CONFIRMATION_REQUIRED` 错误
- **AND** 说明 clean 会删除未跟踪文件

### Requirement: 进程树终止

命令安全系统 SHALL 确保超时或被终止时，整个进程树都被清理。

#### Scenario: 终止进程树

- **WHEN** 命令执行超时或被显式终止
- **THEN** 发送 SIGTERM 信号到进程组（包含所有子进程）
- **AND** 等待最多 5 秒让进程正常退出
- **AND** 如果进程未退出，发送 SIGKILL 到进程组

**Unix 实现**:

```typescript
// 使用负 PID 发送到进程组
execFile('kill', ['-TERM', `-${pid}`], { shell: false });
```

**Windows 实现**:

```typescript
// taskkill /T 终止进程树
execFile('taskkill', ['/PID', pid.toString(), '/T', '/F'], { shell: false });
```

#### Scenario: 检测进程树

- **WHEN** 命令开始执行
- **THEN** 记录主进程 PID
- **AND** 定期检查是否存在孤儿进程
- **AND** 在命令完成或终止后清理任何残留子进程

### Requirement: 并发控制

命令安全系统 SHALL 控制并发命令执行数量。

#### Scenario: 限制并发执行数

- **WHEN** 并发执行的命令数达到上限（3 个）
- **AND** 新的命令执行请求到达
- **THEN** 立即返回并发限制错误
- **AND** 错误信息包含当前运行命令数

#### Scenario: 并发限制错误

- **WHEN** 命令因并发限制被拒绝
- **THEN** 返回错误码 `CONCURRENCY_LIMIT_EXCEEDED`
- **AND** 错误消息："Too many commands running (max: 3)"
- **AND** 标记为可重试错误

### Requirement: 资源限制

命令安全系统 SHALL 对命令执行实施资源限制。

#### Scenario: 执行超时控制

- **WHEN** 命令执行时间超过配置的超时时间
- **THEN** 启动进程树终止流程
- **AND** 返回超时错误："Command timed out after <timeout>ms"
- **AND** 标记为可重试错误

#### Scenario: 输出大小限制

- **WHEN** 命令输出超过配置的大小限制（默认 100KB）
- **THEN** 停止读取输出
- **AND** 启动进程树终止流程
- **AND** 返回错误："Output exceeded size limit"

### Requirement: 审计日志

命令安全系统 SHALL 记录所有命令执行活动。

#### Scenario: 记录命令执行

- **WHEN** 任何命令被执行
- **THEN** 记录时间戳、命令内容、工作目录、执行结果
- **AND** 敏感信息（URL token、SSH key 路径）必须脱敏
- **AND** 记录执行用户身份（如果适用）

#### Scenario: 记录确认操作

- **WHEN** 人类确认了危险操作
- **THEN** 记录确认时间、确认的操作、确认者标识
- **AND** 标记为需要人类审查的事件

#### Scenario: 记录安全拦截

- **WHEN** 命令被安全系统拦截
- **THEN** 记录拦截原因、命令内容、拦截时间
- **AND** 标记为安全事件

#### Scenario: 日志保留

- **WHEN** 审计日志文件超过保留期限（7 天）
- **THEN** 自动删除过期日志文件
- **AND** 基于文件修改时间判断

#### Scenario: 日志写入安全

- **WHEN** 写入审计日志
- **THEN** 对命令输出进行转义处理
- **AND** 防止日志注入攻击
- **AND** 使用 JSON 安全序列化

### Requirement: 跨平台兼容性

命令安全系统 SHALL 支持 Windows 和 Unix 系统。

#### Scenario: Windows 平台检测

- **WHEN** 检测到 Windows 平台
- **THEN** 使用 Windows 原生命令（taskkill）
- **AND** 处理 Windows 路径格式
- **AND** 使用 process.platform 检测系统

#### Scenario: Git 路径检测

- **WHEN** 需要执行 Git 命令
- **THEN** 检测 Git 安装路径
- **AND** Unix: 使用 `which git` 或 `command -v git`
- **AND** Windows: 使用 `where git` 或注册表查询

#### Scenario: 临时目录处理

- **WHEN** 需要使用临时目录
- **THEN** 使用 `os.tmpdir()` 获取系统临时目录
- **AND** Windows: 映射到用户临时目录（如 `%TEMP%`）
- **AND** Unix: 使用 `/tmp` 或 `XDG_RUNTIME_DIR`

## Security Considerations

### 安全模型说明

本设计采用**人类监督执行模式**，核心原则：

1. 技术防御阻止明显危险的操作
2. 需要人类判断的操作通过确认机制处理
3. 信任人类能够正确评估风险并做出合理决策

### 技术防御层

1. **危险命令黑名单**: 阻止已知的危险操作模式
2. **参数验证**: 防止路径遍历、非法协议等
3. **进程隔离**: 通过进程树终止确保清理
4. **资源限制**: 超时和输出限制防止资源耗尽

### 不依赖技术防御的场景

以下场景依赖人类判断，不强制技术拦截：

- 允许执行 `node`/`python`，但危险操作需要确认
- 允许 `git push --force`，但需要明确确认
- 允许 `git reset --hard`，但需要明确确认

### TOCTOU 风险说明

路径验证存在 Time-of-Check-Time-of-Use 竞态条件风险：

- 缓解措施：使用 `realpath` 解析后立即执行，最小化时间窗口
- 残余风险：在人类监督模式下可接受，人类可以发现异常
- 监控：通过审计日志检测可疑模式
