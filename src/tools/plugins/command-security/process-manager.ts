/**
 * 进程管理器
 * 提供进程树终止功能
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execFileAsync = promisify(execFile);

/**
 * 平台类型
 */
type Platform = 'win32' | 'darwin' | 'linux';

/**
 * 获取当前平台
 */
function getPlatform(): Platform {
  return platform() as Platform;
}

/**
 * 检查 Git 是否安装
 */
export async function checkGitInstalled(): Promise<boolean> {
  try {
    const plat = getPlatform();
    const command = plat === 'win32' ? 'where' : 'which';
    await execFileAsync(command, ['git'], { shell: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * 终止进程树
 */
export async function killProcessTree(pid: number): Promise<void> {
  const plat = getPlatform();

  try {
    if (plat === 'win32') {
      await killProcessTreeWindows(pid);
    } else {
      await killProcessTreeUnix(pid);
    }
  } catch (error) {
    // 终止失败不抛出错误，记录即可
    console.error(`Failed to kill process tree for PID ${pid}:`, error);
  }
}

/**
 * Windows 进程树终止
 */
async function killProcessTreeWindows(pid: number): Promise<void> {
  try {
    // 使用 taskkill /T /F 强制终止进程树
    await execFileAsync('taskkill', ['/PID', pid.toString(), '/T', '/F'], {
      shell: false,
    });
  } catch {
    // taskkill 返回非零退出码可能表示进程已经终止
    // 这是可以接受的
  }
}

/**
 * Unix 进程树终止
 */
async function killProcessTreeUnix(pid: number): Promise<void> {
  try {
    // 首先发送 SIGTERM 到进程组
    // 使用负 PID 发送到进程组
    await execFileAsync('kill', ['-TERM', `-${pid}`], { shell: false });

    // 等待 5 秒让进程正常退出
    await sleep(5000);

    // 如果进程仍然存在，发送 SIGKILL
    try {
      // 检查进程是否仍然存在
      process.kill(pid, 0);
      // 进程存在，发送 SIGKILL
      await execFileAsync('kill', ['-KILL', `-${pid}`], { shell: false });
    } catch {
      // 进程已经不存在，这是正常的
    }
  } catch {
    // 终止失败，进程可能已经退出
  }
}

/**
 * 睡眠函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 创建带超时控制的 Promise
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error: unknown) => {
        clearTimeout(timeoutId);
        if (error instanceof Error) {
          reject(error);
        } else {
          reject(new Error(String(error)));
        }
      });
  });
}

/**
 * 执行命令并管理进程
 */
export interface ManagedExecutionOptions {
  command: string;
  args: string[];
  cwd?: string;
  timeout?: number;
  maxOutputSize?: number;
  env?: Record<string, string>;
}

/**
 * 执行结果
 */
export interface ManagedExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  killed: boolean;
  executionTime: number;
}
