## 1. 基础架构搭建

- [x] 1.1 创建 `src/tools/plugins/git/` 目录结构
- [x] 1.2 创建共享安全模块 `src/tools/plugins/command-security/`
- [x] 1.3 创建审计日志模块 `src/tools/plugins/audit-logger/`

## 2. 安全模块

- [x] 2.1 实现路径验证器（realpath + 项目目录检查）
- [x] 2.2 实现危险命令黑名单检测（rm -rf /, mkfs, dd 等）
- [x] 2.3 实现人类确认机制（CONFIRMATION_REQUIRED 错误）
- [x] 2.4 实现并发限制器（最大 3，超限拒绝）
- [x] 2.5 实现进程树终止机制（SIGTERM + SIGKILL，Unix/Windows）
- [x] 2.6 编写安全模块单元测试

## 3. 审计日志

- [x] 3.1 实现文件日志写入（JSON 格式）
- [x] 3.2 实现日志轮转（7 天保留）
- [x] 3.3 实现敏感信息脱敏（URL token、SSH key 路径）
- [x] 3.4 实现日志写入安全（防止日志注入）
- [x] 3.5 编写审计日志单元测试

## 4. Git 操作工具

- [x] 4.1 实现安全的 Git 执行器（execFile + 超时控制 + 进程树终止）
- [x] 4.2 实现 git-clone（支持自定义超时，默认 120s）
- [x] 4.3 实现 git-status（默认超时 30s）
- [x] 4.4 实现 git-branch（list/create/delete/switch，默认超时 30s）
- [x] 4.5 实现 git-commit（默认超时 30s）
- [x] 4.6 实现 git-push（默认超时 30s，force 需要确认）
- [x] 4.7 实现 git-pull（默认超时 30s）
- [x] 4.8 实现 git-log（默认超时 30s）
- [x] 4.9 实现 git-reset（soft/mixed/hard，hard 需要确认）
- [x] 4.10 实现 git-clean（force 需要确认）
- [x] 4.11 统一错误处理格式（code, type, retryable, confirmation）
- [x] 4.12 编写 Git 工具单元测试

## 5. Bash 执行工具

- [x] 5.1 实现危险命令黑名单检测
- [x] 5.2 实现解释器危险用法检测（child_process, subprocess 等）
- [x] 5.3 实现人类确认机制集成
- [x] 5.4 集成安全模块（路径验证、超时控制、进程树终止）
- [x] 5.5 编写 Bash 工具单元测试

## 6. 跨平台支持

- [x] 6.1 实现 Windows Git 路径检测（where git）
- [x] 6.2 实现 Windows 进程树终止（taskkill /T /F）
- [x] 6.3 实现 Unix Git 路径检测（which git）
- [x] 6.4 实现 Unix 进程树终止（kill -TERM/-KILL）
- [x] 6.5 测试 Windows 跨平台兼容性
- [x] 6.6 测试 Unix 跨平台兼容性

## 7. 工具注册和集成

- [x] 7.1 在 `src/tools/plugins/index.ts` 注册 Git 工具
- [x] 7.2 在 `src/tools/plugins/index.ts` 注册 Bash 工具
- [x] 7.3 添加工具参数 JSON Schema 定义
- [x] 7.4 集成危险操作确认机制到工具调用流程

## 8. 测试和验证

- [x] 8.1 编写单元测试（安全模块、Git 工具、Bash 工具）
- [x] 8.2 编写集成测试（Git 操作流程）
- [x] 8.3 验证危险命令黑名单有效性
- [x] 8.4 验证人类确认机制有效性
- [x] 8.5 验证进程树终止有效性
- [x] 8.6 验证安全机制有效性
- [x] 8.7 测试跨平台兼容性（Windows/Mac/Linux）
