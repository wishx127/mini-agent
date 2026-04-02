## Purpose

提供受限制的 Bash 命令执行能力，允许 Agent 在受控环境中执行 shell 命令。基于人类监督执行模式，危险操作需要人类确认，复杂能力（如 node/python 的危险用法）也需要确认。

## ADDED Requirements

### Requirement: 危险命令检测

Bash 执行工具 SHALL 使用黑名单机制检测危险命令，而非依赖白名单。

#### Scenario: 检测危险命令模式

- **WHEN** 调用 Bash 执行工具并传入命令
- **THEN** 检查命令是否匹配危险模式
- **AND** 危险命令返回错误并可能要求人类确认

**黑名单命令模式**:

- `rm -rf /` 或 `rm -rf *` - 递归删除根目录或当前目录
- `mkfs` - 格式化文件系统
- `dd` - 裸磁盘操作
- `:(){:|:&};:` - Fork 炸弹
- `> /dev/sda` - 直接写入磁盘设备

#### Scenario: 拒绝明确危险命令

- **WHEN** 调用 Bash 执行工具并传入危险命令
- **THEN** 返回安全错误
- **AND** 错误码：`SECURITY_DANGEROUS_PATTERN`

### Requirement: 允许执行解释器

Bash 执行工具 SHALL 允许执行编程语言解释器（node、python、python3）。

#### Scenario: 允许执行解释器

- **WHEN** 调用 Bash 执行工具并传入 `node`、`python` 或 `python3` 命令
- **THEN** 允许执行
- **AND** 返回执行结果

**理由**: 这些解释器本身不是危险的，危险的是它们被用来执行恶意代码。在人类监督模式下，可以信任人类正确评估风险。

### Requirement: 解释器危险用法需要确认

如果通过解释器执行危险操作，需要人类确认。

#### Scenario: 检测解释器危险用法

- **WHEN** 通过 `node -e` 或 `python -c` 执行包含危险模式的命令
- **THEN** 返回 `CONFIRMATION_REQUIRED` 错误
- **AND** 说明检测到潜在的危险操作

**检测模式**:

- `require('child_process')` 或 `import subprocess` - 进程操作
- `os.system()`, `os.remove()`, `shutil.rmtree()` - 系统操作
- `eval()`, `exec()` - 代码执行

#### Scenario: 解释器危险用法确认

- **WHEN** 人类明确传递 `confirmed: true` 参数
- **AND** 操作属于解释器危险用法范畴
- **THEN** 执行操作（假设人类已评估风险）
- **AND** 在审计日志中记录确认

### Requirement: 参数验证

Bash 执行工具 SHALL 验证命令参数的安全性。

#### Scenario: 拒绝路径遍历

- **WHEN** 命令参数包含 `../` 路径遍历模式
- **AND** 目标路径在项目目录外
- **THEN** 拒绝执行
- **AND** 返回安全错误："Path traversal not allowed"
- **AND** 错误码：`SECURITY_PATH_TRAVERSAL`

#### Scenario: 拒绝危险协议

- **WHEN** 命令参数包含危险 URL 协议
- **THEN** 拒绝执行
- **AND** 返回安全错误："Dangerous URL protocol not allowed"
- **AND** 错误码：`SECURITY_INVALID_PROTOCOL`

**禁止的协议**: `file://`（除非明确允许）、`javascript://`

### Requirement: 工作目录控制

Bash 执行工具 SHALL 支持指定工作目录执行命令。

#### Scenario: 在指定目录执行

- **WHEN** 调用 Bash 执行工具并传入 `cwd` 参数
- **THEN** 使用 `fs.realpathSync.native()` 解析工作目录
- **AND** 验证路径在项目目录内
- **AND** 在指定目录下执行命令

#### Scenario: 默认工作目录

- **WHEN** 调用 Bash 执行工具未传入 `cwd` 参数
- **THEN** 在项目根目录执行命令

### Requirement: 资源限制

Bash 执行工具 SHALL 实施资源限制。

#### Scenario: 命令超时

- **WHEN** 调用 Bash 执行工具并传入长时间运行的命令
- **AND** 超过配置的超时时间（默认 30 秒）
- **THEN** 启动进程树终止流程
- **AND** 返回超时错误："Command timed out after <timeout>ms"
- **AND** 错误码：`TIMEOUT_EXECUTION`
- **AND** 标记为可重试

#### Scenario: 输出限制

- **WHEN** 调用 Bash 执行工具执行产生大量输出的命令
- **AND** 输出超过配置的大小限制（默认 100KB）
- **THEN** 停止读取输出
- **AND** 启动进程树终止流程
- **AND** 返回错误："Output exceeded size limit"
- **AND** 错误码：`RESOURCE_OUTPUT_LIMIT`

### Requirement: 并发控制

Bash 执行工具 SHALL 遵守并发限制。

#### Scenario: 并发限制检查

- **WHEN** 并发执行的命令数达到上限（3 个）
- **AND** 新的 Bash 执行请求到达
- **THEN** 立即返回并发限制错误
- **AND** 错误码：`CONCURRENCY_LIMIT_EXCEEDED`
- **AND** 错误消息："Too many commands running (max: 3)"
- **AND** 标记为可重试

### Requirement: 进程树终止

Bash 执行工具 SHALL 确保终止命令时，整个进程树都被清理。

#### Scenario: 终止进程树

- **WHEN** 命令执行超时或被显式终止
- **THEN** 发送 SIGTERM 信号到进程组
- **AND** 等待最多 5 秒让进程正常退出
- **AND** 如果进程未退出，发送 SIGKILL 到进程组

**Unix 实现**:

```typescript
execFile('kill', ['-TERM', `-${pid}`], { shell: false });
```

**Windows 实现**:

```typescript
execFile('taskkill', ['/PID', pid.toString(), '/T', '/F'], { shell: false });
```

### Requirement: 审计日志

Bash 执行工具 SHALL 记录执行活动。

#### Scenario: 记录命令执行

- **WHEN** Bash 命令被执行
- **THEN** 记录时间戳、命令内容、工作目录、执行结果
- **AND** 敏感信息必须脱敏

#### Scenario: 记录确认操作

- **WHEN** 人类确认了危险操作
- **THEN** 记录确认时间、确认的操作
- **AND** 标记为需要人类审查的事件

#### Scenario: 记录安全拦截

- **WHEN** 命令被安全系统拦截
- **THEN** 记录拦截原因、命令内容、拦截时间
- **AND** 标记为安全事件

## Error Handling

### 错误格式

```typescript
{
  code: string;           // 错误码
  message: string;        // 人类可读信息
  type: 'SECURITY' | 'TIMEOUT' | 'RESOURCE' | 'CONFIRMATION';
  retryable: boolean;     // 是否可重试
  requiresConfirmation?: boolean;  // 是否需要人类确认
}
```

### 错误码列表

| 错误码                     | 说明               | 可重试 |
| -------------------------- | ------------------ | ------ |
| SECURITY_DANGEROUS_PATTERN | 检测到危险命令模式 | 否     |
| SECURITY_PATH_TRAVERSAL    | 路径遍历尝试       | 否     |
| SECURITY_INVALID_PROTOCOL  | 危险 URL 协议      | 否     |
| CONFIRMATION_REQUIRED      | 操作需要人类确认   | 否     |
| TIMEOUT_EXECUTION          | 执行超时           | 是     |
| RESOURCE_OUTPUT_LIMIT      | 输出超限           | 是     |
| CONCURRENCY_LIMIT_EXCEEDED | 并发限制           | 是     |

## Security Considerations

### 设计模式说明

本设计采用**人类监督执行模式**，核心原则：

1. 技术防御阻止明显危险的操作（如 `rm -rf /`）
2. 复杂能力（如解释器执行）允许使用，但危险用法需要确认
3. 信任人类能够正确评估风险并做出合理决策

### 为什么允许 node/python

原方案使用白名单机制，但包含 node/python 导致白名单形同虚设。更好的方案是：

- **不阻止**解释器本身（它们有很多合法用途）
- **检测并要求确认**解释器的危险用法（如执行恶意代码）

### 黑名单 vs 白名单

| 方案              | 优点               | 缺点                             |
| ----------------- | ------------------ | -------------------------------- |
| 白名单            | 更安全（限制更多） | 限制合法用途；node/python 等绕过 |
| 黑名单            | 更灵活             | 可能遗漏危险模式                 |
| 黑名单 + 人类确认 | 灵活且安全         | 需要人类参与                     |

本设计采用**黑名单 + 人类确认**方案。

### 不支持的特性

以下特性**不支持**，即使在解释器中：

- 管道操作（`|`）通过 shell 执行
- 命令链（`;`, `&&`, `||`）通过 shell 执行
- 重定向（`>`, `<`, `>>`）通过 shell 执行

### 替代方案

如果需要更复杂的操作，建议：

1. 将复杂逻辑写入脚本文件，然后使用 `node` 或 `python` 执行
2. 使用 Git 操作工具（结构化参数）
3. 在应用层实现所需功能

## Implementation Notes

### 执行方式

使用 `child_process.execFile` 而非 `exec`：

```typescript
execFile('node', ['-e', 'console.log("hello")'], { shell: false });
```

### 参数处理

所有参数必须作为数组元素传递：

```typescript
bash_execute({ command: 'node', args: ['-e', 'console.log("hello")'] });
```

### 危险模式检测

```typescript
const DANGEROUS_PATTERNS = [
  /require\s*\(\s*['"]child_process['"]\s*\)/i,
  /import\s+.*\s+from\s+['"]child_process['"]/i,
  /subprocess\./,
  /os\.system\(/,
  /os\.remove\(/,
  /shutil\.rmtree\(/,
  /\beval\s*\(/,
  /\bexec\s*\(/,
];

function checkDangerous(code: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(code));
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
