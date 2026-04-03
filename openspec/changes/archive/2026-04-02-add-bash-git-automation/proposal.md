## Why

项目目前已具备完整的文件操作能力（读、写、编辑、删除、搜索等），但缺乏执行系统命令和版本控制操作的能力。为了进一步提升自动化水平，需要添加 Bash 命令执行和 Git 操作功能，使 Agent 能够执行脚本、管理代码版本、自动化部署流程等。

本方案采用**人类监督执行模式**，通过技术防御和人类确认相结合的方式确保安全性。

## What Changes

- 新增 Bash 命令执行工具，支持基于黑名单 + 人类确认的安全执行
- 新增 Git 操作工具集，支持完整的版本控制操作（clone、commit、push、branch 等）
- 实现命令执行的安全机制，包括危险命令检测、进程树终止、超时控制
- 实现危险 Git 操作的确认机制（force push、hard reset、clean 等）
- 添加命令超时和输出限制控制
- 提供 Git 状态查询和仓库管理功能
- 支持 Windows 和 Unix 跨平台

## Capabilities

### New Capabilities

- `bash-execution`: Bash 命令执行功能，支持黑名单检测和人类确认
- `git-operations`: Git 版本控制操作，包括 clone、commit、push、pull、branch、status、reset、clean 等
- `command-security`: 命令执行安全机制，包括危险命令检测、进程树终止、超时控制、输出限制

### Modified Capabilities

- 无现有规范需要修改

## Security Model

本方案采用**人类监督执行模式**，核心原则：

1. **技术防御**: 阻止明显危险的操作（如 `rm -rf /`、`mkfs`）
2. **人类确认**: 复杂或不可逆操作需要人类确认（如 force push、hard reset）
3. **信任人类**: 允许使用解释器（node/python），但危险用法需要确认

### 黑名单检测

以下命令/模式会被直接阻止：

- `rm -rf /` 或 `rm -rf *` - 递归删除
- `mkfs` - 格式化文件系统
- `dd` - 裸磁盘操作
- Fork 炸弹等

### 需要确认的操作

以下操作需要人类确认才能执行：

- `git push --force` - 覆盖远程历史
- `git reset --hard` - 丢失未提交更改
- `git clean -fd` - 删除未跟踪文件
- 解释器的危险用法（如 `require('child_process')`）

## Impact

- **代码**: 新增 `src/tools/plugins/bash/`、`src/tools/plugins/git/`、`src/tools/plugins/command-security/` 目录
- **API**: 新增 `bash_execute` 和 `git_*` 系列工具接口，危险操作包含 `CONFIRMATION_REQUIRED` 错误
- **依赖**: 需要系统安装 Git，Node.js 的 `child_process` 模块
- **系统**: 需要配置命令执行的安全策略，Windows/Unix 跨平台适配
