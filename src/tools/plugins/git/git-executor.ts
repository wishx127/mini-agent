/**
 * Git 执行器
 * 提供安全的 Git 命令执行功能
 */

import { execFile, exec } from 'child_process';

import {
  ErrorCode,
  ErrorType,
  ToolError,
  ExecutionOptions,
  CommandResult,
} from '../command-security/types.js';
import { validateWorkingDirectory } from '../command-security/path-validator.js';
import { concurrencyLimiter } from '../command-security/concurrency-limiter.js';
import {
  killProcessTree,
  checkGitInstalled,
} from '../command-security/process-manager.js';
import { auditLogger } from '../audit-logger/index.js';

/**
 * 默认超时时间（毫秒）
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * 默认输出大小限制（字节）
 */
const DEFAULT_MAX_OUTPUT_SIZE = 100 * 1024; // 100KB

/**
 * Git 执行器类
 */
export class GitExecutor {
  private operation: string;
  private timeout: number;

  constructor(operation: string, timeout?: number) {
    this.operation = operation;
    this.timeout = timeout || DEFAULT_TIMEOUT;
  }

  /**
   * 执行 Git 命令
   */
  async execute(
    args: string[],
    options: ExecutionOptions = {}
  ): Promise<CommandResult> {
    const startTime = Date.now();
    const timeout = options.timeout || this.timeout;

    // 检查 Git 是否安装
    const gitInstalled = await checkGitInstalled();
    if (!gitInstalled) {
      return {
        success: false,
        stdout: '',
        stderr: 'Git is not installed or not found in PATH',
        exitCode: -1,
        executionTime: Date.now() - startTime,
      };
    }

    // 并发控制
    const acquireResult = concurrencyLimiter.acquire();
    if (!acquireResult.allowed) {
      return {
        success: false,
        stdout: '',
        stderr: acquireResult.error?.message || 'Concurrency limit exceeded',
        exitCode: -1,
        executionTime: Date.now() - startTime,
      };
    }

    try {
      // 验证工作目录
      const cwdValidation = validateWorkingDirectory(options.cwd);
      if (!cwdValidation.valid) {
        return {
          success: false,
          stdout: '',
          stderr: cwdValidation.error?.message || 'Invalid working directory',
          exitCode: -1,
          executionTime: Date.now() - startTime,
        };
      }

      const cwd = cwdValidation.resolvedPath;

      // 执行命令
      const result = await this.runGitCommand(
        args,
        cwd!,
        timeout,
        options.maxOutputSize
      );

      // 记录审计日志
      await auditLogger.logCommandExecution(
        'git',
        this.operation,
        `git ${args.join(' ')}`,
        cwd,
        result.success,
        result.executionTime,
        result.success ? undefined : result.stderr
      );

      return result;
    } finally {
      concurrencyLimiter.release();
    }
  }

  /**
   * 运行 Git 命令
   */
  private async runGitCommand(
    args: string[],
    cwd: string,
    timeout: number,
    maxOutputSize?: number
  ): Promise<CommandResult> {
    const startTime = Date.now();
    const maxSize = maxOutputSize || DEFAULT_MAX_OUTPUT_SIZE;
    const useShell = process.platform === 'win32';

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      // 当使用 shell 时，需要正确转义参数（特别是包含空格或特殊字符的参数）
      let child;
      if (useShell) {
        // Windows 上使用 shell，需要将参数正确转义
        const escapedArgs = args.map((arg) => {
          // 如果参数包含换行符，需要特殊处理（git commit 多行消息）
          if (arg.includes('\n')) {
            // 将多行文本转换为使用多个 -m 参数的形式
            // 或者将换行符保留在引号内
            // 这里选择：转义双引号，保留换行符，整体用双引号包裹
            return `"${arg.replace(/"/g, '""')}"`;
          }
          // 如果参数包含空格、引号或特殊字符（但不包含换行符），需要用双引号包裹
          if (/[ "'&|<>^]/.test(arg)) {
            // 转义双引号，然后用双引号包裹
            return `"${arg.replace(/"/g, '""')}"`;
          }
          return arg;
        });
        const command = `git ${escapedArgs.join(' ')}`;
        child = exec(command, {
          cwd,
          maxBuffer: maxSize,
          env: { ...process.env },
          windowsHide: true,
        });
      } else {
        // MacOS/Linux 上不使用 shell，更安全
        child = execFile('git', args, {
          cwd,
          shell: false,
          maxBuffer: maxSize,
          env: { ...process.env },
        });
      }

      // 超时处理
      const timeoutId = setTimeout(() => {
        killed = true;
        if (child.pid) {
          void killProcessTree(child.pid);
        } else {
          child.kill('SIGTERM');
        }

        resolve({
          success: false,
          stdout,
          stderr: `Command timed out after ${timeout}ms`,
          exitCode: -1,
          executionTime: Date.now() - startTime,
        });
      }, timeout);

      // 收集输出
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > maxSize) {
          stdout = stdout.substring(0, maxSize) + '\n[Output truncated]';
          if (child.pid) {
            void killProcessTree(child.pid);
          }
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // 进程结束处理
      child.on('close', (code) => {
        clearTimeout(timeoutId);
        const executionTime = Date.now() - startTime;

        resolve({
          success: code === 0 && !killed,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || 0,
          executionTime,
        });
      });

      // 错误处理
      child.on('error', (error) => {
        clearTimeout(timeoutId);
        const executionTime = Date.now() - startTime;

        resolve({
          success: false,
          stdout: stdout.trim(),
          stderr: error.message,
          exitCode: -1,
          executionTime,
        });
      });
    });
  }

  /**
   * 解析 Git 错误
   */
  static parseGitError(stderr: string, exitCode: number): ToolError {
    // 不是 Git 仓库 - 首先检查，因为其他错误可能在此基础上发生
    if (
      stderr.includes('not a git repository') ||
      (stderr.includes('git repository') && stderr.includes('not'))
    ) {
      return {
        code: ErrorCode.GIT_NOT_REPOSITORY,
        message: 'Not a git repository',
        type: ErrorType.GIT,
        retryable: false,
        details: { exitCode, stderr },
      };
    }

    // 认证失败
    if (
      stderr.includes('Authentication failed') ||
      stderr.includes('could not read Username') ||
      stderr.includes('Permission denied')
    ) {
      return {
        code: ErrorCode.GIT_AUTH_FAILED,
        message: 'Git authentication failed. Please check your credentials.',
        type: ErrorType.GIT,
        retryable: false,
        details: { exitCode, stderr },
      };
    }

    // 目录已存在
    if (stderr.includes('already exists')) {
      return {
        code: ErrorCode.GIT_DIRECTORY_EXISTS,
        message: 'Directory already exists',
        type: ErrorType.GIT,
        retryable: false,
        details: { exitCode, stderr },
      };
    }

    // 分支不存在
    if (
      stderr.includes('could not resolve') ||
      stderr.includes('unknown revision')
    ) {
      return {
        code: ErrorCode.GIT_BRANCH_NOT_FOUND,
        message: 'Branch not found',
        type: ErrorType.GIT,
        retryable: false,
        details: { exitCode, stderr },
      };
    }

    // 分支未合并
    if (stderr.includes('not fully merged')) {
      return {
        code: ErrorCode.GIT_BRANCH_NOT_MERGED,
        message: 'Branch is not fully merged',
        type: ErrorType.GIT,
        retryable: false,
        details: { exitCode, stderr },
      };
    }

    // 未提交更改
    if (
      stderr.includes('uncommitted changes') ||
      stderr.includes('would be overwritten')
    ) {
      return {
        code: ErrorCode.GIT_UNCOMMITTED_CHANGES,
        message:
          'You have uncommitted changes. Please commit or stash them first.',
        type: ErrorType.GIT,
        retryable: false,
        details: { exitCode, stderr },
      };
    }

    // 合并冲突
    if (stderr.includes('Merge conflict') || stderr.includes('conflict')) {
      return {
        code: ErrorCode.GIT_MERGE_CONFLICT,
        message: 'Merge conflict detected. Please resolve conflicts manually.',
        type: ErrorType.GIT,
        retryable: false,
        details: { exitCode, stderr },
      };
    }

    // 推送被拒绝
    if (stderr.includes('rejected') || stderr.includes('non-fast-forward')) {
      return {
        code: ErrorCode.GIT_PUSH_REJECTED,
        message: 'Push rejected. Please pull the latest changes first.',
        type: ErrorType.GIT,
        retryable: true,
        details: { exitCode, stderr },
      };
    }

    // 网络错误
    if (
      stderr.includes('Could not resolve host') ||
      stderr.includes('Connection refused') ||
      stderr.includes('timeout')
    ) {
      return {
        code: ErrorCode.GIT_NETWORK_ERROR,
        message: 'Network error. Please check your connection.',
        type: ErrorType.NETWORK,
        retryable: true,
        details: { exitCode, stderr },
      };
    }

    // 默认错误
    return {
      code: ErrorCode.GIT_AUTH_FAILED,
      message: stderr || 'Git operation failed',
      type: ErrorType.GIT,
      retryable: false,
      details: { exitCode, stderr },
    };
  }
}

/**
 * 创建 Git 执行器
 */
export function createGitExecutor(
  operation: string,
  timeout?: number
): GitExecutor {
  return new GitExecutor(operation, timeout);
}
