/**
 * 命令安全模块入口
 */

export {
  ErrorCode,
  ErrorType,
  type ToolError,
  type ConfirmationDetails,
  type CommandResult,
  type ExecutionOptions,
  type Platform,
  type DangerousPattern,
} from './types.js';

export {
  validatePath,
  detectPathTraversal,
  validateWorkingDirectory,
} from './path-validator.js';

export {
  detectDangerousCommand,
  detectConfirmationRequired,
  detectDangerousProtocol,
  createConfirmationError,
} from './dangerous-patterns.js';

export { concurrencyLimiter } from './concurrency-limiter.js';

export {
  killProcessTree,
  checkGitInstalled,
  withTimeout,
  type ManagedExecutionOptions,
  type ManagedExecutionResult,
} from './process-manager.js';
