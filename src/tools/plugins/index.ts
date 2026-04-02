/**
 * 插件统一入口
 * 导入此文件会自动触发所有工具的 @registerTool() 装饰器注册
 *
 * 添加新工具只需：
 * 1. 在 plugins/ 目录下创建新工具文件
 * 2. 使用 @registerTool() 装饰器
 * 3. 在下方添加导出语句
 */

// 导出所有工具（触发装饰器注册）
export { TavilySearchTool } from './tavily.js';

// 导出文件操作工具
export {
  ReadTool,
  GlobTool,
  GrepTool,
  LSTool,
  CreateTool,
  WriteTool,
  DeleteTool,
  MoveTool,
  MkdirTool,
} from './file-operations/index.js';

// 导出 Git 操作工具
export {
  gitClone,
  gitStatus,
  gitBranch,
  gitCommit,
  gitPush,
  gitPull,
  gitLog,
  gitReset,
  gitClean,
  GitCloneTool,
  GitStatusTool,
  GitBranchTool,
  GitCommitTool,
  GitPushTool,
  GitPullTool,
  GitLogTool,
  GitResetTool,
  GitCleanTool,
  CommitApiServer,
  commitApiServer,
  getPendingCommitMessage,
  clearPendingCommitMessage,
} from './git/index.js';

// 导出 Bash 执行工具
export { bashExecute, bashExecSimple, BashTool } from './bash/index.js';

// 导出命令安全模块
export {
  ErrorCode,
  ErrorType,
  type ToolError,
  type ConfirmationDetails,
  type CommandResult,
  type ExecutionOptions,
  validatePath,
  validateWorkingDirectory,
  detectDangerousCommand,
  detectConfirmationRequired,
  createConfirmationError,
  concurrencyLimiter,
  killProcessTree,
  checkGitInstalled,
} from './command-security/index.js';

// 导出审计日志模块
export { auditLogger, type AuditLogEntry } from './audit-logger/index.js';
