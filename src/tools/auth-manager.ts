import readline from 'readline';

import chalk from 'chalk';

import {
  FileOperationErrorCode,
  ToolError,
} from './plugins/file-operations/types.js';

/**
 * 授权详情接口
 */
export interface AuthDetails {
  /** 操作类型 */
  operation: string;
  /** 目标路径 */
  path: string;
  /** 项目根目录 */
  projectRoot: string;
}

/**
 * 授权回调接口
 */
export interface AuthCallbacks {
  /** 询问前调用（可用于暂停 spinner），返回当前的 loading 文本 */
  onBeforeAsk?: () => string | null;
  /** 询问后调用（可用于恢复 spinner），传入 loading 文本 */
  onAfterAsk?: (loadingText: string | null) => void;
  /** 暂停 CLI 输入监听（避免与 readline 冲突） */
  pauseCliInput?: () => void;
  /** 恢复 CLI 输入监听 */
  resumeCliInput?: () => void;
}

/**
 * 授权管理器 - 处理文件操作的用户交互式授权
 */
export class AuthManager {
  private rl: readline.Interface | null = null;
  private callbacks?: AuthCallbacks;
  // 记录用户拒绝的授权请求，避免重复询问
  private rejectedAuths: Set<string> = new Set();

  /**
   * 设置回调函数
   * @param callbacks 回调函数
   */
  setCallbacks(callbacks: AuthCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * 生成授权请求的唯一键
   * @param details 授权详情
   * @returns 唯一键
   */
  private getAuthKey(details: AuthDetails): string {
    return `${details.operation}:${details.path}`;
  }

  /**
   * 检查授权是否已被用户拒绝
   * @param details 授权详情
   * @returns 是否已被拒绝
   */
  isAuthRejected(details: AuthDetails): boolean {
    return this.rejectedAuths.has(this.getAuthKey(details));
  }

  /**
   * 清除所有拒绝记录
   */
  clearRejectedAuths(): void {
    this.rejectedAuths.clear();
  }

  /**
   * 清除特定授权的拒绝记录
   * @param details 授权详情
   */
  clearRejectedAuth(details: AuthDetails): void {
    this.rejectedAuths.delete(this.getAuthKey(details));
  }

  /**
   * 拒绝授权（用于外部标记拒绝状态）
   * @param details 授权详情
   */
  rejectAuth(details: AuthDetails): void {
    this.rejectedAuths.add(this.getAuthKey(details));
  }

  /**
   * 获取当前拒绝记录数量（用于调试）
   */
  getRejectedAuthCount(): number {
    return this.rejectedAuths.size;
  }

  /**
   * 询问用户是否授权
   * @param details 授权详情
   * @returns 用户是否授权
   */
  async askForAuth(details: AuthDetails): Promise<boolean> {
    // 检查是否已被用户拒绝过
    if (this.isAuthRejected(details)) {
      return false;
    }

    // 暂停 CLI 输入监听，避免与 readline 冲突
    this.callbacks?.pauseCliInput?.();

    // 创建新的 readline 接口（每次询问都创建新的，避免状态问题）
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdout.isTTY,
    });
    this.rl = rl;

    const { operation } = details;

    // 调用询问前回调（暂停 spinner），获取当前的 loading 文本
    const loadingText = this.callbacks?.onBeforeAsk?.();

    return new Promise((resolve) => {
      // 清除可能的 spinner 行，确保提示可见
      process.stdout.write('\r\x1b[K');

      let hasResponded = false;

      rl.once('close', () => {
        this.callbacks?.resumeCliInput?.();
        this.callbacks?.onAfterAsk?.(loadingText ?? null);
        if (this.rl === rl) {
          this.rl = null;
        }
      });

      // 处理 Ctrl+C - 在 readline 中中断也按拒绝处理
      rl.on('SIGINT', () => {
        if (!hasResponded) {
          hasResponded = true;
          // 记录用户拒绝，避免重复询问
          this.rejectedAuths.add(this.getAuthKey(details));
          rl.close();
          resolve(false);
        }
      });

      // 处理 readline 关闭（正常关闭时）
      rl.on('close', () => {
        if (!hasResponded) {
          hasResponded = true;
          // readline 关闭但用户未回答，视为拒绝
          resolve(false);
        }
      });

      // 递归询问函数
      const askQuestion = () => {
        rl.question(
          chalk.cyan(`是否允许 ${operation}? (y/n): `),
          (answer: string) => {
            if (hasResponded) {
              return;
            }

            const normalized = answer.trim().toLowerCase();

            // 明确的同意
            if (normalized === 'y' || normalized === 'yes') {
              hasResponded = true;
              rl.close();
              resolve(true);
              return;
            }

            // 明确的拒绝
            if (normalized === 'n' || normalized === 'no') {
              hasResponded = true;
              // 记录用户拒绝，避免重复询问
              this.rejectedAuths.add(this.getAuthKey(details));
              rl.close();
              resolve(false);
              return;
            }

            // 无效输入，提示并重新询问
            console.log(
              chalk.yellow('请输入 y/yes 表示同意，或 n/no 表示拒绝\n')
            );
            askQuestion(); // 递归调用，重新询问
          }
        );
      };

      // 开始询问
      askQuestion();
    });
  }

  /**
   * 检查错误是否需要授权
   * @param error 错误对象
   * @returns 是否需要授权
   */
  isAuthRequired(error: unknown): boolean {
    if (error instanceof ToolError) {
      return error.code === FileOperationErrorCode.PATH_ACCESS_DENIED;
    }
    if (error instanceof Error) {
      return (
        error.message.includes('PATH_ACCESS_DENIED') ||
        error.message.includes('outside project directory') ||
        error.message.includes('CONFIRMATION_REQUIRED') ||
        error.message.includes('requires confirmation')
      );
    }
    return false;
  }

  /**
   * 从错误中提取授权详情
   * @param error 错误对象
   * @returns 授权详情
   */
  extractAuthDetails(error: unknown): AuthDetails {
    if (error instanceof ToolError && error.details) {
      const details = error.details as Record<string, string>;
      return {
        operation: String(details.operation || '文件操作'),
        path: String(details.path || '未知路径'),
        projectRoot: String(details.projectRoot || '未知项目目录'),
      };
    }
    return {
      operation: '文件操作',
      path: '未知路径',
      projectRoot: '未知项目目录',
    };
  }

  /**
   * 关闭 readline 接口
   */
  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

/**
 * 全局授权管理器实例
 */
export const authManager = new AuthManager();
