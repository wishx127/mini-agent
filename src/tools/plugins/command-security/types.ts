/* eslint-disable no-unused-vars */
/**
 * 命令安全模块类型定义
 */

/**
 * 错误类型枚举
 */
export enum ErrorType {
  SECURITY = 'SECURITY',
  NETWORK = 'NETWORK',
  GIT = 'GIT',
  BASH = 'BASH',
  TIMEOUT = 'TIMEOUT',
  RESOURCE = 'RESOURCE',
  CONFIRMATION = 'CONFIRMATION',
}

/**
 * 错误码枚举
 */
export enum ErrorCode {
  // 安全错误
  SECURITY_DANGEROUS_PATTERN = 'SECURITY_DANGEROUS_PATTERN',
  SECURITY_PATH_TRAVERSAL = 'SECURITY_PATH_TRAVERSAL',
  SECURITY_INVALID_PROTOCOL = 'SECURITY_INVALID_PROTOCOL',
  SECURITY_ACCESS_DENIED = 'SECURITY_ACCESS_DENIED',

  // 确认错误
  CONFIRMATION_REQUIRED = 'CONFIRMATION_REQUIRED',

  // 资源错误
  CONCURRENCY_LIMIT_EXCEEDED = 'CONCURRENCY_LIMIT_EXCEEDED',
  RESOURCE_OUTPUT_LIMIT = 'RESOURCE_OUTPUT_LIMIT',

  // 超时错误
  TIMEOUT_EXECUTION = 'TIMEOUT_EXECUTION',

  // Git 错误
  GIT_AUTH_FAILED = 'GIT_AUTH_FAILED',
  GIT_NOT_REPOSITORY = 'GIT_NOT_REPOSITORY',
  GIT_DIRECTORY_EXISTS = 'GIT_DIRECTORY_EXISTS',
  GIT_BRANCH_NOT_FOUND = 'GIT_BRANCH_NOT_FOUND',
  GIT_BRANCH_NOT_MERGED = 'GIT_BRANCH_NOT_MERGED',
  GIT_UNCOMMITTED_CHANGES = 'GIT_UNCOMMITTED_CHANGES',
  GIT_MERGE_CONFLICT = 'GIT_MERGE_CONFLICT',
  GIT_PUSH_REJECTED = 'GIT_PUSH_REJECTED',
  GIT_TIMEOUT = 'GIT_TIMEOUT',
  GIT_NETWORK_ERROR = 'GIT_NETWORK_ERROR',
  GIT_NOT_INSTALLED = 'GIT_NOT_INSTALLED',

  // Bash 错误
  BASH_EXECUTION_FAILED = 'BASH_EXECUTION_FAILED',
  BASH_COMMAND_NOT_FOUND = 'BASH_COMMAND_NOT_FOUND',
}

/**
 * 工具错误接口
 */
export interface ToolError {
  code: ErrorCode;
  message: string;
  type: ErrorType;
  retryable: boolean;
  requiresConfirmation?: boolean;
  details?: Record<string, unknown>;
}

/**
 * 确认请求详情
 */
export interface ConfirmationDetails {
  operation: string;
  risks: string[];
  alternatives: string[];
  command?: string;
}

/**
 * 命令执行结果
 */
export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
}

/**
 * 执行选项
 */
export interface ExecutionOptions {
  cwd?: string;
  timeout?: number;
  maxOutputSize?: number;
  env?: Record<string, string>;
  confirmed?: boolean;
}

/**
 * 平台类型
 */
export type Platform = 'win32' | 'darwin' | 'linux';

/**
 * 危险命令模式
 */
export interface DangerousPattern {
  pattern: RegExp;
  description: string;
  requiresConfirmation?: boolean;
}
