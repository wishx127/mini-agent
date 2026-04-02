/**
 * Bash 执行工具
 * 提供受限制的 Bash 命令执行能力
 */

import { spawn } from 'child_process';

import {
  ToolError,
  ExecutionOptions,
  CommandResult,
} from '../command-security/types.js';
import { validateWorkingDirectory } from '../command-security/path-validator.js';
import {
  detectDangerousCommand,
  detectConfirmationRequired,
  createConfirmationError,
} from '../command-security/dangerous-patterns.js';
import { concurrencyLimiter } from '../command-security/concurrency-limiter.js';
import { killProcessTree } from '../command-security/process-manager.js';
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
 * Bash 执行选项
 */
export interface BashExecuteOptions extends ExecutionOptions {
  command: string;
  args?: string[];
}

/**
 * 执行 Bash 命令
 */
export async function bashExecute(
  options: BashExecuteOptions
): Promise<{ success: boolean; data?: CommandResult; error?: ToolError }> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const fullCommand = options.args?.length
    ? `${options.command} ${options.args.join(' ')}`
    : options.command;

  // 检测危险命令
  const dangerousCheck = detectDangerousCommand(fullCommand);
  if (dangerousCheck.dangerous) {
    await auditLogger.logSecurityEvent(
      'bash_execute',
      fullCommand,
      dangerousCheck.error?.message || 'Dangerous command detected',
      true
    );
    return { success: false, error: dangerousCheck.error };
  }

  // 检测是否需要确认
  const confirmationCheck = detectConfirmationRequired(fullCommand);
  if (confirmationCheck.requiresConfirmation && !options.confirmed) {
    return {
      success: false,
      error: createConfirmationError(confirmationCheck.details!),
    };
  }

  // 并发控制
  const acquireResult = concurrencyLimiter.acquire();
  if (!acquireResult.allowed) {
    return { success: false, error: acquireResult.error };
  }

  try {
    // 验证工作目录
    const cwdValidation = validateWorkingDirectory(options.cwd);
    if (!cwdValidation.valid) {
      return { success: false, error: cwdValidation.error };
    }

    const cwd = cwdValidation.resolvedPath;

    // 执行命令
    const result = await runBashCommand(
      options.command,
      options.args || [],
      cwd!,
      timeout,
      options.maxOutputSize,
      options.env
    );

    // 记录审计日志
    await auditLogger.logCommandExecution(
      'bash',
      'execute',
      fullCommand,
      cwd,
      result.success,
      result.executionTime,
      result.success ? undefined : result.stderr
    );

    return { success: result.success, data: result };
  } finally {
    concurrencyLimiter.release();
  }
}

/**
 * 运行 Bash 命令
 */
async function runBashCommand(
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
  maxOutputSize?: number,
  env?: Record<string, string>
): Promise<CommandResult> {
  const startTime = Date.now();
  const maxSize = maxOutputSize || DEFAULT_MAX_OUTPUT_SIZE;
  const plat = process.platform;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    // 在 Windows 上使用 cmd /c，在 Unix 上使用 sh -c
    let shellCommand: string;
    let shellArgs: string[];

    if (plat === 'win32') {
      shellCommand = 'cmd';
      shellArgs = ['/c', command, ...args];
    } else {
      shellCommand = 'sh';
      shellArgs = ['-c', `${command} ${args.join(' ')}`];
    }

    const child = spawn(shellCommand, shellArgs, {
      cwd,
      shell: false,
      env: { ...process.env, ...env },
      detached: plat !== 'win32', // Unix 上创建进程组以便终止
    });

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
        killed = true;
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
 * 快速执行简单命令
 */
export async function bashExecSimple(
  command: string,
  args: string[] = [],
  cwd?: string
): Promise<{ success: boolean; output: string; error?: string }> {
  const result = await bashExecute({
    command,
    args,
    cwd,
    timeout: 10000,
  });

  if (result.success && result.data) {
    return {
      success: true,
      output: result.data.stdout,
    };
  }

  return {
    success: false,
    output: result.data?.stdout || '',
    error: result.error?.message || result.data?.stderr || 'Unknown error',
  };
}
